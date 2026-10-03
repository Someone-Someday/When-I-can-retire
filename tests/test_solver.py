import pytest

from planner.engine import project
from planner.models import load_inputs
from planner.solver import earliest_retirement_age, max_sustainable_spending


def test_earliest_retirement_age_hand_case(make_inputs):
    # Zero return, save 12k/yr while working, spend 12k/yr in retirement, plan to 70.
    # Retiring at R: saved 12k*(R-60), need 12k*(70-R)  ->  passes when R >= 65.
    p = make_inputs(
        current_age=60, retirement_age=60, life_expectancy=70,
        monthly_contribution=1_000, monthly_spending_now=1_000,
    )
    assert earliest_retirement_age(p) == 65
    assert project(p.with_changes(retirement_age=64)).depletion_age is not None
    assert project(p.with_changes(retirement_age=65)).depletion_age is None


def test_earliest_is_current_age_when_already_funded(make_inputs):
    p = make_inputs(current_age=50, invested_assets=10_000_000, monthly_spending_now=1_000)
    assert earliest_retirement_age(p) == 50


def test_earliest_none_when_no_age_up_to_max_works(make_inputs):
    p = make_inputs(
        current_age=60, life_expectancy=95, monthly_spending_now=5_000,
        monthly_contribution=10, max_retirement_age=75,
    )
    assert earliest_retirement_age(p) is None


def test_later_retirement_is_monotonically_safer_on_default_config():
    p = load_inputs("config/assumptions.yaml")
    results = [project(p.with_changes(retirement_age=a)).succeeds
               for a in range(p.current_age, p.max_retirement_age + 1)]
    # Once it passes it keeps passing.
    first = results.index(True) if True in results else len(results)
    assert all(results[first:])
    assert earliest_retirement_age(p) == (p.current_age + first if True in results else None)


def test_max_sustainable_spending_hand_case(make_inputs):
    # Zero return, 300k over 30 years -> 10k/yr = 833.33/mo.
    p = make_inputs(invested_assets=300_000)
    spend = max_sustainable_spending(p)
    assert 833.33 - p.spending_tolerance_monthly <= spend <= 833.34
    assert project(p.with_changes(monthly_spending_now=spend)).succeeds


def test_max_sustainable_spending_with_return_matches_annuity(make_inputs):
    # Mid-year draws D*sqrt(1+r) each year: B*(1+r)^n = D*sqrt(1+r)*((1+r)^n - 1)/r
    r, n, b = 0.03, 30, 500_000
    p = make_inputs(invested_assets=b, real_return_post_retirement=r)
    annual = b * (1 + r) ** n * r / ((1 + r) ** 0.5 * ((1 + r) ** n - 1))
    assert max_sustainable_spending(p) == pytest.approx(annual / 12, abs=p.spending_tolerance_monthly)


def test_max_sustainable_spending_respects_retirement_age_argument(make_inputs):
    p = make_inputs(
        current_age=60, retirement_age=60, life_expectancy=70, monthly_contribution=1_000,
    )
    # Retire at 65: 60k saved, 5 years -> 1,000/mo.
    assert max_sustainable_spending(p, retirement_age=65) == pytest.approx(1_000, abs=1.0)


def test_max_sustainable_spending_none_when_failing_at_zero(make_inputs):
    from planner.models import OneOffEvent

    p = make_inputs(invested_assets=1_000, one_off_events=(OneOffEvent(age=70, amount=-5_000),))
    assert max_sustainable_spending(p) is None
