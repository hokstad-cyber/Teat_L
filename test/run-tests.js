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
  dedupeDraws, generateTickets, longestParityRun, longestArithmeticProgression,
  maxSameLastDigit, maxSharedDivisor, zoneOfNumber, weightedSampleDistinct,
  drawsSinceLastSeen
} = vm.runInContext(
  `({ LOTTERIES, sampleDistinct, combinationKeys, longestConsecutiveRun, sumOf, countOdd,
      overlapCount, parseDrawsText, parseDraws, filterDrawsByYears, buildHistoryIndex,
      dedupeDraws, generateTickets, longestParityRun, longestArithmeticProgression,
      maxSameLastDigit, maxSharedDivisor, zoneOfNumber, weightedSampleDistinct,
      drawsSinceLastSeen })`,
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

/* weighted sampling */
{
  let contains34 = 0;
  for (let i = 0; i < 200; i++) {
    const s = weightedSampleDistinct(pool, 7, (n) => (n === 34 ? 1000 : 1));
    assert(s.length === 7 && new Set(s).size === 7, "weighted: 7 distinct");
    assert(s.every((n, j) => j === 0 || n > s[j - 1]), "weighted: sorted");
    if (s.includes(34)) contains34++;
  }
  assert(contains34 >= 190, `weighted: heavy number nearly always present (${contains34}/200)`);

  // uniform weights behave like plain sampling (no crash, full coverage possible)
  const u = weightedSampleDistinct(pool, 34, () => 1);
  assert(u.length === 34 && u[0] === 1 && u[33] === 34, "weighted: can exhaust pool");
}

/* drawsSinceLastSeen */
{
  const cfg = { mainMax: 10 };
  const mk = (iso, mains) => ({ date: new Date(iso), mains, stars: [] });
  const hist = [
    mk("2026-06-01", [1, 2, 3]),   // newest -> gap 0
    mk("2026-05-01", [4, 5, 6]),   // gap 1
    mk("2026-04-01", [1, 7, 8])    // gap 2 (1 already seen newer)
  ];
  const gaps = drawsSinceLastSeen(hist, cfg);
  assert(gaps[1] === 0 && gaps[4] === 1 && gaps[7] === 2, "drawsSinceLastSeen: gaps per number");
  assert(gaps[9] === 3 && gaps[10] === 3, "drawsSinceLastSeen: never-seen numbers most overdue");
}

assert(longestParityRun([3, 7, 11, 19, 22]) === 4, "parity run: four odds in a row");
assert(longestParityRun([1, 2, 3, 4]) === 1, "parity run: alternating");
assert(longestParityRun([2, 4, 6, 8, 10]) === 5, "parity run: all even");
assert(longestArithmeticProgression([5, 7, 10, 15, 20]) === 4, "AP: 5,10,15,20 as subsequence");
assert(longestArithmeticProgression([1, 2, 4, 8]) === 2, "AP: no 3-term progression");
assert(longestArithmeticProgression([3, 6, 9, 12, 15]) === 5, "AP: full progression");
assert(maxSameLastDigit([7, 17, 27, 3, 12]) === 3, "same last digit");
assert(maxSharedDivisor([3, 6, 9, 14, 25]) === 3, "shared divisor: three multiples of 3");

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

/* unofficial Norsk Tipping API shapes */
{
  // single-object response with anti-hijacking prefix and compact date
  const ntLotto = 'while(true);/* 0; {"drawID":1234,"drawDate":"20240316","mainNumbers":[1,5,12,19,23,28,31],"additionalNumbers":[2]}';
  const parsed = parseDraws(ntLotto, lotto);
  assert(parsed.length === 1, "NT API: parses single-object lotto response");
  assert(parsed[0].mains.join(",") === "1,5,12,19,23,28,31", "NT API: main numbers");
  assert(parsed[0].date && parsed[0].date.getFullYear() === 2024 && parsed[0].date.getMonth() === 2 && parsed[0].date.getDate() === 16, "NT API: compact yyyymmdd date");

  const ntEuro = '{"drawID":777,"drawDate":20240614,"mainNumbers":[7,19,28,33,45],"starNumbers":[3,9]}';
  const parsedEuro = parseDraws(ntEuro, euro);
  assert(parsedEuro.length === 1 && parsedEuro[0].stars.join(",") === "3,9", "NT API: eurojackpot stars");

  // Lottoland fallback shape
  const lottoland = '{"last":{"date":{"day":14,"month":6,"year":2024},"numbers":[7,19,28,33,45],"euroNumbers":[3,9]},"next":{}}';
  const parsedLl = parseDraws(lottoland, euro);
  assert(parsedLl.length === 1, "Lottoland: parses last draw");
  assert(parsedLl[0].date && parsedLl[0].date.getMonth() === 5, "Lottoland: date object parsed");
  assert(parsedLl[0].stars.join(",") === "3,9", "Lottoland: euroNumbers as stars");
}

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
    zoneSpread: { enabled: true, maxPerZone: 3, minPerZone: 0 },
    parityRun: { enabled: true, value: 3 },
    patternGuard: { enabled: true, maxOccur: 4 },
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
      assert(longestParityRun(t.mains) <= 3, `${cfg.id}: parity streak respected`);
      assert(longestArithmeticProgression(t.mains) <= 4, `${cfg.id}: pattern guard AP respected`);
      assert(maxSameLastDigit(t.mains) <= 4, `${cfg.id}: pattern guard last digit respected`);
      assert(maxSharedDivisor(t.mains) <= 4, `${cfg.id}: pattern guard divisor respected`);
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

/* zone minimum: every zone must be represented */
{
  const crit = defaultCriteria(lotto);
  crit.zoneSpread = { enabled: true, maxPerZone: 3, minPerZone: 1 };
  const { tickets } = generateTickets(10, lotto, crit, buildHistoryIndex([], 0));
  assert(tickets.length === 10, "zone min: generates 10");
  for (const t of tickets) {
    if (t.relaxed) continue;
    const counts = [0, 0, 0, 0];
    for (const n of t.mains) counts[zoneOfNumber(lotto, n)]++;
    assert(counts.every((c) => c >= 1), "zone min: every zone of ten represented");
  }
}

/* strict parity streak limit */
{
  const crit = defaultCriteria(lotto);
  crit.parityRun = { enabled: true, value: 2 };
  const { tickets } = generateTickets(10, lotto, crit, buildHistoryIndex([], 0));
  assert(
    tickets.filter((t) => !t.relaxed).every((t) => longestParityRun(t.mains) <= 2),
    "parity: streak limit of 2 enforced"
  );
}

/* infeasible zone minimum is reported */
{
  const crit = defaultCriteria(lotto);
  crit.zoneSpread = { enabled: true, maxPerZone: 3, minPerZone: 3 }; // 3 × 4 zones > 7
  const r = generateTickets(10, lotto, crit, buildHistoryIndex([], 0));
  assert(r.tickets.length === 0 && r.warnings.length > 0, "infeasible zone min rejected with warning");
}

/* zone min larger than the last (short) zone is reported */
{
  const crit = defaultCriteria(lotto);
  crit.zoneSpread = { enabled: true, maxPerZone: 7, minPerZone: 5 }; // zone 31–34 has only 4 numbers (also 5×4 > 7)
  const r = generateTickets(10, lotto, crit, buildHistoryIndex([], 0));
  assert(r.tickets.length === 0 && r.warnings.some((w) => /31–34/.test(w)), "short-zone minimum rejected with warning");
}

/* bias weights flow through generation and still respect criteria */
{
  const crit = defaultCriteria(lotto);
  crit.batchOverlap.enabled = false; // boosted numbers should be free to repeat across rows
  const weights = new Array(35).fill(1);
  for (let n = 30; n <= 34; n++) weights[n] = 50;
  const { tickets } = generateTickets(10, lotto, crit, buildHistoryIndex([], 0), weights);
  assert(tickets.length === 10, "bias: generates 10");
  assert(tickets.every((t) => t.mains.some((n) => n >= 30)), "bias: every row contains a boosted number");
  for (const t of tickets) {
    assert(t.mains.length === 7 && new Set(t.mains).size === 7, "bias: rows stay valid");
    if (!t.relaxed) assert(longestConsecutiveRun(t.mains) <= 2, "bias: criteria still enforced");
  }
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
