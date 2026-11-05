# LykkeTall — UX, Design, Usability & Accessibility Review

**Reviewer framing:** principal product designer / UX strategist / usability researcher / accessibility specialist.
**Review date:** 2026-11-05
**Subject:** LykkeTall — a browser-based lottery number picker for Norsk Lotto (7 of 34) and Eurojackpot (5 of 50 + 2 stars), with configurable selection criteria, historical-draw loading, last-draw reuse, weighting, statistics, and export.
**Method:** evidence-based review of the actual running application and source (`index.html`, `styles.css`, `js/*.js`), plus rendered screenshots of both lottery themes. Where I state a measurement (e.g. contrast ratios) it is computed from the real design tokens; where I state a user outcome without test data I label it a **hypothesis**.

---

## How this review was adapted

The supplied prompt targets an enterprise **project-management & resource-allocation** product. LykkeTall is a consumer/prosumer **lottery number generator**. I preserved the prompt's rigor and structure but remapped three things so the review is about *this* product, not an imaginary one:

| Prompt concept | Adapted to LykkeTall |
|---|---|
| Executives, PMs, resource/capacity managers, ICs, finance, admins | Casual players, systematic/"serious" players, syndicate (pool) organizers, statistics enthusiasts, accessibility-dependent users, mobile quick-pickers, privacy/responsible-play users, first-time visitors, developers/self-hosters |
| **Resource allocation & capacity planning** (the deep-dive) | **The number-selection & criteria engine** — balance rules, popular anti-patterns, smart weighting, last-draw reuse, history exclusions, feasibility handling. This is where the product's real complexity and differentiation live, so it gets the deep dive. |
| Dashboards / reporting / decision support | The **Number statistics** panel (hot/cold/overdue, frequency chart) and the **warnings / feasibility** system |
| Trust, governance & enterprise readiness | **Trust, fairness & responsible gambling** — honesty about odds, the disclaimer, data provenance of crawled results, data freshness, localStorage privacy, age/responsible-play messaging |
| Competitors (MS Project, Jira, Asana…) | Norsk Tipping's own Quick Pick / app, random.org, and lottery "wheeling"/system tools (Smart Luck, Lotto Pro, Lottery Statistic Analyser, Excel systems) |

**Evidence available:** the full running app + source; both themed screenshots; 976 passing unit tests of the generation logic.
**Evidence gaps (assumptions flagged throughout):** no real usability-test sessions, no analytics/adoption data, no real screen-reader pass on assistive tech, and the live crawl could not be exercised against Norsk Tipping from the review environment. SUS/adoption figures in §J are *proposed targets*, not measurements.

---

## A. Executive assessment

| Dimension | Score /10 | Evidence |
|---|---|---|
| **Overall UX maturity** | **6.5** | Genuinely polished, cohesive, and unusually capable for a single-page tool; held back by a cold start with no onboarding, high criteria density, and real accessibility gaps. |
| **Visual design** | **8** | Coherent dark design system with gradient accents, glassy panels, glossy balls, consistent spacing, per-lottery theming (pink/gold), real empty/warning states. Looks commercial-grade. |
| **Usability** | **6** | Instant generation, live feedback, strong feasibility validation and persistence. But ~20 criteria across 5 panels with zero progressive disclosure or presets overwhelms novices; several controls are discoverable only by scrolling. |
| **Accessibility (WCAG 2.2 AA)** | **4** | Good: semantic tabs, focus outlines, label-wrapped toggles, `lang`, viewport. Failing/at-risk: no `prefers-reduced-motion`; the frequency chart has no text/table alternative; dual-range thumbs are unlabeled; carried-number highlight is a gold ring (color-only) with no non-color cue on the ball itself; white numerals on pink balls ≈ 3.4:1 (fails AA normal text); 21px toggle thumb and 20px number steppers are below the 24px target-size minimum. |
| **Core picking workflow** | **7.5** | "Generate 10 rows" is one click, instant, animated, exportable (copy/CSV/print). Defaults are sensible. Loses points for no single-row / variable-count generation and no per-row regenerate/lock. |
| **Selection & criteria engine** (deep-dive) | **8.5** | The standout. Structural last-draw reuse, upfront feasibility validation, crypto RNG, relaxation-with-flagging, multiplicative weighting, configurable anti-patterns. More sophisticated than most commercial pickers. |
| **Trust, fairness & responsible gambling** | **5.5** | Honest, repeated "odds don't change" messaging and a non-affiliation + 18+ disclaimer are real strengths. But the disclaimer sits only in the footer; crawled-data provenance/freshness isn't surfaced; no explicit responsible-gambling resources/links; localStorage privacy is undocumented in-product. |

