/* Historical results: an ordered chain of sources with automatic fallback.
   Browser-only (uses fetch). Pure helpers live in history.js.

   Order (see docs/DATAINNHENTING-HISTORISKE-TALL.md):
     1. nt-api-v2      Norsk Tipping's own results API, 15-week windows
     2. bundled-csv    data/<game>.csv shipped with the app (collector output)
     3. thirdparty-csv independent public dataset (Eurojackpot only)
     4. nt-api-legacy  2015-era drawID endpoint, last resort
   Every draw carries `source`; every week in the requested range is reported
   as complete / partial / missing, with the sources that covered it. */
"use strict";

const SOURCE_LABELS = {
  "nt-api-v2": "Norsk Tipping results API",
  "bundled-csv": "Dataset shipped with the app",
  "thirdparty-csv": "Independent public dataset",
  "nt-api-legacy": "Norsk Tipping legacy API",
  manual: "Entered or pasted manually",
  manuell: "Entered or pasted manually",
  file: "Imported file",
  demo: "Synthetic demo data",
  "norsk-tipping-api-v2": "Norsk Tipping results API (collector)",
  "uttrekk-nt": "Norsk Tipping data extract",
  unknown: "Unknown source"
};

/** Human label for a draw's source key, including collector/third-party keys. */
function sourceLabel(key) {
  if (!key) return SOURCE_LABELS.unknown;
  if (SOURCE_LABELS[key]) return SOURCE_LABELS[key];
  const tp = key.match(/^(?:tredjepart|thirdparty|third-party):(.+)$/);
  if (tp) return `Independent dataset (${tp[1]})`;
  return key;
}

const FETCH_TIMEOUT_MS = 12000;
const API_PAUSE_MS = 1500;          // polite spacing between API calls
const API_MAX_CONSECUTIVE_FAILS = 2; // stop hammering a source that is down
const LEGACY_MAX_REQUESTS = 60;

function fetchWithTimeout(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, Object.assign({ mode: "cors", signal: ctrl.signal }, init || {})).finally(() => clearTimeout(timer));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describeError(e) {
  if (!e) return "unknown error";
  if (e.name === "AbortError") return "timed out";
  if (e.message === "Failed to fetch" || e.name === "TypeError") return "blocked by the browser (network or CORS)";
  return e.message || String(e);
}

/** Windows of `days` from newest to oldest, within [from, to]. */
function windowsNewestFirst(from, to, days) {
  const out = [];
  let end = new Date(to);
  while (end >= from) {
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - days);
    out.push({ from: start < from ? new Date(from) : start, to: new Date(end) });
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
  }
  return out;
}

/** Weeks in [from, to] that still need draws, as a Set of "year-week". */
function missingWeekKeys(draws, cfg, from, to) {
  const cov = coverageByWeek(draws, cfg, from, to, null);
  const keys = new Set();
  for (const y of cov.years) for (const w of y.weeks) if (w.status === "missing" || w.status === "partial") keys.add(`${y.year}-${w.week}`);
  return keys;
}

function windowHasMissing(win, missing) {
  const a = isoWeekOf(win.from);
  const b = isoWeekOf(win.to);
  for (let y = a.year; y <= b.year; y++) {
    const last = isoWeeksInYear(y);
    for (let w = y === a.year ? a.week : 1; w <= (y === b.year ? b.week : last); w++) {
      if (missing.has(`${y}-${w}`)) return true;
    }
  }
  return false;
}

/* ---------------- source 1: Norsk Tipping results API v2 ---------------- */

async function sourceNtApiV2(cfg, range, state, report) {
  const src = report.start("nt-api-v2", "nt-api-v2");
  const wins = windowsNewestFirst(range.from, range.to, cfg.api.v2WindowDays);
  let fails = 0;
  let calls = 0;
  for (const win of wins) {
    if (!windowHasMissing(win, state.missing)) continue; // already covered by earlier data
    const url = `${cfg.api.v2}?fromDate=${isoDateKey(win.from)}&toDate=${isoDateKey(win.to)}`;
    report.progress(`Norsk Tipping API: ${isoDateKey(win.from)} → ${isoDateKey(win.to)} (${++calls} requests)`);
    try {
      const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`HTTP ${res.status} — access denied; not retried`), { fatal: true });
      if (res.status === 429) throw Object.assign(new Error("HTTP 429 — rate limited; stopped to stay polite"), { fatal: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const draws = parseNorskTippingV2(await res.json(), cfg, "nt-api-v2");
      state.add(draws, "nt-api-v2");
      src.draws += draws.length;
      src.windows++;
      fails = 0;
      if (draws.length === 0 && win.to < new Date(range.to.getFullYear() - 1, 0, 1)) {
        // Empty window well in the past: likely before the API's own history start.
        src.note = `no data before ${isoDateKey(win.to)} — the API's history seems to start later`;
        break;
      }
    } catch (e) {
      fails++;
      src.errors.push(`${isoDateKey(win.from)}…${isoDateKey(win.to)}: ${describeError(e)}`);
      if (e.fatal || fails >= API_MAX_CONSECUTIVE_FAILS) {
        src.note = e.fatal ? describeError(e) : `gave up after ${fails} consecutive failures`;
        break;
      }
    }
    await sleep(API_PAUSE_MS);
  }
  report.finish(src);
}

