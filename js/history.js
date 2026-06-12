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
  const tokens = rest.match(/\d{1,2}/g) || [];
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
