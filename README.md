# LykkeTall — Smart Lottery Number Picker

A professionally designed, dependency-free web app that picks **10 sets of lottery numbers**
for **Norsk Lotto** (7 of 34) or **Eurojackpot** (5 of 50 + 2 star numbers of 12),
with configurable selection criteria and history-aware exclusions.

![Screenshot](docs/screenshot-lotto.png)

## Running

No build step and no dependencies. Either:

- open `index.html` directly in a browser, or
- serve the folder statically, e.g. `python3 -m http.server 8000` and visit
  `http://localhost:8000`.

## Features

### Lottery systems
Switch between **Norsk Lotto** and **Eurojackpot** with the segmented control in the
header. Each system keeps its own rules, sum-range defaults, theme colour and
loaded history.

### Historical draws
Load previously drawn winning numbers and stop the generator from repeating history:

- **Fetch results** — collects draws for your lookback window through an ordered
  chain of sources with automatic fallback: **Norsk Tipping's results API**
  (`api.norsk-tipping.no/LotteryGameInfo/v2`, 15-week windows, polite spacing) →
  the **dataset shipped with the app** (`data/*.csv`, maintained by
  `tools/hent_lottotall.py` and a weekly workflow) → an **independent public
  dataset** (Eurojackpot) → the **legacy API**. Later sources are only asked for
  weeks still missing; a source that fails twice in a row is left alone. The
  status list under the button shows what each source delivered or why it failed,
  and **Download dataset CSV** exports everything loaded.
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

### Data basis for your rows
Every draw remembers its source. The **Data basis** panel above the rows shows, week by
week and year by year, which weeks were fetched (and from which source), which are
missing or only partial, and — highlighted — which weeks actually feed the generator
(the lookback window used by exclusions, statistics and weighting). The summary states
plainly e.g. "260 draws in 258 weeks are used for your rows — 2021-W45 to 2026-W45",
lists incomplete weeks, and the results bar links to it ("based on 260 past draws").

### Last draw & reuse
A highlighted **Last draw** card (gold-ringed balls) shows the most recent draw — by
default the newest dated row in your loaded results. **Edit** opens a two-mode chooser:
**From loaded results (by date)** picks any draw from your crawled/imported CSV by its
date (latest preselected), or **Enter manually** lets you type the numbers in. A dual-thumb
**reuse** slider then lets each generated row carry over a chosen *range* of numbers from
that last draw — e.g. exactly 0, 0–1, 0–2, 1–3, … up to all of them. The carried-over
numbers are highlighted in gold in every generated row, with a `↻ N` badge showing how
many were reused. Reuse is enforced structurally (not by trial and error), so even high
reuse counts generate instantly.

### Selection criteria (each one can be toggled)

| Criterion | What it does |
|---|---|
| Max numbers in sequence | Limits the longest run of consecutive numbers (e.g. allow at most 2) |
| Odd / even balance | Requires between *min* and *max* odd numbers per row |
| Sum within range | Keeps each row's sum inside a configurable band (defaults per lottery) |
| Spread across number zones | Between *min* and *max* numbers per zone of ten (1–10, 11–20, …); a minimum above 0 forces every zone to be represented |
| Limit odd/even streaks | Rejects rows containing more than *N* consecutive only-odd or only-even numbers (e.g. 3, 7, 11, 19) |
| **Max arithmetic progression length** | Rejects rows whose numbers contain an equal-gap run longer than *N* — even non-adjacent, so 5, 10, 15, 20 hiding in a row is caught |
| Limit same last digit | Rejects rows with more than *N* numbers ending in the same digit (7, 17, 27, 37) |
| Limit multiples of one number | Rejects rows with more than *N* multiples of the same small number (3, 5 or 7) |
| Low / high balance | Requires at least *minLow* numbers from the low half and *minHigh* from the high half — no all-low or all-high rows |
| Avoid birthday bias | Requires at least one number above 31 (fewer co-winners if you win) |
| Favour overdue numbers (slider) | Raises the sampling weight of numbers that have gone longest without being drawn within the lookback window — up to 9× at 100 % |
| Favour rarely-picked numbers (slider) | Raises the sampling weight of the numbers drawn least often within a user-chosen period (in years) — up to 9× at 100 % |
| Limit overlap between rows | No two of your 10 rows share more than *N* numbers |
| Exclude specific numbers | Numbers that must never be picked |
| Always include lucky numbers | Numbers forced into every row |

