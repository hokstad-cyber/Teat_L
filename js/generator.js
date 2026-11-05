/* Row generation with configurable criteria. No DOM access. */
"use strict";

/**
 * criteria = {
 *   maxRun:        { enabled, value }   // longest allowed consecutive run
 *   oddEven:       { enabled, minOdd, maxOdd }
 *   sumRange:      { enabled, min, max }
 *   zoneSpread:    { enabled, maxPerZone, minPerZone }
 *   zonesUsed:     { enabled, min, max }  // how many different zones of ten a row may touch
 *   parityRun:     { enabled, value }   // longest allowed odd-or-even streak
 *   maxArithmetic: { enabled, value }   // longest allowed equal-gap progression
 *   sameLastDigit: { enabled, max }     // max numbers sharing a final digit
 *   sharedMultiple:{ enabled, max }     // max multiples of one of 3 / 5 / 7
 *   lowHigh:       { enabled, minLow, minHigh } // balance low vs high half
 *   birthdayBias:  { enabled }          // require at least one number > 31
 *   excludeNumbers:{ enabled, numbers: number[] }
 *   requireNumbers:{ enabled, numbers: number[] }
 *   batchOverlap:  { enabled, maxShared }  // vs already generated rows
 *   historyExact:  { enabled }
 *   historySubset: { enabled }          // uses historyIndex.subsetKeys
 *   reuseLast:     { enabled, min, max, numbers: number[] } // carry over
 *                  // between min and max numbers from the last draw
 * }
 */

const MAX_ATTEMPTS_PER_ROW = 8000;

function validateCriteriaFeasibility(cfg, criteria) {
  const problems = [];
  const excluded = criteria.excludeNumbers.enabled ? criteria.excludeNumbers.numbers : [];
  const required = criteria.requireNumbers.enabled ? criteria.requireNumbers.numbers : [];
  const poolSize = cfg.mainMax - new Set(excluded).size;
  if (poolSize < cfg.mainPick) {
    problems.push(`Too many excluded numbers: only ${poolSize} of ${cfg.mainMax} remain, but ${cfg.mainPick} are needed.`);
  }
  if (required.length > cfg.mainPick) {
    problems.push(`Too many required numbers: ${required.length} given, but a row only has ${cfg.mainPick}.`);
  }
  const clash = required.filter((n) => excluded.includes(n));
  if (clash.length) {
    problems.push(`Numbers both required and excluded: ${clash.join(", ")}.`);
  }
  if (criteria.oddEven.enabled && criteria.oddEven.minOdd > criteria.oddEven.maxOdd) {
    problems.push("Odd/even: minimum odd count is greater than maximum.");
  }
  if (criteria.sumRange.enabled && criteria.sumRange.min > criteria.sumRange.max) {
    problems.push("Sum range: minimum is greater than maximum.");
  }
  if (criteria.zoneSpread.enabled) {
    const zones = lotteryZoneCount(cfg);
    const min = criteria.zoneSpread.minPerZone || 0;
    if (zones * criteria.zoneSpread.maxPerZone < cfg.mainPick) {
      problems.push(`Zone spread: max ${criteria.zoneSpread.maxPerZone} per zone × ${zones} zones cannot hold ${cfg.mainPick} numbers.`);
    }
    if (min > criteria.zoneSpread.maxPerZone) {
      problems.push("Zone spread: minimum per zone is greater than maximum per zone.");
    }
    if (min * zones > cfg.mainPick) {
      problems.push(`Zone spread: min ${min} per zone × ${zones} zones needs ${min * zones} numbers, but a row only has ${cfg.mainPick}.`);
    }
    for (let z = 0; z < zones; z++) {
      const zoneSize = Math.min(cfg.zoneSize, cfg.mainMax - z * cfg.zoneSize);
      if (min > zoneSize) {
        problems.push(`Zone spread: zone ${z * cfg.zoneSize + 1}–${z * cfg.zoneSize + zoneSize} only has ${zoneSize} numbers, fewer than the minimum of ${min}.`);
      }
    }
  }
  if (criteria.maxArithmetic && criteria.maxArithmetic.enabled && criteria.maxArithmetic.value < 2) {
    problems.push("Max arithmetic progression: the length must be at least 2 (any two numbers form a 2-term progression).");
  }
  if (criteria.sameLastDigit && criteria.sameLastDigit.enabled && criteria.sameLastDigit.max < 1) {
    problems.push("Same last digit: the maximum must be at least 1.");
  }
  if (criteria.lowHigh && criteria.lowHigh.enabled) {
    const half = Math.ceil(cfg.mainMax / 2);
    const lowSize = half;
    const highSize = cfg.mainMax - half;
    const { minLow, minHigh } = criteria.lowHigh;
    if (minLow + minHigh > cfg.mainPick) {
      problems.push(`Low/high balance: needs ${minLow + minHigh} numbers, but a row only has ${cfg.mainPick}.`);
    }
    if (minLow > lowSize) problems.push(`Low/high balance: the low half (1–${lowSize}) cannot supply ${minLow} numbers.`);
    if (minHigh > highSize) problems.push(`Low/high balance: the high half (${half + 1}–${cfg.mainMax}) cannot supply ${minHigh} numbers.`);
  }
  if (criteria.zonesUsed && criteria.zonesUsed.enabled) {
    const zu = criteria.zonesUsed;
    const zoneCount = lotteryZoneCount(cfg);
    const sizes = [];
    for (let z = 0; z < zoneCount; z++) sizes.push(Math.min(cfg.zoneSize, cfg.mainMax - z * cfg.zoneSize));
    sizes.sort((a, b) => b - a);
    if (zu.min > zu.max) problems.push("Zones used: minimum is greater than maximum.");
    else {
      if (zu.min > zoneCount) problems.push(`Zones used: there are only ${zoneCount} zones, so a row cannot touch ${zu.min}.`);
      if (zu.min > cfg.mainPick) problems.push(`Zones used: a row of ${cfg.mainPick} numbers cannot touch ${zu.min} different zones.`);
      const capacity = sizes.slice(0, Math.min(zu.max, zoneCount)).reduce((a, b) => a + b, 0);
      if (capacity < cfg.mainPick) problems.push(`Zones used: the ${zu.max} largest zone(s) hold only ${capacity} numbers, but a row needs ${cfg.mainPick}.`);
      if (criteria.zoneSpread.enabled && zu.max * criteria.zoneSpread.maxPerZone < cfg.mainPick) {
        problems.push(`Zones used: at most ${zu.max} zone(s) with at most ${criteria.zoneSpread.maxPerZone} per zone cannot hold ${cfg.mainPick} numbers.`);
      }
      if (criteria.zoneSpread.enabled && (criteria.zoneSpread.minPerZone || 0) > 0 && zu.max < zoneCount) {
        problems.push(`Zones used: "Spread across zones" wants numbers in every zone, but you allow only ${zu.max} of ${zoneCount} zones.`);
      }
      const reqZones = new Set(required.map((n) => zoneOfNumber(cfg, n)));
      if (reqZones.size > zu.max) problems.push(`Zones used: your required numbers already touch ${reqZones.size} zones, more than the ${zu.max} allowed.`);
    }
  }
  if (criteria.birthdayBias.enabled && cfg.mainMax <= 31) {
    problems.push("Birthday-bias criterion needs numbers above 31, which this lottery does not have.");
  }
  if (criteria.reuseLast && criteria.reuseLast.enabled) {
    const r = criteria.reuseLast;
    const last = (r.numbers || []).filter((n) => n >= 1 && n <= cfg.mainMax);
    if (!last.length) {
      problems.push("Reuse from last draw is on, but no last draw is set — enter or load one first.");
    } else if (r.min > r.max) {
      problems.push("Reuse from last draw: minimum is greater than maximum.");
    } else if (r.min > cfg.mainPick) {
      problems.push(`Reuse from last draw: cannot reuse ${r.min} numbers — a row only holds ${cfg.mainPick}.`);
    } else {
      const reqInLast = required.filter((n) => last.includes(n)).length;
      const availFromLast = new Set(last.filter((n) => !excluded.includes(n))).size;
      if (r.max < reqInLast) {
        problems.push(`Reuse from last draw: ${reqInLast} required number(s) are already in the last draw, exceeding the maximum of ${r.max}.`);
      }
      if (r.min > availFromLast) {
        problems.push(`Reuse from last draw: only ${availFromLast} of the last draw's numbers are available (after exclusions), fewer than the minimum of ${r.min}.`);
      }
    }
  }
  return problems;
}

