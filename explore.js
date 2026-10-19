(function (root) {
  const BONS_ORANGE = "#F7931A";
  const ORNG_ORANGE = "#E8590C";
  const LEAF_GREEN = "#2f7d32";
  const AXBT_COLOR = "#8d6a3a";

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

  function fromAtoms(value) {
    let n;
    try {
      n = BigInt(String(value == null ? "0" : value).replace(/[^0-9-]/g, "") || "0");
    } catch {
      return "—";
    }
    const neg = n < 0n ? "-" : "";
    const abs = n < 0n ? -n : n;
    const whole = abs / 100000000n;
    const frac = abs % 100000000n;
    const shown = Number(whole);
    if (!Number.isFinite(shown)) return "—";
    const base = neg + shown.toLocaleString("en-US");
    const fracText = frac.toString().padStart(8, "0");
    const keep = whole >= 1n ? 2 : abs < 10000n ? 8 : 4;
    let cut = fracText.slice(0, keep).replace(/0+$/, "");
    if (!cut && /[1-9]/.test(fracText)) {
      const first = fracText.search(/[1-9]/);
      cut = fracText.slice(0, first + 1);
    }
    if (!cut) return base;
    return `${base}.${cut}`;
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
    const stepText = steps > 1 ? ` Across ${steps} prices.` : "";
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
    const stepText = legs.length > 1 ? ` Across ${legs.length} prices.` : "";
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
    if (!pool || (pool.bids == null && pool.asks == null && pool.mid == null)) return "Prices did not load.";
    const waiting = (Number(pool.bids) || 0) + (Number(pool.asks) || 0);
    if (!waiting) return "No bitcoin price is posted yet.";
    const midUsd = usdFromSats(pool.mid, rate);
    const mid = pool.mid
      ? ` Near ${num(pool.mid, 2)} sats${midUsd != null ? ` (${usd(midUsd)})` : ""} each.`
      : "";
    return `${num(pool.bids, 0)} buy prices and ${num(pool.asks, 0)} sell prices.${mid}`;
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
    if (!marker.ok) return "No coin move showed up in this transaction.";
    const tick = marker.tick || "a coin";
    if (marker.op === "transfer" && marker.amount != null) return `Moved ${tokenAmount(marker.amount)} ${tick}.`;
    if (marker.op === "mint") return `Minted ${tick}.`;
    if (marker.op === "deploy") return `Created ${tick}.`;
    return `${tick}: ${marker.op}.`;
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
    if (upper === "LEAF" || upper === "AXBT") return { page: "coin", tick: upper };
    const known = {};
    (ticks || []).forEach((tick) => { known[tick] = true; });
    known.BONS = true;
    if (known[upper]) return { page: "token", tick: upper };
    const hits = (ticks || []).filter((tick) => tick.includes(upper));
    if (hits.length === 1 && (hits[0] === "LEAF" || hits[0] === "AXBT")) return { page: "coin", tick: hits[0] };
    if (hits.length === 1) return { page: "token", tick: hits[0] };
    return { page: "find", q: upper, hits };
  }

  function routeHash(hash) {
    const clean = String(hash || "").replace(/^#/, "");
    const parts = clean.split("/").filter(Boolean);
    if (parts[0] === "coin" && parts[1]) return { page: "coin", tick: decodeURIComponent(parts[1]).toUpperCase() };
    if (parts[0] === "token" && parts[1]) return { page: "token", tick: decodeURIComponent(parts[1]).toUpperCase() };
    if (parts[0] === "tx" && parts[1]) return { page: "tx", txid: decodeURIComponent(parts[1]).toLowerCase() };
    if (parts[0] === "address" && parts[1]) return { page: "address", address: decodeURIComponent(parts[1]) };
    if (parts[0] === "find") return { page: "find", q: decodeURIComponent(parts.slice(1).join("/")).toUpperCase() };
    if (parts[0] === "bons") return { page: "bons" };
    return { page: "crc" };
  }

  const Look = {
    esc, tokenAmount, num, btcFromSats, sats, usd, usdFromSats, moneyText, shortId, when,
    tradeSentence, detailSentence, coinLine, coinStory, swapStory, feeSentence, fromAtoms,
    readOpReturn, markerSentence, pickColor, decide, routeHash, BONS_ORANGE,
  };
  root.Look = Look;

  if (!root.document) return;

  const app = document.getElementById("app");
  const form = document.getElementById("find");
  const input = document.getElementById("q");
  const colors = { BONS: BONS_ORANGE, ORNG: ORNG_ORANGE, LEAF: LEAF_GREEN, AXBT: AXBT_COLOR };
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
    const bit = tradeBits(trade);
    return `<a class="swap" data-tickrow="${esc(trade.ticker || "BONS")}" style="--coin:${esc(colorOf(trade.ticker || "BONS"))}" href="#/tx/${esc(trade.txid)}">
      <b>${esc(bit.verb)} ${esc(bit.amount)} ${esc(bit.ticker)}</b>
      <div class="meta">
        <span>${moneyHtml(bit.sats, rate)}</span>
        <span>${esc(when(trade.at))}</span>
        <span class="open">Open</span>
      </div>
    </a>`;
  }

  function coinRow(token) {
    const tick = token.tick;
    const price = usd(token.market_price_usd || token.price_usd);
    const pinned = colors[tick] ? ` style="color:${esc(colors[tick])}"` : "";
    return `<a class="row" data-color data-tickrow="${esc(tick)}" style="--coin:${esc(colorOf(tick))}" href="#/token/${esc(tick)}">
      ${tick === "ORNG" && token.image_url ? picture(tick, 32) : token.image_url ? picture(tick) : mark(tick)}
      <div><span class="tick"${pinned}>${esc(tick)}</span><p>${esc(tick === "LEAF" ? "Launched on BONS. Not the original LEAF." : coinLine(token))}</p></div>
      <div class="side">${esc(price)}<small>${token.holders_count != null ? esc(num(token.holders_count, 0)) + " holders" : ""}</small></div>
    </a>`;
  }

  function homeHtml(state, rate) {
    const stats = state.stats || {};
    const pool = state.pool || {};
    const trades = (state.trades && state.trades.trades) || [];
    const tokens = (state.tokens || [])
      .filter((token) => token.tick !== "BONS")
      .sort((a, b) => (Number(b.market_cap_usd) || 0) - (Number(a.market_cap_usd) || 0));
    const height = stats.indexer && stats.indexer.height;
    return `
      <h1>BONS</h1>
      <p class="lede">Swap BONS for bitcoin.</p>
      ${state.error ? `<p class="warn">BONS did not answer. Try again in a moment.</p>` : ""}
      <div class="stats">
        <div class="stat"><span class="k">Price</span><span class="v">${esc(usd(stats.price_per_token_usd))}</span></div>
        <div class="stat"><span class="k">Bitcoin block</span><span class="v">${height ? esc(num(height, 0)) : "—"}</span></div>
        <div class="stat"><span class="k">Swaps, 24h</span><span class="v">${esc(num(pool.fills_24h, 0))}</span></div>
        <div class="stat"><span class="k">Fees, 24h</span><span class="v">${pool.fees_24h_sats ? moneyHtml(pool.fees_24h_sats, rate) : "—"}</span></div>
      </div>
      <h2>Latest swaps</h2>
      <div class="list">${trades.length ? trades.slice(0, 6).map((trade) => swapRow(trade, rate)).join("") : `<p class="note">No swaps came back.</p>`}</div>
      <h2>Launched on BONS</h2>
      <div class="list">${tokens.length ? tokens.map(coinRow).join("") : `<p class="note">No launches came back.</p>`}</div>`;
  }

  function gardenColor(tick) {
    if (tick === "LEAF") return LEAF_GREEN;
    if (tick === "AXBT") return AXBT_COLOR;
    if (tick === "ORNG") return ORNG_ORANGE;
    if (tick === "BONS") return BONS_ORANGE;
    return BONS_ORANGE;
  }

  function satPrice(unitSat, rate) {
    const dollars = usdFromSats(unitSat, rate);
    if (dollars == null) return unitSat != null ? `${num(unitSat, 2)} sats` : "—";
    return usd(dollars);
  }

  function moveLine(item) {
    if (!item) return "";
    if (item.type === "swap" && item.swap) {
      const verb = item.swap.side === "sell" ? "Sold" : "Bought";
      const paid = fromAtoms(item.swap.input_atoms);
      const got = fromAtoms(item.swap.output_atoms);
      return `${verb} ${paid} ${item.swap.input_tick || ""} for ${got} ${item.swap.output_tick || ""}.`.replace(/\s+\./, ".").replace(/\s{2,}/g, " ");
    }
    const tick = item.tick || "";
    const amt = fromAtoms(item.amount);
    if (item.template === "market") return `Sold ${amt} ${tick}.`;
    if (item.type === "transfer") return `Sent ${amt} ${tick}.`;
    if (item.type === "mint") return `Minted ${amt} ${tick}.`;
    return "";
  }

  function moveRow(item) {
    const line = moveLine(item);
    if (!line) return "";
    const tick = item.tick || "";
    return `<a class="swap" data-tickrow="${esc(tick)}" style="--coin:${esc(gardenColor(tick))}" href="#/tx/${esc(item.txid)}">
      <b>${esc(line)}</b>
      <div class="meta"><span>${esc(when(item.block_time))}</span><span class="open">Open</span></div>
    </a>`;
  }

  function mainCoin(tick, blurb, price, sub, href) {
    const color = gardenColor(tick);
    return `<a class="row" data-tickrow="${esc(tick)}" style="--coin:${color}" href="${href}">
      ${mark(tick)}
      <div><span class="tick" style="color:${color}">${esc(tick)}</span>${blurb ? `<p>${esc(blurb)}</p>` : ""}</div>
      <div class="side">${esc(price)}<small>${esc(sub)}</small></div>
    </a>`;
  }

  function crcHtml(state, filter) {
    const stats = state.stats || {};
    const tokens = state.tokens || [];
    const leaf = state.leaf || {};
    const axbt = state.axbt || {};
    const q = (filter || "").toUpperCase();
    const rate = state.rate;
    const leafPrice = satPrice(leaf.market && leaf.market.last_unit_price_sat, rate);
    const shown = tokens
      .filter((token) => token.tick !== "BONS")
      .filter((token) => !q || token.tick.includes(q))
      .sort((a, b) => (Number(b.market_cap_usd) || 0) - (Number(a.market_cap_usd) || 0));
    const leafHolders = leaf.token && leaf.token.holders != null ? `${num(leaf.token.holders, 0)} holders` : "";
    const axbtHolders = axbt.token && axbt.token.holders != null ? `${num(axbt.token.holders, 0)} holders` : "";
    const mains = [
      ["LEAF", "", leafPrice, leafHolders],
      ["AXBT", "", "—", axbtHolders],
      ["BONS", "Swap for bitcoin.", usd(stats.price_per_token_usd), ""],
    ].filter((row) => !q || row[0].includes(q));
    const moves = q ? [] : ((state.history && state.history.items) || []).map(moveRow).filter(Boolean).slice(0, 5);
    const launches = q ? shown : [];
    return `
      <h1>${q ? "Matching " + esc(q) : "CRC-20"}</h1>
      ${state.error ? `<p class="warn">Some of this list did not load. Try again in a moment.</p>` : ""}
      <div class="list">
        ${mains.map((row) => mainCoin(row[0], row[1], row[2], row[3], row[0] === "BONS" ? "#/bons" : `#/coin/${row[0]}`)).join("")}
      </div>
      ${moves.length ? `<h2>Latest</h2><div class="list">${moves.join("")}</div>` : ""}
      ${launches.length ? `<h2>Launched on BONS</h2><div class="list">${launches.map(coinRow).join("")}</div>` : ""}
      ${q && !mains.length && !launches.length ? `<p class="note">Nothing matches ${esc(q)}.</p>` : ""}`;
  }

  function coinHtml(tick, info, items, rate) {
    if (tick !== "LEAF" && tick !== "AXBT") {
      return `<h1>${esc(tick)}</h1><p class="note">That coin is on the BONS tab.</p>`;
    }
    const token = (info && info.token) || {};
    const price = tick === "LEAF" ? satPrice(info && info.market && info.market.last_unit_price_sat, rate) : "—";
    const supply = token.supply ? fromAtoms(token.supply) : "—";
    const holders = token.holders != null ? num(token.holders, 0) : "—";
    const rows = (items || []).map(moveRow).filter(Boolean).slice(0, 5);
    return `
      <div class="hero" data-tickrow="${esc(tick)}" style="--coin:${gardenColor(tick)}">
        <div class="head">${mark(tick)}<div><h1 style="color:${gardenColor(tick)}">${esc(tick)}</h1><p class="note">CRC-20</p></div></div>
      </div>
      <div class="stats">
        <div class="stat"><span class="k">Price</span><span class="v">${esc(price)}</span></div>
        <div class="stat"><span class="k">Supply</span><span class="v">${esc(supply)}</span></div>
        <div class="stat"><span class="k">Holders</span><span class="v">${esc(holders)}</span></div>
      </div>
      <h2>Latest</h2>
      <div class="list">${rows.length ? rows.join("") : `<p class="note">No recent moves loaded.</p>`}</div>`;
  }

  function tokenHtml(tick, token, pool, trades, stats, rate) {
    const recent = (trades && trades.trades) || [];
    const own = tick === "BONS" ? stats : null;
    const price = usd((own && own.price_per_token_usd) || (token && (token.market_price_usd || token.price_usd)));
    const cap = usd((own && own.market_cap_usd) || (token && token.market_cap_usd));
    const story = tick === "BONS"
      ? "Swap it for bitcoin. Prices are posted first, then a trade fills them."
      : tick === "LEAF"
        ? "Launched on BONS. The LEAF on the CRC-20 tab is a different coin."
        : token
          ? coinStory(token)
          : `${tick} is not in the launch list.`;
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
        <div class="stat"><span class="k">Bitcoin in the swap</span><span class="v">${moneyHtml(pool && pool.quote_in_pool_sats, rate)}</span></div>
      </div>
      <h2>Recent swaps</h2>
      <div class="list">${recent.length ? recent.map((trade) => swapRow(trade, rate)).join("") : `<p class="note">No swap has filled for ${esc(tick)} yet.</p>`}</div>
      <a class="btn" href="${esc(bonsLink)}">See ${esc(tick)} on BONS</a>`;
  }

  function txHtml(txid, detail, raw, listed, rate, gardenOps) {
    const script = raw && raw.vout && (raw.vout.find((out) => out.scriptpubkey_type === "op_return") || {}).scriptpubkey;
    const marker = script ? readOpReturn(script) : null;
    const gardenLines = (gardenOps || []).map(moveLine).filter(Boolean);
    const sentence = detail ? detailHtml(detail, rate) : listed ? tradeHtml(listed, rate) : gardenLines.join(" ");
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
      ${!detail && !listed && !(gardenOps && gardenOps.length) && raw ? `<p class="note">No coin move showed up in this transaction.</p>` : ""}
      <div class="meta">
        ${detail && detail.status ? `<span class="pill buy">${esc(detail.status)}</span>` : ""}
        ${confirmed === true ? `<span class="pill buy">Confirmed</span>` : ""}
        ${confirmed === false ? `<span class="pill sell">Waiting</span>` : ""}
        ${height ? `<span>Block ${esc(Number(height).toLocaleString("en-US"))}</span>` : ""}
        ${fee != null ? `<span>Miner fee ${moneyHtml(fee, rate)}</span>` : ""}
        ${detail && detail.at ? `<span>${esc(when(detail.at))}</span>` : listed && listed.at ? `<span>${esc(when(listed.at))}</span>` : ""}
      </div>
      ${detail && detail.taker ? `<p>From <a href="#/address/${esc(detail.taker)}">${esc(shortId(detail.taker, 10, 6))}</a>.</p>` : ""}
      ${!sentence && marker ? `<p>${esc(markerSentence(marker))}</p>` : ""}
      ${protocol + lp > 0 ? `<p>Fee ${moneyHtml(protocol + lp, rate)}.</p>` : ""}
      ${legs.length ? `<h2>Prices used</h2><div class="sheet"><table><thead><tr><th>Price from</th><th>Coin</th><th>Paid</th><th>Each</th></tr></thead><tbody>${legs.map((leg) => `<tr>
        <td>${leg.maker ? `<a href="#/address/${esc(leg.maker)}">${esc(shortId(leg.maker, 8, 4))}</a>` : "—"}</td>
        <td>${esc(tokenAmount(leg.amount))} ${esc(leg.ticker || "")}</td>
        <td>${moneyHtml(leg.sats, rate)}</td>
        <td>${leg.sats_per_token ? eachHtml(leg.sats_per_token, rate) : "—"}</td>
      </tr>`).join("")}</tbody></table></div>` : ""}
      <a class="btn" href="https://mempool.space/tx/${esc(txid)}">Open on mempool.space</a>
      <p class="note mono">${esc(txid)}</p>`;
  }

  function whereCoin(seal) {
    if (seal.in_pool) return "Posted in the swap";
    if (seal.listed) return "Listed for sale";
    return "Free to send";
  }

  function atomBalance(bag) {
    try {
      const n = BigInt(String((bag && bag.balance) || "0").replace(/[^0-9]/g, "") || "0");
      if (n <= 0n) return "";
      return fromAtoms(n);
    } catch {
      return "";
    }
  }

  function addressHtml(address, portfolio, trades, rate, garden) {
    const tokens = ((portfolio && portfolio.tokens) || []).filter((token) => Number(token.balance || 0) > 0);
    const leafAmt = atomBalance(garden && garden.leaf);
    const axbtAmt = atomBalance(garden && garden.axbt);
    const seals = (portfolio && portfolio.seals) || [];
    const mine = ((trades && trades.trades) || []).filter((trade) => trade.taker && trade.taker.toLowerCase() === address.toLowerCase());
    const held = tokens.length + (leafAmt ? 1 : 0) + (axbtAmt ? 1 : 0);
    const gardenSats = garden && garden.btc ? garden.btc.balance : null;
    const btcCell = portfolio
      ? walletHtml(portfolio, rate)
      : gardenSats != null && gardenSats !== ""
        ? moneyHtml(gardenSats, rate)
        : "—";
    const any = portfolio || leafAmt || axbtAmt || (gardenSats != null && gardenSats !== "");
    return `
      <p class="note">Wallet</p>
      <h1 class="mono">${esc(shortId(address, 12, 6))}</h1>
      <p class="mono">${esc(address)}</p>
      ${!any ? `<p class="warn">No balance came back for this address.</p>` : `
        <div class="stats">
          <div class="stat"><span class="k">Bitcoin</span><span class="v">${btcCell}</span></div>
          <div class="stat"><span class="k">Coins held</span><span class="v">${held}</span></div>
        </div>
      `}
      <h2>Balances</h2>
      ${tokens.length || leafAmt || axbtAmt ? `<div class="sheet"><table><thead><tr><th>Coin</th><th>Available</th><th>In the swap</th></tr></thead><tbody>${leafAmt ? `<tr><td><a href="#/coin/LEAF">LEAF</a></td><td>${esc(leafAmt)}</td><td>—</td></tr>` : ""}${axbtAmt ? `<tr><td><a href="#/coin/AXBT">AXBT</a></td><td>${esc(axbtAmt)}</td><td>—</td></tr>` : ""}${tokens.map((token) => `<tr>
        <td><a href="#/token/${esc(token.tick)}">${esc(token.tick)}</a></td>
        <td>${esc(tokenAmount(token.available || token.balance))}</td>
        <td>${esc(tokenAmount(token.in_pool))}</td>
      </tr>`).join("")}</tbody></table></div>` : `<p class="note">No coins on this wallet.</p>`}
      ${seals.length ? `<h2>Where they are</h2><div class="sheet"><table><thead><tr><th>Coin</th><th>Amount</th><th></th></tr></thead><tbody>${seals.map((seal) => `<tr><td>${esc(seal.tick)}</td><td>${esc(tokenAmount(seal.amount))}</td><td>${esc(whereCoin(seal))}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <h2>Swaps</h2>
      <div class="list">${mine.length ? mine.map((trade) => swapRow(trade, rate)).join("") : `<p class="note">No recent swaps from this wallet.</p>`}</div>
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
          const tickName = img.getAttribute("data-tick");
          if (tickName === "ORNG") return;
          const color = pickColor(ctx.getImageData(0, 0, 24, 24).data);
          colors[tickName] = color;
          app.querySelectorAll(`[data-tickrow="${tickName}"]`).forEach((row) => {
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
      } else if (route.page === "coin") {
        const tick = route.tick;
        const [stats, info, history] = await Promise.all([
          api({ p: "stats" }).catch(() => null),
          tick === "LEAF" || tick === "AXBT" ? api({ p: "garden", what: "stats", tick }).catch(() => null) : Promise.resolve(null),
          tick === "LEAF" || tick === "AXBT" ? api({ p: "garden", what: "history", limit: "20" }).catch(() => null) : Promise.resolve(null),
        ]);
        rememberRate(stats);
        const items = ((history && history.items) || []).filter((item) => (item.tick || "").toUpperCase() === tick);
        app.innerHTML = coinHtml(tick, info, items, rateNow);
      } else if (route.page === "tx") {
        const txid = route.txid;
        const [detail, raw, list, stats, gardenTx] = await Promise.all([
          api({ p: "trade", txid }).catch(() => null),
          api({ p: "tx", txid }).catch(() => null),
          api({ p: "trades", limit: "80" }).catch(() => ({ trades: [] })),
          api({ p: "stats" }).catch(() => null),
          api({ p: "garden", what: "tx", txid }).catch(() => null),
        ]);
        rememberRate(stats);
        const listed = ((list && list.trades) || []).find((trade) => trade.txid === txid) || null;
        const ops = detail ? [] : ((gardenTx && gardenTx.operations) || []);
        app.innerHTML = txHtml(txid, detail, raw, listed, rateNow, ops);
      } else if (route.page === "address") {
        const [portfolio, feed, stats, garden] = await Promise.all([
          api({ p: "wallet", address: route.address }).catch(() => null),
          api({ p: "trades", limit: "100" }).catch(() => ({ trades: [] })),
          api({ p: "stats" }).catch(() => null),
          api({ p: "garden", what: "wallet", address: route.address }).catch(() => null),
        ]);
        rememberRate(stats);
        app.innerHTML = addressHtml(route.address, portfolio, feed, rateNow, garden);
      } else if (route.page === "bons") {
        const [stats, pool, feed, tokens] = await Promise.all([
          api({ p: "stats" }).catch(() => null),
          api({ p: "pool", tick: "BONS" }).catch(() => null),
          api({ p: "trades", limit: "12" }).catch(() => ({ trades: [] })),
          coins().catch(() => []),
        ]);
        rememberRate(stats);
        app.innerHTML = homeHtml({ stats, pool, trades: feed, tokens, error: !stats && !pool }, rateNow);
      } else {
        const [stats, tokens, leaf, axbt, history] = await Promise.all([
          api({ p: "stats" }).catch(() => null),
          coins().catch(() => []),
          api({ p: "garden", what: "stats", tick: "LEAF" }).catch(() => null),
          api({ p: "garden", what: "stats", tick: "AXBT" }).catch(() => null),
          api({ p: "garden", what: "history", limit: "20" }).catch(() => null),
        ]);
        rememberRate(stats);
        const failed = !stats && !(tokens && tokens.length) && !leaf;
        app.innerHTML = crcHtml({ stats, tokens, leaf, axbt, history, rate: rateNow, error: failed }, route.page === "find" ? route.q : "");
      }
    } catch {
      app.innerHTML = `<p class="warn">This did not load. Try again in a moment.</p>`;
    }
    tint();
    const onBons = route.page === "bons";
    const crcTab = document.getElementById("mode-crc");
    const bonsTab = document.getElementById("mode-bons");
    if (crcTab) crcTab.classList.toggle("on", !onBons);
    if (bonsTab) bonsTab.classList.toggle("on", onBons);
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
    else if (next.page === "coin") after = "#/coin/" + next.tick;
    else if (next.page === "token") after = "#/token/" + next.tick;
    else if (next.page === "find") after = "#/find/" + encodeURIComponent(next.q || "");
    if (after === before) draw();
    else location.hash = after;
  });

  window.addEventListener("hashchange", draw);
  draw();
})(typeof globalThis !== "undefined" ? globalThis : this);
