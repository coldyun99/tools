/* 期货升贴水监控 - 前端主逻辑（纯前端动态版：浏览器直连公开行情，实时计算）
 * 数据层：lib/quote.js(拉行情) + lib/analytics.js(算升贴水/分位) + lib/instruments.js(品种表)
 * 历史分位基准库 api/spreads/<CODE>.json（静态预建）+ 实时行情（东方财富，CORS*）=> 当前分位即"今天的价差在历史分布中的位置"。
 */
(function () {
  'use strict';
  const I = window.Instruments, A = window.Analytics, Q = window.Quote;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
  const EX_ORDER = ['SHFE', 'DCE', 'CZCE', 'CFFEX', 'INE', 'GFEX'];

  const state = {
    view: { mode: 'overview', product: null },
    overview: [], products: [], rows: [],
    quotes: null, quoteMeta: null,
    meta: { w3: 1095, w5: 1825 },
    prods: [], summaries: null,
    filters: { ex: new Set(), product: '', q: '', base: 'main', win: '3', show: 'all' },
    sort: { key: 'annual', dir: 'desc' },
    selected: null, detail: null, detailWin: '3',
    autoTimer: null, loading: false,
  };

  // ---------------- 工具 ----------------
  const fmtPx = v => {
    if (v == null || !isFinite(v)) return '—';
    const sign = v < 0 ? '-' : '';
    const a = Math.abs(v);
    const d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : 4;
    return sign + a.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const fmtPct = (v, d = 2, sign = false) => {
    if (v == null || !isFinite(v)) return '—';
    const s = (v * 100).toFixed(d);
    return (sign && v > 0 ? '+' : '') + s + '%';
  };
  const fmtInt = v => (v == null || !isFinite(v)) ? '—' : Math.round(v).toLocaleString('zh-CN');
  const cls = v => v == null || !isFinite(v) ? 'na' : (v > 0 ? 'up' : v < 0 ? 'dn' : 'flat');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function pad2(n) { return String(n).padStart(2, '0'); }
  function pad(ts) { return pad2(ts.getHours()) + ':' + pad2(ts.getMinutes()) + ':' + pad2(ts.getSeconds()); }
  function toast(msg, ms) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }
  function setSrc(kind, text) { $('#srcDot').className = 'dot ' + kind; $('#srcText').textContent = text; }

  // ---------------- 行情获取（带缓存） ----------------
  async function ensureQuotes(silent) {
    if (state.quotes) return;
    setSrc('load', '拉取实时行情…');
    const r = await Q.quotes();
    state.quotes = r.data;
    state.quoteMeta = { source: r.source, sourceName: r.sourceName, ts: r.ts, meta: r.meta };
  }

  // ---------------- 首页概览（轻量，用 summaries + 实时行情，不拉全量分位库） ----------------
  function computeOverview(p, quotes, opts) {
    const inst = I.BY_CODE[p.code];
    if (!inst) return null;
    const live = [];
    Object.keys(quotes || {}).forEach(code => {
      const pc = I.parseContract(code);
      if (!pc || pc.product !== p.code) return;
      const q = quotes[code]; if (!q || !(q.last > 0)) return;
      live.push({ sym: code, ym: pc.year * 12 + pc.month, q: q });
    });
    if (!live.length) return {
      code: p.code, name: p.name, ex: p.ex, exName: p.exName,
      built: !!p.builtAt, hasLive: false, status: 'na', annual: null, farCount: 0, contractCount: 0,
      baseSymbol: null, basePrice: null, sampleMin: null, sampleMax: null, note: '当前无实时行情'
    };
    live.sort((a, b) => a.ym - b.ym);
    const minLiqShare = 0.01; let maxV = 0;
    live.forEach(x => { if ((x.q.volume || 0) > maxV) maxV = x.q.volume; });
    const liquid = maxV > 0 ? live.filter(x => (x.q.volume || 0) >= maxV * minLiqShare) : live;
    const pool = liquid.length >= 2 ? liquid : live;
    const baseRow = (opts.base || 'main') === 'near' ? live[0] : pool.reduce((b, x) => ((x.q.oi || 0) > (b.q.oi || 0) ? x : b), pool[0]);
    const basePx = baseRow.q.last;
    const maxRate = 0.6; const anns = [];
    live.forEach(x => {
      const D = x.ym - baseRow.ym;
      if (D > 0 && D <= 12) { const rate = (x.q.last - basePx) / basePx; const a = rate * 12 / D; if (isFinite(a) && Math.abs(a) <= maxRate) anns.push(a); }
    });
    let annual = null, status = 'na', note = '';
    if (anns.length >= 2) annual = A.median(anns);
    else if (anns.length === 1) { annual = anns[0]; note = '远月样本仅 1 个'; }
    else {
      const na = p.nearAnnualLatest;
      if (na != null) { annual = na; note = '仅主力挂牌，取近月-次月结构'; }
      else { annual = null; note = '无远月挂牌且无历史结构'; }
    }
    if (annual == null) status = 'na';
    else if (annual > 0.005) status = 'contango';
    else if (annual < -0.005) status = 'back';
    else status = 'flat';
    return {
      code: p.code, name: p.name, ex: p.ex, exName: p.exName,
      built: !!p.builtAt, hasLive: true, status: status, annual: annual,
      farCount: anns.length, contractCount: live.length,
      baseSymbol: baseRow.sym, basePrice: basePx,
      sampleMin: anns.length ? Math.min.apply(null, anns) : null,
      sampleMax: anns.length ? Math.max.apply(null, anns) : null, note: note
    };
  }

  // ---------------- 初始化 ----------------
  async function init() {
    bind();
    try {
      const r = await fetch('api/spread-summaries.json').then(x => x.json());
      state.summaries = r;
      state.prods = I.LIST.map(inst => {
        const s = r.find(x => x.code === inst.code);
        return {
          code: inst.code, name: inst.name, ex: inst.ex, exName: inst.exName,
          mult: inst.mult, unit: inst.unit, isFinancial: inst.isFinancial, spot: inst.spot,
          builtAt: s ? s.builtAt : null, histRange: s ? s.histRange : null, nearAnnualLatest: s ? s.nearAnnualLatest : null,
        };
      });
      buildExChips(); buildProdSelect();
    } catch (e) { toast('初始化失败: ' + e.message, 5000); }
    await loadOverview(true);
  }

  function buildExChips() {
    const host = $('#exChips');
    const cnt = {};
    state.prods.forEach(p => { cnt[p.ex] = (cnt[p.ex] || 0) + 1; });
    host.innerHTML = EX_ORDER.filter(e => cnt[e]).map(e =>
      `<button class="chip" data-ex="${e}">${esc(I.EXCHANGES[e].name)}<span class="n">${cnt[e]}</span></button>`
    ).join('');
    host.querySelectorAll('.chip').forEach(c => c.onclick = () => {
      const ex = c.dataset.ex;
      if (state.filters.ex.has(ex)) { state.filters.ex.delete(ex); c.classList.remove('on'); }
      else { state.filters.ex.add(ex); c.classList.add('on'); }
      renderTable();
    });
  }

  function buildProdSelect() {
    const sel = $('#prodSel');
    const groups = {};
    state.prods.forEach(p => { (groups[p.ex] = groups[p.ex] || []).push(p); });
    let html = '<option value="">全部品种</option>';
    EX_ORDER.forEach(ex => {
      if (!groups[ex]) return;
      html += `<optgroup label="${esc(I.EXCHANGES[ex].name)}">`;
      groups[ex].forEach(p => {
        html += `<option value="${p.code}">${esc(p.name)} (${p.code})${p.builtAt ? '' : ' · 未建库'}</option>`;
      });
      html += '</optgroup>';
    });
    sel.innerHTML = html;
  }

  // ---------------- 数据加载：概览 / 详情 ----------------
  async function loadOverview(silent) {
    if (state.loading) return;
    state.loading = true;
    try {
      await ensureQuotes(silent);
      const opts = { base: state.filters.base, window3y: state.meta.w3, window5y: state.meta.w5 };
      state.overview = state.prods.map(p => computeOverview(p, state.quotes, opts)).filter(Boolean);
      const qm = state.quoteMeta, ts = new Date(qm.ts);
      setSrc('ok', `${qm.sourceName} · ${pad(ts)} · ${state.overview.length} 品种概览`);
      renderKpis(); renderTable();
    } catch (e) {
      setSrc('err', '行情失败');
      if (!silent) toast('加载失败: ' + e.message, 5000);
    } finally { state.loading = false; }
  }

  async function loadProduct(code, silent) {
    if (state.loading) return;
    state.loading = true;
    try {
      await ensureQuotes(silent);
      const opts = { base: state.filters.base, window3y: state.meta.w3, window5y: state.meta.w5 };
      const j = await A.productBasis(code, state.quotes, opts);
      if (!j) {
        setSrc('err', '无数据');
        if (!silent) toast('暂无 ' + code + ' 的实时行情或历史库', 4000);
        state.loading = false; return;
      }
      state.products = [j];
      const rows = [];
      j.rows.forEach(r => rows.push({
        symbol: r.symbol, product: r.product, productName: r.productName, ex: r.ex, exName: r.exName,
        last: r.last, prevSettle: r.prevSettle, pct: r.pct, oi: r.oi, volume: r.volume,
        spread: r.spread, rate: r.rate, annual: r.annual, D: r.D, k: null,
        p3: r.p3, p5: r.p5, n3: r.n3, n5: r.n5, isBase: r.isBase, lowLiq: r.lowLiq,
        baseSymbol: j.baseSymbol, basePrice: j.basePrice, tradingDays: j.tradingDays, histRange: j.histRange,
      }));
      state.rows = rows;
      j._map = {}; j.rows.forEach(r => { j._map[r.symbol] = r; });
      const qm = state.quoteMeta, ts = new Date(qm.ts);
      setSrc('ok', `${qm.sourceName} · ${pad(ts)} · ${rows.length} 合约`);
      renderKpis(); renderTable();
      if (state.selected) {
        const still = rows.find(r => r.symbol === state.selected);
        if (still) loadDetail(still.product, still.symbol);
      }
    } catch (e) {
      setSrc('err', '行情失败');
      if (!silent) toast('加载失败: ' + e.message, 5000);
    } finally { state.loading = false; }
  }

  function loadCurrent(silent) {
    return state.view.mode === 'product' ? loadProduct(state.view.product, silent) : loadOverview(silent);
  }

  function openProduct(code) {
    state.view = { mode: 'product', product: code };
    state.sort = { key: 'p3', dir: 'desc' };
    state.selected = null; state.detail = null;
    $('#btnBack').hidden = false;
    loadProduct(code);
  }

  function backToOverview() {
    state.view = { mode: 'overview', product: null };
    state.sort = { key: 'annual', dir: 'desc' };
    state.selected = null; state.detail = null;
    $('#btnBack').hidden = true;
    $('#drawer').hidden = true; $('#mask').hidden = true;
    loadOverview(true);
  }

  // ---------------- 详情（复用已缓存的分位库算分布，无额外网络） ----------------
  async function loadDetail(product, symbol) {
    const d = $('#drawer');
    d.hidden = false; $('#mask').hidden = false;
    const inst = I.BY_CODE[product];
    $('#dTitle').textContent = symbol + '　' + (inst ? inst.name : '');
    $('#dSub').textContent = '加载中…';
    $('#dStats').innerHTML = ''; $('#chartHist').innerHTML = '';
    $('#chartSeries').innerHTML = ''; $('#chartCurve').innerHTML = ''; $('#dTable').innerHTML = '';
    const w = state.detailWin;
    $$('#dWin button').forEach(b => b.classList.toggle('on', b.dataset.v === w));
    try {
      const j = await A.getSpreads(product);
      const pp = state.products[0];
      const row = pp && pp._map ? pp._map[symbol] : null;
      if (!row) { $('#dSub').textContent = '未找到该合约'; return; }
      const pc = I.parseContract(symbol);
      const baseRow = (pp.rows.find(r => r.isBase) || pp.rows[0]);
      const basePc = I.parseContract(baseRow.symbol);
      const D = pc.ym - basePc.ym;
      const bucket = j.buckets && j.buckets[D];
      const w3 = state.meta.w3, w5 = state.meta.w5;
      const mk = b => b ? A.percentile(b, row.annual, w3) : { pct: null, n: 0, min: null, max: null, median: null, mean: null, p25: null, p75: null };
      const st3 = mk(bucket), st5 = (function (b) { return b ? A.percentile(b, row.annual, w5) : { pct: null, n: 0, min: null, max: null, median: null, mean: null, p25: null, p75: null }; })(bucket);
      const histD = bucket ? bucket.d : [], histA = bucket ? bucket.a : [];
      const histObj = A.histogram(histA, 30);
      const detail = {
        product: product, productName: row.productName, exName: row.exName,
        contract: symbol, last: row.last, spread: row.spread, rate: row.rate, annual: row.annual,
        D: D, base: pp.baseSymbol, basePrice: pp.basePrice,
        stat3: st3, stat5: st5,
        hist3: { d: histD, a: histA, hist: histObj },
        hist5: { d: histD, a: histA, hist: histObj },
        range: bucket ? [bucket.d[0], bucket.d[bucket.d.length - 1]] : null,
        dailyCount: (j.daily && j.daily.d) ? j.daily.d.length : 0,
      };
      state.detail = detail;
      drawDetail(detail, w);
    } catch (e) { $('#dSub').textContent = '加载失败: ' + e.message; }
  }

  // ---------------- KPI ----------------
  function renderKpis() {
    if (state.view.mode === 'overview') {
      const ov = state.overview;
      const contango = ov.filter(o => o.status === 'contango').length;
      const back = ov.filter(o => o.status === 'back').length;
      const flat = ov.filter(o => o.status === 'flat').length;
      const na = ov.filter(o => o.status === 'na').length;
      const withA = ov.filter(o => o.annual != null);
      const avg = withA.length ? withA.reduce((a, b) => a + b.annual, 0) / withA.length : null;
      $('#kpis').innerHTML = [
        kpi('覆盖品种', ov.length, '升贴水概览'),
        kpi('整体升水', contango, 'Contango 远月贵', 'up'),
        kpi('整体贴水', back, 'Backwardation 远月便宜', 'dn'),
        kpi('结构持平', flat, '年化≈0', 'flat'),
        kpi('数据不足', na, '需行情/建库', 'na'),
        kpi('平均年化幅度', avg == null ? '—' : fmtPct(avg, 2, true), '有数据品种均值'),
      ].join('');
      return;
    }
    const rows = state.rows.filter(r => r.annual != null);
    const win = state.filters.win === '5' ? 'p5' : 'p3';
    const withP = rows.filter(r => r[win] != null);
    const avg = withP.length ? withP.reduce((a, b) => a + b[win], 0) / withP.length : null;
    const hi = withP.filter(r => r[win] >= 90).length;
    const lo = withP.filter(r => r[win] <= 10).length;
    const contango = rows.filter(r => r.annual > 0).length;
    const buildP = state.prods.filter(p => p.builtAt).length;
    $('#kpis').innerHTML = [
      kpi('本品种合约', state.rows.length, (state.products[0] ? state.products[0].name : '') + ' 的合约'),
      kpi('历史库品种', buildP + '/' + state.prods.length, '历史分位基准库'),
      kpi('平均历史分位', avg == null ? '—' : avg.toFixed(1), (win === 'p5' ? '5' : '3') + '年窗口 · ' + withP.length + ' 个有效'),
      kpi('高分位(≥90)', hi, '升水处于历史高位', 'up'),
      kpi('低分位(≤10)', lo, '贴水处于历史低位', 'dn'),
      kpi('Contango 合约', contango + '/' + rows.length, '年化升水率为正'),
    ].join('');
  }
  function kpi(k, v, s, c) {
    return `<div class="kpi"><div class="k">${esc(k)}</div><div class="v ${c || ''}">${esc(v)}</div><div class="s">${esc(s || '')}</div></div>`;
  }

  // ---------------- 表格（双视图） ----------------
  function ovHead() {
    return `<th data-k="code" class="sortable">代码</th>
      <th data-k="name" class="sortable">品种</th>
      <th data-k="exName" class="sortable">交易所</th>
      <th data-k="status" class="sortable">整体结构</th>
      <th data-k="annual" class="num sortable" title="远月年化升水率中位数：正=Contango(远月升水)，负=Backwardation(远月贴水)">年化升贴水率</th>
      <th data-k="farCount" class="num sortable" title="参与聚合的远月(D>0)合约数">远月数</th>
      <th data-k="contractCount" class="num sortable" title="当前有实时报价的合约数">合约数</th>
      <th data-k="baseSymbol" class="sortable">基准</th>
      <th class="note-cell-h">说明</th>`;
  }
  function contractHead() {
    return `<th data-k="symbol" class="sortable">合约</th>
      <th data-k="productName" class="sortable">品种</th>
      <th data-k="exName" class="sortable">交易所</th>
      <th data-k="last" class="num sortable">最新价</th>
      <th data-k="spread" class="num sortable" title="该合约价格 − 主力价格（用户视角，正=该合约比主力贵）">对主力价差</th>
      <th data-k="rate" class="num sortable" title="对主力价差率 = (该合约-主力)/主力">对主力价差率</th>
      <th data-k="annual" class="num sortable" title="跨期年化：统一「远端-近端」/近端 × 12/月差。正值=contango（远月升水），负值=backwardation（远月贴水）。无论合约相对主力近或远，符号都可比">年化升水率<br><small>(远−近)</small></th>
      <th data-k="p3" class="sortable">3年分位</th>
      <th data-k="p5" class="sortable" id="thP5">5年分位</th>
      <th data-k="n3" class="num sortable" title="参与分位计算的历史样本数">样本</th>
      <th data-k="oi" class="num sortable">持仓量</th>
      <th data-k="volume" class="num sortable">成交量</th>`;
  }

  function filteredOverview() {
    const f = state.filters;
    const q = f.q.trim().toLowerCase();
    let rows = state.overview.filter(o => {
      if (f.ex.size && !f.ex.has(o.ex)) return false;
      if (q && !(o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q) || o.exName.toLowerCase().includes(q))) return false;
      return true;
    });
    const { key, dir } = state.sort;
    const mul = dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let x = a[key], y = b[key];
      if (x == null && y == null) return a.code < b.code ? -1 : 1;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === 'string') return mul * x.localeCompare(y);
      return mul * (x - y);
    });
    return rows;
  }

  function overviewRow(ov) {
    const M = {
      contango: { t: '升水', c: 'up', icon: '▲' },
      back: { t: '贴水', c: 'dn', icon: '▼' },
      flat: { t: '持平', c: 'flat', icon: '＝' },
      na: { t: '数据不足', c: 'na', icon: '—' },
    };
    const s = M[ov.status] || M.na;
    const tip = ov.status === 'contango' ? '远月整体升水 (Contango)'
      : ov.status === 'back' ? '远月整体贴水 (Backwardation)'
        : ov.status === 'flat' ? '结构基本持平' : '暂无足够数据';
    return `<tr data-code="${ov.code}" class="ov-row ${ov.status === 'na' ? 'ov-na' : ''}" title="${esc(tip)}">
      <td><span class="sym">${esc(ov.code)}</span></td>
      <td class="pname">${esc(ov.name)}</td>
      <td class="col-ex pname">${esc(ov.exName)}</td>
      <td><span class="badge ${s.c}">${s.icon} ${s.t}</span></td>
      <td class="num ${s.c}"><b>${fmtPct(ov.annual, 2, true)}</b></td>
      <td class="num na">${ov.farCount}</td>
      <td class="num na">${ov.contractCount}</td>
      <td class="pname dim">${ov.baseSymbol ? esc(ov.baseSymbol) : '—'}</td>
      <td class="note-cell">${esc(ov.note || '')}</td>
    </tr>`;
  }

  function filtered() {
    const f = state.filters;
    const q = f.q.trim().toLowerCase();
    let rows = state.rows.filter(r => {
      if (f.ex.size && !f.ex.has(r.ex)) return false;
      if (f.product && r.product !== f.product) return false;
      if (q && !(r.symbol.toLowerCase().includes(q) || r.productName.toLowerCase().includes(q) || r.exName.toLowerCase().includes(q))) return false;
      if (f.show === 'liq' && r.lowLiq) return false;
      if (f.show === 'has' && (r.p3 == null || r.n3 < 60)) return false;
      return true;
    });
    const { key, dir } = state.sort;
    const mul = dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let x = a[key], y = b[key];
      if (x == null && y == null) return a.symbol < b.symbol ? -1 : 1;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === 'string') return mul * x.localeCompare(y);
      return mul * (x - y);
    });
    return rows;
  }

  function renderTable() {
    const tbody = $('#tbody');
    const thr = $('#tbl thead tr');
    const isOv = state.view.mode === 'overview';
    $('#hideSeg').hidden = isOv;
    if (isOv) {
      thr.innerHTML = ovHead();
      const rows = filteredOverview();
      if (!rows.length) {
        tbody.innerHTML = '';
        const e = $('#emptyBox');
        e.hidden = false;
        e.innerHTML = state.overview.length ? '<b>没有符合条件的品种</b>请调整筛选条件' : '<b>尚未加载数据</b>请刷新行情';
      } else {
        $('#emptyBox').hidden = true;
        tbody.innerHTML = rows.map(overviewRow).join('');
        tbody.querySelectorAll('tr').forEach(tr => { tr.onclick = () => openProduct(tr.dataset.code); });
      }
      $('#rowCount').textContent = `显示 ${rows.length} / ${state.overview.length} 个品种`;
    } else {
      thr.innerHTML = contractHead();
      const rows = filtered();
      const win = state.filters.win === '5' ? 'p5' : 'p3';
      const cmp = state.filters.win === 'c';
      if (!rows.length) {
        tbody.innerHTML = '';
        const e = $('#emptyBox');
        e.hidden = false;
        e.innerHTML = state.rows.length ? '<b>没有符合条件的合约</b>请调整筛选条件' : '<b>尚未加载数据</b>请刷新行情';
      } else {
        $('#emptyBox').hidden = true;
        tbody.innerHTML = rows.map(r => tr(r, win, cmp)).join('');
        tbody.querySelectorAll('tr').forEach(tr => {
          tr.onclick = () => {
            state.selected = tr.dataset.sym;
            $$('#tbody tr').forEach(x => x.classList.remove('sel'));
            tr.classList.add('sel');
            loadDetail(tr.dataset.prod, tr.dataset.sym);
          };
        });
      }
      $('#rowCount').textContent = `显示 ${rows.length} / ${state.rows.length} 个合约`;
    }
    $$('thead th.sortable').forEach(th => {
      th.classList.toggle('sorted', th.dataset.k === state.sort.key);
      th.classList.toggle('asc', th.dataset.k === state.sort.key && state.sort.dir === 'asc');
    });
    attachSort();
  }

  function attachSort() {
    $$('thead th.sortable').forEach(th => th.onclick = () => {
      const k = th.dataset.k;
      if (state.sort.key === k) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort.key = k; state.sort.dir = ['code', 'name', 'exName', 'baseSymbol', 'symbol', 'productName'].includes(k) ? 'asc' : 'desc'; }
      renderTable();
    });
  }

  function pcell(p, dim) {
    if (p == null) return '<span class="na">—</span>';
    return `<div class="pcell" style="${dim ? 'opacity:.42' : ''}">
      <div class="pbar"><i style="left:${p.toFixed(1)}%"></i></div>
      <span class="pval" style="color:${Chart.pctColor(p)}">${p.toFixed(0)}</span></div>`;
  }

  function tr(r, win, cmp) {
    const tags = (r.isBase ? '<span class="tag base">基准</span>' : '') +
      (r.lowLiq ? '<span class="tag liq">低流动性</span>' : '') +
      (r.k ? `<span class="tag">${r.D > 0 ? '+' : ''}${r.D}月</span>` : '');
    return `<tr data-sym="${r.symbol}" data-prod="${r.product}" class="${r.isBase ? 'isbase' : ''} ${r.lowLiq ? 'lowliq' : ''}">
      <td><span class="sym">${esc(r.symbol)}</span>${tags}</td>
      <td class="pname">${esc(r.productName)}</td>
      <td class="col-ex pname">${esc(r.exName)}</td>
      <td class="num">${fmtPx(r.last)}</td>
      <td class="num ${cls(r.spread)}">${r.spread == null ? '—' : (r.spread > 0 ? '+' : '') + fmtPx(r.spread)}</td>
      <td class="num ${cls(r.rate)}">${fmtPct(r.rate, 2, true)}</td>
      <td class="num ${cls(r.annual)}"><b>${fmtPct(r.annual, 2, true)}</b></td>
      <td>${pcell(r.p3, !cmp && win === 'p5')}</td>
      <td>${pcell(r.p5, !cmp && win === 'p3')}</td>
      <td class="num col-opt na">${r.n3 == null ? '—' : r.n3}</td>
      <td class="num col-opt na">${fmtInt(r.oi)}</td>
      <td class="num col-opt na">${fmtInt(r.volume)}</td>
    </tr>`;
  }

  // ---------------- 详情渲染 ----------------
  function drawDetail(j, w) {
    const st = w === '5' ? j.stat5 : j.stat3;
    const hist = w === '5' ? j.hist5 : j.hist3;
    const winLabel = w === '5' ? '5 年' : '3 年';
    const pp = state.products.find(x => x.product === j.product);
    $('#dSub').innerHTML = `${esc(j.productName)} · ${esc(j.exName)}　|　基准 <b>${esc(j.base || '—')}</b> @ ${fmtPx(j.basePrice)}　|　`
      + `到期月差 <b>${j.D == null ? '—' : (j.D > 0 ? '+' : '') + j.D + ' 月'}</b>　|　${winLabel}窗口`;

    const cards = [
      ['最新价', fmtPx(j.last), ''],
      ['相对基准价差', (j.spread == null ? '—' : (j.spread > 0 ? '+' : '') + fmtPx(j.spread)), cls(j.spread)],
      ['价差率', fmtPct(j.rate, 2, true), cls(j.rate)],
      ['年化升水率', fmtPct(j.annual, 2, true), cls(j.annual)],
      [winLabel + '分位', st && st.pct != null ? st.pct.toFixed(1) : '—', st && st.pct != null ? (st.pct >= 50 ? 'up' : 'dn') : 'na'],
      ['历史样本', st ? fmtInt(st.n) : '—', 'na'],
      ['历史中位数', st ? fmtPct(st.median, 2) : '—', 'na'],
      ['历史区间', st ? fmtPct(st.min, 1) + ' ~ ' + fmtPct(st.max, 1) : '—', 'na'],
    ];
    $('#dStats').innerHTML = cards.map(c =>
      `<div class="dstat"><div class="k">${esc(c[0])}</div><div class="v ${c[2]}">${esc(c[1])}</div></div>`).join('');

    Chart.histogram($('#chartHist'), { hist: hist.hist, current: j.annual, stat: st });
    Chart.series($('#chartSeries'), { d: hist.d, a: hist.a, current: j.annual });
    if (pp) {
      const w2 = w === '5' ? 'p5' : 'p3';
      Chart.curve($('#chartCurve'), {
        win: w,
        rows: pp.rows.map(r => ({
          symbol: r.symbol, annual: r.annual, spread: r.spread, isBase: r.isBase,
          p: w2 === 'p5' ? r.p5 : r.p3,
        })),
      });
    }
    const tb = [
      ['合约', j.contract], ['品种', j.productName + ' (' + j.product + ')'], ['交易所', j.exName],
      ['基准合约', j.base], ['基准价', fmtPx(j.basePrice)], ['本合约价', fmtPx(j.last)],
      ['交割月差', j.D == null ? '—' : (j.D > 0 ? '+' : '') + j.D + ' 个月'],
      ['年化升水率(远−近)', fmtPct(j.annual, 3, true)],
      [winLabel + '窗口分位', st && st.pct != null ? st.pct.toFixed(1) + ' / 100' : '—'],
      [winLabel + '样本数', st ? fmtInt(st.n) : '—'],
      ['历史 P25 / 中位 / P75', st ? fmtPct(st.p25, 2) + ' / ' + fmtPct(st.median, 2) + ' / ' + fmtPct(st.p75, 2) : '—'],
      ['历史最小 / 最大', st ? fmtPct(st.min, 2) + ' / ' + fmtPct(st.max, 2) : '—'],
      ['历史均值', st ? fmtPct(st.mean, 2) : '—'],
      ['历史数据区间', j.range ? j.range[0] + ' ~ ' + j.range[1] : '—'],
      ['品种交易日数', fmtInt(j.dailyCount)],
    ];
    $('#dTable').innerHTML = '<table class="mini-tbl">' + tb.map(x =>
      `<tr><td>${esc(x[0])}</td><td>${esc(x[1])}</td></tr>`).join('') + '</table>';
  }

  function closeDrawer() {
    $('#drawer').hidden = true; $('#mask').hidden = true;
    state.selected = null; state.detail = null;
    $$('#tbody tr').forEach(x => x.classList.remove('sel'));
  }

  // ---------------- 事件绑定 ----------------
  function exportCsv() {
    const rows = state.rows || [];
    const head = ['合约', '品种', '交易所', '最新价', '月差', '升贴水', '价差率%', '年化率%', '3年分位', '5年分位', '持仓量', '成交量'];
    const f = (v, d = 2) => (v == null || !isFinite(v)) ? '' : Number(v).toFixed(d);
    const lines = [head.join(',')];
    rows.forEach(x => lines.push([
      x.symbol, x.productName, x.exName, f(x.last), x.D, f(x.spread),
      f(x.rate * 100, 3), f(x.annual * 100, 3), f(x.p3, 1), f(x.p5, 1),
      x.oi == null ? '' : x.oi, x.volume == null ? '' : x.volume,
    ].join(',')));
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'basis.csv'; a.click();
    toast('已导出 ' + rows.length + ' 行 CSV');
  }

  function bind() {
    $('#prodSel').onchange = e => {
      if (e.target.value) openProduct(e.target.value);
      else if (state.view.mode === 'product') backToOverview();
    };
    let t; $('#search').oninput = e => {
      clearTimeout(t); t = setTimeout(() => { state.filters.q = e.target.value; renderTable(); }, 180);
    };
    segBind('#baseSeg', v => { state.filters.base = v; loadCurrent(); });
    segBind('#winSeg', v => {
      state.filters.win = v;
      if (v !== 'c') state.detailWin = v;
      state.sort.key = v === '5' ? 'p5' : 'p3';
      $$('#dWin button').forEach(b => b.classList.toggle('on', b.dataset.v === (v === 'c' ? state.detailWin : v)));
      if (v !== 'c') state.detailWin = v;
      renderKpis(); renderTable();
      if (state.detail) drawDetail(state.detail, state.detailWin);
    });
    segBind('#hideSeg', v => { state.filters.show = v; renderTable(); });
    segBind('#dWin', v => {
      state.detailWin = v;
      $$('#dWin button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
      if (state.detail) drawDetail(state.detail, v);
    });
    $('#btnBack').onclick = backToOverview;
    $('#dClose').onclick = closeDrawer;
    $('#mask').onclick = closeDrawer;
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer();
    });
    // 刷新：重新拉行情并重算（动态能力核心）
    const btnRefresh = $('#btnRefresh');
    btnRefresh.disabled = false;
    btnRefresh.title = '重新拉取实时行情并重算';
    btnRefresh.onclick = doRefresh;
    $('#btnExport').onclick = () => exportCsv();
    // 自动刷新：默认开启，保持监控页实时
    const autoRefresh = $('#autoRefresh');
    if (autoRefresh) {
      autoRefresh.checked = true;
      autoRefresh.onchange = e => {
        clearInterval(state.autoTimer);
        if (e.target.checked) state.autoTimer = setInterval(() => { if (!state.loading) loadCurrent(true); }, 60000);
      };
      state.autoTimer = setInterval(() => { if (!state.loading) loadCurrent(true); }, 60000);
    }
  }

  function segBind(sel, cb) {
    $$(sel + ' button').forEach(b => b.onclick = () => {
      $$(sel + ' button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); cb(b.dataset.v);
    });
  }

  async function doRefresh() {
    const btn = $('#btnRefresh');
    btn.disabled = true; btn.textContent = '刷新中…';
    const prev = state.view.mode;
    try {
      state.quotes = null; state.quoteMeta = null; // 强制重新拉取
      await loadCurrent(true);
      toast('已刷新行情：' + (state.quoteMeta ? state.quoteMeta.sourceName : ''));
    } catch (e) { toast('刷新失败: ' + e.message, 5000); }
    finally { btn.disabled = false; btn.textContent = '刷新行情'; }
  }

  init();
})();
