# Retirement planner

"When can I retire?" calculator in today's EUR. See [PLAN.md](PLAN.md).

Phase 1 is done: the deterministic engine, the solvers and a CLI.

```
pip install -e '.[dev]'
python -m pytest
python -m planner.engine --config config/assumptions.yaml        # table + answer
python -m planner.engine --config config/assumptions.yaml --csv  # for spreadsheet checks
```

Every default lives in `config/assumptions.yaml`. The `money` section and
`current_age` are placeholders until ingest (Phase 4) fills them.
