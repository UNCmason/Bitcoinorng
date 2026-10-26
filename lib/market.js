// Builds and checks the bitcoin sale for one inscription.
// The seller signs only their price. The buyer adds the payment.
// Nothing here has a key, and nothing here broadcasts.
const bitcoin = require("bitcoinjs-lib");
const ecc = require("@bitcoinerlab/secp256k1");

bitcoin.initEccLib(ecc);

const network = bitcoin.networks.bitcoin;
const SIGHASH_SELL = bitcoin.Transaction.SIGHASH_SINGLE | bitcoin.Transaction.SIGHASH_ANYONECANPAY;
const MIN_PRICE = 10000;
const MAX_PRICE = 100000000;
const MAX_POSTAGE = 100000;
const MAX_FEE = 1000000;
const DUST = 546;

function fail(message) {
  const error = new Error(message);
  error.expose = true;
  throw error;
}

function parsePsbt(raw) {
  const text = String(raw || "").replace(/\s+/g, "");
  if (!text) fail("The sale is missing.");
  try {
    if (/^[0-9a-fA-F]+$/.test(text) && text.length % 2 === 0) return bitcoin.Psbt.fromHex(text);
    return bitcoin.Psbt.fromBase64(text);
  } catch {
    fail("The sale could not be read.");
  }
}

function scriptOf(scriptHex) {
  if (!/^[0-9a-fA-F]+$/.test(scriptHex || "") || scriptHex.length % 2) fail("The bitcoin output could not be read.");
  return Buffer.from(scriptHex, "hex");
}

function isTaproot(script) {
  return script.length === 34 && script[0] === 0x51 && script[1] === 0x20;
}

function isP2wpkh(script) {
  return script.length === 22 && script[0] === 0x00 && script[1] === 0x14;
}

function assertSupported(script) {
  if (!isTaproot(script) && !isP2wpkh(script)) {
    fail("This board can sell a picture on a bc1p or bc1q address.");
  }
}

function addressScript(address) {
  try {
    return bitcoin.address.toOutputScript(address, network);
  } catch {
    fail("That Bitcoin address could not be read.");
  }
}

function sameScript(a, b) {
  return Buffer.from(a).equals(Buffer.from(b));
}

function mustInt(value, message) {
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isInteger(n) || n < 0) fail(message);
  return n;
}

function mustPrice(value) {
  const n = mustInt(value, "Enter the price in bitcoin.");
  if (n < MIN_PRICE || n > MAX_PRICE) fail("The price has to be from 0.0001 to 1 bitcoin.");
  return n;
}

function mustPostage(value) {
  const n = mustInt(value, "This picture's bitcoin output could not be read.");
  if (n < DUST || n > MAX_POSTAGE) {
    fail("This picture sits on too many sats to sell here. Send it to yourself on a small output first.");
  }
  return n;
}

function btcToSats(text) {
  const s = String(text == null ? "" : text).trim();
  if (!/^\d+(\.\d{1,8})?$/.test(s)) fail("Enter the price in bitcoin, with up to 8 decimals.");
  const [whole, frac = ""] = s.split(".");
  const sats = BigInt(whole) * 100000000n + BigInt((frac + "00000000").slice(0, 8));
  if (sats < BigInt(MIN_PRICE) || sats > BigInt(MAX_PRICE)) fail("The price has to be from 0.0001 to 1 bitcoin.");
  return Number(sats);
}

function schnorrOk(pubkey, msghash, signature) {
  return ecc.verifySchnorr(msghash, pubkey, signature);
}

function ecdsaOk(pubkey, msghash, signature) {
  return ecc.verify(msghash, pubkey, signature);
}

function sigOk(psbt, index) {
  const input = psbt.data.inputs[index];
  const script = input && input.witnessUtxo && input.witnessUtxo.script;
  if (!script) return false;
  try {
    if (isTaproot(script) && input.tapKeySig && !input.tapInternalKey) {
      psbt.updateInput(index, { tapInternalKey: Buffer.from(script.subarray(2, 34)) });
    }
    return psbt.validateSignaturesOfInput(index, isTaproot(script) ? schnorrOk : ecdsaOk);
  } catch {
    return false;
  }
}