**Headline:** This is a well-engineered, visually confident product whose *engine* already beats the category. Its gap to "best in category" is **not** capability — it's **onboarding, accessibility, and trust framing**. Those are the cheapest points on the board.

---

## B. What already works well (preserve these)

1. **Instant, honest core loop.** One click → 10 rows, with a staggered pop-in, copy/CSV/print, and localStorage persistence. Benefits every persona; it's the thing casual users came for and it's frictionless. *Preserve.*
2. **Per-lottery theming and correct domain modeling.** Switching Lotto↔Eurojackpot re-themes (pink↔gold), re-labels, resets bounds (7/34 vs 5/50+2), and keeps separate history and last-draw per lottery. This is correct and rare. *Preserve.*
3. **The feasibility guard.** Impossible configurations (e.g. "reuse 5 when only 3 are available", "min 3 per zone × 4 zones > 7") are detected *before* generating and explained in plain language, instead of hanging or silently failing. This is better error-prevention than many enterprise tools. *Preserve and make more visible (see C-3).*
4. **Structural reuse & relaxation-with-flagging.** Reuse is enforced by construction (not rejection sampling), and when style rules can't all be met, they're relaxed *and the row is badged "relaxed"* — the system tells the truth about what it did. Excellent system-status honesty. *Preserve.*
5. **Visual system discipline.** Design tokens, one toggle pattern, one ball pattern, consistent panel chrome, real empty/warning states, a print stylesheet. This is a maintainable system, not ad-hoc CSS. *Preserve.*
6. **Repeated fairness honesty.** "Every valid row has exactly the same odds" appears in the stats hint, the footer, and the weighting panel. For a gambling-adjacent tool this is ethically and reputationally right. *Preserve and elevate.*

---

## C. Critical issues

Ordered by severity. Format: Location · Affected user · Goal · Problem · Why it matters · Consequence · Recommendation · Expected outcome · Priority · Complexity · Confidence.

### C-1 — No onboarding / first-run guidance (cold start)
- **Location:** whole app on first load; `#tickets` empty state only says "Press Generate".
- **Affected:** first-time & infrequent users, casual players.
- **Goal:** understand what this is and get a usable result in <30s.
- **Problem:** the left column opens with ~20 criteria across *five* dense panels (Number balance, Popular anti-patterns, Smart weighting, Your numbers, Historical draws) before the user has generated anything. There is no welcome, no "what is this", no preset, no guided first action.
- **Why it matters:** recognition-over-recall and progressive disclosure are violated at the exact moment first impressions form.
- **Consequence (hypothesis):** novices bounce or ignore every control and treat it as a plain Quick Pick, so the product's differentiation is invisible to the people who most need convincing.
- **Recommendation:** (a) lead with the result — collapse the criteria rail behind a "Customize" control and show Generate + a one-line value prop above the fold; (b) add 3–4 **presets** ("Balanced", "Contrarian/anti-popular", "Hot numbers", "Pure random") as chips that set the whole criteria state; (c) a first-run empty state that shows an example 3-ball row and a single primary CTA.
- **Expected outcome:** faster time-to-first-value; differentiation surfaced without forcing config.
- **Priority:** P0 · **Complexity:** M · **Confidence:** High.

