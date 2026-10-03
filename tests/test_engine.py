import math

import pytest

from planner.engine import main, project
from planner.models import IncomeStream, OneOffEvent, SpendingPhase, load_inputs


# --- PLAN Phase 1 required cases -------------------------------------------------


def test_zero_return_zero_contribution_falls_linearly(make_inputs):
    # 100,000 at 1,000/mo (12,000/yr) from 65 with zero return.
    p = make_inputs(invested_assets=100_000, monthly_spending_now=1_000)
    result = project(p)
    for i, row in enumerate(result.rows):
        assert row.end_balance == pytest.approx(100_000 - 12_000 * (i + 1))
    # start + balance / annual spend = 65 + 8.33 -> money runs out during the age-73 year.
    assert result.depletion_age == 65 + math.floor(100_000 / 12_000) == 73


def test_zero_return_exact_multiple_depletes_in_following_year(make_inputs):
    # 120,000 / 12,000 = 10 years exactly: balance is 0 (not negative) at end of 74.
    p = make_inputs(invested_assets=120_000, monthly_spending_now=1_000)
    result = project(p)
    assert result.rows[9].age == 74 and result.rows[9].end_balance == pytest.approx(0)
    assert result.depletion_age == 75


def test_known_compound_case(make_inputs):
    # 10,000 at 5% for 10 years = 16,288.95.
    p = make_inputs(
        current_age=30, retirement_age=40, life_expectancy=40,
        invested_assets=10_000, real_return_pre_retirement=0.05,
    )
    result = project(p)
    assert len(result.rows) == 10
    assert result.ends_with == pytest.approx(16_288.95, abs=0.01)
    assert result.depletion_age is None


def test_pension_covering_all_spending_never_depletes(make_inputs):
    p = make_inputs(
        invested_assets=50_000, monthly_spending_now=1_500, state_pension_monthly=1_600,
        real_return_post_retirement=0.03,
    )
    result = project(p)
    assert result.depletion_age is None
    assert all(r.draw == 0 for r in result.rows)
    assert result.ends_with == pytest.approx(50_000 * 1.03 ** 30)


def test_one_off_event_applied_in_correct_year(make_inputs):
    p = make_inputs(
        current_age=40, retirement_age=60, life_expectancy=60,
        invested_assets=10_000, real_return_pre_retirement=0.05,
        one_off_events=(OneOffEvent(age=45, amount=-5_000),),
    )
    rows = {r.age: r for r in project(p).rows}
    assert [a for a, r in rows.items() if r.one_off != 0] == [45]
    # Lands at end of the age-45 year: no return on it that year, full return the next.
    assert rows[45].end_balance == pytest.approx(10_000 * 1.05 ** 6 - 5_000)
    assert rows[46].start_balance == rows[45].end_balance
    assert rows[46].end_balance == pytest.approx(rows[45].end_balance * 1.05)


# --- Mid-year convention ------------------------------------------------------------


def test_mid_year_contribution_earns_half_a_year(make_inputs):
    p = make_inputs(
        current_age=40, retirement_age=41, life_expectancy=41,
        monthly_contribution=100, real_return_pre_retirement=0.04,
    )
    assert project(p).ends_with == pytest.approx(1_200 * 1.04 ** 0.5)
    off = p.with_changes(mid_year_convention=False)
    assert project(off).ends_with == pytest.approx(1_200)


def test_mid_year_draw_forgoes_half_a_year(make_inputs):
    p = make_inputs(
        current_age=65, retirement_age=65, life_expectancy=66,
        invested_assets=10_000, monthly_spending_now=100, real_return_post_retirement=0.03,
    )
    assert project(p).ends_with == pytest.approx(10_000 * 1.03 - 1_200 * 1.03 ** 0.5)
    off = p.with_changes(mid_year_convention=False)
    assert project(off).ends_with == pytest.approx(10_000 * 1.03 - 1_200)


# --- Other mechanics ------------------------------------------------------------------


def test_accumulation_then_drawdown_uses_separate_returns(make_inputs):
    p = make_inputs(
        current_age=60, retirement_age=61, life_expectancy=62,
        invested_assets=1_000, real_return_pre_retirement=0.10, real_return_post_retirement=0.0,
        monthly_spending_now=10,
    )
    rows = project(p).rows
    assert rows[0].end_balance == pytest.approx(1_100)
    assert rows[1].end_balance == pytest.approx(1_100 - 120)


def test_tax_grosses_up_draw(make_inputs):
    p = make_inputs(invested_assets=100_000, monthly_spending_now=1_000, tax_on_withdrawals=0.2)
    assert project(p).rows[0].draw == pytest.approx(12_000 / 0.8)