/**
 * Soft (style) rules a row breaks, as human-readable labels. These are the
 * rules the generator may relax when the hard exclusions leave no room.
 * With `firstOnly`, stops at the first failure (fast path for sampling).
 */
function softRuleFailures(mains, cfg, criteria, firstOnly) {
  const out = [];
  const fail = (label) => {
    out.push(label);
    return firstOnly;
  };

  if (criteria.maxRun.enabled && longestConsecutiveRun(mains) > criteria.maxRun.value) {
    if (fail(`max ${criteria.maxRun.value} in sequence`)) return out;
  }
  if (criteria.oddEven.enabled) {
    const odd = countOdd(mains);
    if (odd < criteria.oddEven.minOdd || odd > criteria.oddEven.maxOdd) {
      if (fail(`${criteria.oddEven.minOdd}–${criteria.oddEven.maxOdd} odd numbers`)) return out;
    }
  }
  if (criteria.sumRange.enabled) {
    const s = sumOf(mains);
    if (s < criteria.sumRange.min || s > criteria.sumRange.max) {
      if (fail(`sum ${criteria.sumRange.min}–${criteria.sumRange.max}`)) return out;
    }
  }
  if (criteria.zoneSpread.enabled) {
    const counts = new Array(lotteryZoneCount(cfg)).fill(0);
    for (const n of mains) counts[zoneOfNumber(cfg, n)]++;
    const min = criteria.zoneSpread.minPerZone || 0;
    if (counts.some((c) => c > criteria.zoneSpread.maxPerZone) || (min > 0 && counts.some((c) => c < min))) {
      if (fail("zone spread")) return out;
    }
  }
  if (criteria.zonesUsed && criteria.zonesUsed.enabled) {
    const used = new Set();
    for (const n of mains) used.add(zoneOfNumber(cfg, n));
    if (used.size < criteria.zonesUsed.min || used.size > criteria.zonesUsed.max) {
      const { min, max } = criteria.zonesUsed;
      if (fail(`${min === max ? min : min + "–" + max} zones used`)) return out;
    }
  }
  if (criteria.parityRun.enabled && longestParityRun(mains) > criteria.parityRun.value) {
    if (fail(`odd/even streak ≤ ${criteria.parityRun.value}`)) return out;
  }
  if (criteria.maxArithmetic && criteria.maxArithmetic.enabled &&
      longestArithmeticProgression(mains) > criteria.maxArithmetic.value) {
    if (fail(`arithmetic progression ≤ ${criteria.maxArithmetic.value}`)) return out;
  }
  if (criteria.sameLastDigit && criteria.sameLastDigit.enabled &&
      maxSameLastDigit(mains) > criteria.sameLastDigit.max) {
    if (fail(`same last digit ≤ ${criteria.sameLastDigit.max}`)) return out;
  }
  if (criteria.sharedMultiple && criteria.sharedMultiple.enabled &&
      maxSharedDivisor(mains) > criteria.sharedMultiple.max) {
    if (fail(`multiples of one number ≤ ${criteria.sharedMultiple.max}`)) return out;
  }
  if (criteria.lowHigh && criteria.lowHigh.enabled) {
    const half = Math.ceil(cfg.mainMax / 2);
    let low = 0;
    for (const n of mains) if (n <= half) low++;
    if (low < criteria.lowHigh.minLow || mains.length - low < criteria.lowHigh.minHigh) {
      if (fail("low/high balance")) return out;
    }
  }
  if (criteria.birthdayBias.enabled && !mains.some((n) => n > 31)) {
    if (fail("a number above 31")) return out;
  }
  return out;
}

