/* Historical draw loading, parsing, filtering and indexing. No DOM access. */
"use strict";

/**
 * A draw: { date: Date|null, mains: number[] (sorted), stars: number[] (sorted) }
 */

const DATE_PATTERNS = [
  // ISO: 2024-03-16 or 2024/03/16
  { re: /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/, order: ["y", "m", "d"] },
  // Norwegian/European: 16.03.2024 or 16/03/2024 or 16-03-2024
  { re: /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/, order: ["d", "m", "y"] }
];

function parseDateFromText(text) {
  // Compact yyyymmdd (e.g. "20240316"), as returned by the unofficial
  // Norsk Tipping API. Only when the whole token is the date, so eight
  // arbitrary digits in free text aren't misread.
  const compact = String(text).match(/^\s*(\d{4})(\d{2})(\d{2})\s*$/);
  if (compact) {
    const y = parseInt(compact[1], 10);
    const m = parseInt(compact[2], 10);
    const d = parseInt(compact[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(y, m - 1, d);
      if (!isNaN(dt.getTime())) return { date: dt, matched: compact[0] };
    }
  }
  for (const p of DATE_PATTERNS) {
    const m = text.match(p.re);
    if (!m) continue;
    const parts = {};
    p.order.forEach((k, i) => (parts[k] = parseInt(m[i + 1], 10)));
    if (parts.m < 1 || parts.m > 12 || parts.d < 1 || parts.d > 31) continue;
    const dt = new Date(parts.y, parts.m - 1, parts.d);
    if (!isNaN(dt.getTime())) return { date: dt, matched: m[0] };
  }
  return null;
}

/**
 * Parse one line of free text / CSV into a draw for the given lottery config.
 * Strategy: strip the date (so its digits aren't mistaken for balls), then
 * collect integers in range. First mainPick numbers are main numbers, the
 * next starPick numbers (within star range) are star numbers.
 */
function parseDrawLine(line, cfg) {
  const found = parseDateFromText(line);
  let rest = line;
  if (found) rest = line.replace(found.matched, " ");
  // Drop 4-digit years and anything attached to currency-ish tokens.
  rest = rest.replace(/\b\d{4,}\b/g, " ");
  // Digits glued to letters (header tokens like "n1", "star2") are not balls.
  const tokens = rest.match(/(?<![A-Za-z0-9])\d{1,2}(?![A-Za-z0-9])/g) || [];
  const mains = [];
  const stars = [];
  for (const t of tokens) {
    const n = parseInt(t, 10);
    if (mains.length < cfg.mainPick) {
      if (n >= 1 && n <= cfg.mainMax) mains.push(n);
    } else if (cfg.starPick > 0 && stars.length < cfg.starPick) {
      if (n >= 1 && n <= cfg.starMax) stars.push(n);
    } else {
      break;
    }
  }
  if (mains.length !== cfg.mainPick) return null;
  if (new Set(mains).size !== cfg.mainPick) return null;
  return {
    date: found ? found.date : null,
    mains: mains.slice().sort((a, b) => a - b),
    stars: stars.slice().sort((a, b) => a - b)
  };
}

/** Parse pasted text / CSV content: one draw per line (header lines ignored). */
function parseDrawsText(text, cfg) {
  const draws = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const draw = parseDrawLine(line, cfg);
    if (draw) draws.push(draw);
  }
  return draws;
}

/**
 * Parse JSON content. Supports:
 *  - our export format: [{date, mains, stars}]
 *  - generic shapes: looks for arrays of numbers under common keys.
 */
