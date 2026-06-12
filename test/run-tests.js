/* Minimal test runner for the DOM-free logic (util, history, generator).
   Run with: node test/run-tests.js */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const context = { crypto: require("crypto").webcrypto, console };
vm.createContext(context);
for (const file of ["lotteries.js", "util.js", "history.js", "generator.js"]) {
  const code = fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8");
  vm.runInContext(code, context, { filename: file });
}

let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

// Top-level const/function bindings live in the context's lexical scope,
// not on the sandbox object — pull them out by evaluating an expression.
const {
  LOTTERIES, sampleDistinct, combinationKeys, longestConsecutiveRun, sumOf, countOdd,
  overlapCount, parseDrawsText, parseDraws, filterDrawsByYears, buildHistoryIndex,
  dedupeDraws, generateTickets
} = vm.runInContext(
  `({ LOTTERIES, sampleDistinct, combinationKeys, longestConsecutiveRun, sumOf, countOdd,
      overlapCount, parseDrawsText, parseDraws, filterDrawsByYears, buildHistoryIndex,
      dedupeDraws, generateTickets })`,
  context
);

/* ---- util ---- */
const pool = Array.from({ length: 34 }, (_, i) => i + 1);
for (let i = 0; i < 50; i++) {
  const s = sampleDistinct(pool, 7);
  assert(s.length === 7 && new Set(s).size === 7, "sampleDistinct picks 7 distinct");
  assert(s.every((n) => n >= 1 && n <= 34), "sampleDistinct in range");
  assert(s.every((n, j) => j === 0 || n > s[j - 1]), "sampleDistinct sorted");
}

assert(longestConsecutiveRun([1, 2, 3, 10, 20]) === 3, "longestConsecutiveRun basic");
assert(longestConsecutiveRun([5, 9, 14]) === 1, "longestConsecutiveRun no run");
assert(combinationKeys([1, 2, 3], 2).join(" ") === "1-2 1-3 2-3", "combinationKeys 3 choose 2");
assert(combinationKeys([1, 2, 3, 4], 4).length === 1, "combinationKeys n choose n");
assert(overlapCount([1, 2, 3], [3, 4, 5]) === 1, "overlapCount");

/* ---- history parsing ---- */
const lotto = LOTTERIES.lotto;
const euro = LOTTERIES.eurojackpot;

const text = [
  "Dato,Tall",
  "16.03.2024 1 5 12 19 23 28 31",
  "2024-03-09,2,6,11,18,22,27,30",
  "garbage line without numbers",
  "23.12.2019 3 7 13 20 24 29 33"
].join("\n");
const draws = parseDrawsText(text, lotto);
assert(draws.length === 3, "parseDrawsText finds 3 lotto draws");
assert(draws[0].date.getFullYear() === 2024 && draws[0].date.getMonth() === 2, "parses Norwegian date");
assert(draws[1].mains.join(",") === "2,6,11,18,22,27,30", "parses ISO/CSV line");

const euroDraws = parseDrawsText("14.06.2024 7 19 28 33 45 + 3 9", euro);
assert(euroDraws.length === 1, "parses eurojackpot line");
assert(euroDraws[0].stars.join(",") === "3,9", "parses star numbers");

const json = JSON.stringify([
  { date: "2024-01-06", numbers: [1, 2, 3, 4, 5, 6, 7] },
  { drawDate: "06.01.2023", mains: [8, 9, 10, 11, 12, 13, 14] }
]);
const jsonDraws = parseDraws(json, lotto);
assert(jsonDraws.length === 2, "parseDraws handles JSON");
assert(jsonDraws[1].date.getFullYear() === 2023, "JSON drawDate parsed");

assert(dedupeDraws(draws.concat(draws)).length === 3, "dedupeDraws removes duplicates");

const recent = filterDrawsByYears(draws, 3, new Date(2026, 5, 12));
assert(recent.length === 2, "filterDrawsByYears keeps only the window");
assert(filterDrawsByYears(draws, 0).length === 3, "years=0 keeps everything");

