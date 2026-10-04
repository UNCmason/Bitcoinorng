// Orange Slice season leaderboard. Needs an Upstash Redis database (KV_REST_API_URL / KV_REST_API_TOKEN).
// Required env vars: LB_SECRET, ADMIN_KEY.
// Optional: SEASON_END (e.g. 2026-10-11T18:00:00Z, starts a timed season), SEASON_START, SEASON_ID (default S1),
// WEEKLY_POOL (text shown on the board), MIN_SLICES (default 2000), MIN_LEVEL (default 31), DAILY_CAP (default 20000).
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
function wk() {
  const t = new Date(), m = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7));
  return m.toISOString().slice(0, 10);
}
function season() { // timed season if SEASON_END is set, otherwise the calendar week (Mon to Mon, UTC)
  const e = Date.parse(env('SEASON_END', '')), s = Date.parse(env('SEASON_START', ''));
  if (isFinite(e)) return { id: env('SEASON_ID', 'S1'), start: isFinite(s) ? s : 0, end: e };
  const m = new Date(wk() + 'T00:00:00Z').getTime();
  return { id: wk(), start: m, end: m + 7 * 864e5 };
}
const sign = s => crypto.createHmac('sha256', env('LB_SECRET', '')).update(s).digest('hex').slice(0, 32);
const hOk = h => { h = String(h || '').trim().replace(/^@/, ''); return /^[A-Za-z0-9_]{1,15}$/.test(h) ? h.toLowerCase() : null; };
const aOk = a => !a || /^(bc1[a-z0-9]{20,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/.test(a);
const ipOf = req => crypto.createHash('sha256').update(String((req.headers['x-forwarded-for'] || '').split(',')[0] || 'x')).digest('hex').slice(0, 16);
async function limit(r, key, max, sec) { const n = await r.incr(key); if (n === 1) await r.expire(key, sec); return n <= max; }
function rows(flat) { const o = []; for (let i = 0; i < flat.length; i += 2) o.push({ h: String(flat[i]), j: Number(flat[i + 1]) }); return o; }

// X post link check: must be from the player's own handle and created during this season.
// (X post IDs contain their creation time, so an old post can be spotted without the X API.)
function postCheck(link, h, S) {
  const m = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/i.exec(String(link || '').trim());
  if (!m) return { error: 'not an X post link' };
  if (m[1].toLowerCase() !== h) return { error: 'post must be from @' + h };
  const ts = Number(BigInt(m[2]) >> 22n) + 1288834974657, floor = S.start || (S.end - 8 * 864e5);
  if (ts < floor) return { error: 'post is older than this season' };
  if (ts > Date.now() + 3e5) return { error: 'bad post link' };
  return { link: 'https://x.com/' + m[1] + '/status/' + m[2] };
}
async function evalQ(r, id, h, minS, minL) { // in the pool = enough Slices + level + an X post
  const [t, lv, pp] = await Promise.all([r.zscore('lb:' + id, h), r.hget('lv:' + id, h), r.hget('pp:' + id, h)]);
  if (Number(t) >= minS && Number(lv) >= minL && pp) { await r.zadd('q:' + id, { score: Number(t), member: h }); await r.expire('q:' + id, 3456000); return true; }
  return false;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {}, a = q.a, post = req.method === 'POST';
  try {
    if (!env('LB_SECRET', '')) return res.status(503).json({ error: 'not configured' });
    const r = db(), S = season(), id = S.id, now = Date.now();
    const status = now < S.start ? 'soon' : now >= S.end ? 'ended' : 'live';
    const minS = Number(env('MIN_SLICES', '2000')), minL = Number(env('MIN_LEVEL', '31'));
    const KEEP = 3456000;

    if (a === 'top') { // only players who qualified are listed
      const all = rows(await r.zrange('q:' + id, 0, 1999, { rev: true, withScores: true }));
      const qtot = all.reduce((s, x) => s + x.j, 0);
      const out = { id, start: S.start, end: S.end, status, pool: env('WEEKLY_POOL', ''), minS, minL, count: all.length, top: all.slice(0, 20) };
      const h = hOk(q.h);
      if (h) {
        const [t, lv, qs, pp] = await Promise.all([r.zscore('lb:' + id, h), r.hget('lv:' + id, h), r.zscore('q:' + id, h), r.hget('pp:' + id, h)]);
        const qual = qs != null;
        out.me = { slices: Number(t) || 0, level: Number(lv) || 0, post: !!pp, qualified: qual, rank: qual ? all.findIndex(x => x.h === h) + 1 : 0, share: qual && qtot ? +(100 * Number(qs) / qtot).toFixed(2) : 0 };
      }
      return res.status(200).json(out);
    }

    if (a === 'start' && post) {
      if (!(await limit(r, 'rl:s:' + ipOf(req), 30, 60))) return res.status(429).json({ error: 'slow down' });
      const t = Date.now(), n = crypto.randomBytes(8).toString('hex');
      return res.status(200).json({ t, n, sig: sign(t + '.' + n) });
    }

    if (a === 'post' && post) { // save the player's X post link for this season
      const b = req.body || {}, h = hOk(b.h);
      if (!h) return res.status(400).json({ error: 'bad handle' });
      if (status === 'ended') return res.status(400).json({ error: 'season ended' });
      if (!(await limit(r, 'rl:l:' + ipOf(req), 30, 3600))) return res.status(429).json({ error: 'slow down' });
      const pc = postCheck(b.link, h, S);
      if (pc.error) return res.status(400).json({ error: pc.error });
      await r.hset('pp:' + id, { [h]: pc.link }); await r.expire('pp:' + id, KEEP);
      return res.status(200).json({ ok: true, qualified: await evalQ(r, id, h, minS, minL) });
    }

    if (a === 'submit' && post) {
      const b = req.body || {}, h = hOk(b.h), score = Math.floor(Number(b.score)), t = Number(b.t), n = String(b.n || ''), sg = String(b.sig || '');
      const L = Math.min(100000, Math.floor(Number(b.level)) || 0), sl = Math.max(1, Math.floor(Number(b.sl)) || 1);
      if (!h) return res.status(400).json({ error: 'bad handle' });
      if (!aOk(b.addr)) return res.status(400).json({ error: 'bad address' });
      if (!(score > 0) || !isFinite(score)) return res.status(400).json({ error: 'bad score' });
      if (status === 'soon') return res.status(400).json({ error: 'season not started' });
      if (status === 'ended') return res.status(400).json({ error: 'season ended' });
      if (!/^[a-f0-9]{16}$/.test(n) || sg.length !== 32 || !crypto.timingSafeEqual(Buffer.from(sg), Buffer.from(sign(t + '.' + n)))) return res.status(400).json({ error: 'bad token' });
      const el = (now - t) / 1000;
      if (el < 15) return res.status(400).json({ error: 'too fast' });
      if (el > 10800) return res.status(400).json({ error: 'expired' });
      if (score > Math.min(el * 60, 300000)) return res.status(400).json({ error: 'score too high' });
      if (L > sl + el / 2 + 1) return res.status(400).json({ error: 'level too high' });
      if (!(await limit(r, 'rl:p:' + ipOf(req), 60, 3600))) return res.status(429).json({ error: 'slow down' });
      const fresh = await r.set('u:' + n, 1, { nx: true, ex: 14400 });
      if (!fresh) return res.status(400).json({ error: 'used' });
      const dk = 'd:' + new Date().toISOString().slice(0, 10) + ':' + h, dn = await r.incrby(dk, score);
      await r.expire(dk, 172800);
      const credit = Math.max(0, Math.min(score, Number(env('DAILY_CAP', '20000')) - (dn - score)));
      if (credit > 0) { await r.zincrby('lb:' + id, credit, h); await r.expire('lb:' + id, KEEP); }
      const cur = Number(await r.hget('lv:' + id, h)) || 0;
      if (L > cur) { await r.hset('lv:' + id, { [h]: L }); await r.expire('lv:' + id, KEEP); }
      const maxL = Math.max(cur, L), total = Number(await r.zscore('lb:' + id, h)) || 0;
      const qual = await evalQ(r, id, h, minS, minL), hasPost = !!(await r.hget('pp:' + id, h));
      await r.hset('p:' + h, { ts: Date.now() });
      if (b.addr) { // first address wins; a different one is kept separately for review
        const c0 = await r.hget('p:' + h, 'addr');
        if (!c0) await r.hset('p:' + h, { addr: String(b.addr) });
        else if (c0 !== b.addr) await r.hset('p:' + h, { addr2: String(b.addr) });
      }
      const rank = qual ? (await r.zrevrank('q:' + id, h)) + 1 : 0;
      return res.status(200).json({ ok: true, credited: credit, slices: total, level: maxL, qualified: qual, post: hasPost, rank, minS, minL });
    }

    if (a === 'export') { // /api/lb?a=export&key=ADMIN_KEY&format=csv  (qualified players only; &s=SEASON_ID for another season)
      const k = env('ADMIN_KEY', '');
      if (k.length < 12 || q.key !== k) return res.status(403).json({ error: 'no' });
      const sid = /^[A-Za-z0-9_-]{1,20}$/.test(q.s || '') ? q.s : id;
      const list = rows(await r.zrange('q:' + sid, 0, 1999, { rev: true, withScores: true }));
      const tot = list.reduce((s, x) => s + x.j, 0);
      const pr = await Promise.all(list.map(async x => [await r.hget('p:' + x.h, 'addr'), await r.hget('p:' + x.h, 'addr2'), await r.hget('lv:' + sid, x.h), await r.hget('pp:' + sid, x.h)]));
      const data = list.map((x, i) => ({ rank: i + 1, handle: x.h, address: pr[i][0] || '', other_address: pr[i][1] || '', slices: x.j, level: Number(pr[i][2]) || 0, post: pr[i][3] || '', share_pct: tot ? +(100 * x.j / tot).toFixed(3) : 0 }));
      if (q.format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        return res.status(200).send('rank,handle,address,other_address,slices,level,post,share_pct\n' + data.map(d => [d.rank, d.handle, d.address, d.other_address, d.slices, d.level, d.post, d.share_pct].join(',')).join('\n'));
      }
      return res.status(200).json({ season: sid, qualified: list.length, total_slices: tot, rows: data });
    }
    return res.status(404).json({ error: 'unknown' });
  } catch (e) {
    return res.status(500).json({ error: 'server' });
  }
};
