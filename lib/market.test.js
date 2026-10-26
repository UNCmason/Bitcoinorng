// Proves a signed sale pays the seller and gives the picture to the buyer.
const bitcoin = require("bitcoinjs-lib");
const ecc = require("@bitcoinerlab/secp256k1");
const { ECPairFactory } = require("ecpair");
const market = require("./market");

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.bitcoin;

function toXOnly(pubkey) {
  return pubkey.subarray(1, 33);
}

function tweakSigner(signer) {
  let privateKey = signer.privateKey;
  if (signer.publicKey[0] === 3) privateKey = Buffer.from(ecc.privateNegate(privateKey));
  const tweaked = Buffer.from(ecc.privateAdd(privateKey, bitcoin.crypto.taggedHash("TapTweak", toXOnly(signer.publicKey))));
  return ECPair.fromPrivateKey(tweaked, { network });
}

function taproot(key) {
  const payment = bitcoin.payments.p2tr({ internalPubkey: toXOnly(key.publicKey), network });
  return { address: payment.address, scriptHex: payment.output.toString("hex"), key };
}

function wpkh(key) {
  const payment = bitcoin.payments.p2wpkh({ pubkey: key.publicKey, network });
  return { address: payment.address, scriptHex: payment.output.toString("hex"), key };
}

function txid(n) {
  return Buffer.alloc(32, n).toString("hex");
}

function signSell(hex, wallet) {
  const psbt = market.parsePsbt(hex);
  if (wallet.key.publicKey.length === 33 && wallet.scriptHex.startsWith("5120")) {
    psbt.updateInput(0, { tapInternalKey: toXOnly(wallet.key.publicKey) });
    psbt.signInput(0, tweakSigner(wallet.key), [market.SIGHASH_SELL]);
  } else {
    psbt.signInput(0, wallet.key, [market.SIGHASH_SELL]);
  }
  return psbt.toHex();
}

function signBuy(hex, wallet) {
  const psbt = market.parsePsbt(hex);
  const built = market.parsePsbt(hex);
  for (let i = 0; i < built.inputCount; i++) {
    if (i === 2) continue;
    if (wallet.scriptHex.startsWith("5120")) {
      psbt.updateInput(i, { tapInternalKey: toXOnly(wallet.key.publicKey) });
      psbt.signInput(i, tweakSigner(wallet.key));
    } else {
      psbt.signInput(i, wallet.key);
    }
  }
  return psbt.toHex();
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function run(kind) {
  const make = kind === "taproot" ? taproot : wpkh;
  const sellerKey = ECPair.makeRandom({ network });
  const buyerKey = ECPair.makeRandom({ network });
  const seller = make(sellerKey);
  const buyer = make(buyerKey);
  const postage = 800;
  const price = 50000;
  const unsigned = market.buildSellPsbt({
    txid: txid(9),
    vout: 1,
    value: postage,
    scriptHex: seller.scriptHex,
    seller: seller.address,
    priceSats: price,
  });
  const signed = signSell(unsigned, seller);
  const info = market.assertSellSigned(market.parsePsbt(signed));
  assert(info.priceSats === price && info.seller === seller.address, "sell shape");
  assert(info.sequence != null, "sequence");

  const bumps = [
    { txid: txid(2), vout: 0, value: 1200, scriptHex: buyer.scriptHex },
    { txid: txid(3), vout: 0, value: 1500, scriptHex: buyer.scriptHex },
  ];
  const funds = [{ txid: txid(4), vout: 0, value: 90000, scriptHex: buyer.scriptHex }];
  const buy = market.buildBuyPsbt({
    sellHex: signed,
    buyer: buyer.address,
    bumps,
    funds,
    feeRate: 8,
  });
  assert(buy.priceSats === price, "price");
  assert(buy.sign.join(",") === "0,1,3", "sign indexes " + buy.sign.join(","));
  const bought = signBuy(buy.psbt, buyer);
  const checked = market.assertBuySigned(market.parsePsbt(bought), info, buyer.address);
  assert(checked.fee === buy.fee, "fee " + checked.fee + " vs " + buy.fee);
  const final = market.finalizeHex(bought);
  assert(final.vsize > 0 && checked.fee >= final.vsize, "fee covers vsize " + checked.fee + " < " + final.vsize);

  const edited = market.parsePsbt(buy.psbt);
  edited.data.globalMap.unsignedTx.tx.outs[2].value = price - 1;
  const cheap = market.parsePsbt(edited.toHex());
  let reason = "";
  try { market.inspectBuy(cheap, info, buyer.address); } catch (error) { reason = error.message; }
  assert(reason.indexOf("signed price") !== -1, "cheaper output must fail: " + reason);

  const split = market.buildSplitPsbt({
    txid: txid(5),
    vout: 0,
    value: 80000,
    scriptHex: buyer.scriptHex,
    buyer: buyer.address,
    feeRate: 5,
  });
  const splitPsbt = market.parsePsbt(split.psbt);
  if (buyer.scriptHex.startsWith("5120")) {
    splitPsbt.updateInput(0, { tapInternalKey: toXOnly(buyer.key.publicKey) });
    splitPsbt.signInput(0, tweakSigner(buyer.key));
  } else {
    splitPsbt.signInput(0, buyer.key);
  }
  const splitChecked = market.assertSplitSigned(splitPsbt, buyer.address);
  assert(splitChecked.fee > 0, "split fee");
  console.log(kind, "ok", "fee", buy.fee, "vsize", final.vsize);
}

run("taproot");
run("wpkh");
assert(market.btcToSats("0.0001") === 10000, "sats");
assert(market.btcToSats("1") === 100000000, "one btc");
const trade = require("../api/trade");
const same = { txid: "aa", vout: 0, priceSats: 20000 };
assert(trade.blocksHigherPrice(same, { txid: "aa", vout: 0, priceSats: 20001 }), "higher price");
assert(!trade.blocksHigherPrice(same, { txid: "aa", vout: 0, priceSats: 20000 }), "same price");
assert(!trade.blocksHigherPrice(same, { txid: "bb", vout: 1, priceSats: 90000 }), "new output");
console.log("market ok");