function parseDrawsJson(text, cfg) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return [];
  }
  const draws = [];
  let items = [];
  if (Array.isArray(data)) items = data;
  else if (data && Array.isArray(data.draws)) items = data.draws;
  else if (data && Array.isArray(data.results)) items = data.results;
  else if (data && data.last && typeof data.last === "object") items = [data.last]; // Lottoland shape
  else if (data && typeof data === "object") items = [data]; // single draw (Norsk Tipping API)
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const mains =
      pickNumberArray(item, ["mains", "mainNumbers", "numbers", "winningNumbers", "balls"], cfg.mainPick, cfg.mainMax);
    if (!mains) continue;
    let stars = [];
    if (cfg.starPick > 0) {
      stars =
        pickNumberArray(item, ["stars", "starNumbers", "euroNumbers", "bonusNumbers", "extraNumbers"], cfg.starPick, cfg.starMax) || [];
    }
    let date = null;
    for (const key of ["date", "drawDate", "draw_date", "drawingDate"]) {
      if (item[key]) {
        // Lottoland encodes the date as { day, month, year }.
        if (typeof item[key] === "object" && item[key].year) {
          const o = item[key];
          const dt = new Date(parseInt(o.year, 10), parseInt(o.month, 10) - 1, parseInt(o.day, 10));
          if (!isNaN(dt.getTime())) {
            date = dt;
            break;
          }
        }
        const found = parseDateFromText(String(item[key]));
        if (found) {
          date = found.date;
          break;
        }
        const dt = new Date(item[key]);
        if (!isNaN(dt.getTime())) {
          date = dt;
          break;
        }
      }
    }
    draws.push({ date, mains: mains.sort((a, b) => a - b), stars: stars.sort((a, b) => a - b) });
  }
  return draws;
}

function pickNumberArray(obj, keys, count, max) {
  for (const key of keys) {
    const v = obj[key];
    if (Array.isArray(v) && v.length >= count) {
      const nums = v.slice(0, count).map((x) => parseInt(x, 10));
      if (nums.every((n) => Number.isInteger(n) && n >= 1 && n <= max) && new Set(nums).size === count) {
        return nums;
      }
    }
  }
  return null;
}

/** Slice out the JSON body when the response has a non-JSON prefix, e.g.
    the `while(true);/* 0;` anti-hijacking guard on the Norsk Tipping API. */
function extractJsonCandidate(content) {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const starts = [trimmed.indexOf("{"), trimmed.indexOf("[")].filter((i) => i >= 0);
  if (!starts.length) return null;
  const first = Math.min(...starts);
  const close = trimmed[first] === "{" ? "}" : "]";
  const last = trimmed.lastIndexOf(close);
  return last > first ? trimmed.slice(first, last + 1) : null;
}

/** Auto-detect JSON vs text and parse. */
function parseDraws(content, cfg) {
  const candidate = extractJsonCandidate(content);
  if (candidate) {
    const fromJson = parseDrawsJson(candidate, cfg);
    if (fromJson.length) return fromJson;
  }
  return parseDrawsText(content, cfg);
}

