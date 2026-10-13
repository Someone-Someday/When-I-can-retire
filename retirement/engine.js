/* Retirement calculator engine. Pure functions, no DOM.
   All money is in today's prices (real terms). Flows are annual steps.
   Plan amounts are in the plan's display currency; Romanian statutory
   constants are in RON and converted through plan.fx. */
(function (root) {
  'use strict';

  // Romania, 2026 rules
  const RO = {
    vpr: 81,                    // lei per point, frozen for 2026
    avgGross: 9192,             // average gross salary used for yearly points
    minYears: 15,
    fullYears: 35,
    stabilityFrom: 25,          // stability points accrue beyond this many years
    earlyMaxYears: 5,
    earlyPenaltyPerMonth: 0.004, // law allows 0.20-0.40%; the cautious end is used
    earlyPenaltyMax: 0.24,
    taxFreeThreshold: 3000,     // lei / month
    pensionTaxPct: 19,          // 10% CASS + 10% income tax on the rest, on the part above the threshold
    minSalary: 4050,            // gross minimum salary (4,325 from 1 Jul 2026)
    socialMin: 1281             // social minimum pension
  };

  // mode 'ro' = full formula, 'rate' = replacement rate x salary, 'manual' = entered pension.
  // Preset numbers are approximate and editable in the UI.
  const COUNTRIES = {
    RO: { name: 'Romania', mode: 'ro', currency: 'RON', pensionAge: 65, fullCareer: 35, replacementPct: 0, pillar2Pct: 4.75, pillar3: 'Pilon III', pillar3Unlock: 60 },
    DE: { name: 'Germany', mode: 'rate', currency: 'EUR', pensionAge: 67, fullCareer: 45, replacementPct: 44, pillar2Pct: 0, pillar3: 'Rürup', pillar3Unlock: 62 },
    FR: { name: 'France', mode: 'rate', currency: 'EUR', pensionAge: 64, fullCareer: 43, replacementPct: 57, pillar2Pct: 0, pillar3: 'PER', pillar3Unlock: 64 },
    ES: { name: 'Spain', mode: 'rate', currency: 'EUR', pensionAge: 67, fullCareer: 37, replacementPct: 80, pillar2Pct: 0, pillar3: 'Plan de Pensiones', pillar3Unlock: 67 },
    IT: { name: 'Italy', mode: 'rate', currency: 'EUR', pensionAge: 67, fullCareer: 43, replacementPct: 76, pillar2Pct: 0, pillar3: 'Fondo pensione', pillar3Unlock: 67 },
    NL: { name: 'Netherlands', mode: 'rate', currency: 'EUR', pensionAge: 67, fullCareer: 40, replacementPct: 75, pillar2Pct: 0, pillar3: 'Lijfrente', pillar3Unlock: 67 },
    PL: { name: 'Poland', mode: 'rate', currency: 'EUR', pensionAge: 65, fullCareer: 40, replacementPct: 29, pillar2Pct: 0, pillar3: 'IKE/IKZE', pillar3Unlock: 60 },
    PT: { name: 'Portugal', mode: 'rate', currency: 'EUR', pensionAge: 67, fullCareer: 40, replacementPct: 74, pillar2Pct: 0, pillar3: 'PPR', pillar3Unlock: 60 },
    MANUAL: { name: 'Other (enter my pension)', mode: 'manual', currency: 'EUR', pensionAge: 67, fullCareer: 40, replacementPct: 0, pillar2Pct: 0, pillar3: 'Pillar III', pillar3Unlock: 60 }
  };

  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  /* ---------- Romanian state pension ---------- */

  function roStabilityPoints(years) {
    let pts = 0;
    for (let y = RO.stabilityFrom + 1; y <= Math.floor(years); y++) {
      pts += y <= 30 ? 0.5 : y <= 35 ? 0.75 : 1;
    }
    return pts;
  }

  function roParams(plan) {
    return Object.assign({}, RO, (plan && plan.ro) || {});
  }

  function roNetPension(grossRON, R) {
    R = R || RO;
    if (grossRON <= R.taxFreeThreshold) return grossRON;
    return grossRON - (grossRON - R.taxFreeThreshold) * R.pensionTaxPct / 100;
  }

  function roEarlyPenalty(claimAge, stdAge) {
    const years = Math.min(RO.earlyMaxYears, Math.max(0, stdAge - claimAge));
    return Math.min(RO.earlyPenaltyMax, years * 12 * RO.earlyPenaltyPerMonth);
  }

  /* Yearly CAS base and points per year from how a person earns.
     o: { earnType, salaryRON, pfaIncomeRON, casMode, casCustomRON, volBaseRON } */
  function roContribution(o, R) {
    R = R || RO;
    const min12 = 12 * R.minSalary;
    let base = 0;
    switch (o.earnType || 'employee') {
      case 'employee': base = num(o.salaryRON, 0) * 12; break;
      case 'pfa': {
        const income = num(o.pfaIncomeRON, 0), mode = o.casMode || 'auto';
        if (mode === 'auto') base = income < min12 ? 0 : income < 2 * min12 ? min12 : 2 * min12;
        else if (mode === '12') base = min12;
        else if (mode === '24') base = 2 * min12;
        else if (mode === 'custom') base = Math.max(min12, num(o.casCustomRON, 0));
        break;
      }
      case 'voluntary': base = num(o.volBaseRON, 0) > 0 ? Math.max(o.volBaseRON, R.minSalary) * 12 : 0; break;
      default: base = 0; // dividends only
    }
    return { baseYearly: base, ppy: base / 12 / R.avgGross };
  }

  /* o: { ppy (or salaryRON), yearsSoFar, futureYears, pointsSoFar (optional), claimAge, stdAge, params }
     A year counts as contributed only if it earns points. */
  function roPension(o) {
    const R = o.params || RO;
    const ppy = o.ppy != null ? o.ppy : o.salaryRON / R.avgGross;
    const pastYears = o.pointsSoFar != null || ppy > 0 ? o.yearsSoFar : 0;
    const years = pastYears + (ppy > 0 ? o.futureYears : 0);
    const past = o.pointsSoFar != null ? o.pointsSoFar : o.yearsSoFar * ppy;
    const points = past + o.futureYears * ppy;
    const stability = roStabilityPoints(years);
    const stdAge = num(o.stdAge, 65);
    const penalty = roEarlyPenalty(num(o.claimAge, stdAge), stdAge);
    const eligible = years >= R.minYears;
    const grossRON = eligible ? Math.max((points + stability) * R.vpr * (1 - penalty), R.socialMin) : 0;
    return { years, ppy, points, stability, penalty, eligible, grossRON, netRON: roNetPension(grossRON, R), perYear: ppy * R.vpr };
  }

  /* ---------- State pension for any country, monthly net in plan currency ---------- */

  function ronPerUnit(plan) {
    return plan.currency === 'RON' ? 1 : num(plan.fx, 5.1);
  }

  function statePension(plan, person) {
    const c = COUNTRIES[plan.country] || COUNTRIES.MANUAL;
    const haircut = 1 - num(plan.pension.haircutPct, 0) / 100;
    // Contributions stop at the earlier of the stop-work age and the pension age
    const futureYears = Math.max(0, Math.min(person.stopAge, num(person.claimAge, c.pensionAge)) - person.age);
    const years = num(person.yearsContributed, 0) + futureYears;
    const out = { years, source: 'estimate', monthly: 0, detail: null };

    if (person.pensionOverride != null && person.pensionOverride > 0) {
      out.source = 'override';
      out.monthly = person.pensionOverride * haircut;
      return out;
    }
    if (c.mode === 'ro') {
      const k = ronPerUnit(plan), R = roParams(plan);
      const contrib = roContribution({
        earnType: person.earnType, salaryRON: num(person.salary, 0) * k, pfaIncomeRON: num(person.pfaIncome, 0) * k,
        casMode: person.casMode, casCustomRON: num(person.casCustom, 0) * k, volBaseRON: num(person.volBase, 0) * k
      }, R);
      const d = roPension({
        ppy: contrib.ppy,
        yearsSoFar: num(person.yearsContributed, 0),
        futureYears,
        pointsSoFar: person.pointsSoFar,
        claimAge: person.claimAge,
        stdAge: c.pensionAge,
        params: R
      });
      d.baseYearly = contrib.baseYearly / k;
      d.perYear = d.perYear / k;
      out.detail = d;
      out.years = d.years;
      out.monthly = (d.netRON / k) * haircut;
    } else if (c.mode === 'rate') {
      const full = Math.max(1, num(plan.pension.fullCareer, c.fullCareer));
      const rate = num(plan.pension.replacementPct, c.replacementPct) / 100;
      out.monthly = person.salary * rate * Math.min(1, years / full) * haircut;
    } else {
      out.source = 'missing';
    }
    return out;
  }

  /* ---------- Random numbers ---------- */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rand) {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  }

  // Lognormal parameters from an arithmetic mean and volatility of yearly returns
  function lognormal(meanPct, volPct) {
    const m = meanPct / 100, s = volPct / 100;
    const sigma2 = Math.log(1 + (s * s) / ((1 + m) * (1 + m)));
    return { mu: Math.log(1 + m) - sigma2 / 2, sigma: Math.sqrt(sigma2) };
  }

  /* ---------- Simulation ---------- */

  function compile(plan) {
    const c = COUNTRIES[plan.country] || COUNTRIES.MANUAL;
    const m = plan.market, s = plan.spending;
    const pensions = plan.people.map(p => statePension(plan, p));
    const people = plan.people.map((p, i) => ({
      age: p.age,
      stopAge: p.stopAge,
      claimAge: num(p.claimAge, c.pensionAge),
      p3Unlock: num(p.p3UnlockAge, c.pillar3Unlock),
      savings: num(p.savings, 0) * 12,
      // In Romania only employees pay into Pillar II
      p2Contribution: c.mode === 'ro' && (p.earnType || 'employee') !== 'employee' ? 0
        : num(p.salary, 0) * 12 * num(plan.pension.pillar2Pct, c.pillar2Pct) / 100,
      p3Contribution: num(p.p3Contribution, 0) * 12,
      p2: num(p.p2Balance, 0),
      p3: num(p.p3Balance, 0),
      pension: pensions[i].monthly * 12
    }));
    const T = Math.max(1, Math.round(plan.endAge - Math.min.apply(null, people.map(p => p.age))));
    return {
      people, pensions, T,
      liquid: num(plan.liquid, 0),
      spend: num(s.monthly, 0) * 12,
      other: num(s.otherIncome, 0) * 12,
      slow: num(s.slowAfter75Pct, 0) / 100,
      flex: !!s.flexible,
      flexCut: num(s.flexCutPct, 0) / 100,
      wL: num(m.stockPct, 60) / 100,
      wP: num(m.pensionFundStockPct, 30) / 100,
      costL: (num(m.feePct, 0) + num(m.taxDragPct, 0)) / 100,
      costP: num(m.pensionFundFeePct, 0) / 100,
      stock: lognormal(num(m.stockReturn, 5), num(m.stockVol, 16)),
      bond: lognormal(num(m.bondReturn, 1), num(m.bondVol, 6)),
      oldest: Math.max.apply(null, people.map(p => p.age))
    };
  }

  /* One path. gen() yields {rs, rb} real returns for stocks and bonds.
     Fills outTotal/outLiquid (length T+1) with start-of-year balances and,
     when rows is an array, pushes a year-by-year record. */
  function runOnce(c, gen, outTotal, outLiquid, rows) {
    const n = c.people.length;
    let liquid = c.liquid;
    const p2 = c.people.map(p => p.p2), p3 = c.people.map(p => p.p3);
    let prevRet = 0, fail = null;

    for (let t = 0; t < c.T; t++) {
      let locked = 0, pots = 0;
      for (let i = 0; i < n; i++) pots += p2[i] + p3[i];
      if (outTotal) { outTotal[t] = liquid + pots; outLiquid[t] = liquid; }

      const r = gen();
      const retL = c.wL * r.rs + (1 - c.wL) * r.rb - c.costL;
      const retP = c.wP * r.rs + (1 - c.wP) * r.rb - c.costP;

      let anyWorking = false, pensionInc = 0, pensionPending = false;
      for (let i = 0; i < n; i++) {
        const p = c.people[i], a = p.age + t;
        if (a < p.stopAge) anyWorking = true;
        if (a >= p.claimAge) pensionInc += p.pension;
        else { locked += p2[i]; if (p.pension > 0) pensionPending = true; }
        if (a < p.p3Unlock) locked += p3[i];
      }

      const row = rows ? {
        t, phase: anyWorking ? 'working' : 'retired', liquid, p2: p2.reduce((x, y) => x + y, 0),
        p3: p3.reduce((x, y) => x + y, 0), target: 0, pension: pensionInc, other: 0,
        fromLiquid: 0, fromP3: 0, fromP2: 0, shortfall: 0, saved: 0
      } : null;

      if (anyWorking) {
        // Salaries cover living costs until the last person stops; pensions already in payment are saved
        liquid += pensionInc;
      } else {
        let target = c.spend;
        if (c.oldest + t >= 75) target *= 1 - c.slow;
        if (c.flex && prevRet < 0) target *= 1 - c.flexCut;
        let need = target - pensionInc - c.other;
        let fromLiquid = 0, fromP3 = 0, fromP2 = 0;
        if (need <= 0) {
          liquid -= need;
          need = 0;
        } else {
          fromLiquid = Math.min(liquid, need); liquid -= fromLiquid; need -= fromLiquid;
          for (let i = 0; i < n && need > 0; i++) {
            if (c.people[i].age + t >= c.people[i].p3Unlock) {
              const w = Math.min(p3[i], need); p3[i] -= w; need -= w; fromP3 += w;
            }
          }
          for (let i = 0; i < n && need > 0; i++) {
            if (c.people[i].age + t >= c.people[i].claimAge) {
              const w = Math.min(p2[i], need); p2[i] -= w; need -= w; fromP2 += w;
            }
          }
        }
        if (need > 0.01 * target && !fail) {
          fail = { t, type: locked > 1 || pensionPending ? 'bridge' : 'depletion' };
        }
        if (row) {
          row.target = target; row.other = c.other; row.fromLiquid = fromLiquid;
          row.fromP3 = fromP3; row.fromP2 = fromP2; row.shortfall = need;
        }
      }

      liquid *= 1 + retL;
      for (let i = 0; i < n; i++) { p2[i] *= 1 + retP; p3[i] *= 1 + retP; }
      for (let i = 0; i < n; i++) {
        const p = c.people[i];
        if (p.age + t < p.stopAge) {
          liquid += p.savings; p2[i] += p.p2Contribution; p3[i] += p.p3Contribution;
          if (row) row.saved += p.savings + p.p2Contribution + p.p3Contribution;
        }
      }
      prevRet = retL;
      if (row) rows.push(row);
    }
    if (outTotal) {
      let pots = 0;
      for (let i = 0; i < n; i++) pots += p2[i] + p3[i];
      outTotal[c.T] = liquid + pots; outLiquid[c.T] = liquid;
    }
    return fail;
  }

  function percentile(sorted, q) {
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  function milestones(c, plan) {
    const out = [];
    c.people.forEach((p, i) => {
      const name = plan.people[i].name || 'Person ' + (i + 1);
      const add = (age, label) => {
        const t = age - p.age;
        if (t >= 0 && t <= c.T) out.push({ t, label: name + ' ' + label });
      };
      const c3 = (COUNTRIES[plan.country] || COUNTRIES.MANUAL).pillar3;
      add(p.stopAge, 'stops working');
      if (p.p3 > 0 || p.p3Contribution > 0) add(p.p3Unlock, c3 + ' unlocks');
      if (p.pension > 0) add(p.claimAge, 'pension starts');
      else if (p.p2 > 0 || p.p2Contribution > 0) add(p.claimAge, 'Pillar II unlocks');
    });
    return out.sort((a, b) => a.t - b.t);
  }

  /* opts: { runs, seed, successOnly } */
  function simulate(plan, opts) {
    opts = opts || {};
    const runs = Math.max(1, opts.runs || 1000);
    const c = compile(plan);
    const rand = mulberry32(opts.seed == null ? 12345 : opts.seed);
    const gen = () => ({
      rs: Math.exp(c.stock.mu + c.stock.sigma * gaussian(rand)) - 1,
      rb: Math.exp(c.bond.mu + c.bond.sigma * gaussian(rand)) - 1
    });

    const full = !opts.successOnly;
    const tot = full ? Array.from({ length: c.T + 1 }, () => new Float64Array(runs)) : null;
    const liq = full ? Array.from({ length: c.T + 1 }, () => new Float64Array(runs)) : null;
    const bufT = new Float64Array(c.T + 1), bufL = new Float64Array(c.T + 1);
    let bridgeFails = 0, depletionFails = 0;
    const failYears = [];

    for (let r = 0; r < runs; r++) {
      const fail = runOnce(c, gen, full ? bufT : null, bufL, null);
      if (fail) {
        if (fail.type === 'bridge') bridgeFails++; else depletionFails++;
        failYears.push(fail.t);
      }
      if (full) for (let t = 0; t <= c.T; t++) { tot[t][r] = bufT[t]; liq[t][r] = bufL[t]; }
    }
    const res = {
      runs, T: c.T,
      successRate: (runs - bridgeFails - depletionFails) / runs,
      bridgeFailRate: bridgeFails / runs,
      depletionFailRate: depletionFails / runs,
      pensions: c.pensions
    };
    if (!full) return res;

    failYears.sort((a, b) => a - b);
    res.medianFailT = failYears.length ? failYears[Math.floor(failYears.length / 2)] : null;
    res.bands = { p10: [], p50: [], p90: [], liquid50: [] };
    for (let t = 0; t <= c.T; t++) {
      tot[t].sort(); liq[t].sort();
      res.bands.p10.push(percentile(tot[t], 0.1));
      res.bands.p50.push(percentile(tot[t], 0.5));
      res.bands.p90.push(percentile(tot[t], 0.9));
      res.bands.liquid50.push(percentile(liq[t], 0.5));
    }

    // Typical path: every year earns the median return
    const med = { rs: Math.exp(c.stock.mu) - 1, rb: Math.exp(c.bond.mu) - 1 };
    res.rows = [];
    res.typicalFail = runOnce(c, () => med, null, null, res.rows);
    res.milestones = milestones(c, plan);

    // Bridge: from the year both have stopped until the last pension / locked pot opens
    const startT = Math.max.apply(null, c.people.map(p => p.stopAge - p.age));
    let endT = 0;
    c.people.forEach(p => {
      if (p.pension > 0 || p.p2 > 0 || p.p2Contribution > 0) endT = Math.max(endT, p.claimAge - p.age);
      if (p.p3 > 0 || p.p3Contribution > 0) endT = Math.max(endT, p.p3Unlock - p.age);
    });
    endT = Math.min(endT, c.T);
    const b = { startT: Math.max(0, startT), endT, years: Math.max(0, endT - Math.max(0, startT)), liquidAtStart: 0, needed: 0, shortfall: 0 };
    if (b.years > 0 && b.startT < res.rows.length) {
      b.liquidAtStart = res.rows[b.startT].liquid;
      for (let t = b.startT; t < b.endT && t < res.rows.length; t++) {
        b.needed += res.rows[t].fromLiquid + res.rows[t].shortfall;
        b.shortfall += res.rows[t].shortfall;
      }
    }
    res.bridge = b;
    return res;
  }

  /* Earliest number of years from now at which both can stop with success >= target.
     Both stop in the same calendar year. Returns { k, success, curve } (k null if never). */
  function solveEarliest(plan, target, opts) {
    opts = opts || {};
    const maxAge = opts.maxStopAge || 75;
    const youngest = Math.min.apply(null, plan.people.map(p => p.age));
    const oldest = Math.max.apply(null, plan.people.map(p => p.age));
    const maxK = Math.max(0, Math.min(maxAge - oldest, plan.endAge - youngest - 1));
    const curve = [];
    for (let k = 0; k <= maxK; k++) {
      const trial = Object.assign({}, plan, {
        people: plan.people.map(p => Object.assign({}, p, { stopAge: p.age + k }))
      });
      const s = simulate(trial, { runs: opts.runs || 1000, seed: opts.seed, successOnly: true }).successRate;
      curve.push({ k, success: s });
      if (s >= target) return { k, success: s, curve };
    }
    return { k: null, success: curve.length ? curve[curve.length - 1].success : 0, curve };
  }

  const api = {
    RO, COUNTRIES, roStabilityPoints, roNetPension, roEarlyPenalty, roContribution, roPension,
    statePension, simulate, solveEarliest, mulberry32
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RetEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
