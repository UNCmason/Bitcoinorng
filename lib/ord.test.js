const fs = require("fs");
const ord = require("./ord");

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const sample = "<dt>inscriptions</dt><dd><a href=/inscription/965f866bf8623bbf956c1b2aeec1efc1ad162fd428ab7fb89f128a0754ebbc32i0></a></dd><dt>value</dt><dd>546</dd><dt>spent</dt><dd>false</dd><a href=/address/bc1pmc5m33qxt55kg3tu5cyxp30xnsva66cppr9qk5urz4vkdv2ctuasy200qx>";
const parsed = ord.parseOutputHtml(sample);
assert(parsed && parsed.spent === false && parsed.value === 546, "output");
assert(parsed.inscriptions.length === 1 && parsed.address.startsWith("bc1p"), "inscription on output");
assert(ord.parseOutputHtml("<p>nope</p>") === null, "unreadable output");

const saved = process.env.TEMP + "\\ord-out.html";
if (fs.existsSync(saved)) {
  const live = ord.parseOutputHtml(fs.readFileSync(saved, "utf8"));
  assert(live && live.spent === false && live.inscriptions.length === 1 && live.value === 546, "saved output page");
}

let threw = false;
try { ord.inscriptionId("nope"); } catch { threw = true; }
assert(threw, "bad id");
console.log("ord parser ok");