/** Deduplicate draws by row key, keeping the first occurrence. */
function dedupeDraws(draws) {
  const seen = new Set();
  const out = [];
  for (const d of draws) {
    const key = rowKey(d.mains, d.stars);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/**
 * Filter draws to the lookback window.
 * years <= 0 means "use everything". Draws without a date are always kept
 * (better to exclude too much than miss a known historical row).
 */
function filterDrawsByYears(draws, years, now) {
  if (!years || years <= 0) return draws.slice();
  const ref = now || new Date();
  const cutoff = new Date(ref.getFullYear() - years, ref.getMonth(), ref.getDate());
  return draws.filter((d) => d.date === null || d.date >= cutoff);
}

/**
 * Build exclusion indexes from a set of (already filtered) draws.
 *  - exactKeys: full historical rows (main numbers only, so a generated row
 *    is rejected if its main numbers were ever drawn together).
 *  - subsetKeys: every k-combination of main numbers per draw (if k > 0).
 */
function buildHistoryIndex(draws, subsetSize) {
  const exactKeys = new Set();
  const subsetKeys = new Set();
  for (const d of draws) {
    exactKeys.add(d.mains.join("-"));
    if (subsetSize && subsetSize > 0 && subsetSize <= d.mains.length) {
      for (const key of combinationKeys(d.mains, subsetSize)) subsetKeys.add(key);
    }
  }
  return { exactKeys, subsetKeys, subsetSize: subsetSize || 0, drawCount: draws.length };
}

/** Frequency of each main number across draws. Returns array indexed 1..mainMax. */
function numberFrequencies(draws, cfg) {
  const freq = new Array(cfg.mainMax + 1).fill(0);
  for (const d of draws) for (const n of d.mains) freq[n]++;
  return freq;
}

/**
 * For each main number, how many draws ago it last appeared (0 = in the most
 * recent draw). Numbers that never appeared get `draws.length` (most overdue).
 * Draws are ordered newest-first by date; undated draws are treated as oldest.
 */
function drawsSinceLastSeen(draws, cfg) {
  const sorted = draws
    .slice()
    .sort((a, b) => (b.date ? b.date.getTime() : -Infinity) - (a.date ? a.date.getTime() : -Infinity));
  const last = new Array(cfg.mainMax + 1).fill(-1);
  sorted.forEach((d, i) => {
    for (const n of d.mains) if (last[n] === -1) last[n] = i;
  });
  return last.map((v) => (v === -1 ? sorted.length : v));
}

/** Build a CSV of draws (newest first): date,n1..nK[,star1..]. The same
    format the file importer reads back. */
function buildResultsCsv(draws, cfg) {
  const header = ["date"];
  for (let i = 1; i <= cfg.mainPick; i++) header.push("n" + i);
  for (let i = 1; i <= cfg.starPick; i++) header.push("star" + i);
  const sorted = draws
    .slice()
    .sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
  const lines = [header.join(",")];
  for (const d of sorted) {
    const iso = d.date
      ? `${d.date.getFullYear()}-${String(d.date.getMonth() + 1).padStart(2, "0")}-${String(d.date.getDate()).padStart(2, "0")}`
      : "";
    const stars = d.stars.slice(0, cfg.starPick);
    while (stars.length < cfg.starPick) stars.push("");
    lines.push([iso, ...d.mains, ...stars].join(","));
  }
  return lines.join("\n");
}

function drawsDateRange(draws) {
  let min = null;
  let max = null;
  for (const d of draws) {
    if (!d.date) continue;
    if (!min || d.date < min) min = d.date;
    if (!max || d.date > max) max = d.date;
  }
  return { min, max };
}

/* ======================= ISO weeks & coverage ======================= */

/** ISO-8601 year and week for a date (local time). */
function isoWeekOf(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; // Monday=1 … Sunday=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // nearest Thursday
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year: isoYear, week };
}

/** Monday (local midnight) that starts ISO week `week` of `year`. */
function isoWeekStart(year, week) {
  const jan4 = new Date(year, 0, 4);
  const day = jan4.getDay() || 7;
  const monday = new Date(year, 0, 4 - (day - 1));
  monday.setDate(monday.getDate() + (week - 1) * 7);
  return monday;
}

function isoWeeksInYear(year) {
  return isoWeekOf(new Date(year, 11, 28)).week;
}

function parseIsoDate(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)) : null;
}

/**
 * Draws expected in the ISO week starting `weekStart`, from cfg.schedule.
 * Only draw days that fall inside [rangeFrom, rangeTo] (when given) and on or
 * after launch are counted, so a range that starts late in a week, or the
 * current week, is not judged against draws that cannot exist.
 */
function expectedDrawsInWeek(cfg, weekStart, rangeFrom, rangeTo) {
  const launch = parseIsoDate(cfg.launch);
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    if (launch && day < launch) continue;
    if (rangeFrom && day < rangeFrom) continue;
    if (rangeTo && day > rangeTo) continue;
    let rule = null;
    for (const s of cfg.schedule || []) {
      const from = parseIsoDate(s.from);
      if (from && from <= day) rule = s;
    }
    if (!rule) continue;
    if (rule.drawDays ? rule.drawDays.includes(day.getDay()) : i === 6) count++;
  }
  return count;
}