function inputValue(psbt, index) {
  const utxo = psbt.data.inputs[index] && psbt.data.inputs[index].witnessUtxo;
  if (!utxo) fail("A bitcoin output in this sale is missing.");
  return mustInt(utxo.value, "A bitcoin output in this sale is missing.");
}

function hasSig(input) {
  return Boolean(input && (input.tapKeySig || (input.partialSig && input.partialSig.length)));
}

function sellShape(psbt) {
  if (psbt.inputCount !== 1 || psbt.txOutputs.length !== 1) fail("The sale has to lock the picture at its price.");
  const input = psbt.data.inputs[0];
  if (!input || !input.witnessUtxo) fail("The picture output is missing from the sale.");
  if (input.sighashType !== SIGHASH_SELL) fail("The wallet did not lock the price.");
  const script = input.witnessUtxo.script;
  assertSupported(script);
  const point = psbt.txInputs[0];
  const txid = Buffer.from(point.hash).reverse().toString("hex");
  const output = psbt.txOutputs[0];
  if (!output.address) fail("The price is not paid to a Bitcoin address.");
  const value = mustPostage(input.witnessUtxo.value);
  const priceSats = mustPrice(output.value);
  if (!sameScript(addressScript(output.address), script)) {
    fail("The price has to be paid to the address that holds the picture.");
  }
  if (isTaproot(script)) {
    const sig = input.tapKeySig;
    if (sig && (sig.length !== 65 || sig[64] !== SIGHASH_SELL)) fail("The wallet did not lock the price.");
  } else if (input.partialSig && input.partialSig[0]) {
    const sig = input.partialSig[0].signature;
    if (sig[sig.length - 1] !== SIGHASH_SELL) fail("The wallet did not lock the price.");
  }
  return {
    txid,
    vout: point.index,
    sequence: point.sequence,
    value,
    priceSats,
    seller: output.address,
    scriptHex: Buffer.from(script).toString("hex"),
    signed: hasSig(input),
  };
}

function assertSellSigned(psbt) {
  const info = sellShape(psbt);
  if (!info.signed || !sigOk(psbt, 0)) fail("The signature does not match this picture.");
  return info;
}

function buildSellPsbt({ txid, vout, value, scriptHex, seller, priceSats }) {
  priceSats = mustPrice(priceSats);
  value = mustPostage(value);
  if (!/^[a-f0-9]{64}$/.test(txid)) fail("That picture location is not valid.");
  vout = mustInt(vout, "That picture location is not valid.");
  const script = scriptOf(scriptHex);
  assertSupported(script);
  if (!sameScript(addressScript(seller), script)) {
    fail("The price has to be paid to the address that holds the picture.");
  }
  const psbt = new bitcoin.Psbt({ network });
  // One input and one output. The signature locks this picture to this price.
  // The buyer later places both at the same position in the purchase.
  psbt.addInput({
    hash: txid,
    index: vout,
    witnessUtxo: { value, script },
    sighashType: SIGHASH_SELL,
  });
  psbt.addOutput({ address: seller, value: priceSats });
  return psbt.toHex();
}

function varInt(n) {
  return n < 253 ? 1 : 3;
}

function vsizeOf(inputs, addresses) {
  let base = 4 + 4 + varInt(inputs.length) + varInt(addresses.length);
  let witness = 2;
  for (const input of inputs) {
    base += 41;
    const script = scriptOf(input.scriptHex);
    witness += isTaproot(script) ? 67 : 1 + 1 + 73 + 1 + 33;
  }
  for (const address of addresses) {
    const script = addressScript(address);
    base += 8 + varInt(script.length) + script.length;
  }
  return Math.ceil((base * 3 + base + witness) / 4);
}

