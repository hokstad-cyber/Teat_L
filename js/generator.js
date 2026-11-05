/* Row generation with configurable criteria. No DOM access. */
"use strict";

/**
 * criteria = {
 *   maxRun:        { enabled, value }   // longest allowed consecutive run
 *   oddEven:       { enabled, minOdd, maxOdd }
 *   sumRange:      { enabled, min, max }
 *   zoneSpread:    { enabled, maxPerZone, minPerZone }
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
      break;
    }
    if (ticket.relaxed) {
      warnings.push(`Row ${t + 1}: relaxed ${ticket.relaxedRules.join(", ")} to satisfy the exclusion rules.`);
    }
    tickets.push(ticket);
    previousRows.push(ticket.mains);
    taken.add(ticket.mains.join("-"));
  }

  return { tickets, warnings };
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
