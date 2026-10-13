# Retirement planner: project summary (handoff)

## What it is
A browser-only "When can I stop working?" planner for one person or a couple, built mainly for **Romania**. It answers one question in plain words, for example "You can both stop working in 2047 (You 56, Partner 54)", using the Romanian state pension formula, Pilon II/III, the user's own investment accounts (each with its own fees and tax) and a Monte Carlo market simulation. A 2-minute quiz ("Where is your money?") fills in the accounts, and a "Your money" card shows what fees and taxes cost. Every amount is in today's prices, adjusted for inflation.

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
  quiz.js             quiz: questions as data, pure applyQuiz(), full-screen panel (window.RetQuiz)
  styles.css          Linear-style look (Inter 13px, hairlines, indigo accent), light and dark mode, motion
  tests.html/.js      59 tests (engine + applyQuiz), run in the browser
planner/, tests/, config/, PLAN.md, pyproject.toml
                      OLDER Python "Phase 1" engine (separate, not used by the web app)
```
Run locally: `python3 -m http.server 8765 --directory retirement`, then open `/index.html` and `/tests.html`. The test page must say "All 59 tests passed". There is no Node test runner; headless Chromium via Playwright works (`executablePath: '/opt/pw-browsers/chromium'` in Claude cloud sessions). When changing JS or CSS, bump the `?v=N` cache-busting query in `retirement/index.html` (currently v=8). Script order: engine.js, quiz.js, app.js (app mounts the quiz).

## Engine (`engine.js`)
Exports: `RO, COUNTRIES, CURRENCIES, ACCOUNT_TYPES, accountLabel, accountDefaults, afterTaxReal, roundNice, roStabilityPoints, roNetPension, roEarlyPenalty, roContribution, roPension, statePension, simulate, solveEarliest`, plus helpers.
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
- **Accounts (`ACCOUNT_TYPES`, Romania 2026 rates; tax is % of the yearly nominal gain, fee %/yr):**

  | type | label (RO / other) | kind | tax | fee |
  |---|---|---|---|---|
  | cash | Cash and current account | cash | 0 | 0 |
  | deposit | Bank deposit | deposit | 10 | 0 |
  | govbond | Fidelis / Tezaur bonds / Government savings bonds | govbond | 0 | 0 |
  | broker_ro | ETFs at a Romanian broker / Investment account | invest | 3 | 0.2 |
  | broker_foreign | ETFs at a foreign broker / Investment account abroad | invest | 16 | 0.2 |
  | fund | Bank investment fund | invest | 3 | 2.0 |
  | generic | Savings and investments | generic | `market.taxDragPct` | `market.feePct` |

  - **Growth:** invest/generic follow `w·rs + (1−w)·rb` with the account's stock %; deposit earns `market.depositReal` (0.5), govbond `market.govReal` (1.5), and cash `1/(1+inflation)−1`. The fee comes off first, then `afterTaxReal(real%, tax%, inflation%)` taxes the nominal gain, so a deposit can lose in real terms. Outside Romania `accountDefaults` sets tax to 0.
  - **Legacy:** without `plan.accounts`, `compileAccounts` builds one generic pot from `plan.liquid`, `market.stockPct`, `feePct` and `taxDragPct`, which is the old maths exactly.
- **`simulate(plan, {runs, seed, successOnly})`:** yearly steps.
  - **While working:** saving continues (`plan.savings`, split equally), each person's share stops when they stop working, and all of it goes to the `savingsTo` account. A pension surplus also goes there.
  - **Withdrawal order:** liquid accounts first, then Pillar III once unlocked, then Pillar II once the state pension starts.
  - **Within the liquid accounts:** in proportion to their balances by default. With `spending.cushionYears` (0 or 2), the safe accounts (cash, deposit, govbond; a hidden govbond is added if none exist) are refilled each normal year to cushion × spending from the risky ones; after a year with a negative balance-weighted return, spending comes from the safe money first.
  - **Typical-path rows** also carry `accounts` (balances), `feePaid`, `taxPaid`, `growth` (before fees and tax) and `addedLiquid`; they add up: start + added + growth − fees − taxes − withdrawals = next start. `res.accounts` lists the compiled accounts.
  - **Markets:** lognormal stock and bond returns; 1,000 runs by default with a seeded PRNG.
  - **Output:** success rate, wealth bands (p10/p50/p90), a yearly table and milestones.
- **`solveEarliest(plan, 0.9)`:** finds the earliest common stop year that works in at least 90% of runs. It moves both partners together and caps at age 75.

## UI (`app.js`)
- **Layout:** the form on the left; the answer, sliders, timeline and charts on the right. On phone the answer and sliders come first, then the form.
- **About you card:**
  - **Top of the card:** "The two of us / Just me" toggle, then **Where you work** (country) with the **Currency** switcher beside it. The switcher is hidden for euro-only countries.
  - **Per person:** name, age, how they earn money (Romania only), salary or income, years of pension contributions, and a one-line pension estimate with a "How?" toggle.
  - **Pensions:** "I know my exact pension" override, and Pilon II/III checkboxes with balances.
  - **Shared money:** without accounts, one "savings and investments" field plus a "Where is your money? 2-minute quiz" button. With accounts, a list with the total, "Edit answers" (reopens the quiz pre-filled) and "Use one total instead" (in-page confirmation; keeps the total in `plan.liquid`).
- **More settings (collapsed):** pension age, points from the official statement, PFA CAS base, Romanian constants, haircut %, Pillar III contributions, spending options, an account editor (type, balance, stocks %, fee, tax, delete, Add account, "New savings go to"), market assumptions, inflation, deposit and bond returns, cash cushion years, run count, exchange rate, saved scenarios, reset. The old stock %/fee/tax-drag fields hide once accounts exist.
- **Plan shape (saved):** as before, plus `accounts: [{ type, balance, stockPct, feePct, taxPct }]`, `savingsTo` (index or null = first investment account), `quiz` (the answers), `market.inflation/depositReal/govReal`, `spending.cushionYears`. `withDefaults` keeps saved lists whose default is empty; `MONEY()` includes `accounts.<i>.balance` so the currency switch converts them; `cleanPlan` clamps account fields and drops unknown types. While accounts exist, `plan.liquid` is kept equal to their total.
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
  - **Your money:** a ring by group (Investments, Pension pots, Government bonds, Cash and deposits), then four totals up to the stop year (You put in, Growth added, Fees took, Taxes took), then up to 3 facts. The facts cover a safe account losing to inflation, the fee effect (two `solveEarliest` runs at 300 runs, cached, from the deferred `renderAnswer` pass), the foreign-broker tax note and more than half in cash. With no accounts it shows an empty state with the quiz button. `renderMoney(host, plan, res, {heavy})` is also used on the quiz results screen.
  - **How this is calculated:** explanatory notes, including yearly tax on gains, proportional withdrawals, the cushion, the 2026 Romanian rates, and that CASS on investment income is not modelled.
- **Quiz (`quiz.js`):**
  - **Panel:** full-screen `#quiz` dialog with one question per screen, tap cards, a progress bar and Back/Next. Single-choice cards advance on their own. Every question has "I'm not sure".
  - **Live preview:** "With these answers: you can both stop in 2047", from `solveEarliest` at 300 runs, debounced 200 ms.
  - **Controls:** Esc or × closes without applying; arrow keys move between cards; Tab stays inside the dialog.
  - **Questions:** invest today?, where is your money (multi; Pilon III and Fidelis hidden outside Romania), about how much (range chips scaled to the currency, or an exact amount; property asks for rent), monthly saving, what's inside, yearly fee, three risk questions (Safe 30 / Balanced 60 / Growth 90% stocks), where new savings go, spend less in bad years, 2-year cushion, then the results screen (the Your money card) and "See my plan".
  - **Not yet:** "Not yet" skips where, amounts, inside and fee; it still picks a savings target, so an empty index fund is created.
  - **Data:** `QUESTIONS` entries are `{ id, type, ask, hint, options(plan, answers), when(answers), after(answers) }`. `applyQuiz(plan, answers)` is pure and returns a new plan.
