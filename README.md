# LykkeTall — Smart Lottery Number Picker

A professionally designed, dependency-free web app that picks **10 sets of lottery numbers**
for **Norsk Lotto** (7 of 34) or **Eurojackpot** (5 of 50 + 2 star numbers of 12),
with configurable selection criteria and history-aware exclusions.

![Screenshot](docs/screenshot-lotto.png)

## Running

No build step and no dependencies. Either:

- open `index.html` directly in a browser, or
- serve the folder statically, e.g. `python3 -m http.server 8000` and visit
  `http://localhost:8000` (recommended — required for URL fetching).

## Features

### Lottery systems
Switch between **Norsk Lotto** and **Eurojackpot** with the segmented control in the
header. Each system keeps its own rules, sum-range defaults, theme colour and
loaded history.

### Historical draws
Load previously drawn winning numbers and stop the generator from repeating history:

- **Fetch from URL** — preset links to the relevant results pages are provided per
  lottery. The fetch tries the provider directly first and automatically falls back
  to public read-through mirrors when the provider blocks browser requests (CORS).
  Successful fetches are cached for 12 hours per URL so repeated clicks don't hammer
  (or get blocked by) the provider. If every route fails, the app explains the
  copy/paste and file-import fallbacks.
- **Paste draws** — one draw per line, e.g. `16.03.2024 1 5 12 19 23 28 31`
  (Eurojackpot: `14.06.2024 7 19 28 33 45 + 3 9`). Norwegian (`dd.mm.yyyy`) and ISO
  dates are both understood.
- **Import file** — CSV/TXT (line-oriented, same format as paste) or JSON
  (`[{date, mains, stars}]` and several common API shapes).
- **Demo data** — synthetic draws, clearly labelled, for trying out the filters.

History controls:

- **Only look back a number of years** — disregard draws older than *N* years.
- **Never repeat a full past row** — generated rows must not match any historical row.
- **Avoid past combinations** — reject any row containing a previously drawn group of
  *k* numbers (e.g. with *k* = 4: if 3, 9, 17 and 25 ever appeared together, no
  generated row may contain all four).

A statistics panel shows per-number frequency and hot/cold numbers for the active window.

### Selection criteria (each one can be toggled)

| Criterion | What it does |
|---|---|
| Max numbers in sequence | Limits the longest run of consecutive numbers (e.g. allow at most 2) |
| Odd / even balance | Requires between *min* and *max* odd numbers per row |
| Sum within range | Keeps each row's sum inside a configurable band (defaults per lottery) |
| Spread across number zones | Between *min* and *max* numbers per zone of ten (1–10, 11–20, …); a minimum above 0 forces every zone to be represented |
| Limit odd/even streaks | Rejects rows containing more than *N* consecutive only-odd or only-even numbers (e.g. 3, 7, 11, 19) |
| Pattern guard | Rejects rows where more than *N* (default 4) numbers form an equal-gap progression (5, 10, 15, 20, 25), share the same final digit (7, 17, 27, …), or are multiples of the same small number (3, 5 or 7) |
| Avoid birthday bias | Requires at least one number above 31 (fewer co-winners if you win) |
| Limit overlap between rows | No two of your 10 rows share more than *N* numbers |
| Exclude specific numbers | Numbers that must never be picked |
| Always include lucky numbers | Numbers forced into every row |

If the hard exclusions make the style criteria unsatisfiable, the generator relaxes
the style rules for that row (never the exclusions) and flags the row as *relaxed*.
Infeasible combinations of settings are detected and reported instead of looping.

### Output
Rows are rendered as lottery balls and can be **copied**, **downloaded as CSV** or
**printed** (a print stylesheet renders clean black-on-white tickets). Settings and
loaded history persist in `localStorage`.

## Implementation notes

- Random numbers come from `crypto.getRandomValues` with rejection sampling (no
  modulo bias).
- Generation is rejection sampling against the enabled criteria with a per-row
  attempt budget; history exclusion uses precomputed sets of full rows and
  *k*-combinations for O(1) lookups.
- The logic (`js/util.js`, `js/history.js`, `js/generator.js`, `js/lotteries.js`) is
  DOM-free and unit-tested: `node test/run-tests.js`.

## Fair-play disclaimer

Every valid row has exactly the same probability of winning. The criteria shape the
*style* of your rows and avoid repeating history; they cannot improve your odds.
Play responsibly (18+). LykkeTall is not affiliated with Norsk Tipping or Eurojackpot.