/**
 * Week-by-week coverage of `draws` between `from` and `to` (inclusive).
 * `usedKeys` is a Set of "yyyy-mm-dd" dates that the generator actually uses.
 * Returns { years: [{ year, weeks: [{ week, start, expected, fetched, used, sources, status }] }], totals }.
 * status: "future" | "before-launch" | "complete" | "partial" | "missing" | "pending" (current week)
 */
function coverageByWeek(draws, cfg, from, to, usedKeys, now) {
  const today = now || new Date();
  const byWeek = new Map();
  for (const d of draws) {
    if (!d.date) continue;
    const { year, week } = isoWeekOf(d.date);
    const key = `${year}-${week}`;
    const entry = byWeek.get(key) || { fetched: 0, used: 0, sources: new Set() };
    entry.fetched++;
    if (usedKeys && usedKeys.has(isoDateKey(d.date))) entry.used++;
    entry.sources.add(d.source || "unknown");
    byWeek.set(key, entry);
  }

  const startWeek = isoWeekOf(from);
  const endWeek = isoWeekOf(to);
  const years = [];
  const totals = { weeks: 0, complete: 0, partial: 0, missing: 0, future: 0, beforeLaunch: 0, fetchedDraws: 0, usedDraws: 0, usedWeeks: 0, bySource: {} };
  for (let y = startWeek.year; y <= endWeek.year; y++) {
    const weeks = [];
    const last = isoWeeksInYear(y);
    for (let w = 1; w <= last; w++) {
      if (y === startWeek.year && w < startWeek.week) continue;
      if (y === endWeek.year && w > endWeek.week) continue;
      const start = isoWeekStart(y, w);
      const entry = byWeek.get(`${y}-${w}`) || { fetched: 0, used: 0, sources: new Set() };
      const weekEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      // Expected draws: only draw days inside the range, and (for the current
      // week) up to today — so a week is "pending" rather than "missing" until
      // its draw day has actually passed.
      const expectedSoFar = expectedDrawsInWeek(cfg, start, from, weekEnd >= today ? today : null);
      const expected = expectedDrawsInWeek(cfg, start, from, null);
      let status;
      if (start > today) status = "future";
      else if (expected === 0) status = "before-launch";
      else if (entry.fetched >= expected) status = "complete";
      else if (weekEnd >= today && entry.fetched >= expectedSoFar) status = "pending";
      else if (entry.fetched > 0) status = "partial";
      else status = "missing";
      const week = { week: w, start, expected, fetched: entry.fetched, used: entry.used, sources: [...entry.sources].sort(), status };
      weeks.push(week);
      totals.weeks++;
      if (status === "complete") totals.complete++;
      else if (status === "partial") totals.partial++;
      else if (status === "missing") totals.missing++;
      else if (status === "future" || status === "pending") totals.future++;
      else totals.beforeLaunch++;
      totals.fetchedDraws += entry.fetched;
      totals.usedDraws += entry.used;
      if (entry.used) totals.usedWeeks++;
      for (const s of entry.sources) totals.bySource[s] = (totals.bySource[s] || 0) + 1;
    }
    years.push({ year: y, weeks });
  }
  return { years, totals };
}

function isoDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/* ======================= Source-specific parsers ======================= */

/**
 * Parse a Norsk Tipping LotteryGameInfo v2 response. The draw list is found
 * recursively (objects carrying winnerNumber + drawDate) so a changed wrapper
 * key does not break parsing. type 1 = main numbers, type 2 = bonus/star.
 */
