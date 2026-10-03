"""Solvers over the deterministic projection (PLAN.md §5.2).

* ``earliest_retirement_age``: the first integer age, from ``current_age`` up to
  ``max_retirement_age``, at which the plan never depletes.
* ``max_sustainable_spending``: the highest monthly retirement spending that
  never depletes for a chosen retirement age, found by binary search.

Phase 2 adds the Monte Carlo pass criterion (success ≥ target). For now a plan
passes when the deterministic projection never depletes.
"""

from __future__ import annotations

from planner.engine import project
from planner.models import PlanInputs

_SPENDING_CAP_MONTHLY = 1e8


def passes(p: PlanInputs) -> bool:
    return project(p).succeeds


def earliest_retirement_age(p: PlanInputs) -> int | None:
    """Linear scan over retirement ages; None if no age up to the max passes."""
    for age in range(p.current_age, p.max_retirement_age + 1):
        if passes(p.with_changes(retirement_age=age)):
            return age
    return None


def _with_retirement_spending(p: PlanInputs, monthly: float) -> PlanInputs:
    # monthly_spending_now only feeds retirement spending in the engine, so
    # setting it with a ratio of 1 fixes retirement spending at `monthly`.
    return p.with_changes(monthly_spending_now=monthly, retirement_spending_ratio=1.0)


def max_sustainable_spending(p: PlanInputs, retirement_age: int | None = None) -> float | None:
    """Highest base monthly retirement spending (before phase deltas) that never depletes.

    Returns None when the plan fails even at zero spending (e.g. a large
    negative one-off event). The result is within ``spending_tolerance_monthly``
    below the true maximum.
    """
    if retirement_age is not None:
        p = p.with_changes(retirement_age=retirement_age)
    if not passes(_with_retirement_spending(p, 0.0)):
        return None

    lo, hi = 0.0, 1000.0
    while passes(_with_retirement_spending(p, hi)):
        lo, hi = hi, hi * 2
        if hi > _SPENDING_CAP_MONTHLY:
            return lo  # effectively unlimited (e.g. pension covers any spending)

    while hi - lo > p.spending_tolerance_monthly:
        mid = (lo + hi) / 2
        if passes(_with_retirement_spending(p, mid)):
            lo = mid
        else:
            hi = mid
    return lo