/** Hard constraints: never relaxed. */
function rowPassesHardRules(mains, criteria, historyIndex, previousRows) {
  if (criteria.requireNumbers.enabled) {
    for (const n of criteria.requireNumbers.numbers) {
      if (!mains.includes(n)) return false;
    }
  }

  if (criteria.batchOverlap.enabled) {
    for (const prev of previousRows) {
      if (overlapCount(prev, mains) > criteria.batchOverlap.maxShared) return false;
    }
  }

  if (historyIndex) {
    if (criteria.historyExact.enabled && historyIndex.exactKeys.has(mains.join("-"))) return false;
    if (criteria.historySubset.enabled && historyIndex.subsetSize > 0 && historyIndex.subsetKeys.size > 0) {
      for (const key of combinationKeys(mains, historyIndex.subsetSize)) {
        if (historyIndex.subsetKeys.has(key)) return false;
      }
    }
  }

  // Reuse-from-last-draw is satisfied structurally by the sampler, but verify
  // defensively — it is a hard constraint and never relaxed.
  if (criteria.reuseLast && criteria.reuseLast.enabled && criteria.reuseLast.numbers.length) {
    const lastSet = new Set(criteria.reuseLast.numbers);
    const shared = mains.reduce((c, n) => c + (lastSet.has(n) ? 1 : 0), 0);
    if (shared < criteria.reuseLast.min || shared > criteria.reuseLast.max) return false;
  }

  return true;
}

/** Check a candidate row of main numbers against all enabled criteria. */
function rowPassesCriteria(mains, cfg, criteria, historyIndex, previousRows, relaxed) {
  if (!relaxed && softRuleFailures(mains, cfg, criteria, true).length) return false;
  return rowPassesHardRules(mains, criteria, historyIndex, previousRows);
}

/** How many last-draw numbers to carry into the next row, picked at random
    within the feasible band. Returns null if infeasible. */
function chooseReuseCount(reuseLast, required, lastPoolSize, otherPoolSize, need) {
  const reqInLast = required.reduce((c, n) => c + (reuseLast.numbers.includes(n) ? 1 : 0), 0);
  // a = extra numbers drawn from the last-draw pool; total reuse = reqInLast + a.
  let aMin = Math.max(0, reuseLast.min - reqInLast, need - otherPoolSize);
  let aMax = Math.min(lastPoolSize, reuseLast.max - reqInLast, need);
  if (aMin > aMax) return null;
  return aMin + randInt(aMax - aMin + 1);
}

/**
 * Build a sampler for candidate rows of main numbers that honours excluded
 * and required numbers, the reuse-from-last-draw split and optional weights.
 * Returns a function producing a sorted row, or null when reuse is
 * infeasible.
 */
