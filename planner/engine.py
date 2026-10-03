"""Deterministic retirement projection (PLAN.md §5.1).

Pure maths, no I/O except the CLI under ``main()``.

Model
-----
Annual steps, real terms (today's EUR). The year at ``age`` runs from that
birthday to the next. Years are simulated for ages ``current_age`` up to
``life_expectancy - 1``, so ``ends_with`` is the balance on reaching
``life_expectancy``.

For each year, with ``B`` the balance at the start of the year::

    if age < retirement_age:
        end = B × (1 + r_pre)  + contribution × m(r_pre)
    else:
        need   = retirement_spending + spending phase deltas
        income = state pension + other income
        draw   = max(0, need − income) / (1 − tax_on_withdrawals)
        end    = B × (1 + r_post) − draw × m(r_post)
    end += one-off events at this age

Mid-year convention: a year's contribution or draw is treated as happening
halfway through the year, so it earns (or forgoes) half a year's return:
``m(r) = (1 + r) ** 0.5``. With the convention off, ``m(r) = 1`` (flows at
year end).

Other choices:
* Pension and other income only offset retirement spending. Before
  ``retirement_age`` they are ignored (as in the plan's formula), and
  income above spending is not added back to the pot.
* One-off events land at the end of the year, after returns.
* Once the balance is below zero it earns no return. It goes on
  accumulating the shortfall so the table shows how big the gap is.
* ``depletion_age`` is the first age whose end-of-year balance is below
  zero, i.e. the year in which the money runs out.
"""

from __future__ import annotations

import argparse
import sys

from planner.models import PlanInputs, ProjectionResult, YearRow


def flow_factor(rate: float, mid_year: bool) -> float:
    """Return growth multiplier for a flow made during the year."""
    return (1 + rate) ** 0.5 if mid_year else 1.0


def contribution_annual(p: PlanInputs, age: int) -> float:
    years = age - p.current_age
    return p.monthly_contribution * 12 * (1 + p.contribution_growth) ** years


def phase_delta_annual(p: PlanInputs, age: int) -> float:
    return sum(ph.delta_monthly * 12 for ph in p.spending_phases if ph.from_age <= age < ph.to_age)


def income_annual(p: PlanInputs, age: int) -> float:
    pension = p.state_pension_monthly * 12 if age >= p.state_pension_start_age else 0.0
    other = sum(s.amount_monthly * 12 for s in p.other_income if s.start_age <= age < s.end_age)
    return pension + other


def one_off_total(p: PlanInputs, age: int) -> float:
    return sum(e.amount for e in p.one_off_events if e.age == age)


def project(p: PlanInputs) -> ProjectionResult:
    """Run the deterministic projection and return the per-year table."""
    balance = p.starting_balance
    rows: list[YearRow] = []
    depletion_age: int | None = None

    for age in range(p.current_age, p.life_expectancy):
        start = balance
        retired = age >= p.retirement_age
        rate = p.real_return_post_retirement if retired else p.real_return_pre_retirement
        if start < 0:
            rate = 0.0  # a depleted pot earns nothing
        m = flow_factor(rate, p.mid_year_convention)

        contribution = need = income = draw = 0.0
        if retired:
            need = p.retirement_spending_monthly * 12 + phase_delta_annual(p, age)
            income = income_annual(p, age)
            draw = max(0.0, need - income) / (1 - p.tax_on_withdrawals)
            flow = -draw
        else:
            contribution = contribution_annual(p, age)
            flow = contribution

        growth = start * rate + flow * (m - 1)
        one_off = one_off_total(p, age)
        balance = start + growth + flow + one_off

        rows.append(
            YearRow(
                age=age,
                retired=retired,
                start_balance=start,
                contribution=contribution,
                spending_need=need,
                income=income,
                draw=draw,
                growth=growth,
                one_off=one_off,
                end_balance=balance,
            )
        )
        if depletion_age is None and balance < 0:
            depletion_age = age

    return ProjectionResult(rows=tuple(rows), depletion_age=depletion_age, ends_with=balance)


