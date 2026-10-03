"""Dataclasses for planner inputs and outputs, plus the YAML config loader.

All money is in today's EUR (real terms). Fields ending in ``_monthly`` are
EUR per month; everything else is a lump sum or an annual rate (decimal).
Age ranges are half-open: ``start_age`` is included, ``end_age`` is not.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class IncomeStream:
    """Recurring income (e.g. part-time work) received in ages [start_age, end_age)."""

    amount_monthly: float
    start_age: int
    end_age: int


@dataclass(frozen=True)
class OneOffEvent:
    """Lump sum added (+) or removed (−) at the end of the year at ``age``."""

    age: int
    amount: float


@dataclass(frozen=True)
class SpendingPhase:
    """Change to retirement spending during ages [from_age, to_age)."""

    from_age: int
    to_age: int
    delta_monthly: float


@dataclass(frozen=True)
class PlanInputs:
    # Person & timeline
    current_age: int
    retirement_age: int
    life_expectancy: int
    # Money today
    invested_assets: float
    cash_assets: float
    monthly_spending_now: float
    monthly_contribution: float
    # Assumptions
    real_return_pre_retirement: float
    real_return_post_retirement: float
    retirement_spending_ratio: float
    contribution_growth: float
    state_pension_monthly: float
    state_pension_start_age: int
    tax_on_withdrawals: float
    return_volatility: float
    inflation: float
    fx_ron_per_eur: float
    other_income: tuple[IncomeStream, ...] = ()
    one_off_events: tuple[OneOffEvent, ...] = ()
    spending_phases: tuple[SpendingPhase, ...] = ()
    # Simulation
    steps_per_year: int = 1
    mid_year_convention: bool = True
    # Solver
    max_retirement_age: int = 75
    target_success_probability: float = 0.85
    spending_tolerance_monthly: float = 1.0

    def __post_init__(self) -> None:
        if self.life_expectancy <= self.current_age:
            raise ValueError("life_expectancy must be greater than current_age")
        if self.retirement_age < self.current_age:
            raise ValueError("retirement_age cannot be below current_age")
        if not 0 <= self.tax_on_withdrawals < 1:
            raise ValueError("tax_on_withdrawals must be in [0, 1)")
        if self.retirement_spending_ratio < 0:
            raise ValueError("retirement_spending_ratio cannot be negative")
        if self.steps_per_year != 1:
            raise NotImplementedError("only annual steps (steps_per_year: 1) are implemented")
        for r in (self.real_return_pre_retirement, self.real_return_post_retirement):
            if r <= -1:
                raise ValueError("returns must be greater than -100%")

    @property
    def starting_balance(self) -> float:
        return self.invested_assets + self.cash_assets

    @property
    def retirement_spending_monthly(self) -> float:
        return self.monthly_spending_now * self.retirement_spending_ratio

    def with_changes(self, **changes: Any) -> "PlanInputs":
        return replace(self, **changes)


@dataclass(frozen=True)
class YearRow:
    """One year of the projection. ``end_balance`` is the balance on reaching ``age + 1``."""

    age: int
    retired: bool
    start_balance: float
    contribution: float
    spending_need: float
    income: float
    draw: float
    growth: float
    one_off: float
    end_balance: float


@dataclass(frozen=True)
class ProjectionResult:
    rows: tuple[YearRow, ...]
    depletion_age: int | None
    ends_with: float

    @property
    def succeeds(self) -> bool:
        return self.depletion_age is None


def _section(raw: dict[str, Any], name: str) -> dict[str, Any]:
    section = raw.get(name) or {}
    if not isinstance(section, dict):
        raise ValueError(f"config section '{name}' must be a mapping")
    return section


def inputs_from_dict(raw: dict[str, Any]) -> PlanInputs:
    """Build PlanInputs from the nested structure of config/assumptions.yaml."""
    person = _section(raw, "person")
    money = _section(raw, "money")
    assumptions = dict(_section(raw, "assumptions"))
    simulation = _section(raw, "simulation")
    solver = _section(raw, "solver")

    other_income = tuple(IncomeStream(**x) for x in assumptions.pop("other_income", None) or [])
    one_off_events = tuple(OneOffEvent(**x) for x in assumptions.pop("one_off_events", None) or [])
    spending_phases = tuple(SpendingPhase(**x) for x in assumptions.pop("spending_phases", None) or [])

    return PlanInputs(
        **person,
        **money,
        **assumptions,
        **simulation,
        **solver,
        other_income=other_income,
        one_off_events=one_off_events,
        spending_phases=spending_phases,
    )


def load_inputs(path: str | Path) -> PlanInputs:
    import yaml

    with open(path, encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    return inputs_from_dict(raw)
