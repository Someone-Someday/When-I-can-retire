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
    PL: { name: 'Poland', mode: 'rate', currency: 'PLN', pensionAge: 65, fullCareer: 40, replacementPct: 29, pillar2Pct: 0, pillar3: 'IKE/IKZE', pillar3Unlock: 60 },
    PT: { name: 'Portugal', mode: 'rate', currency: 'EUR', pensionAge: 67, fullCareer: 40, replacementPct: 74, pillar2Pct: 0, pillar3: 'PPR', pillar3Unlock: 60 },
    MANUAL: { name: 'Other (enter my pension)', mode: 'manual', currency: 'EUR', pensionAge: 67, fullCareer: 40, replacementPct: 0, pillar2Pct: 0, pillar3: 'Pillar III', pillar3Unlock: 60 }
  };

  // Display currencies. fx is the default number of units per euro, editable in the UI.
  const CURRENCIES = {
    EUR: { label: 'Euro', unit: '€', word: 'euros', prefix: true, fx: 1 },
    RON: { label: 'Lei', unit: 'lei', word: 'lei', prefix: false, fx: 5.1 },
    PLN: { label: 'Złoty', unit: 'zł', word: 'złoty', prefix: false, fx: 4.25 }
  };

  /* Where the money sits. Tax is a % of the yearly nominal gain (Romania 2026); fee is %/yr.
     kind decides how it grows: invest/generic follow the stock/bond mix, deposit and govbond earn
     a fixed real rate, cash loses inflation. Outside Romania tax defaults to 0 and is user-edited. */
  const ACCOUNT_TYPES = {
    cash: { label: 'Cash and current account', other: 'Cash and current account', kind: 'cash', taxPct: 0, feePct: 0 },
    deposit: { label: 'Bank deposit', other: 'Bank deposit', kind: 'deposit', taxPct: 10, feePct: 0 },
    govbond: { label: 'Fidelis / Tezaur bonds', other: 'Government savings bonds', kind: 'govbond', taxPct: 0, feePct: 0 },
    broker_ro: { label: 'ETFs at a Romanian broker', other: 'Investment account', kind: 'invest', taxPct: 3, feePct: 0.2 },
    broker_foreign: { label: 'ETFs at a foreign broker', other: 'Investment account abroad', kind: 'invest', taxPct: 16, feePct: 0.2 },
    fund: { label: 'Bank investment fund', other: 'Bank investment fund', kind: 'invest', taxPct: 3, feePct: 2.0 },
    generic: { label: 'Savings and investments', other: 'Savings and investments', kind: 'generic', taxPct: 0, feePct: 0 }
  };
  const SAFE_KINDS = { cash: true, deposit: true, govbond: true };
  const accountLabel = (type, country) => {
    const t = ACCOUNT_TYPES[type] || ACCOUNT_TYPES.generic;
    return country === 'RO' ? t.label : t.other;
  };
  // Defaults for a new account of this type in this country
  function accountDefaults(type, country) {
    const t = ACCOUNT_TYPES[type] || ACCOUNT_TYPES.generic;
    return { type, balance: 0, stockPct: t.kind === 'invest' ? 100 : 60, feePct: t.feePct, taxPct: country === 'RO' ? t.taxPct : 0 };
  }

  /* Real return after a tax charged on the nominal gain. Inflation alone creates a taxable gain,
     which is why a deposit can lose money in today's terms. Losses are not taxed. */
  function afterTaxReal(realPct, taxPct, inflationPct) {
    const r = realPct / 100, inf = inflationPct / 100, nominal = (1 + r) * (1 + inf) - 1;
    return nominal > 0 ? r - nominal * (taxPct / 100) / (1 + inf) : r;
  }

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
    const acc = compileAccounts(plan);
    return {
      people, pensions, T,
      acc, savingsTo: acc.savingsTo, cushion: Math.max(0, num(s.cushionYears, 0)),
      spend: num(s.monthly, 0) * 12,
      other: num(s.otherIncome, 0) * 12,
      slow: num(s.slowAfter75Pct, 0) / 100,
      flex: !!s.flexible,
      flexCut: num(s.flexCutPct, 0) / 100,
      wP: num(m.pensionFundStockPct, 30) / 100,
      costP: num(m.pensionFundFeePct, 0) / 100,
      stock: lognormal(num(m.stockReturn, 5), num(m.stockVol, 16)),
      bond: lognormal(num(m.bondReturn, 1), num(m.bondVol, 6)),
      oldest: Math.max.apply(null, people.map(p => p.age))
    };
  }

  /* Accounts as flat arrays for the hot loop. Without plan.accounts, one generic pot is built from
     plan.liquid and the market settings, which reproduces the single-pot maths exactly. */
  function compileAccounts(plan) {
    const m = plan.market || {}, country = plan.country;
    const list = Array.isArray(plan.accounts) && plan.accounts.length
      ? plan.accounts.filter(a => a && ACCOUNT_TYPES[a.type]).map(a => Object.assign({}, a))
      : [{ type: 'generic', balance: num(plan.liquid, 0), stockPct: num(m.stockPct, 60), feePct: num(m.feePct, 0) }];
    if (!list.length) list.push({ type: 'generic', balance: 0, stockPct: num(m.stockPct, 60), feePct: num(m.feePct, 0) });
    const hidden = list.map(() => false);
    // A cushion needs somewhere safe to sit
    if (num((plan.spending || {}).cushionYears, 0) > 0 && !list.some(a => SAFE_KINDS[ACCOUNT_TYPES[a.type].kind])) {
      list.push({ type: 'govbond', balance: 0 }); hidden.push(true);
    }
    const n = list.length, out = {
      n, list, hidden, kind: [], w: new Float64Array(n), fee: new Float64Array(n), extra: new Float64Array(n),
      tax: new Float64Array(n), fixed: new Float64Array(n), safe: [], start: new Float64Array(n),
      inflation: num(m.inflation, 3.5), savingsTo: 0
    };
    const inf = out.inflation / 100;
    list.forEach((a, i) => {
      const t = ACCOUNT_TYPES[a.type], d = accountDefaults(a.type, country);
      out.kind.push(t.kind);
      out.safe.push(!!SAFE_KINDS[t.kind]);
      out.start[i] = Math.max(0, num(a.balance, 0));
      out.w[i] = num(a.stockPct, t.kind === 'generic' ? num(m.stockPct, 60) : d.stockPct) / 100;
      out.fee[i] = num(a.feePct, t.kind === 'generic' ? num(m.feePct, 0) : d.feePct) / 100;
      out.tax[i] = t.kind === 'generic' ? 0 : num(a.taxPct, d.taxPct);
      // The generic pot keeps its old flat drag for tax
      out.extra[i] = t.kind === 'generic' ? num(m.taxDragPct, 0) / 100 : 0;
      out.fixed[i] = t.kind === 'deposit' ? num(m.depositReal, 0.5) / 100
        : t.kind === 'govbond' ? num(m.govReal, 1.5) / 100
          : t.kind === 'cash' ? 1 / (1 + inf) - 1 : 0;
    });
    const firstGrowth = out.kind.findIndex((k, i) => !hidden[i] && (k === 'invest' || k === 'generic'));
    const want = plan.savingsTo;
    out.savingsTo = Number.isInteger(want) && want >= 0 && want < n && !hidden[want] ? want : Math.max(0, firstGrowth);
    return out;
  }

  // Take `amount` from the accounts flagged in `pick`, in proportion to their balances; returns what was taken
  function drawFrom(bal, n, pick, amount) {
    let avail = 0;
    for (let j = 0; j < n; j++) if (pick(j)) avail += bal[j];
    const take = Math.min(avail, amount);
    if (take <= 0) return 0;
    const k = take / avail;
    for (let j = 0; j < n; j++) if (pick(j)) bal[j] = k >= 1 ? 0 : bal[j] - bal[j] * k;
    return take;
  }

  /* One path. gen() yields {rs, rb} real returns for stocks and bonds.
     Fills outTotal/outLiquid (length T+1) with start-of-year balances and,
     when rows is an array, pushes a year-by-year record. */
  function runOnce(c, gen, outTotal, outLiquid, rows) {
    const n = c.people.length, A = c.acc, na = A.n, to = c.savingsTo;
    const bal = Float64Array.from(A.start), ret = new Float64Array(na);
    const isSafe = j => A.safe[j], isRisky = j => !A.safe[j], any = () => true;
    const sumBal = () => { let x = 0; for (let j = 0; j < na; j++) x += bal[j]; return x; };
    const p2 = c.people.map(p => p.p2), p3 = c.people.map(p => p.p3);
    let prevRet = 0, fail = null;

    for (let t = 0; t < c.T; t++) {
      let locked = 0, pots = 0;
      const liquid = sumBal();
      for (let i = 0; i < n; i++) pots += p2[i] + p3[i];
      if (outTotal) { outTotal[t] = liquid + pots; outLiquid[t] = liquid; }

      const r = gen();
      // Gross real growth per account, before fees and tax
      for (let j = 0; j < na; j++) {
        const k = A.kind[j];
        ret[j] = k === 'invest' || k === 'generic' ? A.w[j] * r.rs + (1 - A.w[j]) * r.rb : A.fixed[j];
      }
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
        fromLiquid: 0, fromP3: 0, fromP2: 0, shortfall: 0, saved: 0,
        accounts: Array.from(bal), feePaid: 0, taxPaid: 0, growth: 0, addedLiquid: 0
      } : null;

      if (anyWorking) {
        // Salaries cover living costs until the last person stops; pensions already in payment are saved
        bal[to] += pensionInc;
        if (row) row.addedLiquid += pensionInc;
      } else {
        let target = c.spend;
        if (c.oldest + t >= 75) target *= 1 - c.slow;
        if (c.flex && prevRet < 0) target *= 1 - c.flexCut;
        let need = target - pensionInc - c.other;
        let fromLiquid = 0, fromP3 = 0, fromP2 = 0;
        if (need <= 0) {
          bal[to] -= need;
          if (row) row.addedLiquid -= need;
          need = 0;
        } else {
          if (c.cushion > 0 && prevRet < 0) {
            // After a bad year, live off the safe money and give the rest time to recover
            fromLiquid = drawFrom(bal, na, isSafe, need);
            fromLiquid += drawFrom(bal, na, isRisky, need - fromLiquid);
          } else if (c.cushion > 0) {
            fromLiquid = drawFrom(bal, na, isRisky, need);
            fromLiquid += drawFrom(bal, na, isSafe, need - fromLiquid);
          } else {
            fromLiquid = drawFrom(bal, na, any, need);
          }
          need -= fromLiquid;
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
        if (c.cushion > 0 && prevRet >= 0) {
          // Refill the safe accounts to the cushion from the risky ones
          let safe = 0;
          for (let j = 0; j < na; j++) if (A.safe[j]) safe += bal[j];
          const gap = c.cushion * target - safe;
          if (gap > 0) {
            const moved = drawFrom(bal, na, isRisky, gap);
            if (moved > 0) {
              if (safe > 0) { for (let j = 0; j < na; j++) if (A.safe[j]) bal[j] += moved * bal[j] / safe; }
              else bal[A.safe.indexOf(true)] += moved;
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

      // Grow each account: fee first, then tax on the nominal gain
      let wsum = 0, wbal = 0, retTo = 0;
      for (let j = 0; j < na; j++) {
        const pre = ret[j] - A.fee[j] - A.extra[j];
        const net = A.tax[j] > 0 ? afterTaxReal(pre * 100, A.tax[j], A.inflation) : pre;
        if (row) {
          row.growth += bal[j] * ret[j]; row.feePaid += bal[j] * A.fee[j];
          row.taxPaid += bal[j] * (A.extra[j] + pre - net);
        }
        wsum += bal[j] * net; wbal += bal[j];
        if (j === to) retTo = net;
        bal[j] *= 1 + net;
      }
      for (let i = 0; i < n; i++) { p2[i] *= 1 + retP; p3[i] *= 1 + retP; }
      for (let i = 0; i < n; i++) {
        const p = c.people[i];
        if (p.age + t < p.stopAge) {
          bal[to] += p.savings; p2[i] += p.p2Contribution; p3[i] += p.p3Contribution;
          if (row) { row.saved += p.savings + p.p2Contribution + p.p3Contribution; row.addedLiquid += p.savings; }
        }
      }
      // Balance-weighted return; with nothing invested, the account savings go to
      prevRet = wbal > 0 ? wsum / wbal : retTo;
      if (row) rows.push(row);
    }
    if (outTotal) {
      let pots = 0;
      for (let i = 0; i < n; i++) pots += p2[i] + p3[i];
      const liquid = sumBal();
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
      const name = (plan.people[i].name || '').trim() || 'Person ' + (i + 1);
      // "You stop" / "Your pension", otherwise "Ana stops" / "Ana's pension"
      const you = /^(you|me|i)$/i.test(name), whose = you ? 'Your' : name + "'s";
      const add = (age, label) => {
        const t = age - p.age;
        if (t >= 0 && t <= c.T) out.push({ t, label });
      };
      const c3 = (COUNTRIES[plan.country] || COUNTRIES.MANUAL).pillar3;
      add(p.stopAge, (you ? 'You stop' : name + ' stops') + ' working');
      if (p.p3 > 0 || p.p3Contribution > 0) add(p.p3Unlock, whose + ' ' + c3 + ' unlocks');
      if (p.pension > 0) add(p.claimAge, whose + ' state pension starts');
      else if (p.p2 > 0 || p.p2Contribution > 0) add(p.claimAge, whose + ' Pillar II unlocks');
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
    res.accounts = c.acc.list.map((a, j) => ({ type: a.type, hidden: c.acc.hidden[j], start: c.acc.start[j], fee: c.acc.fee[j] * 100, tax: c.acc.tax[j] }));
    res.savingsTo = c.savingsTo;
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
    RO, COUNTRIES, CURRENCIES, ACCOUNT_TYPES, accountLabel, accountDefaults, afterTaxReal, roStabilityPoints, roNetPension, roEarlyPenalty, roContribution, roPension,
    statePension, simulate, solveEarliest, mulberry32
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RetEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