### C-2 — Accessibility: motion, charts, and unlabeled controls
- **Location:** `styles.css` (no reduced-motion), `#freq-chart` (`js/app.js` renders bar `<div>`s), `#reuse-min/#reuse-max`, carried-ball highlight.
- **Affected:** users with vestibular sensitivity, screen-reader users, low-vision, keyboard-only.
- **Goal:** read stats, set reuse range, and perceive which numbers were carried over — without sight or without motion.
- **Problem:** (a) ticket/stagger animations have **no `prefers-reduced-motion` fallback**; (b) the frequency chart is pure `<div>` bars with a CSS `::after` tooltip on **hover only** — no text, no table, invisible to screen readers and keyboards; (c) the two range thumbs share no `aria-label`, so a screen reader announces two identical "slider"s; (d) carried numbers are shown by a **gold ring (color only)** plus a per-row `↻N` badge — the ring itself has no shape/text cue, and WCAG 1.4.1 wants a non-color signal on the element.
- **Why it matters:** these are WCAG 2.2 AA failures (2.3.3 / 1.1.1 / 4.1.2 / 1.4.1), not polish.
- **Consequence:** stats and reuse are unusable for part of the audience; motion can cause real discomfort.
- **Recommendation:** add a `@media (prefers-reduced-motion: reduce)` block zeroing animations; give the chart a visually-hidden data table (or `role="img"` + `aria-label` summary) and make hot/cold/overdue the accessible fallback; add `aria-label="Minimum reuse"/"Maximum reuse"` + `aria-valuetext` to the thumbs; add a small "carried" glyph or underline on carried balls, not just the ring.
- **Expected outcome:** AA conformance on the highest-traffic interactions.
- **Priority:** P0 · **Complexity:** S–M · **Confidence:** High.

### C-3 — Feasibility warnings and "relaxed" status are easy to miss
- **Location:** `#warnings` region above the tickets; per-row `relaxed` badge.
- **Affected:** systematic players, syndicate organizers.
- **Goal:** trust that the rows actually satisfy the rules they set.
- **Problem:** the warning banner renders above the grid but can scroll off; "relaxed" is a small gold pill competing with the `↻N` pill. A user who set strict anti-patterns may not notice that the engine quietly relaxed them.
- **Why it matters:** silent constraint relaxation undermines trust in a tool whose selling point *is* the constraints.
- **Consequence:** users believe rows meet criteria they don't; erodes confidence when they later notice.
- **Recommendation:** make the warning summary sticky to the results header with a count ("3 of 10 rows relaxed — why?"), link each relaxed row to the specific rule that was dropped, and color+icon it (not color alone).
- **Expected outcome:** the engine's honesty becomes legible instead of buried.
- **Priority:** P1 · **Complexity:** S · **Confidence:** Med-High.

### C-4 — Fixed output of exactly 10 rows; no per-row control
- **Location:** `#btn-generate` ("Generate 10 rows").
- **Affected:** casual players (want 1–2 rows), syndicate organizers (want 20–50).
- **Goal:** generate the number of rows they'll actually buy; keep a row they like and reroll the rest.
- **Problem:** the count is hardcoded to 10; there's no "lock this row and regenerate others", no single-row reroll.
- **Why it matters:** a real Lotto coupon is 1–N rows; forcing 10 is a mismatch with the purchase, and an all-or-nothing regenerate wastes a good row.
- **Recommendation:** a row-count stepper (1–many), per-row "lock 🔒" and "reroll ↻" affordances, and respect locks + batch-overlap across regenerates.
- **Expected outcome:** output matches intent; higher perceived control.
- **Priority:** P1 · **Complexity:** M · **Confidence:** High.

### C-5 — Crawled-data provenance & freshness aren't surfaced
- **Location:** Historical draws panel; last-draw card.
- **Affected:** statistics enthusiasts, trust-sensitive users.
- **Goal:** know whether the loaded history is real, complete, and current before trusting hot/cold/overdue and exclusions.
- **Problem:** after a crawl the status line reports counts/route, but the provenance ("unofficial API", possible gaps, last-updated) isn't persistently shown next to the statistics that depend on it. If the crawl silently returns partial data, every downstream metric is quietly skewed.
- **Why it matters:** decision-support that can't vouch for its inputs breeds misplaced confidence — the core governance risk for this app.
- **Recommendation:** a persistent provenance chip on the stats and last-draw areas ("Unofficial source · 312 draws · 2020–2026 · loaded 5 Nov") with a tooltip explaining it's not official and may have gaps; warn when the date range looks incomplete.
- **Expected outcome:** calibrated trust in the analytics.
- **Priority:** P1 · **Complexity:** S · **Confidence:** Med.