function parseNorskTippingV2(data, cfg, source) {
  const items = [];
  (function walk(x) {
    if (Array.isArray(x)) return x.forEach(walk);
    if (x && typeof x === "object") {
      if ("winnerNumber" in x && "drawDate" in x) return items.push(x);
      Object.values(x).forEach(walk);
    }
  })(data);
  const draws = [];
  for (const it of items) {
    const found = parseDateFromText(String(it.drawDate).slice(0, 10)) || parseDateFromText(String(it.drawDate));
    if (!found) continue;
    const mains = [];
    const extra = [];
    for (const wn of it.winnerNumber || []) {
      const n = parseInt(String(wn.number), 10);
      if (!Number.isInteger(n)) continue;
      const order = Number.isInteger(wn.drawOrder) ? wn.drawOrder : 1e6;
      if (wn.type === 1) mains.push([order, n]);
      else if (wn.type === 2) extra.push([order, n]);
    }
    mains.sort((a, b) => a[0] - b[0]);
    extra.sort((a, b) => a[0] - b[0]);
    const mainNums = mains.map((p) => p[1]);
    if (mainNums.length !== cfg.mainPick || new Set(mainNums).size !== cfg.mainPick) continue;
    if (mainNums.some((n) => n < 1 || n > cfg.mainMax)) continue;
    const extraNums = extra.map((p) => p[1]);
    draws.push({
      date: found.date,
      mains: mainNums.slice().sort((a, b) => a - b),
      drawOrder: mainNums,
      stars: cfg.starPick ? extraNums.slice(0, cfg.starPick).sort((a, b) => a - b) : [],
      bonus: cfg.starPick ? [] : extraNums.slice().sort((a, b) => a - b),
      drawId: Number.isInteger(it.drawId) ? it.drawId : null,
      source: source || "nt-api-v2"
    });
  }
  return draws;
}

/** Minimal RFC-4180-ish CSV line splitter (handles quoted fields with commas). */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Parse header-based CSV datasets:
 *  - the collector's format (game,draw_date,…,main_numbers,…,bonus_numbers,…,source)
 *  - eonurk/EuroJackpot (draw_date,main_numbers,euro_numbers with comma lists)
 * Returns [] when the header is not recognised, so callers can fall back to
 * the line-oriented parser.
 */
function parseHeaderCsv(text, cfg, source) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const iDate = header.indexOf("draw_date");
  const iMain = header.indexOf("main_numbers");
  if (iDate < 0 || iMain < 0) return [];
  const iStars = ["euro_numbers", "star_numbers", "stars"].map((k) => header.indexOf(k)).find((i) => i >= 0);
  const iBonus = header.indexOf("bonus_numbers");
  const iGame = header.indexOf("game");
  const iSource = header.indexOf("source");
  const iDrawId = header.indexOf("draw_id");
  const nums = (s) => (s || "").split(/[\s,;]+/).filter(Boolean).map((x) => parseInt(x, 10)).filter(Number.isInteger);
  const draws = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r]);
    if (iGame >= 0 && cols[iGame] && cols[iGame].trim() !== cfg.id) continue;
    const found = parseDateFromText(cols[iDate] || "");
    if (!found) continue;
    const mains = nums(cols[iMain]);
    if (mains.length !== cfg.mainPick || new Set(mains).size !== cfg.mainPick) continue;
    if (mains.some((n) => n < 1 || n > cfg.mainMax)) continue;
    let stars = [];
    let bonus = [];
    if (cfg.starPick) {
      stars = nums(iStars !== undefined ? cols[iStars] : iBonus >= 0 ? cols[iBonus] : "").slice(0, cfg.starPick);
      if (stars.length !== cfg.starPick || stars.some((n) => n < 1 || n > cfg.starMax)) stars = [];
    } else if (iBonus >= 0) {
      bonus = nums(cols[iBonus]);
    }
    draws.push({
      date: found.date,
      mains: mains.slice().sort((a, b) => a - b),
      stars: stars.sort((a, b) => a - b),
      bonus,
      drawId: iDrawId >= 0 && /^\d+$/.test(cols[iDrawId] || "") ? parseInt(cols[iDrawId], 10) : null,
      source: (iSource >= 0 && cols[iSource] && cols[iSource].trim()) || source || "csv"
    });
  }
  return draws;
}

/**
 * Merge draws from several sources. Earlier entries win on the same date;
 * a later entry with the same date but different numbers is reported as a
 * conflict instead of being added. Returns { draws, conflicts, added }.
 */