/* ---- generation ---- */
function defaultCriteria(cfg) {
  return {
    maxRun: { enabled: true, value: 2 },
    oddEven: { enabled: true, minOdd: 2, maxOdd: cfg.mainPick - 2 },
    sumRange: { enabled: true, min: cfg.defaultSumMin, max: cfg.defaultSumMax },
    zoneSpread: { enabled: true, maxPerZone: 3 },
    birthdayBias: { enabled: false },
    excludeNumbers: { enabled: false, numbers: [] },
    requireNumbers: { enabled: false, numbers: [] },
    batchOverlap: { enabled: true, maxShared: 4 },
    historyExact: { enabled: true },
    historySubset: { enabled: true }
  };
}

for (const cfg of [lotto, euro]) {
  const history = buildHistoryIndex(draws, 4);
  const { tickets, warnings } = generateTickets(10, cfg, defaultCriteria(cfg), history);
  assert(tickets.length === 10, `${cfg.id}: generates 10 tickets (warnings: ${warnings.join("; ")})`);
  for (const t of tickets) {
    assert(t.mains.length === cfg.mainPick && new Set(t.mains).size === cfg.mainPick, `${cfg.id}: distinct mains`);
    assert(t.mains.every((n) => n >= 1 && n <= cfg.mainMax), `${cfg.id}: mains in range`);
    assert(t.stars.length === cfg.starPick, `${cfg.id}: star count`);
    assert(t.stars.every((n) => n >= 1 && n <= cfg.starMax), `${cfg.id}: stars in range`);
    if (!t.relaxed) {
      assert(longestConsecutiveRun(t.mains) <= 2, `${cfg.id}: max run respected`);
      const odd = countOdd(t.mains);
      assert(odd >= 2 && odd <= cfg.mainPick - 2, `${cfg.id}: odd/even respected`);
      assert(sumOf(t.mains) >= cfg.defaultSumMin && sumOf(t.mains) <= cfg.defaultSumMax, `${cfg.id}: sum respected`);
    }
  }
  // batch overlap
  for (let i = 0; i < tickets.length; i++) {
    for (let j = i + 1; j < tickets.length; j++) {
      assert(overlapCount(tickets[i].mains, tickets[j].mains) <= 4, `${cfg.id}: overlap <= 4`);
    }
  }
}

/* exact-row exclusion is hard: a tiny pool forces collision detection */
{
  const cfg = { ...lotto, mainPick: 3, mainMax: 5, defaultSumMin: 0, defaultSumMax: 999 };
  // Exclude every 3-of-5 combination except one: only {1,2,5}... build history of all others
  const all = combinationKeys([1, 2, 3, 4, 5], 3).map((k) => k.split("-").map(Number));
  const allowed = "1-3-5";
  const histDraws = all.filter((c) => c.join("-") !== allowed).map((mains) => ({ date: null, mains, stars: [] }));
  const idx = buildHistoryIndex(histDraws, 0);
  const crit = defaultCriteria(cfg);
  crit.maxRun.enabled = false;
  crit.oddEven.enabled = false;
  crit.sumRange.enabled = false;
  crit.zoneSpread.enabled = false;
  crit.batchOverlap.enabled = false;
  crit.historySubset.enabled = false;
  const { tickets } = generateTickets(3, cfg, crit, idx);
  assert(tickets.length === 3, "tiny pool: still generates");
  assert(tickets.every((t) => t.mains.join("-") === allowed), "exact-row exclusion leaves only the allowed combo");
}

/* required + excluded numbers */
{
  const crit = defaultCriteria(lotto);
  crit.requireNumbers = { enabled: true, numbers: [7] };
  crit.excludeNumbers = { enabled: true, numbers: [13, 22] };
  const { tickets } = generateTickets(10, lotto, crit, buildHistoryIndex([], 0));
  assert(tickets.length === 10, "require/exclude: generates 10");
  assert(tickets.every((t) => t.mains.includes(7)), "required number present in all rows");
  assert(tickets.every((t) => !t.mains.includes(13) && !t.mains.includes(22)), "excluded numbers absent");
}

/* infeasible criteria are reported, not looped forever */
{
  const crit = defaultCriteria(lotto);
  crit.excludeNumbers = { enabled: true, numbers: Array.from({ length: 30 }, (_, i) => i + 1) };
  const { tickets, warnings } = generateTickets(10, lotto, crit, buildHistoryIndex([], 0));
  assert(tickets.length === 0 && warnings.length > 0, "infeasible criteria rejected with warning");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