function makeRowSampler(cfg, criteria, weights) {
  const excluded = new Set(criteria.excludeNumbers.enabled ? criteria.excludeNumbers.numbers : []);
  const required = criteria.requireNumbers.enabled ? criteria.requireNumbers.numbers.slice() : [];
  const pool = [];
  for (let n = 1; n <= cfg.mainMax; n++) {
    if (!excluded.has(n) && !required.includes(n)) pool.push(n);
  }
  // Reuse-from-last-draw splits the pool so each row can carry over a chosen
  // number of last-draw numbers by construction.
  const reuse = criteria.reuseLast && criteria.reuseLast.enabled && criteria.reuseLast.numbers.length
    ? criteria.reuseLast
    : null;
  const lastSet = reuse ? new Set(reuse.numbers) : null;
  const lastPool = reuse ? pool.filter((n) => lastSet.has(n)) : null;
  const otherPool = reuse ? pool.filter((n) => !lastSet.has(n)) : null;
  const weightOf = weights ? (n) => weights[n] || 1 : null;
  const pick = (arr, k) => (weightOf ? weightedSampleDistinct(arr, k, weightOf) : sampleDistinct(arr, k));
  const pickCount = cfg.mainPick - required.length;

  return function sampleRow() {
    let sampled;
    if (reuse) {
      const a = chooseReuseCount(reuse, required, lastPool.length, otherPool.length, pickCount);
      if (a === null) return null;
      sampled = pick(lastPool, a).concat(pick(otherPool, pickCount - a));
    } else {
      sampled = pick(pool, pickCount);
    }
    return sampled.concat(required).sort((a, b) => a - b);
  };
}

/**
 * Generate `count` rows. Returns { tickets, warnings }.
 * Each ticket: { mains, stars, relaxed, relaxedRules }.
 * If the soft (style) criteria can't be met after many attempts, they are
 * relaxed for that row — hard exclusions (history, required numbers,
 * batch overlap, excluded numbers) are never relaxed. `relaxedRules` names
 * the style rules the accepted row actually breaks.
 *
 * `weights` (optional): array indexed 1..mainMax of relative sampling
 * weights for the main numbers, used to bias the suggestions towards e.g.
 * overdue or rarely-drawn numbers. Null/undefined means uniform sampling.
 *
 * `seedRows` (optional): rows already on the coupon (e.g. locked rows) that
 * new rows must keep their distance from (batch overlap) and not duplicate.
 */
function generateTickets(count, cfg, criteria, historyIndex, weights, seedRows) {
  const warnings = [];
  const problems = validateCriteriaFeasibility(cfg, criteria);
  if (problems.length) return { tickets: [], warnings: problems };

  const sampleRow = makeRowSampler(cfg, criteria, weights);
  const starPool = [];
  for (let n = 1; n <= cfg.starMax; n++) starPool.push(n);

  const tickets = [];
  let diagnosis = null;
  const previousRows = (seedRows || []).map((r) => r.slice());
  const taken = new Set(previousRows.map((r) => r.join("-")));

  for (let t = 0; t < count; t++) {
    let ticket = null;
    const softBudget = Math.floor(MAX_ATTEMPTS_PER_ROW * 0.6);

    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_ROW; attempt++) {
      const useRelaxed = attempt >= softBudget;
      const mains = sampleRow();
      if (mains === null) break; // infeasible (also reported by validation)
      if (taken.has(mains.join("-"))) continue;
      if (rowPassesCriteria(mains, cfg, criteria, historyIndex, previousRows, useRelaxed)) {
        const stars = cfg.starPick > 0 ? sampleDistinct(starPool, cfg.starPick) : [];
        const relaxedRules = useRelaxed ? softRuleFailures(mains, cfg, criteria, false) : [];
        ticket = { mains, stars, relaxed: relaxedRules.length > 0, relaxedRules };
        break;
      }
    }

    if (!ticket) {
      warnings.push(
        `Row ${t + 1}: could not satisfy the hard exclusions after ${MAX_ATTEMPTS_PER_ROW} attempts. ` +
          "Try a smaller combination size, a shorter history window, or fewer constraints."
      );
      diagnosis = diagnoseRejections(cfg, criteria, historyIndex, previousRows, weights, 3000);
      diagnosis.failedRow = t + 1;
      break;
    }
    if (ticket.relaxed) {
      warnings.push(`Row ${t + 1}: relaxed ${ticket.relaxedRules.join(", ")} to satisfy the exclusion rules.`);
    }
    tickets.push(ticket);
    previousRows.push(ticket.mains);
    taken.add(ticket.mains.join("-"));
  }

  return { tickets, warnings, diagnosis };
}

/**
 * Estimate the share of candidate rows (drawn by the real sampler) that pass
 * every style rule and the history/required rules — a live "how strict are
 * my settings" gauge. Batch overlap is ignored (it depends on the coupon).
 * Returns { rate, feasible, problems }.
 */
function estimatePassRate(cfg, criteria, historyIndex, weights, samples) {
  const problems = validateCriteriaFeasibility(cfg, criteria);
  if (problems.length) return { rate: 0, feasible: false, problems };
  const sampleRow = makeRowSampler(cfg, criteria, weights);
  const n = samples || 2000;
  let pass = 0;
  for (let i = 0; i < n; i++) {
    const mains = sampleRow();
    if (mains === null) return { rate: 0, feasible: false, problems: ["Reuse settings cannot be satisfied."] };
    if (rowPassesCriteria(mains, cfg, criteria, historyIndex, [], false)) pass++;
  }
  return { rate: pass / n, feasible: true, problems: [] };
}

