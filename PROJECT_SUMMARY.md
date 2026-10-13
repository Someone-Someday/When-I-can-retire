# Retirement planner: project summary (handoff)

## What it is
A browser-only "When can I stop working?" planner for one person or a couple, built mainly for **Romania**. It answers one question in plain words, for example "You can both stop working in 2047 (You 56, Partner 54)", using the Romanian state pension formula, Pilon II/III and a Monte Carlo market simulation. Every amount is in today's prices, adjusted for inflation.

- **Live site:** https://someone-someday.github.io/When-I-can-retire/ (the root `index.html` redirects to `retirement/`)
- **Repo:** https://github.com/Someone-Someday/When-I-can-retire
- **Branch:** `claude/phase-1-solver-setup-bu0ji3`. It is the repo's default branch and the GitHub Pages source (root folder). Every push redeploys within 1–2 minutes.
- **Stack:** plain HTML/CSS/JS. No build step, no framework, no backend. The only external resource is the Inter font from Google Fonts.

## Files
```
index.html            redirect to retirement/ (for Pages)
.nojekyll             Pages: serve files as-is
retirement/
  index.html          page shell: header, form host, answer card, sliders, timeline, charts, details
  engine.js           pure calculation engine, no DOM (window.RetEngine)
  app.js              UI: form rendering, state, events, charts (hand-written SVG), localStorage
  styles.css          Linear-style look (Inter 13px, hairlines, indigo accent), light and dark mode, motion
  tests.html/.js      47 engine tests, run in the browser
planner/, tests/, config/, PLAN.md, pyproject.toml
                      OLDER Python "Phase 1" engine (separate, not used by the web app)
```
Run locally: `python3 -m http.server 8765 --directory retirement`, then open `/index.html` and `/tests.html`. The test page must say "All 47 tests passed". There is no Node test runner; headless Chromium via Playwright works (`executablePath: '/opt/pw-browsers/chromium'` in Claude cloud sessions). When changing JS or CSS, bump the `?v=N` cache-busting query in `retirement/index.html` (currently v=7).

## Engine (`engine.js`)
Exports: `RO, COUNTRIES, CURRENCIES, roStabilityPoints, roNetPension, roEarlyPenalty, roContribution, roPension, statePension, simulate, solveEarliest`, plus helpers.
- **Romanian pension (2026 rules, constants in `RO`):**
  - **Points:** points a year = monthly contribution base ÷ average gross salary (9,192 lei).
  - **Point value:** 81 lei.
  - **Stability points:** extra points for long careers (0.5 a year for years 26–30, 0.75 for 31–35, 1 above 35).
  - **Minimums:** at least 15 contributed years; never below the social minimum pension (1,281 lei).
  - **Tax:** 19% is deducted from the part above 3,000 lei.
  - **Early claim:** up to 5 years early, costing 0.4% a month, capped at 24%.
- **Contribution base by earning type:**
  - **Employee:** gross salary.
  - **PFA:** nothing below 12 minimum salaries a year, a base of 12 minimum salaries up to 24, and 24 above. The CAS mode can be overridden.
  - **Dividends only:** nothing.
  - **Voluntary contract:** a declared base of at least the minimum salary (4,050 lei).
  - **Pilon II:** only employees pay in (4.75% of gross).
- **Other countries (`COUNTRIES`):**
  - **Rough estimate:** DE, FR, ES, IT, NL, PL and PT use mode `rate`: pension = salary × replacement % × (years ÷ full career).
  - **No formula:** `MANUAL` means the user enters each pension.
  - **Pillar III:** each country has its own name and unlock age.
- **Currencies (`CURRENCIES`):** EUR, RON (default 5.1 per €) and PLN (4.25 per €). Each country has a local currency, and the app offers [local, EUR] or EUR only. The engine converts Romanian lei constants with `plan.fx` (the lei-per-€ rate).
- **`simulate(plan, {runs, seed, successOnly})`:** yearly steps.
  - **While working:** saving continues, split equally, and each person's share stops when they stop working.
  - **Withdrawal order:** savings and investments first, then Pillar III once unlocked, then Pillar II once the state pension starts.
  - **Markets:** lognormal stock and bond returns; 1,000 runs by default with a seeded PRNG.
  - **Output:** success rate, wealth bands (p10/p50/p90), a yearly table and milestones.
- **`solveEarliest(plan, 0.9)`:** finds the earliest common stop year that works in at least 90% of runs. It moves both partners together and caps at age 75.

## UI (`app.js`)
- **Layout:** the form on the left; the answer, sliders, timeline and charts on the right. On phone the answer and sliders come first, then the form.
- **About you card:**
  - **Top of the card:** "The two of us / Just me" toggle, then **Where you work** (country) with the **Currency** switcher beside it. The switcher is hidden for euro-only countries.
  - **Per person:** name, age, how they earn money (Romania only), salary or income, years of pension contributions, and a one-line pension estimate with a "How?" toggle.
  - **Pensions:** "I know my exact pension" override, and Pilon II/III checkboxes with balances.
  - **Shared:** savings and investments.
- **More settings (collapsed):** pension age, points from the official statement, PFA CAS base, Romanian constants, haircut %, Pillar III contributions, spending options, market assumptions, fees, run count, exchange rate, saved scenarios, reset.
- **Answer card:**
  - **Example banner:** shown until the first edit.
  - **Headline:** the earliest year, with a "Use 2047" button.
  - **Current plan:** stop year, spending and a Very likely (≥90%) / Likely (≥75%) / Risky rating, plus "works in N of 100 futures".
  - **Next steps:** up to 3 tips.
  - **What-if chips:** save more, stop 3 years later, spend 10% less.
- **Play with it:** sliders for each stop age, monthly saving and spending in retirement. They update live; the heavier solver runs after a 180 ms pause.
- **Visuals:**
  - **Timeline bar:** working → living on savings → pension.
  - **Savings chart:** p50 line with a p10–p90 band and numbered milestones.
  - **Year by year (collapsed):** stacked income chart and a full table.
  - **How this is calculated:** explanatory notes.
- **Currency switching:** converts every amount, rounded to whole units, and remembers each amount's figure in every currency, so switching back is exact. Slider steps use round numbers.
- **Storage:** localStorage keys `retcalc.v2.current` (the plan) and `retcalc.v2.scenarios`. Older saved formats are upgraded in `hydrate()` (missing currency, single `fx`, `example` flag).
- **Accessibility and motion:** `aria-live` on the answer, focus rings and `prefers-reduced-motion` support. Motion is small fades and rises, a pop when the rating changes, easing timeline segments and rotating chevrons. Dark mode follows the system.

## Conventions
- **Copy:** plain English, no jargon in the main view, and words instead of percentages where possible ("Very likely").
- **Romanian terms:** kept where users know them: Pilon II, Pilon III, PFA, CAS.
- **Code style:** small helper functions, HTML built as strings, `esc()` for user text, and no dependencies.

## Known limitations and ideas
- The solver moves both partners' stop dates together and caps at 75.
- The minimum salary is 4,050 lei for the whole year (it rises to 4,325 from 1 July 2026).
- Not modelled: career phases (for example employee, then PFA), mixed-country careers, wage growth, taxes and payout rules on Pilon II/III, and one partner outliving the other.
- Non-Romanian countries are rough estimates. Possible additions: CZ, HU, SE, DK and BG with their own currencies.
- Saved plans live only in each browser; there is no sync or export.