### C-6 — Ball-number contrast (Lotto pink)
- **Location:** `.ball` on Norsk Lotto theme (`#ff3d7f` with white bold ~15px numerals).
- **Affected:** low-vision users; anyone in sunlight on mobile.
- **Goal:** read the generated numbers.
- **Problem:** white on `#ff3d7f` computes to **≈3.4:1**, below the 4.5:1 AA threshold for normal text (the digits aren't large enough to qualify for the 3:1 large-text exemption). (Eurojackpot's gold balls use dark text ≈10:1 — fine.)
- **Recommendation:** darken the Lotto ball gradient end-stop (e.g. toward `#e02168`) to reach ≥4.5:1 with white, or increase numeral weight/size; verify both themes with a contrast check in CI.
- **Expected outcome:** the primary content (the numbers) is legible to AA.
- **Priority:** P1 · **Complexity:** S · **Confidence:** High (computed).

### C-7 — Responsible-gambling framing is minimal and footer-only
- **Location:** `.disclaimer` footer.
- **Affected:** all players; the product's ethical/reputational standing.
- **Problem:** the only responsible-play cue is the footer's "(18+)" and fairness line. There's no link to help resources (e.g. Hjelpelinjen 800 800 40 in Norway), no age acknowledgement, no spend-awareness nudge.
- **Why it matters:** the app actively encourages systematic play; Norwegian context and basic duty-of-care call for visible support signposting.
- **Recommendation:** add a small, always-visible responsible-gambling link/resource (localized to NO), keep the honesty copy, and avoid any language implying improved odds.
- **Priority:** P1 · **Complexity:** S · **Confidence:** Med-High.

---

## D. Region-by-region review

*(The app is a single page; "screens" = regions.)*

### D-1 Header + lottery switch
- **Purpose/users/task:** identity + choose lottery system. All users.
- **First impression:** strong — gradient wordmark, ball glyph, clear segmented control with counts ("7 of 34", "5 of 50 + 2 stars").
- **Hierarchy/nav:** good; the switch correctly uses `role="tablist"`/`aria-selected`.
- **Problems:** the switch is the *only* global nav, yet it looks like a toggle, not a primary mode selector; on mobile it wraps under the brand (acceptable). The brand ball `7` is `aria-hidden` (fine).
- **Redesign:** keep. Consider a tiny persistent "odds: 1 in 5,379,616 / 1 in 140M" caption under the active system — reinforces honesty and context at near-zero cost.

### D-2 Criteria rail (5 panels: Number balance / Anti-patterns / Smart weighting / Your numbers / Historical draws)
- **Purpose/users:** configure the engine. Power users love it; novices drown.
- **Hierarchy:** the grouped, icon-chipped panels are a real improvement over the old single list; grouping is logical.
- **Content clarity:** mini-hints with concrete examples (e.g. "rejects 5, 10, 15, 20") are excellent microcopy.
- **Problems:** (1) everything is expanded at once → long scroll, high cognitive load (C-1); (2) toggles reveal numeric bodies on check, but the relationship between a toggle and its revealed inputs isn't announced to AT; (3) number steppers are 20px tall (below target size); (4) no "reset section" / "disable all" affordance.
- **Redesign:** collapse panels by default with a summary line ("Anti-patterns: 4 on"); add preset chips at the top (C-1); add per-panel enable-all/disable-all; grow steppers to ≥24px; add `aria-expanded`/`aria-controls` between toggle and body.

