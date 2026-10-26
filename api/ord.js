// Public reads for one inscription, its image, and bitcoin fee data.
const ord = require("../lib/ord");

function send(res, code, obj) {
  res.setHeader("Cache-Control", "no-store");
  res.status(code).json(obj);
}

module.exports = async (req, res) => {
  const q = req.query || {};
  try {
    if (q.fee) {
      return send(res, 200, { halfHourFee: await ord.feeRate() });
    }
    if (q.content) {
      const file = await ord.content(q.content);
      if (!file) return send(res, 404, { error: "That inscription is not an image." });
      res.setHeader("Content-Type", file.type);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.status(200);
      return res.end(file.body);
    }
    if (q.id) return send(res, 200, await ord.inscription(q.id));
    return send(res, 400, { error: "Say which inscription to look up." });
  } catch (error) {
    return send(res, 400, { error: error && error.expose ? error.message : "That could not be looked up right now." });
  }
};