# --------------------------------------------------------------------------- CLI


def _eur(x: float) -> str:
    return f"{x:,.0f}"


def format_table(result: ProjectionResult, retirement_age: int) -> str:
    header = (
        f"{'age':>4} {'phase':<7} {'start':>12} {'contrib':>10} {'need':>10} "
        f"{'income':>10} {'draw':>10} {'growth':>10} {'one-off':>10} {'end':>12}"
    )
    lines = [header, "-" * len(header)]
    for r in result.rows:
        phase = "retired" if r.retired else "working"
        marker = " <- retire" if r.age == retirement_age else ""
        lines.append(
            f"{r.age:>4} {phase:<7} {_eur(r.start_balance):>12} {_eur(r.contribution):>10} "
            f"{_eur(r.spending_need):>10} {_eur(r.income):>10} {_eur(r.draw):>10} "
            f"{_eur(r.growth):>10} {_eur(r.one_off):>10} {_eur(r.end_balance):>12}{marker}"
        )
    return "\n".join(lines)


def format_csv(result: ProjectionResult) -> str:
    cols = ["age", "retired", "start_balance", "contribution", "spending_need",
            "income", "draw", "growth", "one_off", "end_balance"]
    lines = [",".join(cols)]
    for r in result.rows:
        lines.append(",".join(
            str(getattr(r, c)) if c in ("age", "retired") else f"{getattr(r, c):.2f}" for c in cols
        ))
    return "\n".join(lines)


def headline(p: PlanInputs, result: ProjectionResult, earliest: int | None) -> str:
    if earliest is None:
        earliest_text = f"no retirement age up to {p.max_retirement_age} works"
    else:
        earliest_text = f"earliest safe retirement age is {earliest}"
    if result.succeeds:
        return (f"Money lasts to age {p.life_expectancy} ✓ "
                f"(ends with €{_eur(result.ends_with)}) — {earliest_text}.")
    return f"Runs out at age {result.depletion_age} ✗ — {earliest_text}."


def main(argv: list[str] | None = None) -> int:
    from planner.models import load_inputs
    from planner.solver import earliest_retirement_age, max_sustainable_spending

    parser = argparse.ArgumentParser(description="Deterministic retirement projection (real EUR).")
    parser.add_argument("--config", default="config/assumptions.yaml", help="path to assumptions YAML")
    parser.add_argument("--csv", action="store_true", help="print the year table as CSV (for spreadsheet checks)")
    args = parser.parse_args(argv)

    p = load_inputs(args.config)
    result = project(p)

    if args.csv:
        print(format_csv(result))
        return 0

    earliest = earliest_retirement_age(p)
    max_spend = max_sustainable_spending(p)

    print("Retirement projection — today's EUR, real terms, annual steps, "
          f"mid-year convention {'on' if p.mid_year_convention else 'off'}")
    print(f"Age {p.current_age}, retire at {p.retirement_age}, plan to {p.life_expectancy}. "
          f"Start balance €{_eur(p.starting_balance)}; contributions €{_eur(p.monthly_contribution)}/mo; "
          f"retirement spending €{_eur(p.retirement_spending_monthly)}/mo; "
          f"returns {p.real_return_pre_retirement:.1%} pre / {p.real_return_post_retirement:.1%} post; "
          f"state pension €{_eur(p.state_pension_monthly)}/mo from {p.state_pension_start_age}.")
    print()
    print(format_table(result, p.retirement_age))
    print()
    print(headline(p, result, earliest))
    if max_spend is None:
        print(f"Max sustainable spending retiring at {p.retirement_age}: none (fails even at €0/mo).")
    else:
        print(f"Max sustainable spending retiring at {p.retirement_age}: €{_eur(max_spend)}/mo.")
    if p.state_pension_monthly == 0:
        print("Note: state pension is 0 — enter your figure from the CNPP pension-points statement.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
