/* Crawler for historic results (2020-2026). Browser-only: uses fetch and
   DOMParser. Strategy A walks the unofficial Norsk Tipping JSON API draw by
   draw; strategy B parses the result pages. Every request tries the source
   directly, then public read-through mirrors (the pages block cross-origin
   browser requests). */
"use strict";

const CRAWL_FROM = new Date(2020, 0, 1);
const CRAWL_TO = new Date(2026, 11, 31);
const CRAWL_TIMEOUT_MS = 12000;
const CRAWL_MAX_REQUESTS = 700;
const CRAWL_CONCURRENCY = 5;
/* Stop walking once this many draws in a row are older than 2020. */
const CRAWL_OLD_STREAK_STOP = 8;

const CRAWL_ROUTES = [
  { name: "the source directly", make: (u) => u },
  { name: "backup mirror allorigins.win", make: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  { name: "backup mirror corsproxy.io", make: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
  { name: "backup mirror codetabs.com", make: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` }
];

function crawlFetchWithTimeout(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CRAWL_TIMEOUT_MS);
  return fetch(url, { mode: "cors", signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

/** Fetch trying direct first, then mirrors; `preferredIdx` reorders so a
    route that already worked for this host is tried first. */
async function crawlFetch(url, preferredIdx) {
  const order = CRAWL_ROUTES.map((_, i) => i);
  if (preferredIdx > 0) {
    order.splice(order.indexOf(preferredIdx), 1);
    order.unshift(preferredIdx);
  }
  const failures = [];
  for (const i of order) {
    try {
      const res = await crawlFetchWithTimeout(CRAWL_ROUTES[i].make(url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) throw new Error("empty response");
      return { text, routeIdx: i, via: CRAWL_ROUTES[i].name };
    } catch (e) {
      failures.push(`${CRAWL_ROUTES[i].name}: ${e.name === "AbortError" ? "timed out" : e.message}`);
    }
  }
  throw new Error(failures.join(" · "));
}

/** Turn fetched HTML into line-oriented text so the draw parser can work on it. */
function crawlStripHtml(text) {
  if (!/<[a-z!/]/i.test(text)) return text;
  const doc = new DOMParser().parseFromString(text, "text/html");
  for (const el of doc.querySelectorAll("script, style")) el.remove();
  for (const el of doc.querySelectorAll("tr, li, p, div, h1, h2, h3")) el.append("\n");
  return doc.body ? doc.body.textContent : text;
}

function inCrawlRange(draw) {
  return draw.date !== null && draw.date >= CRAWL_FROM && draw.date <= CRAWL_TO;
}

function crawlExtractDrawId(text) {
  const m = text.match(/"drawI[dD]"\s*:\s*"?(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/** Strategy A: walk the unofficial JSON API backwards from the latest draw
    until the draws predate 2020 (or the request budget runs out). */
async function crawlViaApi(cfg, onProgress) {
  const base = cfg.crawl.api;
  const latest = await crawlFetch(base, -1);
  const latestId = crawlExtractDrawId(latest.text);
  const latestDraws = parseDraws(latest.text, cfg);
  if (!latestId || !latestDraws.length) throw new Error("the API response had no recognisable draw");

  const collected = latestDraws.slice();
  let requests = 1;
  let nextId = latestId - 1;
  let oldStreak = 0;
  let stopped = false;

  const workers = Array.from({ length: CRAWL_CONCURRENCY }, async () => {
    while (!stopped && nextId > 0 && requests < CRAWL_MAX_REQUESTS && oldStreak < CRAWL_OLD_STREAK_STOP) {
      const id = nextId--;
      requests++;
      try {
        const { text } = await crawlFetch(`${base}?drawID=${id}`, latest.routeIdx);
        const draws = parseDraws(text, cfg);
        if (draws.length) {
          collected.push(...draws);
          if (draws.every((d) => d.date !== null && d.date < CRAWL_FROM)) oldStreak++;
          else oldStreak = 0;
        }
      } catch (e) {
        /* skip this draw; the streak/budget limits bound the walk */
      }
      if (requests % 5 === 0) onProgress(requests);
    }
    if (oldStreak >= CRAWL_OLD_STREAK_STOP) stopped = true;
  });
  await Promise.all(workers);

  const draws = dedupeDraws(collected).filter(inCrawlRange);
  if (!draws.length) throw new Error("the API yielded no draws within 2020-2026");
  return { draws, source: `the Norsk Tipping API (via ${latest.via}, ${requests} requests)` };
}

/** Strategy B: fetch the result pages and parse whatever draws they contain. */
async function crawlViaPages(cfg, onProgress) {
  const collected = [];
  let lastError = null;
  for (const url of cfg.crawl.pages) {
    try {
      onProgress(null, `Fetching ${url}…`);
      const { text } = await crawlFetch(url, -1);
      collected.push(...parseDraws(crawlStripHtml(text), cfg));
    } catch (e) {
      lastError = e;
    }
  }
  const draws = dedupeDraws(collected).filter(inCrawlRange);
  if (!draws.length) {
    throw lastError || new Error("the result pages contained no parsable dated draws within 2020-2026");
  }
  return { draws, source: "the result pages" };
}

/**
 * Crawl 2020-2026 results for a lottery. onProgress(requestCount, message?)
 * is called periodically. Returns { draws, source }.
 */
async function crawlLottery(cfg, onProgress) {
  let apiError;
  try {
    return await crawlViaApi(cfg, onProgress);
  } catch (e) {
    apiError = e;
  }
  try {
    return await crawlViaPages(cfg, onProgress);
  } catch (e) {
    throw new Error(`API: ${apiError.message} — pages: ${e.message}`);
  }
}
