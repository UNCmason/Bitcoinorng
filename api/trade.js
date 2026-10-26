// A small board for one inscription at a signed bitcoin price.
// The site stores the signed listing. It does not hold a key, and it does not
// broadcast until the picture and the payment have been checked.
const crypto = require("crypto");
const { Redis } = require("@upstash/redis");
const market = require("../lib/market");
const ord = require("../lib/ord");

const MAX_LISTINGS = 40;
const IDS = "trade:ids";
let redis;

function fail(message) {
  const error = new Error(message);
  error.expose = true;
  throw error;
}

function db() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

function rowKey(id) { return "trade:row:" + id; }
function psbtKey(id) { return "trade:psbt:" + id; }
function cancelKey(id) { return "trade:cancel:" + id; }

function ipOf(req) {
  const forwarded = req.headers && (req.headers["x-forwarded-for"] || req.headers["X-Forwarded-For"]) || "";
  return crypto.createHash("sha256").update(String(forwarded).split(",")[0] || "x").digest("hex").slice(0, 16);
}

async function limit(r, req) {
  const key = "trade:rl:" + ipOf(req);
  const n = await r.incr(key);
  if (n === 1) await r.expire(key, 60);
  if (n > 15) fail("Slow down a moment, then try again.");
}

async function readJson(r, key) {
  const raw = await r.get(key);
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return typeof raw === "object" ? raw : null;
}

function blocksHigherPrice(old, next) {
  return Boolean(old && old.txid === next.txid && Number(old.vout) === Number(next.vout) && next.priceSats > old.priceSats);
}

function publicRow(row) {
  return {
    id: row.id,
    txid: row.txid,
    vout: row.vout,
    value: row.value,
    priceSats: row.priceSats,
    seller: row.seller,
    contentType: row.contentType || "",
    number: Number.isInteger(row.number) ? row.number : null,
    listedAt: row.listedAt,
  };
}

async function drop(r, id) {
  await r.srem(IDS, id);
  await r.del(rowKey(id), psbtKey(id), cancelKey(id));
}

function readBody(req) {
  const body = req.body;
  if (body && typeof body === "object") return body;
  if (typeof body === "string") {
    if (body.length > 80000) fail("That request is too large.");
    try { return JSON.parse(body); } catch { fail("That could not be read."); }
  }
  return {};
}

async function located(id) {
  const info = await ord.inscription(id);
  const tx = await ord.txOf(info.txid);
  const output = tx && Array.isArray(tx.vout) ? tx.vout[info.vout] : null;
  if (!output || output.scriptpubkey_address !== info.address || Number(output.value) !== info.value) {
    fail("That picture's bitcoin output could not be matched.");
  }
  const spent = await ord.outspend(info.txid, info.vout);
  return {
    info,
    scriptHex: output.scriptpubkey,
    spent: spent.spent,
    confirmed: Boolean(tx.status && tx.status.confirmed),
  };
}

async function liveRows(r) {
  const ids = await r.smembers(IDS);
  const list = Array.isArray(ids) ? ids.map(String) : [];
  const rows = await Promise.all(list.map(async (id) => {
    const row = await readJson(r, rowKey(id));
    if (!row || typeof row.id !== "string" || typeof row.txid !== "string") {
      await drop(r, id);
      return null;
    }
    try {
      if ((await ord.outspend(row.txid, Number(row.vout))).spent) {
        await drop(r, id);
        return null;
      }
    } catch {
      /* keep the listing if the spent check cannot be made */
    }
    return publicRow(row);
  }));
  return rows.filter(Boolean).sort((a, b) => b.listedAt - a.listedAt);
}

async function prepareSell(body) {
  const id = ord.inscriptionId(body.id);
  const seller = ord.addressOf(body.address);
  const priceSats = market.btcToSats(body.price);
  const found = await located(id);
  if (found.spent) fail("That picture has already moved.");
  if (!found.confirmed) fail("Wait until this picture's bitcoin output is confirmed.");
  if (found.info.address !== seller) fail("That picture is not in this wallet.");
  const psbt = market.buildSellPsbt({
    txid: found.info.txid,
    vout: found.info.vout,
    value: found.info.value,
    scriptHex: found.scriptHex,
    seller,
    priceSats,
  });
  return { psbt, priceSats, sign: [0], seller, id, value: found.info.value };
}

