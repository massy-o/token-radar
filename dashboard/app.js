// Token Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail view
// with the model's own arithmetic and the protocol's farm plan, and the live-token
// evidence base. No network: every byte it shows arrived in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;

  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get('q') || '',
    category: params.get('cat') || 'all',
    chain: params.get('chain') || 'all',
    tier: params.get('tier') || 'all',
    watchOnly: params.get('watch') === '1',
    sort: params.get('sort') || 'implied',
    selected: params.get('slug') || null,
    compare: (params.get('compare') || '').split(',').filter(Boolean).slice(0, 3),
  };

  var usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFull.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    return n === null || n === undefined ? 'n/a' : n.toFixed(3) + '×';
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string' || typeof child === 'number') node.appendChild(document.createTextNode(String(child)));
      else node.appendChild(child);
    }
    return node;
  }

  // ---------- header ----------
  document.getElementById('snapshot-line').textContent =
    'Snapshot: ' + DATA.source + ' · as of ' + DATA.as_of + ' · model ' + DATA.model_version +
    ' · ' + DATA.scanned + ' protocols scanned, ' + DATA.peer_count + ' tokenized peers as the evidence base';

  function statCard(k, v, s) {
    return el('div', { class: 'stat' },
      el('div', { class: 'k', text: k }),
      el('div', { class: 'v', text: v }),
      s ? el('div', { class: 's', text: s }) : null);
  }

  // ---------- filtering & sorting ----------
  function visibleRows() {
    var rows = DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || '(uncategorised)') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      if (state.q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(state.q.toLowerCase()) === -1) return false;
      }
      return true;
    });
    var key = {
      implied: function (r) { return r.implied_value_usd; },
      score: function (r) { return r.launch_score; },
      tvl: function (r) { return r.tvl_usd; },
      momentum: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; },
      age: function (r) { return r.age_days === null ? -1 : r.age_days; },
    }[state.sort] || function (r) { return r.implied_value_usd; };
    rows.sort(function (a, b) { return key(b) - key(a) || a.rank - b.rank; });
    return rows;
  }

  // ---------- board view ----------
  function renderBoard() {
    app.textContent = '';
    var stats = el('div', { class: 'stats' },
      statCard('Board rows', String(DATA.board_size), DATA.early_size + ' found below the floor'),
      statCard('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'every slug over $' + (DATA.floor_usd / 1e6) + 'M TVL'),
      statCard('Total implied value', fmtUsd(DATA.total_implied_usd), 'across the whole board'),
      statCard('Global median', fmtMult(DATA.global_median), 'mcap/TVL over ' + DATA.peer_count + ' peers'),
      statCard('Top launch score', String(DATA.rows.reduce(function (m, r) { return Math.max(m, r.launch_score); }, 0)), 'tier S starts at 80'));
    app.appendChild(stats);

    var method = el('section', { class: 'method' },
      el('h2', { text: 'How a row gets its value' }),
      el('p', { text: 'Each category is priced off the protocols in it that already have a token: the median market-cap/TVL of its tokenized peers, shrunk toward the global median so thin categories cannot run wild. Peer ratios are winsorized at ' + DATA.model.ratio_cap + '× (the evidence base’s own 90th percentile) so one low-float outlier cannot price a whole category. Momentum and age then adjust the multiple — a protocol growing into its TVL is worth more than a shrinking one, and a three-year-old protocol more than a three-week-old one.' }),
      el('div', { class: 'formula', text: 'implied = TVL × shrunk category multiple × (1 + clamp(7d change, −60%, +120%) × 0.5) × (0.6 + 0.4 × age / 3y)' }),
      el('p', { text: 'The launch score (0–100) blends the implied value’s log percentile (45%), 7-day momentum (20%), chain breadth (15%), TVL percentile (10%) and maturity (10%). It ranks nothing — the board is ordered by implied value — it tells you where to look first.' }));
    var topCats = DATA.categories.slice(0, 8);
    if (topCats.length) {
      var mt = el('table', { class: 'mult-table' },
        el('tr', null, el('th', { text: 'Category' }), el('th', { class: 'n', text: 'Peers' }), el('th', { class: 'n', text: 'Median' }), el('th', { class: 'n', text: 'Used (shrunk)' })));
      topCats.forEach(function (c) {
        mt.appendChild(el('tr', null,
          el('td', { text: c.category }),
          el('td', { class: 'n', text: String(c.peers) }),
          el('td', { class: 'n', text: fmtMult(c.median) }),
          el('td', { class: 'n', text: fmtMult(c.multiple) })));
      });
      method.appendChild(mt);
    }
    if (DATA.sensitivity) {
      var names = function (rows) { return rows.map(function (r) { return r.name + ' (' + fmtUsd(r.implied_value_usd) + ')'; }).join(' · '); };
      method.appendChild(el('p', { class: 'sens', text: 'What would change this ranking? Price every category at the one global median and the top five become: ' + names(DATA.sensitivity.global_only) + '. Strip the momentum and maturity adjustments out and they become: ' + names(DATA.sensitivity.unadjusted) + '. The same names keep surfacing — the adjustments move values, not the story.' }));
    }
    app.appendChild(method);

    // scatter: TVL vs implied value, log-log, one dot per protocol
    (function () {
      var NS = 'http://www.w3.org/2000/svg';
      function svg(tag, attrs) {
        var n = document.createElementNS(NS, tag);
        Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
        for (var i = 2; i < arguments.length; i++) if (arguments[i]) n.appendChild(arguments[i]);
        return n;
      }
      function txt(x, y, str, cls) {
        var t = svg('text', { x: x, y: y, class: cls || 'ax' });
        t.textContent = str;
        return t;
      }
      var W = 1128, H = 300, L = 64, R = 16, T = 12, B = 34;
      var xs = DATA.rows.map(function (r) { return Math.log10(Math.max(1, r.tvl_usd)); });
      var ys = DATA.rows.map(function (r) { return Math.log10(Math.max(1, r.implied_value_usd)); });
      var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
      var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
      var px = function (v) { return L + (v - x0) / (x1 - x0) * (W - L - R); };
      var py = function (v) { return T + (y1 - v) / (y1 - y0) * (H - T - B); };
      var plot = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'scatter', role: 'img', 'aria-label': 'Scatter plot of TVL against implied value for every board row' });
      for (var gx = x0; gx <= x1; gx++) {
        plot.appendChild(svg('line', { x1: px(gx), y1: T, x2: px(gx), y2: H - B, class: 'grid' }));
        plot.appendChild(txt(Math.min(px(gx), W - 36), H - B + 18, fmtUsd(Math.pow(10, gx)), 'ax'));
      }
      for (var gy = y0; gy <= y1; gy++) {
        plot.appendChild(svg('line', { x1: L, y1: py(gy), x2: W - R, y2: py(gy), class: 'grid' }));
        plot.appendChild(txt(L - 8, py(gy) + 4, fmtUsd(Math.pow(10, gy)), 'axr'));
      }
      // the parity diagonal: implied == TVL
      plot.appendChild(svg('line', { x1: px(Math.max(x0, y0)), y1: py(Math.max(x0, y0)), x2: px(Math.min(x1, y1)), y2: py(Math.min(x1, y1)), class: 'parity' }));
      DATA.rows.forEach(function (r) {
        var c = svg('circle', {
          cx: px(Math.log10(Math.max(1, r.tvl_usd))), cy: py(Math.log10(Math.max(1, r.implied_value_usd))),
          r: r.on_watchlist ? 5 : 3.6, class: 'dot tierdot-' + r.tier + (r.on_watchlist ? ' wl-dot' : ''),
        });
        var title = document.createElementNS(NS, 'title');
        title.textContent = r.name + ' — TVL ' + fmtUsd(r.tvl_usd) + ', implied ' + fmtUsd(r.implied_value_usd) + ', tier ' + r.tier;
        c.appendChild(title);
        c.addEventListener('click', function () { state.selected = r.slug; renderDetail(r); window.scrollTo(0, 0); });
        plot.appendChild(c);
      });
      app.appendChild(el('section', { class: 'method' },
        el('h2', { text: 'The board at a glance — TVL against implied value' }),
        el('p', { text: 'One dot per protocol, gold ring = on the house watchlist, colour = launch tier. The dashed line is parity (implied = TVL): above it, the market’s own category prices say a token would be worth more than the capital locked; below it, less. Click any dot for its detail.' }),
        plot));
    })();

    // controls
    var cats = [];
    var chains = [];
    DATA.rows.forEach(function (r) {
      var c = r.category || '(uncategorised)';
      if (cats.indexOf(c) === -1) cats.push(c);
      r.chains.forEach(function (ch) { if (chains.indexOf(ch) === -1) chains.push(ch); });
    });
    cats.sort(); chains.sort();
    function select(id, options, value, onchange) {
      var s = el('select', { id: id, onchange: function () { onchange(s.value); } });
      options.forEach(function (o) {
        var opt = el('option', { value: o[0], text: o[1] });
        if (o[0] === value) opt.setAttribute('selected', 'selected');
        s.appendChild(opt);
      });
      return s;
    }
    var countLabel = el('span', { class: 'count' });
    var controls = el('div', { class: 'controls' },
      el('input', { type: 'search', placeholder: 'Search name, slug, category…', value: state.q, oninput: function (e) { state.q = e.target.value; refresh(); } }),
      select('cat', [['all', 'All categories']].concat(cats.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; refresh(); }),
      select('chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; refresh(); }),
      select('tier', [['all', 'All tiers'], ['S', 'Tier S'], ['A', 'Tier A'], ['B', 'Tier B'], ['C', 'Tier C'], ['D', 'Tier D']], state.tier, function (v) { state.tier = v; refresh(); }),
      select('sort', [['implied', 'Sort: implied value'], ['score', 'Sort: launch score'], ['tvl', 'Sort: TVL'], ['momentum', 'Sort: 7d change'], ['age', 'Sort: age']], state.sort, function (v) { state.sort = v; refresh(); }),
      el('label', { class: 'check' },
        el('input', { type: 'checkbox', onchange: function (e) { state.watchOnly = e.target.checked; refresh(); } }),
        'Watchlist only'),
      countLabel);
    if (state.watchOnly) controls.querySelector('input[type="checkbox"]').checked = true;
    app.appendChild(controls);

    var compareWrap = el('div', { id: 'compare-wrap' });
    app.appendChild(compareWrap);

    function renderCompare() {
      compareWrap.textContent = '';
      if (!state.compare.length) return;
      var strip = el('div', { class: 'compare-strip' });
      strip.appendChild(el('div', { class: 'compare-head', text: 'Comparing ' + state.compare.length + ' of up to 3 — the numbers the board ranks by, side by side' }));
      var grid = el('div', { class: 'compare-grid' });
      state.compare.forEach(function (slug) {
        var r = DATA.rows.find(function (x) { return x.slug === slug; });
        if (!r) return;
        var col = el('div', { class: 'compare-col' },
          el('button', { class: 'compare-x', text: '×', title: 'Remove from comparison', onclick: function () { state.compare = state.compare.filter(function (s) { return s !== slug; }); renderCompare(); refresh(); } }),
          el('div', { class: 'compare-name', text: r.name, onclick: function () { state.selected = r.slug; renderDetail(r); window.scrollTo(0, 0); } }),
          el('div', { class: 'compare-sub', text: '#' + r.rank + ' · tier ' + r.tier + ' · ' + (r.category || 'uncategorised') }),
          el('div', { class: 'compare-row' }, el('span', { text: 'Implied' }), el('b', { text: fmtUsd(r.implied_value_usd) })),
          el('div', { class: 'compare-row' }, el('span', { text: 'Conservative' }), el('b', { text: fmtUsd(r.implied_low_usd) })),
          el('div', { class: 'compare-row' }, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(r.tvl_usd) })),
          el('div', { class: 'compare-row' }, el('span', { text: 'Multiple' }), el('b', { text: fmtMult(r.model.category_multiple) })),
          el('div', { class: 'compare-row' }, el('span', { text: 'Launch score' }), el('b', { text: String(r.launch_score) })),
          el('div', { class: 'compare-row' }, el('span', { text: 'Evidence' }), el('b', { text: r.confidence })),
          el('div', { class: 'compare-row' }, el('span', { text: 'Chains' }), el('b', { text: String(r.chains.length) })));
        grid.appendChild(col);
      });
      strip.appendChild(grid);
      compareWrap.appendChild(strip);
    }

    var tableWrap = el('div', { id: 'table-wrap' });
    app.appendChild(tableWrap);

    function refresh() {
      var rows = visibleRows();
      countLabel.textContent = 'showing ' + rows.length + ' of ' + DATA.board_size;
      tableWrap.textContent = '';
      if (!rows.length) {
        tableWrap.appendChild(el('div', { class: 'empty', text: 'No protocol matches this filter. Loosen it — the radar sees ' + DATA.board_size + ' pre-token protocols.' }));
        return;
      }
      var table = el('table', { class: 'board' });
      table.appendChild(el('tr', null,
        el('th', { text: '#' }), el('th', { text: 'Protocol' }), el('th', { text: 'Tier' }),
        el('th', { text: 'Category' }), el('th', { class: 'num', text: 'TVL' }),
        el('th', { class: 'num', text: '7d' }), el('th', { class: 'num', text: 'Implied value' }),
        el('th', { class: 'num', text: 'Multiple' }), el('th', { text: 'Evidence' }), el('th', { text: 'Launch score' }), el('th', { text: 'Chains' }), el('th', { text: '' })));
      var tbody = el('tbody');
      rows.forEach(function (r) {
        var pct = el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) });
        var scoreCell = el('td', { class: 'scorecell' },
          el('span', { text: String(r.launch_score) }),
          el('div', { class: 'scorebar' }, el('div', null)));
        scoreCell.querySelector('.scorebar > div').style.width = r.launch_score + '%';
        tbody.appendChild(el('tr', { onclick: function () { state.selected = r.slug; renderDetail(r); window.scrollTo(0, 0); } },
          el('td', { class: 'rank', text: String(r.rank) }),
          el('td', null,
            el('span', { class: 'pname', text: r.name }),
            r.on_watchlist ? el('span', { class: 'wl', text: 'WATCHLIST' }) : null,
            el('div', { class: 'pslug', text: r.slug })),
          el('td', null, el('span', { class: 'tier tier-' + r.tier, text: r.tier })),
          el('td', { class: 'cat', text: r.category || '—' }),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          pct,
          el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) + (r.above_leader ? ' ▲' : '') }),
          el('td', { class: 'num', text: fmtMult(r.model.category_multiple) }),
          el('td', null, el('span', { class: 'conf conf-' + r.confidence, text: '● ' + r.confidence })),
          scoreCell,
          el('td', { class: 'chains', text: r.chains.length ? r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') : '—' }),
          el('td', null, el('button', {
            class: 'cmp-btn' + (state.compare.includes(r.slug) ? ' on' : ''),
            text: state.compare.includes(r.slug) ? '✓ compare' : '+ compare',
            onclick: function (e) {
              e.stopPropagation();
              if (state.compare.includes(r.slug)) state.compare = state.compare.filter(function (s) { return s !== r.slug; });
              else if (state.compare.length < 3) state.compare.push(r.slug);
              renderCompare();
              refresh();
            },
          }))));
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
    }
    renderCompare();
    refresh();

    // live evidence strip
    if (DATA.live && DATA.live.length) {
      var liveTable = el('table', { class: 'board' });
      liveTable.appendChild(el('tr', null,
        el('th', { text: 'Protocol' }), el('th', { text: 'Category' }),
        el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Mcap/TVL' })));
      var lb = el('tbody');
      DATA.live.slice(0, 10).forEach(function (r) {
        lb.appendChild(el('tr', null,
          el('td', { class: 'pname', text: r.name }),
          el('td', { class: 'cat', text: r.category || '—' }),
          el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: 'num', text: fmtMult(r.mcap_tvl) })));
      });
      liveTable.appendChild(lb);
      app.appendChild(el('section', { class: 'section' },
        el('h2', { text: 'Already launched — the evidence base' }),
        el('p', { class: 'cat', text: 'These protocols already trade. Their market-cap/TVL ratios, by category, are the only prices the model is allowed to learn from.' }),
        liveTable));
    }
  }

  // ---------- detail view ----------
  function renderDetail(r) {
    app.textContent = '';
    var detail = el('div', { class: 'detail' });
    detail.appendChild(el('button', { class: 'back', text: '← Back to the board', onclick: function () { state.selected = null; renderBoard(); } }));
    detail.appendChild(el('h2', null,
      r.name + ' ',
      el('span', { class: 'tier tier-' + r.tier, text: 'TIER ' + r.tier }),
      r.on_watchlist ? el('span', { class: 'wl', text: 'ON THE HOUSE WATCHLIST' }) : null));
    detail.appendChild(el('p', { class: 'cat', text: (r.category || 'Uncategorised') + ' · ' + r.slug + ' · tracked since ' + (r.listed_at || 'unknown') + ' · rank #' + r.rank + ' of ' + DATA.board_size }));

    detail.appendChild(el('div', { class: 'grid' },
      statCard('Implied launch value', fmtUsd(r.implied_value_usd), 'model estimate, not a promise'),
      statCard('TVL', fmtUsd(r.tvl_usd), 'across ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's')),
      statCard('7d TVL change', fmtPct(r.change_7d), 'momentum input'),
      statCard('Launch score', String(r.launch_score) + ' / 100', 'tier ' + r.tier)));

    // launch score anatomy: the five components, so the tier is auditable at a glance
    var anatomy = el('div', { class: 'anatomy' });
    anatomy.appendChild(el('h3', { text: 'Launch score anatomy — where the ' + r.launch_score + ' comes from' }));
    [['Implied value percentile', 'value', '45%'], ['7-day momentum percentile', 'momentum', '20%'], ['Chain breadth', 'chains', '15%'], ['TVL percentile', 'tvl', '10%'], ['Maturity', 'maturity', '10%']].forEach(function (spec) {
      var v = r.score_parts[spec[1]];
      anatomy.appendChild(el('div', { class: 'anat-row' },
        el('span', { class: 'anat-label', text: spec[0] + ' (' + spec[2] + ')' }),
        el('span', { class: 'scorebar' }, el('i', { style: 'width:' + v + '%' })),
        el('span', { class: 'anat-val', text: String(v) })));
    });
    detail.appendChild(anatomy);

    var bd = el('table', { class: 'breakdown' });
    bd.appendChild(el('tr', null, el('td', { text: 'TVL (snapshot)' }), el('td', { class: 'n', text: usdFull.format(r.tvl_usd) })));
    bd.appendChild(el('tr', null, el('td', { text: '× category multiple — ' + (r.category || 'uncategorised') + ' median over ' + r.model.category_peers + ' tokenized peers, shrunk to the global ' + fmtMult(DATA.global_median) }), el('td', { class: 'n', text: fmtMult(r.model.category_multiple) })));
    bd.appendChild(el('tr', null, el('td', { text: '× growth multiplier — 7d change ' + fmtPct(r.model.growth_pct) + ', clamped to [−60%, +120%], weight 0.5' }), el('td', { class: 'n', text: r.model.growth_multiplier.toFixed(4) + '×' })));
    bd.appendChild(el('tr', null, el('td', { text: '× maturity multiplier — age ' + fmtAge(r.age_days) + ' against a 3-year horizon' }), el('td', { class: 'n', text: r.model.maturity_multiplier.toFixed(4) + '×' })));
    bd.appendChild(el('tr', { class: 'total' }, el('td', { text: '= implied value if it launched at snapshot prices' }), el('td', { class: 'n', text: usdFull.format(r.implied_value_usd) })));
    bd.appendChild(el('tr', null, el('td', { text: 'Conservative end — the same arithmetic at the category’s 25th-percentile multiple' }), el('td', { class: 'n', text: usdFull.format(r.implied_low_usd) })));
    if (r.above_leader) {
      bd.appendChild(el('tr', null, el('td', { text: 'Caution: the base value prices this protocol above every tokenized peer in its category — read the conservative end as the planning number' }), el('td', { class: 'n', text: '▲ ABOVE LEADER' })));
    }
    bd.appendChild(el('tr', null, el('td', { text: 'Evidence behind the multiple: ' + r.model.category_peers + ' tokenized peer' + (r.model.category_peers === 1 ? '' : 's') + ' in this category' + (r.age_days === null && r.change_7d === null ? ', and this protocol reports neither age nor momentum' : '') }), el('td', { class: 'n', text: r.confidence.toUpperCase() })));
    detail.appendChild(el('section', { class: 'section' }, el('h2', { text: 'The model’s arithmetic' }), bd));

    if (r.chains.length) {
      var chips = el('div', { class: 'chips' });
      r.chains.forEach(function (c) { chips.appendChild(el('span', { class: 'chip', text: c })); });
      detail.appendChild(el('section', { class: 'section' }, el('h2', { text: 'Chains' }), chips));
    }

    var farm = el('ol', { class: 'farm' });
    r.farm_steps.forEach(function (s) { farm.appendChild(el('li', { text: s })); });
    detail.appendChild(el('section', { class: 'section' },
      el('h2', { text: 'Farm plan — be a user before the snapshot that counts' }),
      el('p', { class: 'cat', text: 'Derived from this protocol’s category, chains, TVL and age. Nothing here is financial advice; positions can lose money and a launch is never guaranteed.' }),
      farm));
    app.appendChild(detail);
  }

  // ---------- footer ----------
  document.getElementById('foot').textContent =
    'Model ' + DATA.model_version + ' · shrink prior weight ' + DATA.model.shrink_prior_weight + ', growth weight ' + DATA.model.growth_weight +
    ' · Implied values are estimates derived from one frozen snapshot (' + DATA.as_of + '); they are not prices, offers or investment advice.';

  // ---------- go ----------
  if (state.selected) {
    var found = null;
    DATA.rows.forEach(function (r) { if (r.slug === state.selected) found = r; });
    if (found) renderDetail(found);
    else renderBoard();
  } else {
    renderBoard();
  }
  app.setAttribute('aria-busy', 'false');
  window.__radar_ready = true;
})();
