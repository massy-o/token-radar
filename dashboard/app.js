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
    app.appendChild(method);

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
        el('th', { class: 'num', text: 'Multiple' }), el('th', { text: 'Launch score' }), el('th', { text: 'Chains' })));
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
          el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('td', { class: 'num', text: fmtMult(r.model.category_multiple) }),
          scoreCell,
          el('td', { class: 'chains', text: r.chains.length ? r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') : '—' })));
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
    }
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

    var bd = el('table', { class: 'breakdown' });
    bd.appendChild(el('tr', null, el('td', { text: 'TVL (snapshot)' }), el('td', { class: 'n', text: usdFull.format(r.tvl_usd) })));
    bd.appendChild(el('tr', null, el('td', { text: '× category multiple — ' + (r.category || 'uncategorised') + ' median over ' + r.model.category_peers + ' tokenized peers, shrunk to the global ' + fmtMult(DATA.global_median) }), el('td', { class: 'n', text: fmtMult(r.model.category_multiple) })));
    bd.appendChild(el('tr', null, el('td', { text: '× growth multiplier — 7d change ' + fmtPct(r.model.growth_pct) + ', clamped to [−60%, +120%], weight 0.5' }), el('td', { class: 'n', text: r.model.growth_multiplier.toFixed(4) + '×' })));
    bd.appendChild(el('tr', null, el('td', { text: '× maturity multiplier — age ' + fmtAge(r.age_days) + ' against a 3-year horizon' }), el('td', { class: 'n', text: r.model.maturity_multiplier.toFixed(4) + '×' })));
    bd.appendChild(el('tr', { class: 'total' }, el('td', { text: '= implied value if it launched at snapshot prices' }), el('td', { class: 'n', text: usdFull.format(r.implied_value_usd) })));
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
