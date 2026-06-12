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
