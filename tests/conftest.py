import pytest

from planner.models import PlanInputs


def _make(**overrides) -> PlanInputs:
    """Neutral inputs: zero returns, no contributions, no pension, no tax."""
    base = dict(
        current_age=65,
        retirement_age=65,
        life_expectancy=95,
        invested_assets=0.0,
        cash_assets=0.0,
        monthly_spending_now=0.0,
        monthly_contribution=0.0,
        real_return_pre_retirement=0.0,
        real_return_post_retirement=0.0,
        retirement_spending_ratio=1.0,
        contribution_growth=0.0,
        state_pension_monthly=0.0,
        state_pension_start_age=65,
        tax_on_withdrawals=0.0,
        return_volatility=0.12,
        inflation=0.03,
        fx_ron_per_eur=4.97,
    )
    base.update(overrides)
    return PlanInputs(**base)


@pytest.fixture
def make_inputs():
    return _make