- **Currency switching:** converts every amount, rounded to whole units, and remembers each amount's figure in every currency, so switching back is exact. Slider steps use round numbers.
- **Storage:** localStorage keys `retcalc.v2.current` (the plan) and `retcalc.v2.scenarios`. Older saved formats are upgraded in `hydrate()` (missing currency, single `fx`, `example` flag).
- **Accessibility and motion:** `aria-live` on the answer, focus rings and `prefers-reduced-motion` support. Motion is small fades and rises, a pop when the rating changes, easing timeline segments and rotating chevrons. Dark mode follows the system.

## Conventions
- **Copy:** plain English, no jargon in the main view, and words instead of percentages where possible ("Very likely").
- **Romanian terms:** kept where users know them: Pilon II, Pilon III, PFA, CAS, Fidelis/Tezaur.
- **Investment copy states facts and never says to buy or sell.** The risk mix is labelled "not investment advice".
- **Code style:** small helper functions, HTML built as strings, `esc()` for user text, and no dependencies.

## Known limitations and ideas
- The solver moves both partners' stop dates together and caps at 75.
- The minimum salary is 4,050 lei for the whole year (it rises to 4,325 from 1 July 2026).
- Not modelled: career phases (for example employee, then PFA), mixed-country careers, wage growth, taxes and payout rules on Pilon II/III, and one partner outliving the other.
- Non-Romanian countries are rough estimates. Possible additions: CZ, HU, SE, DK and BG with their own currencies.
- Saved plans live only in each browser; there is no sync or export.
- Investment tax is charged yearly on gains rather than on sale (a simplification for the 3% Romanian rate). CASS on investment income is not modelled. The quiz's fee answer applies to every investment account; individual fees are edited in More settings.
