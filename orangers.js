(function () {
  const OPEN_AT = Date.parse("2026-11-02T00:00:00.000Z");
  const grid = document.getElementById("grid");
  const pick = document.getElementById("pick");
  const count = document.getElementById("count");
  const hat = document.getElementById("hat");
  const glasses = document.getElementById("glasses");
  const color = document.getElementById("color");
  const mhat = document.getElementById("mhat");
  const mglasses = document.getElementById("mglasses");
  const mcolor = document.getElementById("mcolor");
  const clock = document.getElementById("clock");
  const title = document.getElementById("mint-title");
  let people = [];
  let chosen = 0;
  let opened = false;
  let timer = 0;
  let minters = new Set();
  let listLoaded = false;
  const mintersReady = fetch("/img/orangers/minters.json")
    .then(function (res) { if (!res.ok) throw new Error("missing"); return res.json(); })
    .then(function (data) {
      const rows = data && Array.isArray(data.addresses) ? data.addresses : [];
      rows.forEach(function (address) {
        if (typeof address === "string" && address) minters.add(address.toLowerCase());
      });
      listLoaded = minters.size > 0;
    })
    .catch(function () { listLoaded = false; });

  function fill(select, values, any) {
    if (any) {
      const all = document.createElement("option");
      all.value = "";
      all.textContent = "Any";
      select.appendChild(all);
    }
    values.forEach(function (value) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
  }

  function unique(key) {
    return [...new Set(people.map(function (person) { return person[key]; }).filter(Boolean))].sort();
  }

  function matches(person) {
    if (hat.value && person.hat !== hat.value) return false;
    if (glasses.value && person.glasses !== glasses.value) return false;
    if (color.value && person.color !== color.value) return false;
    return /^\d{2,3}\.png$/.test(person.file);
  }

  function show(person) {
    chosen = person.n;
    pick.replaceChildren();
    const img = document.createElement("img");
    img.src = "/img/orangers/" + person.file;
    img.alt = person.caption;
    img.width = 416;
    img.height = 394;
    const text = document.createElement("div");
    const title = document.createElement("p");
    title.textContent = "Picture " + person.n;
    const about = document.createElement("small");
    about.textContent = person.caption;
    text.append(title, about);
    pick.append(img, text);
    draw();
  }

  function draw() {
    const shown = people.filter(matches);
    count.textContent = shown.length + " of 100";
    grid.replaceChildren();
    shown.forEach(function (person) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "card" + (person.n === chosen ? " on" : "");
      const img = document.createElement("img");
      img.src = "/img/orangers/" + person.file;
      img.alt = person.caption;
      img.width = 416;
      img.height = 394;
      const cap = document.createElement("span");
      const name = document.createElement("b");
      name.textContent = String(person.n);
      const small = document.createElement("small");
      small.textContent = person.hat + " · " + person.glasses + " · " + person.color;
      cap.append(name, small);
      button.append(img, cap);
      button.addEventListener("click", function () { show(person); });
      grid.appendChild(button);
    });
  }

  function sats(dollars, btcUsd) {
    return Math.round(dollars * 100 * 1e8 / Math.round(btcUsd * 100));
  }

  async function rate() {
    const slot = document.getElementById("rate");
    try {
      const res = await fetch("/api/crc?p=stats");
      if (!res.ok) return;
      const json = await res.json();
      const data = json && json.ok === true && "data" in json ? json.data : json;
      const btcUsd = Number(data && data.btc_usd);
      if (!Number.isFinite(btcUsd) || btcUsd <= 0) return;
      const today = sats(9, btcUsd);
      if (!Number.isInteger(today) || today < 1) return;
      slot.textContent = "$9 is " + today.toLocaleString("en-US") + " sats today.";
    } catch (error) {
      /* the agreed dollar prices stay on the page without a sat figure */
    }
  }

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function wallets() {
    const out = [];
    if (window.unisat) out.push({ name: "UniSat", api: window.unisat });
    if (window.okxwallet && window.okxwallet.bitcoin) out.push({ name: "OKX", api: window.okxwallet.bitcoin });
    return out;
  }

  function short(address) {
    return address.slice(0, 8) + "…" + address.slice(-6);
  }

  function previewMint() {
    const box = document.getElementById("mint-preview");
    const fit = document.getElementById("mint-fit");
    const hits = people.filter(function (person) {
      return person.hat === mhat.value && person.glasses === mglasses.value && person.color === mcolor.value;
    });
    box.replaceChildren();
    if (!hits.length) {
      box.hidden = true;
      fit.textContent = "None of the hundred use this mix.";
      return;
    }
    const person = hits[0];
    const img = document.createElement("img");
    img.src = "/img/orangers/" + person.file;
    img.alt = person.caption;
    img.width = 416;
    img.height = 394;
    const text = document.createElement("div");
    const line = document.createElement("p");
    line.textContent = "Picture " + person.n;
    const about = document.createElement("small");
    about.textContent = person.caption;
    text.append(line, about);
    box.append(img, text);
    box.hidden = false;
    fit.textContent = hits.length === 1 ? "" : hits.length + " pictures use this mix.";
  }

  async function connect(entry) {
    const who = document.getElementById("mint-who");
    try {
      const accounts = await entry.api.requestAccounts();
      const address = accounts && accounts[0] ? String(accounts[0]).trim().toLowerCase() : "";
      if (!/^bc1[a-z0-9]{20,}$/.test(address)) throw new Error("The wallet did not share an address.");
      await mintersReady;
      if (!listLoaded) {
        who.textContent = short(address) + " · the free list did not load. $9 in bitcoin, or $7.20 in $ORNG.";
        return;
      }
      who.textContent = minters.has(address)
        ? short(address) + " minted $ORNG. One picture is free."
        : short(address) + " pays $9 in bitcoin, or $7.20 in $ORNG.";
    } catch (error) {
      who.textContent = error && error.message ? error.message : "The wallet did not connect.";
    }
  }

  function openMint() {
    if (opened) return;
    opened = true;
    title.textContent = "Mint is open";
    clock.hidden = true;
    document.getElementById("when").hidden = true;
    document.getElementById("mint-open").hidden = false;
    if (people.length) previewMint();
    clearInterval(timer);
    const connectBox = document.getElementById("mint-connect");
    const found = wallets();
    const who = document.getElementById("mint-who");
    if (!found.length) {
      who.textContent = "No UniSat or OKX wallet was found in this browser.";
      return;
    }
    found.forEach(function (entry) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn" + (entry.name === "UniSat" ? " btc" : "");
      button.textContent = entry.name;
      button.addEventListener("click", function () { connect(entry); });
      connectBox.appendChild(button);
    });
  }

  function tick() {
    const left = OPEN_AT - Date.now();
    if (left <= 0) {
      clearInterval(timer);
      openMint();
      return;
    }
    const total = Math.floor(left / 1000);
    const days = Math.floor(total / 86400);
    const hours = Math.floor(total % 86400 / 3600);
    const minutes = Math.floor(total % 3600 / 60);
    const seconds = total % 60;
    clock.textContent = days + "d " + pad(hours) + "h " + pad(minutes) + "m " + pad(seconds) + "s";
  }

  hat.addEventListener("change", draw);
  glasses.addEventListener("change", draw);
  color.addEventListener("change", draw);
  mhat.addEventListener("change", previewMint);
  mglasses.addEventListener("change", previewMint);
  mcolor.addEventListener("change", previewMint);

  fetch("/img/orangers/people.json")
    .then(function (res) { if (!res.ok) throw new Error("missing"); return res.json(); })
    .then(function (rows) {
      people = Array.isArray(rows) ? rows : [];
      fill(hat, unique("hat"), true);
      fill(glasses, unique("glasses"), true);
      fill(color, unique("color"), true);
      fill(mhat, unique("hat"), false);
      fill(mglasses, unique("glasses"), false);
      fill(mcolor, unique("color"), false);
      if (people[0]) {
        show(people[0]);
        mhat.value = people[0].hat;
        mglasses.value = people[0].glasses;
        mcolor.value = people[0].color;
      } else count.textContent = "The pictures could not be loaded.";
      if (opened) previewMint();
    })
    .catch(function () { count.textContent = "The pictures could not be loaded."; });
  rate();
  tick();
  if (!opened) timer = setInterval(tick, 1000);
})();