function addSpend(psbt, utxo, sighashType) {
  const script = scriptOf(utxo.scriptHex);
  assertSupported(script);
  const data = {
    hash: utxo.txid,
    index: utxo.vout,
    witnessUtxo: { value: mustInt(utxo.value, "A bitcoin output is missing."), script },
  };
  if (utxo.sequence != null) data.sequence = utxo.sequence;
  if (sighashType) data.sighashType = sighashType;
  psbt.addInput(data);
}

function copySellSig(buy, index, sell) {
  const src = sell.data.inputs[0];
  const patch = {};
  if (src.tapKeySig) patch.tapKeySig = Buffer.from(src.tapKeySig);
  if (src.tapInternalKey) patch.tapInternalKey = Buffer.from(src.tapInternalKey);
  if (src.partialSig && src.partialSig.length) {
    patch.partialSig = src.partialSig.map((part) => ({
      pubkey: Buffer.from(part.pubkey),
      signature: Buffer.from(part.signature),
    }));
  }
  if (!patch.tapKeySig && !patch.partialSig) fail("The seller signature is missing.");
  // bitcoinjs only checks a taproot signature when an internal key is present.
  // The key itself is not part of the signed message. The output key in the
  // script is what the signature has to match.
  if (patch.tapKeySig && !patch.tapInternalKey && src.witnessUtxo && isTaproot(src.witnessUtxo.script)) {
    patch.tapInternalKey = Buffer.from(src.witnessUtxo.script.subarray(2, 34));
  }
  buy.updateInput(index, patch);
}

function outputsOf(psbt) {
  return psbt.txOutputs.map((output, index) => ({
    index,
    address: output.address,
    value: mustInt(output.value, "An output in this sale is missing."),
  }));
}

function wholeInputLands(psbt, inputIndex) {
  const inputs = [];
  for (let i = 0; i < psbt.inputCount; i++) inputs.push(inputValue(psbt, i));
  let from = 0;
  for (let i = 0; i < inputIndex; i++) from += inputs[i];
  const to = from + inputs[inputIndex];
  const outputs = outputsOf(psbt);
  let cursor = 0;
  for (const output of outputs) {
    const end = cursor + output.value;
    if (from >= cursor && to <= end) return output;
    cursor = end;
  }
  return null;
}

function feeOf(psbt) {
  let inputs = 0;
  let outputs = 0;
  for (let i = 0; i < psbt.inputCount; i++) inputs += inputValue(psbt, i);
  for (const output of psbt.txOutputs) outputs += mustInt(output.value, "An output in this sale is missing.");
  return inputs - outputs;
}

function sameOutpoint(psbt, index, txid, vout) {
  const point = psbt.txInputs[index];
  const got = Buffer.from(point.hash).reverse().toString("hex");
  return got === txid && point.index === vout;
}

function inspectBuy(psbt, sellInfo, buyer) {
  if (psbt.inputCount < 4) fail("The buy is incomplete.");
  if (!sameOutpoint(psbt, 2, sellInfo.txid, sellInfo.vout)) fail("The buy is not for this picture.");
  if (psbt.txInputs[2].sequence !== sellInfo.sequence) fail("The buy does not match the signed sale.");
  const seen = new Set();
  for (let i = 0; i < psbt.inputCount; i++) {
    const point = psbt.txInputs[i];
    const key = Buffer.from(point.hash).reverse().toString("hex") + ":" + point.index;
    if (seen.has(key)) fail("The buy uses the same bitcoin output twice.");
    seen.add(key);
    const script = psbt.data.inputs[i].witnessUtxo.script;
    assertSupported(script);
    if (!sameScript(addressScript(i === 2 ? sellInfo.seller : buyer), script)) {
      fail(i === 2 ? "The picture output does not match the seller." : "A payment output is not from the buyer.");
    }
  }
  const outputs = outputsOf(psbt);
  if (outputs.length < 3 || outputs.length > 4) fail("The buy has an unexpected payment.");
  const pad = inputValue(psbt, 0) + inputValue(psbt, 1);
  if (outputs[0].address !== buyer || outputs[0].value !== pad) fail("The spare bitcoin would not return to the buyer.");
  if (outputs[1].address !== buyer || outputs[1].value !== sellInfo.value) fail("The picture would not go to the buyer.");
  if (outputs[2].address !== sellInfo.seller || outputs[2].value !== sellInfo.priceSats) fail("The seller would not receive the signed price.");
  if (outputs[3] && outputs[3].address !== buyer) fail("The change would not go back to the buyer.");
  const landed = wholeInputLands(psbt, 2);
  if (!landed || landed.index !== 1 || landed.address !== buyer) {
    fail("The picture would not go to the buyer, so the buy was stopped.");
  }
  if (!sigOk(psbt, 2)) fail("The seller signature does not match this buy.");
  const fee = feeOf(psbt);
  if (fee <= 0 || fee > MAX_FEE) fail("The bitcoin fee looks wrong, so the buy was stopped.");
  return { fee, priceSats: sellInfo.priceSats, seller: sellInfo.seller, postage: sellInfo.value };
}

