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
    generatedFor: null,
    /** price per row in NOK per lottery (user-editable) */
    rowPrice: { lotto: LOTTERIES.lotto.defaultRowPrice, eurojackpot: LOTTERIES.eurojackpot.defaultRowPrice },
    /** where loaded draws came from, per lottery: [{ kind, label, count, at }] */
    provenance: { lotto: [], eurojackpot: [] },
    /** report from the last automatic collection, per lottery */
    lastCollect: { lotto: null, eurojackpot: null },
    /** active preset id, or "custom" once the user changes a rule */
    preset: null,
    /** which collapsible panels are open */
    panelsOpen: {}
  };

  const STORAGE_KEY = "lykketall.v1";

  /* ---------- persistence ---------- */

  let panelsRestored = false;

  function saveState() {
    // Read panel state from the DOM rather than trusting the async "toggle"
    // event, which can fire after another save.
    if (panelsRestored) {
      for (const d of document.querySelectorAll("details[data-panel]")) state.panelsOpen[d.dataset.panel] = d.open;
    }
    try {
      const serializable = {
        lotteryId: state.lotteryId,
        history: {},
        lastDrawOverride: state.lastDrawOverride,
        settings: collectSettings(),
        rowPrice: state.rowPrice,
        provenance: state.provenance,
        preset: state.preset,
        panelsOpen: state.panelsOpen,
        tickets: state.tickets,
        generatedFor: state.generatedFor,
        lastCollect: state.lastCollect
      };
      for (const id of Object.keys(state.history)) {
        serializable.history[id] = state.history[id].map((d) => ({
          date: d.date ? isoDateKey(d.date) : null,
          mains: d.mains,
          stars: d.stars,
          bonus: d.bonus && d.bonus.length ? d.bonus : undefined,
          source: d.source || undefined,
          drawId: d.drawId || undefined
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
            date: d.date ? parseIsoDate(d.date) || new Date(d.date) : null,
            mains: d.mains,
            stars: Array.isArray(d.stars) ? d.stars : [],
            bonus: Array.isArray(d.bonus) ? d.bonus : [],
            source: typeof d.source === "string" ? d.source : "unknown",
            drawId: Number.isInteger(d.drawId) ? d.drawId : null
          }));
      }
    }
    if (data.lastDrawOverride && typeof data.lastDrawOverride === "object") {
      for (const id of Object.keys(state.lastDrawOverride)) {
        const o = data.lastDrawOverride[id];
        if (o && Array.isArray(o.mains)) {
          state.lastDrawOverride[id] = {
            mains: o.mains,
            stars: Array.isArray(o.stars) ? o.stars : [],
            manual: !!o.manual,
            date: typeof o.date === "string" ? o.date : undefined
          };
        }
      }
    }
    if (data.settings) applySettings(data.settings);
    if (data.rowPrice && typeof data.rowPrice === "object") {
      for (const id of Object.keys(state.rowPrice)) {
        const v = Number(data.rowPrice[id]);
        if (Number.isFinite(v) && v >= 0) state.rowPrice[id] = v;
      }
    }
    if (data.provenance && typeof data.provenance === "object") {
      for (const id of Object.keys(state.provenance)) {
        if (Array.isArray(data.provenance[id])) state.provenance[id] = data.provenance[id].slice(-8);
      }
    }
    if (typeof data.preset === "string") state.preset = data.preset;
    if (data.lastCollect && typeof data.lastCollect === "object") {
      for (const id of Object.keys(state.lastCollect)) if (data.lastCollect[id]) state.lastCollect[id] = data.lastCollect[id];
    }
    if (data.panelsOpen && typeof data.panelsOpen === "object") state.panelsOpen = data.panelsOpen;
    if (Array.isArray(data.tickets) && data.generatedFor && LOTTERIES[data.generatedFor]) {
      state.tickets = data.tickets.filter((t) => t && Array.isArray(t.mains)).map((t) => ({
        mains: t.mains,
        stars: Array.isArray(t.stars) ? t.stars : [],
        relaxed: !!t.relaxed,
        relaxedRules: Array.isArray(t.relaxedRules) ? t.relaxedRules : [],
        locked: !!t.locked
      }));
      state.generatedFor = data.generatedFor;
    }
  }

  const SETTING_IDS = [
    "crit-maxrun", "crit-maxrun-value",
    "crit-oddeven", "crit-oddeven-min", "crit-oddeven-max",
    "crit-sum", "crit-sum-min", "crit-sum-max",
    "crit-zone", "crit-zone-max", "crit-zone-min",
    "crit-parity", "crit-parity-value",
    "crit-arith", "crit-arith-value",
    "ap-lastdigit", "ap-lastdigit-max",
    "ap-multiple", "ap-multiple-max",
    "ap-lowhigh", "ap-lowhigh-low", "ap-lowhigh-high",
    "crit-birthday",
    "bias-overdue", "bias-overdue-strength",
    "bias-cold", "bias-cold-strength", "bias-cold-years",
    "crit-overlap", "crit-overlap-max",
    "crit-exclude", "crit-exclude-list",
    "crit-require", "crit-require-list",
    "hist-window", "hist-window-years",
    "hist-exact",
    "hist-subset", "hist-subset-size",
    "auto-update",
    "reuse-enabled", "reuse-min", "reuse-max",
    "row-count"
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
      maxArithmetic: { enabled: $("#crit-arith").checked, value: intVal("crit-arith-value", 3) },
      sameLastDigit: { enabled: $("#ap-lastdigit").checked, max: intVal("ap-lastdigit-max", 3) },
      sharedMultiple: { enabled: $("#ap-multiple").checked, max: intVal("ap-multiple-max", 4) },
      lowHigh: {
        enabled: $("#ap-lowhigh").checked,
        minLow: intVal("ap-lowhigh-low", 1),
        minHigh: intVal("ap-lowhigh-high", 1)
      },
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
        // Reuse is a shared setting but the last draw is per lottery: without
        // one, the rule is skipped (with a warning) instead of blocking.
        enabled: $("#reuse-enabled").checked && !!state.lastDraw,
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

  function rowCount() {
    return Math.max(1, Math.min(50, intVal("row-count", 10)));
  }

  function updateGenerateLabel() {
    const n = rowCount();
    $("#btn-generate").textContent = `⟳ Generate ${n} row${n === 1 ? "" : "s"}`;
  }

  /** `initial` is true on page load: keep the user's saved values instead of
      resetting lottery-dependent defaults. */
  function switchLottery(id, initial) {
    const cfg = LOTTERIES[id];
    const changed = !initial && state.lotteryId !== id;
    state.lotteryId = id;
    document.body.dataset.lottery = id;
    $("#switch-lotto").classList.toggle("active", id === "lotto");
    $("#switch-lotto").setAttribute("aria-selected", id === "lotto");
    $("#switch-eurojackpot").classList.toggle("active", id === "eurojackpot");
    $("#switch-eurojackpot").setAttribute("aria-selected", id === "eurojackpot");

    $("#content-title").textContent = `Your rows — ${cfg.name}`;
    const odds = jackpotCombinations(cfg).toLocaleString("en-GB");
    $("#content-sub").textContent =
      (cfg.starPick > 0
        ? `${cfg.mainPick} numbers from 1–${cfg.mainMax} + ${cfg.starPick} star numbers from 1–${cfg.starMax} · draws ${cfg.drawDay}`
        : `${cfg.mainPick} numbers from 1–${cfg.mainMax} · draw every ${cfg.drawDay}`) +
      ` · jackpot odds 1 in ${odds} per row`;
    $("#row-price").value = state.rowPrice[id];

    // Refresh lottery-dependent defaults and bounds (only on a real switch,
    // so saved settings survive a reload).
    if (changed) {
      $("#crit-sum-min").value = cfg.defaultSumMin;
      $("#crit-sum-max").value = cfg.defaultSumMax;
      if (state.preset && PRESETS[state.preset]) applyPreset(state.preset, true);
    }
    $("#crit-oddeven-min").max = cfg.mainPick;
    $("#crit-oddeven-max").max = cfg.mainPick;
    if (intVal("crit-oddeven-max", cfg.mainPick) > cfg.mainPick) $("#crit-oddeven-max").value = cfg.mainPick;
    if (intVal("crit-oddeven-min", 0) > cfg.mainPick) $("#crit-oddeven-min").value = Math.max(0, cfg.mainPick - 5);
    $("#hist-subset-size").max = cfg.mainPick;
    if (intVal("hist-subset-size", 4) > cfg.mainPick) $("#hist-subset-size").value = cfg.mainPick - 1;

    // Anti-pattern bounds depend on how many numbers a row holds.
    for (const id of ["crit-arith-value", "ap-lastdigit-max", "ap-multiple-max", "ap-lowhigh-low", "ap-lowhigh-high"]) {
      $("#" + id).max = cfg.mainPick;
    }
    if (intVal("crit-arith-value", 3) > cfg.mainPick) $("#crit-arith-value").value = cfg.mainPick;
    if (intVal("ap-lastdigit-max", 3) > cfg.mainPick) $("#ap-lastdigit-max").value = cfg.mainPick;
    if (intVal("ap-multiple-max", 4) > cfg.mainPick) $("#ap-multiple-max").value = cfg.mainPick;

    // Reuse range spans 0..mainPick for this lottery.
    $("#reuse-min").max = cfg.mainPick;
    $("#reuse-max").max = cfg.mainPick;
    if (intVal("reuse-min", 0) > cfg.mainPick) $("#reuse-min").value = 0;
    if (intVal("reuse-max", 0) > cfg.mainPick) $("#reuse-max").value = cfg.mainPick;

    // Keep restored rows on load if they belong to this lottery.
    if (initial && state.generatedFor === id && state.tickets.length) {
      refreshLastDraw();
      renderTickets(cfg);
    } else {
      clearTickets();
      refreshLastDraw();
    }
    refreshHistoryStatus();
    syncReuseUI();
    renderStats();
    renderProvenance();
    renderCoverage();
    renderFreshness();
    $("#fetch-banner").hidden = true;
    const lc = state.lastCollect[id];
    if (lc && lc.sources) renderSourceStatus(lc.sources.map((x) => Object.assign({ errors: [] }, x)), true);
    else { $("#source-status").innerHTML = ""; $("#source-status-wrap").hidden = true; delete $("#source-status-wrap").dataset.done; }
    updatePanelCounts();
    scheduleStrictness();
    saveState();
  }

  /* ---------- history ---------- */

  const PROVENANCE_KINDS = {
    "nt-api-v2": "Norsk Tipping's results API",
    "bundled-csv": "the dataset shipped with the app",
    "thirdparty-csv": "an independent public dataset",
    "nt-api-legacy": "Norsk Tipping's legacy API",
    crawl: "unofficial Norsk Tipping data (crawled)",
    paste: "draws you pasted",
    file: "an imported file",
    demo: "synthetic demo data — not real results"
  };

  function addDraws(draws, sourceLabel, kind) {
    if (kind) for (const d of draws) if (!d.source) d.source = kind === "paste" ? "manual" : kind;
    if (!draws.length) {
      setHistoryStatus(`Could not find any valid ${LOTTERIES[state.lotteryId].name} draws in ${sourceLabel}. Check the format: one draw per line with a date and the winning numbers.`, false);
      return;
    }
    const before = state.history[state.lotteryId].length;
    state.history[state.lotteryId] = dedupeDraws(state.history[state.lotteryId].concat(draws));
    const added = state.history[state.lotteryId].length - before;
    refreshHistoryStatus(`Added ${added} new draw${added === 1 ? "" : "s"} from ${sourceLabel} (${draws.length - added} duplicates skipped).`);
    if (kind) {
      state.provenance[state.lotteryId].push({ kind, label: sourceLabel, count: added, at: new Date().toISOString() });
      state.provenance[state.lotteryId] = state.provenance[state.lotteryId].slice(-8);
    }
    renderStats();
    refreshLastDraw();
    renderProvenance();
    renderCoverage();
    renderFreshness();
    updatePanelCounts();
    scheduleStrictness();
    saveState();
  }

  /** Where the loaded data came from, how much of the date range it covers,
      and when it was loaded — shown next to everything that depends on it. */
  function provenanceSummary() {
    const id = state.lotteryId;
    const cfg = LOTTERIES[id];
    const all = state.history[id];
    if (!all.length) return null;
    const entries = state.provenance[id];
    const kinds = [...new Set(entries.map((e) => e.kind))];
    const range = drawsDateRange(all);
    const fmt = (d) => d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
    const last = entries.length ? new Date(entries[entries.length - 1].at) : null;

    let coverage = null;
    const dated = all.filter((d) => d.date).length;
    if (range.min && range.max && dated > 10) {
      const weeks = (range.max - range.min) / (7 * 86400000) + 1;
      coverage = Math.min(1, dated / (weeks * cfg.drawsPerWeek));
    }
    const sources = kinds.length ? kinds.map((k) => PROVENANCE_KINDS[k] || k).join(" + ") : "earlier sessions";
    let text = `<strong>Source:</strong> ${sources} · ${all.length} draws`;
    if (range.min) text += ` · ${fmt(range.min)} – ${fmt(range.max)}`;
    if (last) text += ` · loaded ${last.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
    let level = "ok";
    if (kinds.includes("demo")) {
      level = "demo";
      text += ". Includes synthetic demo data, so statistics here are not real.";
    } else if (kinds.some((k) => k === "thirdparty-csv" || k === "nt-api-legacy" || k === "crawl")) {
      level = "caution";
      text += ". Partly from unofficial sources — check important numbers against Norsk Tipping.";
    } else if (kinds.includes("nt-api-v2") || kinds.includes("bundled-csv")) {
      text += ". Official draw data via Norsk Tipping's results API.";
    }
    if (coverage !== null && coverage < 0.85) {
      level = level === "demo" ? "demo" : "caution";
      text += ` Covers only about ${Math.round(coverage * 100)}% of the draws expected in this period — the data may be incomplete.`;
    }
    return { text, level };
  }

  function renderProvenance() {
    const p = provenanceSummary();
    for (const el of [$("#history-provenance"), $("#stats-provenance")]) {
      if (!p) {
        el.hidden = true;
        continue;
      }
      el.hidden = false;
      el.innerHTML = p.text;
      el.classList.toggle("caution", p.level === "caution");
      el.classList.toggle("demo", p.level === "demo");
    }
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
    let draw;
    if (override) {
      draw = {
        date: override.date ? new Date(override.date) : null,
        mains: override.mains.slice(),
        stars: (override.stars || []).slice(),
        source: override.manual ? "manual" : "picked"
      };
    } else {
      draw = newestHistoryDraw();
      if (draw) draw = { ...draw, source: "newest" };
    }
    state.lastDraw = draw;
    state.lastDrawSet = new Set(draw ? draw.mains : []);
    renderLastDraw();
  }

  function renderLastDraw() {
    const draw = state.lastDraw;
    const ballsWrap = $("#lastdraw-balls");
    const meta = $("#lastdraw-meta");
    if (!draw) {
      ballsWrap.innerHTML = '<span class="empty-note">No last draw yet — press Edit to pick a date from loaded results or enter numbers manually.</span>';
      meta.textContent = "No last draw set.";
      return;
    }
    const mainBalls = draw.mains.map((n) => `<span class="ball">${n}</span>`).join("");
    const starBalls = draw.stars && draw.stars.length
      ? '<span class="star-sep">+</span>' + draw.stars.map((n) => `<span class="ball star">${n}</span>`).join("")
      : "";
    ballsWrap.innerHTML = mainBalls + starBalls;
    const fmt = draw.date
      ? draw.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      : null;
    if (draw.source === "manual") {
      meta.textContent = "Entered manually.";
    } else if (draw.source === "picked") {
      meta.textContent = `Selected result${fmt ? ` — ${fmt}` : ""}.`;
    } else {
      const f = freshnessInfo(LOTTERIES[state.lotteryId]);
      meta.innerHTML = `Newest result in your history${fmt ? ` — ${fmt}` : ""}.` +
        (f.stale ? ` <span class="stale">About ${f.missingSince} newer draw${f.missingSince === 1 ? "" : "s"} not loaded yet.</span>` : "");
    }
  }

  /** Dated draws from the loaded results, newest first. */
  function datedHistory() {
    return state.history[state.lotteryId]
      .filter((d) => d.date)
      .slice()
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  /** Fill the date dropdown from the loaded results (each option carries the
      draw's numbers so picking a date loads that exact draw). */
  function populateLastDrawDates() {
    const cfg = LOTTERIES[state.lotteryId];
    const select = $("#lastdraw-date");
    const dated = datedHistory();
    select.innerHTML = "";
    if (!dated.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No dated results loaded";
      select.appendChild(opt);
      select.disabled = true;
      $("#lastdraw-date-hint").textContent = "Load results first (Crawl, paste, or import a CSV/JSON), then pick a date here.";
      return;
    }
    select.disabled = false;
    dated.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      const fmt = d.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      const stars = d.stars && d.stars.length ? "  + " + d.stars.join(" ") : "";
      opt.textContent = `${fmt}${i === 0 ? "  (latest)" : ""} — ${d.mains.join(" ")}${stars}`;
      select.appendChild(opt);
    });
    select.value = "0";
    $("#lastdraw-date-hint").textContent = `${dated.length} dated result${dated.length === 1 ? "" : "s"} available — the latest is preselected.`;
  }

  function setEditorMode(mode) {
    const history = mode === "history";
    $("#lastdraw-tab-history").classList.toggle("active", history);
    $("#lastdraw-tab-manual").classList.toggle("active", !history);
    $("#lastdraw-pane-history").hidden = !history;
    $("#lastdraw-pane-manual").hidden = history;
    if (history) {
      $("#lastdraw-date").focus();
    } else {
      $("#lastdraw-input").focus();
    }
  }

  function openLastDrawEditor() {
    const cfg = LOTTERIES[state.lotteryId];
    const draw = state.lastDraw;
    $("#lastdraw-input").value = draw ? draw.mains.join(" ") + (draw.stars && draw.stars.length ? " + " + draw.stars.join(" ") : "") : "";
    $("#lastdraw-manual-hint").textContent = `Enter ${cfg.mainPick} numbers from 1–${cfg.mainMax}${cfg.starPick ? `, then a + and ${cfg.starPick} star numbers from 1–${cfg.starMax}` : ""}.`;
    populateLastDrawDates();
    // Default to the history picker when results are loaded, else manual entry.
    setEditorMode(datedHistory().length ? "history" : "manual");
    $("#lastdraw-editor").hidden = false;
  }

  function saveLastDraw() {
    const cfg = LOTTERIES[state.lotteryId];
    const manualMode = !$("#lastdraw-pane-manual").hidden;
    if (manualMode) {
      const parsed = parseDrawLine($("#lastdraw-input").value, cfg);
      if (!parsed) {
        setHistoryStatus(`That does not look like a valid ${cfg.name} draw — enter ${cfg.mainPick} numbers from 1–${cfg.mainMax}${cfg.starPick ? ` and ${cfg.starPick} star numbers from 1–${cfg.starMax}` : ""}.`, false);
        return;
      }
      state.lastDrawOverride[state.lotteryId] = { mains: parsed.mains, stars: parsed.stars, manual: true };
    } else {
      const dated = datedHistory();
      const idx = parseInt($("#lastdraw-date").value, 10);
      if (!dated.length || !Number.isInteger(idx) || !dated[idx]) {
        setHistoryStatus("No dated result selected — load results or switch to manual entry.", false);
        return;
      }
      const d = dated[idx];
      // Picking the latest reverts to the auto-derived last draw; any older
      // date is stored as an explicit override (with its date for the label).
      state.lastDrawOverride[state.lotteryId] = idx === 0
        ? null
        : { mains: d.mains.slice(), stars: (d.stars || []).slice(), date: d.date.toISOString().slice(0, 10) };
    }
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
    $("#reuse-min").setAttribute("aria-valuetext", `at least ${lo}`);
    $("#reuse-max").setAttribute("aria-valuetext", `at most ${hi}`);
    $("#reuse-body").classList.toggle("open", $("#reuse-enabled").checked);
  }

  /* ---------- automatic collection with fallback chain ---------- */

  function downloadBlob(content, type, filename) {
    const blob = new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** Period the app wants data for: the lookback window (or 10 years), never before launch. */
  function wantedRange(cfg) {
    const today = new Date();
    const years = $("#hist-window").checked ? Math.max(1, intVal("hist-window-years", 5)) : 10;
    let from = new Date(today.getFullYear() - years, today.getMonth(), today.getDate());
    const launch = parseIsoDate(cfg.launch);
    if (launch && from < launch) from = launch;
    return { from, to: today };
  }

  function renderSourceStatus(sources, done) {
    const list = $("#source-status");
    list.innerHTML = "";
    for (const src of sources) {
      const li = document.createElement("li");
      li.className = `src src-${src.status}`;
      const icon = { ok: "✓", failed: "✗", empty: "–", skipped: "·", running: "…" }[src.status] || "·";
      const detail = src.status === "ok"
        ? `${src.draws} draw${src.draws === 1 ? "" : "s"}${src.windows ? ` from ${src.windows} request${src.windows === 1 ? "" : "s"}` : ""}`
        : src.note || (src.errors[0] ? src.errors[0] : src.status);
      li.innerHTML = `<span class="src-icon" aria-hidden="true">${icon}</span><span class="src-label">${escapeHtml(src.label)}</span><span class="src-detail">${escapeHtml(detail)}</span>`;
      if (src.errors.length > 1) li.title = src.errors.join("\n");
      list.appendChild(li);
    }
    $("#source-status-wrap").hidden = !sources.length;
    if (done) $("#source-status-wrap").dataset.done = "true";
  }

  async function fetchHistoryChain() {
    const cfg = LOTTERIES[state.lotteryId];
    const id = cfg.id;
    const btn = $("#history-crawl");
    btn.disabled = true;
    const oldLabel = btn.textContent;
    btn.textContent = "Fetching…";
    $("#crawl-progress").hidden = false;
    delete $("#source-status-wrap").dataset.done;
    $("#source-status").innerHTML = "";
    const range = wantedRange(cfg);
    showFetchBanner("running", `Fetching ${cfg.name} results…`, `${isoDateKey(range.from)} → ${isoDateKey(range.to)}, trying Norsk Tipping first, then the fallback sources.`);
    try {
      setHistoryStatus(`Fetching ${cfg.name} results ${isoDateKey(range.from)} → ${isoDateKey(range.to)}…`, false);
      const before = state.history[id].length;
      const result = await collectHistory(cfg, range, state.history[id], (msg, sources) => {
        setHistoryStatus(msg, false);
        renderSourceStatus(sources, false);
        showFetchBanner("running", `Fetching ${cfg.name} results…`, msg, sources);
      });
      state.history[id] = result.draws;
      const added = result.draws.length - before;
      state.lastCollect[id] = {
        at: new Date().toISOString(),
        from: isoDateKey(range.from),
        to: isoDateKey(range.to),
        sources: result.sources.map((x) => ({ id: x.id, label: x.label, status: x.status, draws: x.draws, windows: x.windows, note: x.note, errors: x.errors.slice(0, 5) })),
        conflicts: result.conflicts.length,
        missingWeeks: result.coverage.totals.missing,
        partialWeeks: result.coverage.totals.partial
      };
      for (const src of result.sources) {
        if (src.draws > 0) state.provenance[id].push({ kind: src.id, label: src.label, count: src.draws, at: new Date().toISOString() });
      }
      state.provenance[id] = state.provenance[id].slice(-8);
      renderSourceStatus(result.sources, true);
      const t = result.coverage.totals;
      const okSources = result.sources.filter((x) => x.status === "ok").map((x) => x.label);
      refreshHistoryStatus(
        `Fetched ${added} new draw${added === 1 ? "" : "s"} ` +
          (okSources.length ? `from ${okSources.join(" + ")}. ` : "— no source answered. ") +
          `${t.complete} of ${t.complete + t.partial + t.missing} weeks complete` +
          (t.missing || t.partial ? ` (${t.missing} missing, ${t.partial} partial)` : "") +
          (result.conflicts.length ? ` · ${result.conflicts.length} conflicting draw${result.conflicts.length === 1 ? "" : "s"} kept from the earlier source` : "") + "."
      );
      renderStats();
      refreshLastDraw();
      renderProvenance();
      renderCoverage();
      renderFreshness();
      updatePanelCounts();
      scheduleStrictness();
      saveState();
      const newest = newestHistoryDraw();
      const newestTxt = newest ? newest.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "none";
      if (!okSources.length) {
        showFetchBanner("error", "No source could deliver results",
          result.sources.map((s) => `${s.label}: ${s.note || (s.errors[0] || s.status)}`).join(" · ") + ". Paste draws or import a CSV in the Historical draws panel.", result.sources, true);
      } else if (t.missing || t.partial) {
        showFetchBanner("warn", `Fetched ${added} new draw${added === 1 ? "" : "s"} — ${t.missing + t.partial} week${t.missing + t.partial === 1 ? "" : "s"} still incomplete`,
          `From ${okSources.join(" + ")}. Newest draw now ${newestTxt}. The data basis panel below shows which weeks are missing.`, result.sources, true);
      } else {
        showFetchBanner("ok", added ? `Fetched ${added} new draw${added === 1 ? "" : "s"}` : "Already up to date",
          `From ${okSources.join(" + ")}. Newest draw ${newestTxt}; every week in your lookback window is complete.`, result.sources, true);
      }
    } catch (e) {
      setHistoryStatus(`Fetching failed unexpectedly (${e.message}). Paste draws or import a CSV/JSON file instead.`, false);
      showFetchBanner("error", "Fetching failed", e.message, null, true);
    } finally {
      btn.disabled = false;
      btn.textContent = oldLabel;
      $("#crawl-progress").hidden = true;
    }
  }

  function showFetchBanner(stateName, title, detail, sources, done) {
    const b = $("#fetch-banner");
    b.hidden = false;
    b.dataset.state = stateName;
    b.querySelector(".fetch-banner-icon").textContent = { running: "⤓", ok: "✓", warn: "⚠", error: "✗" }[stateName] || "⤓";
    $("#fetch-banner-title").textContent = title;
    $("#fetch-banner-detail").textContent = detail || "";
    $("#fetch-banner-progress").hidden = stateName !== "running";
    $("#fetch-banner-close").hidden = !done;
    $("#fetch-banner-details").hidden = !done;
    const list = $("#fetch-banner-sources");
    if (sources && sources.length) {
      list.hidden = false;
      list.innerHTML = "";
      for (const src of sources) {
        const li = document.createElement("li");
        li.className = `src src-${src.status}`;
        const icon = { ok: "✓", failed: "✗", empty: "–", skipped: "·", running: "…" }[src.status] || "·";
        const d = src.status === "ok" ? `${src.draws} draw${src.draws === 1 ? "" : "s"}` : src.status === "running" ? "trying…" : (src.note || src.errors[0] || src.status);
        li.innerHTML = `<span class="src-icon" aria-hidden="true">${icon}</span><span class="src-label">${escapeHtml(src.label)}</span><span class="src-detail">${escapeHtml(d)}</span>`;
        list.appendChild(li);
      }
    } else {
      list.hidden = true;
    }
  }

  /** How stale the loaded history is for the active lottery. */
  function freshnessInfo(cfg) {
    const newest = newestHistoryDraw();
    const today = new Date();
    if (!newest) return { newest: null, missingSince: 0, stale: false, empty: true };
    const missingSince = drawsExpectedBetween(cfg, newest.date, today);
    const weeksOld = Math.floor((today - newest.date) / (7 * 86400000));
    return { newest: newest.date, missingSince, weeksOld, stale: missingSince > 0, empty: false };
  }

  function renderFreshness() {
    const cfg = LOTTERIES[state.lotteryId];
    const f = freshnessInfo(cfg);
    const el = $("#freshness-banner");
    const btn = $("#freshness-fetch");
    if (f.empty) {
      el.hidden = false;
      el.dataset.level = "empty";
      $("#freshness-text").innerHTML = `<strong>No ${cfg.name} results loaded yet.</strong> Fetch them to use exclusions, statistics and the last-draw features.`;
      btn.textContent = "⤓ Fetch results";
      return;
    }
    if (!f.stale) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.dataset.level = "stale";
    const fmt = f.newest.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    $("#freshness-text").innerHTML = `<strong>Results are ${f.weeksOld} week${f.weeksOld === 1 ? "" : "s"} old.</strong> Newest loaded draw is ${fmt}; about ${f.missingSince} draw${f.missingSince === 1 ? "" : "s"} since then ${f.missingSince === 1 ? "is" : "are"} not loaded, so exclusions and statistics cannot see them.`;
    btn.textContent = "⤓ Fetch newer results";
  }

  /** On open: fetch automatically when data is missing or stale (at most every 6 h). */
  function maybeAutoUpdate() {
    if (!$("#auto-update").checked) return;
    const cfg = LOTTERIES[state.lotteryId];
    const f = freshnessInfo(cfg);
    if (!f.empty && !f.stale) return;
    const lc = state.lastCollect[cfg.id];
    if (lc && Date.now() - new Date(lc.at).getTime() < 6 * 3600 * 1000) return;
    fetchHistoryChain();
  }

  function downloadDataset() {
    const cfg = LOTTERIES[state.lotteryId];
    const draws = state.history[cfg.id];
    if (!draws.length) {
      showToast("No draws loaded yet.");
      return;
    }
    downloadBlob(buildResultsCsv(draws, cfg), "text/csv", cfg.data.csvName);
    showToast(`Downloaded ${cfg.data.csvName} (${draws.length} draws).`);
  }

  /* ---------- coverage: which years and weeks are fetched and used ---------- */

  function fmtWeek(year, week) {
    return `${year}-W${String(week).padStart(2, "0")}`;
  }

  function renderCoverage() {
    const cfg = LOTTERIES[state.lotteryId];
    const all = state.history[cfg.id];
    const card = $("#coverage-card");
    if (!all.length) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const today = new Date();
    const active = activeDraws();
    const usedKeys = new Set(active.filter((d) => d.date).map((d) => isoDateKey(d.date)));
    const windowOn = $("#hist-window").checked;
    const years = intVal("hist-window-years", 5);
    const windowStart = windowOn ? new Date(today.getFullYear() - years, today.getMonth(), today.getDate()) : null;
    const dated = all.filter((d) => d.date).map((d) => d.date);
    const earliest = dated.length ? new Date(Math.min(...dated)) : today;
    let from = windowStart && windowStart < earliest ? windowStart : earliest;
    if (!windowOn) from = earliest;
    const launch = parseIsoDate(cfg.launch);
    if (launch && from < launch) from = launch;
    const cov = coverageByWeek(all, cfg, from, today, usedKeys);
    const t = cov.totals;

    // Summary: what the generator actually uses.
    const usedDates = active.filter((d) => d.date).map((d) => d.date);
    const uMin = usedDates.length ? new Date(Math.min(...usedDates)) : null;
    const uMax = usedDates.length ? new Date(Math.max(...usedDates)) : null;
    const wk = (d) => { const w = isoWeekOf(d); return fmtWeek(w.year, w.week); };
    const inWindowWeeks = cov.years.flatMap((y) => y.weeks).filter((w) => !windowStart || w.start >= new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() - 6));
    const gapsInWindow = inWindowWeeks.filter((w) => w.status === "missing" || w.status === "partial");
    const summary = [];
    summary.push(`<strong>${active.length}</strong> draw${active.length === 1 ? "" : "s"} in <strong>${t.usedWeeks}</strong> week${t.usedWeeks === 1 ? "" : "s"} are used for your rows` +
      (uMin ? ` — ${wk(uMin)} to ${wk(uMax)}` : "") +
      (windowOn ? ` (lookback ${years} year${years === 1 ? "" : "s"})` : " (no lookback limit)") + ".");
    if (gapsInWindow.length) {
      summary.push(`<span class="cov-warn">⚠ ${gapsInWindow.length} week${gapsInWindow.length === 1 ? "" : "s"} in that window ${gapsInWindow.length === 1 ? "is" : "are"} missing or incomplete</span> — exclusions and statistics cannot see those draws.`);
    } else {
      summary.push(`<span class="cov-ok">✓ every week in that window is complete</span>.`);
    }
    const srcParts = Object.entries(t.bySource).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${sourceLabel(k)}: ${n} week${n === 1 ? "" : "s"}`);
    if (srcParts.length) summary.push(`Sources — ${srcParts.join(" · ")}.`);
    const lc = state.lastCollect[cfg.id];
    if (lc) summary.push(`Last automatic fetch ${new Date(lc.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} for ${lc.from} → ${lc.to}.`);
    $("#coverage-summary").innerHTML = summary.map((x) => `<p>${x}</p>`).join("");

    // Grid: one row per ISO year, one cell per week.
    const grid = $("#coverage-grid");
    grid.innerHTML = "";
    for (const y of cov.years.slice().reverse()) {
      const row = document.createElement("div");
      row.className = "cov-row";
      const complete = y.weeks.filter((w) => w.status === "complete").length;
      const relevant = y.weeks.filter((w) => w.status !== "future" && w.status !== "pending" && w.status !== "before-launch").length;
      const used = y.weeks.filter((w) => w.used > 0).length;
      row.setAttribute("role", "img");
      row.setAttribute("aria-label", `${y.year}: ${complete} of ${relevant} weeks complete, ${used} weeks used for your rows`);
      const label = document.createElement("span");
      label.className = "cov-year";
      label.textContent = y.year;
      row.appendChild(label);
      const cells = document.createElement("span");
      cells.className = "cov-cells";
      // pad so week numbers line up across years
      const firstWeek = y.weeks.length ? y.weeks[0].week : 1;
      for (let i = 1; i < firstWeek; i++) {
        const pad = document.createElement("i");
        pad.className = "cov-cell cov-pad";
        cells.appendChild(pad);
      }
      for (const w of y.weeks) {
        const c = document.createElement("i");
        c.className = `cov-cell cov-${w.status}${w.used ? " cov-used" : ""}`;
        const startTxt = w.start.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
        const srcTxt = w.sources.length ? w.sources.map((k) => sourceLabel(k)).join(", ") : "";
        const launchDate = parseIsoDate(cfg.launch);
        const statusTxt = w.status === "future" ? "future"
          : w.status === "pending" ? `${w.fetched} fetched so far — draw day not passed yet`
          : w.status === "before-launch" ? (launchDate && w.start < launchDate ? "before launch" : "no draw day inside the range")
          : `${w.fetched} of ${w.expected} draw${w.expected === 1 ? "" : "s"} fetched`;
        c.title = `${fmtWeek(y.year, w.week)} (from ${startTxt}) · ${statusTxt}` +
          (srcTxt ? ` · ${srcTxt}` : "") + (w.used ? " · used for your rows" : w.fetched ? " · outside lookback window" : "");
        cells.appendChild(c);
      }
      row.appendChild(cells);
      grid.appendChild(row);
    }

    // Missing weeks list (most recent first), limited.
    const missing = cov.years.flatMap((y) => y.weeks.filter((w) => w.status === "missing" || w.status === "partial").map((w) => ({ y: y.year, w })))
      .sort((a, b) => b.w.start - a.w.start);
    const ml = $("#coverage-missing");
    if (!missing.length) {
      ml.hidden = true;
    } else {
      ml.hidden = false;
      const shown = missing.slice(0, 12).map((m) => `${fmtWeek(m.y, m.w.week)}${m.w.status === "partial" ? ` (${m.w.fetched}/${m.w.expected})` : ""}`);
      ml.innerHTML = `<strong>${missing.length} incomplete week${missing.length === 1 ? "" : "s"}:</strong> ${shown.join(", ")}${missing.length > 12 ? ", …" : ""}. ` +
        `Fetch again later, or paste the missing draws from norsk-tipping.no.`;
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
        stars: cfg.starPick > 0 ? sampleDistinct(starPool, cfg.starPick) : [],
        source: "demo"
      });
    }
    addDraws(draws, "demo data (synthetic — not real results)", "demo");
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
      bar.setAttribute("aria-hidden", "true");
      bar.style.height = `${Math.round((freq[n] / maxFreq) * 100)}%`;
      bar.dataset.tip = `${n}: ${freq[n]}×`;
      chart.appendChild(bar);
    }
    const gapsAll = drawsSinceLastSeen(draws, cfg);
    const tbody = $("#freq-table tbody");
    tbody.innerHTML = "";
    for (let n = 1; n <= cfg.mainMax; n++) {
      const tr = document.createElement("tr");
      const seen = gapsAll[n] >= draws.length ? "never" : String(gapsAll[n]);
      tr.innerHTML = `<td>${n}</td><td>${freq[n]}</td><td>${seen}</td>`;
      tbody.appendChild(tr);
    }
    const ranked = [];
    for (let n = 1; n <= cfg.mainMax; n++) ranked.push([n, freq[n]]);
    ranked.sort((a, b) => b[1] - a[1]);
    const fmtList = (pairs) => pairs.map(([n, f]) => `${n} (${f}×)`).join(", ");
    $("#hot-numbers").textContent = fmtList(ranked.slice(0, 5));
    $("#cold-numbers").textContent = fmtList(ranked.slice(-5).reverse());
    state.hotNumbers = ranked.slice(0, 5).map(([n]) => n);
    chart.setAttribute(
      "aria-label",
      `Bar chart of how often each number 1 to ${cfg.mainMax} was drawn. Most drawn: ${fmtList(ranked.slice(0, 5))}. ` +
        `Least drawn: ${fmtList(ranked.slice(-5).reverse())}. Full values are in the table that follows.`
    );
    if (draws.length < 50) {
      $("#stats-hint").textContent += ` With only ${draws.length} draws, these differences are mostly noise.`;
    }
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

  function renderEmptyState() {
    const cfg = LOTTERIES[state.lotteryId];
    $("#tickets").innerHTML = `
      <div class="empty-state">
        <div class="empty-balls" aria-hidden="true">
          <span class="ball demo">7</span><span class="ball demo">12</span><span class="ball demo">23</span><span class="ball demo">31</span>
        </div>
        <h3>Ready when you are</h3>
        <p>Pick a style under <strong>Quick setup</strong> — or just generate. You get ${cfg.name} rows that follow your rules;
        lock the ones you like and reroll the rest.</p>
        <button type="button" class="btn primary btn-lg" id="btn-generate-empty">⟳ Generate my rows</button>
      </div>`;
    $("#btn-generate-empty").addEventListener("click", generate);
  }

  function clearTickets() {
    state.tickets = [];
    state.generatedFor = null;
    renderEmptyState();
    $("#warnings").hidden = true;
    $("#summary-bar").hidden = true;
    for (const id of ["btn-copy", "btn-csv", "btn-print"]) $("#" + id).disabled = true;
  }

  function buildContext(cfg) {
    const criteria = readCriteria(cfg);
    const subsetSize = criteria.historySubset.enabled ? intVal("hist-subset-size", 4) : 0;
    const historyIndex = buildHistoryIndex(activeDraws(), subsetSize);
    const bias = computeBiasWeights(cfg);
    return { criteria, historyIndex, bias };
  }

  function generate() {
    const cfg = LOTTERIES[state.lotteryId];
    const { criteria, historyIndex, bias } = buildContext(cfg);

    const preWarnings = [];
    // Only nag about missing history when the user opted into a history rule
    // beyond the default "never repeat a full past row".
    if (criteria.historySubset.enabled && historyIndex.drawCount === 0) {
      preWarnings.push("History-based exclusions are on, but no historical draws are loaded for this lottery — they have no effect yet.");
    }
    preWarnings.push(...bias.warnings);
    if ($("#reuse-enabled").checked && !state.lastDraw) {
      preWarnings.push(`Reuse from last draw is on, but no last draw is set for ${cfg.name} — it was skipped. Press Edit on the Last draw card to set one.`);
    }

    // Locked rows stay in their slots; the rest are generated around them.
    const count = rowCount();
    const previous = state.generatedFor === cfg.id ? state.tickets : [];
    const slots = new Array(count).fill(null);
    const overflow = [];
    previous.forEach((t, i) => {
      if (!t.locked) return;
      if (i < count) slots[i] = t;
      else overflow.push(t);
    });
    for (const t of overflow) {
      const free = slots.indexOf(null);
      if (free === -1) slots.push(t);
      else slots[free] = t;
    }
    const lockedRows = slots.filter(Boolean);
    const need = slots.filter((x) => x === null).length;

    const { tickets, warnings } = generateTickets(need, cfg, criteria, historyIndex, bias.weights, lockedRows.map((t) => t.mains));
    let k = 0;
    const result = slots.map((t) => t || tickets[k++] || null).filter(Boolean);
    state.tickets = result;
    state.generatedFor = cfg.id;

    const allWarnings = preWarnings.concat(warnings);
    if (allWarnings.length) showWarnings(allWarnings, result.length === 0);
    else $("#warnings").hidden = true;
    renderTickets(cfg);
    if (tickets.length) announce(`${result.length} row${result.length === 1 ? "" : "s"} ready${lockedRows.length ? `, ${lockedRows.length} kept locked` : ""}.`);
    saveState();
  }

  function rerollRow(i) {
    const cfg = LOTTERIES[state.lotteryId];
    const { criteria, historyIndex, bias } = buildContext(cfg);
    const others = state.tickets.filter((_, j) => j !== i).map((t) => t.mains);
    const { tickets, warnings } = generateTickets(1, cfg, criteria, historyIndex, bias.weights, others);
    if (!tickets.length) {
      showToast(warnings[0] || "Could not find another row that fits your rules.");
      return;
    }
    state.tickets[i] = tickets[0];
    renderTickets(cfg);
    focusRowAction(i, "reroll");
    announce(`Row ${i + 1} rerolled${tickets[0].relaxed ? " (some style rules relaxed)" : ""}.`);
    saveState();
  }

  function toggleLock(i) {
    const t = state.tickets[i];
    t.locked = !t.locked;
    renderTickets(LOTTERIES[state.lotteryId]);
    focusRowAction(i, "lock");
    announce(`Row ${i + 1} ${t.locked ? "locked — it stays when you generate again" : "unlocked"}.`);
    saveState();
  }

  async function copyRow(i) {
    const t = state.tickets[i];
    const text = t.mains.join(" ") + (t.stars.length ? " + " + t.stars.join(" ") : "");
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Row ${i + 1} copied: ${text}`);
    } catch (e) {
      showToast("Copy failed — your browser blocked clipboard access.");
    }
  }

  function focusRowAction(i, action) {
    const btn = document.querySelector(`.ticket[data-row="${i}"] [data-action="${action}"]`);
    if (btn) btn.focus();
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
      wrap.innerHTML = '<div class="empty-state"><h3>No rows fit these rules</h3><p>Loosen a rule — the Rule strictness gauge under Quick setup shows how tight your settings are.</p></div>';
      for (const id of ["btn-copy", "btn-csv", "btn-print"]) $("#" + id).disabled = true;
      $("#summary-bar").hidden = true;
      return;
    }
    // Highlight numbers carried over from the last draw only when reuse is on.
    const highlight = $("#reuse-enabled").checked ? state.lastDrawSet : new Set();
    state.tickets.forEach((t, i) => {
      const card = document.createElement("div");
      card.className = "ticket" + (t.locked ? " locked" : "");
      card.dataset.row = String(i);
      card.setAttribute("role", "group");
      card.setAttribute("aria-label", `Row ${i + 1}`);
      card.style.setProperty("--i", i);
      const balls = t.mains
        .map((n) => highlight.has(n)
          ? `<span class="ball carried" title="Carried over from the last draw">${n}<span class="sr-only"> (from last draw)</span></span>`
          : `<span class="ball">${n}</span>`)
        .join("");
      const stars = t.stars.length
        ? `<span class="star-sep" aria-hidden="true">+</span><span class="sr-only">star numbers</span>` +
          t.stars.map((n) => `<span class="ball star">${n}</span>`).join("")
        : "";
      const carried = highlight.size ? t.mains.filter((n) => highlight.has(n)).length : 0;
      const badges = [];
      if (carried) badges.push(`<span class="ticket-flag">★ ${carried} from last draw</span>`);
      if (t.relaxed) badges.push('<span class="ticket-flag warn">⚠ relaxed</span>');
      const note = t.relaxed && t.relaxedRules && t.relaxedRules.length
        ? `<div class="ticket-note">Relaxed to fit your exclusions: ${escapeHtml(t.relaxedRules.join(", "))}</div>`
        : "";
      card.innerHTML =
        `<span class="ticket-no">#${i + 1}</span>` +
        `<span class="ticket-balls">${balls}${stars}</span>` +
        `<span class="ticket-badges">${badges.join("")}</span>` +
        `<span class="ticket-actions">` +
        `<button type="button" class="icon-btn" data-action="lock" aria-pressed="${t.locked ? "true" : "false"}" aria-label="${t.locked ? "Unlock" : "Lock"} row ${i + 1}" title="${t.locked ? "Unlock row" : "Lock row — keep it when generating again"}">${t.locked ? "🔒" : "🔓"}</button>` +
        `<button type="button" class="icon-btn" data-action="reroll" aria-label="Reroll row ${i + 1}" title="Reroll just this row"${t.locked ? " disabled" : ""}>↻</button>` +
        `<button type="button" class="icon-btn" data-action="copy" aria-label="Copy row ${i + 1}" title="Copy this row">⧉</button>` +
        `</span>` +
        note;
      wrap.appendChild(card);
    });
    for (const id of ["btn-copy", "btn-csv", "btn-print"]) $("#" + id).disabled = false;
    renderSummary(cfg);
  }

  function renderSummary(cfg) {
    const bar = $("#summary-bar");
    const rows = state.tickets.length;
    if (!rows) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const locked = state.tickets.filter((t) => t.locked).length;
    const relaxed = state.tickets.filter((t) => t.relaxed).length;
    const parts = [`<span class="stat"><strong>${rows}</strong> row${rows === 1 ? "" : "s"}</span>`];
    if (locked) parts.push(`<span class="stat">🔒 <strong>${locked}</strong> locked</span>`);
    parts.push(relaxed
      ? `<button type="button" class="stat-warn" id="summary-relaxed">⚠ ${relaxed} relaxed — why?</button>`
      : '<span class="stat">✓ all rows follow your rules</span>');
    const basis = activeDraws().length;
    if (basis) parts.push(`<a class="stat stat-link" href="#coverage-card">📅 based on ${basis} past draws</a>`);
    $("#summary-stats").innerHTML = parts.join("");
    const relaxedBtn = $("#summary-relaxed");
    if (relaxedBtn) {
      relaxedBtn.addEventListener("click", () => {
        const first = document.querySelector(".ticket .ticket-note");
        const w = $("#warnings");
        if (!w.hidden) w.scrollIntoView({ block: "center" });
        else if (first) first.scrollIntoView({ block: "center" });
      });
    }
    const price = state.rowPrice[cfg.id];
    const total = rows * price;
    const kr = (v) => v.toLocaleString("nb-NO", { maximumFractionDigits: 2 });
    $("#summary-cost").textContent = `Coupon: ${rows} × ${kr(price)} kr = ${kr(total)} kr`;
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
      showToast(`Copied ${state.tickets.length} rows to the clipboard.`);
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
    showToast(`Downloaded ${a.download}.`);
  }

  /* ---------- toast + live announcements ---------- */

  let toastTimer = null;
  function showToast(message, actionLabel, action) {
    const el = $("#toast");
    $("#toast-text").textContent = message;
    const btn = $("#toast-action");
    btn.hidden = !actionLabel;
    btn.onclick = null;
    if (actionLabel) {
      btn.textContent = actionLabel;
      btn.onclick = () => {
        el.hidden = true;
        action();
      };
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), actionLabel ? 8000 : 3500);
  }

  /** Screen-reader announcement without a visible toast. */
  function announce(message) {
    const el = $("#sr-announcer");
    el.textContent = "";
    // A fresh text node after a tick makes repeated messages re-announce.
    setTimeout(() => (el.textContent = message), 50);
  }

  /* ---------- presets ---------- */

  // Each preset sets the style rules only — never your excluded/required
  // numbers, history or last-draw settings.
  const PRESETS = {
    balanced: {
      label: "Balanced",
      desc: "A natural-looking spread: no long runs, a mix of odd/even and low/high, typical sums, and no obvious patterns.",
      apply: (cfg) => ({
        "crit-maxrun": true, "crit-maxrun-value": 2,
        "crit-oddeven": true, "crit-oddeven-min": cfg.mainPick === 7 ? 2 : 1, "crit-oddeven-max": cfg.mainPick === 7 ? 5 : 4,
        "crit-sum": true, "crit-sum-min": cfg.defaultSumMin, "crit-sum-max": cfg.defaultSumMax,
        "crit-zone": true, "crit-zone-max": 3, "crit-zone-min": 0,
        "crit-parity": true, "crit-parity-value": 3,
        "crit-arith": true, "crit-arith-value": 3,
        "ap-lastdigit": true, "ap-lastdigit-max": 3,
        "ap-multiple": true, "ap-multiple-max": 4,
        "ap-lowhigh": true, "ap-lowhigh-low": 1, "ap-lowhigh-high": 1,
        "crit-birthday": false, "bias-overdue": false, "bias-cold": false,
        "crit-overlap": true, "crit-overlap-max": cfg.mainPick === 7 ? 4 : 3
      })
    },
    contrarian: {
      label: "Contrarian",
      desc: "Steers away from the combinations crowds love — dates, runs and neat patterns — so a win is less likely to be shared. Same odds, fewer co-winners.",
      apply: (cfg) => ({
        ...PRESETS.balanced.apply(cfg),
        "crit-birthday": true,
        "ap-lastdigit-max": 2,
        "ap-multiple-max": 3,
        "ap-lowhigh-low": 2, "ap-lowhigh-high": 2
      })
    },
    weighted: {
      label: "Overdue & rare",
      desc: "Balanced rules plus a boost for numbers that haven't come up lately or rarely do. Needs loaded results. A style choice — it doesn't change the odds.",
      apply: (cfg) => ({
        ...PRESETS.balanced.apply(cfg),
        "bias-overdue": true, "bias-overdue-strength": 60,
        "bias-cold": true, "bias-cold-strength": 50
      })
    },
    random: {
      label: "Pure random",
      desc: "No style rules at all — every combination is equally likely, like Norsk Tipping's own quick pick. Rows are still never duplicated.",
      apply: () => ({
        "crit-maxrun": false, "crit-oddeven": false, "crit-sum": false, "crit-zone": false,
        "crit-parity": false, "crit-arith": false, "ap-lastdigit": false, "ap-multiple": false,
        "ap-lowhigh": false, "crit-birthday": false, "bias-overdue": false, "bias-cold": false,
        "crit-overlap": false
      })
    }
  };

  function applyPreset(id, quiet) {
    const preset = PRESETS[id];
    if (!preset) return;
    const values = preset.apply(LOTTERIES[state.lotteryId]);
    for (const [key, value] of Object.entries(values)) {
      const el = document.getElementById(key);
      if (!el) continue;
      if (el.type === "checkbox") el.checked = !!value;
      else el.value = value;
    }
    state.preset = id;
    syncCriterionBodies();
    syncBiasOutputs();
    renderPresetState();
    updatePanelCounts();
    scheduleStrictness();
    saveState();
    if (!quiet) showToast(`${preset.label} preset applied — generate to see it.`);
  }

  function renderPresetState() {
    for (const chip of document.querySelectorAll(".chip[data-preset]")) {
      chip.setAttribute("aria-pressed", chip.dataset.preset === state.preset ? "true" : "false");
    }
    const p = PRESETS[state.preset];
    $("#preset-desc").textContent = p
      ? p.desc
      : state.preset === "custom"
        ? "Custom rules — you've adjusted the settings below."
        : "Not sure where to start? Balanced is a good default.";
  }

  /* ---------- live rule strictness ---------- */

  let strictTimer = null;
  function scheduleStrictness() {
    clearTimeout(strictTimer);
    strictTimer = setTimeout(updateStrictness, 250);
  }

  function updateStrictness() {
    const cfg = LOTTERIES[state.lotteryId];
    const { criteria, historyIndex, bias } = buildContext(cfg);
    const box = $("#strictness");
    const { rate, feasible, problems } = estimatePassRate(cfg, criteria, historyIndex, bias.weights, 1500);
    let level;
    let text;
    if (!feasible) {
      level = "conflict";
      $("#strictness-value").textContent = "Conflict";
      text = problems[0];
    } else {
      const pct = rate * 100;
      $("#strictness-value").textContent = pct >= 99.5 ? "None" : pct < 0.1 ? "< 0.1% pass" : `≈ ${pct < 10 ? pct.toFixed(1) : Math.round(pct)}% pass`;
      if (pct >= 40) {
        level = "relaxed";
        text = "Easy-going — most random rows already fit your rules.";
      } else if (pct >= 5) {
        level = "moderate";
        text = "Moderate — your rules filter out many random rows, rows still generate instantly.";
      } else if (pct >= 0.5) {
        level = "strict";
        text = "Strict — only a small share of rows fit. Still fine, but adding more rules may force some to be relaxed.";
      } else {
        level = "strict";
        text = "Very strict — expect some rows to be relaxed. Loosen a rule if you want every row to comply.";
      }
    }
    box.dataset.level = level;
    $("#strictness-fill").style.width = feasible ? `${Math.max(3, Math.min(100, Math.round(rate * 100)))}%` : "100%";
    $("#strictness-text").textContent = text;
  }

  /* ---------- collapsible panels ---------- */

  function updatePanelCounts() {
    for (const details of document.querySelectorAll("details[data-panel]")) {
      const key = details.dataset.panel;
      const badge = details.querySelector(`[data-count-for="${key}"]`);
      if (key === "history") {
        const n = state.history[state.lotteryId].length;
        badge.textContent = n ? `${n} draws` : "none loaded";
        badge.classList.toggle("on", n > 0);
        continue;
      }
      const toggles = details.querySelectorAll('.toggle input[type="checkbox"]');
      const on = [...toggles].filter((t) => t.checked).length;
      badge.textContent = `${on} of ${toggles.length} on`;
      badge.classList.toggle("on", on > 0);
    }
  }

  function restorePanels() {
    for (const details of document.querySelectorAll("details[data-panel]")) {
      details.open = !!state.panelsOpen[details.dataset.panel];
      details.addEventListener("toggle", () => {
        state.panelsOpen[details.dataset.panel] = details.open;
        syncPanelToggleButton();
        saveState();
      });
    }
    panelsRestored = true;
    syncPanelToggleButton();
  }

  function syncPanelToggleButton() {
    const all = [...document.querySelectorAll("details[data-panel]")];
    const anyClosed = all.some((d) => !d.open);
    const btn = $("#btn-toggle-panels");
    btn.textContent = anyClosed ? "Expand all" : "Collapse all";
    btn.setAttribute("aria-expanded", anyClosed ? "false" : "true");
  }

  /* ---------- shareable settings link ---------- */

  function settingsToHash() {
    const payload = { v: 1, lottery: state.lotteryId, preset: state.preset, settings: collectSettings() };
    const json = JSON.stringify(payload);
    const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return "#s=" + b64;
  }

  function readHashSettings() {
    const m = location.hash.match(/^#s=([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    try {
      const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(escape(atob(b64 + "===".slice((b64.length + 3) % 4))));
      const data = JSON.parse(json);
      return data && data.v === 1 && data.settings && typeof data.settings === "object" ? data : null;
    } catch (e) {
      return null;
    }
  }

  async function shareSettings() {
    const url = location.href.split("#")[0] + settingsToHash();
    try {
      await navigator.clipboard.writeText(url);
      showToast("Settings link copied — anyone opening it gets the same rules (not your history).");
    } catch (e) {
      history.replaceState(null, "", url);
      showToast("Couldn't access the clipboard — the link is now in the address bar.");
    }
  }

  function syncBiasOutputs() {
    for (const [slider, out] of [["bias-overdue-strength", "bias-overdue-out"], ["bias-cold-strength", "bias-cold-out"]]) {
      document.getElementById(out).textContent = document.getElementById(slider).value + " %";
    }
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
    const shared = readHashSettings();
    if (shared) {
      applySettings(shared.settings);
      if (shared.lottery && LOTTERIES[shared.lottery]) state.lotteryId = shared.lottery;
      state.preset = typeof shared.preset === "string" ? shared.preset : "custom";
      history.replaceState(null, "", location.href.split("#")[0]);
    }

    $("#switch-lotto").addEventListener("click", () => { switchLottery("lotto"); maybeAutoUpdate(); });
    $("#switch-eurojackpot").addEventListener("click", () => { switchLottery("eurojackpot"); maybeAutoUpdate(); });

    for (const id of ["bias-overdue-strength", "bias-cold-strength"]) {
      document.getElementById(id).addEventListener("input", syncBiasOutputs);
    }
    syncBiasOutputs();

    // Any edit to a rule makes the setup "custom" and refreshes the gauges.
    const sidebar = $(".sidebar");
    sidebar.addEventListener("input", (e) => {
      if (e.target.closest("details[data-panel]") && e.target.closest('details[data-panel]:not([data-panel="history"])')) {
        if (state.preset !== "custom") {
          state.preset = "custom";
          renderPresetState();
        }
      }
      scheduleStrictness();
    });
    document.body.addEventListener("change", (e) => {
      if (e.target.matches("input")) {
        syncCriterionBodies();
        if (e.target.id === "hist-window" || e.target.id === "hist-window-years") {
          refreshHistoryStatus();
          renderStats();
          renderCoverage();
        }
        updatePanelCounts();
        scheduleStrictness();
        saveState();
      }
    });

    for (const chip of document.querySelectorAll(".chip[data-preset]")) {
      chip.addEventListener("click", () => applyPreset(chip.dataset.preset));
    }
    $("#btn-share").addEventListener("click", shareSettings);
    $("#btn-toggle-panels").addEventListener("click", () => {
      const all = [...document.querySelectorAll("details[data-panel]")];
      const open = all.some((d) => !d.open);
      for (const d of all) d.open = open;
    });

    $("#row-count").addEventListener("input", updateGenerateLabel);
    $("#row-price").addEventListener("input", () => {
      const v = parseFloat($("#row-price").value);
      if (Number.isFinite(v) && v >= 0) {
        state.rowPrice[state.lotteryId] = v;
        renderSummary(LOTTERIES[state.lotteryId]);
        saveState();
      }
    });

    // Per-row actions (event delegation; rows are re-rendered often).
    $("#tickets").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      const card = e.target.closest(".ticket[data-row]");
      if (!btn || !card) return;
      const i = parseInt(card.dataset.row, 10);
      if (btn.dataset.action === "lock") toggleLock(i);
      else if (btn.dataset.action === "reroll") rerollRow(i);
      else if (btn.dataset.action === "copy") copyRow(i);
    });

    // Stats → criteria shortcuts.
    $("#act-overdue").addEventListener("click", () => {
      $("#bias-overdue").checked = true;
      afterShortcut("weighting", "Favouring overdue numbers — adjust the strength under Smart weighting.");
    });
    $("#act-cold").addEventListener("click", () => {
      $("#bias-cold").checked = true;
      afterShortcut("weighting", "Favouring rarely-picked numbers — adjust it under Smart weighting.");
    });
    $("#act-exclude-hot").addEventListener("click", () => {
      const cfg = LOTTERIES[state.lotteryId];
      const prev = { checked: $("#crit-exclude").checked, value: $("#crit-exclude-list").value };
      const merged = [...new Set(parseNumberList(prev.value, cfg.mainMax).concat(state.hotNumbers || []))].sort((a, b) => a - b);
      $("#crit-exclude").checked = true;
      $("#crit-exclude-list").value = merged.join(", ");
      afterShortcut("yours", `Excluding ${merged.join(", ")}.`, () => {
        $("#crit-exclude").checked = prev.checked;
        $("#crit-exclude-list").value = prev.value;
        afterShortcut("yours", "Exclusion undone.");
      });
    });

    $("#btn-generate").addEventListener("click", generate);
    $("#btn-copy").addEventListener("click", copyTickets);
    $("#btn-csv").addEventListener("click", downloadCsv);
    $("#btn-print").addEventListener("click", () => window.print());
    window.addEventListener("afterprint", () => showToast("Print dialog closed."));

    $("#history-parse").addEventListener("click", () => {
      const text = $("#history-paste").value;
      if (!text.trim()) {
        setHistoryStatus("Paste some draws first.", false);
        return;
      }
      addDraws(parseDraws(text, LOTTERIES[state.lotteryId]), "the pasted text", "paste");
      $("#history-paste").value = "";
    });
    $("#history-file").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      addDraws(parseDraws(text, LOTTERIES[state.lotteryId]), `"${file.name}"`, "file");
      e.target.value = "";
    });
    $("#history-crawl").addEventListener("click", fetchHistoryChain);
    $("#history-download").addEventListener("click", downloadDataset);
    $("#coverage-fetch").addEventListener("click", fetchHistoryChain);
    $("#freshness-fetch").addEventListener("click", fetchHistoryChain);
    $("#fetch-banner-close").addEventListener("click", () => ($("#fetch-banner").hidden = true));
    $("#fetch-banner-details").addEventListener("click", () => {
      const details = document.querySelector('details[data-panel="history"]');
      if (details) details.open = true;
      $("#source-status-wrap").scrollIntoView({ block: "center", behavior: "smooth" });
    });
    $("#history-demo").addEventListener("click", loadDemoData);
    $("#history-clear").addEventListener("click", () => {
      const id = state.lotteryId;
      const snapshot = { history: state.history[id], provenance: state.provenance[id] };
      if (!snapshot.history.length) return;
      state.history[id] = [];
      state.provenance[id] = [];
      afterHistoryChange();
      showToast(`Cleared ${snapshot.history.length} ${LOTTERIES[id].name} draws.`, "Undo", () => {
        state.history[id] = snapshot.history;
        state.provenance[id] = snapshot.provenance;
        afterHistoryChange();
        showToast("History restored.");
      });
    });

    // Last draw editor + reuse dual-range.
    $("#lastdraw-edit").addEventListener("click", openLastDrawEditor);
    $("#lastdraw-save").addEventListener("click", saveLastDraw);
    $("#lastdraw-cancel").addEventListener("click", () => ($("#lastdraw-editor").hidden = true));
    $("#lastdraw-reset").addEventListener("click", resetLastDraw);
    $("#lastdraw-tab-history").addEventListener("click", () => setEditorMode("history"));
    $("#lastdraw-tab-manual").addEventListener("click", () => setEditorMode("manual"));
    $("#lastdraw-date").addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveLastDraw();
    });
    $("#lastdraw-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveLastDraw();
    });
    for (const id of ["reuse-enabled", "reuse-min", "reuse-max"]) {
      document.getElementById(id).addEventListener("input", syncReuseUI);
    }

    // Sticky summary bar sits just below the (variable-height) sticky header.
    const syncHeaderHeight = () =>
      document.documentElement.style.setProperty("--header-h", $(".app-header").offsetHeight + "px");
    syncHeaderHeight();
    window.addEventListener("resize", syncHeaderHeight);

    restorePanels();
    updateGenerateLabel();
    switchLottery(state.lotteryId, true);
    setTimeout(maybeAutoUpdate, 600);
    syncCriterionBodies();
    syncReuseUI();
    renderPresetState();
    if (shared) showToast("Settings loaded from the shared link.");
  }

  function afterShortcut(panel, message, undo) {
    state.preset = "custom";
    renderPresetState();
    syncCriterionBodies();
    updatePanelCounts();
    scheduleStrictness();
    const details = document.querySelector(`details[data-panel="${panel}"]`);
    if (details) details.open = true;
    saveState();
    showToast(message, undo ? "Undo" : null, undo);
  }

  function afterHistoryChange() {
    refreshHistoryStatus();
    renderStats();
    renderCoverage();
    renderFreshness();
    refreshLastDraw();
    renderProvenance();
    updatePanelCounts();
    scheduleStrictness();
    saveState();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
