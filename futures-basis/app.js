/* 期货升贴水监控 - 前端主逻辑（首页概览 + 品种详情双视图） */
(function () {
  'use strict';
  // 静态快照版编译开关：发布到 GitHub Pages 时置 true（无后端、无实时刷新）
  const STATIC_MODE = true;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));

  const state = {
    view: { mode: 'overview', product: null }, // overview=品种概览 | product=单品种合约明细
    overview: [],       // /api/overview 返回的品种聚合数组
    products: [],       // 当前视图的品种 basis 数组（概览模式为空；详情模式为该品种）
    rows: [],           // 扁平化合约行（仅 product 视图填充）
    meta: { quotesTs: 0, quotesSource: '', w3: 1095, w5: 1825 },
    status: null,
    prods: [],          // /api/products
    filters: { ex: new Set(), product: '', q: '', base: 'main', win: '3', show: 'all' },
    sort: { key: 'annual', dir: 'desc' },
    selected: null,
    detail: null,
    detailWin: '3',
    autoTimer: null,
    es: null,
    loading: false,
    ib: null,
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
  function toast(msg, ms) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }
  // 静态快照版：将 /api/* 映射到本地预生成的静态 JSON（无后端）
  const _apiCache = new Map();
  async function _fetchJson(rel) {
    if (_apiCache.has(rel)) return _apiCache.get(rel);
    const r = await fetch(rel);
    const j = await r.json().catch(() => ({ ok: false, error: '解析失败: ' + rel }));
    _apiCache.set(rel, j);
    return j;
  }
  async function api(path, opts) {
    const u = new URL(path, location.href);
    const p = u.pathname.split('?')[0];
    if (p === '/api/status') return _fetchJson('api/status.json');
    if (p === '/api/products') return _fetchJson('api/products.json');
    if (p === '/api/overview') return _fetchJson('api/overview.json');
    if (p === '/api/basis') {
      const code = (u.searchParams.get('products') || '').toUpperCase();
      if (!code) throw new Error('静态快照版 /api/basis 需要 products 参数');
      return _fetchJson('api/basis/' + code + '.json');
    }
    if (p === '/api/indexbasis') return _fetchJson('api/indexbasis.json');
    if (p === '/api/detail') {
      const product = (u.searchParams.get('product') || '').toUpperCase();
      const contract = (u.searchParams.get('contract') || '').toUpperCase();
      const dj = await _fetchJson('api/detail/' + product + '.json');
      const item = dj && dj.items ? dj.items[contract] : null;
      if (!item) throw new Error('未找到合约 ' + contract + ' 的明细（静态快照仅含已建库合约）');
      return item;
    }
    throw new Error('静态快照版不支持该接口: ' + p);
  }
  const EX_ORDER = ['SHFE', 'DCE', 'CZCE', 'CFFEX', 'INE', 'GFEX'];

  // ---------------- 股指期现基差 ----------------
  async function loadIndexBasis(rebuild) {
    const body = $('#ibBody');
    if (rebuild) body.innerHTML = '<div class="loading">正在重建历史基差序列…</div>';
    try {
      const j = await api('/api/indexbasis' + (rebuild ? '?build=1' : ''));
      state.ib = j;
      const ps = (j.products || []).filter(p => !p.error && p.rows && p.rows.length);
      if (!ps.length) {
        body.innerHTML = '<div class="loading">暂无数据（需先构建历史库）</div>';
        return;
      }
      const spotTxt = ps.map(p => `${p.spotName} ${fmtPx(p.spot)}`).join('　');
      $('#ibSpot').textContent = spotTxt + '　|　现货源 ' + (j.spotSource === 'tencent' ? '腾讯' : j.spotSource);
      const win = state.filters.win === '5' ? 'p5' : 'p3';
      const cmp = state.filters.win === 'c';
      let html = '<div style="overflow-x:auto"><table class="ibtable"><thead><tr>' +
        '<th>品种</th><th>合约</th><th>期货</th><th>现货</th><th>基差</th><th>年化基差率</th>' +
        '<th>剩余天数</th><th>3年分位</th><th>5年分位</th><th>样本</th></tr></thead><tbody>';
      ps.forEach((p, pi) => {
        p.rows.forEach((r, ri) => {
          html += `<tr class="${ri === 0 ? 'prod-start' : ''}">
            <td class="pname-b">${ri === 0 ? esc(p.name) : ''}</td>
            <td><span class="sym">${esc(r.symbol)}</span></td>
            <td>${fmtPx(r.last)}</td>
            <td class="dim">${fmtPx(p.spot)}</td>
            <td class="${cls(r.basis)}">${r.basis > 0 ? '+' : ''}${fmtPx(r.basis)}</td>
            <td class="${cls(r.annual)}"><b>${fmtPct(r.annual, 2, true)}</b></td>
            <td class="dim">${r.days}</td>
            <td>${pcell(r.p3, !cmp && win === 'p5')}</td>
            <td>${pcell(r.p5, !cmp && win === 'p3')}</td>
            <td class="dim">${r.n3}/${r.n5}</td>
          </tr>`;
        });
      });
      html += '</tbody></table></div>';
      body.innerHTML = html;
    } catch (e) {
      body.innerHTML = '<div class="loading">加载失败: ' + esc(e.message) + '</div>';
    }
  }

  // ---------------- 双源校验 ----------------
  async function doVerify() {
    const msg = $('#verifyMsg'), out = $('#verifyOut');
    msg.className = 'msg'; msg.textContent = '校验中…'; out.innerHTML = '';
    try {
      const j = await api('/api/verify');
      msg.className = 'msg ok';
      msg.textContent = `完成：双源均有报价 ${j.both} 个合约`;
      const bad = j.bigCount === 0;
      out.innerHTML = `<div class="vsum">
          <div><span>新浪合约数</span><b>${j.sinaCount}</b></div>
          <div><span>东财合约数</span><b>${j.emCount}</b></div>
          <div><span>双源可比</span><b>${j.both}</b></div>
          <div><span>平均绝对偏差</span><b>${j.avgDiff == null ? '—' : j.avgDiff.toFixed(4) + '%'}</b></div>
          <div><span>偏差&gt;0.5%</span><b style="color:${bad ? 'var(--dn)' : 'var(--warn)'}">${j.bigCount}</b></div>
        </div>
        <div class="note" style="font-size:11.5px;color:var(--tx3);margin-bottom:6px">${esc(j.note)}</div>
        ${j.big.length ? '<div class="vlist">' + j.big.map(x =>
        `${x.symbol}　新浪 ${fmtPx(x.sina)}　东财 ${fmtPx(x.em)}　偏差 ${x.diff > 0 ? '+' : ''}${x.diff.toFixed(2)}%`).join('<br>') + '</div>'
          : '<div style="color:var(--dn);font-size:12.5px">✓ 全部合约偏差均在 0.5% 以内，两源数据一致</div>'}`;
    } catch (e) {
      msg.className = 'msg err'; msg.textContent = '校验失败: ' + e.message;
    }
  }

  // ---------------- 初始化 ----------------
  async function init() {
    bind();
    try {
      state.status = await api('/api/status');
      state.prods = (await api('/api/products')).products;
      buildExChips();
      buildProdSelect();
      renderDbStat();
    } catch (e) { toast('初始化失败: ' + e.message, 5000); }
    await loadOverview(true);
    loadIndexBasis(false);
  }

  function buildExChips() {
    const host = $('#exChips');
    const cnt = {};
    state.prods.forEach(p => { cnt[p.ex] = (cnt[p.ex] || 0) + 1; });
    host.innerHTML = EX_ORDER.filter(e => cnt[e]).map(e =>
      `<button class="chip" data-ex="${e}">${esc(state.status.exchanges[e].name)}<span class="n">${cnt[e]}</span></button>`
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
      html += `<optgroup label="${esc(state.status.exchanges[ex].name)}">`;
      groups[ex].forEach(p => {
        html += `<option value="${p.code}">${esc(p.name)} (${p.code})${p.built ? '' : ' · 未建库'}</option>`;
      });
      html += '</optgroup>';
    });
    sel.innerHTML = html;
  }

  // ---------------- 数据加载：概览 / 详情 ----------------
  async function loadOverview(silent) {
    if (state.loading) return;
    state.loading = true;
    setSrc('load', '加载中…');
    try {
      const p = new URLSearchParams({ base: state.filters.base });
      const j = await api('/api/overview?' + p);
      state.overview = j.products || [];
      state.meta = { quotesTs: j.quotesTs, quotesSource: j.quotesSource, w3: j.w3, w5: j.w5 };
      const ts = new Date(state.meta.quotesTs);
      setSrc('ok', `${state.meta.quotesSource} · ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}:${String(ts.getSeconds()).padStart(2, '0')} · ${state.overview.length} 品种概览`);
      renderKpis();
      renderTable();
    } catch (e) {
      setSrc('err', '行情失败');
      if (!silent) toast('加载失败: ' + e.message, 5000);
    } finally { state.loading = false; }
  }

  async function loadProduct(code, silent) {
    if (state.loading) return;
    state.loading = true;
    setSrc('load', '加载中…');
    try {
      const p = new URLSearchParams({ base: state.filters.base, products: code });
      const j = await api('/api/basis?' + p);
      state.products = j.products || [];
      state.meta = { quotesTs: j.quotesTs, quotesSource: j.quotesSource, w3: j.w3, w5: j.w5 };
      const rows = [];
      state.products.forEach(pp => {
        pp.rows.forEach(r => {
          rows.push({
            symbol: r.symbol, product: r.product, productName: r.productName, ex: r.ex, exName: r.exName,
            last: r.last, prevSettle: r.prevSettle, pct: r.pct, oi: r.oi, volume: r.volume,
            spread: r.spread, rate: r.rate, annual: r.annual, D: r.D, k: r.k,
            p3: r.p3, p5: r.p5, n3: r.n3, n5: r.n5,
            isBase: r.isBase, lowLiq: r.lowLiq,
            baseSymbol: pp.baseSymbol, basePrice: pp.basePrice,
            tradingDays: pp.tradingDays, histRange: pp.histRange,
          });
        });
      });
      state.rows = rows;
      state.products.forEach(pp => { pp._map = {}; pp.rows.forEach(r => pp._map[r.symbol] = r); });
      const ts = new Date(state.meta.quotesTs);
      setSrc('ok', `${state.meta.quotesSource} · ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}:${String(ts.getSeconds()).padStart(2, '0')} · ${state.rows.length} 合约`);
      renderKpis();
      renderTable();
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
    return state.view.mode === 'product'
      ? loadProduct(state.view.product, silent)
      : loadOverview(silent);
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

  function setSrc(kind, text) {
    $('#srcDot').className = 'dot ' + kind;
    $('#srcText').textContent = text;
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
      const html = [
        kpi('覆盖品种', ov.length, '升贴水概览'),
        kpi('整体升水', contango, 'Contango 远月贵', 'up'),
        kpi('整体贴水', back, 'Backwardation 远月便宜', 'dn'),
        kpi('结构持平', flat, '年化≈0', 'flat'),
        kpi('数据不足', na, '需行情/建库', 'na'),
        kpi('平均年化幅度', avg == null ? '—' : fmtPct(avg, 2, true), '有数据品种均值'),
      ].join('');
      $('#kpis').innerHTML = html;
      return;
    }
    // 品种详情模式：沿用合约级统计
    const rows = state.rows.filter(r => r.annual != null);
    const win = state.filters.win === '5' ? 'p5' : 'p3';
    const withP = rows.filter(r => r[win] != null);
    const avg = withP.length ? withP.reduce((a, b) => a + b[win], 0) / withP.length : null;
    const hi = withP.filter(r => r[win] >= 90).length;
    const lo = withP.filter(r => r[win] <= 10).length;
    const contango = rows.filter(r => r.annual > 0).length;
    const buildP = state.prods.filter(p => p.built).length;
    const html = [
      kpi('本品种合约', state.rows.length, (state.products[0] ? state.products[0].name : '') + ' 的合约'),
      kpi('历史库品种', buildP + '/' + state.prods.length, `${fmtInt(state.status.history.totalBars)} 条日K`),
      kpi('平均历史分位', avg == null ? '—' : avg.toFixed(1), `${win === 'p5' ? '5' : '3'}年窗口 · ${withP.length} 个有效`),
      kpi('高分位(≥90)', hi, '升水处于历史高位', 'up'),
      kpi('低分位(≤10)', lo, '贴水处于历史低位', 'dn'),
      kpi('Contango 合约', contango + '/' + rows.length, '年化升水率为正'),
    ].join('');
    $('#kpis').innerHTML = html;
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
    $('#hideSeg').hidden = isOv; // 概览模式无需"显示"筛选
    if (isOv) {
      thr.innerHTML = ovHead();
      const rows = filteredOverview();
      if (!rows.length) {
        tbody.innerHTML = '';
        const e = $('#emptyBox');
        e.hidden = false;
        e.innerHTML = state.overview.length ? '<b>没有符合条件的品种</b>请调整筛选条件' : '<b>尚未加载数据</b>请点击右上角「数据更新」→ 构建历史数据库';
      } else {
        $('#emptyBox').hidden = true;
        tbody.innerHTML = rows.map(overviewRow).join('');
        tbody.querySelectorAll('tr').forEach(tr => {
          tr.onclick = () => openProduct(tr.dataset.code);
        });
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
        e.innerHTML = state.rows.length
          ? '<b>没有符合条件的合约</b>请调整筛选条件'
          : '<b>尚未加载数据</b>请点击右上角「数据更新」→ 构建历史数据库';
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
    // 表头排序态 + 绑定
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

  // ---------------- 详情 ----------------
  async function loadDetail(product, symbol) {
    const d = $('#drawer');
    d.hidden = false; $('#mask').hidden = false;
    $('#dTitle').textContent = symbol + '　' + (state.prods.find(p => p.code === product) || {}).name;
    $('#dSub').textContent = '加载中…';
    $('#dStats').innerHTML = ''; $('#chartHist').innerHTML = '';
    $('#chartSeries').innerHTML = ''; $('#chartCurve').innerHTML = ''; $('#dTable').innerHTML = '';
    const w = state.detailWin;
    $$('#dWin button').forEach(b => b.classList.toggle('on', b.dataset.v === w));
    try {
      const j = await api(`/api/detail?product=${product}&contract=${symbol}&base=${state.filters.base}`);
      state.detail = j;
      drawDetail(j, w);
    } catch (e) {
      $('#dSub').textContent = '加载失败: ' + e.message;
    }
  }

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
  // 前端 CSV 导出（静态版，无后端 /api/export）
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
    // 筛选
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
      if (state.ib) loadIndexBasis(false);
    });
    segBind('#hideSeg', v => { state.filters.show = v; renderTable(); });
    segBind('#dWin', v => {
      state.detailWin = v;
      $$('#dWin button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
      if (state.detail) drawDetail(state.detail, v);
    });
    // 返回
    $('#btnBack').onclick = backToOverview;
    // 抽屉
    $('#dClose').onclick = closeDrawer;
    $('#mask').onclick = closeDrawer;
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (!$('#drawer').hidden) closeDrawer(); else if (!$('#upModal').hidden) closeModal(); }
    });
    // 静态快照版：禁用所有写/实时操作，仅保留查看、筛选、排序、CSV 导出、单合约下钻
    const isStatic = STATIC_MODE || new URLSearchParams(location.search).get('static') === '1';
    // 刷新：禁用并提示
    const btnRefresh = $('#btnRefresh');
    btnRefresh.disabled = true;
    btnRefresh.title = '静态快照版，无实时刷新';
    btnRefresh.onclick = () => toast('静态快照版：数据已冻结，无实时刷新');
    // 导出：改用前端 CSV（替代后端 /api/export）
    $('#btnExport').onclick = () => exportCsv();
    // 自动刷新：禁用
    const autoRefresh = $('#autoRefresh');
    if (autoRefresh) { autoRefresh.checked = false; autoRefresh.disabled = true; autoRefresh.parentElement && (autoRefresh.parentElement.style.opacity = '.5'); }
    if (!isStatic) state.autoTimer = setInterval(() => loadCurrent(true), 60000);
    // 数据更新弹窗：隐藏入口
    const btnUpdate = $('#btnUpdate');
    if (btnUpdate) { btnUpdate.style.display = 'none'; btnUpdate.onclick = (e) => e.preventDefault(); }
    $('#upClose').onclick = closeModal;
    $('#upMask').onclick = closeModal;
    $('#doRefresh').onclick = () => doRefresh($('#srcSeg .on').dataset.v);
    $('#doBuild').onclick = startBuild;
    $('#doStop').onclick = async () => {
      try {
        await api('/api/build/stop', { method: 'POST' });
        $('#ptext').textContent += '　[已请求停止…]';
        $('#doStop').disabled = true;
      } catch (e) { toast('停止失败: ' + e.message); }
    };
    $('#doImport').onclick = doImport;
    $('#doVerify').onclick = doVerify;
    $('#ibToggle').onclick = e => {
      const b = $('#ibBody');
      const on = b.classList.toggle('collapsed');
      e.target.textContent = on ? '展开' : '收起';
    };
    $('#ibRefresh').onclick = () => loadIndexBasis(true);
    $('#importFile').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { $('#importText').value = rd.result; toast('已读入 ' + f.name + '，点击「导入」提交'); };
      rd.readAsText(f, 'utf-8');
    };
  }

  function segBind(sel, cb) {
    $$(sel + ' button').forEach(b => b.onclick = () => {
      $$(sel + ' button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); cb(b.dataset.v);
    });
  }

  async function doRefresh(source, silent) {
    const btn = $('#btnRefresh');
    btn.disabled = true; btn.textContent = '刷新中…';
    try {
      const u = '/api/refresh' + (source ? '?source=' + source : '');
      const j = await api(u);
      if (!silent) toast(`已刷新：${j.sourceName} · ${j.count} 个合约 · ${j.ms}ms`);
      await loadCurrent(true);
      loadIndexBasis(false);
    } catch (e) { toast('刷新失败: ' + e.message, 5000); }
    finally { btn.disabled = false; btn.textContent = '刷新行情'; }
  }

  // ---------------- 数据更新弹窗 ----------------
  async function openModal() {
    $('#upModal').hidden = false; $('#upMask').hidden = false;
    try { state.status = await api('/api/status'); renderDbStat(); } catch (e) { }
  }
  function closeModal() { $('#upModal').hidden = true; $('#upMask').hidden = true; }

  function renderDbStat() {
    const h = state.status && state.status.history;
    if (!h) return;
    const built = state.prods ? state.prods.filter(p => p.built).length : 0;
    $('#dbStat').innerHTML = [
      ['已建库品种', built + ' / ' + (state.prods ? state.prods.length : '—')],
      ['合约总数', fmtInt(h.totalContracts)],
      ['日K条数', fmtInt(h.totalBars)],
      ['数据源', '新浪(主) + 东财(备)'],
    ].map(x => `<div><span>${esc(x[0])}</span><b>${esc(x[1])}</b></div>`).join('');
  }

  function startBuild() {
    const years = $('#buildYears').value, conc = $('#buildConc').value, force = $('#buildForce').checked;
    $('#prog').hidden = false; $('#buildLog').hidden = false;
    $('#buildLog').textContent = '';
    $('#doBuild').disabled = true;
    $('#doStop').hidden = false; $('#doStop').disabled = false;
    if (state.es) state.es.close();
    state.es = new EventSource('/api/build/stream');
    let done = 0;
    state.es.addEventListener('start', e => {
      const d = JSON.parse(e.data);
      $('#ptext').textContent = `开始构建 ${d.total} 个品种（回溯 ${d.years} 年）`;
    });
    state.es.addEventListener('progress', e => {
      const d = JSON.parse(e.data);
      done = d.i;
      const p = (d.i / d.total * 100).toFixed(1);
      $('#pbarFill').style.width = p + '%';
      $('#ptext').textContent = `[${d.i + 1}/${d.total}] ${d.product} ${d.name}`;
    });
    state.es.addEventListener('tick', e => {
      const d = JSON.parse(e.data);
      $('#ptext').textContent = `[${done + 1}] ${d.product}  抓取合约 ${d.done}/${d.total}  最新 ${d.sym}  (新浪 ${d.stat.sina} / 东财 ${d.stat.eastmoney} / 失败 ${d.stat.fail})`;
    });
    state.es.addEventListener('product', e => {
      const d = JSON.parse(e.data);
      const lg = $('#buildLog');
      if (d.error) lg.textContent += `✗ ${d.product} 失败: ${d.error}\n`;
      else lg.textContent += `✓ ${d.product} ${d.name}  合约 ${d.contracts}（新抓 ${d.ok}）  新浪 ${d.srcStat.sina} / 东财 ${d.srcStat.eastmoney}\n`;
      lg.scrollTop = lg.scrollHeight;
    });
    state.es.addEventListener('done', e => {
      const d = JSON.parse(e.data);
      $('#pbarFill').style.width = '100%';
      $('#ptext').textContent = `构建${d.stopped ? '已停止' : '完成'}，处理 ${d.results.length} 个品种，耗时 ${(d.ms / 1000).toFixed(0)}s`;
      state.es.close(); state.es = null;
      $('#doBuild').disabled = false;
      $('#doStop').hidden = true;
      toast('历史库构建完成，正在重算分位…');
      api('/api/products').then(j => { state.prods = j.products; buildProdSelect(); renderDbStat(); });
      loadCurrent(true);
    });
    state.es.addEventListener('error', e => {
      $('#ptext').textContent += ' [连接错误]';
      if (state.es) state.es.close();
      state.es = null; $('#doBuild').disabled = false;
    });
    fetch('/api/build', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ years: +years, concurrency: +conc, force: force, base: state.filters.base }),
    }).then(r => r.json()).then(j => {
      if (!j.ok) { $('#ptext').textContent = '启动失败: ' + j.error; $('#doBuild').disabled = false; }
    }).catch(e => { $('#ptext').textContent = '启动失败: ' + e.message; $('#doBuild').disabled = false; });
  }

  async function doImport() {
    const txt = $('#importText').value.trim();
    if (!txt) { toast('请先粘贴或选择文件内容'); return; }
    const msg = $('#importMsg');
    msg.className = 'msg'; msg.textContent = '导入中…';
    try {
      const j = await api('/api/import', { method: 'POST', body: txt });
      msg.className = 'msg ok';
      msg.textContent = '导入成功：' + j.report.map(r =>
        r.error ? `${r.product} 跳过(${r.error})` : `${r.product} ${r.name} 新增${r.added} 更新${r.updated}`).join('；');
      toast('导入完成，正在重算分位…');
      await loadCurrent(true);
      const d = state.detail;
      if (state.selected && d) loadDetail(d.product, state.selected);
    } catch (e) {
      msg.className = 'msg err'; msg.textContent = '导入失败: ' + e.message;
    }
  }

  init();
})();