async function list(r, body) {
  if (typeof body.psbt !== "string" || body.psbt.length < 20 || body.psbt.length > 80000) fail("The sale could not be read.");
  const id = ord.inscriptionId(body.id);
  const parsed = market.parsePsbt(body.psbt);
  const info = market.assertSellSigned(parsed);
  const found = await located(id);
  if (found.spent) fail("That picture has already moved.");
  if (!found.confirmed) fail("Wait until this picture's bitcoin output is confirmed.");
  if (found.info.address !== info.seller || found.info.txid !== info.txid || found.info.vout !== info.vout || found.info.value !== info.value || found.scriptHex !== info.scriptHex) {
    fail("The signature is not for this picture.");
  }
  const old = await readJson(r, rowKey(id));
  if (blocksHigherPrice(old, info)) {
    fail("A lower price is already signed for this output. Send the picture to yourself before listing a higher price.");
  }
  const count = Number(await r.scard(IDS)) || 0;
  if (!old && count >= MAX_LISTINGS) fail("The board is full right now.");
  const token = crypto.randomBytes(32).toString("hex");
  const row = {
    id,
    txid: info.txid,
    vout: info.vout,
    value: info.value,
    priceSats: info.priceSats,
    seller: info.seller,
    contentType: found.info.contentType,
    number: found.info.number,
    listedAt: Date.now(),
  };
  await r.set(rowKey(id), JSON.stringify(row));
  await r.set(psbtKey(id), parsed.toHex());
  await r.set(cancelKey(id), crypto.createHash("sha256").update(token).digest("hex"));
  await r.sadd(IDS, id);
  return { ok: true, cancelToken: token, listing: publicRow(row) };
}

async function cancel(r, body) {
  const id = ord.inscriptionId(body.id);
  const token = String(body.token || "").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) fail("The cancel code does not match.");
  const saved = await r.get(cancelKey(id));
  const want = typeof saved === "string" ? saved : "";
  const got = crypto.createHash("sha256").update(token).digest("hex");
  if (!want || want !== got) fail("The cancel code does not match.");
  await drop(r, id);
  return { ok: true };
}

async function cardinal(address) {
  const rows = await ord.utxos(address);
  const confirmed = rows
    .filter((row) => row && row.status && row.status.confirmed && Number.isInteger(row.value) && row.value >= market.DUST)
    .sort((a, b) => a.value - b.value)
    .slice(0, 12);
  const txs = new Map();
  const coins = [];
  await Promise.all(confirmed.map(async (row) => {
    const txid = String(row.txid || "").toLowerCase();
    const vout = row.vout;
    if (!/^[a-f0-9]{64}$/.test(txid) || !Number.isInteger(vout)) return;
    try {
      let tx = txs.get(txid);
      if (!tx) {
        tx = await ord.txOf(txid);
        txs.set(txid, tx);
      }
      const output = tx && Array.isArray(tx.vout) ? tx.vout[vout] : null;
      if (!output || output.scriptpubkey_address !== address || Number(output.value) !== row.value) return;
      if ((await ord.outspend(txid, vout)).spent) return;
      const page = await ord.outputInfo(txid, vout);
      if (!page || page.spent !== false || page.inscriptions.length) return;
      coins.push({ txid, vout, value: row.value, scriptHex: output.scriptpubkey });
    } catch {
      /* skip an output that cannot be checked */
    }
  }));
  coins.sort((a, b) => a.value - b.value);
  return coins;
}

async function prepareBuy(r, body) {
  const id = ord.inscriptionId(body.id);
  const buyer = ord.addressOf(body.buyer);
  const sellHex = await r.get(psbtKey(id));
  if (typeof sellHex !== "string" || !sellHex) fail("That picture is not for sale.");
  const sellInfo = market.assertSellSigned(market.parsePsbt(sellHex));
  const found = await located(id);
  if (found.spent || found.info.txid !== sellInfo.txid || found.info.vout !== sellInfo.vout || found.info.address !== sellInfo.seller) {
    await drop(r, id);
    fail("That picture is no longer at the listed output.");
  }
  const rate = await ord.feeRate();
  const coins = await cardinal(buyer);
  const bumps = coins.filter((coin) => coin.value <= 50000).slice(0, 2);
  const used = new Set(bumps.map((coin) => coin.txid + ":" + coin.vout));
  const funds = coins.filter((coin) => !used.has(coin.txid + ":" + coin.vout)).sort((a, b) => b.value - a.value);
  if (bumps.length < 2) {
    const big = coins.find((coin) => coin.value >= 21000);
    if (!big) fail("This address needs spare bitcoin before it can buy.");
    const split = market.buildSplitPsbt({
      txid: big.txid,
      vout: big.vout,
      value: big.value,
      scriptHex: big.scriptHex,
      buyer,
      feeRate: rate,
    });
    return { needSplit: true, psbt: split.psbt, fee: split.fee, sign: split.sign, priceSats: sellInfo.priceSats };
  }
  if (!funds.length) fail("This address needs more bitcoin for the price and the miner fee.");
  return market.buildBuyPsbt({ sellHex, buyer, bumps, funds: [funds[0]], feeRate: rate });
}

