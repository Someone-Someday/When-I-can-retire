# Retirement planner — build plan

A "When can I retire?" tool in the spirit of Monarch Money's: move a slider (retirement age, spending, contributions, returns) and immediately see whether the money lasts, grounded in real numbers from my own transaction data rather than guesses.

This file is written to be handed to Claude Code. Build in the phases below, in order, and stop at the end of each phase for review.

---

## 1. What the feature does

**Core question it answers:** "If I stop working at age X, does my money last until age Y, and if not, what's the earliest age where it does?"

**What the user sees:**
- Sliders/inputs for the main assumptions (retirement age, monthly spending in retirement, monthly contributions, expected real return, life expectancy).
- A chart of projected net worth by age: accumulation phase rising, drawdown phase falling, with the retirement age marked.
- A headline answer: "Money lasts to age 91 ✓" or "Runs out at age 78 ✗ — earliest safe retirement age is 63."
- With Monte Carlo on: a probability of success ("87% of simulations last to 95") and a shaded band (10th–90th percentile) on the chart.
- A "what's driving this" panel: the 2–3 assumptions the result is most sensitive to.

**What it does not do:** recommend investments, asset allocations, or products. It's a calculator over assumptions I set.

---

## 2. Principles

1. **Everything in today's money.** Use real (inflation-adjusted) returns so all figures read in today's EUR. Show a toggle to view nominal figures, but compute in real terms.
2. **Defaults come from data, not guesses.** Current spending, savings rate and current net worth are pulled from my actual transactions. Every default shows where it came from ("spending: 12-month average from Wallet, excl. transfers").
3. **Every assumption is visible and editable.** No hidden constants. Assumptions live in one config file.
4. **The engine is pure and tested.** Projection maths is a plain Python module with no I/O, covered by unit tests with hand-checked numbers. UI and data loading sit on top.
5. **Base currency EUR**, with RON amounts converted at a configurable rate (and the rate shown).

---

## 3. Architecture

```
retirement-planner/
├── PLAN.md                  # this file
├── config/
│   └── assumptions.yaml     # all defaults + their source notes
├── data/
│   └── snapshot.json        # derived figures from transactions (no raw rows)
├── planner/
│   ├── engine.py            # pure projection maths (deterministic + Monte Carlo)
│   ├── solver.py            # "earliest retirement age" search
│   ├── sensitivity.py       # which inputs move the answer most
│   ├── ingest.py            # build snapshot.json from Wallet/Zenmoney exports
│   └── models.py            # dataclasses for inputs/outputs
├── app/
│   └── streamlit_app.py     # UI (Phase 3)
└── tests/
    ├── test_engine.py
    ├── test_solver.py
    └── test_ingest.py
```

**Stack:** Python 3.11+, pandas, numpy, pydantic (or dataclasses), pytest, Streamlit + Plotly for the UI. Streamlit is chosen because it gets sliders + live charts with almost no frontend code and fits the existing pandas pipeline. A React/HTML front end can replace it later without touching the engine.

---

## 4. Inputs

### 4.1 Person & timeline
| Input | Default | Notes |
|---|---|---|
| current_age | — (required) | |
| retirement_age | 65 | slider 40–75 |
| life_expectancy (plan-to age) | 95 | deliberately conservative; slider 80–105 |
| partner mode | off | Phase 4: second person with own age/pension |

### 4.2 Money today (from data snapshot, editable)
| Input | Source |
|---|---|
| invested_assets | sum of investment/savings account balances |
| cash_assets | cash + current accounts above an emergency buffer |
| monthly_spending_now | trailing 12-month average, **excluding transfers** (see §6) |
| monthly_contribution | trailing 12-month average net flow into savings/investment accounts |

