// Weekly juice leaderboard for Orange Slice. Needs a Redis database (Upstash) and env vars:
// LB_SECRET (any long random text), ADMIN_KEY (long random text, for the payout export),
// optional WEEKLY_POOL (text shown on the board, e.g. "1,000 ORNG") and DAILY_CAP (default 20000).
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');
let R;
function db() {
  return R || (R = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  }));
}
const env = (k, d) => process.env[k] || d;
function wk(d) { // Monday of the current week (UTC) as YYYY-MM-DD
  const t = new Date(d || Date.now());
  const m = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7));
  return m.toISOString().slice(0, 10);
}
function reset() { const m = new Date(wk() + 'T00:00:00Z'); m.setUTCDate(m.getUTCDate() + 7); return m.toISOString(); }
const sign = s => crypto.createHmac('sha256', env('LB_SECRET', '')).update(s).digest('hex').slice(0, 32);
const hOk = h => { h = String(h || '').trim().replace(/^@/, ''); return /^[A-Za-z0-9_]{1,15}$/.test(h) ? h.toLowerCase() : null; };
const aOk = a => !a || /^(bc1[a-z0-9]{20,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/.test(a);
const ipOf = req => crypto.createHash('sha256').update(String((req.headers['x-forwarded-for'] || '').split(',')[0] || 'x')).digest('hex').slice(0, 16);
async function limit(r, key, max, sec) { const n = await r.incr(key); if (n === 1) await r.expire(key, sec); return n <= max; }
function rows(flat) { const o = []; for (let i = 0; i < flat.length; i += 2) o.push({ h: String(flat[i]), j: Number(flat[i + 1]) }); return o; }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {}, a = q.a, post = req.method === 'POST';
  try {
    if (!env('LB_SECRET', '')) return res.status(503).json({ error: 'not configured' });
    const r = db(), W = wk();

    if (a === 'top') {
      const [flat, tot] = await Promise.all([r.zrange('lb:' + W, 0, 19, { rev: true, withScores: true }), r.get('tot:' + W)]);
      const out = { week: W, reset: reset(), pool: env('WEEKLY_POOL', ''), top: rows(flat) };
      const h = hOk(q.h);
      if (h) {
        const j = await r.zscore('lb:' + W, h);
        if (j != null) { const rk = await r.zrevrank('lb:' + W, h); out.me = { juice: Number(j), rank: rk + 1, share: tot ? +(100 * j / tot).toFixed(2) : 0 }; }
      }
      return res.status(200).json(out);
    }

    if (a === 'start' && post) {
      if (!(await limit(r, 'rl:s:' + ipOf(req), 30, 60))) return res.status(429).json({ error: 'slow down' });
      const t = Date.now(), n = crypto.randomBytes(8).toString('hex');
      return res.status(200).json({ t, n, sig: sign(t + '.' + n) });
    }

    if (a === 'submit' && post) {
      const b = req.body || {}, h = hOk(b.h), score = Math.floor(Number(b.score)), t = Number(b.t), n = String(b.n || ''), sg = String(b.sig || '');
      if (!h) return res.status(400).json({ error: 'bad handle' });
      if (!aOk(b.addr)) return res.status(400).json({ error: 'bad address' });
      if (!(score > 0) || !isFinite(score)) return res.status(400).json({ error: 'bad score' });
      if (!/^[a-f0-9]{16}$/.test(n) || sg.length !== 32 || !crypto.timingSafeEqual(Buffer.from(sg), Buffer.from(sign(t + '.' + n)))) return res.status(400).json({ error: 'bad token' });
      const el = (Date.now() - t) / 1000;
      if (el < 15) return res.status(400).json({ error: 'too fast' });
      if (el > 10800) return res.status(400).json({ error: 'expired' });
      if (score > Math.min(el * 60, 300000)) return res.status(400).json({ error: 'score too high' });
      if (!(await limit(r, 'rl:p:' + ipOf(req), 60, 3600))) return res.status(429).json({ error: 'slow down' });
      const fresh = await r.set('u:' + n, 1, { nx: true, ex: 14400 });
      if (!fresh) return res.status(400).json({ error: 'used' });
      const dk = 'd:' + new Date().toISOString().slice(0, 10) + ':' + h, dn = await r.incrby(dk, score);
      await r.expire(dk, 172800);
      const credit = Math.max(0, Math.min(score, Number(env('DAILY_CAP', '20000')) - (dn - score)));
      if (credit > 0) {
        await r.zincrby('lb:' + W, credit, h); await r.incrby('tot:' + W, credit);
        await r.expire('lb:' + W, 3456000); await r.expire('tot:' + W, 3456000);
      }
      await r.hset('p:' + h, { lvl: Math.floor(Number(b.level)) || 0, ts: Date.now() });
      if (b.addr) { // first address wins; a different one is kept separately for review
        const cur = await r.hget('p:' + h, 'addr');
        if (!cur) await r.hset('p:' + h, { addr: String(b.addr) });
        else if (cur !== b.addr) await r.hset('p:' + h, { addr2: String(b.addr) });
      }
      const j = Number(await r.zscore('lb:' + W, h)) || 0, rk = j ? (await r.zrevrank('lb:' + W, h)) + 1 : 0;
      return res.status(200).json({ ok: true, credited: credit, juice: j, rank: rk });
    }

    if (a === 'export') { // payout list: /api/lb?a=export&key=ADMIN_KEY&format=csv  (optional &w=YYYY-MM-DD for another week)
      const k = env('ADMIN_KEY', '');
      if (k.length < 12 || q.key !== k) return res.status(403).json({ error: 'no' });
      const ww = /^\d{4}-\d{2}-\d{2}$/.test(q.w || '') ? q.w : W;
      const list = rows(await r.zrange('lb:' + ww, 0, 499, { rev: true, withScores: true }));
      const tot = Number(await r.get('tot:' + ww)) || 0;
      const pr = await Promise.all(list.map(async x => [await r.hget('p:' + x.h, 'addr'), await r.hget('p:' + x.h, 'addr2')]));
      const data = list.map((x, i) => ({ rank: i + 1, handle: x.h, address: pr[i][0] || '', other_address: pr[i][1] || '', juice: x.j, share_pct: tot ? +(100 * x.j / tot).toFixed(3) : 0 }));
      if (q.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        return res.status(200).send('rank,handle,address,other_address,juice,share_pct\n' + data.map(d => [d.rank, d.handle, d.address, d.other_address, d.juice, d.share_pct].join(',')).join('\n'));
      }
      return res.status(200).json({ week: ww, total: tot, rows: data });
    }
    return res.status(404).json({ error: 'unknown' });
  } catch (e) {
    return res.status(500).json({ error: 'server' });
  }
};
