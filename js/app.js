/* UI wiring for LykkeTall. */
"use strict";

(function () {
  const $ = (sel) => document.querySelector(sel);

  const state = {
    lotteryId: "lotto",
    /** draws per lottery id */
    history: { lotto: [], eurojackpot: [] },
    /** manual override of the last draw per lottery id (mains/stars) or null */
    lastDrawOverride: { lotto: null, eurojackpot: null },
    /** effective last draw for the active lottery, and its main-number set */
    lastDraw: null,
    lastDrawSet: new Set(),
    tickets: [],
    generatedFor: null
  };

  const STORAGE_KEY = "lykketall.v1";

  /* ---------- persistence ---------- */

  function saveState() {
    try {
      const serializable = {
        lotteryId: state.lotteryId,
        history: {},
        lastDrawOverride: state.lastDrawOverride,
        settings: collectSettings()
      };
      for (const id of Object.keys(state.history)) {
        serializable.history[id] = state.history[id].map((d) => ({
          date: d.date ? d.date.toISOString().slice(0, 10) : null,
          mains: d.mains,
          stars: d.stars
        }));
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
    } catch (e) {
      /* storage full or unavailable — non-fatal */
    }
  }

  function loadState() {
    let data;
    try {
      data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return;
    }
    if (!data) return;
    if (data.lotteryId && LOTTERIES[data.lotteryId]) state.lotteryId = data.lotteryId;
    if (data.history) {
      for (const id of Object.keys(state.history)) {
        const arr = data.history[id];
        if (!Array.isArray(arr)) continue;
        state.history[id] = arr
          .filter((d) => d && Array.isArray(d.mains))
          .map((d) => ({
            date: d.date ? new Date(d.date) : null,
            mains: d.mains,
            stars: Array.isArray(d.stars) ? d.stars : []
          }));
      }
    }
    if (data.lastDrawOverride && typeof data.lastDrawOverride === "object") {
      for (const id of Object.keys(state.lastDrawOverride)) {
        const o = data.lastDrawOverride[id];
        if (o && Array.isArray(o.mains)) {
          state.lastDrawOverride[id] = { mains: o.mains, stars: Array.isArray(o.stars) ? o.stars : [] };
        }
      }
    }
    if (data.settings) applySettings(data.settings);
  }

  const SETTING_IDS = [
    "crit-maxrun", "crit-maxrun-value",
    "crit-oddeven", "crit-oddeven-min", "crit-oddeven-max",
    "crit-sum", "crit-sum-min", "crit-sum-max",
    "crit-zone", "crit-zone-max", "crit-zone-min",
    "crit-parity", "crit-parity-value",
    "crit-pattern", "crit-pattern-max",
    "crit-birthday",
    "bias-overdue", "bias-overdue-strength",
    "bias-cold", "bias-cold-strength", "bias-cold-years",
    "crit-overlap", "crit-overlap-max",
    "crit-exclude", "crit-exclude-list",
    "crit-require", "crit-require-list",
    "hist-window", "hist-window-years",
    "hist-exact",
    "hist-subset", "hist-subset-size",
    "reuse-enabled", "reuse-min", "reuse-max"
  ];

  function collectSettings() {
    const out = {};
    for (const id of SETTING_IDS) {
      const el = document.getElementById(id);
      if (!el) continue;
      out[id] = el.type === "checkbox" ? el.checked : el.value;
    }
    return out;
  }

  function applySettings(settings) {
    for (const id of SETTING_IDS) {
      if (!(id in settings)) continue;
      const el = document.getElementById(id);
      if (!el) continue;
      if (el.type === "checkbox") el.checked = !!settings[id];
      else el.value = settings[id];
    }
  }

  /* ---------- criteria from form ---------- */

  function parseNumberList(text, max) {
    return (text.match(/\d+/g) || [])
      .map((t) => parseInt(t, 10))
      .filter((n) => n >= 1 && n <= max)
      .filter((n, i, arr) => arr.indexOf(n) === i);
  }

  function intVal(id, fallback) {
    const v = parseInt(document.getElementById(id).value, 10);
    return Number.isInteger(v) ? v : fallback;
  }

  function readCriteria(cfg) {
    return {
      maxRun: { enabled: $("#crit-maxrun").checked, value: intVal("crit-maxrun-value", 2) },
      oddEven: {
        enabled: $("#crit-oddeven").checked,
        minOdd: intVal("crit-oddeven-min", 0),
        maxOdd: intVal("crit-oddeven-max", cfg.mainPick)
      },
      sumRange: {
        enabled: $("#crit-sum").checked,
        min: intVal("crit-sum-min", cfg.defaultSumMin),
        max: intVal("crit-sum-max", cfg.defaultSumMax)
      },
      zoneSpread: {
        enabled: $("#crit-zone").checked,
        maxPerZone: intVal("crit-zone-max", 3),
        minPerZone: intVal("crit-zone-min", 0)
      },
      parityRun: { enabled: $("#crit-parity").checked, value: intVal("crit-parity-value", 3) },
      patternGuard: { enabled: $("#crit-pattern").checked, maxOccur: intVal("crit-pattern-max", 4) },
      birthdayBias: { enabled: $("#crit-birthday").checked },
      excludeNumbers: {
        enabled: $("#crit-exclude").checked,
        numbers: parseNumberList($("#crit-exclude-list").value, cfg.mainMax)
      },
      requireNumbers: {
        enabled: $("#crit-require").checked,
        numbers: parseNumberList($("#crit-require-list").value, cfg.mainMax)
      },
      batchOverlap: { enabled: $("#crit-overlap").checked, maxShared: intVal("crit-overlap-max", 4) },
      historyExact: { enabled: $("#hist-exact").checked },
      historySubset: { enabled: $("#hist-subset").checked },
      reuseLast: {
        enabled: $("#reuse-enabled").checked,
        min: Math.min(intVal("reuse-min", 0), intVal("reuse-max", 0)),
        max: Math.max(intVal("reuse-min", 0), intVal("reuse-max", 0)),
        numbers: state.lastDraw ? state.lastDraw.mains.slice() : []
      }
    };
  }

  function activeDraws() {
    const all = state.history[state.lotteryId];
    const years = $("#hist-window").checked ? intVal("hist-window-years", 0) : 0;
    return filterDrawsByYears(all, years);
  }

  /* ---------- lottery switching ---------- */

  function switchLottery(id) {
    const cfg = LOTTERIES[id];
    state.lotteryId = id;
    document.body.dataset.lottery = id;
    $("#switch-lotto").classList.toggle("active", id === "lotto");
    $("#switch-lotto").setAttribute("aria-selected", id === "lotto");
    $("#switch-eurojackpot").classList.toggle("active", id === "eurojackpot");
    $("#switch-eurojackpot").setAttribute("aria-selected", id === "eurojackpot");

    $("#content-title").textContent = `Your 10 rows — ${cfg.name}`;
    $("#content-sub").textContent =
      cfg.starPick > 0
        ? `${cfg.mainPick} numbers from 1–${cfg.mainMax} + ${cfg.starPick} star numbers from 1–${cfg.starMax} · draws ${cfg.drawDay}`
        : `${cfg.mainPick} numbers from 1–${cfg.mainMax} · draw every ${cfg.drawDay}`;

    // Refresh lottery-dependent defaults and bounds.
    $("#crit-sum-min").value = cfg.defaultSumMin;
    $("#crit-sum-max").value = cfg.defaultSumMax;
    $("#crit-oddeven-min").max = cfg.mainPick;
    $("#crit-oddeven-max").max = cfg.mainPick;
    if (intVal("crit-oddeven-max", cfg.mainPick) > cfg.mainPick) $("#crit-oddeven-max").value = cfg.mainPick;
    if (intVal("crit-oddeven-min", 0) > cfg.mainPick) $("#crit-oddeven-min").value = Math.max(0, cfg.mainPick - 5);
    $("#hist-subset-size").max = cfg.mainPick;
    if (intVal("hist-subset-size", 4) > cfg.mainPick) $("#hist-subset-size").value = cfg.mainPick - 1;

    // Reuse range spans 0..mainPick for this lottery.
    $("#reuse-min").max = cfg.mainPick;
    $("#reuse-max").max = cfg.mainPick;
    if (intVal("reuse-min", 0) > cfg.mainPick) $("#reuse-min").value = 0;
    if (intVal("reuse-max", 0) > cfg.mainPick) $("#reuse-max").value = cfg.mainPick;

    clearTickets();
    refreshHistoryStatus();
    refreshLastDraw();
    syncReuseUI();
    renderStats();
    saveState();
  }

  /* ---------- history ---------- */

  function addDraws(draws, sourceLabel) {
    if (!draws.length) {
      setHistoryStatus(`Could not find any valid ${LOTTERIES[state.lotteryId].name} draws in ${sourceLabel}. Check the format: one draw per line with a date and the winning numbers.`, false);
      return;
    }
    const before = state.history[state.lotteryId].length;
    state.history[state.lotteryId] = dedupeDraws(state.history[state.lotteryId].concat(draws));
    const added = state.history[state.lotteryId].length - before;
    refreshHistoryStatus(`Added ${added} new draw${added === 1 ? "" : "s"} from ${sourceLabel} (${draws.length - added} duplicates skipped).`);
    renderStats();
    refreshLastDraw();
    saveState();
  }

  function setHistoryStatus(text, loaded) {
    const el = $("#history-status");
    el.textContent = text;
    el.classList.toggle("loaded", !!loaded);
  }

  function refreshHistoryStatus(prefix) {
    const all = state.history[state.lotteryId];
    if (!all.length) {
      setHistoryStatus("No draws loaded.", false);
      return;
    }
    const active = activeDraws();
    const range = drawsDateRange(all);
    const fmt = (d) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const rangeText = range.min ? ` (${fmt(range.min)} – ${fmt(range.max)})` : "";
    const windowText =
      active.length === all.length ? "" : ` · ${active.length} within the active ${intVal("hist-window-years", 0)}-year window`;
    setHistoryStatus(`${prefix ? prefix + " " : ""}${all.length} ${LOTTERIES[state.lotteryId].name} draws loaded${rangeText}${windowText}.`, true);
  }

  /* ---------- last draw + reuse ---------- */

  /** Most recent dated draw in the full history (undated draws ignored). */
  function newestHistoryDraw() {
    let best = null;
    for (const d of state.history[state.lotteryId]) {
      if (!d.date) continue;
      if (!best || d.date > best.date) best = d;
    }
    return best;
  }

  /** Recompute the effective last draw (manual override wins) and redraw it. */
  function refreshLastDraw() {
    const id = state.lotteryId;
    const override = state.lastDrawOverride[id];
    const draw = override
      ? { date: null, mains: override.mains.slice(), stars: (override.stars || []).slice(), manual: true }
      : newestHistoryDraw();
    state.lastDraw = draw;
    state.lastDrawSet = new Set(draw ? draw.mains : []);
    renderLastDraw();
  }

  function renderLastDraw() {
    const cfg = LOTTERIES[state.lotteryId];
    const draw = state.lastDraw;
    const ballsWrap = $("#lastdraw-balls");
    const meta = $("#lastdraw-meta");
    if (!draw) {
      ballsWrap.innerHTML = '<span class="empty-note">No last draw yet — load history or press Edit to enter one.</span>';
      meta.textContent = "No last draw set.";
      return;
    }
    const mainBalls = draw.mains.map((n) => `<span class="ball">${n}</span>`).join("");
    const starBalls = draw.stars && draw.stars.length
      ? '<span class="star-sep">+</span>' + draw.stars.map((n) => `<span class="ball star">${n}</span>`).join("")
      : "";
    ballsWrap.innerHTML = mainBalls + starBalls;
    if (draw.manual) {
      meta.textContent = "Entered manually.";
    } else {
      const fmt = draw.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      meta.textContent = `Newest draw in your history — ${fmt}.`;
    }
  }

  function openLastDrawEditor() {
    const draw = state.lastDraw;
    $("#lastdraw-input").value = draw ? draw.mains.join(" ") + (draw.stars && draw.stars.length ? " + " + draw.stars.join(" ") : "") : "";
    $("#lastdraw-editor").hidden = false;
    $("#lastdraw-input").focus();
  }

  function saveLastDraw() {
    const cfg = LOTTERIES[state.lotteryId];
    const parsed = parseDrawLine($("#lastdraw-input").value, cfg);
    if (!parsed) {
      setHistoryStatus(`That does not look like a valid ${cfg.name} draw — enter ${cfg.mainPick} numbers from 1–${cfg.mainMax}${cfg.starPick ? ` and ${cfg.starPick} star numbers from 1–${cfg.starMax}` : ""}.`, false);
      return;
    }
    state.lastDrawOverride[state.lotteryId] = { mains: parsed.mains, stars: parsed.stars };
    $("#lastdraw-editor").hidden = true;
    refreshLastDraw();
    saveState();
  }

  function resetLastDraw() {
    state.lastDrawOverride[state.lotteryId] = null;
    $("#lastdraw-editor").hidden = true;
    refreshLastDraw();
    saveState();
  }

  /** Keep the two range thumbs ordered, paint the fill, update the summary. */
  function syncReuseUI() {
    const cfg = LOTTERIES[state.lotteryId];
    let lo = intVal("reuse-min", 0);
    let hi = intVal("reuse-max", 0);
    if (lo > hi) {
      // Snap whichever thumb the user is dragging past the other.
      [lo, hi] = [Math.min(lo, hi), Math.max(lo, hi)];
      $("#reuse-min").value = lo;
      $("#reuse-max").value = hi;
    }
    const max = cfg.mainPick;
    const fill = $("#reuse-fill");
    fill.style.left = (lo / max) * 100 + "%";
    fill.style.width = ((hi - lo) / max) * 100 + "%";
    const label = lo === hi ? `exactly <strong>${lo}</strong>` : `<strong>${lo}–${hi}</strong>`;
    const noun = hi === 1 && lo <= 1 ? "number" : "numbers";
    $("#reuse-summary").innerHTML = `Carry over ${label} of these ${noun} into each generated row.`;
    $("#reuse-body").classList.toggle("open", $("#reuse-enabled").checked);
  }

  /* ---------- crawl (2020-2026 results + CSV) ---------- */

  function downloadBlob(content, type, filename) {
    const blob = new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function crawlHistory() {
    const cfg = LOTTERIES[state.lotteryId];
    const btn = $("#history-crawl");
    btn.disabled = true;
    const oldLabel = btn.textContent;
    btn.textContent = "Crawling…";
    try {
      setHistoryStatus(`Crawling ${cfg.name} results 2020–2026…`, false);
      const { draws, source } = await crawlLottery(cfg, (requests, message) => {
        setHistoryStatus(message || `Crawling ${cfg.name} results 2020–2026… ${requests} requests so far`, false);
      });
      downloadBlob(buildResultsCsv(draws, cfg), "text/csv", cfg.crawl.csvName);
      addDraws(draws, `${source} — CSV "${cfg.crawl.csvName}" downloaded`);
    } catch (e) {
      setHistoryStatus(
        `Crawling failed (${e.message}). Paste the draws in the box below, or import a CSV/JSON file instead.`,
        false
      );
    } finally {
      btn.disabled = false;
      btn.textContent = oldLabel;
    }
  }

  function loadDemoData() {
    // Synthetic draws, clearly for trying out the exclusion filters.
    const cfg = LOTTERIES[state.lotteryId];
    const pool = [];
    for (let n = 1; n <= cfg.mainMax; n++) pool.push(n);
    const starPool = [];
    for (let n = 1; n <= cfg.starMax; n++) starPool.push(n);
    const draws = [];
    const today = new Date();
    for (let week = 1; week <= 8 * 52; week++) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - week * 7);
      draws.push({
        date,
        mains: sampleDistinct(pool, cfg.mainPick),
        stars: cfg.starPick > 0 ? sampleDistinct(starPool, cfg.starPick) : []
      });
    }
    addDraws(draws, "demo data (synthetic — not real results)");
  }

  /* ---------- stats ---------- */

  function renderStats() {
    const panel = $("#stats-panel");
    const draws = activeDraws();
    if (!draws.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const cfg = LOTTERIES[state.lotteryId];
    $("#stats-hint").textContent = `Main-number frequency across the ${draws.length} draws in the active window. Statistics are descriptive only — every number is equally likely next draw.`;
    const freq = numberFrequencies(draws, cfg);
    const maxFreq = Math.max(1, ...freq.slice(1));
    const chart = $("#freq-chart");
    chart.innerHTML = "";
    for (let n = 1; n <= cfg.mainMax; n++) {
      const bar = document.createElement("div");
      bar.className = "freq-bar";
      bar.style.height = `${Math.round((freq[n] / maxFreq) * 100)}%`;
      bar.dataset.tip = `${n}: ${freq[n]}×`;
      chart.appendChild(bar);
    }
    const ranked = [];
    for (let n = 1; n <= cfg.mainMax; n++) ranked.push([n, freq[n]]);
    ranked.sort((a, b) => b[1] - a[1]);
    const fmtList = (pairs) => pairs.map(([n, f]) => `${n} (${f}×)`).join(", ");
    $("#hot-numbers").textContent = fmtList(ranked.slice(0, 5));
    $("#cold-numbers").textContent = fmtList(ranked.slice(-5).reverse());
    const gaps = drawsSinceLastSeen(draws, cfg);
    const overdue = [];
    for (let n = 1; n <= cfg.mainMax; n++) overdue.push([n, gaps[n]]);
    overdue.sort((a, b) => b[1] - a[1]);
    $("#overdue-numbers").textContent = overdue
      .slice(0, 5)
      .map(([n, g]) => `${n} (${g >= draws.length ? "never" : g + " draws ago"})`)
      .join(", ");
  }

  /* ---------- generation & rendering ---------- */

  /* ---------- sampling bias (sliders) ----------
     Slider 0-100 maps to a weight multiplier of up to 9x for the most
     overdue / least-drawn number, scaling linearly down to 1x for numbers
     with no claim to a boost. Both biases multiply together. */

  const MAX_BIAS_MULTIPLIER = 8; // 0-100 % -> extra weight 0..8 on top of 1

  function computeBiasWeights(cfg) {
    const overdueOn = $("#bias-overdue").checked && intVal("bias-overdue-strength", 0) > 0;
    const coldOn = $("#bias-cold").checked && intVal("bias-cold-strength", 0) > 0;
    if (!overdueOn && !coldOn) return { weights: null, warnings: [] };

    const all = state.history[state.lotteryId];
    if (!all.length) {
      return {
        weights: null,
        warnings: ["The overdue/rarely-picked sliders are active, but no historical draws are loaded — they have no effect yet."]
      };
    }

    const warnings = [];
    const weights = new Array(cfg.mainMax + 1).fill(1);

    if (overdueOn) {
      const gaps = drawsSinceLastSeen(activeDraws(), cfg);
      const maxGap = Math.max(1, ...gaps.slice(1));
      const k = (intVal("bias-overdue-strength", 0) / 100) * MAX_BIAS_MULTIPLIER;
      for (let n = 1; n <= cfg.mainMax; n++) {
        weights[n] *= 1 + k * (gaps[n] / maxGap);
      }
    }

    if (coldOn) {
      const periodDraws = filterDrawsByYears(all, intVal("bias-cold-years", 2));
      if (!periodDraws.length) {
        warnings.push("Rarely-picked slider: no loaded draws fall within the chosen period, so it has no effect.");
      } else {
        const freq = numberFrequencies(periodDraws, cfg);
        const maxF = Math.max(...freq.slice(1));
        const minF = Math.min(...freq.slice(1));
        const span = Math.max(1, maxF - minF);
        const k = (intVal("bias-cold-strength", 0) / 100) * MAX_BIAS_MULTIPLIER;
        for (let n = 1; n <= cfg.mainMax; n++) {
          weights[n] *= 1 + k * ((maxF - freq[n]) / span);
        }
      }
    }

    return { weights, warnings };
  }

  function clearTickets() {
    state.tickets = [];
    $("#tickets").innerHTML =
      '<div class="empty-state"><p>Press <strong>Generate 10 rows</strong> to pick your numbers.</p></div>';
    $("#warnings").hidden = true;
    for (const id of ["btn-copy", "btn-csv", "btn-print"]) $("#" + id).disabled = true;
  }

  function generate() {
    const cfg = LOTTERIES[state.lotteryId];
    const criteria = readCriteria(cfg);
    const subsetSize = criteria.historySubset.enabled ? intVal("hist-subset-size", 4) : 0;
    const historyIndex = buildHistoryIndex(activeDraws(), subsetSize);

    const preWarnings = [];
    if ((criteria.historyExact.enabled || criteria.historySubset.enabled) && historyIndex.drawCount === 0) {
      preWarnings.push("History-based exclusions are on, but no historical draws are loaded for this lottery — they have no effect yet.");
    }
    const bias = computeBiasWeights(cfg);
    preWarnings.push(...bias.warnings);

    const { tickets, warnings } = generateTickets(10, cfg, criteria, historyIndex, bias.weights);
    state.tickets = tickets;
    state.generatedFor = cfg.id;

    const allWarnings = preWarnings.concat(warnings);
    if (allWarnings.length) showWarnings(allWarnings, tickets.length === 0);
    else $("#warnings").hidden = true;
    renderTickets(cfg);
    saveState();
  }

  function showWarnings(messages, isError) {
    const el = $("#warnings");
    el.hidden = false;
    el.classList.toggle("error", !!isError);
    el.innerHTML = messages.map((m) => `<div>⚠ ${escapeHtml(m)}</div>`).join("");
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function renderTickets(cfg) {
    const wrap = $("#tickets");
    wrap.innerHTML = "";
    if (!state.tickets.length) {
      wrap.innerHTML = '<div class="empty-state"><p>No rows could be generated — loosen the criteria and try again.</p></div>';
      for (const id of ["btn-copy", "btn-csv", "btn-print"]) $("#" + id).disabled = true;
      return;
    }
    // Highlight numbers carried over from the last draw only when reuse is on.
    const highlight = $("#reuse-enabled").checked ? state.lastDrawSet : new Set();
    state.tickets.forEach((t, i) => {
      const card = document.createElement("div");
      card.className = "ticket";
      card.style.setProperty("--i", i);
      const balls = t.mains
        .map((n) => `<span class="ball${highlight.has(n) ? " carried" : ""}"${highlight.has(n) ? ' title="Carried over from the last draw"' : ""}>${n}</span>`)
        .join("");
      const stars = t.stars.length
        ? `<span class="star-sep">+</span>` + t.stars.map((n) => `<span class="ball star">${n}</span>`).join("")
        : "";
      const carried = highlight.size ? t.mains.filter((n) => highlight.has(n)).length : 0;
      const reuseFlag = carried ? `<span class="ticket-flag" title="Numbers reused from the last draw">↻ ${carried}</span>` : "";
      const flag = t.relaxed ? '<span class="ticket-flag" title="Style criteria were relaxed for this row">relaxed</span>' : "";
      card.innerHTML = `<span class="ticket-no">#${i + 1}</span><span class="ticket-balls">${balls}${stars}</span>${reuseFlag}${flag}`;
      wrap.appendChild(card);
    });
    for (const id of ["btn-copy", "btn-csv", "btn-print"]) $("#" + id).disabled = false;
  }

  function ticketsAsText() {
    const cfg = LOTTERIES[state.generatedFor || state.lotteryId];
    const lines = [`${cfg.name} — generated ${new Date().toLocaleDateString("en-GB")}`];
    state.tickets.forEach((t, i) => {
      const stars = t.stars.length ? `  +  ${t.stars.join(" ")}` : "";
      lines.push(`Row ${String(i + 1).padStart(2)}: ${t.mains.map((n) => String(n).padStart(2)).join(" ")}${stars}`);
    });
    return lines.join("\n");
  }

  async function copyTickets() {
    try {
      await navigator.clipboard.writeText(ticketsAsText());
      flashButton($("#btn-copy"), "Copied ✓");
    } catch (e) {
      flashButton($("#btn-copy"), "Copy failed");
    }
  }

  function flashButton(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    setTimeout(() => (btn.textContent = old), 1500);
  }

  function downloadCsv() {
    const cfg = LOTTERIES[state.generatedFor || state.lotteryId];
    const header = ["row", ...Array.from({ length: cfg.mainPick }, (_, i) => `n${i + 1}`)];
    for (let i = 0; i < cfg.starPick; i++) header.push(`star${i + 1}`);
    const rows = state.tickets.map((t, i) => [i + 1, ...t.mains, ...t.stars].join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${cfg.id}-rows-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- event wiring ---------- */

  function syncCriterionBodies() {
    for (const body of document.querySelectorAll(".criterion-body")) {
      const checkbox = document.getElementById(body.dataset.for);
      if (checkbox) body.classList.toggle("open", checkbox.checked);
    }
  }

  function init() {
    loadState();

    $("#switch-lotto").addEventListener("click", () => switchLottery("lotto"));
    $("#switch-eurojackpot").addEventListener("click", () => switchLottery("eurojackpot"));

    for (const [slider, out] of [["bias-overdue-strength", "bias-overdue-out"], ["bias-cold-strength", "bias-cold-out"]]) {
      const el = document.getElementById(slider);
      const sync = () => (document.getElementById(out).textContent = el.value + " %");
      el.addEventListener("input", sync);
      sync();
    }

    document.body.addEventListener("change", (e) => {
      if (e.target.matches("input")) {
        syncCriterionBodies();
        if (e.target.id === "hist-window" || e.target.id === "hist-window-years") {
          refreshHistoryStatus();
          renderStats();
        }
        saveState();
      }
    });

    $("#btn-generate").addEventListener("click", generate);
    $("#btn-copy").addEventListener("click", copyTickets);
    $("#btn-csv").addEventListener("click", downloadCsv);
    $("#btn-print").addEventListener("click", () => window.print());

    $("#history-parse").addEventListener("click", () => {
      const text = $("#history-paste").value;
      if (!text.trim()) {
        setHistoryStatus("Paste some draws first.", false);
        return;
      }
      addDraws(parseDraws(text, LOTTERIES[state.lotteryId]), "the pasted text");
      $("#history-paste").value = "";
    });
    $("#history-file").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      addDraws(parseDraws(text, LOTTERIES[state.lotteryId]), `"${file.name}"`);
      e.target.value = "";
    });
    $("#history-crawl").addEventListener("click", crawlHistory);
    $("#history-demo").addEventListener("click", loadDemoData);
    $("#history-clear").addEventListener("click", () => {
      state.history[state.lotteryId] = [];
      refreshHistoryStatus();
      renderStats();
      refreshLastDraw();
      saveState();
    });

    // Last draw editor + reuse dual-range.
    $("#lastdraw-edit").addEventListener("click", openLastDrawEditor);
    $("#lastdraw-save").addEventListener("click", saveLastDraw);
    $("#lastdraw-cancel").addEventListener("click", () => ($("#lastdraw-editor").hidden = true));
    $("#lastdraw-reset").addEventListener("click", resetLastDraw);
    $("#lastdraw-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveLastDraw();
    });
    for (const id of ["reuse-enabled", "reuse-min", "reuse-max"]) {
      document.getElementById(id).addEventListener("input", syncReuseUI);
    }

    switchLottery(state.lotteryId);
    syncCriterionBodies();
    syncReuseUI();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