### 4.3 Assumptions (config/assumptions.yaml)
| Input | Default | Notes |
|---|---|---|
| real_return_pre_retirement | 4.0% | slider 0–8% |
| real_return_post_retirement | 3.0% | slider 0–7% |
| return_volatility | 12% | Monte Carlo only |
| inflation | 3.0% | only used for nominal view |
| retirement_spending | = monthly_spending_now × 1.0 | slider as % of today's (50–130%) |
| contribution_growth | 0% real/yr | |
| state_pension_monthly | 0 | **user must enter** — see §4.4 |
| state_pension_start_age | 65 | |
| other_income | [] | list of {amount, start_age, end_age}, e.g. part-time work |
| one_off_events | [] | list of {age, amount}, e.g. house purchase (−), inheritance (+) |
| spending_phases | [] | list of {from_age, to_age, delta}, e.g. child costs ending, relocation |
| fx_ron_per_eur | 4.97 | editable, shown in UI |
| tax_on_withdrawals | 0% | placeholder; real Romanian treatment to be confirmed |

### 4.4 Romania-specific notes (verify before relying on them)
- State pension (Pillar I) depends on contribution history; with income mainly through a business entity, contributions may be low. Don't estimate it in code — treat it as a user input and show a prominent note to check the figure on the CNPP / pension-points statement.
- Pillar II applies to employees; Pillar III is voluntary. Model either as an ordinary invested account with its own start age for access.
- Taxes on investment gains/dividends at withdrawal: keep as a single configurable rate for now; don't hardcode current law.

---

## 5. The maths

### 5.1 Deterministic projection (annual steps, real terms)

For each year from `current_age` to `life_expectancy`:

```
if age < retirement_age:
    balance = balance × (1 + r_pre) + contribution_annual
else:
    need   = retirement_spending_annual + phase_deltas(age)
    income = state_pension(age) + other_income(age)
    draw   = max(0, need − income) / (1 − tax_on_withdrawals)
    balance = balance × (1 + r_post) − draw
balance += one_off_events(age)
record(age, balance, contributions, draws, income)
```

Use mid-year convention for flows (half a year's return on that year's contribution/draw) — note it in a docstring and test it. Allow monthly steps later if annual proves too coarse; keep the step size a parameter.

**Outputs:** per-year table, `depletion_age` (first age where balance < 0, else None), `ends_with` (balance at life_expectancy).

### 5.2 Earliest retirement age (solver)
Search integer ages from `current_age` upward; the answer is the first age where the plan passes (deterministic: never depletes; Monte Carlo: success ≥ target, default 85%). Since later retirement is monotonically safer under these assumptions, binary search is valid, but a linear scan over ~40 values is fast enough and simpler — start with linear.

Also provide the inverse: **max sustainable retirement spending** for a chosen age (binary search on spending).

### 5.3 Monte Carlo (Phase 2)
- N = 5,000 paths, seeded for reproducibility.
- Annual real returns ~ Normal(mean, volatility) as a first version. Leave a hook for historical bootstrap later.
- Output: success probability (paths not depleted before life_expectancy), percentile bands (10/25/50/75/90) per age, median depletion age among failures.
- Vectorise with numpy (paths × years); target < 200 ms per run so sliders feel live.

### 5.4 Sensitivity
For each key input, nudge it by a sensible step (±1 year age, ±1% return, ±10% spending, ±10% contribution) and report the change in success probability / depletion age. Show the top 3.

---

## 6. Getting real numbers (ingest)

Build `data/snapshot.json` containing only **derived figures**, never raw transactions:

```json
{
  "as_of": "2026-09-30",
  "base_currency": "EUR",
  "fx_ron_per_eur": 4.97,
  "balances": {"invested": 0, "cash": 0},
  "monthly_spending_12m": 0,
  "monthly_spending_by_month": [],
  "monthly_contribution_12m": 0,
  "fixed_vs_variable": {"fixed": 0, "variable": 0},
  "source": "wallet_csv | zenmoney_api | manual"
}
```

Rules the ingest must follow (these have caused wrong numbers before):
- **Exclude internal transfers.** Wallet's `isTransfer` flag only catches system-paired transfers; also exclude rows whose category is a transfer category. Combine both checks.
- **Exclude business flows from household spending.** Business accounts (SRL EUR/RON) are not household spending; money moved from business to personal counts as household income, not spending. Business taxes and accountant costs are business-side unless explicitly configured otherwise.
- **Wallet CSV exports are semicolon-delimited.**
- **Confirm time basis** of any manual figures (monthly vs annual) — show the unit next to every input in the UI.
- Print a reconciliation summary on every ingest: rows loaded per account, date range, transfers excluded (count + volume), and resulting monthly spending. Fail loudly if the date range is under 6 months.