/* ---------------- sources 2–3: CSV datasets ---------------- */

async function sourceCsv(id, label, url, cfg, state, report) {
  const src = report.start(id, label);
  if (!url) {
    src.status = "skipped";
    src.note = "no dataset configured for this lottery";
    report.finish(src);
    return;
  }
  report.progress(`Loading ${SOURCE_LABELS[id] || label}…`);
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(res.status === 404 ? "not found (404)" : `HTTP ${res.status}`);
    const text = await res.text();
    let draws = parseHeaderCsv(text, cfg, id);
    if (!draws.length) draws = parseDraws(text, cfg).map((d) => Object.assign(d, { source: id }));
    draws = draws.filter((d) => d.date && d.date >= state.range.from && d.date <= state.range.to);
    state.add(draws, id);
    src.draws += draws.length;
    if (!draws.length) src.note = "no draws in the requested period";
  } catch (e) {
    src.errors.push(describeError(e));
    src.note = describeError(e);
  }
  report.finish(src);
}

/* ---------------- source 4: legacy drawID API ---------------- */

function extractLegacyDrawId(text) {
  const m = text.match(/"drawI[dD]"\s*:\s*"?(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

async function sourceNtLegacy(cfg, state, report) {
  const src = report.start("nt-api-legacy", "nt-api-legacy");
  if (!state.missing.size) {
    src.status = "skipped";
    src.note = "nothing left to fetch";
    report.finish(src);
    return;
  }
  try {
    report.progress("Legacy Norsk Tipping API: latest draw…");
    const res = await fetchWithTimeout(cfg.api.legacy);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const latestId = extractLegacyDrawId(text);
    const latest = parseDraws(text, cfg).map((d) => Object.assign(d, { source: "nt-api-legacy" }));
    if (!latestId || !latest.length) throw new Error("no recognisable draw in the response");
    state.add(latest, "nt-api-legacy");
    src.draws += latest.length;
    let id = latestId - 1;
    let requests = 1;
    while (requests < LEGACY_MAX_REQUESTS && state.missing.size) {
      await sleep(API_PAUSE_MS);
      const r = await fetchWithTimeout(`${cfg.api.legacy}?drawID=${id}`);
      requests++;
      if (!r.ok) break;
      const draws = parseDraws(await r.text(), cfg).map((d) => Object.assign(d, { source: "nt-api-legacy" }));
      if (!draws.length) break;
      if (draws.every((d) => d.date && d.date < state.range.from)) break;
      state.add(draws, "nt-api-legacy");
      src.draws += draws.length;
      report.progress(`Legacy API: ${requests} requests`);
      id--;
    }
  } catch (e) {
    src.errors.push(describeError(e));
    src.note = describeError(e);
  }
  report.finish(src);
}

/* ---------------- orchestration ---------------- */

/**
 * Collect draws for `cfg` between `range.from` and `range.to`, trying each
 * source in order and only asking later sources for weeks still missing.
 * `existing` draws (already loaded) count as covered.
 * Returns { draws, sources, coverage, conflicts, range }.
 */
async function collectHistory(cfg, range, existing, onProgress) {
  const state = {
    range,
    draws: (existing || []).slice(),
    conflicts: [],
    missing: null,
    add(draws, id) {
      const { draws: merged, conflicts } = mergeDrawsByDate(this.draws, draws);
      this.draws = merged;
      this.conflicts.push(...conflicts.map((c) => Object.assign(c, { source: id })));
      this.missing = missingWeekKeys(this.draws, cfg, range.from, range.to);
    }
  };
  state.missing = missingWeekKeys(state.draws, cfg, range.from, range.to);

  const sources = [];
  const report = {
    start(id, label) {
      const s = { id, label: SOURCE_LABELS[id] || label, status: "running", draws: 0, windows: 0, errors: [], note: "" };
      sources.push(s);
      return s;
    },
    finish(s) {
      if (s.status === "running") s.status = s.draws > 0 ? "ok" : s.errors.length ? "failed" : "empty";
      s.missingAfter = state.missing.size;
    },
    progress(msg) {
      if (onProgress) onProgress(msg, sources);
    }
  };

  await sourceNtApiV2(cfg, range, state, report);
  if (state.missing.size) await sourceCsv("bundled-csv", "bundled-csv", cfg.data.bundled, cfg, state, report);
  if (state.missing.size) await sourceCsv("thirdparty-csv", "thirdparty-csv", cfg.data.thirdParty && cfg.data.thirdParty.url, cfg, state, report);
  if (state.missing.size) await sourceNtLegacy(cfg, state, report);

  return {
    draws: state.draws,
    sources,
    conflicts: state.conflicts,
    range,
    coverage: coverageByWeek(state.draws, cfg, range.from, range.to, null)
  };
}
