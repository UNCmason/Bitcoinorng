(function () {
  const grid = document.getElementById("grid");
  const pick = document.getElementById("pick");
  const count = document.getElementById("count");
  const hat = document.getElementById("hat");
  const glasses = document.getElementById("glasses");
  const color = document.getElementById("color");
  let people = [];
  let chosen = 0;

  function fill(select, values) {
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "Any";
    select.appendChild(all);
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
      slot.textContent = "Today's reading: $9 is " + today.toLocaleString("en-US") + " sats. This is not a charge.";
    } catch (error) {
      /* the agreed dollar prices stay on the page without a sat figure */
    }
  }

  hat.addEventListener("change", draw);
  glasses.addEventListener("change", draw);
  color.addEventListener("change", draw);

  fetch("/img/orangers/people.json")
    .then(function (res) { if (!res.ok) throw new Error("missing"); return res.json(); })
    .then(function (rows) {
      people = Array.isArray(rows) ? rows : [];
      fill(hat, unique("hat"));
      fill(glasses, unique("glasses"));
      fill(color, unique("color"));
      if (people[0]) show(people[0]);
      else count.textContent = "The pictures could not be loaded.";
    })
    .catch(function () { count.textContent = "The pictures could not be loaded."; });
  rate();
})();
