/* "Where is your money?" quiz. The questions are data; applyQuiz() turns answers into a plan
   without touching the page. mount() wires the full-screen panel to the app. */
(function (root) {
  'use strict';
  const E = root.RetEngine;
  const clone = o => JSON.parse(JSON.stringify(o));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Money helpers that only need the plan
  const perEur = p => (p.currency === 'EUR' ? 1 : (p.fxRates && p.fxRates[p.currency] > 0 ? p.fxRates[p.currency] : E.CURRENCIES[p.currency].fx));
  const scale = p => perEur(p) / 5.1;  // amounts below are written in lei
  const money = (p, v) => {
    const c = E.CURRENCIES[p.currency] || E.CURRENCIES.EUR, s = Math.round(v).toLocaleString('en-US');
    return c.prefix ? c.unit + s : s + ' ' + c.unit;
  };
  // "€2k–10k" or "10k–50k lei": the unit is written once per label
  const kilo = v => (v >= 1e6 ? +(v / 1e6).toFixed(1) + 'M' : v >= 1000 ? Math.round(v / 1000) + 'k' : String(Math.round(v)));
  const withUnit = (p, s) => { const c = E.CURRENCIES[p.currency] || E.CURRENCIES.EUR; return c.prefix ? c.unit + s : s + ' ' + c.unit; };

  // Range chips for "about how much": bounds and midpoints in lei, scaled to the plan's currency
  const BOUNDS = [10000, 50000, 200000], MIDS = [5000, 30000, 100000, 300000];
  const ranges = p => {
    const b = BOUNDS.map(x => E.roundNice(x * scale(p))), m = MIDS.map(x => E.roundNice(x * scale(p)));
    return [
      { label: 'Under ' + withUnit(p, kilo(b[0])), mid: m[0] },
      { label: withUnit(p, kilo(b[0]) + '–' + kilo(b[1])), mid: m[1] },
      { label: withUnit(p, kilo(b[1]) + '–' + kilo(b[2])), mid: m[2] },
      { label: withUnit(p, kilo(b[2]) + '+'), mid: m[3] }
    ];
  };

  const isRO = p => p.country === 'RO';
  const label = (p, type) => E.accountLabel(type, p.country);
  const ACCOUNT_KEYS = ['cash', 'deposit', 'govbond', 'broker_ro', 'broker_foreign', 'fund'];
  const INVEST_KEYS = ['broker_ro', 'broker_foreign', 'fund'];

  // What can be ticked under "Where is your money?"
  function places(p) {
    const p3 = (E.COUNTRIES[p.country] || E.COUNTRIES.MANUAL).pillar3;
    return ACCOUNT_KEYS.map(k => ({ v: k, label: label(p, k) }))
      .concat([{ v: 'p3', label: p3 }, { v: 'property', label: 'Property you rent out' }])
      .filter(o => isRO(p) || (o.v !== 'p3' && o.v !== 'govbond'));
  }

  /* ---------- Risk: three questions, scores summed ---------- */
  const RISK = [
    { id: 'crash', ask: 'Your 100,000 drops to 70,000 in a crash. What do you do?', options: [['0', 'Sell'], ['1', 'Wait'], ['2', 'Buy more']] },
    { id: 'when', ask: 'When will you need most of this money?', options: [['0', 'Within 5 years'], ['1', 'In 5–15 years'], ['2', 'In 15+ years']] },
    { id: 'sleep', ask: 'Sleep well or grow faster?', options: [['0', 'Sleep well'], ['1', 'Both'], ['2', 'Grow faster']] }
  ];
  function riskProfile(answers) {
    const r = answers.risk;
    if (!r || r === 'unsure') return { name: 'Balanced', stockPct: 60, score: null };
    const score = RISK.reduce((s, q) => s + (r[q.id] == null ? 1 : +r[q.id]), 0);
    return score <= 2 ? { name: 'Safe', stockPct: 30, score } : score <= 4 ? { name: 'Balanced', stockPct: 60, score } : { name: 'Growth', stockPct: 90, score };
  }

  const INSIDE = { index: 100, stocks: 100, bonds: 10, mix: 60 };
  const FEES = { low: 0.2, bank: 2.0 };
  const chosen = a => (Array.isArray(a.where) ? a.where : []);
  const invests = a => a.invest !== 'no';
  const hasInvest = a => invests(a) && chosen(a).some(k => INVEST_KEYS.indexOf(k) >= 0);

  // Where new savings can go: what they already have, plus an index fund and a deposit
  function targets(p, a) {
    const have = invests(a) ? chosen(a).filter(k => ACCOUNT_KEYS.indexOf(k) >= 0) : [];
    const out = have.map(k => ({ v: k, label: label(p, k) }));
    if (have.indexOf('broker_ro') < 0) out.push({ v: 'broker_ro', label: 'An index fund (ETF)', hint: isRO(p) ? 'At a Romanian broker' : '' });
    if (have.indexOf('deposit') < 0) out.push({ v: 'deposit', label: 'Bank deposit' });
    return out;
  }

  /* ---------- Questions ---------- */
  const QUESTIONS = [
    {
      id: 'invest', type: 'single', ask: 'Do you invest anything today?',
      options: () => [{ v: 'yes', label: 'Yes' }, { v: 'bank', label: 'Only savings in the bank' }, { v: 'no', label: 'Not yet' }],
      // "Only savings in the bank" starts the next question with a deposit ticked
      after: a => { if (a.invest === 'bank' && !chosen(a).length) a.where = ['deposit']; }
    },
    {
      id: 'where', type: 'multi', ask: 'Where is your money?', hint: 'Tick everything that applies.',
      when: invests, options: places
    },
    {
      id: 'amounts', type: 'amounts', ask: 'About how much is in each?', hint: 'A rough range is fine.',
      when: a => invests(a) && chosen(a).length > 0
    },
    {
      id: 'savings', type: 'slider', ask: 'How much do you save each month, together?',
      hint: 'Everything you put aside, before it goes anywhere.'
    },
    {
      id: 'inside', type: 'single', ask: 'What\'s mostly inside your investment accounts?', when: hasInvest,
      options: () => [{ v: 'index', label: 'World or S&P 500 index fund' }, { v: 'stocks', label: 'Individual stocks' }, { v: 'bonds', label: 'Bonds' }, { v: 'mix', label: 'A mix' }]
    },
    {
      id: 'fee', type: 'single', ask: 'Do you know the yearly fee?', hint: 'Applies to all your investment accounts. You can fine-tune each one later.', when: hasInvest,
      options: () => [{ v: 'low', label: 'Low-cost ETF', hint: 'About 0.2% a year' }, { v: 'bank', label: 'Bank fund', hint: 'About 1.5–2.5% a year' }]
    },
    { id: 'risk', type: 'risk', ask: 'How do you feel about ups and downs?' },
    {
      id: 'savingsTo', type: 'single', ask: 'Where do your new savings go?', options: targets
    },
    {
      id: 'flexible', type: 'single', ask: 'In retirement, if markets fall, could you spend a bit less for a year?',
      options: () => [{ v: 'yes', label: 'Yes' }, { v: 'no', label: 'No' }]
    },
    {
      id: 'cushion', type: 'single', ask: 'Keep 2 years of spending safe in cash or bonds?',
      hint: 'In a bad year you would live off this and leave investments to recover.',
      options: () => [{ v: 'yes', label: 'Yes' }, { v: 'no', label: 'No' }]
    },
    { id: 'results', type: 'results', ask: 'Here is your money' }
  ];
  const visible = a => QUESTIONS.filter(q => !q.when || q.when(a));

  /* ---------- Answers to plan (pure) ---------- */
  function applyQuiz(plan, answers) {
    const p = clone(plan), a = answers || {}, mix = riskProfile(a).stockPct;
    const amounts = a.amounts || {}, rs = ranges(p);
    const amountOf = k => {
      const x = amounts[k] || {};
      if (typeof x.exact === 'number' && isFinite(x.exact) && x.exact >= 0) return x.exact;
      return rs[x.chip == null ? 1 : x.chip].mid;  // not sure: the 10–50k middle
    };
    const where = invests(a) ? chosen(a) : [];

    p.accounts = where.filter(k => ACCOUNT_KEYS.indexOf(k) >= 0).map(k => Object.assign(E.accountDefaults(k, p.country), { balance: amountOf(k) }));
    if (where.indexOf('p3') >= 0) {
      p.people[0].hasP3 = true;
      p.people[0].p3Balance = amountOf('p3');
    }
    if (where.indexOf('property') >= 0) {
      const rent = (amounts.property || {}).exact;
      p.spending.otherIncome = typeof rent === 'number' && rent > 0 ? rent : 0;
    }
    if (typeof a.savings === 'number' && a.savings >= 0) p.savings = a.savings;

    p.accounts.forEach(acc => {
      if (E.ACCOUNT_TYPES[acc.type].kind !== 'invest') return;
      acc.stockPct = a.inside in INSIDE ? INSIDE[a.inside] : mix;
      if (a.fee in FEES) acc.feePct = FEES[a.fee];
    });

    // New savings: an account they have, or a new one with nothing in it yet
    let to = a.savingsTo;
    if (!to || to === 'unsure') {
      const first = p.accounts.findIndex(x => E.ACCOUNT_TYPES[x.type].kind === 'invest');
      to = first >= 0 ? p.accounts[first].type : p.accounts.length ? p.accounts[0].type : 'broker_ro';
    }
    let idx = p.accounts.findIndex(x => x.type === to);
    if (idx < 0) {
      const acc = E.accountDefaults(to, p.country);
      if (E.ACCOUNT_TYPES[to].kind === 'invest') acc.stockPct = mix;
      p.accounts.push(acc);
      idx = p.accounts.length - 1;
    }
    p.savingsTo = idx;

    p.spending.flexible = a.flexible === 'yes';
    p.spending.cushionYears = a.cushion === 'yes' ? 2 : 0;
    p.liquid = p.accounts.reduce((s, x) => s + x.balance, 0);
    p.quiz = clone(a);
    p.example = false;
    return p;
  }

  /* ---------- Panel ---------- */
  function mount(app) {
    const host = document.getElementById('quiz');
    if (!host) return;
    let answers = {}, step = 0, base = null, previewTimer = null, lastFocus = null, advanceTimer = null;
    const reduce = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

    host.innerHTML =
      '<div class="qtop"><div class="qprog" role="progressbar" aria-label="Quiz progress" aria-valuemin="0" aria-valuemax="100"><i></i></div>' +
        '<button type="button" class="btn qclose" data-q="close" aria-label="Close without saving">×</button></div>' +
      '<div class="qscroll"><div class="qbody"><p class="qstep" id="qStep"></p><h2 id="qAsk" tabindex="-1"></h2><p class="qhint" id="qHint"></p><div id="qMain"></div></div></div>' +
      '<div class="qfoot"><p class="qpreview" id="qPreview" aria-live="polite"></p>' +
        '<div class="qnav"><button type="button" class="btn" data-q="back">Back</button><button type="button" class="btn primary" data-q="next">Next</button></div></div>';
    host.setAttribute('aria-labelledby', 'qAsk');
    const $ = id => document.getElementById(id);

    const steps = () => visible(answers);
    const current = () => steps()[Math.min(step, steps().length - 1)];

    function card(v, text, pressed, hint, attrs) {
      return '<button type="button" class="qcard" data-v="' + esc(v) + '"' + (attrs || '') + ' aria-pressed="' + !!pressed + '">' +
        '<span>' + esc(text) + '</span>' + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</button>';
    }
    const unsure = on => '<button type="button" class="qcard unsure" data-v="unsure" aria-pressed="' + !!on + '"><span>I\'m not sure</span></button>';

    function body(q, p) {
      const val = answers[q.id];
      if (q.type === 'single') {
        return '<div class="qopts" role="group" aria-labelledby="qAsk">' + q.options(p, answers).map(o => card(o.v, o.label, val === o.v, o.hint)).join('') + unsure(val === 'unsure') + '</div>';
      }
      if (q.type === 'multi') {
        const on = chosen(answers);
        return '<div class="qopts grid" role="group" aria-labelledby="qAsk">' + q.options(p).map(o => card(o.v, o.label, on.indexOf(o.v) >= 0)).join('') + unsure(val === 'unsure') + '</div>';
      }
      if (q.type === 'amounts') {
        const rs = ranges(p), am = answers.amounts || {}, names = {};
        places(p).forEach(o => { names[o.v] = o.label; });
        return '<div class="qrows">' + chosen(answers).map(k => {
          const x = am[k] || {};
          if (k === 'property') {
            return '<div class="qrow"><b>Rent you get per month, after costs</b><label class="inp"><input type="text" inputmode="numeric" data-exact="property" value="' +
              (x.exact != null ? Math.round(x.exact).toLocaleString('en-US') : '') + '" placeholder="Amount" aria-label="Rent per month"><em>' + esc(E.CURRENCIES[p.currency].unit) + '</em></label></div>';
          }
          return '<div class="qrow" data-row="' + k + '"><b>' + esc(names[k] || k) + '</b><div class="qchips" role="group" aria-label="' + esc(names[k] || k) + '">' +
            rs.map((r, i) => '<button type="button" class="btn chip" data-amt="' + k + '" data-chip="' + i + '" aria-pressed="' + (x.exact == null && x.chip === i) + '">' + esc(r.label) + '</button>').join('') +
            '</div><label class="inp"><input type="text" inputmode="numeric" data-exact="' + k + '" value="' + (x.exact != null ? Math.round(x.exact).toLocaleString('en-US') : '') +
            '" placeholder="Or the exact amount" aria-label="Exact amount, ' + esc(names[k] || k) + '"><em>' + esc(E.CURRENCIES[p.currency].unit) + '</em></label></div>';
        }).join('') + '</div><div class="qopts">' + unsure(val === 'unsure') + '</div>';
      }
      if (q.type === 'slider') {
        const k = scale(p), max = Math.max(E.roundNice(15000 * k) * 2, Math.ceil((answers.savings != null ? answers.savings : p.savings) / 1000) * 1000);
        const v = answers.savings != null ? answers.savings : p.savings;
        return '<label class="sl qsl"><span>Each month<b id="qSave">' + esc(money(p, v)) + '</b></span>' +
          '<input type="range" id="qSaveIn" min="0" max="' + max + '" step="' + E.roundNice(100 * k) + '" value="' + v + '"></label>' +
          '<div class="qopts">' + unsure(val === 'unsure') + '</div>';
      }
      if (q.type === 'risk') {
        const r = typeof answers.risk === 'object' && answers.risk ? answers.risk : {};
        const done = RISK.every(x => r[x.id] != null), prof = riskProfile(answers);
        return RISK.map(x => '<div class="qgroup"><p>' + esc(x.ask) + '</p><div class="qopts row" role="group" aria-label="' + esc(x.ask) + '">' +
            x.options.map(o => card(o[0], o[1], r[x.id] === o[0], '', ' data-risk="' + x.id + '"')).join('') + '</div></div>').join('') +
          (done || answers.risk === 'unsure' ? '<div class="qresult"><b>Your mix: ' + prof.name + ', about ' + prof.stockPct + '% stocks</b>' +
            '<small>This only sets the example mix for the calculation. It is not investment advice.</small></div>' : '') +
          '<div class="qopts">' + unsure(answers.risk === 'unsure') + '</div>';
      }
      if (q.type === 'results') return '<div id="qMoney" class="qmoney"></div>';
      return '';
    }

    function render(focusFirst) {
      const list = steps(), q = current(), p = base, i = list.indexOf(q), total = list.length;
      $('qStep').textContent = q.type === 'results' ? 'All done' : 'Question ' + (i + 1) + ' of ' + (total - 1);
      $('qAsk').textContent = q.ask;
      $('qHint').textContent = q.hint || '';
      $('qHint').hidden = !q.hint;
      $('qMain').innerHTML = body(q, p);
      const bar = host.querySelector('.qprog');
      bar.firstChild.style.width = Math.round(i / (total - 1) * 100) + '%';
      bar.setAttribute('aria-valuenow', String(Math.round(i / (total - 1) * 100)));
      host.querySelector('[data-q="back"]').disabled = i === 0;
      const next = host.querySelector('[data-q="next"]');
      next.textContent = q.type === 'results' ? 'See my plan' : 'Next';
      // Animate only when arriving at a question, not when an answer re-renders it
      if (focusFirst && !reduce()) { const b = host.querySelector('.qbody'); b.classList.remove('in'); void b.offsetWidth; b.classList.add('in'); }
      if (q.type === 'results') results();
      if (focusFirst) {
        const first = host.querySelector('#qMain .qcard, #qMain .chip, #qMain input');
        (first || $('qAsk')).focus({ preventScroll: true });
      }
      preview();
    }

    function go(d) {
      clearTimeout(advanceTimer);
      const total = steps().length;
      step = Math.max(0, Math.min(total - 1, steps().indexOf(current()) + d));
      host.querySelector('.qscroll').scrollTop = 0;
      render(true);
    }

    function preview() {
      clearTimeout(previewTimer);
      const el = $('qPreview');
      el.classList.add('stale');
      previewTimer = setTimeout(() => {
        const p = app.cleanPlan(applyQuiz(base, answers)), s = E.solveEarliest(p, 0.9, { runs: 300 });
        const both = p.people.length > 1 ? 'both ' : '';
        el.innerHTML = s.k == null ? 'With these answers: stopping work before 75 is risky.'
          : 'With these answers: you can ' + both + 'stop in <b>' + (s.k === 0 ? 'now' : app.startYear + s.k) + '</b>';
        el.classList.remove('stale');
      }, 200);
    }

    function results() {
      const p = app.cleanPlan(applyQuiz(base, answers));
      const res = E.simulate(p, { runs: 300 });
      app.renderMoney($('qMoney'), p, res, { heavy: true });
    }

    function pick(q, v, el) {
      if (q.type === 'single') {
        answers[q.id] = v;
        if (q.after) q.after(answers);
        host.querySelectorAll('#qMain .qcard').forEach(b => b.setAttribute('aria-pressed', String(b === el)));
        preview();
        clearTimeout(advanceTimer);
        advanceTimer = setTimeout(() => go(1), reduce() ? 0 : 220);
      } else if (q.type === 'multi') {
        if (v === 'unsure') { answers.where = ['deposit']; return go(1); }
        else {
          const on = chosen(answers).slice(), at = on.indexOf(v);
          if (at >= 0) on.splice(at, 1); else on.push(v);
          answers.where = on;
        }
        const keep = el.dataset.v;
        render(false);
        const again = host.querySelector('#qMain .qcard[data-v="' + keep + '"]');
        if (again) again.focus({ preventScroll: true });
      } else if (q.type === 'risk') {
        if (v === 'unsure') { answers.risk = 'unsure'; return go(1); }
        const r = typeof answers.risk === 'object' && answers.risk ? answers.risk : {};
        r[el.dataset.risk] = v; answers.risk = r;
        const id = el.dataset.risk;
        render(false);
        const again = host.querySelector('#qMain .qcard[data-risk="' + id + '"][data-v="' + v + '"]');
        if (again) again.focus({ preventScroll: true });
      } else if (v === 'unsure') {
        // Amounts and the savings slider: keep the defaults and move on
        if (q.type === 'amounts') answers.amounts = {};
        if (q.type === 'slider') delete answers.savings;
        go(1);
      }
    }

    host.addEventListener('click', ev => {
      const t = ev.target.closest('button');
      if (!t) return;
      const q = current();
      if (t.dataset.q === 'close') return close();
      if (t.dataset.q === 'back') return go(-1);
      if (t.dataset.q === 'next') return q.type === 'results' ? finish() : go(1);
      if (t.dataset.amt) {
        const am = answers.amounts = answers.amounts || {};
        am[t.dataset.amt] = { chip: +t.dataset.chip, exact: null };
        const inp = host.querySelector('input[data-exact="' + t.dataset.amt + '"]');
        if (inp) inp.value = '';
        host.querySelectorAll('[data-amt="' + t.dataset.amt + '"]').forEach(b => b.setAttribute('aria-pressed', String(b === t)));
        return preview();
      }
      if (t.classList.contains('qcard')) pick(q, t.dataset.v, t);
    });
    host.addEventListener('input', ev => {
      const t = ev.target;
      if (t.id === 'qSaveIn') {
        answers.savings = +t.value;
        $('qSave').textContent = money(base, answers.savings);
        t.style.setProperty('--p', (t.value / t.max * 100) + '%');
        return preview();
      }
      if (t.dataset.exact) {
        const v = parseFloat(t.value.replace(/[^\d.]/g, ''));
        const am = answers.amounts = answers.amounts || {};
        am[t.dataset.exact] = { chip: null, exact: isNaN(v) ? null : v };
        host.querySelectorAll('[data-amt="' + t.dataset.exact + '"]').forEach(b => b.setAttribute('aria-pressed', 'false'));
        preview();
      }
    });
    host.addEventListener('change', ev => {
      const t = ev.target;
      if (t.dataset.exact) { const x = (answers.amounts || {})[t.dataset.exact]; t.value = x && x.exact != null ? Math.round(x.exact).toLocaleString('en-US') : ''; }
    });
    host.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); return close(); }
      // Arrow keys move between the cards (and chips) of one group
      if (/^Arrow(Up|Down|Left|Right)$/.test(ev.key) && ev.target.matches('.qcard, .chip')) {
        const group = Array.from(ev.target.parentNode.querySelectorAll('.qcard, .chip'));
        const d = ev.key === 'ArrowDown' || ev.key === 'ArrowRight' ? 1 : -1;
        const nxt = group[(group.indexOf(ev.target) + d + group.length) % group.length];
        if (nxt) { ev.preventDefault(); nxt.focus(); }
      }
      // Keep Tab inside the dialog
      if (ev.key === 'Tab') {
        const f = Array.from(host.querySelectorAll('button:not([disabled]), input, [tabindex="0"]')).filter(x => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      }
    });

    function open() {
      base = clone(app.getPlan());
      answers = base.quiz ? clone(base.quiz) : {};
      if (answers.savings == null) answers.savings = base.savings;
      step = 0;
      lastFocus = document.activeElement;
      host.hidden = false;
      document.body.classList.add('quiz-open');
      render(true);
    }
    function close() {
      clearTimeout(previewTimer); clearTimeout(advanceTimer);
      host.hidden = true;
      document.body.classList.remove('quiz-open');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function finish() {
      const p = applyQuiz(app.getPlan(), answers);
      close();
      app.setPlan(p);
    }
    api.open = open;
    api.close = close;
  }

  const api = { QUESTIONS, RISK, applyQuiz, riskProfile, ranges, places, visible, mount };
  root.RetQuiz = api;
})(typeof window !== 'undefined' ? window : globalThis);