### D-3 Last-draw card + reuse
- **Purpose/users:** show/choose the reference draw and carry numbers forward. Systematic players, syndicate organizers.
- **First impression:** very good — gold-ringed balls, clear meta ("Newest result… / Selected result… / Entered manually"), the two-tab editor (by-date vs manual) now reads as a real chooser.
- **Interactions:** dual-range reuse slider with live "Carry over 2–3…" summary is intuitive and the standout interaction.
- **Problems:** slider thumbs unlabeled for AT (C-2); when no history is loaded the by-date tab is correctly disabled with a hint (good); the card's relationship to the separate "Historical draws" panel on the left is spatially split (the data source is in the sidebar, the chooser is in the content column) — mild context fragmentation.
- **Redesign:** label thumbs; consider co-locating a compact "load results" affordance inside the editor's by-date tab so the data source and the picker aren't on opposite sides of the screen.

### D-4 Historical draws panel
- **Purpose/users:** load data via crawl / paste / import / demo. Stats enthusiasts, power users.
- **Content clarity:** strong microcopy; crawl explains CORS/mirrors honestly.
- **Problems:** the "Crawl 2020–2026" primary button is the most powerful and most fragile action (network, unofficial source) but gives no persistent provenance afterward (C-5); no progress affordance beyond a status string; "Clear" is a red button adjacent to "Demo data" — misclick risk, and clearing is not undoable.
- **Redesign:** add provenance chip; add a confirm-or-undo on Clear; show a determinate progress bar during crawl; label the imported file's row count + date range inline.

### D-5 Number statistics panel
- **Purpose/users:** show hot/cold/overdue + frequency. Analysts.
- **Problems:** chart inaccessible (C-2); "hot/cold" rely on frequency which is only meaningful with enough data — no sample-size caveat; no way to act on a stat (e.g. "exclude these cold numbers") directly from the panel.
- **Redesign:** add accessible table fallback + sample-size note; add inline actions ("Boost overdue", "Exclude", "Require") that write into the criteria — turning a *report* into a *decision-support* surface.

### D-6 Results / tickets
- **Purpose/users:** the payoff. Everyone.
- **First impression:** excellent — glossy balls, hover-lift, pill badges, staggered reveal.
- **Problems:** fixed 10 (C-4); no per-row actions (copy one row, lock, reroll, "mark as bought"); on narrow screens the `↻N`/`relaxed` pills can crowd the balls.
- **Redesign:** per-row action menu; row-count control; ensure pills wrap below balls on mobile.

### D-7 Global states
- Empty, warning, and (crawl) loading states exist — above the category norm. **Missing:** a determinate loading state for crawl, a success toast after CSV download/copy (copy flashes the button — good; CSV/print are silent), and an undo for destructive actions (Clear history, Reset last draw).

---

## E. Workflow review (friction map)

1. **Quick pick (casual):** Load → *(confronted by criteria wall)* → Generate → Copy. **Friction:** the criteria wall between arrival and the one action they want. **Fix:** C-1 (result-first layout + presets).
2. **Systematic build (serious):** configure balance → anti-patterns → weighting → set last draw/reuse → load history for exclusions → Generate → inspect relaxed flags → export. **Friction:** no presets to start from; relaxation can go unnoticed (C-3); can't save a named "system" of settings beyond the implicit localStorage. **Fix:** named presets/profiles; sticky relaxation summary.
3. **Load history → analyze → act:** Crawl/import → read stats → *dead end* (must manually translate a stat into a criterion). **Fix:** inline actions from stats (D-5).
4. **Syndicate run:** generate → export CSV → share externally. **Friction:** fixed 10; no row labels/own metadata; no shareable link of a config. **Fix:** row-count + a shareable config URL (serialize settings to query string).
5. **Mobile pre-draw pick:** everything works but the criteria rail is a very long scroll above/below the result depending on breakpoint. **Fix:** result-first + collapsed criteria.

**Cross-cutting:** no undo anywhere; no saved/named configurations; no "generate again keeps my locked rows".

---

## F. Selection & criteria engine — deep dive (the "resource allocation" analog)

This is the product's core and its competitive moat. Assessed against the lottery analogs of the prompt's capacity questions:

