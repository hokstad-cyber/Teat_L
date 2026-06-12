/* UI wiring for LykkeTall. */
"use strict";

(function () {
  const $ = (sel) => document.querySelector(sel);

  const state = {
    lotteryId: "lotto",
    /** draws per lottery id */
    history: { lotto: [], eurojackpot: [] },
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
    "crit-overlap", "crit-overlap-max",
    "crit-exclude", "crit-exclude-list",
    "crit-require", "crit-require-list",
    "hist-window", "hist-window-years",
    "hist-exact",
    "hist-subset", "hist-subset-size"
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
      historySubset: { enabled: $("#hist-subset").checked }
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

    renderPresets(cfg);
    clearTickets();
    refreshHistoryStatus();
    renderStats();
    saveState();
  }

  function renderPresets(cfg) {
    const wrap = $("#history-presets");
    wrap.innerHTML = "";
    for (const src of cfg.sources) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `↳ ${src.label}`;
      btn.title = src.note;
      btn.addEventListener("click", () => {
        $("#history-url").value = src.url;
      });
      wrap.appendChild(btn);
    }
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

  /* Backup fetch: try the provider directly, then public read-through
     mirrors that add CORS headers. Successful fetches are cached for 12 h
     (per URL and lottery) so repeated clicks don't hammer — and don't get
     us blocked by — the provider. */

  const FETCH_CACHE_KEY = "lykketall.fetchcache.v1";
  const FETCH_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 12000;

  const FETCH_ROUTES = [
    { name: "the source directly", make: (u) => u },
    { name: "backup mirror allorigins.win", make: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
    { name: "backup mirror corsproxy.io", make: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
    { name: "backup mirror codetabs.com", make: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` }
  ];

  function readFetchCache() {
    try {
      return JSON.parse(localStorage.getItem(FETCH_CACHE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function cacheKeyFor(url) {
    return state.lotteryId + "::" + url;
  }

  function getCachedDraws(url) {
    const entry = readFetchCache()[cacheKeyFor(url)];
    if (!entry || Date.now() - entry.time > FETCH_CACHE_TTL_MS) return null;
    return {
      ageMinutes: Math.round((Date.now() - entry.time) / 60000),
      draws: entry.draws.map((d) => ({
        date: d.date ? new Date(d.date) : null,
        mains: d.mains,
        stars: d.stars || []
      }))
    };
  }

  function putCachedDraws(url, draws) {
    try {
      const cache = readFetchCache();
      // Keep the cache small: drop expired entries before adding.
      for (const key of Object.keys(cache)) {
        if (Date.now() - cache[key].time > FETCH_CACHE_TTL_MS) delete cache[key];
      }
      cache[cacheKeyFor(url)] = {
        time: Date.now(),
        draws: draws.map((d) => ({
          date: d.date ? d.date.toISOString().slice(0, 10) : null,
          mains: d.mains,
          stars: d.stars
        }))
      };
      localStorage.setItem(FETCH_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      /* quota exceeded — caching is best-effort */
    }
  }

  function fetchWithTimeout(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    return fetch(url, { mode: "cors", signal: ctrl.signal }).finally(() => clearTimeout(timer));
  }

  /** Fetch a URL trying the direct route first, then the backup mirrors.
      `preferredIdx` reorders the attempts so a route that already worked
      for this provider is tried first. Returns { text, routeIdx, via }. */
  async function fetchViaRoutes(url, preferredIdx) {
    const order = FETCH_ROUTES.map((_, i) => i);
    if (preferredIdx > 0) order.splice(order.indexOf(preferredIdx), 1) && order.unshift(preferredIdx);
    const failures = [];
    for (const i of order) {
      const route = FETCH_ROUTES[i];
      try {
        const res = await fetchWithTimeout(route.make(url));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!text.trim()) throw new Error("empty response");
        return { text, routeIdx: i, via: route.name };
      } catch (e) {
        failures.push(`${route.name}: ${e.name === "AbortError" ? "timed out" : e.message}`);
      }
    }
    const err = new Error(failures.join(" · "));
    err.allRoutesFailed = true;
    throw err;
  }

  async function fetchHistory() {
    const url = $("#history-url").value.trim();
    if (!url) {
      setHistoryStatus("Enter a URL first, or pick one of the suggested sources.", false);
      return;
    }
    const btn = $("#history-fetch");
    btn.disabled = true;
    btn.textContent = "…";
    try {
      const cached = getCachedDraws(url);
      if (cached) {
        addDraws(cached.draws, `the cache (fetched ${cached.ageMinutes} min ago — cached to avoid hitting the provider repeatedly)`);
        return;
      }
      setHistoryStatus("Fetching…", false);
      const cfg = LOTTERIES[state.lotteryId];
      const { text, via } = await fetchViaRoutes(url, -1);
      const draws = parseDraws(stripHtml(text), cfg);
      if (!draws.length) {
        setHistoryStatus(`Fetched via ${via}, but found no parsable ${cfg.name} draws in the response.`, false);
        return;
      }
      putCachedDraws(url, draws);
      addDraws(draws, via);
    } catch (e) {
      setHistoryStatus(
        `Fetching failed on all routes (${e.message}). ` +
          "Open the results page in a new tab, copy the draw history, and paste it in the box below — or import a downloaded CSV/JSON file.",
        false
      );
    } finally {
      btn.disabled = false;
      btn.textContent = "Fetch";
    }
  }

  /* ---------- automatic API fetch (unofficial Norsk Tipping endpoint) ----------
     Strategy from the open-source wrappers github.com/Nilzone-/Norsk-Tipping and
     github.com/zrrrzzt/norsk-tipping-results: getResultInfo.json with no
     parameter returns the latest draw including its drawID; ?drawID=N returns
     draw N, so we walk backwards from the latest. */

  const MAX_API_DRAWS = 160;
  const API_CONCURRENCY = 5;

  function extractDrawId(text) {
    const m = text.match(/"drawI[dD]"\s*:\s*"?(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function apiDrawCount(cfg) {
    const years = $("#hist-window").checked ? intVal("hist-window-years", 0) : 0;
    if (years > 0) return Math.min(MAX_API_DRAWS, years * cfg.api.drawsPerYear);
    return Math.min(MAX_API_DRAWS, 2 * cfg.api.drawsPerYear);
  }

  async function walkNorskTippingApi(cfg, onProgress) {
    const base = cfg.api.latest;
    const latest = await fetchViaRoutes(base, -1);
    const latestId = extractDrawId(latest.text);
    const latestDraws = parseDraws(latest.text, cfg);
    if (!latestDraws.length || !latestId) {
      throw new Error("the Norsk Tipping API response had no recognisable draw");
    }
    const want = apiDrawCount(cfg);
    const ids = [];
    for (let i = 1; i < want && latestId - i > 0; i++) ids.push(latestId - i);
    const collected = latestDraws.slice();
    let done = 0;
    let consecutiveFailures = 0;
    const workers = Array.from({ length: API_CONCURRENCY }, async () => {
      while (ids.length && consecutiveFailures < 12) {
        const id = ids.shift();
        try {
          const { text } = await fetchViaRoutes(`${base}?drawID=${id}`, latest.routeIdx);
          const draws = parseDraws(text, cfg);
          if (draws.length) {
            collected.push(...draws);
            consecutiveFailures = 0;
          } else {
            consecutiveFailures++;
          }
        } catch (e) {
          consecutiveFailures++;
        }
        done++;
        if (done % 5 === 0) onProgress(done + 1, want);
      }
    });
    await Promise.all(workers);
    return { draws: collected, via: latest.via, want };
  }

  async function autoFetchHistory() {
    const cfg = LOTTERIES[state.lotteryId];
    const btn = $("#history-auto");
    btn.disabled = true;
    const cacheUrl = "auto-api:" + cfg.id + ":" + apiDrawCount(cfg);
    try {
      const cached = getCachedDraws(cacheUrl);
      if (cached) {
        addDraws(cached.draws, `the cache (fetched ${cached.ageMinutes} min ago — cached to avoid hitting the provider repeatedly)`);
        return;
      }
      // 1) Unofficial Norsk Tipping API, walking back through draw IDs.
      try {
        setHistoryStatus("Contacting the unofficial Norsk Tipping API…", false);
        const result = await walkNorskTippingApi(cfg, (done, want) =>
          setHistoryStatus(`Fetching past draws from the Norsk Tipping API… ${Math.min(done, want)}/${want}`, false)
        );
        putCachedDraws(cacheUrl, result.draws);
        addDraws(result.draws, `the unofficial Norsk Tipping API (via ${result.via})`);
        return;
      } catch (e) {
        /* fall through to backup APIs */
      }
      // 2) Other unofficial APIs for this lottery.
      for (const fb of cfg.api.fallbacks) {
        try {
          setHistoryStatus(`Norsk Tipping API unavailable — trying ${fb.label}…`, false);
          const { text, via } = await fetchViaRoutes(fb.url, -1);
          const draws = parseDraws(text, cfg);
          if (draws.length) {
            addDraws(draws, `${fb.label} (via ${via})`);
            return;
          }
        } catch (e) {
          /* try next fallback */
        }
      }
      // 3) Last resort: the result pages, parsed as text.
      for (const src of cfg.sources) {
        try {
          setHistoryStatus(`Trying ${src.label}…`, false);
          const { text, via } = await fetchViaRoutes(src.url, -1);
          const draws = parseDraws(stripHtml(text), cfg);
          if (draws.length) {
            addDraws(draws, `${src.label} (via ${via})`);
            return;
          }
        } catch (e) {
          /* try next source */
        }
      }
      setHistoryStatus(
        "Automatic fetching failed: the unofficial Norsk Tipping API, the backup APIs and the result pages were all unreachable or unparsable. " +
          "Copy the draws from a results page and paste them below, or import a CSV/JSON file.",
        false
      );
    } finally {
      btn.disabled = false;
    }
  }

  /** Turn fetched HTML into line-oriented text so the draw parser can work on it. */
  function stripHtml(text) {
    if (!/<[a-z!/]/i.test(text)) return text;
    const doc = new DOMParser().parseFromString(text, "text/html");
    for (const el of doc.querySelectorAll("script, style")) el.remove();
    for (const el of doc.querySelectorAll("tr, li, p, div, h1, h2, h3")) el.append("\n");
    return doc.body ? doc.body.textContent : text;
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
  }

  /* ---------- generation & rendering ---------- */

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

    if ((criteria.historyExact.enabled || criteria.historySubset.enabled) && historyIndex.drawCount === 0) {
      showWarnings(["History-based exclusions are on, but no historical draws are loaded for this lottery — they have no effect yet."], false);
    } else {
      $("#warnings").hidden = true;
    }

    const { tickets, warnings } = generateTickets(10, cfg, criteria, historyIndex);
    state.tickets = tickets;
    state.generatedFor = cfg.id;

    if (warnings.length) showWarnings(warnings, tickets.length === 0);
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
    state.tickets.forEach((t, i) => {
      const card = document.createElement("div");
      card.className = "ticket";
      card.style.setProperty("--i", i);
      const balls = t.mains.map((n) => `<span class="ball">${n}</span>`).join("");
      const stars = t.stars.length
        ? `<span class="star-sep">+</span>` + t.stars.map((n) => `<span class="ball star">${n}</span>`).join("")
        : "";
      const flag = t.relaxed ? '<span class="ticket-flag" title="Style criteria were relaxed for this row">relaxed</span>' : "";
      card.innerHTML = `<span class="ticket-no">#${i + 1}</span><span class="ticket-balls">${balls}${stars}</span>${flag}`;
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

    $("#history-fetch").addEventListener("click", fetchHistory);
    $("#history-auto").addEventListener("click", autoFetchHistory);
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
    $("#history-demo").addEventListener("click", loadDemoData);
    $("#history-clear").addEventListener("click", () => {
      state.history[state.lotteryId] = [];
      refreshHistoryStatus();
      renderStats();
      saveState();
    });

    switchLottery(state.lotteryId);
    syncCriterionBodies();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