function quoteBuy({ inputScripts, buyer, seller, fundSum, price, feeRate }) {
  const rate = mustInt(feeRate, "The Bitcoin fee rate is not available right now.");
  if (rate < 1 || rate > 1000) fail("The Bitcoin fee rate looks wrong, so the buy was stopped.");
  const four = vsizeOf(inputScripts, [buyer, buyer, seller, buyer]);
  let fee = Math.ceil(four * rate);
  let change = fundSum - price - fee;
  if (change >= DUST) return { fee, change, withChange: true };
  const three = vsizeOf(inputScripts, [buyer, buyer, seller]);
  fee = Math.ceil(three * rate);
  change = fundSum - price - fee;
  if (change < 0) fail("This wallet does not have enough bitcoin for the price and the miner fee.");
  if (change >= DUST) {
    fee = Math.ceil(four * rate);
    change = fundSum - price - fee;
    if (change < 0) fail("This wallet does not have enough bitcoin for the price and the miner fee.");
    return { fee, change, withChange: true };
  }
  if (fee + Math.max(change, 0) > MAX_FEE) fail("The bitcoin fee looks wrong, so the buy was stopped.");
  return { fee: fee + Math.max(change, 0), change: 0, withChange: false };
}

function buildBuyPsbt({ sellHex, buyer, bumps, funds, feeRate }) {
  const sell = parsePsbt(sellHex);
  const sellInfo = assertSellSigned(sell);
  if (!Array.isArray(bumps) || bumps.length !== 2) fail("The buyer needs two spare bitcoin outputs.");
  if (!Array.isArray(funds) || !funds.length) fail("The buyer needs bitcoin for the price.");
  addressScript(buyer);
  const psbt = new bitcoin.Psbt({ network });
  if (sell.version !== 2) psbt.setVersion(sell.version);
  if (sell.locktime) psbt.setLocktime(sell.locktime);
  for (const bump of bumps) addSpend(psbt, bump);
  addSpend(psbt, {
    txid: sellInfo.txid,
    vout: sellInfo.vout,
    value: sellInfo.value,
    scriptHex: sellInfo.scriptHex,
    sequence: sellInfo.sequence,
  }, SIGHASH_SELL);
  for (const fund of funds) addSpend(psbt, fund);
  const scripts = [bumps[0], bumps[1], { scriptHex: sellInfo.scriptHex }].concat(funds);
  const fundSum = funds.reduce((sum, fund) => sum + mustInt(fund.value, "A bitcoin output is missing."), 0);
  const quote = quoteBuy({
    inputScripts: scripts,
    buyer,
    seller: sellInfo.seller,
    fundSum,
    price: sellInfo.priceSats,
    feeRate,
  });
  const pad = mustInt(bumps[0].value, "A bitcoin output is missing.") + mustInt(bumps[1].value, "A bitcoin output is missing.");
  psbt.addOutput({ address: buyer, value: pad });
  psbt.addOutput({ address: buyer, value: sellInfo.value });
  psbt.addOutput({ address: sellInfo.seller, value: sellInfo.priceSats });
  if (quote.withChange) psbt.addOutput({ address: buyer, value: quote.change });
  copySellSig(psbt, 2, sell);
  const checked = inspectBuy(psbt, sellInfo, buyer);
  const sign = [];
  for (let i = 0; i < psbt.inputCount; i++) if (i !== 2) sign.push(i);
  return {
    psbt: psbt.toHex(),
    fee: checked.fee,
    priceSats: sellInfo.priceSats,
    seller: sellInfo.seller,
    sign,
  };
}