The criteria are grouped into clearly labelled panels — **Number balance**, **Popular
anti-patterns**, **Smart weighting**, **Your numbers** and **Historical draws** — each a
toggle plus its own settings.

The two sliders are sampling *biases* rather than filters: they use weighted
sampling without replacement, so boosted numbers become more likely to be
suggested while every valid row remains possible. Both need loaded history, and
the statistics panel shows the corresponding hot/cold/overdue numbers.

If the hard exclusions make the style criteria unsatisfiable, the generator relaxes
the style rules for that row (never the exclusions) and flags the row as *relaxed*.
Infeasible combinations of settings are detected and reported instead of looping.

### Quick setup
The top of the sidebar offers four **presets** — *Balanced*, *Contrarian* (avoids the
combinations crowds love, so a win is less likely to be shared), *Overdue & rare* and
*Pure random*. Presets set the style rules only, never your excluded/required numbers or
history. A live **rule strictness** gauge estimates what share of random rows pass your
current rules (and flags conflicting settings before you generate), and **Copy settings
link** shares your exact rules as a URL — without your history. The detailed criteria
live in collapsible panels whose headers show how many rules are on.

### Output
Choose how many rows to generate (1–50). Each row can be **locked** (kept when you
generate again), **rerolled** on its own, or **copied**. A sticky summary shows the row
count, locked rows, any rows where style rules had to be relaxed — each relaxed row names
the exact rules it breaks — and the **coupon cost** (rows × an editable price per row;
defaults 6 kr Lotto / 25 kr Eurojackpot, check current prices). All rows can be copied,
downloaded as CSV or printed. Settings, rows, locks and loaded history persist in
`localStorage`; destructive actions such as clearing history can be undone.

### Trust and responsible play
Statistics and history always show their **data provenance** — where the draws came from
(crawled unofficial data, your paste/import, or synthetic demo data), the date range, when
it was loaded, and a warning when the range looks incomplete. The jackpot odds for the
selected lottery are shown next to the results, and the footer links to free help from
Hjelpelinjen (800 800 40).

### Accessibility
Built toward WCAG 2.2 AA: text on filled surfaces meets 4.5:1 contrast, animations are
disabled under `prefers-reduced-motion`, the frequency chart has a text summary and a full
data table for screen readers, carried-over numbers are marked by a ★ badge (not colour
alone), sliders and row actions have accessible names, a skip link jumps to the generator,
and on small screens the results come before the settings.

## Implementation notes

- Random numbers come from `crypto.getRandomValues` with rejection sampling (no
  modulo bias).
- Generation is rejection sampling against the enabled criteria with a per-row
  attempt budget; history exclusion uses precomputed sets of full rows and
  *k*-combinations for O(1) lookups.
- The logic (`js/util.js`, `js/history.js`, `js/generator.js`, `js/lotteries.js`) is
  DOM-free and unit-tested: `node test/run-tests.js`.
- The same sampler drives generation, single-row rerolls, locked rows and the strictness
  gauge, so the gauge reflects exactly what the generator will do.
- A UX review with the prioritised backlog behind these features is in
  [`docs/UX-REVIEW.md`](docs/UX-REVIEW.md); the source assessment behind the data
  fetching is in [`docs/DATAINNHENTING-HISTORISKE-TALL.md`](docs/DATAINNHENTING-HISTORISKE-TALL.md)
  and the offline collector is `tools/hent_lottotall.py` (`python3 tools/hent_lottotall.py selftest`).

## Fair-play disclaimer

Every valid row has exactly the same probability of winning. The criteria shape the
*style* of your rows and avoid repeating history; they cannot improve your odds.
Play responsibly (18+). LykkeTall is not affiliated with Norsk Tipping or Eurojackpot.
