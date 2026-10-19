// Read-only proxy for the public BONS API. The browser on this site cannot call
// bonsonbtc.fun directly, so Look asks this function instead. Nothing here signs or sends.
const BASE = "https://bonsonbtc.fun/api-mainnet";
const GARDEN = "https://crc20.org/api/v1";

function tickOk(value) {
  return /^[A-Z0-9]{2,12}$/.test(value);
}

function txOk(value) {
  return /^[a-f0-9]{64}$/.test(value);
}

function addrOk(value) {
  return /^bc1[a-z0-9]{20,90}$/i.test(value);
}

function gardenAddrOk(value) {
  return /^(bc1[a-z0-9]{20,90}|[13][a-zA-Z0-9]{24,40})$/.test(value);
}

function queryFrom(req) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const q = new URLSearchParams(url.search);
  const extra = req.query || {};
  for (const key of Object.keys(extra)) {
    const value = extra[key];
    if (!q.has(key) && typeof value === "string") q.set(key, value);
  }
  return q;
}

async function upstream(path) {
  const res = await fetch(BASE + path, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function garden(path) {
  const res = await fetch(GARDEN + path, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=20",
    },
    body: text,
  };
}

async function handle(q) {
  const p = q.get("p") || "";
  if (p === "image") {
    const tick = (q.get("tick") || "").toUpperCase();
    if (!tickOk(tick)) {
      return { status: 400, headers: { "content-type": "application/json; charset=utf-8" }, body: '{"error":"bad ticker"}' };
    }
    const res = await fetch(`${BASE}/launch/image/${tick}`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
      return { status: res.status, headers: { "content-type": "application/json; charset=utf-8" }, body: '{"error":"no picture"}' };
    }
    const body = Buffer.from(await res.arrayBuffer());
    return {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") || "image/jpeg",
        "cache-control": "public, max-age=300",
      },
      body,
    };
  }

  if (p === "garden") {
    const what = q.get("what") || "";
    if (what === "status") return garden("/status");
    if (what === "stats") {
      const tick = (q.get("tick") || "").toUpperCase();
      if (tick !== "LEAF" && tick !== "AXBT") return json(400, { error: "bad ticker" });
      return garden(`/stats/${tick}`);
    }
    if (what === "history") {
      const limit = Math.min(20, Math.max(1, Number(q.get("limit")) || 12));
      return garden(`/history?tick=all&limit=${limit}`);
    }
    if (what === "tx") {
      const txid = (q.get("txid") || "").toLowerCase();
      if (!txOk(txid)) return json(400, { error: "bad transaction" });
      return garden(`/transactions/${txid}?tick=all`);
    }
    if (what === "wallet") {
      const address = q.get("address") || "";
      if (!gardenAddrOk(address)) return json(400, { error: "bad address" });
      return garden(`/addresses/${encodeURIComponent(address)}`);
    }
    return json(404, { error: "unknown" });
  }

  let path = null;
  if (p === "stats") path = "/stats";
  else if (p === "fees") path = "/fees";
  else if (p === "launch") path = "/launch/tokens";
  else if (p === "pool") {
    const tick = (q.get("tick") || "").toUpperCase();
    if (!tickOk(tick)) return json(400, { error: "bad ticker" });
    path = `/swap/pool?ticker=${tick}`;
  } else if (p === "trades") {
    const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || 20));
    const tick = (q.get("tick") || "").toUpperCase();
    if (q.get("tick") && !tickOk(tick)) return json(400, { error: "bad ticker" });
    path = tick ? `/swap/trades?ticker=${tick}&limit=${limit}` : `/swap/trades?limit=${limit}`;
  } else if (p === "trade" || p === "tx") {
    const txid = (q.get("txid") || "").toLowerCase();
    if (!txOk(txid)) return json(400, { error: "bad transaction" });
    path = p === "trade" ? `/swap/trade/${txid}` : `/tx/${txid}`;
  } else if (p === "wallet") {
    const address = q.get("address") || "";
    if (!addrOk(address)) return json(400, { error: "bad address" });
    path = `/wallet/portfolio?address=${encodeURIComponent(address)}`;
  } else {
    return json(404, { error: "unknown" });
  }

  const got = await upstream(path);
  let text = got.text;
  if (p === "wallet") {
    try {
      const parsed = JSON.parse(text);
      const data = parsed && parsed.ok === true && "data" in parsed ? parsed.data : parsed;
      if (data && typeof data === "object") delete data.token_covenants;
      text = JSON.stringify(parsed && parsed.ok === true ? { ...parsed, data } : data);
    } catch {
      /* keep the upstream body */
    }
  }
  return {
    status: got.status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=15",
    },
    body: text,
  };
}

function json(status, payload) {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(payload),
  };
}

module.exports = async function crc(req, res) {
  if (req.method && req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("allow", "GET");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end('{"error":"This page only reads."}');
    return;
  }
  try {
    const out = await handle(queryFrom(req));
    res.statusCode = out.status;
    for (const [key, value] of Object.entries(out.headers)) res.setHeader(key, value);
    res.end(out.body);
  } catch {
    res.statusCode = 502;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end('{"error":"The BONS service did not answer."}');
  }
};

module.exports.handle = handle;