function mergeDrawsByDate(existing, incoming) {
  const byDate = new Map();
  for (const d of existing) if (d.date) byDate.set(isoDateKey(d.date), d);
  const conflicts = [];
  let added = 0;
  const out = existing.slice();
  for (const d of incoming) {
    if (!d.date) continue;
    const k = isoDateKey(d.date);
    const have = byDate.get(k);
    if (!have) {
      byDate.set(k, d);
      out.push(d);
      added++;
    } else if (have.mains.join("-") !== d.mains.join("-") || (have.stars || []).join("-") !== (d.stars || []).join("-")) {
      conflicts.push({ date: k, kept: have, rejected: d });
    }
  }
  return { draws: out, conflicts, added };
}

/** Draws the schedule says should have happened after `after` (exclusive) up
    to and including `until`. Used to tell the user how stale their data is. */
function drawsExpectedBetween(cfg, after, until) {
  if (!after || !until || until <= after) return 0;
  let count = 0;
  const launch = parseIsoDate(cfg.launch);
  for (let d = new Date(after.getFullYear(), after.getMonth(), after.getDate() + 1); d <= until; d.setDate(d.getDate() + 1)) {
    if (launch && d < launch) continue;
    let rule = null;
    for (const s of cfg.schedule || []) {
      const from = parseIsoDate(s.from);
      if (from && from <= d) rule = s;
    }
    if (rule && (rule.drawDays ? rule.drawDays.includes(d.getDay()) : d.getDay() === 6)) count++;
  }
  return count;
}

/* ======================= Best guess from past draws ======================= */

function quantile(sortedAsc, q) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(q * sortedAsc.length)));
  return sortedAsc[idx];
}

/** Smallest v so that at least `p` of the values are <= v. */
function smallestCovering(values, p) {
  const s = values.slice().sort((a, b) => a - b);
  const need = Math.ceil(p * s.length);
  return s[Math.max(0, need - 1)];
}

/**
 * Derive rule and filter settings from how past draws actually looked, so
 * that each rule on its own still lets `coverage` (default 95 %) of those
 * draws through. Descriptive only: it says nothing about the next draw.
 * Returns null if there are too few draws, else
 * { n, coverage, settings: { elementId: value }, notes: [string] }.
 */
