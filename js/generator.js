/* Row generation with configurable criteria. No DOM access. */
"use strict";

/**
 * criteria = {
 *   maxRun:        { enabled, value }   // longest allowed consecutive run
 *   oddEven:       { enabled, minOdd, maxOdd }
 *   sumRange:      { enabled, min, max }
 *   zoneSpread:    { enabled, maxPerZone, minPerZone }
 *   parityRun:     { enabled, value }   // longest allowed odd-or-even streak
 *   patternGuard:  { enabled, maxOccur } // equal-gap progressions, same last
 *                                        // digit, multiples of same divisor
 *   birthdayBias:  { enabled }          // require at least one number > 31
 *   excludeNumbers:{ enabled, numbers: number[] }
 *   requireNumbers:{ enabled, numbers: number[] }
 *   batchOverlap:  { enabled, maxShared }  // vs already generated rows
 *   historyExact:  { enabled }
 *   historySubset: { enabled }          // uses historyIndex.subsetKeys
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
  if (criteria.patternGuard.enabled && criteria.patternGuard.maxOccur < 2) {
    problems.push("Pattern guard: the threshold must be at least 2 (any two numbers form an equal-gap pair).");
  }
  if (criteria.birthdayBias.enabled && cfg.mainMax <= 31) {
    problems.push("Birthday-bias criterion needs numbers above 31, which this lottery does not have.");
  }
  return problems;
}

/** Check a candidate row of main numbers against all enabled criteria. */
function rowPassesCriteria(mains, cfg, criteria, historyIndex, previousRows, relaxed) {
  if (criteria.maxRun.enabled && !relaxed && longestConsecutiveRun(mains) > criteria.maxRun.value) return false;

  if (criteria.oddEven.enabled && !relaxed) {
    const odd = countOdd(mains);
    if (odd < criteria.oddEven.minOdd || odd > criteria.oddEven.maxOdd) return false;
  }

  if (criteria.sumRange.enabled && !relaxed) {
    const s = sumOf(mains);
    if (s < criteria.sumRange.min || s > criteria.sumRange.max) return false;
  }

  if (criteria.zoneSpread.enabled && !relaxed) {
    const counts = new Array(lotteryZoneCount(cfg)).fill(0);
    for (const n of mains) {
      const z = zoneOfNumber(cfg, n);
      counts[z]++;
      if (counts[z] > criteria.zoneSpread.maxPerZone) return false;
    }
    const min = criteria.zoneSpread.minPerZone || 0;
    if (min > 0 && counts.some((c) => c < min)) return false;
  }

  if (criteria.parityRun.enabled && !relaxed && longestParityRun(mains) > criteria.parityRun.value) return false;

  if (criteria.patternGuard.enabled && !relaxed) {
    const limit = criteria.patternGuard.maxOccur;
    if (longestArithmeticProgression(mains) > limit) return false;
    if (maxSameLastDigit(mains) > limit) return false;
    if (maxSharedDivisor(mains) > limit) return false;
  }

  if (criteria.birthdayBias.enabled && !relaxed) {
    if (!mains.some((n) => n > 31)) return false;
  }

  // Hard constraints below are never relaxed.
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

  return true;
}

/**
 * Generate `count` rows. Returns { tickets, warnings }.
 * Each ticket: { mains, stars, relaxed }.
 * If the soft (style) criteria can't be met after many attempts, they are
 * relaxed for that row — hard exclusions (history, required numbers,
 * batch overlap, excluded numbers) are never relaxed.
 *
 * `weights` (optional): array indexed 1..mainMax of relative sampling
 * weights for the main numbers, used to bias the suggestions towards e.g.
 * overdue or rarely-drawn numbers. Null/undefined means uniform sampling.
 */
function generateTickets(count, cfg, criteria, historyIndex, weights) {
  const warnings = [];
  const problems = validateCriteriaFeasibility(cfg, criteria);
  if (problems.length) return { tickets: [], warnings: problems };

  const excluded = new Set(criteria.excludeNumbers.enabled ? criteria.excludeNumbers.numbers : []);
  const required = criteria.requireNumbers.enabled ? criteria.requireNumbers.numbers.slice() : [];
  const pool = [];
  for (let n = 1; n <= cfg.mainMax; n++) {
    if (!excluded.has(n) && !required.includes(n)) pool.push(n);
  }
  const starPool = [];
  for (let n = 1; n <= cfg.starMax; n++) starPool.push(n);

  const tickets = [];
  const previousRows = [];

  for (let t = 0; t < count; t++) {
    let ticket = null;
    let relaxed = false;
    const softBudget = Math.floor(MAX_ATTEMPTS_PER_ROW * 0.6);

    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_ROW; attempt++) {
      const useRelaxed = attempt >= softBudget;
      const pickCount = cfg.mainPick - required.length;
      const sampled = weights
        ? weightedSampleDistinct(pool, pickCount, (n) => weights[n] || 1)
        : sampleDistinct(pool, pickCount);
      const mains = sampled.concat(required).sort((a, b) => a - b);
      if (rowPassesCriteria(mains, cfg, criteria, historyIndex, previousRows, useRelaxed)) {
        const stars = cfg.starPick > 0 ? sampleDistinct(starPool, cfg.starPick) : [];
        ticket = { mains, stars, relaxed: useRelaxed };
        relaxed = useRelaxed;
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
    if (relaxed) {
      warnings.push(`Row ${t + 1}: style criteria (sum/odd-even/sequences/zones/patterns) were relaxed to satisfy the exclusion rules.`);
    }
    tickets.push(ticket);
    previousRows.push(ticket.mains);
  }

  return { tickets, warnings };
}