| "Can the user quickly answer…" | Today | Gap / recommendation |
|---|---|---|
| **Which numbers are overdue / hot / cold?** | Yes — stats panel + overdue list. | Add sample-size confidence; make it accessible. |
| **How many of my rules can actually be satisfied together?** | Yes — upfront feasibility validation with specific messages. | Best-in-class; surface it even before clicking Generate (live "feasible ✓/✗" indicator). |
| **What did the engine compromise on?** | Partially — per-row "relaxed" badge. | Explain *which* rule relaxed and *why* (C-3). |
| **What if I reuse N numbers from last draw?** | Yes — structural, instant, highlighted. | Add "reuse from a *specific past row*", not only the last draw. |
| **What's the financial impact of my picks?** | **No.** | Add a cost readout: rows × stake (e.g. Lotto row price) = total coupon cost. This is the single most valuable missing "decision-support" number and ties directly to responsible-play awareness. |
| **How do popular-ness / shared-jackpot odds change with anti-patterns?** | Implied by copy only. | A qualitative "uniqueness" meter per row ("avoids 3 common patterns") would make the anti-pattern panel's value tangible. |
| **What happens if I change a rule — does the output shift as expected?** | Only by regenerating. | A live preview count ("≈92% of random rows pass your filters") would turn blind config into feedback. |

**Engine strengths to keep:** crypto RNG with rejection sampling (no modulo bias), weighted sampling without replacement, structural reuse, relaxation-with-flagging, and the whole thing DOM-free and unit-tested (976 assertions). This is more rigorous than typical "lottery system" shareware.

**Highest-value additions:** (1) **coupon cost** readout; (2) **row uniqueness/contrarian score**; (3) **live feasibility & pass-rate preview** so configuration is a feedback loop, not a guess; (4) **presets/saved systems**.

---

## G. Recommended future experience

- **Navigation:** keep the single-page model, but adopt a **result-first** layout: Generate + presets + row count + the 10 rows occupy the hero; a collapsible "Customize numbers" drawer holds the five criteria panels (remembered open for power users). Lottery switch stays top-level.
- **Dashboard (stats):** turn the stats panel into decision-support — accessible chart + table, sample-size note, and inline "act on this" buttons that write to criteria.
- **Picking workspace:** per-row lock/reroll/copy/"bought"; a coupon summary (row count × stake = cost) with a gentle spend-awareness note.
- **Data workspace:** crawl/import with a persistent provenance + freshness chip and an undoable Clear.
- **Reuse/weighting:** keep as-is functionally; add labels/ARIA; allow reuse from any chosen past row.
- **Alerts:** sticky, counted, linked relaxation/feasibility summary; success toasts for CSV/print.
- **AI-assisted (optional, honest):** a "explain my coupon" summary ("these 10 rows avoid consecutive runs, balance odd/even, and reuse 2 from last Saturday — note: this does not improve your odds"). Never phrase AI as predictive.
- **Mobile:** result-first shines here; collapsed criteria; sticky Generate; pills wrap under balls; ≥44px touch targets.

---

## H. Prioritized improvement backlog

