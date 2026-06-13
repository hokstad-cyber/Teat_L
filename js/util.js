/* Generic helpers: cryptographic RNG, sampling, combinations. No DOM access. */
"use strict";

/** Unbiased random integer in [0, maxExclusive) using crypto when available. */
function randInt(maxExclusive) {
  if (maxExclusive <= 0) throw new Error("randInt: maxExclusive must be > 0");
  const cryptoObj = typeof crypto !== "undefined" ? crypto : null;
  if (cryptoObj && cryptoObj.getRandomValues) {
    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    const buf = new Uint32Array(1);
    let v;
    do {
      cryptoObj.getRandomValues(buf);
      v = buf[0];
    } while (v >= limit);
    return v % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

/** Cryptographic uniform float in [0, 1). */
function randFloat() {
  return randInt(0x100000000) / 0x100000000;
}

/**
 * Sample `count` distinct integers from `pool` with per-number weights
 * (weighted sampling without replacement), sorted ascending. `weightOf(n)`
 * returns the relative chance of n on each pick; non-positive weights are
 * clamped to a tiny epsilon so every pool number stays possible.
 */
function weightedSampleDistinct(pool, count, weightOf) {
  if (count > pool.length) throw new Error("weightedSampleDistinct: pool too small");
  const items = pool.slice();
  const out = [];
  for (let k = 0; k < count; k++) {
    let total = 0;
    const cum = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      total += Math.max(weightOf(items[i]), 1e-9);
      cum[i] = total;
    }
    const r = randFloat() * total;
    let idx = cum.length - 1;
    for (let i = 0; i < cum.length; i++) {
      if (r < cum[i]) {
        idx = i;
        break;
      }
    }
    out.push(items[idx]);
    items.splice(idx, 1);
  }
  return out.sort((a, b) => a - b);
}

/** Sample `count` distinct integers from `pool` (array), sorted ascending. */
function sampleDistinct(pool, count) {
  if (count > pool.length) throw new Error("sampleDistinct: pool too small");
  const copy = pool.slice();
  const out = [];
  for (let i = 0; i < count; i++) {
    const idx = randInt(copy.length);
    out.push(copy[idx]);
    copy[idx] = copy[copy.length - 1];
    copy.pop();
  }
  return out.sort((a, b) => a - b);
}

/** All k-combinations of a sorted array, as canonical "a-b-c" keys. */
function combinationKeys(sortedNums, k) {
  const keys = [];
  const n = sortedNums.length;
  if (k <= 0 || k > n) return keys;
  const idx = [];
  for (let i = 0; i < k; i++) idx.push(i);
  while (true) {
    keys.push(idx.map((i) => sortedNums[i]).join("-"));
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return keys;
}

/** Longest run of consecutive integers in a sorted array (e.g. [3,4,5] -> 3). */
function longestConsecutiveRun(sortedNums) {
  let best = 1;
  let run = 1;
  for (let i = 1; i < sortedNums.length; i++) {
    if (sortedNums[i] === sortedNums[i - 1] + 1) {
      run++;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return sortedNums.length === 0 ? 0 : best;
}

/** Longest streak of consecutive same-parity numbers in a sorted row
    (e.g. [3,7,11,19,22] -> 4: four odd numbers in a row). */
function longestParityRun(sortedNums) {
  let best = 0;
  let run = 0;
  let prev = -1;
  for (const n of sortedNums) {
    const p = n % 2;
    run = p === prev ? run + 1 : 1;
    prev = p;
    if (run > best) best = run;
  }
  return best;
}

/** Longest arithmetic progression (equal gaps) hidden anywhere in a sorted
    row, as a subsequence (e.g. [5,7,10,15,20] -> 4 via 5,10,15,20). */
function longestArithmeticProgression(sortedNums) {
  const n = sortedNums.length;
  if (n < 2) return n;
  let best = 2;
  const dp = Array.from({ length: n }, () => new Map());
  for (let j = 1; j < n; j++) {
    for (let i = 0; i < j; i++) {
      const gap = sortedNums[j] - sortedNums[i];
      const len = (dp[i].get(gap) || 1) + 1;
      dp[j].set(gap, len);
      if (len > best) best = len;
    }
  }
  return best;
}

/** Largest count of numbers sharing the same final digit (7,17,27 -> 3). */
function maxSameLastDigit(nums) {
  const buckets = new Array(10).fill(0);
  let best = 0;
  for (const n of nums) {
    const b = ++buckets[n % 10];
    if (b > best) best = b;
  }
  return best;
}

/** Largest count of numbers divisible by the same small divisor. */
function maxSharedDivisor(nums, divisors) {
  let best = 0;
  for (const d of divisors || [3, 5, 7]) {
    let c = 0;
    for (const n of nums) if (n % d === 0) c++;
    if (c > best) best = c;
  }
  return best;
}

function sumOf(nums) {
  return nums.reduce((a, b) => a + b, 0);
}

function countOdd(nums) {
  return nums.filter((n) => n % 2 === 1).length;
}

/** Size of the intersection of two sorted number arrays. */
function overlapCount(a, b) {
  const set = new Set(a);
  let c = 0;
  for (const n of b) if (set.has(n)) c++;
  return c;
}

function rowKey(mains, stars) {
  const m = mains.join("-");
  return stars && stars.length ? m + "|" + stars.join("-") : m;
}
