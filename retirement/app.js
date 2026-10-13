/* Retirement planner UI: short form, one plain answer, sliders, details on demand. */
(function () {
  'use strict';
  const E = window.RetEngine;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));

  const LS_CURRENT = 'retcalc.v2.current', LS_SCENARIOS = 'retcalc.v2.scenarios';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };

  const EARN = [
    ['employee', 'Employee (salary)'],
    ['pfa', 'PFA / self-employed'],
    ['dividends', 'Company owner, dividends only'],
    ['voluntary', 'Not working / voluntary contract']
  ];
  const CAS_MODES = [['auto', 'Automatic from income'], ['none', 'None'], ['12', '12 minimum salaries'], ['24', '24 minimum salaries'], ['custom', 'Custom']];

  function defaultPerson(name, age, salary, stopAge, years, p2, p3) {
    return {
      name, age, earnType: 'employee', salary, pfaIncome: 120000, casMode: 'auto', casCustom: 48600, volBase: 4050,
      stopAge, yearsContributed: years, pointsSoFar: null, claimAge: 65, knowPension: false, pensionOverride: null,
      hasP2: true, p2Balance: p2, hasP3: p3 > 0, p3Balance: p3, p3Contribution: p3 > 0 ? 170 : 0, p3UnlockAge: 60
    };
  }
  function defaultPlan() {
    return {
      example: true, country: 'RO', currency: 'RON', single: false, fxRates: { RON: 5.1, PLN: 4.25 }, endAge: 95, runs: 1000,
      people: [defaultPerson('You', 35, 12000, 55, 12, 60000, 10000), defaultPerson('Partner', 33, 9000, 53, 10, 40000, 0)],
      liquid: 300000, savings: 4000, accounts: [], savingsTo: null, quiz: null,
      spending: { monthly: 9000, otherIncome: 0, slowAfter75Pct: 15, flexible: false, flexCutPct: 10, cushionYears: 0 },
      market: { stockPct: 70, stockReturn: 5, stockVol: 16, bondReturn: 1, bondVol: 6, feePct: 0.3, taxDragPct: 0.3, pensionFundStockPct: 30, pensionFundFeePct: 0.5,
        inflation: 3.5, depositReal: 0.5, govReal: 1.5 },
      pension: { replacementPct: 0, fullCareer: 35, pillar2Pct: 4.75, haircutPct: 0 },
      ro: { avgGross: 9192, minSalary: 4050, vpr: 81, socialMin: 1281, pensionTaxPct: 19, taxFreeThreshold: 3000 }
    };
  }
  // Fill anything missing in a stored plan from the defaults. An empty default list (accounts)
  // means "any length": the saved list is kept as it is.
  function withDefaults(saved, def) {
    if (Array.isArray(def) && !def.length) return Array.isArray(saved) ? saved : def;
    if (Array.isArray(def)) return Array.isArray(saved) && saved.length === def.length ? def.map((d, i) => withDefaults(saved[i], d)) : def;
    if (def && typeof def === 'object') {
      const out = {};
      Object.keys(def).forEach(k => { out[k] = withDefaults(saved ? saved[k] : undefined, def[k]); });
      return out;
    }
    return saved === undefined ? def : saved;
  }

  // Plans saved before the currency switch existed used lei for Romania and euros elsewhere
  function hydrate(saved) {
    if (saved && saved.example === undefined) saved.example = false;
    if (saved && !saved.currency) saved.currency = !saved.country || saved.country === 'RO' ? 'RON' : 'EUR';
    // Before per-currency rates, one lei-per-euro rate was stored as fx
    if (saved && saved.fx && !saved.fxRates) saved.fxRates = { RON: saved.fx };
    return withDefaults(saved, defaultPlan());
  }

  let plan = hydrate(store.get(LS_CURRENT, null));
  const howOpen = [false, false];
  const startYear = new Date().getFullYear();

  const getPath = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  function setPath(o, path, v) {
    const keys = path.split('.'), last = keys.pop();
    keys.reduce((x, k) => x[k], o)[last] = v;
  }
  // Every amount the currency switch converts, including each account balance
  const MONEY = () => ['liquid', 'savings', 'spending.monthly', 'spending.otherIncome'].concat(
    [0, 1].flatMap(i => ['salary', 'pfaIncome', 'casCustom', 'volBase', 'pensionOverride', 'p2Balance', 'p3Balance', 'p3Contribution'].map(k => 'people.' + i + '.' + k)),
    (plan.accounts || []).map((_, i) => 'accounts.' + i + '.balance'));

  // The country decides which currencies are offered: its own and the euro
  const localCur = () => (E.COUNTRIES[plan.country] || E.COUNTRIES.MANUAL).currency;
  const offered = () => (localCur() === 'EUR' ? ['EUR'] : [localCur(), 'EUR']);
  const CUR = () => E.CURRENCIES[plan.currency] || E.CURRENCIES.EUR;
  const perEur = code => (code === 'EUR' ? 1 : (plan.fxRates && plan.fxRates[code] > 0 ? plan.fxRates[code] : E.CURRENCIES[code].fx));
  const cur = () => CUR().unit;
  const fmt = n => {
    const s = Math.round(n).toLocaleString('en-US'), c = CUR();
    return c.prefix ? c.unit + s : s + ' ' + c.unit;
  };
  const roundNice = E.roundNice;
  const grouped = n => (typeof n === 'number' && isFinite(n) ? Math.round(n).toLocaleString('en-US') : '');
  const compact = n => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const country = () => E.COUNTRIES[plan.country] || E.COUNTRIES.MANUAL;
  const count = () => (plan.single ? 1 : 2);

  /* ---------- Form ---------- */

  function field(f) {
    const v = getPath(plan, f.path);
    const unit = f.money ? cur() + (f.per || '') : (f.unit || '');
    const attrs = f.text ? 'type="text"' : f.money ? 'type="text" inputmode="numeric" data-money' : 'type="number" inputmode="decimal" step="' + (f.step || 1) + '" min="0"';
    const shown = v == null ? '' : f.money ? grouped(v) : v;
    return '<label class="f' + (f.wide ? ' wide' : '') + '"><span>' + f.label + '</span><span class="inp"><input ' + attrs +
      ' data-path="' + f.path + '"' + (f.rerender ? ' data-rerender' : '') + (f.optional ? ' data-optional placeholder="' + (f.placeholder || 'auto') + '"' : '') +
      ' value="' + esc(shown) + '">' + (unit ? '<em>' + unit + '</em>' : '') + '</span>' +
      (f.hint ? '<small>' + f.hint + '</small>' : '') + '</label>';
  }
  const select = (path, label, options) => '<label class="f wide"><span>' + label + '</span><span class="inp"><select data-path="' + path + '">' +
    options.map(o => '<option value="' + o[0] + '"' + (o[0] === getPath(plan, path) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></span></label>';
  const check = (path, label) => '<label class="f check"><input type="checkbox" data-path="' + path + '" data-rerender' + (getPath(plan, path) ? ' checked' : '') + '> ' + label + '</label>';
  const toggleLink = (path, label) => '<button type="button" class="btn link wide" data-toggle="' + path + '">' + label + '</button>';

  // One column per person
  function personColumns(build) {
    const n = count();
    return '<div class="people' + (n === 1 ? ' one' : '') + '">' + Array.from({ length: n }, (_, i) => '<div>' + build('people.' + i + '.', plan.people[i], i).filter(Boolean).join('') + '</div>').join('') + '</div>';
  }

  function slider(path, label, min, max, step) {
    const v = Math.min(max, Math.max(min, getPath(plan, path) || 0));
    return '<label class="sl"><span>' + label + '<b id="sv_' + path + '"></b></span><input type="range" data-path="' + path + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + v + '"></label>';
  }
  function sliderText(path) {
    const v = getPath(plan, path), m = path.match(/^people\.(\d)\.stopAge$/);
    if (m) return 'age ' + v + ' · ' + (startYear + Math.max(0, v - plan.people[+m[1]].age));
    return fmt(v) + ' a month';
  }
  // Value label plus the filled part of the track
  function paintSlider(el) {
    $('sv_' + el.dataset.path).textContent = sliderText(el.dataset.path);
    el.style.setProperty('--p', (el.max > el.min ? (el.value - el.min) / (el.max - el.min) * 100 : 0) + '%');
  }
  function updateSliderLabels() {
    document.querySelectorAll('#play input[type=range]').forEach(paintSlider);
  }

  function renderForm() {
    const c = country(), ro = c.mode === 'ro', form = $('form'), p2 = ro ? 'Pilon II' : 'a Pillar II pot';
    const open = Array.from(form.querySelectorAll('details[open]')).map(d => d.id);
    const moneyMax = (v, base) => Math.max(base, Math.ceil((v || 0) * 1.5 / 1000) * 1000);
    const k = perEur(plan.currency) / 5;  // slider ranges are set in lei and scaled to the shown currency

    const about = personColumns((p, x, i) => {
      const type = ro ? x.earnType : 'employee';
      return [
        field({ path: p + 'name', label: 'Name', text: true }),
        field({ path: p + 'age', label: 'Age', unit: 'yrs', rerender: true }),
        ro ? select(p + 'earnType', 'How do you earn money?', EARN) : '',
        type === 'employee' ? field({ path: p + 'salary', label: 'Gross monthly salary', money: true, wide: true }) : '',
        type === 'pfa' ? field({ path: p + 'pfaIncome', label: 'Expected net income per year', money: true, wide: true }) : '',
        type === 'voluntary' ? field({ path: p + 'volBase', label: 'Monthly declared base', money: true, wide: true, hint: 'At least one minimum salary, or 0' }) : '',
        field({ path: p + 'yearsContributed', label: 'Years of pension contributions so far', unit: 'yrs', wide: true }),
        '<p class="explain wide" id="explain' + i + '"></p>',
        x.knowPension ? field({ path: p + 'pensionOverride', label: 'My exact net pension', money: true, per: '/mo', optional: true, placeholder: 'enter', wide: true }) + toggleLink(p + 'knowPension', 'Estimate it for me instead')
          : toggleLink(p + 'knowPension', 'I know my exact pension'),
        check(p + 'hasP2', 'I have ' + p2),
        x.hasP2 ? field({ path: p + 'p2Balance', label: 'How much is in it?', money: true, wide: true }) : '',
        check(p + 'hasP3', 'I have ' + esc(c.pillar3)),
        x.hasP3 ? field({ path: p + 'p3Balance', label: 'How much is in it?', money: true, wide: true }) : ''
      ];
    });

    const details =
      '<h3>State pension</h3>' + personColumns((p, x) => [
        field({ path: p + 'claimAge', label: 'Start pension at age', unit: 'yrs', wide: true }),
        ro ? field({ path: p + 'pointsSoFar', label: 'Points already earned', optional: true, step: 0.1, unit: 'pts', wide: true, hint: 'From your Casa de Pensii statement' }) : '',
        ro && x.earnType === 'pfa' ? select(p + 'casMode', 'Pension contribution (CAS) base', CAS_MODES) : '',
        ro && x.earnType === 'pfa' && x.casMode === 'custom' ? field({ path: p + 'casCustom', label: 'Custom base per year', money: true, wide: true, hint: 'At least 12 minimum salaries' }) : ''
      ]) +
      '<div class="grid2 gap">' +
        (ro ? field({ path: 'ro.avgGross', label: 'Average gross salary', unit: 'lei' }) + field({ path: 'ro.minSalary', label: 'Minimum salary', unit: 'lei' }) +
          field({ path: 'ro.vpr', label: 'Pension point value', unit: 'lei' }) + field({ path: 'ro.socialMin', label: 'Social minimum pension', unit: 'lei' }) +
          field({ path: 'ro.pensionTaxPct', label: 'Pension tax above threshold', unit: '%' }) + field({ path: 'ro.taxFreeThreshold', label: 'Tax-free pension up to', unit: 'lei' }) : '') +
        (c.mode === 'rate' ? field({ path: 'pension.replacementPct', label: 'Pension as share of salary', unit: '%' }) + field({ path: 'pension.fullCareer', label: 'Full career', unit: 'yrs' }) : '') +
        field({ path: 'pension.haircutPct', label: 'What if pensions are cut by', unit: '%' }) +
      '</div>' +
      '<h3>' + (ro ? 'Pilon II and III' : 'Pension pots') + '</h3>' + personColumns((p, x) => [
        x.hasP3 ? field({ path: p + 'p3Contribution', label: esc(c.pillar3) + ' paid in', money: true, per: '/mo', wide: true }) : '',
        x.hasP3 ? field({ path: p + 'p3UnlockAge', label: esc(c.pillar3) + ' unlocks at age', unit: 'yrs', wide: true }) : ''
      ]) +
      '<div class="grid2 gap">' + field({ path: 'pension.pillar2Pct', label: 'Pillar II rate', unit: '% gross', step: 0.05 }) + '</div>' +
      '<h3>Spending</h3><div class="grid2">' +
        field({ path: 'spending.otherIncome', label: 'Other income (rent etc.)', money: true, per: '/mo' }) +
        field({ path: 'spending.slowAfter75Pct', label: 'Spend less after 75', unit: '%' }) +
        '<label class="f check"><input type="checkbox" data-path="spending.flexible"' + (plan.spending.flexible ? ' checked' : '') + '> Bad-year spending cuts: spend less after markets fall</label>' +
        field({ path: 'spending.flexCutPct', label: 'Cut by', unit: '%' }) +
        field({ path: 'endAge', label: 'Plan until age', unit: 'yrs' }) +
      '</div>' +
      '<h3>Investments</h3>' + accountEditor() + '<div class="grid2 gap">' +
        (hasAccounts() ? '' : field({ path: 'market.stockPct', label: 'Stocks in your savings', unit: '%' })) +
        field({ path: 'market.pensionFundStockPct', label: 'Stocks in pension funds', unit: '%' }) +
        field({ path: 'market.stockReturn', label: 'Stock growth above inflation', unit: '%/yr', step: 0.1 }) +
        field({ path: 'market.bondReturn', label: 'Bond growth above inflation', unit: '%/yr', step: 0.1 }) +
        field({ path: 'market.stockVol', label: 'Stock ups and downs', unit: '%', step: 0.5 }) +
        field({ path: 'market.bondVol', label: 'Bond ups and downs', unit: '%', step: 0.5 }) +
        (hasAccounts() ? '' : field({ path: 'market.feePct', label: 'Fund fees', unit: '%/yr', step: 0.05 }) +
          field({ path: 'market.taxDragPct', label: 'Tax on gains', unit: '%/yr', step: 0.05 })) +
        field({ path: 'market.inflation', label: 'Inflation', unit: '%/yr', step: 0.1 }) +
        field({ path: 'market.depositReal', label: 'Deposit return above inflation', unit: '%/yr', step: 0.1, hint: 'Before tax' }) +
        field({ path: 'market.govReal', label: (ro ? 'Fidelis / Tezaur' : 'Government bonds') + ' above inflation', unit: '%/yr', step: 0.1 }) +
        field({ path: 'spending.cushionYears', label: 'Cash cushion', unit: 'yrs of spending', hint: 'Kept safe in cash, deposits or bonds' }) +
        field({ path: 'market.pensionFundFeePct', label: 'Pension fund fees', unit: '%/yr', step: 0.05 }) +
        field({ path: 'runs', label: 'Futures simulated', unit: 'runs', step: 100 }) +
        (localCur() !== 'EUR' ? field({ path: 'fxRates.' + localCur(), label: 'Exchange rate', unit: E.CURRENCIES[localCur()].unit + ' per €', step: 0.01 }) : '') +
      '</div>' +
      '<h3>Saved scenarios</h3><div class="row"><span class="inp"><input type="text" id="scenName" placeholder="Scenario name"></span>' +
        '<button type="button" class="btn" id="scenSave">Save</button></div><ul class="scen" id="scenList"></ul>' +
      '<button type="button" class="btn link" id="reset">Reset everything to the example</button>';

    // Country and currency come first: they decide the pension rules and the units of every amount below
    const curs = offered();
    form.innerHTML =
      '<div class="card"><div class="cardhead"><h2>About you</h2><div class="seg" id="who">' +
        '<button type="button" data-single="0" aria-pressed="' + !plan.single + '">The two of us</button>' +
        '<button type="button" data-single="1" aria-pressed="' + !!plan.single + '">Just me</button></div></div>' +
        '<div class="where">' + select('country', 'Where you work', Object.keys(E.COUNTRIES).map(code => [code, E.COUNTRIES[code].name])) +
          (curs.length > 1 ? '<div class="f"><span>Currency</span><div class="seg" id="currency" role="group" aria-label="Currency">' +
            curs.map(code => '<button type="button" data-cur="' + code + '" aria-pressed="' + (code === plan.currency) + '">' + E.CURRENCIES[code].label + '</button>').join('') + '</div></div>' : '') +
        '</div>' +
        '<p class="note where-note">' + (ro ? 'Uses Romania\'s official pension formula.'
          : c.mode === 'rate' ? 'Rough estimate for ' + esc(c.name) + ': the pension is a share of salary. Enter your exact pension below if you know it.'
            : 'No formula for other countries: enter each exact pension below.') + '</p>' +
        about +
        moneyBlock() +
      '</div>' +
      '<details class="card" id="adjust"><summary><h2>More settings</h2><span class="sumnote">Pension age, fees, returns, scenarios</span></summary>' + details + '</details>';
    // Sliders sit next to the answer so it can be watched while dragging
    $('play').innerHTML =
      Array.from({ length: count() }, (_, i) => slider('people.' + i + '.stopAge', (plan.people[i].name === 'You' ? 'You stop' : esc(plan.people[i].name || 'Person ' + (i + 1)) + ' stops') + ' working at', Math.min(74, plan.people[i].age), 75, 1)).join('') +
      slider('savings', count() > 1 ? 'You save together' : 'You save', 0, moneyMax(plan.savings, 15000 * k), roundNice(100 * k)) +
      slider('spending.monthly', 'You spend in retirement', roundNice(1000 * k), moneyMax(plan.spending.monthly, 30000 * k), roundNice(100 * k));
    open.forEach(id => { if ($(id)) $(id).open = true; });
    renderScenarios();
    updateSliderLabels();
    $('moneyNote').textContent = 'All amounts in today\'s ' + CUR().word + ', already adjusted for inflation.';
  }

  /* ---------- Accounts ---------- */

  const hasAccounts = () => Array.isArray(plan.accounts) && plan.accounts.length > 0;
  const accTotal = () => (plan.accounts || []).reduce((s, a) => s + (a.balance || 0), 0);
  const accName = type => E.accountLabel(type, plan.country);
  let confirmTotal = false;

  // About you: one total, or the list of accounts the quiz (or the editor) filled in
  function moneyBlock() {
    const both = plan.single ? 'Your savings and investments' : 'Your savings and investments together';
    if (!hasAccounts()) {
      return '<div class="grid2 sep">' + field({ path: 'liquid', label: both, money: true, wide: true, hint: 'Bank savings, deposits, ETFs and funds. Not pensions.' }) +
        '<button type="button" class="btn primary wide" data-quiz>Where is your money? 2-minute quiz</button></div>';
    }
    const items = plan.accounts.map(a => '<li><span>' + esc(accName(a.type)) + '</span><b>' + fmt(a.balance || 0) + '</b></li>').join('');
    return '<div class="sep accsum"><div class="f"><span>' + both + '</span></div><ul class="acclist">' + items +
      '<li class="tot"><span>Total</span><b>' + fmt(accTotal()) + '</b></li></ul>' +
      (confirmTotal
        ? '<div class="confirm" role="alert"><p>Replace your ' + plan.accounts.length + (plan.accounts.length === 1 ? ' account' : ' accounts') + ' with one total of ' + fmt(accTotal()) + '? Their own fees and taxes will no longer be used.</p>' +
          '<div class="row"><button type="button" class="btn primary" id="useTotalYes">Use one total</button><button type="button" class="btn" id="useTotalNo">Cancel</button></div></div>'
        : '<div class="row links"><button type="button" class="btn link" data-quiz>Edit answers</button><button type="button" class="btn link" id="useTotal">Use one total instead</button></div>') +
      '</div>';
  }

  // More settings: one row per account
  function accountEditor() {
    const types = Object.keys(E.ACCOUNT_TYPES);
    const rows = (plan.accounts || []).map((a, i) => {
      const kind = E.ACCOUNT_TYPES[a.type].kind, p = 'accounts.' + i + '.';
      return '<div class="acct"><label class="f wide"><span>Account ' + (i + 1) + '</span><span class="inp"><select data-acc-type="' + i + '" aria-label="Account ' + (i + 1) + ' type">' +
          types.map(t => '<option value="' + t + '"' + (t === a.type ? ' selected' : '') + '>' + esc(accName(t)) + '</option>').join('') + '</select></span></label>' +
        '<button type="button" class="btn del" data-acc-del="' + i + '" aria-label="Delete account ' + (i + 1) + '">Delete</button>' +
        field({ path: p + 'balance', label: 'Balance', money: true, wide: true }) +
        (kind === 'invest' || kind === 'generic' ? field({ path: p + 'stockPct', label: 'Stocks', unit: '%' }) : '<span></span>') +
        field({ path: p + 'feePct', label: 'Fee', unit: '%/yr', step: 0.05 }) +
        (kind === 'generic' ? '<span></span>' : field({ path: p + 'taxPct', label: 'Tax on gains', unit: '%', step: 0.5 })) + '</div>';
    }).join('');
    const to = plan.savingsTo == null ? -1 : plan.savingsTo;
    const dest = hasAccounts() ? '<label class="f wide"><span>New savings go to</span><span class="inp"><select data-savings-to>' +
      '<option value=""' + (to < 0 ? ' selected' : '') + '>Automatic (first investment account)</option>' +
      plan.accounts.map((a, i) => '<option value="' + i + '"' + (i === to ? ' selected' : '') + '>' + (i + 1) + '. ' + esc(accName(a.type)) + '</option>').join('') + '</select></span></label>' : '';
    return (rows ? '<div class="accts">' + rows + '</div>' : '<p class="note">All savings are one pot. Add accounts to give each its own fees and tax.</p>') +
      '<div class="row gap"><button type="button" class="btn" data-acc-add>Add account</button></div>' + (dest ? '<div class="gap">' + dest + '</div>' : '');
  }

  function renderScenarios() {
    const list = store.get(LS_SCENARIOS, []);
    $('scenList').innerHTML = list.map((s, i) =>
      '<li><span>' + esc(s.name) + '</span><button type="button" class="btn" data-load="' + i + '">Load</button>' +
      '<button type="button" class="btn" data-del="' + i + '" aria-label="Delete ' + esc(s.name) + '">Delete</button></li>').join('');
  }

  // Converts every amount at the plan's exchange rates, to whole units. Each amount remembers its figure
  // in every currency it has been shown in, so going back restores it exactly unless it was edited since.
  let fxMemo = {};
  function setCurrency(to) {
    if (to === plan.currency) return;
    const from = plan.currency, k = perEur(to) / perEur(from);
    MONEY().forEach(path => {
      const v = getPath(plan, path);
      if (typeof v !== 'number') { delete fxMemo[path]; return; }
      const m = fxMemo[path] && fxMemo[path].as === v ? fxMemo[path] : { values: {} };
      m.values[from] = v;
      const next = to in m.values ? m.values[to] : Math.round(v * k);
      m.values[to] = next; m.as = next;
      fxMemo[path] = m;
      setPath(plan, path, next);
    });
    plan.currency = to;
  }

  function applyCountry(code) {
    const c = E.COUNTRIES[code];
    plan.country = code;
    plan.pension.replacementPct = c.replacementPct;
    plan.pension.fullCareer = c.fullCareer;
    plan.pension.pillar2Pct = c.pillar2Pct;
    plan.people.forEach(p => { p.claimAge = c.pensionAge; p.p3UnlockAge = c.pillar3Unlock; });
    setCurrency(c.currency);
  }

  // Engine input: numbers forced into sane ranges so half-typed values cannot break a run
  function cleanPlan(raw) {
    const p = clone(raw), c = E.COUNTRIES[p.country] || E.COUNTRIES.MANUAL;
    const n = (v, d, lo, hi) => Math.min(hi, Math.max(lo, typeof v === 'number' && isFinite(v) ? v : d));
    const local = c.currency;
    if (p.currency !== 'EUR' && p.currency !== local) p.currency = local;
    p.fxRates = p.fxRates || {};
    Object.keys(E.CURRENCIES).forEach(code => { if (code !== 'EUR') p.fxRates[code] = n(p.fxRates[code], E.CURRENCIES[code].fx, 0.1, 1000); });
    p.fx = p.fxRates.RON;  // the engine converts Romanian rules from lei
    p.people = p.single ? [p.people[0]] : p.people;
    p.savings = n(p.savings, 0, 0, 1e9);
    p.people.forEach(x => {
      x.age = Math.round(n(x.age, 40, 18, 90));
      x.stopAge = Math.round(n(x.stopAge, x.age, x.age, 90));
      x.claimAge = Math.round(n(x.claimAge, c.pensionAge, 50, 80));
      if (c.mode === 'ro') x.claimAge = Math.max(x.claimAge, c.pensionAge - E.RO.earlyMaxYears);
      else x.earnType = 'employee';
      x.p3UnlockAge = Math.round(n(x.p3UnlockAge, 60, 40, 80));
      ['salary', 'pfaIncome', 'casCustom', 'volBase', 'yearsContributed', 'p2Balance', 'p3Balance', 'p3Contribution'].forEach(key => { x[key] = n(x[key], 0, 0, 1e12); });
      x.savings = p.savings / p.people.length;
      if (!x.hasP2) x.p2Balance = 0;
      if (!x.hasP3) { x.p3Balance = 0; x.p3Contribution = 0; }
      if (!x.knowPension) x.pensionOverride = null;
    });
    Object.keys(E.RO).forEach(key => { if (key in p.ro) p.ro[key] = n(p.ro[key], E.RO[key], key === 'avgGross' || key === 'vpr' ? 1 : 0, 1e9); });
    p.endAge = Math.round(n(p.endAge, 95, Math.max(70, Math.min.apply(null, p.people.map(x => x.age)) + 1), 110));
    p.liquid = n(p.liquid, 0, 0, 1e12);
    p.runs = Math.round(n(p.runs, 1000, 100, 5000));
    p.market.stockPct = n(p.market.stockPct, 60, 0, 100);
    p.market.pensionFundStockPct = n(p.market.pensionFundStockPct, 30, 0, 100);
    p.market.inflation = n(p.market.inflation, 3.5, -5, 50);
    p.market.depositReal = n(p.market.depositReal, 0.5, -10, 20);
    p.market.govReal = n(p.market.govReal, 1.5, -10, 20);
    p.spending.cushionYears = n(p.spending.cushionYears, 0, 0, 10);
    p.accounts = (Array.isArray(p.accounts) ? p.accounts : []).filter(a => a && E.ACCOUNT_TYPES[a.type]).map(a => {
      const d = E.accountDefaults(a.type, p.country);
      return { type: a.type, balance: n(a.balance, 0, 0, 1e12), stockPct: n(a.stockPct, d.stockPct, 0, 100), feePct: n(a.feePct, d.feePct, 0, 5), taxPct: n(a.taxPct, d.taxPct, 0, 50) };
    });
    const st = p.savingsTo;
    p.savingsTo = Number.isInteger(st) && st >= 0 && st < p.accounts.length ? st : null;
    return p;
  }

  /* ---------- Answer ---------- */

  const TARGET = 0.9;
  // Words instead of percentages
  function verdict(rate) {
    if (rate >= TARGET) return { rank: 2, cls: 'good', icon: '✓', text: 'Very likely' };
    if (rate >= 0.75) return { rank: 1, cls: 'warning', icon: '!', text: 'Likely' };
    return { rank: 0, cls: 'critical', icon: '✕', text: 'Risky' };
  }
  const pill = v => '<span class="status ' + v.cls + '"><i>' + v.icon + '</i>' + v.text + '</span>';
  const chance = p => E.simulate(p, { runs: p.runs, successOnly: true }).successRate;

  let last = null; // { plan, res }
  let lastRank = null, lastHead = null;

  const names = p => p.people.map((x, i) => x.name || 'Person ' + (i + 1));
  const agesAt = (p, t) => names(p).map((nm, i) => esc(nm) + ' ' + (p.people[i].age + t)).join(', ');
  const stopT = p => Math.max.apply(null, p.people.map(x => x.stopAge - x.age));

  // The three what-if moves, as edits to the raw plan
  function whatIfs() {
    const step = roundNice(100 * perEur(plan.currency));
    return [
      { label: 'Save ' + fmt(step) + ' more', apply: q => { q.savings = (q.savings || 0) + step; } },
      { label: 'Stop 3 years later', apply: q => q.people.forEach(x => { x.stopAge = Math.min(75, Math.max(x.stopAge, x.age) + 3); }) },
      { label: 'Spend 10% less', apply: q => { q.spending.monthly = Math.round(q.spending.monthly * 0.9 / 100) * 100; } }
    ];
  }

  function timeline(p, res) {
    const t0 = Math.max(0, stopT(p));
    const first = Math.min.apply(null, p.people.map((x, i) => (res.pensions[i].monthly > 0 ? x.claimAge - x.age : Infinity)));
    const tp = isFinite(first) ? Math.min(res.T, Math.max(t0, first)) : res.T;
    return { t0: Math.min(t0, res.T), tp, T: res.T, hasPension: isFinite(first), gap: Math.max(0, tp - t0) };
  }

  function renderVerdict(p, res) {
    const v = verdict(res.successRate), t = stopT(p);
    const changed = lastRank != null && lastRank !== v.rank;
    lastRank = v.rank;
    $('verdict').innerHTML = '<span>Your current plan: stop ' + (t <= 0 ? 'now' : 'in ' + (startYear + t)) + ' (' + agesAt(p, Math.max(0, t)) + '), spend ' + fmt(p.spending.monthly) + ' a month.</span>' +
      (changed ? pill(v).replace('class="status', 'class="status pop') : pill(v)) +
      '<span class="odds">works in ' + Math.round(res.successRate * 100) + ' of 100 futures</span>';
  }

  function renderExplain(p, res) {
    const c = country();
    p.people.forEach((x, i) => {
      const s = res.pensions[i], d = s.detail, from = ' from ' + (startYear + Math.max(0, x.claimAge - x.age)) + '.';
      const amount = 'State pension ≈ <b>' + fmt(s.monthly) + ' a month</b>' + from;
      let text;
      if (s.source === 'override') text = 'Using the pension you entered: <b>' + fmt(s.monthly) + ' a month</b>' + from;
      else if (s.source === 'missing') text = 'No estimate for this country – enter your exact pension.';
      else if (!d) text = amount + ' About ' + Math.round(p.pension.replacementPct * Math.min(1, s.years / p.pension.fullCareer)) + '% of salary after ' + s.years + ' years (' + esc(c.name) + ', approximate).';
      else {
        const why = x.earnType === 'dividends' ? 'Dividends don\'t build a state pension.'
          : d.baseYearly <= 0 ? (x.earnType === 'pfa' ? 'Below 12 minimum salaries the pension contribution is optional, so nothing is paid in.' : 'Nothing is paid in, so no pension builds up.')
            : null;
        const how = d.baseYearly > 0 ? 'Contributions are paid on ' + fmt(d.baseYearly) + ' a year, which earns ' + d.ppy.toFixed(2) + ' points a year. Each extra year of work adds about ' + fmt(d.perYear) + ' a month to the pension.' : '';
        text = (d.eligible ? amount : d.baseYearly <= 0 ? 'No state pension.' : 'No state pension: ' + d.years + ' contributed years by pension age, 15 are needed.') +
          (why ? ' ' + why : '') +
          (d.baseYearly <= 0 && x.pointsSoFar == null && x.yearsContributed > 0 ? ' If earlier years earned points, enter them under More settings.' : '') +
          (how ? ' <button type="button" class="btn link" data-how="' + i + '" aria-expanded="' + howOpen[i] + '">' + (howOpen[i] ? 'Hide' : 'How?') + '</button>' +
            (howOpen[i] ? '<span class="how">' + how + '</span>' : '') : '');
      }
      $('explain' + i).innerHTML = text;
    });
  }

  function renderTimeline(p, res) {
    const tl = timeline(p, res), pensions = res.pensions.reduce((a, s) => a + s.monthly, 0);
    const segs = [];
    if (tl.t0 > 0) segs.push({ years: tl.t0, color: 'var(--axis)', when: startYear + '–' + (startYear + tl.t0), what: 'Working and saving ' + fmt(p.savings) + ' a month' });
    if (tl.gap > 0) segs.push({ years: tl.gap, color: 'var(--s2)', when: (startYear + tl.t0) + '–' + (startYear + tl.tp), what: 'Living on savings' + (tl.hasPension ? ' for ' + tl.gap + ' years, until pensions start' : '') });
    if (tl.hasPension && tl.T > tl.tp) segs.push({ years: tl.T - tl.tp, color: 'var(--s1)', when: (startYear + tl.tp) + ' onward', what: 'State pension (about ' + fmt(pensions) + ' a month) plus savings' });
    // The bar keeps its three segments in place so their widths can ease between states
    const host = $('timeline');
    if (!host.firstChild) host.innerHTML = '<div class="tl" role="img" aria-label="Timeline of working, living on savings and pension years"><i></i><i></i><i></i></div><ul class="tlrows"></ul>';
    const slots = [['var(--axis)', tl.t0], ['var(--s2)', tl.gap], ['var(--s1)', tl.hasPension ? tl.T - tl.tp : 0]];
    Array.from(host.querySelectorAll('.tl i')).forEach((el, i) => {
      el.style.background = slots[i][0]; el.style.flexGrow = Math.max(0, slots[i][1]); el.classList.toggle('on', slots[i][1] > 0);
    });
    host.querySelector('.tlrows').innerHTML = segs.map(s => '<li><i class="key" style="background:' + s.color + '"></i><b>' + s.when + '</b><span>' + s.what + '</span></li>').join('');
  }

  // Headline, next steps and what-if previews: many simulations, so run after typing pauses
  function renderAnswer() {
    if (!last) return;
    const p = last.plan, res = last.res, both = p.people.length > 1 ? 'both ' : '';
    const solved = E.solveEarliest(p, TARGET, { runs: p.runs });
    last.solved = solved;
    let head;
    if (solved.k == null) head = 'With these numbers, stopping work before 75 is risky.';
    else {
      const same = p.people.every(x => x.stopAge === x.age + solved.k);
      head = 'You can ' + both + 'stop working ' + (solved.k === 0 ? 'now' : 'in ' + (startYear + solved.k)) +
        ' <span class="who">(' + agesAt(p, solved.k) + ')</span>' +
        (same ? '' : ' <button type="button" class="btn link" id="applySolve">Use ' + (solved.k === 0 ? 'now' : startYear + solved.k) + '</button>');
    }
    const el = $('headline');
    el.innerHTML = head;
    $('headnote').textContent = solved.k == null ? 'Try stopping later, saving more or spending less.' : 'The earliest year that works in at least 90 of 100 simulated market futures.';
    if (lastHead !== null && lastHead !== el.textContent) { el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }
    lastHead = el.textContent;

    const now = verdict(res.successRate), steps = [];
    const variant = edit => { const q = clone(p); edit(q); return q; };
    if (now.rank < 2) {
      for (let n = 1; n <= 10; n++) {
        const v = verdict(chance(variant(q => q.people.forEach(x => { x.stopAge = Math.min(75, x.stopAge + n); }))));
        if (v.rank > now.rank) { steps.push('Stopping work ' + n + (n === 1 ? ' year' : ' years') + ' later moves you from ' + now.text + ' to ' + v.text + '.'); break; }
      }
      for (const cut of [5, 10, 15, 20, 25, 30, 40]) {
        const v = verdict(chance(variant(q => { q.spending.monthly *= 1 - cut / 100; })));
        if (v.rank > now.rank) { steps.push('Spending ' + fmt(p.spending.monthly * cut / 100) + ' less a month moves you from ' + now.text + ' to ' + v.text + '.'); break; }
      }
    } else {
      let best = 0;
      for (const up of [5, 10, 15, 20, 30, 40, 50]) {
        if (chance(variant(q => { q.spending.monthly *= 1 + up / 100; })) >= TARGET) best = up; else break;
      }
      if (best) steps.push('You could spend ' + (best === 50 ? 'more than ' : 'up to ') + fmt(p.spending.monthly * (1 + best / 100)) + ' a month and still be Very likely.');
    }
    const tl = timeline(p, res);
    if (tl.gap > 0 && tl.hasPension) steps.push('Your savings need to last ' + tl.gap + (tl.gap === 1 ? ' year' : ' years') + ' before pensions start.');
    else if (!tl.hasPension) steps.push('No state pension in this plan: your savings have to pay for everything.');
    $('steps').innerHTML = steps.slice(0, 3).map(s => '<li>' + s + '</li>').join('');

    $('whatif').innerHTML = whatIfs().map((w, i) => {
      const raw = clone(plan); w.apply(raw);
      return '<button type="button" class="btn chip" data-whatif="' + i + '">' + w.label + ' <span>→ ' + verdict(chance(cleanPlan(raw))).text + '</span></button>';
    }).join('');
    $('answer').classList.remove('stale');
    renderMoney($('money'), p, res, { heavy: true });
    $('example').hidden = !plan.example;
  }

  /* ---------- Charts ---------- */

  function niceTicks(max, n) {
    if (!(max > 0)) return [0, 1];
    const raw = max / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
    const ticks = [];
    for (let v = 0; v < max + step * 0.999; v += step) ticks.push(v);
    return ticks;
  }

  /* ---------- Your money ---------- */

  const GROUPS = [
    { key: 'invest', label: 'Investments', color: 'var(--s1)' },
    { key: 'pots', label: 'Pension pots', color: 'var(--s2)' },
    { key: 'govbond', label: 'Government bonds', color: 'var(--s3)' },
    { key: 'cash', label: 'Cash and deposits', color: 'var(--s4)' }
  ];
  const groupOf = type => { const k = E.ACCOUNT_TYPES[type].kind; return k === 'invest' || k === 'generic' ? 'invest' : k === 'govbond' ? 'govbond' : 'cash'; };
  const pct1 = v => (Math.round(v * 10) / 10).toLocaleString('en-US') + '%';
  // Real yearly return of a safe account after its fee and tax
  function safeRate(p, a) {
    const k = E.ACCOUNT_TYPES[a.type].kind, m = p.market;
    const real = k === 'deposit' ? m.depositReal : k === 'govbond' ? m.govReal : k === 'cash' ? (1 / (1 + m.inflation / 100) - 1) * 100 : null;
    return real == null ? null : E.afterTaxReal(real - (a.feePct || 0), a.taxPct || 0, m.inflation);
  }
  const feeCache = {};
  // Years sooner with cheap fees: two solver runs, so only from the deferred pass and cached per plan
  function feeEffect(p) {
    const key = JSON.stringify([p.accounts, p.savings, p.spending, p.market, p.people.map(x => [x.age, x.salary, x.p2Balance, x.p3Balance, x.earnType, x.pensionOverride])]);
    if (key in feeCache) return feeCache[key];
    const cheap = clone(p);
    cheap.accounts.forEach(a => { if (E.ACCOUNT_TYPES[a.type].kind === 'invest' && a.feePct > 0.5) a.feePct = 0.2; });
    const a = E.solveEarliest(p, TARGET, { runs: 300 }).k, b = E.solveEarliest(cheap, TARGET, { runs: 300 }).k;
    return (feeCache[key] = a == null ? (b == null ? 0 : 1) : b == null ? 0 : a - b);
  }

  // Ring of where the money sits, what fees and taxes take, and a few plain facts
  function renderMoney(host, p, res, opts) {
    opts = opts || {};
    if (!p.accounts || !p.accounts.length) {
      host.innerHTML = '<div class="moneyempty"><p>See what fees and taxes cost you.</p><button type="button" class="btn primary" data-quiz>Take the 2-minute quiz</button></div>';
      return;
    }
    const sums = { invest: 0, pots: 0, govbond: 0, cash: 0 };
    p.accounts.forEach(a => { sums[groupOf(a.type)] += a.balance; });
    p.people.forEach(x => { sums.pots += (x.p2Balance || 0) + (x.p3Balance || 0); });
    const total = GROUPS.reduce((s, g) => s + sums[g.key], 0);
    const parts = GROUPS.filter(g => sums[g.key] > 0);

    // Ring: one arc per group, a 2px surface gap between them
    const R = 52, C = 2 * Math.PI * R, gap = parts.length > 1 ? 2 : 0;
    let at = 0, arcs = '';
    parts.forEach((g, i) => {
      const len = sums[g.key] / total * C;
      arcs += '<circle class="arc" data-i="' + i + '" r="' + R + '" cx="70" cy="70" fill="none" stroke="' + g.color + '" stroke-width="20"' +
        ' stroke-dasharray="' + Math.max(0.5, len - gap).toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + (-at).toFixed(2) + '"/>';
      at += len;
    });
    const ring = '<svg class="ring" viewBox="0 0 140 140" role="img" aria-label="Where your money is: ' +
      esc(parts.map(g => g.label + ' ' + Math.round(sums[g.key] / total * 100) + '%').join(', ')) + '"><g transform="rotate(-90 70 70)">' + arcs + '</g>' +
      '<text x="70" y="66" text-anchor="middle" class="rt">Total</text><text x="70" y="84" text-anchor="middle" class="rv">' + esc(compact(total)) + '</text></svg>';
    const legend = '<ul class="ringlegend">' + parts.map(g => '<li><i class="key" style="background:' + g.color + '"></i><span>' + g.label + '</span><b>' + fmt(sums[g.key]) +
      '</b><em>' + Math.round(sums[g.key] / total * 100) + '%</em></li>').join('') + '</ul>';

    // Sums along the typical path, up to the year everyone has stopped
    const stop = Math.max(0, Math.max.apply(null, p.people.map(x => x.stopAge - x.age)));
    const until = stop > 0 ? stop : res.T, rows = res.rows.slice(0, until);
    const put = rows.length ? rows[0].liquid + rows.reduce((s, r) => s + r.addedLiquid, 0) : 0;
    const add = k => rows.reduce((s, r) => s + r[k], 0);
    const fees = add('feePaid'), taxes = add('taxPaid');
    const nums = [['You put in', put], ['Growth added', add('growth')], ['Fees took', fees], ['Taxes took', taxes]];
    const when = stop > 0 ? 'By ' + (startYear + stop) + ', when you stop working' : 'Over the whole plan';

    // Facts, never advice
    const facts = [], liquid = p.accounts.reduce((s, a) => s + a.balance, 0);
    let worst = null;
    p.accounts.forEach(a => { const r = safeRate(p, a); if (r != null && r < 0 && a.balance > 0 && (!worst || a.balance * r < worst.loss)) worst = { a, loss: a.balance * r }; });
    if (worst) facts.push('Your ' + esc(accName(worst.a.type).replace(/^[A-Z]/, c => c.toLowerCase())) + ' grows slower than prices: about −' + fmt(-worst.loss) + ' a year in today\'s money.');
    const dear = p.accounts.filter(a => E.ACCOUNT_TYPES[a.type].kind === 'invest' && a.feePct > 0.5);
    if (dear.length && opts.heavy) {
      const yrs = feeEffect(p), top = Math.max.apply(null, dear.map(a => a.feePct));
      facts.push(yrs >= 1 ? 'With fees around 0.2% instead of ' + pct1(top) + ', you could stop ' + yrs + (yrs === 1 ? ' year' : ' years') + ' earlier.'
        : 'Fees take about ' + fmt(fees) + ' before you stop working.');
    } else if (!dear.length && fees >= 1) facts.push('Fees take about ' + fmt(fees) + ' before you stop working.');
    if (p.accounts.some(a => a.type === 'broker_foreign') && p.country === 'RO') {
      facts.push('Gains at a foreign broker are taxed 16% and declared by you in the Declarația unică; at a Romanian broker 3% (held over a year) or 6% (under a year), withheld for you.');
    }
    const cashy = p.accounts.filter(a => groupOf(a.type) === 'cash').reduce((s, a) => s + a.balance, 0);
    if (liquid > 0 && cashy / liquid > 0.5) facts.push('More than half of your savings is in cash and deposits.');

    host.innerHTML = '<div class="moneytop">' + ring + legend + '</div>' +
      '<p class="eyebrow">' + when + '</p><div class="stats">' + nums.map(n => '<div><span>' + n[0] + '</span><b>' + fmt(n[1]) + '</b></div>').join('') + '</div>' +
      (facts.length ? '<ul class="facts">' + facts.slice(0, 3).map(f => '<li>' + f + '</li>').join('') + '</ul>' : '');
    host.querySelectorAll('.arc').forEach(el => {
      const g = parts[+el.dataset.i];
      el.addEventListener('pointermove', ev => showTip('<b>' + g.label + '</b>' + tipRow(g.color, fmt(sums[g.key]), Math.round(sums[g.key] / total * 100) + '%'), ev));
      el.addEventListener('pointerleave', () => { tip.hidden = true; });
    });
  }

  const tip = $('tip');
  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - 14;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  }
  // Hover layer: maps the pointer to an index and reports it
  function attachHover(host, geom, onIndex) {
    const svg = host.querySelector('svg'), cross = svg.querySelector('.cross');
    const leave = () => { cross.style.display = 'none'; tip.hidden = true; };
    svg.addEventListener('pointermove', ev => {
      const r = svg.getBoundingClientRect();
      const i = geom.indexAt((ev.clientX - r.left) / r.width * geom.W);
      if (i == null) return leave();
      const cx = geom.xOf(i);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.style.display = '';
      showTip(onIndex(i), ev);
    });
    svg.addEventListener('pointerleave', leave);
  }
  const tipRow = (color, label, value, line) => '<div class="r"><span><i class="key' + (line ? ' line' : '') + '" style="background:' + color + '"></i>' + label + '</span><span>' + value + '</span></div>';

  function renderWealth(p, res) {
    const W = Math.max(320, $('wealthChart').clientWidth || 760), H = Math.round(Math.min(340, Math.max(250, W * 0.48)));
    const m = { l: 52, r: 16, t: 46, b: 30 }, T = res.T, B = res.bands;
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const ticks = niceTicks(Math.max.apply(null, B.p90), 4), ymax = ticks[ticks.length - 1];
    const x = t => m.l + t / T * pw, y = v => m.t + ph - Math.min(v, ymax) / ymax * ph;
    const path = arr => arr.map((v, t) => (t ? 'L' : 'M') + x(t).toFixed(1) + ' ' + y(v).toFixed(1)).join('');
    const band = path(B.p90) + B.p10.map((v, i) => [x(i), y(v)]).reverse().map(q => 'L' + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('') + 'Z';

    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Savings over time: typical outcome with a better and worse range">';
    ticks.forEach(v => {
      s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--' + (v ? 'grid' : 'axis') + ')"/>' +
        '<text x="' + (m.l - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + compact(v) + '</text>';
    });
    const stepX = T / 5 * 34 > pw ? 10 : 5;
    for (let yr = Math.ceil(startYear / stepX) * stepX; yr <= startYear + T; yr += stepX) {
      s += '<text x="' + x(yr - startYear) + '" y="' + (H - 10) + '" text-anchor="middle">' + yr + '</text>';
    }
    // Milestones sharing a year are merged into one numbered marker, listed under the chart
    const groups = [];
    res.milestones.forEach(ms => {
      const g = groups.find(q => q.t === ms.t);
      if (g) g.labels.push(ms.label); else groups.push({ t: ms.t, labels: [ms.label] });
    });
    let prevX = -99, prevRow = 1;
    groups.forEach((g, i) => {
      const gx = x(g.t), row = gx - prevX < 20 ? 1 - prevRow : 0, cy = 11 + row * 20;
      prevX = gx; prevRow = row;
      s += '<line x1="' + gx + '" x2="' + gx + '" y1="' + (cy + 9) + '" y2="' + (m.t + ph) + '" stroke="var(--axis)"/>' +
        '<circle cx="' + gx + '" cy="' + cy + '" r="9" fill="var(--surface)" stroke="var(--ink2)"/>' +
        '<text class="ms" x="' + gx + '" y="' + (cy + 4) + '" text-anchor="middle">' + (i + 1) + '</text>';
    });
    $('wealthMilestones').innerHTML = groups.map(g => '<li><b>' + (startYear + g.t) + '</b> ' + esc(g.labels.join(' · ')) + '</li>').join('');
    s += '<path d="' + band + '" fill="var(--s1)" opacity=".14"/>' +
      '<path d="' + path(B.p50) + '" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<line class="cross" y1="' + m.t + '" y2="' + (m.t + ph) + '" stroke="var(--ink2)" style="display:none"/></svg>';
    $('wealthChart').innerHTML = s;
    $('wealthLegend').innerHTML =
      '<span><i class="key line" style="background:var(--s1)"></i>What to expect</span>' +
      '<span><i class="key" style="background:var(--s1);opacity:.3"></i>Could be better / could be worse</span>';
    attachHover($('wealthChart'), {
      W, xOf: x,
      indexAt: vx => (vx < m.l - 4 || vx > W - m.r + 4 ? null : Math.min(T, Math.max(0, Math.round((vx - m.l) / pw * T))))
    }, t => '<b>' + (startYear + t) + '</b><div class="ages">' + agesAt(p, t) + '</div>' +
      tipRow('var(--s1)', 'Could be better', fmt(B.p90[t])) + tipRow('var(--s1)', 'What to expect', fmt(B.p50[t]), true) +
      tipRow('var(--s1)', 'Could be worse', fmt(B.p10[t])) +
      res.milestones.filter(q => q.t === t).map(q => '<div class="ages">' + esc(q.label) + '</div>').join(''));
  }

  const series = () => [
    { key: 'pension', label: 'State pensions', color: 'var(--s1)' },
    { key: 'other', label: 'Other income', color: 'var(--s2)' },
    { key: 'fromLiquid', label: 'Savings and investments', color: 'var(--s3)' },
    { key: 'fromP3', label: country().pillar3, color: 'var(--s4)' },
    { key: 'fromP2', label: country().mode === 'ro' ? 'Pilon II' : 'Pillar II', color: 'var(--s5)' },
    { key: 'shortfall', label: 'Not covered', color: 'var(--critical)' }
  ];

  function renderIncome(p, res) {
    const SERIES = series();
    const rows = res.rows.filter(r => r.phase === 'retired').map(r => {
      // Income above the target is saved, so cap what is shown at the amount actually spent
      const q = Object.assign({}, r), income = r.pension + r.other;
      if (income > r.target) { q.pension = r.pension * r.target / income; q.other = r.other * r.target / income; }
      return q;
    });
    const host = $('incomeChart');
    $('incomeLegend').innerHTML = '';
    if (!rows.length) { host.innerHTML = '<p class="empty">Nobody has stopped working within the plan.</p>'; return; }
    const W = Math.max(320, host.clientWidth || 760), H = Math.round(Math.min(320, Math.max(240, W * 0.45))), m = { l: 52, r: 16, t: 14, b: 30 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b, n = rows.length, slot = pw / n;
    const bw = Math.min(24, Math.max(2, slot - 2));
    const ticks = niceTicks(Math.max.apply(null, rows.map(r => r.target)) / 12, 4), ymax = ticks[ticks.length - 1];
    const y = v => m.t + ph - v / ymax * ph, cx = i => m.l + slot * (i + 0.5);

    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Monthly income by source for each retirement year, against spending">';
    ticks.forEach(v => {
      s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="var(--' + (v ? 'grid' : 'axis') + ')"/>' +
        '<text x="' + (m.l - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + compact(v) + '</text>';
    });
    const stepX = slot * 5 < 34 ? 10 : 5;
    rows.forEach((r, i) => {
      const yr = startYear + r.t;
      if (yr % stepX === 0) s += '<text x="' + cx(i) + '" y="' + (H - 10) + '" text-anchor="middle">' + yr + '</text>';
      const segs = SERIES.filter(q => r[q.key] / 12 > ymax * 0.002);
      let acc = 0;
      segs.forEach((q, j) => {
        const v = r[q.key] / 12, y1 = y(acc + v), y0 = y(acc), top = j === segs.length - 1;
        const h = Math.max(0.5, y0 - y1 - (top ? 0 : 2)), x0 = cx(i) - bw / 2, rr = top ? Math.min(4, bw / 2, h) : 0;
        // 2px surface gap between segments; only the data end is rounded
        s += '<path fill="' + q.color + '" d="M' + x0 + ' ' + (y1 + h) + 'V' + (y1 + rr) + 'q0 ' + -rr + ' ' + rr + ' ' + -rr + 'h' + (bw - 2 * rr) +
          'q' + rr + ' 0 ' + rr + ' ' + rr + 'V' + (y1 + h) + 'Z"/>';
        acc += v;
      });
    });
    let line = '';
    rows.forEach((r, i) => {
      const yy = y(r.target / 12).toFixed(1);
      line += (i ? 'L' : 'M') + (m.l + slot * i).toFixed(1) + ' ' + yy + 'L' + (m.l + slot * (i + 1)).toFixed(1) + ' ' + yy;
    });
    s += '<path d="' + line + '" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>' +
      '<line class="cross" y1="' + m.t + '" y2="' + (m.t + ph) + '" stroke="var(--ink2)" style="display:none"/></svg>';
    host.innerHTML = s;
    const used = SERIES.filter(q => rows.some(r => r[q.key] > 0));
    $('incomeLegend').innerHTML = used.map(q => '<span><i class="key" style="background:' + q.color + '"></i>' + esc(q.label) + '</span>').join('') +
      '<span><i class="key line" style="background:var(--ink)"></i>Spending</span>';
    attachHover(host, {
      W, xOf: cx,
      indexAt: vx => (vx < m.l || vx > W - m.r ? null : Math.min(n - 1, Math.floor((vx - m.l) / slot)))
    }, i => {
      const r = rows[i];
      return '<b>' + (startYear + r.t) + '</b><div class="ages">' + agesAt(p, r.t) + '</div>' +
        SERIES.filter(q => r[q.key] > 0.5).map(q => tipRow(q.color, esc(q.label), fmt(r[q.key] / 12))).join('') +
        tipRow('var(--ink)', 'Spending', fmt(r.target / 12), true);
    });
  }

  function renderTable(p, res) {
    const mo = v => (v > 0.5 ? fmt(v / 12) : '–'), S = series();
    const head = ['Year', 'Ages', '', 'Spending /mo', 'State pension /mo', 'Other income /mo', 'From savings /mo', 'From ' + esc(S[3].label) + ' /mo', 'From ' + S[4].label + ' /mo', 'Not covered /mo',
      'Savings and investments', esc(S[3].label), S[4].label, 'Total if worse', 'Total expected', 'Total if better'];
    const body = res.rows.map(r => '<tr><td>' + (startYear + r.t) + '</td><td>' + p.people.map(x => x.age + r.t).join(' / ') + '</td><td>' +
      (r.phase === 'working' ? 'Working' : 'Retired') + '</td><td>' + mo(r.target) + '</td><td>' + mo(r.pension) + '</td><td>' + mo(r.other) + '</td><td>' +
      mo(r.fromLiquid) + '</td><td>' + mo(r.fromP3) + '</td><td>' + mo(r.fromP2) + '</td><td class="' + (r.shortfall > 0.5 ? 'short' : '') + '">' + mo(r.shortfall) + '</td><td>' +
      fmt(r.liquid) + '</td><td>' + fmt(r.p3) + '</td><td>' + fmt(r.p2) + '</td><td>' + fmt(res.bands.p10[r.t]) + '</td><td>' + fmt(res.bands.p50[r.t]) + '</td><td>' + fmt(res.bands.p90[r.t]) + '</td></tr>').join('');
    $('table').innerHTML = '<table><thead><tr>' + head.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function renderNotes(p) {
    const c = country(), R = p.ro;
    const items = [
      'Everything is in today\'s prices: growth is counted above inflation and state pensions are assumed to keep pace with prices.',
      p.runs.toLocaleString('en-US') + ' possible futures for the markets are simulated year by year. Very likely means the plan pays for every year in at least 90 of 100 futures, Likely in at least 75, Risky in fewer.',
      'While anyone still works, earnings are assumed to cover living costs and the monthly saving continues (split equally between you; a person\'s share stops when they stop working). Withdrawals start the year everyone has stopped.',
      'Money is taken first from savings and investments, then from ' + c.pillar3 + ' once it unlocks, then from Pillar II once the state pension starts.',
      c.mode === 'ro'
        ? 'Romanian state pension: points per year = monthly contribution base ÷ average gross salary (' + R.avgGross.toLocaleString('en-US') + ' lei). Employees: gross salary. PFA: nothing below 12 minimum salaries of yearly income, 12 minimum salaries up to 24, and 24 above. Dividends: nothing. A year counts only if it earns points. Extra "stability" points are added for long careers (0.5 a year for years 26–30, 0.75 for 31–35, 1 above 35). Pension = total points × ' + R.vpr + ' lei, never below the social minimum (' + R.socialMin.toLocaleString('en-US') + ' lei), and zero under 15 contributed years. ' + R.pensionTaxPct + '% is deducted from the part above ' + R.taxFreeThreshold.toLocaleString('en-US') + ' lei. Claiming up to 5 years early costs 0.4% a month. Only employees pay into Pilon II.'
        : c.mode === 'rate'
          ? c.name + ': approximate preset. Pension = share of gross salary × (years contributed ÷ full career), treated as net.'
          : 'No formula for this country: enter each exact pension.',
      'Past years are assumed to have earned points at today\'s rate unless you enter the points from your statement. Worth confirming with an accountant: whether a PFA may declare a base above 24 minimum salaries, that a PFA pays nothing into Pilon II, and which minimum salary applies to the 2026 base.',
      'Each account grows by its own rules: investments follow their stock/bond mix, a deposit earns ' + p.market.depositReal + '% and ' + (c.mode === 'ro' ? 'Fidelis/Tezaur' : 'government bonds') + ' ' + p.market.govReal + '% a year above inflation, and cash loses inflation (' + p.market.inflation + '% a year). Fees come off every year.',
      'Tax is charged every year on the gain before inflation, so a deposit can lose money in today\'s terms. ' + (c.mode === 'ro'
        ? 'Romania 2026 rates: deposits 10%, Fidelis/Tezaur 0%, Romanian broker and bank funds 3% (6% if held under a year; taxing it yearly instead of on sale is a simplification), foreign broker 16%. CASS on investment income is not included: 10% of 6, 12 or 24 minimum salaries once that income passes those levels; worth confirming with an accountant.'
        : 'Tax rates outside Romania start at 0%; enter yours for each account.'),
      'Withdrawals come from all accounts in proportion to their balances, which keeps the mix steady. With a cash cushion, spending comes from the investments in normal years and the safe accounts are refilled to the chosen number of years; after a year when markets fell, spending comes from the safe money first.',
      'Not included: taxes and payout rules on Pilon II/III, career phases (for example employee before, PFA now), wage growth, and one partner outliving the other. This is a planning aid, not financial advice.'
    ];
    $('notes').innerHTML = items.map(t => '<li>' + esc(t) + '</li>').join('');
  }

  /* ---------- Compute ---------- */

  function renderYearByYear() {
    if (last && $('yearCard').open) { renderIncome(last.plan, last.res); renderTable(last.plan, last.res); }
  }

  let timer = null;
  // The plan's own result renders immediately (it follows the sliders); the search-heavy answer follows
  function compute() {
    const p = cleanPlan(plan);
    const res = E.simulate(p, { runs: p.runs });
    last = { plan: p, res };
    renderVerdict(p, res); renderExplain(p, res); renderTimeline(p, res); renderWealth(p, res); renderYearByYear(); renderNotes(p);
    $('answer').classList.add('stale');
    clearTimeout(timer);
    timer = setTimeout(renderAnswer, 180);
  }
  function changed() {
    if (hasAccounts()) plan.liquid = accTotal();
    store.set(LS_CURRENT, plan); compute();
  }
  function refresh() { renderForm(); changed(); }

  /* ---------- Events ---------- */

  function onInput(ev) {
    const el = ev.target, path = el.dataset.path;
    if (!path || el.tagName === 'SELECT') return;
    plan.example = false;
    if (el.hasAttribute('data-money')) {
      const v = parseFloat(el.value.replace(/[^\d.]/g, ''));
      setPath(plan, path, isNaN(v) ? (el.hasAttribute('data-optional') ? null : 0) : v);
      return changed();
    }
    if (el.type === 'checkbox') { setPath(plan, path, el.checked); return el.hasAttribute('data-rerender') ? refresh() : changed(); }
    if (el.type === 'text') setPath(plan, path, el.value);
    else {
      const v = el.value === '' ? null : parseFloat(el.value);
      setPath(plan, path, v == null || isNaN(v) ? (el.hasAttribute('data-optional') ? null : 0) : v);
    }
    if (el.type === 'range') paintSlider(el);
    changed();
  }
  $('form').addEventListener('input', onInput);
  $('play').addEventListener('input', onInput);
  $('form').addEventListener('change', ev => {
    const el = ev.target, path = el.dataset.path;
    if (path) plan.example = false;
    if (el.hasAttribute('data-money')) { el.value = grouped(getPath(plan, path)); return; }
    if (el.dataset.accType != null) {
      const i = +el.dataset.accType, old = plan.accounts[i];
      plan.accounts[i] = Object.assign(E.accountDefaults(el.value, plan.country), { balance: old.balance });
      return refresh();
    }
    if (el.hasAttribute('data-savings-to')) { plan.savingsTo = el.value === '' ? null : +el.value; return refresh(); }
    if (el.tagName === 'SELECT' && path) {
      if (path === 'country') applyCountry(el.value); else setPath(plan, path, el.value);
      refresh();
    } else if (path && (el.hasAttribute('data-rerender') || el.type === 'text') && el.type !== 'checkbox') {
      // Age and names feed slider ranges and labels
      plan.people.forEach(x => { if (typeof x.age === 'number' && x.stopAge < x.age) x.stopAge = x.age; });
      refresh();
    }
  });
  $('form').addEventListener('click', ev => {
    const t = ev.target.closest('button');
    if (!t) return;
    if (!t.dataset.how && t.id !== 'reset') plan.example = false;
    const list = store.get(LS_SCENARIOS, []);
    if (t.hasAttribute('data-quiz')) { if (window.RetQuiz) window.RetQuiz.open(); }
    else if (t.id === 'useTotal') { confirmTotal = true; renderForm(); $('useTotalYes').focus(); }
    else if (t.id === 'useTotalNo') { confirmTotal = false; renderForm(); $('useTotal').focus(); }
    else if (t.id === 'useTotalYes') { plan.liquid = accTotal(); plan.accounts = []; plan.savingsTo = null; confirmTotal = false; fxMemo = {}; refresh(); }
    else if (t.hasAttribute('data-acc-add')) {
      plan.accounts = (plan.accounts || []).concat([E.accountDefaults(hasAccounts() ? 'broker_ro' : 'generic', plan.country)]);
      // The first account takes over the single pot so nothing is lost
      if (plan.accounts.length === 1) Object.assign(plan.accounts[0], { balance: plan.liquid || 0, stockPct: plan.market.stockPct, feePct: plan.market.feePct });
      fxMemo = {}; refresh();
    } else if (t.dataset.accDel != null) {
      const i = +t.dataset.accDel;
      plan.accounts.splice(i, 1);
      if (plan.savingsTo != null) plan.savingsTo = plan.savingsTo === i ? null : plan.savingsTo > i ? plan.savingsTo - 1 : plan.savingsTo;
      plan.liquid = accTotal(); fxMemo = {}; refresh();
    }
    else if (t.dataset.cur) { setCurrency(t.dataset.cur); refresh(); }
    else if (t.dataset.single != null) { plan.single = t.dataset.single === '1'; refresh(); }
    else if (t.dataset.toggle) { setPath(plan, t.dataset.toggle, !getPath(plan, t.dataset.toggle)); refresh(); }
    else if (t.dataset.how != null) { howOpen[+t.dataset.how] = !howOpen[+t.dataset.how]; if (last) renderExplain(last.plan, last.res); }
    else if (t.id === 'scenSave') {
      const name = $('scenName').value.trim() || 'Scenario ' + (list.length + 1);
      const at = list.findIndex(s => s.name === name), entry = { name, plan: clone(plan) };
      if (at >= 0) list[at] = entry; else list.push(entry);
      store.set(LS_SCENARIOS, list); $('scenName').value = ''; renderScenarios();
    } else if (t.id === 'reset') { plan = defaultPlan(); fxMemo = {}; confirmTotal = false; refresh(); }
    else if (t.dataset.load != null) { plan = hydrate(list[+t.dataset.load].plan); fxMemo = {}; refresh(); }
    else if (t.dataset.del != null) { list.splice(+t.dataset.del, 1); store.set(LS_SCENARIOS, list); renderScenarios(); }
  });
  $('answer').addEventListener('click', ev => {
    const t = ev.target.closest('button');
    if (!t) return;
    plan.example = false;
    if (t.id === 'applySolve' && last && last.solved && last.solved.k != null) {
      plan.people.forEach(x => { x.stopAge = x.age + last.solved.k; });
      refresh();
    } else if (t.dataset.whatif != null) { whatIfs()[+t.dataset.whatif].apply(plan); refresh(); }
  });
  $('yearCard').addEventListener('toggle', renderYearByYear);
  $('example').addEventListener('click', ev => {
    if (ev.target.id !== 'exampleGo') return;
    const f = $('form').querySelector('input[data-path="people.0.age"]');
    f.scrollIntoView({ behavior: 'smooth', block: 'center' }); f.focus({ preventScroll: true }); f.select();
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (last) { renderWealth(last.plan, last.res); renderYearByYear(); } }, 150);
  });

  $('money').addEventListener('click', ev => { if (ev.target.closest('[data-quiz]') && window.RetQuiz) window.RetQuiz.open(); });
  if (window.RetQuiz) {
    window.RetQuiz.mount({
      getPlan: () => plan,
      setPlan: p => { plan = p; fxMemo = {}; confirmTotal = false; refresh(); $('answer').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
      cleanPlan, renderMoney, startYear
    });
  }

  // Entrance animation runs once, not on later re-renders
  document.body.classList.add('intro');
  setTimeout(() => document.body.classList.remove('intro'), 900);
  refresh();
})();
