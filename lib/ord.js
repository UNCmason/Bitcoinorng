// Reads where an inscription sits. Nothing here has a key, and nothing here spends.
const ID_RE = /^[a-f0-9]{64}i\d+$/;
const TX_RE = /^[a-f0-9]{64}$/;
const ADDR_RE = /^(bc1[a-z0-9]{20,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/;
const IMAGE_RE = /^image\/(png|jpeg|gif|webp)$/;

function fail(message) {
  const error = new Error(message);
  error.expose = true;
  throw error;
}

function inscriptionId(value) {
  const id = String(value || "").trim().toLowerCase();
  if (!ID_RE.test(id)) fail("That inscription id could not be read.");
  return id;
}

function txidOf(value) {
  const id = String(value || "").trim().toLowerCase();
  if (!TX_RE.test(id)) fail("That bitcoin transaction could not be read.");
  return id;
}

function addressOf(value) {
  const address = String(value || "").trim();
  if (!ADDR_RE.test(address)) fail("That Bitcoin address could not be read.");
  return address;
}

async function grab(url) {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
    headers: { accept: "application/json, text/html;q=0.9, */*;q=0.8" },
  });
  if (!res.ok) {
    const error = new Error("lookup failed");
    error.status = res.status;
    throw error;
  }
  return res;
}

function parseOutputHtml(html) {
  const text = String(html || "");
  const ids = [];
  const re = /href=\/inscription\/([a-f0-9]{64}i\d+)/g;
  let match;
  while ((match = re.exec(text))) ids.push(match[1]);
  const spent = /<dt>spent<\/dt>\s*<dd>(true|false)<\/dd>/.exec(text);
  const value = /<dt>value<\/dt>\s*<dd>(\d+)<\/dd>/.exec(text);
  const address = /href=\/address\/(bc1[a-z0-9]+|[13][a-km-zA-HJ-NP-Z1-9]+)/.exec(text);
  if (!spent) return null;
  return {
    inscriptions: [...new Set(ids)],
    spent: spent[1] === "true",
    value: value ? Number(value[1]) : null,
    address: address ? address[1] : "",
  };
}

async function inscription(id) {
  id = inscriptionId(id);
  let body;
  try {
    body = await (await grab("https://ordinals.unisat.io/r/inscription/" + id)).json();
  } catch {
    fail("That inscription could not be looked up right now.");
  }
  const output = String(body && body.output || "");
  const parts = output.split(":");
  const value = Number(body && body.value);
  if (!body || body.id !== id || typeof body.address !== "string" || parts.length !== 2 || !TX_RE.test(parts[0]) || !/^\d+$/.test(parts[1]) || !Number.isInteger(value) || value < 1) {
    fail("That inscription could not be read.");
  }
  return {
    id,
    address: body.address,
    txid: parts[0],
    vout: Number(parts[1]),
    value,
    contentType: String(body.content_type || "").slice(0, 80),
    number: Number.isInteger(body.number) ? body.number : null,
  };
}

async function outputInfo(txid, vout) {
  txid = txidOf(txid);
  if (!Number.isInteger(vout) || vout < 0 || vout > 100000) fail("That bitcoin output could not be read.");
  try {
    const html = await (await grab("https://ordinals.unisat.io/output/" + txid + ":" + vout)).text();
    return parseOutputHtml(html);
  } catch {
    return null;
  }
}

async function mempool(pathname) {
  let body;
  try {
    body = await (await grab("https://mempool.space/api" + pathname)).json();
  } catch {
    fail("Bitcoin could not be looked up right now.");
  }
  return body;
}

async function feeRate() {
  const fees = await mempool("/v1/fees/recommended");
  const rate = Number(fees && fees.halfHourFee);
  if (!Number.isInteger(rate) || rate < 1 || rate > 1000) fail("The Bitcoin fee rate is not available right now.");
  return rate;
}

async function utxos(address) {
  address = addressOf(address);
  const rows = await mempool("/address/" + address + "/utxo");
  if (!Array.isArray(rows)) fail("Bitcoin could not be looked up right now.");
  return rows;
}

async function txOf(txid) {
  return mempool("/tx/" + txidOf(txid));
}

async function outspend(txid, vout) {
  if (!Number.isInteger(vout) || vout < 0) fail("That bitcoin output could not be read.");
  const row = await mempool("/tx/" + txidOf(txid) + "/outspend/" + vout);
  return { spent: Boolean(row && row.spent) };
}

async function content(id) {
  id = inscriptionId(id);
  const urls = [
    "https://ordinals.unisat.io/content/" + id,
    "https://static.unisat.io/content/" + id,
  ];
  for (const url of urls) {
    try {
      const res = await grab(url);
      const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!IMAGE_RE.test(type)) continue;
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length < 1 || body.length > 800000) continue;
      return { type, body };
    } catch {
      /* the other host may still have the image */
    }
  }
  return null;
}

module.exports = {
  inscriptionId,
  addressOf,
  txidOf,
  parseOutputHtml,
  inscription,
  outputInfo,
  feeRate,
  utxos,
  txOf,
  outspend,
  content,
};