| ID | Recommendation | Problem solved | User group | Impact | Effort | Priority | Dependencies | Success metric |
|---|---|---|---|---|---|---|---|---|
| R1 | `prefers-reduced-motion` + zero animations | WCAG 2.3.3 | Vestibular, a11y | High | S | **P0** | — | 0 motion violations |
| R2 | Accessible frequency chart (hidden table + aria) | WCAG 1.1.1/4.1.2 | SR users, analysts | High | M | **P0** | — | SR can read all stats |
| R3 | Result-first layout + 4 presets + collapsible criteria | Cold start (C-1) | Novices, mobile | High | M | **P0** | — | Time-to-first-generate ↓ |
| R4 | Label dual-range thumbs; `aria-valuetext` | WCAG 4.1.2 | SR users | Med | S | **P0** | — | Thumbs distinctly announced |
| R5 | Fix Lotto ball contrast ≥4.5:1 | WCAG 1.4.3 (C-6) | Low-vision | Med | S | **P0** | — | Computed ≥4.5:1 both themes |
| R6 | Sticky, counted, linked relaxation/feasibility summary | Silent relaxation (C-3) | Serious users | High | S | **P1** | — | Users notice relaxations |
| R7 | Row-count stepper + per-row lock/reroll | Fixed 10 (C-4) | Casual, syndicate | High | M | **P1** | — | Rows generated matches intent |
| R8 | Coupon cost readout + spend note | Missing decision number | All | High | S | **P1** | stake data | Cost shown every generate |
| R9 | Crawl provenance + freshness chip; undoable Clear | Data trust (C-5) | Analysts | Med | S | **P1** | — | Provenance always visible |
| R10 | Responsible-gambling link (NO) + keep honesty copy | Duty of care (C-7) | All | Med | S | **P1** | — | Resource link present |
| R11 | Inline "act on this stat" buttons | Report→decision gap | Analysts | Med | M | **P2** | R2 | Stat→criteria in 1 click |
| R12 | Named saved configurations / presets management | No saved systems | Power users | Med | M | **P2** | R3 | Configs saved/recalled |
| R13 | Live feasibility + pass-rate preview | Blind config | Power users | Med | M | **P2** | — | Preview updates on change |
| R14 | Shareable config URL (serialize settings) | Collaboration | Syndicates | Med | M | **P2** | R12 | Config shareable |
| R15 | Row "uniqueness/contrarian" score | Intangible anti-patterns | Serious | Low-Med | M | **P3** | — | Score per row |
| R16 | "Explain my coupon" (honest, non-predictive) | Comprehension | Novices | Low-Med | M | **P3** | R3 | Explanation shown |

---

## I. Quick wins

**1–2 days:** R1 (reduced-motion), R4 (slider labels), R5 (ball contrast), R8 (coupon cost), R10 (responsible-play link), success toasts for CSV/print, undo/confirm on Clear.
**~1 sprint:** R2 (accessible chart), R3 (result-first + presets), R6 (sticky relaxation summary), R9 (provenance chip).
**~1 quarter:** R7 (row-count + per-row controls), R11–R14 (inline stat actions, saved configs, live preview, shareable URL).

---

## J. Success metrics & validation plan

**Instrument (even a privacy-respecting local counter):**
- Time-to-first-generate (target: <15s for new users after R3).
- % sessions that open the criteria rail vs use a preset (validates R3).
- Relaxation-notice rate: % of relaxed generations where the user opens the explanation (validates R6).
- Export rate (copy/CSV/print) per generate.
- Accessibility: automated axe/Lighthouse pass with **0 critical** issues (validates R1, R2, R4, R5); manual NVDA/VoiceOver pass of generate + stats + reuse.
- Proposed **SUS target ≥ 80** post-R3/R6 (currently un-measured — *assumption*).

**Usability tests (5–7 participants each):**
1. *First-time casual* — "Get 5 rows of Lotto numbers you'd actually play." Observe time-to-first-value and whether criteria block them.
2. *Serious/systematic* — "Make 10 rows that avoid common patterns and reuse 2 numbers from last Saturday's draw." Observe whether they notice relaxations and trust the result.
3. *Analyst* — "Load the last 5 years and build rows that favour overdue numbers." Observe crawl trust and stat→criteria translation.
4. *Screen-reader user* — "Set the reuse range to 2–3 and read which numbers are overdue." Validates R2/R4.
5. *Mobile quick-pick* — "On your phone, generate and copy one row before the draw." Validates R3/R7 mobile.

---

### Closing

LykkeTall is already a **top-quartile** product in the hobbyist/consumer lottery-tool category on engine quality and visual craft — genuinely ahead of the shareware it competes with. The distance to "best in category" is concentrated in four cheap, high-leverage moves: **(1) a result-first first run with presets, (2) an accessibility pass to AA, (3) make the engine's honesty (relaxation, feasibility, provenance) visible, and (4) add the one decision number players actually care about — coupon cost — wrapped in responsible-play framing.** None requires rebuilding what's there; all of it builds on patterns the product already has.
