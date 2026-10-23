(() => {
  const DDRAGON = "https://ddragon.leagueoflegends.com";
  const ROLES = ["Top", "Jungle", "Mid", "Bot", "Support"];
  const TAGS = ["All", "Fighter", "Tank", "Mage", "Assassin", "Marksman", "Support"];
  const SIDES = ["blue", "red"];
  const cfg = window.BP_CONFIG;

  // Quick mode: after a pick, jump to the next empty slot in pick order B1 R1 R2 B2 B3 R3 R4 B4 B5 R5.
  const QUICK_ORDER = [["blue",0],["red",0],["red",1],["blue",1],["blue",2],["red",2],["red",3],["blue",3],["blue",4],["red",4]];

  // Pro (tournament) draft order: ban phase 1, pick phase 1, ban phase 2, pick phase 2.
  const DRAFT_SEQ = [
    ["blue", "ban"], ["red", "ban"], ["blue", "ban"], ["red", "ban"], ["blue", "ban"], ["red", "ban"],
    ["blue", "pick"], ["red", "pick"], ["red", "pick"], ["blue", "pick"], ["blue", "pick"], ["red", "pick"],
    ["red", "ban"], ["blue", "ban"], ["red", "ban"], ["blue", "ban"],
    ["red", "pick"], ["blue", "pick"], ["blue", "pick"], ["red", "pick"],
  ];

  const emptyPicks = () => ({ blue: Array(5).fill(null), red: Array(5).fill(null) });
  const newGame = (blueTeam) => ({
    blueTeam,                       // index into series.teams of the team on blue side
    picks: emptyPicks(),            // role-ordered, like quick mode
    bans: { blue: [], red: [] },
    history: [],                    // [{ side, type, champ }] in draft order, for undo
    swapSel: null,                  // { side, index } of a pick selected for a role swap
    prediction: null,               // { blue, red } once predicted
  });

  const state = {
    champions: [], // { id, key, name, tags, img }
    search: "",
    tag: "All",
    mode: "quick",
    quick: { picks: emptyPicks(), active: { side: "blue", index: 0 } },
    setup: { format: 3 },
    series: null, // { format, teams: [a, b], wins: [0, 0], games: [...finished], game, winner }
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const grid = $("grid");
  const statusEl = $("status");
  const predictBtn = $("predict");

  // ---- Data loading -------------------------------------------------------
  async function loadChampions() {
    const versions = await fetch(`${DDRAGON}/api/versions.json`).then((r) => r.json());
    const version = versions[0];
    const data = await fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`).then((r) => r.json());
    state.champions = Object.values(data.data)
      .map((c) => ({
        id: c.id,
        key: Number(c.key),
        name: c.name,
        tags: c.tags,
        img: `${DDRAGON}/cdn/${version}/img/champion/${c.image.full}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---- Derived state ------------------------------------------------------
  const isDraft = () => state.mode === "draft";
  const game = () => (state.series ? state.series.game : null);
  const board = () => (isDraft() ? (game() ? game().picks : emptyPicks()) : state.quick.picks);
  const allPicks = () => [...board().blue, ...board().red];
  const isFull = () => allPicks().every(Boolean);
  const winsNeeded = () => Math.ceil(state.series.format / 2);
  const teamOn = (side) => {
    const s = state.series, g = game();
    if (!s || !g) return side === "blue" ? "Blue" : "Red";
    return s.teams[side === "blue" ? g.blueTeam : 1 - g.blueTeam];
  };

  // Current draft step, or null when the draft is complete / series over / not started.
  function currentStep() {
    const s = state.series, g = game();
    if (!isDraft() || !s || !g || s.winner !== null) return null;
    const step = DRAFT_SEQ[g.history.length];
    if (!step) return null;
    const [side, type] = step;
    const n = g.history.filter((h) => h.side === side && h.type === type).length;
    return { side, type, n, index: type === "pick" ? g.picks[side].indexOf(null) : g.bans[side].length };
  }

  // Champions picked in earlier games of the series -> game number (fearless lock).
  function fearlessLocks() {
    const locks = new Map();
    if (!state.series) return locks;
    state.series.games.forEach((g, i) => {
      for (const side of SIDES) for (const c of g.picks[side]) locks.set(c.id, i + 1);
    });
    return locks;
  }

  // Why a champion can't be chosen right now: { cls, title } or null if available.
  function unavailable(c, locks) {
    for (const side of SIDES) {
      if (board()[side].some((p) => p && p.id === c.id)) return { cls: `taken by-${side}`, title: `picked by ${side}` };
    }
    if (!isDraft()) return null;
    const g = game();
    if (g) for (const side of SIDES) {
      if (g.bans[side].some((b) => b.id === c.id)) return { cls: "taken banned", title: `banned by ${side}` };
    }
    if (locks.has(c.id)) return { cls: "taken locked", title: `fearless: picked in game ${locks.get(c.id)}`, badge: `G${locks.get(c.id)}` };
    return null;
  }

  // ---- Rendering ----------------------------------------------------------
  function renderMode() {
    document.body.classList.toggle("mode-draft", isDraft());
    document.body.classList.toggle("mode-quick", !isDraft());
    for (const b of document.querySelectorAll(".modes [role=tab]")) {
      b.setAttribute("aria-selected", String(b.dataset.mode === state.mode));
    }
    $("reset").textContent = isDraft() ? "Restart game" : "Reset draft";
  }

  function renderSeries() {
    const s = state.series;
    $("series-setup").hidden = !!s;
    $("series-live").hidden = !s;
    for (const b of $("format").children) {
      b.setAttribute("aria-checked", String(Number(b.dataset.format) === state.setup.format));
    }
    if (!s) return;
    const g = game();
    const gameNo = s.games.length + (s.winner === null ? 1 : 0);
    $("series-meta").textContent = `BO${s.format} · ${s.winner === null ? `Game ${gameNo}` : "Final"} · fearless`;
    $("score-a").textContent = s.teams[0];
    $("score-b").textContent = s.teams[1];
    $("score-nums").textContent = `${s.wins[0]} – ${s.wins[1]}`;

    const turn = $("turn");
    const step = currentStep();
    turn.className = "turn";
    if (s.winner !== null) {
      turn.textContent = `${s.teams[s.winner]} win the series ${Math.max(...s.wins)}–${Math.min(...s.wins)}`;
      turn.classList.add("done");
    } else if (step) {
      turn.textContent = `${teamOn(step.side)} (${step.side}) — ${step.type === "ban" ? "Ban" : "Pick"} ${step.n + 1}`;
      turn.classList.add(step.side);
    } else {
      turn.textContent = "Draft complete — predict, then record the winner";
      turn.classList.add("done");
    }
    $("swap-sides").disabled = !g || g.history.length > 0 || s.winner !== null;
    $("undo").disabled = !g || g.history.length === 0 || s.winner !== null;
  }

  function renderTeams() {
    const showNames = isDraft() && state.series;
    $("blue-team").textContent = showNames ? teamOn("blue") : "";
    $("red-team").textContent = showNames ? teamOn("red") : "";
  }

  function renderBans() {
    const g = game();
    const step = currentStep();
    for (const side of SIDES) {
      const wrap = $(`${side}-bans`);
      wrap.innerHTML = "";
      for (let i = 0; i < 5; i++) {
        const c = g ? g.bans[side][i] : null;
        const d = document.createElement("div");
        const active = step && step.type === "ban" && step.side === side && step.index === i;
        d.className = "ban" + (c ? " filled" : "") + (active ? " active" : "");
        d.title = c ? `Ban: ${c.name}` : `Ban ${i + 1}`;
        if (c) d.innerHTML = `<img src="${c.img}" alt="${esc(c.name)} (banned)">`;
        wrap.appendChild(d);
      }
    }
  }

  function renderSlots() {
    const picks = board();
    const step = currentStep();
    const g = game();
    for (const side of SIDES) {
      const list = $(`${side}-slots`);
      list.innerHTML = "";
      picks[side].forEach((pick, i) => {
        const li = document.createElement("li");
        const isActive = isDraft()
          ? step && step.type === "pick" && step.side === side && step.index === i
          : state.quick.active.side === side && state.quick.active.index === i;
        const isSwap = isDraft() && g && g.swapSel && g.swapSel.side === side && g.swapSel.index === i;
        li.className = "slot" + (isActive ? " active" : "") + (pick ? " filled" : "") + (isSwap ? " swap" : "");
        li.tabIndex = 0;
        li.innerHTML = `
          <div class="portrait" ${pick ? `style="background-image:url('${pick.img}')"` : ""}></div>
          <div class="info">
            <div class="role">${ROLES[i]}</div>
            <div class="name ${pick ? "" : "empty"}">${pick ? esc(pick.name) : isDraft() ? "—" : "Select champion"}</div>
          </div>
          ${isDraft() ? "" : `<button class="clear" title="Remove" aria-label="Remove pick">×</button>`}`;
        const activate = () => (isDraft() ? swapClick(side, i) : setActive(side, i));
        li.addEventListener("click", activate);
        li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } });
        const clear = li.querySelector(".clear");
        if (clear) clear.addEventListener("click", (e) => {
          e.stopPropagation();
          state.quick.picks[side][i] = null;
          setActive(side, i);
        });
        list.appendChild(li);
      });
    }
  }

  function renderTags() {
    const wrap = $("tags");
    wrap.innerHTML = "";
    for (const t of TAGS) {
      const b = document.createElement("button");
      b.className = "tag" + (state.tag === t ? " on" : "");
      b.textContent = t;
      b.addEventListener("click", () => { state.tag = t; renderTags(); renderGrid(); });
      wrap.appendChild(b);
    }
  }

  function renderGrid() {
    if (!state.champions.length) return;
    const q = state.search.trim().toLowerCase();
    const list = state.champions.filter(
      (c) => (state.tag === "All" || c.tags.includes(state.tag)) &&
             (!q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
    );
    grid.innerHTML = "";
    grid.classList.toggle("inactive", isDraft() && !currentStep());
    if (!list.length) { grid.innerHTML = `<p class="muted">No champions match.</p>`; return; }
    const locks = fearlessLocks();
    const frag = document.createDocumentFragment();
    for (const c of list) {
      const why = unavailable(c, locks);
      const b = document.createElement("button");
      b.className = "champ" + (why ? ` ${why.cls}` : "");
      b.title = why ? `${c.name} (${why.title})` : c.name;
      b.disabled = !!why;
      b.innerHTML = `<img loading="lazy" src="${c.img}" alt="">${why && why.badge ? `<em class="badge">${why.badge}</em>` : ""}<span>${esc(c.name)}</span>`;
      b.addEventListener("click", () => choose(c));
      frag.appendChild(b);
    }
    grid.appendChild(frag);
  }

  function renderRecord() {
    const s = state.series;
    const canRecord = isDraft() && s && s.winner === null && isFull();
    $("blue-won").textContent = `${teamOn("blue")} (blue) won`;
    $("red-won").textContent = `${teamOn("red")} (red) won`;
    $("blue-won").disabled = !canRecord;
    $("red-won").disabled = !canRecord;
  }

  function renderHistory() {
    const wrap = $("history");
    const s = state.series;
    if (!s || !s.games.length) { wrap.innerHTML = ""; return; }
    const icons = (list, cls = "") => list.map((c) => `<img class="${cls}" src="${c.img}" alt="${esc(c.name)}" title="${esc(c.name)}">`).join("");
    wrap.innerHTML = `<h3>Series history</h3>` + s.games.map((g, i) => {
      const blueName = s.teams[g.blueTeam], redName = s.teams[1 - g.blueTeam];
      const winnerName = g.winner === "blue" ? blueName : redName;
      const pred = g.prediction ? `Model: ${(g.prediction.blue * 100).toFixed(1)}% blue` : "Not predicted";
      return `
        <div class="game-row">
          <div class="game-head"><strong>Game ${i + 1}</strong><span class="muted">${esc(pred)}</span><span>${esc(winnerName)} won</span></div>
          <div class="game-sides">
            <div class="gside blue ${g.winner === "blue" ? "won" : ""}">
              <span class="gname">${esc(blueName)}</span>
              <div class="icons">${icons(g.picks.blue)}</div>
              <div class="icons bans-mini">${icons(g.bans.blue, "banned")}</div>
            </div>
            <div class="gside red ${g.winner === "red" ? "won" : ""}">
              <span class="gname">${esc(redName)}</span>
              <div class="icons">${icons(g.picks.red)}</div>
              <div class="icons bans-mini">${icons(g.bans.red, "banned")}</div>
            </div>
          </div>
        </div>`;
    }).join("");
  }

  function render() {
    renderMode();
    renderSeries();
    renderTeams();
    renderBans();
    renderSlots();
    renderGrid();
    renderRecord();
    renderHistory();
    predictBtn.disabled = !isFull();
    $("reset").disabled = isDraft() && (!game() || state.series.winner !== null);
    if (!statusEl.classList.contains("busy")) setStatus(statusText());
  }

  function statusText() {
    const n = allPicks().filter(Boolean).length;
    if (!isDraft()) return isFull() ? "Draft complete." : `${n}/10 picks selected.`;
    const s = state.series;
    if (!s) return "Choose a format and team names, then start the series.";
    if (s.winner !== null) return "Series over. Start a new series to draft again.";
    const g = game();
    const locked = fearlessLocks().size;
    const lockMsg = locked ? ` · ${locked} champions fearless-locked` : "";
    if (isFull()) return `Click two picks on the same side to swap roles${lockMsg}.`;
    return `${g.history.length}/${DRAFT_SEQ.length} draft actions${lockMsg}.`;
  }

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", isError);
  }

  function invalidatePrediction() {
    $("result").hidden = true;
    if (game()) game().prediction = null;
  }

  // ---- Interaction --------------------------------------------------------
  function setActive(side, index) {
    state.quick.active = { side, index };
    render();
  }

  function choose(champ) {
    if (unavailable(champ, fearlessLocks())) return;
    if (isDraft()) return draftAction(champ);
    const { side, index } = state.quick.active;
    state.quick.picks[side][index] = champ;
    const next = QUICK_ORDER.find(([s, i]) => !state.quick.picks[s][i]);
    if (next) state.quick.active = { side: next[0], index: next[1] };
    invalidatePrediction();
    render();
  }

  function draftAction(champ) {
    const step = currentStep();
    if (!step) return;
    const g = game();
    if (step.type === "pick") g.picks[step.side][step.index] = champ;
    else g.bans[step.side].push(champ);
    g.history.push({ side: step.side, type: step.type, champ });
    g.swapSel = null;
    invalidatePrediction();
    render();
  }

  function undo() {
    const g = game();
    if (!g || !g.history.length || state.series.winner !== null) return;
    const last = g.history.pop();
    if (last.type === "pick") {
      const i = g.picks[last.side].findIndex((p) => p && p.id === last.champ.id);
      g.picks[last.side][i] = null;
    } else {
      g.bans[last.side].pop();
    }
    g.swapSel = null;
    invalidatePrediction();
    render();
  }

  // Draft picks fill roles in pick order; click two picks on the same side to swap their roles.
  function swapClick(side, index) {
    const g = game();
    if (!g || state.series.winner !== null || !g.picks[side][index]) return;
    const sel = g.swapSel;
    if (sel && sel.side === side && sel.index !== index) {
      const p = g.picks[side];
      [p[sel.index], p[index]] = [p[index], p[sel.index]];
      g.swapSel = null;
      invalidatePrediction();
    } else {
      g.swapSel = sel && sel.side === side && sel.index === index ? null : { side, index };
    }
    render();
  }

  function startSeries() {
    const name = (id, fallback) => $(id).value.trim() || fallback;
    let teams = [name("team-a", "Team A"), name("team-b", "Team B")];
    if (teams[0] === teams[1]) teams = [`${teams[0]} (1)`, `${teams[1]} (2)`];
    state.series = { format: state.setup.format, teams, wins: [0, 0], games: [], game: newGame(0), winner: null };
    invalidatePrediction();
    render();
  }

  function newSeries() {
    const s = state.series;
    const inProgress = s && s.winner === null && (s.games.length || game().history.length);
    if (inProgress && !confirm("Abandon the current series?")) return;
    state.series = null;
    invalidatePrediction();
    render();
  }

  function recordWinner(side) {
    const s = state.series, g = game();
    if (!s || s.winner !== null || !isFull()) return;
    const team = side === "blue" ? g.blueTeam : 1 - g.blueTeam;
    s.wins[team]++;
    s.games.push({ ...g, winner: side, swapSel: null });
    if (s.wins[team] >= winsNeeded()) {
      s.winner = team;
    } else {
      // the losing team usually takes blue side for the next game; "Swap sides" overrides
      s.game = newGame(1 - team);
      $("result").hidden = true;
    }
    render();
  }

  function swapSides() {
    const g = game();
    if (!g || g.history.length) return;
    g.blueTeam = 1 - g.blueTeam;
    render();
  }

  function resetBoard() {
    if (isDraft()) {
      const s = state.series;
      if (!s || s.winner !== null) return;
      s.game = newGame(game().blueTeam);
    } else {
      state.quick = { picks: emptyPicks(), active: { side: "blue", index: 0 } };
    }
    invalidatePrediction();
    render();
  }

  function setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    $("result").hidden = true;
    // restore a prediction that was already made for the current draft game
    if (isDraft() && game() && game().prediction) showResult(game().prediction);
    render();
  }

  async function predict() {
    const { blue, red } = board();
    const g = isDraft() ? game() : null;
    predictBtn.disabled = true;
    statusEl.classList.add("busy");
    setStatus("Predicting…");
    try {
      // bans are intentionally not sent: the model only sees picks, region and tier
      const res = await fetch(cfg.API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg.buildPayload(blue, red, $("region").value, $("tier").value)),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      const result = cfg.parseResponse(JSON.parse(text));
      if (g) g.prediction = result;
      if (!g || g === game()) showResult(result);
      statusEl.classList.remove("busy");
      setStatus("Prediction received.");
    } catch (err) {
      const hint = err instanceof TypeError ? " (is the backend running, and does it allow CORS from this page?)" : "";
      statusEl.classList.remove("busy");
      setStatus(`Prediction failed: ${err.message}${hint}`, true);
    } finally {
      predictBtn.disabled = !isFull();
      renderRecord();
    }
  }

  function showResult({ blue, red }) {
    const total = blue + red || 1;
    const b = (blue / total) * 100;
    const r = 100 - b;
    const blueName = isDraft() && state.series ? `${teamOn("blue")} (blue)` : "Blue";
    const redName = isDraft() && state.series ? `${teamOn("red")} (red)` : "Red";
    $("blue-result-name").textContent = blueName;
    $("red-result-name").textContent = redName;
    $("blue-pct").textContent = `${(blue * 100).toFixed(1)}%`;
    $("red-pct").textContent = `${(red * 100).toFixed(1)}%`;
    $("result").hidden = false;
    // set widths on next frame so the transition animates
    $("blue-bar").style.width = "50%";
    $("red-bar").style.width = "50%";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $("blue-bar").style.width = `${b}%`;
      $("red-bar").style.width = `${r}%`;
    }));
    const diff = Math.abs(blue - red) * 100;
    $("verdict").textContent =
      diff < 2 ? "Even match — too close to call."
      : `${blue > red ? blueName : redName} ${isDraft() && state.series ? "are" : "side is"} favoured by ${diff.toFixed(1)} points.`;
  }

  // ---- Init ---------------------------------------------------------------
  // Custom dropdown so options can show icons. Exposes `el.value` and fires
  // "change" on the container, like a native <select>.
  function createDropdown(el, options, selected) {
    const id = el.id;
    const iconHtml = (o) => (o.icon ? `<img class="dd-icon" src="${o.icon}" alt="">` : "");
    el.innerHTML = `
      <button type="button" class="dd-button" aria-haspopup="listbox" aria-expanded="false"
              aria-labelledby="${id}-label ${id}-btn" id="${id}-btn"></button>
      <ul class="dd-list" role="listbox" tabindex="-1" aria-labelledby="${id}-label">
        ${options.map((o, i) => `<li class="dd-option" role="option" id="${id}-opt-${i}" data-i="${i}">${iconHtml(o)}<span>${o.label}</span></li>`).join("")}
      </ul>`;
    const btn = el.querySelector(".dd-button");
    btn.innerHTML = `<img class="dd-icon" alt="" hidden><span class="dd-label"></span>`;
    const btnIcon = btn.querySelector(".dd-icon");
    const btnLabel = btn.querySelector(".dd-label");
    const list = el.querySelector(".dd-list");
    const items = [...list.children];
    let index = Math.max(0, options.findIndex((o) => o.value === selected));
    let focus = index;

    Object.defineProperty(el, "value", { get: () => options[index].value });

    function paint() {
      const o = options[index];
      // update in place: replacing the button's children would detach a clicked
      // node mid-click, making the outside-click handler close the menu again
      if (o.icon) btnIcon.src = o.icon;
      btnIcon.hidden = !o.icon;
      btnLabel.textContent = o.label;
      items.forEach((li, i) => {
        li.setAttribute("aria-selected", String(i === index));
        li.classList.toggle("focused", i === focus);
      });
      list.setAttribute("aria-activedescendant", `${id}-opt-${focus}`);
    }
    function open() {
      document.querySelectorAll(".dropdown.open").forEach((d) => d !== el && d.close());
      el.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      focus = index; paint();
      list.focus();
      items[focus].scrollIntoView({ block: "nearest" });
    }
    function close(refocus = true) {
      if (!el.classList.contains("open")) return;
      el.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
      if (refocus) btn.focus();
    }
    function choose(i) {
      const changed = i !== index;
      index = i; close(); paint();
      if (changed) el.dispatchEvent(new Event("change"));
    }
    el.close = () => close(false);

    btn.addEventListener("click", () => (el.classList.contains("open") ? close() : open()));
    btn.addEventListener("keydown", (e) => {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); open(); }
    });
    list.addEventListener("click", (e) => {
      const li = e.target.closest(".dd-option");
      if (li) choose(Number(li.dataset.i));
    });
    list.addEventListener("keydown", (e) => {
      const moves = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity };
      if (e.key in moves) {
        e.preventDefault();
        focus = Math.min(options.length - 1, Math.max(0, focus + moves[e.key]));
        paint();
        items[focus].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(focus); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Tab") close(false);
    });
    const label = $(`${id}-label`);
    if (label) {
      label.style.cursor = "pointer";
      label.addEventListener("click", (e) => { e.stopPropagation(); open(); });
    }
    document.addEventListener("click", (e) => { if (!e.composedPath().includes(el)) close(false); });

    // a different region/tier means the shown prediction no longer applies
    el.addEventListener("change", invalidatePrediction);
    paint();
  }
  createDropdown($("region"), cfg.REGIONS, cfg.DEFAULT_REGION);
  createDropdown($("tier"), cfg.TIERS, cfg.DEFAULT_TIER);

  $("search").addEventListener("input", (e) => { state.search = e.target.value; renderGrid(); });
  $("search").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const first = grid.querySelector(".champ:not(.taken)");
    if (first) { first.click(); e.target.value = ""; state.search = ""; renderGrid(); }
  });
  predictBtn.addEventListener("click", predict);
  $("reset").addEventListener("click", resetBoard);
  for (const b of document.querySelectorAll(".modes [role=tab]")) b.addEventListener("click", () => setMode(b.dataset.mode));
  for (const b of $("format").children) {
    b.addEventListener("click", () => { state.setup.format = Number(b.dataset.format); renderSeries(); });
  }
  $("start-series").addEventListener("click", startSeries);
  $("new-series").addEventListener("click", newSeries);
  $("undo").addEventListener("click", undo);
  $("swap-sides").addEventListener("click", swapSides);
  $("blue-won").addEventListener("click", () => recordWinner("blue"));
  $("red-won").addEventListener("click", () => recordWinner("red"));

  renderTags();
  render();
  loadChampions()
    .then(render)
    .catch((err) => {
      grid.innerHTML = `<p class="muted">Could not load champion data from Riot Data Dragon: ${err.message}</p>`;
    });
})();
