# Draw datasets

Files here are the output of `tools/hent_lottotall.py` and are loaded by the app
as the **second** source in its fallback chain (after Norsk Tipping's live API).

| File | Covers | Current content |
|---|---|---|
| `lotto.csv` | Norsk Lotto, 7 of 34 + tilleggstall | not yet generated — run the collector where norsk-tipping.no is reachable (`python3 tools/hent_lottotall.py fetch --game lotto --from 2015-03-01 --out data/lotto.csv`) or let the weekly workflow create it |
| `eurojackpot.csv` | Eurojackpot, 5 of 50 + 2 stars | 828 draws 2012-03-23 → 2025-02-25 imported from the independent dataset [eonurk/EuroJackpot](https://github.com/eonurk/EuroJackpot) (`source=tredjepart:eonurk`); validated with 0 errors, 0 gaps. Replace/extend with API data via the collector. |

Columns: `game, draw_date, iso_year, iso_week, draw_id, main_numbers (sorted),
main_numbers_draw_order, bonus_numbers, prize_tiers_json, turnover_nok, source,
source_url, fetched_at, validation_status, validation_notes, row_hash`.

Every row names its source; the app shows that provenance and the week-by-week
coverage in the "Data basis for your rows" panel.