function assertBuySigned(psbt, sellInfo, buyer) {
  const checked = inspectBuy(psbt, sellInfo, buyer);
  for (let i = 0; i < psbt.inputCount; i++) {
    if (i === 2) continue;
    const sighash = psbt.data.inputs[i].sighashType;
    if (sighash && sighash !== bitcoin.Transaction.SIGHASH_ALL && sighash !== bitcoin.Transaction.SIGHASH_DEFAULT) {
      fail("The buyer signature locked the wrong thing.");
    }
    if (!sigOk(psbt, i)) fail("A buyer signature is missing.");
  }
  return checked;
}

function buildSplitPsbt({ txid, vout, value, scriptHex, buyer, feeRate }) {
  const script = scriptOf(scriptHex);
  assertSupported(script);
  if (!sameScript(addressScript(buyer), script)) fail("That bitcoin is not on the connected address.");
  value = mustInt(value, "A bitcoin output is missing.");
  const rate = mustInt(feeRate, "The Bitcoin fee rate is not available right now.");
  if (rate < 1 || rate > 1000) fail("The Bitcoin fee rate looks wrong, so this was stopped.");
  const psbt = new bitcoin.Psbt({ network });
  psbt.addInput({ hash: txid, index: vout, witnessUtxo: { value, script } });
  const fourTry = vsizeOf([{ scriptHex }], [buyer, buyer, buyer]);
  let fee = Math.ceil(fourTry * rate);
  let change = value - 20000 - fee;
  if (change >= DUST && value - fee <= MAX_FEE + 20000) {
    psbt.addOutput({ address: buyer, value: 10000 });
    psbt.addOutput({ address: buyer, value: 10000 });
    psbt.addOutput({ address: buyer, value: change });
  } else {
    const two = vsizeOf([{ scriptHex }], [buyer, buyer]);
    fee = Math.ceil(two * rate);
    const left = value - fee;
    const half = Math.floor(left / 2);
    if (half < DUST || left - half < DUST) fail("This wallet needs more spare bitcoin on this address before it can buy.");
    psbt.addOutput({ address: buyer, value: half });
    psbt.addOutput({ address: buyer, value: left - half });
  }
  if (feeOf(psbt) <= 0 || feeOf(psbt) > MAX_FEE) fail("The bitcoin fee looks wrong, so this was stopped.");
  return { psbt: psbt.toHex(), fee: feeOf(psbt), sign: [0] };
}

function assertSplitSigned(psbt, buyer) {
  if (psbt.inputCount !== 1) fail("The split is not a single bitcoin output.");
  for (const output of outputsOf(psbt)) {
    if (output.address !== buyer) fail("The split would send bitcoin away from the buyer.");
  }
  const fee = feeOf(psbt);
  if (fee <= 0 || fee > MAX_FEE) fail("The bitcoin fee looks wrong, so this was stopped.");
  if (!sigOk(psbt, 0)) fail("The signature for the split is missing.");
  return { fee };
}

function finalizeHex(raw) {
  const psbt = parsePsbt(raw);
  try {
    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
    return { hex: tx.toHex(), txid: tx.getId(), vsize: tx.virtualSize() };
  } catch {
    fail("The signed bitcoin transaction could not be finished.");
  }
}

module.exports = {
  SIGHASH_SELL,
  MIN_PRICE,
  MAX_PRICE,
  MAX_POSTAGE,
  DUST,
  btcToSats,
  parsePsbt,
  sellShape,
  assertSellSigned,
  buildSellPsbt,
  buildBuyPsbt,
  inspectBuy,
  assertBuySigned,
  buildSplitPsbt,
  assertSplitSigned,
  finalizeHex,
  wholeInputLands,
  vsizeOf,
};