function deriveBestGuess(cfg, draws, coverage) {
  const p = coverage || 0.95;
  const usable = draws.filter((d) => d.mains && d.mains.length === cfg.mainPick);
  if (usable.length < 40) return null;
  const sorted = usable.slice().sort((a, b) => (a.date ? a.date.getTime() : 0) - (b.date ? b.date.getTime() : 0));
  const tail = (1 - p) / 2;
  const half = Math.ceil(cfg.mainMax / 2);
  const zones = Math.ceil(cfg.mainMax / cfg.zoneSize);
  const col = (fn) => sorted.map((d) => fn(d.mains));
  const central = (vals) => {
    const s = vals.slice().sort((a, b) => a - b);
    return [quantile(s, tail), quantile(s, 1 - tail - 1e-9)];
  };

  const runs = col(longestConsecutiveRun);
  const odds = col(countOdd);
  const sums = col(sumOf);
  const zoneMax = col((m) => { const c = new Array(zones).fill(0); for (const n of m) c[Math.floor((n - 1) / cfg.zoneSize)]++; return Math.max(...c); });
  const parity = col(longestParityRun);
  const arith = col(longestArithmeticProgression);
  const lastDigit = col(maxSameLastDigit);
  const mult = col((m) => maxSharedDivisor(m));
  const lowCounts = col((m) => m.filter((n) => n <= half).length);
  const highCounts = lowCounts.map((l) => cfg.mainPick - l);
  const hasBig = col((m) => (m.some((n) => n > 31) ? 1 : 0));
  const overlaps = [];
  for (let i = 1; i < sorted.length; i++) overlaps.push(overlapCount(sorted[i - 1].mains, sorted[i].mains));

  const [oddLo, oddHi] = central(odds);
  const [sumLo, sumHi] = central(sums);
  const [lowLo] = central(lowCounts);
  const [highLo] = central(highCounts);
  const [ovLo, ovHi] = central(overlaps);
  const S = {};
  const notes = [];
  const pct = Math.round(p * 100);

  S["crit-maxrun"] = true; S["crit-maxrun-value"] = Math.max(1, smallestCovering(runs, p));
  notes.push(`Longest run of consecutive numbers: up to ${S["crit-maxrun-value"]}`);
  S["crit-oddeven"] = true; S["crit-oddeven-min"] = oddLo; S["crit-oddeven-max"] = oddHi;
  notes.push(`Odd numbers per draw: ${oddLo}–${oddHi}`);
  S["crit-sum"] = true; S["crit-sum-min"] = sumLo; S["crit-sum-max"] = sumHi;
  notes.push(`Sum of numbers: ${sumLo}–${sumHi}`);
  S["crit-zone"] = true; S["crit-zone-max"] = Math.max(1, smallestCovering(zoneMax, p)); S["crit-zone-min"] = 0;
  notes.push(`Most numbers in one zone of ten: ${S["crit-zone-max"]}`);
  S["crit-parity"] = true; S["crit-parity-value"] = Math.max(1, smallestCovering(parity, p));
  S["crit-arith"] = true; S["crit-arith-value"] = Math.max(2, smallestCovering(arith, p));
  notes.push(`Equal-gap progression: up to ${S["crit-arith-value"]}`);
  S["ap-lastdigit"] = true; S["ap-lastdigit-max"] = Math.max(1, smallestCovering(lastDigit, p));
  S["ap-multiple"] = true; S["ap-multiple-max"] = Math.max(1, smallestCovering(mult, p));
  if (lowLo >= 1 || highLo >= 1) {
    S["ap-lowhigh"] = true; S["ap-lowhigh-low"] = lowLo; S["ap-lowhigh-high"] = highLo;
    notes.push(`At least ${lowLo} from the lower and ${highLo} from the higher half`);
  } else {
    S["ap-lowhigh"] = false;
  }
  const bigShare = hasBig.reduce((a, b) => a + b, 0) / hasBig.length;
  S["crit-birthday"] = bigShare >= p;
  S["crit-overlap"] = true; S["crit-overlap-max"] = Math.min(cfg.mainPick - 1, 4);

  // Reuse from the previous draw
  S["reuse-enabled"] = true; S["reuse-min"] = ovLo; S["reuse-max"] = ovHi;
  notes.push(`Numbers repeated from the previous draw: ${ovLo}–${ovHi}`);

  // Lower/higher lean: is the mean low count significantly different from chance?
  const mean = lowCounts.reduce((a, b) => a + b, 0) / lowCounts.length;
  const expected = (cfg.mainPick * half) / cfg.mainMax;
  const variance = lowCounts.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, lowCounts.length - 1);
  const z = (mean - expected) / Math.sqrt(variance / lowCounts.length || 1);
  if (Math.abs(z) >= 2) {
    const lean = Math.max(-100, Math.min(100, Math.round(((expected - mean) / expected) * 400 / 5) * 5));
    S["bias-half"] = true; S["bias-half-value"] = lean;
    notes.push(`Past draws lean ${lean < 0 ? "lower" : "higher"} (${mean.toFixed(2)} lower-half numbers per draw vs ${expected.toFixed(2)} expected) → slider ${lean > 0 ? "+" : ""}${lean}`);
  } else {
    S["bias-half"] = false; S["bias-half-value"] = 0;
    notes.push(`No significant lean to the lower or higher half (${mean.toFixed(2)} vs ${expected.toFixed(2)} expected)`);
  }

  S["hist-exact"] = true;
  S["hist-subset"] = false;
  S["bias-overdue"] = false;
  S["bias-cold"] = false;
  return { n: sorted.length, coverage: p, settings: S, notes, coveragePct: pct };
}