async function pushTx(hex) {
  let res;
  let text = "";
  try {
    res = await fetch("https://mempool.space/api/tx", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: hex,
      signal: AbortSignal.timeout(15000),
    });
    text = (await res.text()).trim();
  } catch {
    fail("The bitcoin network could not be reached.");
  }
  if (!res.ok || !/^[a-f0-9]{64}$/.test(text)) {
    fail(text && text.length < 180 ? text : "The bitcoin network did not take this transaction.");
  }
  return text;
}

async function inputsClear(psbt, skip) {
  for (let i = 0; i < psbt.inputCount; i++) {
    if (i === skip) continue;
    const point = psbt.txInputs[i];
    const txid = Buffer.from(point.hash).reverse().toString("hex");
    if ((await ord.outspend(txid, point.index)).spent) fail("One of the bitcoin outputs was already spent.");
    const page = await ord.outputInfo(txid, point.index);
    if (!page || page.spent !== false || page.inscriptions.length) {
      fail("A payment output holds another picture, so this was stopped.");
    }
  }
}

async function broadcastBuy(r, body) {
  if (typeof body.psbt !== "string" || body.psbt.length > 80000) fail("The buy could not be read.");
  const id = ord.inscriptionId(body.id);
  const buyer = ord.addressOf(body.buyer);
  const sellHex = await r.get(psbtKey(id));
  if (typeof sellHex !== "string" || !sellHex) fail("That picture is not for sale.");
  const sellInfo = market.assertSellSigned(market.parsePsbt(sellHex));
  const buy = market.parsePsbt(body.psbt);
  market.assertBuySigned(buy, sellInfo, buyer);
  const found = await located(id);
  if (found.spent || found.info.txid !== sellInfo.txid || found.info.vout !== sellInfo.vout || found.info.address !== sellInfo.seller) {
    await drop(r, id);
    fail("That picture is no longer at the listed output.");
  }
  await ord.feeRate();
  await inputsClear(buy, 2);
  const final = market.finalizeHex(body.psbt);
  const txid = await pushTx(final.hex);
  await drop(r, id);
  return { ok: true, txid };
}

async function broadcastSplit(body) {
  if (typeof body.psbt !== "string" || body.psbt.length > 80000) fail("The split could not be read.");
  const buyer = ord.addressOf(body.buyer);
  const psbt = market.parsePsbt(body.psbt);
  market.assertSplitSigned(psbt, buyer);
  await ord.feeRate();
  await inputsClear(psbt, -1);
  const final = market.finalizeHex(body.psbt);
  return { ok: true, txid: await pushTx(final.hex) };
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const r = db();
    if (!r) return res.status(503).json({ error: "The board is not available right now." });
    if (req.method === "GET") return res.status(200).json({ listings: await liveRows(r) });
    if (req.method !== "POST") return res.status(405).json({ error: "That could not be done." });
    await limit(r, req);
    const body = readBody(req);
    if (body.op === "prepareSell") return res.status(200).json(await prepareSell(body));
    if (body.op === "list") return res.status(200).json(await list(r, body));
    if (body.op === "cancel") return res.status(200).json(await cancel(r, body));
    if (body.op === "prepareBuy") return res.status(200).json(await prepareBuy(r, body));
    if (body.op === "broadcast") return res.status(200).json(await broadcastBuy(r, body));
    if (body.op === "split") return res.status(200).json(await broadcastSplit(body));
    return res.status(400).json({ error: "That could not be done." });
  } catch (error) {
    const message = error && error.expose ? error.message : "That could not be done.";
    return res.status(error && error.expose ? 400 : 500).json({ error: message });
  }
}

module.exports = handler;
module.exports.blocksHigherPrice = blocksHigherPrice;