def test_contribution_growth(make_inputs):
    p = make_inputs(
        current_age=30, retirement_age=33, life_expectancy=33,
        monthly_contribution=100, contribution_growth=0.10,
    )
    assert [r.contribution for r in project(p).rows] == pytest.approx([1_200, 1_320, 1_452])


def test_spending_phases_and_other_income_use_half_open_ranges(make_inputs):
    p = make_inputs(
        current_age=65, retirement_age=65, life_expectancy=72,
        invested_assets=1_000_000, monthly_spending_now=1_000,
        spending_phases=(SpendingPhase(from_age=66, to_age=68, delta_monthly=500),),
        other_income=(IncomeStream(amount_monthly=200, start_age=67, end_age=69),),
    )
    rows = {r.age: r for r in project(p).rows}
    assert [rows[a].spending_need for a in range(65, 70)] == [12_000, 18_000, 18_000, 12_000, 12_000]
    assert [rows[a].income for a in range(65, 70)] == [0, 0, 2_400, 2_400, 0]
    assert [rows[a].draw for a in range(65, 70)] == [12_000, 18_000, 15_600, 9_600, 12_000]


def test_pension_ignored_before_retirement_and_starts_at_its_age(make_inputs):
    p = make_inputs(
        current_age=60, retirement_age=62, life_expectancy=66,
        invested_assets=100_000, monthly_spending_now=1_000,
        state_pension_monthly=400, state_pension_start_age=64,
    )
    rows = {r.age: r for r in project(p).rows}
    assert [rows[a].income for a in range(60, 66)] == [0, 0, 0, 0, 4_800, 4_800]
    assert [rows[a].draw for a in range(60, 66)] == [0, 0, 12_000, 12_000, 7_200, 7_200]


def test_depleted_balance_earns_no_return(make_inputs):
    p = make_inputs(
        current_age=65, retirement_age=65, life_expectancy=68,
        invested_assets=1_000, monthly_spending_now=1_000, real_return_post_retirement=0.05,
    )
    rows = project(p).rows
    assert rows[0].end_balance < 0
    assert rows[1].growth == 0
    assert rows[1].end_balance == pytest.approx(rows[0].end_balance - 12_000)


def test_rows_cover_current_age_to_life_expectancy_exclusive(make_inputs):
    p = make_inputs(current_age=40, retirement_age=65, life_expectancy=95)
    ages = [r.age for r in project(p).rows]
    assert ages[0] == 40 and ages[-1] == 94 and len(ages) == 55


def test_validation(make_inputs):
    with pytest.raises(ValueError):
        make_inputs(current_age=70, life_expectancy=70)
    with pytest.raises(ValueError):
        make_inputs(current_age=50, retirement_age=45)
    with pytest.raises(ValueError):
        make_inputs(tax_on_withdrawals=1.0)
    with pytest.raises(NotImplementedError):
        make_inputs(steps_per_year=12)


# --- Default config & CLI -----------------------------------------------------------


def test_default_config_loads_and_runs():
    p = load_inputs("config/assumptions.yaml")
    result = project(p)
    assert result.rows[0].age == p.current_age
    assert result.rows[-1].age == p.life_expectancy - 1


def test_cli_runs(capsys):
    assert main(["--config", "config/assumptions.yaml"]) == 0
    out = capsys.readouterr().out
    assert "earliest safe retirement age" in out or "no retirement age" in out


def test_cli_csv(capsys):
    assert main(["--config", "config/assumptions.yaml", "--csv"]) == 0
    lines = capsys.readouterr().out.strip().splitlines()
    assert lines[0].startswith("age,retired,start_balance")


def test_realistic_scenario_matches_closed_form(make_inputs):
    # Independent spreadsheet-style check: level contributions/draws at mid-year are
    # annuities, so balances at retirement and at the end have closed forms.
    rp, rq = 0.04, 0.03
    p = make_inputs(
        current_age=40, retirement_age=65, life_expectancy=95,
        invested_assets=150_000, cash_assets=20_000,
        monthly_contribution=1_000, monthly_spending_now=2_500,
        real_return_pre_retirement=rp, real_return_post_retirement=rq,
    )
    at_65 = 170_000 * (1 + rp) ** 25 + 12_000 * (1 + rp) ** 0.5 * ((1 + rp) ** 25 - 1) / rp
    at_95 = at_65 * (1 + rq) ** 30 - 30_000 * (1 + rq) ** 0.5 * ((1 + rq) ** 30 - 1) / rq
    rows = {r.age: r for r in project(p).rows}
    assert rows[64].end_balance == pytest.approx(at_65, abs=0.01)
    assert project(p).ends_with == pytest.approx(at_95, abs=0.01)
