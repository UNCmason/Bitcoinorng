(function (root) {
  const BONS_ORANGE = "#F7931A";

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function group(intPart) {
    return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function tokenAmount(value) {
    if (value == null || value === "") return "—";
    let raw = String(value).trim();
    if (!/^-?\d+(\.\d+)?$/.test(raw)) return "—";
    const neg = raw.startsWith("-");
    raw = raw.replace("-", "");
    let [whole, frac = ""] = raw.split(".");
    const keep = whole.length > 3 ? 2 : whole === "0" ? 8 : 4;
    if (frac.length > keep) {
      const head = frac.slice(0, keep);
      if (frac[keep] >= "5") {
        const bumped = (BigInt(head || "0") + 1n).toString().padStart(Math.max(keep, 1), "0");
        if (bumped.length > keep) {
          whole = (BigInt(whole) + 1n).toString();
          frac = "";
        } else frac = bumped;
      } else frac = head;
    }
    frac = frac.replace(/0+$/, "");
    return (neg ? "-" : "") + group(whole) + (frac ? "." + frac : "");
  }

  function num(value, digits) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("en-US", { maximumFractionDigits: digits });
  }

  function btcFromSats(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    const sats = BigInt(Math.round(n));
    const neg = sats < 0n ? "-" : "";
    const abs = sats < 0n ? -sats : sats;
    const whole = abs / 100000000n;
    const frac = (abs % 100000000n).toString().padStart(8, "0").replace(/0+$/, "");
    return `${neg}${whole.toString()}${frac ? "." + frac : ""} BTC`;
  }

  function sats(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return `${Math.round(n).toLocaleString("en-US")} sats`;
  }

  function usd(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    if (n === 0) return "$0";
    if (Math.abs(n) >= 1) return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
    if (Math.abs(n) >= 0.01) return `$${n.toFixed(4)}`;
    return `$${n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}`;
  }

  function usdFromSats(value, rate) {
    const sats = Number(value);
    const px = Number(rate);
    if (!Number.isFinite(sats) || !Number.isFinite(px) || px <= 0) return null;
    return (sats / 1e8) * px;
  }

  function moneyText(value, rate) {
    const btc = btcFromSats(value);
    const dollars = usdFromSats(value, rate);
    if (dollars == null) return btc;
    return `${btc} (${usd(dollars)})`;
  }

  function moneyHtml(value, rate) {
    const btc = btcFromSats(value);
    const dollars = usdFromSats(value, rate);
    if (dollars == null) return esc(btc);
    return `<span class="tiny">${esc(btc)}</span> <span class="usd">${esc(usd(dollars))}</span>`;
  }

  function eachHtml(satsEach, rate) {
    const n = Number(satsEach);
    if (!Number.isFinite(n)) return "";
    const label = `${num(n, 2)} sats`;
    const dollars = usdFromSats(n, rate);
    if (dollars == null) return esc(label);
    return `<span class="tiny">${esc(label)}</span> <span class="usd">${esc(usd(dollars))}</span>`;
  }

  function walletHtml(portfolio, rate) {
    const btc = btcFromSats(portfolio && portfolio.btc_sats);
    const raw = portfolio ? portfolio.btc_usd : undefined;
    const apiUsd = raw == null || raw === "" ? Number.NaN : Number(raw);
    const dollars = Number.isFinite(apiUsd) ? apiUsd : usdFromSats(portfolio && portfolio.btc_sats, rate);
    if (!Number.isFinite(dollars)) return esc(btc);
    return `<span class="tiny">${esc(btc)}</span> <span class="usd">${esc(usd(dollars))}</span>`;
  }

  function shortId(value, head, tail) {
    if (!value) return "—";
    const h = head == null ? 6 : head;
    const t = tail == null ? 4 : tail;
    if (value.length <= h + t + 1) return value;
    return `${value.slice(0, h)}…${value.slice(-t)}`;
  }

  function when(ms) {
    if (!ms) return "—";
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) + " UTC";
  }

  function tradeBits(trade) {
    const ticker = trade.ticker || "the coin";
    const amount = tokenAmount(trade.amount);
    const steps = trade.rungs > 0 ? trade.rungs : 0;
    const stepText = steps
      ? ` It used ${steps} price ${steps === 1 ? "step that was" : "steps that were"} already waiting.`
      : " It finished in one Bitcoin transaction.";
    const verb = trade.side === "buy" ? "Bought" : trade.side === "sell" ? "Sold" : "Swapped";
    return { verb, amount, ticker, sats: trade.sats, stepText };
  }

  function tradeSentence(trade, rate) {
    const bit = tradeBits(trade);
    return `${bit.verb} ${bit.amount} ${bit.ticker} for ${moneyText(bit.sats, rate)}.${bit.stepText}`;
  }

  function tradeHtml(trade, rate) {
    const bit = tradeBits(trade);
    return `${esc(bit.verb)} ${esc(bit.amount)} ${esc(bit.ticker)} for ${moneyHtml(bit.sats, rate)}.${esc(bit.stepText)}`;
  }

  function detailBits(detail) {
    const legs = detail.legs || [];
    const ticker = (legs[0] && legs[0].ticker) || (detail.tickers && detail.tickers[0]) || "the coin";
    const side = legs[0] && legs[0].side;
    const amount = legs.reduce((sum, leg) => sum + (Number(leg.amount) || 0), 0);
    const paidSats = legs.reduce((sum, leg) => sum + (Number(leg.sats) || 0), 0);
    const verb = side === "sell" ? "Sold" : side === "buy" ? "Bought" : "Swapped";
    const stepText = legs.length
      ? ` The swap used ${legs.length} price ${legs.length === 1 ? "step" : "steps"} already waiting on Bitcoin.`
      : "";
    return { verb, amount: tokenAmount(amount), ticker, paidSats, stepText };
  }

  function detailSentence(detail, rate) {
    const bit = detailBits(detail);
    return `${bit.verb} ${bit.amount} ${bit.ticker} for ${moneyText(bit.paidSats, rate)}.${bit.stepText}`;
  }

  function detailHtml(detail, rate) {
    const bit = detailBits(detail);
    return `${esc(bit.verb)} ${esc(bit.amount)} ${esc(bit.ticker)} for ${moneyHtml(bit.paidSats, rate)}.${esc(bit.stepText)}`;
  }

  function coinLine(token) {
    const pct = num(token.progress_pct, 0);
    if (token.status === "minting") return `Still selling. ${pct}% sold.`;
    if (token.status === "graduated") return "Sold out. Trading is open.";
    if (token.status === "closed") return `Launch ended. ${pct}% sold. The rest was burned.`;
    return "CRC-20 coin on Bitcoin.";
  }

  function coinStory(token) {
    const tick = token.tick;
    const pct = num(token.progress_pct, 1);
    if (token.status === "minting") {
      const left = token.blocks_left ? ` About ${num(token.blocks_left, 0)} Bitcoin blocks are left in the sale.` : "";
      return `${tick} is still being sold on the launch. ${pct}% has been sold.${left}`;
    }
    if (token.status === "graduated") return `${tick} sold out on the launch. People can trade it now.`;
    if (token.status === "closed") {
      const burned = token.burned_unsold ? ` ${tokenAmount(token.burned_unsold)} unsold ${tick} was burned.` : "";
      return `${tick}'s launch has ended. ${pct}% was sold.${burned}`;
    }
    return `${tick} is a CRC-20 coin on Bitcoin.`;
  }

  function swapStory(pool, rate) {
    if (!pool || (pool.bids == null && pool.asks == null && pool.mid == null)) return "The swap book did not load.";
    const waiting = (Number(pool.bids) || 0) + (Number(pool.asks) || 0);
    if (!waiting) return "No one has posted a bitcoin price for this coin yet. A swap can happen after someone does.";
    const midUsd = usdFromSats(pool.mid, rate);
    const mid = pool.mid
      ? ` The closest prices meet near ${num(pool.mid, 2)} sats${midUsd != null ? ` (${usd(midUsd)})` : ""} per coin.`
      : "";
    return `People have posted ${num(pool.bids, 0)} buy prices and ${num(pool.asks, 0)} sell prices. A swap fills those prices and pays bitcoin in the same Bitcoin transaction.${mid}`;
  }

  function feeSentence(fees) {
    const split = (fees && fees.swap && fees.swap.split) || [];
    const bits = split.filter((part) => part.bps > 0).map((part) => {
      const pct = (part.bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
      const label = String(part.label || "").toLowerCase();
      if (label.includes("lp")) return `${pct}% to the person whose price was filled`;
      if (label.includes("protocol")) return `${pct}% to the protocol`;
      if (label.includes("reflect")) return `${pct}% to holder rewards in bitcoin`;
      if (label.includes("partner")) return `${pct}% to a partner`;
      return `${pct}% ${part.label}`;
    });
    if (!bits.length) return "";
    const label = (fees.swap && fees.swap.label) || "3%";
    return `A swap fee is ${label} when it is charged: ${bits.join(", ")}.`;
  }

  function readOpReturn(script) {
    if (!script || script.slice(0, 2) !== "6a") return null;
    let i = 2;
    const parts = [];
    while (i + 1 < script.length) {
      const op = Number.parseInt(script.slice(i, i + 2), 16);
      i += 2;
      if (Number.isNaN(op)) break;
      let size = 0;
      if (op >= 0x01 && op <= 0x4b) size = op;
      else if (op === 0x4c && i + 1 < script.length) {
        size = Number.parseInt(script.slice(i, i + 2), 16);
        i += 2;
      } else break;
      const hex = script.slice(i, i + size * 2);
      i += size * 2;
      if (hex.length !== size * 2) break;
      const bytes = new Uint8Array(size);
      for (let b = 0; b < size; b++) bytes[b] = Number.parseInt(hex.slice(b * 2, b * 2 + 2), 16);
      parts.push(bytes);
    }
    if (!parts.length) return null;
    const all = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
    let offset = 0;
    parts.forEach((part) => { all.set(part, offset); offset += part.length; });
    const raw = new TextDecoder().decode(all);
    try {
      const json = JSON.parse(raw);
      if (json.p !== "crc-20") return { ok: false, raw };
      let amount = null;
      if (json.amt != null) {
        const atoms = BigInt(json.amt);
        const whole = atoms / 100000000n;
        const frac = (atoms % 100000000n).toString().padStart(8, "0").replace(/0+$/, "");
        amount = frac ? `${whole}.${frac}` : whole.toString();
      }
      return { ok: true, op: json.op || "unknown", tick: json.tick, amount, raw };
    } catch {
      return { ok: false, raw };
    }
  }

  function markerSentence(marker) {
    if (!marker.ok) return "This transaction carries a note, and it is not a CRC-20 instruction this page can read.";
    const tick = marker.tick || "a coin";
    if (marker.op === "transfer" && marker.amount != null) return `The note stored on Bitcoin says: move ${tokenAmount(marker.amount)} ${tick}.`;
    if (marker.op === "mint") return `The note stored on Bitcoin says: mint ${tick}.`;
    if (marker.op === "deploy") return `The note stored on Bitcoin says: create the coin ${tick}.`;
    return `The note stored on Bitcoin is a CRC-20 ${marker.op} for ${tick}.`;
  }

  function pickColor(data) {
    const bins = [];
    for (let i = 0; i < 36; i++) bins.push({ w: 0, r: 0, g: 0, b: 0 });
    for (let i = 0; i < data.length; i += 4) {
      const R = data[i];
      const G = data[i + 1];
      const B = data[i + 2];
      const A = data[i + 3];
      if (A < 200) continue;
      const max = Math.max(R, G, B);
      const min = Math.min(R, G, B);
      const d = max - min;
      if (max < 40 || d < 28) continue;
      let h = 0;
      if (max === R) h = ((G - B) / d) % 6;
      else if (max === G) h = (B - R) / d + 2;
      else h = (R - G) / d + 4;
      if (h < 0) h += 6;
      const bin = Math.min(35, Math.floor((h * 60) / 10));
      const slot = bins[bin];
      slot.w += d;
      slot.r += R * d;
      slot.g += G * d;
      slot.b += B * d;
    }
    let best = null;
    bins.forEach((slot) => { if (!best || slot.w > best.w) best = slot; });
    if (!best || !best.w) return BONS_ORANGE;
    const toHex = (n) => Math.round(n).toString(16).padStart(2, "0");
    return `#${toHex(best.r / best.w)}${toHex(best.g / best.w)}${toHex(best.b / best.w)}`;
  }

  function decide(query, ticks) {
    const q = String(query || "").trim();
    if (!q) return { page: "home" };
    if (/^[0-9a-fA-F]{64}$/.test(q)) return { page: "tx", txid: q.toLowerCase() };
    if (/^bc1[a-z0-9]{20,90}$/i.test(q)) return { page: "address", address: q };
    const upper = q.toUpperCase();
    const known = {};
    (ticks || []).forEach((tick) => { known[tick] = true; });
    known.BONS = true;
    if (known[upper]) return { page: "token", tick: upper };
    const hits = (ticks || []).filter((tick) => tick.includes(upper));
    if (hits.length === 1) return { page: "token", tick: hits[0] };
    return { page: "find", q: upper, hits };
  }

  function routeHash(hash) {
    const clean = String(hash || "").replace(/^#/, "");
    const parts = clean.split("/").filter(Boolean);
    if (parts[0] === "token" && parts[1]) return { page: "token", tick: decodeURIComponent(parts[1]).toUpperCase() };
    if (parts[0] === "tx" && parts[1]) return { page: "tx", txid: decodeURIComponent(parts[1]).toLowerCase() };
    if (parts[0] === "address" && parts[1]) return { page: "address", address: decodeURIComponent(parts[1]) };
    if (parts[0] === "find") return { page: "find", q: decodeURIComponent(parts.slice(1).join("/")).toUpperCase() };
    return { page: "home" };
  }

  const Look = {
    esc, tokenAmount, num, btcFromSats, sats, usd, usdFromSats, moneyText, shortId, when,
    tradeSentence, detailSentence, coinLine, coinStory, swapStory, feeSentence,
    readOpReturn, markerSentence, pickColor, decide, routeHash, BONS_ORANGE,
  };
  root.Look = Look;

  if (!root.document) return;

  const app = document.getElementById("app");
  const form = document.getElementById("find");
  const input = document.getElementById("q");
  const colors = { BONS: BONS_ORANGE };
  let coinCache = null;
  let rateNow = null;

  function rememberRate(stats) {
    const n = Number(stats && stats.btc_usd);
    if (Number.isFinite(n) && n > 0) rateNow = n;
  }

  function unwrap(json) {
    if (json && typeof json === "object" && json.ok === true && "data" in json) return json.data;
    return json;
  }

  async function api(params) {
    const url = new URL("/api/crc", location.origin);
    Object.keys(params).forEach((key) => url.searchParams.set(key, params[key]));
    const res = await fetch(url);
    if (!res.ok) throw new Error("bad");
    return unwrap(await res.json());
  }

  async function coins() {
    if (coinCache) return coinCache;
    const data = await api({ p: "launch" });
    coinCache = (data && data.tokens) || [];
    return coinCache;
  }

  function colorOf(tick) {
    return colors[tick] || BONS_ORANGE;
  }

  function picture(tick, size) {
    const px = size || 44;
    return `<img class="pic" data-tick="${esc(tick)}" src="/api/crc?p=image&tick=${esc(tick)}" alt="" width="${px}" height="${px}">`;
  }

  function mark(tick) {
    return `<span class="mark" aria-hidden="true">${esc(tick.slice(0, 1))}</span>`;
  }

  function swapRow(trade, rate) {
    const pill = trade.side === "sell" ? "sell" : "buy";
    const label = trade.side === "sell" ? "Sell" : trade.side === "buy" ? "Buy" : "Swap";
    return `<a class="swap" data-tickrow="${esc(trade.ticker || "BONS")}" style="--coin:${esc(colorOf(trade.ticker || "BONS"))}" href="#/tx/${esc(trade.txid)}">
      <b>${tradeHtml(trade, rate)}</b>
      <div class="meta">
        <span class="pill ${pill}">${label}</span>
        <span>${esc(trade.ticker || "")}</span>
        <span>${esc(when(trade.at))}</span>
        ${trade.sats_per_token ? `<span>${eachHtml(trade.sats_per_token, rate)} each</span>` : ""}
        <span class="mono">${esc(shortId(trade.txid, 8, 6))}</span>
      </div>
    </a>`;
  }

  function coinRow(token) {
    const tick = token.tick;
    const price = usd(token.market_price_usd || token.price_usd);
    return `<a class="row" data-color data-tickrow="${esc(tick)}" style="--coin:${esc(colorOf(tick))}" href="#/token/${esc(tick)}">
      ${token.image_url ? picture(tick) : mark(tick)}
      <div><span class="tick">${esc(tick)}</span><p>${esc(coinLine(token))}</p></div>
      <div class="side">${esc(price)}<small>${token.holders_count != null ? esc(num(token.holders_count, 0)) + " holders" : ""}</small></div>
    </a>`;
  }

  function homeHtml(state, filter, rate) {
    const stats = state.stats || {};
    const pool = state.pool || {};
    const tokens = state.tokens || [];
    const trades = (state.trades && state.trades.trades) || [];
    const q = (filter || "").toUpperCase();
    const shown = tokens
      .filter((token) => token.tick !== "BONS")
      .filter((token) => !q || token.tick.includes(q))
      .sort((a, b) => (Number(b.market_cap_usd) || 0) - (Number(a.market_cap_usd) || 0));
    const fee = feeSentence(state.fees);
    const height = stats.indexer && stats.indexer.height;
    const bons = {
      tick: "BONS",
      status: "live",
      market_price_usd: stats.price_per_token_usd,
      holders_count: null,
    };
    const showBons = !q || "BONS".includes(q);
    return `
      <h1>${q ? "Coins matching " + esc(q) : "Look up a coin on Bitcoin."}</h1>
      <p class="lede">Search a coin name, a transaction, or a wallet. A swap pays real bitcoin and finishes in one Bitcoin transaction.</p>
      ${state.error ? `<p class="warn">The BONS service did not answer. Reload in a moment.</p>` : ""}
      <div class="stats">
        <div class="stat"><span class="k">BONS price</span><span class="v">${esc(usd(stats.price_per_token_usd))}</span></div>
        <div class="stat"><span class="k">Bitcoin block</span><span class="v">${height ? esc(num(height, 0)) : "—"}</span></div>
        <div class="stat"><span class="k">Coins launched</span><span class="v">${esc(String(tokens.length || "—"))}</span></div>
        <div class="stat"><span class="k">BONS swaps, 24h</span><span class="v">${esc(num(pool.fills_24h, 0))}</span></div>
      </div>
      <p class="note">${esc(swapStory(pool, rate))}${fee ? " " + esc(fee) : ""}${pool.fees_24h_sats ? " Fees recorded in the last day: " + esc(moneyText(pool.fees_24h_sats, rate)) + "." : ""}</p>
      <h2>Latest swaps</h2>
      <div class="list">${trades.length ? trades.slice(0, 12).map((trade) => swapRow(trade, rate)).join("") : `<p class="note">No swaps came back.</p>`}</div>
      <h2>Coins</h2>
      <div class="list">
        ${showBons ? `<a class="row" data-tickrow="BONS" style="--coin:${BONS_ORANGE}" href="#/token/BONS">${mark("BONS")}<div><span class="tick" style="color:${BONS_ORANGE}">BONS</span><p>The bitcoin swap. A trade fills prices that are already posted.</p></div><div class="side">${esc(usd(bons.market_price_usd))}<small>${stats.market_cap_usd ? esc(usd(stats.market_cap_usd)) + " market" : ""}</small></div></a>` : ""}
        ${shown.map(coinRow).join("")}
        ${q && !showBons && !shown.length ? `<p class="note">No launched coin matches ${esc(q)}.</p>` : ""}
      </div>`;
  }

  function tokenHtml(tick, token, pool, trades, stats, rate) {
    const recent = (trades && trades.trades) || [];
    const own = tick === "BONS" ? stats : null;
    const price = usd((own && own.price_per_token_usd) || (token && (token.market_price_usd || token.price_usd)));
    const cap = usd((own && own.market_cap_usd) || (token && token.market_cap_usd));
    const story = tick === "BONS"
      ? "BONS swaps directly for bitcoin. People post a price first. A trade fills those prices in one Bitcoin transaction."
      : token
        ? coinStory(token)
        : `${tick} is not in the launch list right now.`;
    const bonsLink = tick === "BONS" ? "https://bonsonbtc.fun/swap" : `https://bonsonbtc.fun/launch?t=${encodeURIComponent(tick)}`;
    return `
      <div class="hero" data-tickrow="${esc(tick)}" style="--coin:${esc(colorOf(tick))}">
        <div class="head">
          ${tick === "BONS" ? mark("BONS") : picture(tick, 72)}
          <div><h1 style="color:${esc(colorOf(tick))}">${esc(tick)}</h1><p class="note">CRC-20 on Bitcoin</p></div>
        </div>
        <p>${esc(story)}</p>
      </div>
      <p class="note">${esc(swapStory(pool, rate))}</p>
      <div class="stats">
        <div class="stat"><span class="k">Price</span><span class="v">${esc(price)}</span></div>
        <div class="stat"><span class="k">Market cap</span><span class="v">${esc(cap)}</span></div>
        <div class="stat"><span class="k">Holders</span><span class="v">${token && token.holders_count != null ? esc(num(token.holders_count, 0)) : "—"}</span></div>
        <div class="stat"><span class="k">Bitcoin posted</span><span class="v">${moneyHtml(pool && pool.quote_in_pool_sats, rate)}</span></div>
      </div>
      <h2>Recent swaps</h2>
      <div class="list">${recent.length ? recent.map((trade) => swapRow(trade, rate)).join("") : `<p class="note">No swap has filled for ${esc(tick)} yet.</p>`}</div>
      <a class="btn" href="${esc(bonsLink)}">See ${esc(tick)} on BONS</a>`;
  }

  function txHtml(txid, detail, raw, listed, rate) {
    const script = raw && raw.vout && (raw.vout.find((out) => out.scriptpubkey_type === "op_return") || {}).scriptpubkey;
    const marker = script ? readOpReturn(script) : null;
    const sentence = detail ? detailHtml(detail, rate) : listed ? tradeHtml(listed, rate) : "";
    const confirmed = detail && detail.chain ? detail.chain.confirmed : raw && raw.status && raw.status.confirmed;
    const height = (detail && detail.chain && detail.chain.height) || (raw && raw.status && raw.status.block_height);
    const fee = (detail && detail.chain && detail.chain.fee_sats) || (raw && raw.fee);
    const protocol = (detail && detail.fees && detail.fees.protocol_sats) || 0;
    const lp = (detail && detail.fees && detail.fees.lp_pool_sats) || 0;
    const legs = (detail && detail.legs) || [];
    const tick = (legs[0] && legs[0].ticker) || (listed && listed.ticker) || "BONS";
    return `
      <p class="note">Bitcoin transaction</p>
      <h1 class="mono">${esc(shortId(txid, 10, 8))}</h1>
      ${sentence ? `<div class="hero" data-tickrow="${esc(tick)}" style="--coin:${esc(colorOf(tick))}"><p>${sentence}</p></div>` : ""}
      ${!detail && !raw ? `<p class="warn">This transaction did not load.</p>` : ""}
      ${!detail && raw ? `<p class="warn">Bitcoin has this transaction. The swap list has no fill for it, so the reading below is only the note stored in the transaction.</p>` : ""}
      <div class="meta">
        ${detail && detail.status ? `<span class="pill buy">${esc(detail.status)}</span>` : ""}
        ${confirmed === true ? `<span class="pill buy">Confirmed</span>` : ""}
        ${confirmed === false ? `<span class="pill sell">Waiting</span>` : ""}
        ${height ? `<span>Block ${esc(Number(height).toLocaleString("en-US"))}</span>` : ""}
        ${fee != null ? `<span>Miner fee ${moneyHtml(fee, rate)}</span>` : ""}
        ${detail && detail.at ? `<span>${esc(when(detail.at))}</span>` : listed && listed.at ? `<span>${esc(when(listed.at))}</span>` : ""}
      </div>
      ${detail && detail.taker ? `<p>The wallet that made the swap is <a href="#/address/${esc(detail.taker)}">${esc(shortId(detail.taker, 10, 6))}</a>.</p>` : ""}
      ${marker ? `<p>${esc(markerSentence(marker))}</p>` : ""}
      ${detail ? `<p class="note">The note records how many coins moved. The swap record is what says this was paid in bitcoin.</p>` : ""}
      ${protocol + lp > 0 ? `<p>Recorded fees on this fill: ${moneyHtml(lp, rate)} to the price poster and ${moneyHtml(protocol, rate)} to the protocol.</p>` : ""}
      ${legs.length ? `<h2>Price steps filled</h2><table><thead><tr><th>Who posted it</th><th>Coin</th><th>Paid</th><th>Price</th></tr></thead><tbody>${legs.map((leg) => `<tr>
        <td>${leg.maker ? `<a href="#/address/${esc(leg.maker)}">${esc(shortId(leg.maker, 8, 4))}</a>` : "—"}</td>
        <td>${esc(tokenAmount(leg.amount))} ${esc(leg.ticker || "")}</td>
        <td>${moneyHtml(leg.sats, rate)}</td>
        <td>${leg.sats_per_token ? eachHtml(leg.sats_per_token, rate) : "—"}</td>
      </tr>`).join("")}</tbody></table>` : ""}
      <a class="btn" href="https://mempool.space/tx/${esc(txid)}">Open on mempool.space</a>
      <p class="note mono">${esc(txid)}</p>`;
  }

  function whereCoin(seal) {
    if (seal.in_pool) return "Posted in the swap";
    if (seal.listed) return "Listed for sale";
    return "Free to send";
  }

  function addressHtml(address, portfolio, trades, rate) {
    const tokens = ((portfolio && portfolio.tokens) || []).filter((token) => Number(token.balance || 0) > 0);
    const seals = (portfolio && portfolio.seals) || [];
    const mine = ((trades && trades.trades) || []).filter((trade) => trade.taker && trade.taker.toLowerCase() === address.toLowerCase());
    return `
      <p class="note">Wallet</p>
      <h1 class="mono">${esc(shortId(address, 12, 6))}</h1>
      <p class="mono">${esc(address)}</p>
      ${!portfolio ? `<p class="warn">No balance came back for this address.</p>` : `
        <div class="stats">
          <div class="stat"><span class="k">Bitcoin</span><span class="v">${walletHtml(portfolio, rate)}</span></div>
          <div class="stat"><span class="k">Coins held</span><span class="v">${tokens.length}</span></div>
          <div class="stat"><span class="k">Pieces</span><span class="v">${seals.length}</span></div>
        </div>
        ${portfolio.covenant_address ? `<p class="note">Receive coins at the wallet address above. A second address, ${esc(shortId(portfolio.covenant_address, 10, 6))}, is where those coins are stored. Coins sent to that second address can get stuck.</p>` : ""}
      `}
      <h2>Balances</h2>
      ${tokens.length ? `<table><thead><tr><th>Coin</th><th>Available</th><th>In the swap</th></tr></thead><tbody>${tokens.map((token) => `<tr>
        <td><a href="#/token/${esc(token.tick)}">${esc(token.tick)}</a></td>
        <td>${esc(tokenAmount(token.available || token.balance))}</td>
        <td>${esc(tokenAmount(token.in_pool))}</td>
      </tr>`).join("")}</tbody></table>` : `<p class="note">No CRC-20 balance came back for this wallet.</p>`}
      ${seals.length ? `<h2>Pieces of each coin</h2><p class="note">Each receive is its own small piece. A send spends those pieces.</p><table><thead><tr><th>Coin</th><th>Amount</th><th>Where it sits</th></tr></thead><tbody>${seals.map((seal) => `<tr><td>${esc(seal.tick)}</td><td>${esc(tokenAmount(seal.amount))}</td><td>${esc(whereCoin(seal))}</td></tr>`).join("")}</tbody></table>` : ""}
      <h2>Swaps this wallet made</h2>
      <p class="note">These are swaps this wallet started, among the latest 100. A price this wallet only posted shows up on the other side of someone else's swap.</p>
      <div class="list">${mine.length ? mine.map((trade) => swapRow(trade, rate)).join("") : `<p class="note">None of the latest 100 swaps were started here.</p>`}</div>
      <a class="btn" href="https://mempool.space/address/${esc(address)}">Open on mempool.space</a>`;
  }

  function tint() {
    app.querySelectorAll("img[data-tick]").forEach((img) => {
      const apply = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 24;
          canvas.height = 24;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, 24, 24);
          const color = pickColor(ctx.getImageData(0, 0, 24, 24).data);
          colors[img.getAttribute("data-tick")] = color;
          app.querySelectorAll(`[data-tickrow="${img.getAttribute("data-tick")}"]`).forEach((row) => {
            row.style.setProperty("--coin", color);
            const name = row.querySelector(".tick, h1");
            if (name) name.style.color = color;
          });
        } catch {
          /* a picture that cannot be read keeps the orange fallback */
        }
      };
      if (img.complete && img.naturalWidth) apply();
      else {
        img.addEventListener("load", apply, { once: true });
        img.addEventListener("error", () => {
          const markEl = document.createElement("span");
          markEl.className = "mark";
          markEl.textContent = (img.getAttribute("data-tick") || "?").slice(0, 1);
          img.replaceWith(markEl);
        }, { once: true });
      }
    });
  }

  async function draw() {
    const route = routeHash(location.hash);
    app.innerHTML = `<p class="note">Loading…</p>`;
    try {
      if (route.page === "token") {
        const tick = route.tick;
        const [list, pool, trades, stats] = await Promise.all([
          coins().catch(() => []),
          api({ p: "pool", tick }).catch(() => null),
          api({ p: "trades", tick, limit: "20" }).catch(() => ({ trades: [] })),
          api({ p: "stats" }).catch(() => null),
        ]);
        rememberRate(stats);
        const token = (list || []).find((item) => item.tick === tick) || null;
        app.innerHTML = tokenHtml(tick, token, pool, trades, stats, rateNow);
      } else if (route.page === "tx") {
        const txid = route.txid;
        const [detail, raw, list, stats] = await Promise.all([
          api({ p: "trade", txid }).catch(() => null),
          api({ p: "tx", txid }).catch(() => null),
          api({ p: "trades", limit: "80" }).catch(() => ({ trades: [] })),
          api({ p: "stats" }).catch(() => null),
        ]);
        rememberRate(stats);
        const listed = ((list && list.trades) || []).find((trade) => trade.txid === txid) || null;
        app.innerHTML = txHtml(txid, detail, raw, listed, rateNow);
      } else if (route.page === "address") {
        const [portfolio, feed, stats] = await Promise.all([
          api({ p: "wallet", address: route.address }).catch(() => null),
          api({ p: "trades", limit: "100" }).catch(() => ({ trades: [] })),
          api({ p: "stats" }).catch(() => null),
        ]);
        rememberRate(stats);
        app.innerHTML = addressHtml(route.address, portfolio, feed, rateNow);
      } else {
        const [stats, pool, feed, fees, tokens] = await Promise.all([
          api({ p: "stats" }).catch(() => null),
          api({ p: "pool", tick: "BONS" }).catch(() => null),
          api({ p: "trades", limit: "12" }).catch(() => ({ trades: [] })),
          api({ p: "fees" }).catch(() => null),
          coins().catch(() => []),
        ]);
        rememberRate(stats);
        const failed = !stats && !tokens.length;
        app.innerHTML = homeHtml({ stats, pool, trades: feed, fees, tokens, error: failed }, route.page === "find" ? route.q : "", rateNow);
      }
    } catch {
      app.innerHTML = `<p class="warn">The BONS service did not answer. Reload in a moment.</p>`;
    }
    tint();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = input.value;
    let ticks = [];
    try { ticks = (await coins()).map((token) => token.tick); } catch { ticks = []; }
    const next = decide(query, ticks);
    const before = location.hash;
    let after = "#/";
    if (next.page === "tx") after = "#/tx/" + next.txid;
    else if (next.page === "address") after = "#/address/" + encodeURIComponent(next.address);
    else if (next.page === "token") after = "#/token/" + next.tick;
    else if (next.page === "find") after = "#/find/" + encodeURIComponent(next.q || "");
    if (after === before) draw();
    else location.hash = after;
  });

  window.addEventListener("hashchange", draw);
  draw();
})(typeof globalThis !== "undefined" ? globalThis : this);