/* ======================= Possibility space ======================= */

const SPACE_EXACT_LIMIT = 300000; // enumerate exactly up to this many main-number combinations

/** Call fn(combo) for every k-combination of `pool` (ascending). */
function forEachCombination(pool, k, fn) {
  const n = pool.length;
  if (k < 0 || k > n) return;
  const idx = [];
  for (let i = 0; i < k; i++) idx.push(i);
  const combo = new Array(k);
  for (;;) {
    for (let i = 0; i < k; i++) combo[i] = pool[idx[i]];
    fn(combo);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

function anySoftRuleEnabled(criteria) {
  return ["maxRun", "oddEven", "sumRange", "zoneSpread", "zonesUsed", "parityRun", "maxArithmetic", "sameLastDigit", "sharedMultiple", "lowHigh", "birthdayBias"]
    .some((k) => criteria[k] && criteria[k].enabled);
}

/**
 * How many of all possible rows satisfy the enabled rules?
 *
 *  total      every possible row with no rules (jackpotCombinations)
 *  count      rows that fit the rules
 *  share      count / total
 *  exact      true when counted exactly (no rules, or a small space), else a
 *             Monte-Carlo estimate with a 95 % Wilson interval [lo, hi]
 *
 * Excluded and required numbers shrink the space exactly; style rules,
 * reuse-from-last-draw and history exclusions are tested on rows sampled
 * uniformly from that space. Batch overlap and weighting are not
 * restrictions on the space and are ignored. Star numbers are free, so
 * they multiply the count.
 */
function estimateSpace(cfg, criteria, historyIndex, samples) {
  const problems = validateCriteriaFeasibility(cfg, criteria);
  const total = jackpotCombinations(cfg);
  if (problems.length) return { feasible: false, problems, total, count: 0, share: 0, lo: 0, hi: 0, exact: true };

  const excluded = new Set(criteria.excludeNumbers.enabled ? criteria.excludeNumbers.numbers : []);
  const required = criteria.requireNumbers.enabled ? criteria.requireNumbers.numbers.slice() : [];
  const pool = [];
  for (let n = 1; n <= cfg.mainMax; n++) if (!excluded.has(n) && !required.includes(n)) pool.push(n);
  const k = cfg.mainPick - required.length;
  const constrained = binomial(pool.length, k);
  const starCombos = cfg.starPick ? binomial(cfg.starMax, cfg.starPick) : 1;

  const reuseOn = !!(criteria.reuseLast && criteria.reuseLast.enabled && criteria.reuseLast.numbers.length);
  const historyOn = !!historyIndex && ((criteria.historyExact.enabled && historyIndex.drawCount > 0) ||
    (criteria.historySubset.enabled && historyIndex.subsetSize > 0 && historyIndex.subsetKeys.size > 0));
  const filtering = anySoftRuleEnabled(criteria) || reuseOn || historyOn;

  const result = (count, exact, lo, hi) => ({
    feasible: true, problems: [], total, constrainedMain: constrained, starCombos,
    count, share: total ? count / total : 0, lo: lo === undefined ? count : lo, hi: hi === undefined ? count : hi, exact
  });

  if (!filtering) return result(constrained * starCombos, true);

  const test = (mains) => rowPassesCriteria(mains, cfg, criteria, historyIndex, [], false);
  const full = (combo) => required.length ? combo.concat(required).sort((a, b) => a - b) : combo.slice();

  if (constrained <= SPACE_EXACT_LIMIT) {
    let pass = 0;
    forEachCombination(pool, k, (combo) => { if (test(full(combo))) pass++; });
    return result(pass * starCombos, true);
  }

  const n = samples || 30000;
  let pass = 0;
  for (let i = 0; i < n; i++) if (test(full(sampleDistinct(pool, k)))) pass++;
  const p = pass / n;
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  const scale = constrained * starCombos;
  return result(p * scale, false, Math.max(0, center - half) * scale, Math.min(1, center + half) * scale);
}

/* ======================= Rule catalogue & funnel ======================= */

const SOFT_RULE_KEYS = ["maxRun", "oddEven", "sumRange", "zoneSpread", "zonesUsed", "parityRun", "maxArithmetic", "sameLastDigit", "sharedMultiple", "lowHigh", "birthdayBias"];

/**
 * Every rule the app knows, in a fixed order, with a human label that
 * includes its current parameters, a group and whether it is active now.
 */
function ruleCatalog(cfg, c, historyIndex) {
  const half = Math.ceil(cfg.mainMax / 2);
  const hist = historyIndex && historyIndex.drawCount > 0;
  const lastOk = !!(c.reuseLast && c.reuseLast.numbers && c.reuseLast.numbers.length);
  const R = (id, group, name, label, enabled, extra) => Object.assign({ id, group, name, label, enabled: !!enabled }, extra || {});
  return [
    R("maxRun", "Number balance", "Numbers in sequence", `At most ${c.maxRun.value} consecutive`, c.maxRun.enabled),
    R("oddEven", "Number balance", "Odd / even balance", `${c.oddEven.minOdd}–${c.oddEven.maxOdd} odd numbers`, c.oddEven.enabled),
    R("sumRange", "Number balance", "Sum of numbers", `Sum ${c.sumRange.min}–${c.sumRange.max}`, c.sumRange.enabled),
    R("zoneSpread", "Number balance", "Spread across zones", `${c.zoneSpread.minPerZone ? c.zoneSpread.minPerZone + "–" : "≤ "}${c.zoneSpread.maxPerZone} per zone of ten`, c.zoneSpread.enabled),
    R("zonesUsed", "Number balance", "Zones used per row", `Numbers from ${(c.zonesUsed || {}).min === (c.zonesUsed || {}).max ? (c.zonesUsed || {}).min : ((c.zonesUsed || {}).min + "–" + (c.zonesUsed || {}).max)} different zones of ten`, c.zonesUsed && c.zonesUsed.enabled),
    R("parityRun", "Number balance", "Odd/even streaks", `Streak of same parity ≤ ${c.parityRun.value}`, c.parityRun.enabled),
    R("maxArithmetic", "Popular patterns", "Arithmetic progression", `Equal-gap run ≤ ${c.maxArithmetic.value}`, c.maxArithmetic.enabled),
    R("sameLastDigit", "Popular patterns", "Same last digit", `≤ ${c.sameLastDigit.max} ending in one digit`, c.sameLastDigit.enabled),
    R("sharedMultiple", "Popular patterns", "Multiples of one number", `≤ ${c.sharedMultiple.max} multiples of 3, 5 or 7`, c.sharedMultiple.enabled),
    R("lowHigh", "Popular patterns", "Low / high balance", `≥ ${c.lowHigh.minLow} in 1–${half}, ≥ ${c.lowHigh.minHigh} in ${half + 1}–${cfg.mainMax}`, c.lowHigh.enabled),
    R("birthdayBias", "Popular patterns", "Avoid birthday bias", "At least one number above 31", c.birthdayBias.enabled),
    R("reuseLast", "Last draw", "Reuse from last draw", `${c.reuseLast.min === c.reuseLast.max ? "Exactly " + c.reuseLast.min : c.reuseLast.min + "–" + c.reuseLast.max} number(s) from the last draw`, c.reuseLast.enabled && lastOk),
    R("historyExact", "History", "Not a past winning row", "Never an exact past draw", c.historyExact.enabled && hist),
    R("historySubset", "History", "No past combination", (historyIndex && historyIndex.subsetSize > 0 ? `No group of ${historyIndex.subsetSize} that was drawn together` : "No group that was drawn together in the past"), c.historySubset.enabled && hist && historyIndex && historyIndex.subsetSize > 0)
  ];
}

function criteriaOnly(c, key) {
  const o = JSON.parse(JSON.stringify(c));
  for (const k of SOFT_RULE_KEYS) if (o[k]) o[k].enabled = false;
  o.batchOverlap.enabled = false;
  o.historyExact.enabled = false;
  o.historySubset.enabled = false;
  if (o.reuseLast) o.reuseLast.enabled = false;
  if (key) o[key].enabled = true;
  return o;
}

/**
 * How each active rule narrows the space. One pass over the same uniform
 * rows estimateSpace uses (exact enumeration when the space is small).
 * For rule i: `solo` = share of rows passing that rule on its own,
 * `cumulative` = share passing rules 1..i together (in catalogue order).
 * `constrainedShare` is the exact effect of excluded/required numbers.
 */
function ruleBreakdown(cfg, criteria, historyIndex, samples) {
  const problems = validateCriteriaFeasibility(cfg, criteria);
  const total = jackpotCombinations(cfg);
  const catalog = ruleCatalog(cfg, criteria, historyIndex);
  if (problems.length) return { feasible: false, problems, total, catalog, steps: [] };

  const excluded = new Set(criteria.excludeNumbers.enabled ? criteria.excludeNumbers.numbers : []);
  const required = criteria.requireNumbers.enabled ? criteria.requireNumbers.numbers.slice() : [];
  const pool = [];
  for (let n = 1; n <= cfg.mainMax; n++) if (!excluded.has(n) && !required.includes(n)) pool.push(n);
  const k = cfg.mainPick - required.length;
  const constrained = binomial(pool.length, k);
  const starCombos = cfg.starPick ? binomial(cfg.starMax, cfg.starPick) : 1;
  const constrainedCount = constrained * starCombos;

  const active = catalog.filter((r) => r.enabled).map((r) => {
    const only = criteriaOnly(criteria, r.id);
    const soft = SOFT_RULE_KEYS.includes(r.id);
    return Object.assign({}, r, {
      test: soft ? (m) => softRuleFailures(m, cfg, only, true).length === 0 : (m) => rowPassesHardRules(m, only, historyIndex, [])
    });
  });

  const solo = new Array(active.length).fill(0);
  const cum = new Array(active.length).fill(0);
  let n = 0;
  const visit = (mains) => {
    n++;
    let running = true;
    for (let i = 0; i < active.length; i++) {
      const ok = active[i].test(mains);
      if (ok) solo[i]++;
      running = running && ok;
      if (running) cum[i]++;
    }
  };
  const full = (combo) => (required.length ? combo.concat(required).sort((a, b) => a - b) : combo.slice());
  let exact = false;
  if (active.length) {
    if (constrained <= SPACE_EXACT_LIMIT) {
      exact = true;
      forEachCombination(pool, k, (combo) => visit(full(combo)));
    } else {
      const target = samples || 40000;
      for (let i = 0; i < target; i++) visit(full(sampleDistinct(pool, k)));
    }
  }
  const steps = active.map((r, i) => ({
    id: r.id, group: r.group, name: r.name, label: r.label,
    solo: n ? solo[i] / n : 1,
    cumulative: n ? cum[i] / n : 1
  }));
  const finalRate = steps.length ? steps[steps.length - 1].cumulative : 1;
  const count = constrainedCount * finalRate;
  return {
    feasible: true, problems: [], total, catalog, steps, exact: exact || !active.length, samples: n,
    constrainedMain: constrained, starCombos,
    constrainedShare: total ? constrainedCount / total : 1,
    finalRate, count, share: total ? count / total : 1
  };
}

/* ======================= Backtest against past draws ======================= */

/**
 * How would each rule have treated the past draws in `draws`?
 * For every rule (whether switched on or not, so the user can preview it):
 *   tested  draws the rule could be evaluated on
 *   failed  draws the rule would have filtered out
 * Reuse-from-last-draw is judged against each draw's predecessor. The
 * history-exclusion rules are not listed: they remove past results by design.
 * `allPass` counts draws that satisfy every rule that is currently switched on.
 * Returns { total, rules: { id: { tested, failed, enabled } }, allPass, evaluated }.
 */
function historicalImpact(cfg, criteria, draws) {
  const sorted = draws.slice().sort((a, b) => (a.date ? a.date.getTime() : -Infinity) - (b.date ? b.date.getTime() : -Infinity));
  const only = {};
  const softKeys = SOFT_RULE_KEYS.filter((k) => criteria[k]);
  for (const k of softKeys) only[k] = criteriaOnly(criteria, k);
  const exc = criteria.excludeNumbers.numbers || [];
  const req = criteria.requireNumbers.numbers || [];
  const reuse = criteria.reuseLast;
  const rules = {};
  const add = (id, enabled) => (rules[id] = { tested: 0, failed: 0, enabled: !!enabled });
  for (const k of softKeys) add(k, criteria[k].enabled);
  add("reuseLast", reuse && reuse.enabled);
  if (exc.length) add("excludeNumbers", criteria.excludeNumbers.enabled);
  if (req.length) add("requireNumbers", criteria.requireNumbers.enabled);

  let allPass = 0;
  let evaluated = 0;
  sorted.forEach((d, i) => {
    const mains = d.mains;
    evaluated++;
    let passAll = true;
    for (const k of softKeys) {
      const fail = softRuleFailures(mains, cfg, only[k], true).length > 0;
      rules[k].tested++;
      if (fail) rules[k].failed++;
      if (fail && rules[k].enabled) passAll = false;
    }
    if (i > 0) {
      const shared = overlapCount(sorted[i - 1].mains, mains);
      const fail = shared < reuse.min || shared > reuse.max;
      rules.reuseLast.tested++;
      if (fail) rules.reuseLast.failed++;
      if (fail && rules.reuseLast.enabled) passAll = false;
    }
    if (rules.excludeNumbers) {
      const fail = mains.some((n) => exc.includes(n));
      rules.excludeNumbers.tested++;
      if (fail) rules.excludeNumbers.failed++;
      if (fail && rules.excludeNumbers.enabled) passAll = false;
    }
    if (rules.requireNumbers) {
      const fail = !req.every((n) => mains.includes(n));
      rules.requireNumbers.tested++;
      if (fail) rules.requireNumbers.failed++;
      if (fail && rules.requireNumbers.enabled) passAll = false;
    }
    if (passAll) allPass++;
  });
  return { total: sorted.length, rules, allPass, evaluated };
}

/* ======================= Why do rows fail? ======================= */

function overlapRuleInfo(c) {
  return { id: "batchOverlap", group: "Your numbers", name: "Overlap between your rows", label: `≤ ${c.batchOverlap.maxShared} shared numbers` };
}

/**
 * Sample candidate rows exactly as the generator does and record which
 * enabled rules reject them. Used to explain a failed or struggling
 * generation. Per rule: `share` rejected, `sole` rejected only by that rule.
 * Reuse and required/excluded numbers are met by construction.
 */
function diagnoseRejections(cfg, criteria, historyIndex, previousRows, weights, samples) {
  const sampleRow = makeRowSampler(cfg, criteria, weights);
  const catalog = ruleCatalog(cfg, criteria, historyIndex).filter((r) => r.enabled && r.id !== "reuseLast");
  const tests = catalog.map((r) => {
    const only = criteriaOnly(criteria, r.id);
    const soft = SOFT_RULE_KEYS.includes(r.id);
    return Object.assign({}, r, {
      kind: soft ? "style" : "hard",
      test: soft ? (m) => softRuleFailures(m, cfg, only, true).length === 0 : (m) => rowPassesHardRules(m, only, historyIndex, [])
    });
  });
  if (criteria.batchOverlap.enabled && previousRows && previousRows.length) {
    const info = overlapRuleInfo(criteria);
    tests.push(Object.assign({}, info, { enabled: true, kind: "hard", test: (m) => previousRows.every((p) => overlapCount(p, m) <= criteria.batchOverlap.maxShared) }));
  }
  const n = samples || 3000;
  const rej = new Array(tests.length).fill(0);
  const sole = new Array(tests.length).fill(0);
  let passAll = 0;
  let passHard = 0;
  let used = 0;
  for (let s = 0; s < n; s++) {
    const m = sampleRow();
    if (m === null) break;
    used++;
    let failedCount = 0;
    let lastFailed = -1;
    let hardFailed = false;
    for (let i = 0; i < tests.length; i++) {
      if (!tests[i].test(m)) {
        rej[i]++;
        failedCount++;
        lastFailed = i;
        if (tests[i].kind === "hard") hardFailed = true;
      }
    }
    if (failedCount === 1) sole[lastFailed]++;
    if (!failedCount) passAll++;
    if (!hardFailed) passHard++;
  }
  const rules = tests.map((t, i) => ({
    id: t.id, group: t.group, name: t.name, label: t.label, kind: t.kind,
    share: used ? rej[i] / used : 0, sole: used ? sole[i] / used : 0
  })).sort((a, b) => b.share - a.share);
  return { tested: used, passAll: used ? passAll / used : 0, passHard: used ? passHard / used : 0, rules };
}

/**
 * How strict is each rule against all possible rows? Share of uniformly
 * sampled rows each rule rejects on its own — for every rule, switched on
 * or not, so it can be previewed. Rules with nothing to test (history
 * rules without history) are omitted.
 */
function ruleStrictness(cfg, criteria, historyIndex, samples) {
  if (validateCriteriaFeasibility(cfg, criteria).length) return {};
  const sampleRow = makeRowSampler(cfg, criteria, null);
  const hist = historyIndex && historyIndex.drawCount > 0;
  const keys = SOFT_RULE_KEYS.filter((k) => criteria[k]);
  if (hist) keys.push("historyExact");
  if (hist && historyIndex.subsetSize > 0) keys.push("historySubset");
  const tests = keys.map((k) => {
    const only = criteriaOnly(criteria, k);
    const soft = SOFT_RULE_KEYS.includes(k);
    return { k, test: soft ? (m) => softRuleFailures(m, cfg, only, true).length === 0 : (m) => rowPassesHardRules(m, only, historyIndex, []) };
  });
  const n = samples || 4000;
  const rej = {};
  for (const t of tests) rej[t.k] = 0;
  let used = 0;
  for (let s = 0; s < n; s++) {
    const m = sampleRow();
    if (m === null) break;
    used++;
    for (const t of tests) if (!t.test(m)) rej[t.k]++;
  }
  const out = {};
  for (const t of tests) out[t.k] = used ? rej[t.k] / used : 0;
  return out;
}

/**
 * Chance that a fresh random row shares at most `maxShared` numbers with one
 * given earlier row (hypergeometric), and the approximate chance that row
 * number `rows` passes against all `rows - 1` earlier ones.
 */
function overlapAcceptance(cfg, maxShared, rows) {
  const k = cfg.mainPick;
  const total = binomial(cfg.mainMax, k);
  let ok = 0;
  for (let j = 0; j <= Math.min(maxShared, k); j++) ok += binomial(k, j) * binomial(cfg.mainMax - k, k - j);
  const one = total ? ok / total : 1;
  return { one, last: Math.pow(one, Math.max(0, rows - 1)) };
}

/* ======================= Lower / higher half weighting ======================= */

const HALF_MAX_BOOST = 8; // slider at ±100 % → favoured half is up to 9x as likely per number

/**
 * Weights favouring the lower or higher half of the number range.
 * `value` is -100 … +100: negative favours the lower half, positive the
 * higher half, 0 is neutral. Returns an array indexed 1..mainMax, or null
 * when neutral.
 */
function halfWeights(cfg, value) {
  if (!value) return null;
  const half = Math.ceil(cfg.mainMax / 2);
  const boost = 1 + (Math.abs(value) / 100) * HALF_MAX_BOOST;
  const w = new Array(cfg.mainMax + 1).fill(1);
  for (let n = 1; n <= cfg.mainMax; n++) {
    const low = n <= half;
    if ((value < 0 && low) || (value > 0 && !low)) w[n] = boost;
  }
  return w;
}

/** Average number of lower-half numbers per row under `weights` (simulated). */
function expectedLowCount(cfg, weights, samples) {
  const half = Math.ceil(cfg.mainMax / 2);
  const pool = [];
  for (let n = 1; n <= cfg.mainMax; n++) pool.push(n);
  const n = samples || 2000;
  let low = 0;
  for (let i = 0; i < n; i++) {
    const row = weights ? weightedSampleDistinct(pool, cfg.mainPick, (x) => weights[x] || 1) : sampleDistinct(pool, cfg.mainPick);
    for (const x of row) if (x <= half) low++;
  }
  return low / n;
}
