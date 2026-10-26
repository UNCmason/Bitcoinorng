(function () {
  const status = document.getElementById("status");
  const board = document.getElementById("board");
  const connect = document.getElementById("connect");
  const walletNote = document.getElementById("wallet-note");
  const sell = document.getElementById("sell");
  const held = document.getElementById("held");
  const iid = document.getElementById("iid");
  const price = document.getElementById("price");
  let wallet = null;
  let address = "";
  let busy = false;
  let pending = null;

  function say(text) {
    status.textContent = text || "";
  }

  function btc(sats) {
    const text = (Number(sats) / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    return text + " BTC";
  }

  function short(addr) {
    return addr && addr.length > 16 ? addr.slice(0, 8) + "…" + addr.slice(-6) : (addr || "");
  }

  function tokens() {
    try { return JSON.parse(localStorage.getItem("orngCancel") || "{}"); } catch (error) { return {}; }
  }

  function saveToken(id, token) {
    const all = tokens();
    all[id] = token;
    localStorage.setItem("orngCancel", JSON.stringify(all));
  }

  function psbtOf(result) {
    if (typeof result === "string" && result.trim()) return result.trim();
    if (result && typeof result.psbt === "string") return result.psbt.trim();
    if (result && typeof result.hex === "string") return result.hex.trim();
    throw new Error("The wallet did not return a signature.");
  }

  function foundWallets() {
    const out = [];
    if (window.unisat) out.push({ name: "UniSat", api: window.unisat });
    if (window.okxwallet && window.okxwallet.bitcoin) out.push({ name: "OKX", api: window.okxwallet.bitcoin });
    return out;
  }

  async function post(body) {
    const res = await fetch("/api/trade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(json.error || "That could not be done.");
    return json;
  }

  async function sign(psbt, indexes, sighash) {
    const toSignInputs = indexes.map(function (index) {
      return { index: index, address: address, sighashTypes: [sighash] };
    });
    return psbtOf(await wallet.signPsbt(psbt, { autoFinalized: false, toSignInputs: toSignInputs }));
  }

  function link(href, label) {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = label;
    return a;
  }

  function render(listings) {
    board.replaceChildren();
    if (!listings.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Nothing is for sale.";
      board.appendChild(empty);
      return;
    }
    const saved = tokens();
    listings.forEach(function (row) {
      if (!/^[a-f0-9]{64}i\d+$/.test(row.id || "")) return;
      const card = document.createElement("article");
      card.className = "sale";
      const image = /^image\/(png|jpeg|gif|webp)/i.test(row.contentType || "");
      if (image) {
        const img = document.createElement("img");
        img.alt = "Inscription " + String(row.id || "").slice(0, 8);
        img.src = "/api/ord?content=" + encodeURIComponent(row.id);
        card.appendChild(img);
      } else {
        const blank = document.createElement("div");
        blank.appendChild(link("https://ordinals.unisat.io/inscription/" + row.id, "Open"));
        card.appendChild(blank);
      }
      const text = document.createElement("div");
      const line = document.createElement("p");
      line.textContent = btc(row.priceSats);
      const meta = document.createElement("small");
      meta.textContent = short(row.seller) + " · " + row.value + " sats on the picture";
      const see = document.createElement("small");
      see.appendChild(link("https://ordinals.unisat.io/inscription/" + row.id, "See this inscription"));
      text.append(line, meta, see);
      const actions = document.createElement("div");
      actions.className = "actions";
      const buy = document.createElement("button");
      buy.type = "button";
      buy.className = "btn btc";
      buy.textContent = "Review buy";
      buy.addEventListener("click", function () { reviewBuy(row); });
      actions.appendChild(buy);
      if (address && row.seller === address && saved[row.id]) {
        const down = document.createElement("button");
        down.type = "button";
        down.className = "btn";
        down.textContent = "Take it down";
        down.addEventListener("click", function () { cancel(row.id, saved[row.id]); });
        actions.appendChild(down);
      }
      card.append(text, actions);
      board.appendChild(card);
    });
  }

  async function load() {
    try {
      const res = await fetch("/api/trade");
      const json = await res.json().catch(function () { return {}; });
      if (res.status === 503) {
        board.replaceChildren();
        const note = document.createElement("p");
        note.className = "empty";
        note.textContent = json.error || "The board is not available right now.";
        board.appendChild(note);
        return;
      }
      if (!res.ok) throw new Error(json.error || "The board could not be loaded.");
      render(Array.isArray(json.listings) ? json.listings : []);
    } catch (error) {
      board.replaceChildren();
      const note = document.createElement("p");
      note.className = "empty";
      note.textContent = error.message || "The board could not be loaded.";
      board.appendChild(note);
    }
  }

  async function useWallet(entry) {
    const accounts = await entry.api.requestAccounts();
    if (!accounts || !accounts[0]) throw new Error("The wallet did not share an address.");
    wallet = entry.api;
    address = accounts[0];
    walletNote.textContent = entry.name + " · " + short(address);
    connect.replaceChildren();
    sell.hidden = false;
    held.replaceChildren();
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Paste an id, or choose one";
    held.appendChild(blank);
    if (wallet.getInscriptions) {
      try {
        const page = await wallet.getInscriptions(0, 20);
        const list = page && page.list || [];
        list.forEach(function (item) {
          if (!item || !item.inscriptionId) return;
          const option = document.createElement("option");
          option.value = item.inscriptionId;
          option.textContent = item.inscriptionId.slice(0, 10) + "…" + item.inscriptionId.slice(-4);
          held.appendChild(option);
        });
      } catch (error) {
        /* a pasted id still works */
      }
    }
    load();
  }

  function arm(text, next) {
    pending = next;
    say(text);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btc";
    button.textContent = "Open wallet";
    button.addEventListener("click", async function () {
      if (busy || !pending) return;
      busy = true;
      button.disabled = true;
      try {
        await pending();
        pending = null;
      } catch (error) {
        say(error && error.message ? error.message : "The wallet did not sign.");
      } finally {
        busy = false;
      }
    });
    status.appendChild(document.createElement("br"));
    status.appendChild(button);
  }

  async function reviewSell(event) {
    event.preventDefault();
    if (!wallet) return say("Connect a wallet first.");
    if (busy) return;
    busy = true;
    pending = null;
    say("Checking that inscription…");
    try {
      const prepared = await post({
        op: "prepareSell",
        id: (held.value || iid.value || "").trim(),
        address: address,
        price: price.value.trim(),
      });
      busy = false;
      arm(
        "You are signing " + btc(prepared.priceSats) + " for this inscription. The wallet should show one picture and that price. Signing does not send the picture.",
        async function () {
          say("Waiting for the wallet…");
          const signed = await sign(prepared.psbt, prepared.sign, 131);
          const listed = await post({ op: "list", id: prepared.id, psbt: signed });
          if (listed.cancelToken) saveToken(prepared.id, listed.cancelToken);
          say("Listed at " + btc(prepared.priceSats) + ". Save this cancel code: " + listed.cancelToken);
          await load();
        }
      );
    } catch (error) {
      busy = false;
      say(error.message || "That listing could not be prepared.");
    }
  }

  async function reviewBuy(row) {
    if (!wallet) return say("Connect a wallet before buying.");
    if (busy) return;
    busy = true;
    pending = null;
    say("Checking the picture and your spare bitcoin…");
    try {
      const prepared = await post({ op: "prepareBuy", id: row.id, buyer: address });
      busy = false;
      if (prepared.needSplit) {
        arm(
          "This address needs two spare bitcoin outputs before it can buy. The split sends them back to you. Miner fee " + prepared.fee + " sats. This is not the purchase. Wait for one confirmation, then review the buy again.",
          async function () {
            say("Waiting for the wallet…");
            const signed = await sign(prepared.psbt, prepared.sign, 1);
            const sent = await post({ op: "split", psbt: signed, buyer: address });
            say("Split sent. Wait for one confirmation, then buy. ");
            status.appendChild(link("https://mempool.space/tx/" + sent.txid, sent.txid));
          }
        );
        return;
      }
      arm(
        "You are buying the inscription shown. Price " + btc(prepared.priceSats) + ". Miner fee " + prepared.fee + " sats. The picture and the bitcoin move together. This site does not take a fee.",
        async function () {
          say("Waiting for the wallet…");
          const signed = await sign(prepared.psbt, prepared.sign, 1);
          const sent = await post({ op: "broadcast", id: row.id, buyer: address, psbt: signed });
          say("Bought. ");
          status.appendChild(link("https://mempool.space/tx/" + sent.txid, sent.txid));
          await load();
        }
      );
    } catch (error) {
      busy = false;
      say(error.message || "That buy could not be prepared.");
    }
  }

  async function cancel(id, token) {
    if (busy) return;
    busy = true;
    say("Taking the listing down…");
    try {
      await post({ op: "cancel", id: id, token: token });
      const all = tokens();
      delete all[id];
      localStorage.setItem("orngCancel", JSON.stringify(all));
      say("That listing is down.");
      await load();
    } catch (error) {
      say(error.message || "The cancel code does not match.");
    } finally {
      busy = false;
    }
  }

  document.getElementById("sell-form").addEventListener("submit", reviewSell);
  document.getElementById("cancel-form").addEventListener("submit", function (event) {
    event.preventDefault();
    cancel(document.getElementById("cid").value.trim(), document.getElementById("code").value.trim());
  });
  held.addEventListener("change", function () { if (held.value) iid.value = held.value; });

  const wallets = foundWallets();
  if (!wallets.length) {
    walletNote.textContent = "No UniSat or OKX wallet was found in this browser. You can still look at the board.";
  } else {
    walletNote.textContent = "Connect a wallet to list. Anyone can look.";
    wallets.forEach(function (entry) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = "Connect " + entry.name;
      button.addEventListener("click", function () {
        useWallet(entry).catch(function (error) {
          say(error.message || "The wallet did not connect.");
        });
      });
      connect.appendChild(button);
    });
  }
  load();
})();
