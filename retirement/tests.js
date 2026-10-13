/* Engine tests. Open tests.html; results render in the page and on window.__testResults. */
(function () {
  'use strict';
  const E = window.RetEngine;
  const results = [];
  const test = (name, fn) => {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: String(e.message || e) }); }
  };
  const near = (a, b, tol, msg) => {
    if (Math.abs(a - b) > (tol == null ? 1e-6 : tol)) throw new Error((msg || 'expected') + ' ' + b + ', got ' + a);
  };
  const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

  function basePlan(over) {
    const plan = {
      country: 'RO', currency: 'RON', fx: 5.1, endAge: 95, startYear: 2026,
      people: [
        { name: 'A', age: 35, salary: 12000, savings: 2500, stopAge: 55, yearsContributed: 12, pointsSoFar: null, claimAge: 65, pensionOverride: null, p2Balance: 60000, p3Balance: 10000, p3Contribution: 170, p3UnlockAge: 60 },
        { name: 'B', age: 33, salary: 9000, savings: 1500, stopAge: 53, yearsContributed: 10, pointsSoFar: null, claimAge: 65, pensionOverride: null, p2Balance: 40000, p3Balance: 0, p3Contribution: 0, p3UnlockAge: 60 }
      ],
      liquid: 300000,
      spending: { monthly: 9000, otherIncome: 0, slowAfter75Pct: 15, flexible: false, flexCutPct: 10 },
      market: { stockPct: 70, stockReturn: 5, stockVol: 16, bondReturn: 1, bondVol: 6, feePct: 0.3, taxDragPct: 0.3, pensionFundStockPct: 30, pensionFundFeePct: 0.5 },
      pension: { replacementPct: 0, fullCareer: 35, pillar2Pct: 4.75, haircutPct: 0 }
    };
    return Object.assign(plan, over || {});
  }
  // A plan with no randomness and no growth, for exact arithmetic
  function flatPlan(over) {
    const p = basePlan({
      market: { stockPct: 50, stockReturn: 0, stockVol: 0, bondReturn: 0, bondVol: 0, feePct: 0, taxDragPct: 0, pensionFundStockPct: 30, pensionFundFeePct: 0 },
      pension: { replacementPct: 0, fullCareer: 35, pillar2Pct: 0, haircutPct: 0 },
      spending: { monthly: 1000, otherIncome: 0, slowAfter75Pct: 0, flexible: false, flexCutPct: 0 }
    });
    p.people = p.people.map(x => Object.assign({}, x, { age: 60, stopAge: 60, salary: 0, savings: 0, yearsContributed: 0, p2Balance: 0, p3Balance: 0, p3Contribution: 0 }));
    p.endAge = 90;
    return Object.assign(p, over || {});
  }

  /* --- Romanian pension formula --- */
  test('stability points: none up to 25 years', () => near(E.roStabilityPoints(25), 0));
  test('stability points: 30 years = 2.5', () => near(E.roStabilityPoints(30), 2.5));
  test('stability points: 35 years = 6.25', () => near(E.roStabilityPoints(35), 6.25));
  test('stability points: 40 years = 11.25', () => near(E.roStabilityPoints(40), 11.25));
  test('net pension: untouched at 3,000 lei', () => near(E.roNetPension(3000), 3000));
  test('net pension: 5,000 gross = 4,620 net', () => near(E.roNetPension(5000), 4620));
  test('average earner, 35 years: 41.25 points x 81 lei', () => {
    const d = E.roPension({ salaryRON: E.RO.avgGross, yearsSoFar: 10, futureYears: 25, claimAge: 65, stdAge: 65 });
    near(d.points, 35); near(d.stability, 6.25); near(d.grossRON, 3341.25);
    near(d.netRON, 3341.25 - 34.125 - 30.7125, 1e-6);
  });
  test('under 15 contribution years: no pension', () => {
    const d = E.roPension({ salaryRON: 9192, yearsSoFar: 5, futureYears: 9, claimAge: 65, stdAge: 65 });
    ok(!d.eligible); near(d.grossRON, 0);
  });
  test('early claim penalty: 5 years = 24%, 2 years = 9.6%, capped', () => {
    near(E.roEarlyPenalty(60, 65), 0.24); near(E.roEarlyPenalty(63, 65), 0.096);
    near(E.roEarlyPenalty(55, 65), 0.24); near(E.roEarlyPenalty(66, 65), 0);
  });
  test('points from official statement override the estimate', () => {
    const d = E.roPension({ salaryRON: 9192, yearsSoFar: 10, futureYears: 10, pointsSoFar: 25, claimAge: 65, stdAge: 65 });
    near(d.points, 35);
  });
  test('stopping work earlier lowers the state pension', () => {
    const p = basePlan();
    const late = E.statePension(p, p.people[0]).monthly;
    const early = E.statePension(p, Object.assign({}, p.people[0], { stopAge: 45 })).monthly;
    ok(early < late, early + ' should be < ' + late);
  });
  test('EUR plan: pension equals the RON pension / fx', () => {
    const ron = basePlan();
    const eur = basePlan({ currency: 'EUR' });
    eur.people = eur.people.map(x => Object.assign({}, x, { salary: x.salary / 5.1 }));
    near(E.statePension(eur, eur.people[0]).monthly, E.statePension(ron, ron.people[0]).monthly / 5.1, 1e-6);
  });
  test('manual override and haircut', () => {
    const p = basePlan(); p.pension.haircutPct = 20;
    const s = E.statePension(p, Object.assign({}, p.people[0], { pensionOverride: 4000 }));
    near(s.monthly, 3200); ok(s.source === 'override');
  });
  test('replacement-rate preset scales with career length', () => {
    const p = basePlan({ country: 'DE', currency: 'EUR', pension: { replacementPct: 44, fullCareer: 45, pillar2Pct: 0, haircutPct: 0 } });
    const person = Object.assign({}, p.people[0], { salary: 5000, age: 40, stopAge: 67, claimAge: 67, yearsContributed: 18 });
    near(E.statePension(p, person).monthly, 5000 * 0.44, 1e-9);
    near(E.statePension(p, Object.assign({}, person, { stopAge: 49 })).monthly, 5000 * 0.44 * 27 / 45, 1e-9);
  });
  test('manual country without an entered pension gives zero', () => {
    const p = basePlan({ country: 'MANUAL', currency: 'EUR' });
    const s = E.statePension(p, p.people[0]);
    near(s.monthly, 0); ok(s.source === 'missing');
  });


  /* --- How you earn: CAS base, points and the spec's reference cases --- */
  // A person who contributes for `years` years (default 35) up to the pension age of 65
  const refPension = (earn, years) => {
    const p = basePlan();
    const person = Object.assign({}, p.people[0], { age: 65 - (years == null ? 35 : years), stopAge: 65, claimAge: 65, yearsContributed: 0, salary: 0 }, earn);
    return E.statePension(p, person);
  };
  test('reference: employee on 10,000 lei gross, 35 years = about 3,478 lei net', () =>
    near(refPension({ earnType: 'employee', salary: 10000 }).monthly, 3478, 1));
  test('reference: PFA on 12 minimum salaries, 35 years = about 1,755 lei', () =>
    near(refPension({ earnType: 'pfa', pfaIncome: 60000 }).monthly, 1755, 1));
  test('reference: PFA on 24 minimum salaries, 35 years = about 3,004 lei', () =>
    near(refPension({ earnType: 'pfa', pfaIncome: 200000 }).monthly, 3004, 1));
  test('reference: dividends only = 0, even with past years entered', () => {
    near(refPension({ earnType: 'dividends' }).monthly, 0);
    near(refPension({ earnType: 'dividends', age: 50, yearsContributed: 20 }).monthly, 0);
  });
  test('reference: any type with 14 years = 0', () => {
    near(refPension({ earnType: 'employee', salary: 10000 }, 14).monthly, 0);
    near(refPension({ earnType: 'pfa', pfaIncome: 200000 }, 14).monthly, 0);
    ok(refPension({ earnType: 'employee', salary: 10000 }, 15).monthly > 0, '15 years qualifies');
  });
  test('PFA CAS base: automatic thresholds and overrides', () => {
    const min12 = 12 * 4050, c = o => E.roContribution(Object.assign({ earnType: 'pfa' }, o)).baseYearly;
    near(c({ pfaIncomeRON: min12 - 1 }), 0); near(c({ pfaIncomeRON: min12 }), min12);
    near(c({ pfaIncomeRON: 2 * min12 - 1 }), min12); near(c({ pfaIncomeRON: 2 * min12 }), 2 * min12);
    near(c({ pfaIncomeRON: 500000, casMode: 'none' }), 0); near(c({ pfaIncomeRON: 10000, casMode: '24' }), 2 * min12);
    near(c({ pfaIncomeRON: 10000, casMode: 'custom', casCustomRON: 1000 }), min12);
    near(c({ pfaIncomeRON: 10000, casMode: 'custom', casCustomRON: 150000 }), 150000);
    near(E.roContribution({ earnType: 'pfa', pfaIncomeRON: 60000 }).ppy, 4050 / 9192, 1e-9);
  });
  test('voluntary contract: base floored at one minimum salary, zero allowed', () => {
    near(E.roContribution({ earnType: 'voluntary', volBaseRON: 2000 }).baseYearly, 48600);
    near(E.roContribution({ earnType: 'voluntary', volBaseRON: 6000 }).ppy, 6000 / 9192, 1e-9);
    near(E.roContribution({ earnType: 'voluntary', volBaseRON: 0 }).ppy, 0);
  });
  test('past points from the statement count even if nothing is paid now', () => {
    const s = refPension({ earnType: 'dividends', age: 50, yearsContributed: 20, pointsSoFar: 30 });
    near(s.detail.grossRON, 30 * 81); ok(s.detail.years === 20, 'no future years counted');
  });
  test('social minimum pension is the floor once eligible', () => {
    const s = refPension({ earnType: 'voluntary', volBase: 4050 }, 15);
    near(s.detail.grossRON, 1281); near(s.monthly, 1281);
  });
  test('contributions stop at the pension age even if work continues', () => {
    const a = refPension({ earnType: 'employee', salary: 10000 });
    const b = refPension({ earnType: 'employee', salary: 10000, stopAge: 70 });
    near(a.monthly, b.monthly);
  });
  test('editable parameters: point value and average salary feed the formula', () => {
    const p = basePlan(); p.ro = { vpr: 100, avgGross: 10000 };
    const s = E.statePension(p, Object.assign({}, p.people[0], { age: 30, stopAge: 65, yearsContributed: 0, salary: 10000 }));
    near(s.detail.grossRON, 41.25 * 100);
  });
  test('Pillar II: only employees contribute; an existing balance stays', () => {
    const p = flatPlan({ liquid: 0 }); p.pension.pillar2Pct = 4.75; p.endAge = 60;
    const mk = earn => Object.assign({}, p.people[0], { age: 40, stopAge: 50, salary: 10000, pfaIncome: 200000, volBase: 5000, p2Balance: 1000 }, earn);
    p.people = [mk({ earnType: 'employee' }), mk({ earnType: 'pfa' })];
    near(E.simulate(p, { runs: 2 }).rows[10].p2, 2000 + 10 * 10000 * 12 * 0.0475);
    p.people = [mk({ earnType: 'dividends' }), mk({ earnType: 'voluntary' })];
    near(E.simulate(p, { runs: 2 }).rows[10].p2, 2000);
  });
  test('a single person plan runs', () => {
    const p = basePlan(); p.people = [p.people[0]];
    const r = E.simulate(p, { runs: 200 });
    ok(r.pensions.length === 1 && r.successRate >= 0 && r.T === 60);
    ok(E.solveEarliest(p, 0.9, { runs: 200 }).curve.length > 0);
  });

  /* --- Simulation --- */
  test('zero-return plan: 120k lasts exactly 10 years at 1,000/month', () => {
    const r = E.simulate(flatPlan({ liquid: 120000 }), { runs: 5 });
    near(r.successRate, 0);
    near(r.rows[9].fromLiquid, 12000); near(r.rows[9].shortfall, 0);
    near(r.rows[10].shortfall, 12000); ok(r.typicalFail.t === 10, 'fails in year 10');
    near(r.bands.p50[10], 0);
  });
  test('zero-return plan: 360k covers 30 years exactly', () => {
    near(E.simulate(flatPlan({ liquid: 360000 }), { runs: 5 }).successRate, 1);
  });
  test('other income reduces withdrawals', () => {
    const p = flatPlan({ liquid: 120000 }); p.spending.otherIncome = 600;
    const r = E.simulate(p, { runs: 3 });
    near(r.rows[0].fromLiquid, 4800); near(r.successRate, 0);
    ok(r.typicalFail.t === 25, 'runs out in year 25, got ' + r.typicalFail.t);
  });
  test('slower spending after 75 applies', () => {
    const p = flatPlan({ liquid: 1e6 }); p.spending.slowAfter75Pct = 20;
    const r = E.simulate(p, { runs: 2 });
    near(r.rows[14].target, 12000); near(r.rows[15].target, 9600);
  });
  test('locked Pillar III: bridge failure although total wealth is ample', () => {
    const p = flatPlan({ liquid: 24000 });
    p.people = p.people.map(x => Object.assign({}, x, { age: 50, stopAge: 50, p3Balance: 500000, p3UnlockAge: 60 }));
    const r = E.simulate(p, { runs: 10 });
    near(r.successRate, 0); near(r.bridgeFailRate, 1); near(r.depletionFailRate, 0);
    ok(r.typicalFail.t === 2 && r.typicalFail.type === 'bridge');
    ok(r.bridge.years === 10 && r.bridge.shortfall > 0, 'bridge summary');
  });
  test('Pillar III is drawn once unlocked, after liquid is used up', () => {
    const p = flatPlan({ liquid: 120000 });
    p.people[0] = Object.assign({}, p.people[0], { age: 50, stopAge: 50, p3Balance: 600000, p3UnlockAge: 60 });
    p.people[1] = Object.assign({}, p.people[1], { age: 50, stopAge: 50 });
    p.endAge = 90;
    const r = E.simulate(p, { runs: 3 });
    near(r.successRate, 1); near(r.rows[9].fromLiquid, 12000); near(r.rows[10].fromP3, 12000);
  });
  test('state pension starts at claim age and Pillar II unlocks with it', () => {
    const p = flatPlan({ liquid: 60000 });
    p.people[0] = Object.assign({}, p.people[0], { claimAge: 65, pensionOverride: 400, p2Balance: 300000 });
    p.people[1] = Object.assign({}, p.people[1], { claimAge: 65 });
    const r = E.simulate(p, { runs: 3 });
    near(r.rows[4].pension, 0); near(r.rows[5].pension, 4800);
    near(r.rows[5].fromP2, 7200); near(r.successRate, 1);
  });
  test('working years: savings and Pillar II contributions accumulate', () => {
    const p = flatPlan({ liquid: 0 });
    p.pension.pillar2Pct = 5;
    p.people[0] = Object.assign({}, p.people[0], { age: 40, stopAge: 50, salary: 10000, savings: 1000 });
    p.people[1] = Object.assign({}, p.people[1], { age: 40, stopAge: 45 });
    p.endAge = 60;
    const r = E.simulate(p, { runs: 2 });
    near(r.rows[10].liquid, 120000); near(r.rows[10].p2, 60000);
    ok(r.rows[9].phase === 'working' && r.rows[10].phase === 'retired', 'retired only when both stopped');
  });
  test('flexible spending cuts the year after a negative return', () => {
    const p = flatPlan({ liquid: 1e6 });
    p.market.feePct = 1; p.spending.flexible = true; p.spending.flexCutPct = 10;
    const r = E.simulate(p, { runs: 2 });
    near(r.rows[0].target, 12000); near(r.rows[1].target, 10800);
  });
  test('same seed gives identical results; different seed differs', () => {
    const a = E.simulate(basePlan(), { runs: 300, seed: 7 });
    const b = E.simulate(basePlan(), { runs: 300, seed: 7 });
    const c = E.simulate(basePlan(), { runs: 300, seed: 8 });
    near(a.successRate, b.successRate); near(a.bands.p50[30], b.bands.p50[30]);
    ok(a.bands.p50[30] !== c.bands.p50[30], 'seeds should differ');
  });
  test('percentile bands are ordered and start at today\'s wealth', () => {
    const r = E.simulate(basePlan(), { runs: 500 });
    near(r.bands.p50[0], 410000);
    for (let t = 0; t <= r.T; t++) ok(r.bands.p10[t] <= r.bands.p50[t] + 1e-6 && r.bands.p50[t] <= r.bands.p90[t] + 1e-6, 'order at ' + t);
    ok(r.T === 62, 'horizon to age 95 of the younger partner');
  });
  test('success rates add up and move the right way', () => {
    const base = E.simulate(basePlan(), { runs: 500 });
    near(base.successRate + base.bridgeFailRate + base.depletionFailRate, 1, 1e-9);
    const rich = E.simulate(basePlan({ liquid: 5e7 }), { runs: 500 });
    near(rich.successRate, 1);
    const p = basePlan({ liquid: 0 }); p.spending.monthly = 60000;
    near(E.simulate(p, { runs: 500 }).successRate, 0);
    const frugal = basePlan(); frugal.spending.monthly = 6000;
    ok(E.simulate(frugal, { runs: 500 }).successRate >= base.successRate, 'lower spending cannot hurt');
  });
  test('simulated median growth matches the lognormal median', () => {
    const p = flatPlan({ liquid: 100000 });
    p.market = Object.assign({}, p.market, { stockPct: 100, stockReturn: 5, stockVol: 16 });
    p.people = p.people.map(x => Object.assign({}, x, { age: 40, stopAge: 50 }));
    const r = E.simulate(p, { runs: 4000, seed: 3 });
    const sigma2 = Math.log(1 + 0.16 * 0.16 / (1.05 * 1.05));
    const expected = 100000 * Math.exp(10 * (Math.log(1.05) - sigma2 / 2));
    near(r.bands.p50[10] / expected, 1, 0.05, 'median ratio');
  });


  /* --- Cross-checks on the year-by-year numbers --- */
  test('every retired year adds up: sources + shortfall = spending', () => {
    const p = basePlan(); p.spending.otherIncome = 500; p.spending.monthly = 14000;
    const r = E.simulate(p, { runs: 50 });
    let checked = 0;
    r.rows.filter(x => x.phase === 'retired').forEach(x => {
      const income = x.pension + x.other, drawn = x.fromLiquid + x.fromP3 + x.fromP2 + x.shortfall;
      if (income < x.target) { near(income + drawn, x.target, 1e-6, 'year ' + x.t); checked++; }
      else near(drawn, 0, 1e-9, 'no withdrawals when income covers spending, year ' + x.t);
    });
    ok(checked > 10 && r.rows.some(x => x.shortfall > 0) && r.rows.some(x => x.fromP2 > 0) && r.rows.some(x => x.fromP3 > 0), 'all sources exercised');
  });
  test('money is conserved: with zero growth, wealth changes only by what goes in and out', () => {
    const p = basePlan({ market: { stockPct: 50, stockReturn: 0, stockVol: 0, bondReturn: 0, bondVol: 0, feePct: 0, taxDragPct: 0, pensionFundStockPct: 30, pensionFundFeePct: 0 } });
    p.spending.otherIncome = 300;
    const r = E.simulate(p, { runs: 3 });
    r.rows.forEach(x => {
      const before = x.liquid + x.p2 + x.p3;
      const flow = x.phase === 'working' ? x.saved + x.pension
        : x.saved - x.fromLiquid - x.fromP3 - x.fromP2 + Math.max(0, x.pension + x.other - x.target);
      near(r.bands.p50[x.t + 1], before + flow, 1e-6, 'year ' + x.t);
    });
    near(r.rows[1].liquid - r.rows[0].liquid, 48000); // 4,000 a month saved by the two
    near(r.rows[1].p2 - r.rows[0].p2, 21000 * 12 * 0.0475);
  });
  test('currency does not change the answer: a lei plan and the same plan in euros agree', () => {
    const ron = basePlan(), fx = 5.1, eur = basePlan({ currency: 'EUR', liquid: ron.liquid / fx });
    eur.spending.monthly /= fx;
    eur.people = eur.people.map(x => Object.assign({}, x, { salary: x.salary / fx, savings: x.savings / fx, p2Balance: x.p2Balance / fx, p3Balance: x.p3Balance / fx, p3Contribution: x.p3Contribution / fx }));
    const a = E.simulate(ron, { runs: 400, seed: 9 }), b = E.simulate(eur, { runs: 400, seed: 9 });
    near(a.successRate, b.successRate);
    near(a.bands.p50[30] / b.bands.p50[30], fx, 1e-6); near(a.bands.p10[45] / b.bands.p10[45], fx, 1e-6);
    near(a.pensions[1].monthly / b.pensions[1].monthly, fx, 1e-9);
    const pfa = { earnType: 'pfa', pfaIncome: 60000 };
    near(E.statePension(ron, Object.assign({}, ron.people[0], pfa)).monthly / fx,
      E.statePension(eur, Object.assign({}, eur.people[0], { earnType: 'pfa', pfaIncome: 60000 / fx })).monthly, 1e-9);
  });
  test('one-year growth is centred where the inputs say', () => {
    const p = flatPlan({ liquid: 100000 });
    p.market = Object.assign({}, p.market, { stockPct: 60, stockReturn: 5, stockVol: 16, bondReturn: 1, bondVol: 6, feePct: 0.3, taxDragPct: 0.3 });
    p.people = p.people.map(x => Object.assign({}, x, { age: 40, stopAge: 41 }));
    // After one year untouched: mean = 1 + 0.6*5% + 0.4*1% - 0.6% costs
    const runs = 5000, r = E.simulate(p, { runs, seed: 11 });
    // p10/p50/p90 only are exposed, so check the median against the analytic mix by a second, wider run
    const lo = E.simulate(p, { runs, seed: 12 }).bands;
    ok(Math.abs(r.bands.p50[1] / 100000 - 1.0245) < 0.01 && Math.abs(lo.p50[1] / 100000 - 1.0245) < 0.01, 'median one-year growth near 2.4%, got ' + r.bands.p50[1]);
    ok(r.bands.p10[1] < 95000 && r.bands.p90[1] > 110000, 'spread reflects volatility');
  });

  /* --- Solver --- */
  test('solver returns the first year that reaches the target', () => {
    const p = basePlan();
    const s = E.solveEarliest(p, 0.9, { runs: 300, seed: 5 });
    ok(s.k != null && s.k > 0, 'found a year, k=' + s.k);
    ok(s.success >= 0.9, 'meets target');
    ok(s.curve[s.k - 1].success < 0.9, 'previous year misses target');
    const trial = Object.assign({}, p, { people: p.people.map(x => Object.assign({}, x, { stopAge: x.age + s.k })) });
    near(E.simulate(trial, { runs: 300, seed: 5 }).successRate, s.success);
  });
  test('solver: already-funded plan can stop now; impossible plan returns null', () => {
    ok(E.solveEarliest(basePlan({ liquid: 5e7 }), 0.9, { runs: 200 }).k === 0);
    const p = basePlan({ liquid: 0 }); p.spending.monthly = 500000;
    ok(E.solveEarliest(p, 0.9, { runs: 100 }).k === null);
  });

  window.__testResults = results;
  const failed = results.filter(r => !r.ok);
  const el = document.getElementById('out');
  el.innerHTML = '<h1>' + (failed.length ? failed.length + ' of ' + results.length + ' failed' : 'All ' + results.length + ' tests passed') + '</h1>' +
    results.map(r => '<div class="' + (r.ok ? 'ok' : 'bad') + '">' + (r.ok ? '✓ ' : '✕ ') + r.name + (r.ok ? '' : ' — ' + r.error) + '</div>').join('');
})();