Sources, in order of preference:
1. Wallet CSV export (works today, no auth).
2. Zenmoney or Wallet API/MCP (later; reuse whatever the bank-sync project ends up with).
3. Manual entry in the UI.

---

## 7. UI (Streamlit)

Layout, top to bottom:
1. **Headline card**: "Earliest safe retirement age: 63" + status for the chosen age (✓/✗, success %).
2. **Sliders**: retirement age, retirement spending (% of today's and absolute EUR), monthly contribution, real return, life expectancy. Advanced expander for everything else.
3. **Chart** (Plotly): balance by age; vertical line at retirement age; horizontal zero line; percentile band when Monte Carlo is on; markers for one-off events and pension start.
4. **Drivers panel**: top 3 sensitivities in plain language ("Each extra year of work adds ~6 points of success").
5. **Assumptions table**: every input, its value, and where it came from (data snapshot / default / user).
6. **Scenarios**: save/load named scenarios to `scenarios/*.yaml`; compare two side by side on the same chart (e.g. "Stay in Bucharest" vs "Move to Sibiu" with a spending phase change).

---

## 8. Phases

### Phase 1 — Engine + tests (no UI)
- `models.py`, `engine.py` deterministic projection, `solver.py`.
- Tests with hand-calculated cases:
  - zero return, zero contribution: balance falls linearly by spending; depletion age = start + balance/annual spend.
  - known compound case: 10,000 at 5% for 10 years ≈ 16,288.95.
  - pension covering all spending → never depletes.
  - one-off event applied in the correct year.
- CLI: `python -m planner.engine --config config/assumptions.yaml` prints the year table and answer.
- **Done when:** tests pass and the CLI output matches a spreadsheet check for one realistic scenario.

### Phase 2 — Monte Carlo + sensitivity
- Vectorised simulation, seeded; success probability; percentile bands; sensitivity ranking.
- Tests: volatility = 0 reproduces the deterministic result exactly; same seed → same output; success probability rises monotonically with retirement age on a fixed seed.
- **Done when:** a 5,000-path run takes < 200 ms.

### Phase 3 — UI
- Streamlit app per §7, wired to the engine. Live update on slider change.
- **Done when:** changing any slider updates headline and chart in under ~0.5 s.

### Phase 4 — Real data + scenarios
- `ingest.py` from Wallet CSV → `snapshot.json` with the reconciliation printout.
- Defaults pulled from snapshot, with source labels.
- Saved scenarios + side-by-side comparison.
- Partner mode (second person: own age, pension, retirement age; shared pot).

### Phase 5 — Nice-to-haves (only if useful)
- Historical bootstrap returns instead of Normal.
- Monthly time steps.
- Spending guardrails (cut spending by X% after a bad year) as an option.
- Export a one-page PDF summary of a scenario.
- Hook into the bank-sync pipeline so the snapshot refreshes automatically.

---

## 9. Starter prompt for Claude Code

> Read PLAN.md. Implement Phase 1 only: create the project structure in §3, the models, the deterministic engine in §5.1 and the solver in §5.2, with the tests listed under Phase 1. Use annual steps with the mid-year convention, real-terms throughout. Put every default in config/assumptions.yaml. Don't build UI or ingest yet. When done, run the tests, show me the CLI output for the default config, and stop.

Then one prompt per phase: "Implement Phase N from PLAN.md, keep all previous tests passing, then stop."

---

## 10. Open questions to settle before Phase 4

- What counts as "invested assets" vs. "cash" across the accounts — which accounts go in which bucket?
- Does business cash (SRL accounts) count toward retirement assets, and if so, at what after-tax rate when extracted?
- Realistic state pension figure (from the official statement), and for a partner if planning jointly.
- Base currency: EUR assumed — confirm.
- Target success probability: 85% default — confirm.
