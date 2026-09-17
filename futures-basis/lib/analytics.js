/* 升贴水计算与历史分位（浏览器版，无 Node 依赖）
 * 移植自原 server/lib/analytics.js：
 *   - 去掉 fs/path/history（历史分位库改为异步 fetch 预建静态文件 api/spreads/<CODE>.json）
 *   - getSpreads/productBasis/productOverview 改为 async（返回 Promise）
 * 口径同原版：跨期 Calendar Spread，annual=(远端-近端)/近端×12/|D|，分位在同一 |D| 桶历史分布中计算。
 */
(function (global) {
  'use strict';

  var I = global.Instruments;
  var MAX_BUCKET = 12;

  // ---------- 分位库（异步加载 + 内存缓存） ----------
  var _cache = new Map();
  var _inflight = new Map();

  async function getSpreads(product) {
    var key = product.toUpperCase();
    if (_cache.has(key)) return _cache.get(key);
    if (_inflight.has(key)) return _inflight.get(key);
    var p = fetch('api/spreads/' + key + '.json')
      .then(function (r) { if (!r.ok) throw new Error('分位库 ' + key + ' 缺失'); return r.json(); })
      .then(function (j) { _cache.set(key, j); _inflight.delete(key); return j; })
      .catch(function (e) { _inflight.delete(key); throw e; });
    _inflight.set(key, p);
    return p;
  }

  function invalidate(product) {
    if (product) _cache.delete(product.toUpperCase());
    else _cache.clear();
  }

  // ---------- 分位数 ----------
  function percentile(bucket, value, windowDays, endDate) {
    if (!bucket || !bucket.d || !bucket.d.length || !isFinite(value)) {
      return { pct: null, n: 0, min: null, max: null, median: null, mean: null };
    }
    var endMs = endDate ? Date.parse(endDate) : Date.parse(bucket.d[bucket.d.length - 1]);
    var startMs = endMs - windowDays * 86400000;
    var vals = [];
    for (var i = 0; i < bucket.d.length; i++) {
      var t = Date.parse(bucket.d[i]);
      if (t >= startMs && t <= endMs + 86400000) vals.push(bucket.a[i]);
    }
    if (!vals.length) return { pct: null, n: 0, min: null, max: null, median: null, mean: null };
    var le = 0, sum = 0;
    for (var k = 0; k < vals.length; k++) { if (vals[k] <= value) le++; sum += vals[k]; }
    var sorted = vals.slice().sort(function (a, b) { return a - b; });
    var n = sorted.length;
    var median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    return {
      pct: le / n * 100, n: n,
      min: sorted[0], max: sorted[n - 1], median: median, mean: sum / n,
      p25: sorted[Math.floor(n * 0.25)], p75: sorted[Math.floor(n * 0.75)], vals: vals
    };
  }

  function histogram(vals, bins) {
    bins = bins || 30;
    if (!vals || vals.length < 2) return { bins: [], edges: [], min: 0, max: 0 };
    var sorted = vals.slice().sort(function (a, b) { return a - b; });
    var lo = sorted[Math.floor(sorted.length * 0.01)];
    var hi = sorted[Math.floor(sorted.length * 0.99)];
    var min = lo, max = hi > lo ? hi : lo + 1e-9;
    var step = (max - min) / bins;
    var counts = new Array(bins).fill(0);
    for (var i = 0; i < vals.length; i++) {
      var idx = Math.floor((vals[i] - min) / step);
      if (idx < 0) idx = 0;
      if (idx >= bins) idx = bins - 1;
      counts[idx]++;
    }
    var edges = [];
    for (var j = 0; j <= bins; j++) edges.push(min + j * step);
    return { bins: counts, edges: edges, min: min, max: max, total: vals.length };
  }

  function median(arr) {
    if (!arr || !arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var n = s.length;
    if (n % 2) return s[(n - 1) / 2];
    return (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  // ---------- 单品种当前合约升贴水 ----------
  async function productBasis(product, quotes, opts) {
    opts = opts || {};
    var inst = I.BY_CODE[product];
    if (!inst) return null;
    var sp = await getSpreads(product);
    if (!sp) return null;

    var live = [];
    Object.keys(quotes || {}).forEach(function (code) {
      var p = I.parseContract(code);
      if (!p || p.product !== product) return;
      var q = quotes[code];
      if (!q || !(q.last > 0)) return;
      live.push({ sym: code, ym: p.year * 12 + p.month, year: p.year, month: p.month, q: q });
    });
    if (!live.length) return null;
    live.sort(function (a, b) { return a.ym - b.ym; });

    var minLiqShare = opts.minLiqShare != null ? opts.minLiqShare : 0.01;
    var maxV = 0;
    live.forEach(function (x) { if ((x.q.volume || 0) > maxV) maxV = x.q.volume; });
    var liquid = maxV > 0 ? live.filter(function (x) { return (x.q.volume || 0) >= maxV * minLiqShare; }) : live;
    var poolRows = liquid.length >= 2 ? liquid : live;
    var liquidSet = new Set(poolRows.map(function (x) { return x.sym; }));

    var baseRow;
    if ((opts.base || 'main') === 'near') baseRow = live[0];
    else baseRow = poolRows.reduce(function (b, x) { return ((x.q.oi || 0) > (b.q.oi || 0) ? x : b); }, poolRows[0]);
    var basePx = baseRow.q.last;

    var w3 = opts.window3y || 3 * 365;
    var w5 = opts.window5y || 5 * 365;
    var endDate = opts.endDate || null;

    var rows = live.map(function (x) {
      var D = x.ym - baseRow.ym;
      var spread = x.q.last - basePx;
      var rate = spread / basePx;
      var annual = null, p3 = null, p5 = null, n3 = 0, n5 = 0;
      if (D > 0 && D <= MAX_BUCKET) {
        annual = rate * 12 / D;
        var b = sp.buckets && sp.buckets[D];
        if (b) {
          var r3 = percentile(b, annual, w3, endDate);
          var r5 = percentile(b, annual, w5, endDate);
          p3 = r3.pct; n3 = r3.n;
          p5 = r5.pct; n5 = r5.n;
        }
      }
      return {
        symbol: x.sym, product: product, productName: inst.name, ex: inst.ex, exName: inst.exName,
        year: x.year, month: x.month, ym: x.ym,
        last: x.q.last, prevSettle: x.q.prevSettle, pct: x.q.pct,
        oi: x.q.oi, volume: x.q.volume, amount: x.q.amount,
        isBase: x.sym === baseRow.sym, lowLiq: !liquidSet.has(x.sym),
        D: D, spread: spread, rate: rate, annual: annual,
        p3: p3, p5: p5, n3: n3, n5: n5
      };
    });

    return {
      product: product, name: inst.name, ex: inst.ex, exName: inst.exName,
      mult: inst.mult, unit: inst.unit,
      baseSymbol: baseRow.sym, basePrice: basePx, baseOi: baseRow.q.oi,
      baseMode: opts.base || 'main',
      rows: rows,
      spreadMeta: sp.builtAt,
      contractCount: live.length,
      histRange: sp.daily && sp.daily.d && sp.daily.d.length ? [sp.daily.d[0], sp.daily.d[sp.daily.d.length - 1]] : null,
      tradingDays: sp.daily && sp.daily.d ? sp.daily.d.length : 0
    };
  }

  // ---------- 品种级概览（聚合） ----------
  async function productOverview(product, quotes, opts) {
    opts = opts || {};
    var inst = I.BY_CODE[product];
    if (!inst) return null;
    var sp;
    try { sp = await getSpreads(product); } catch (e) { sp = null; }
    if (!sp) {
      return { code: product, name: inst.name, ex: inst.ex, exName: inst.exName,
        built: false, hasLive: false, status: 'na', annual: null, farCount: 0, contractCount: 0,
        baseSymbol: null, basePrice: null, sampleMin: null, sampleMax: null, note: '尚未建立历史库' };
    }
    var live = [];
    Object.keys(quotes || {}).forEach(function (code) {
      var p = I.parseContract(code);
      if (!p || p.product !== product) return;
      var q = quotes[code];
      if (!q || !(q.last > 0)) return;
      live.push({ sym: code, ym: p.year * 12 + p.month, q: q });
    });
    if (!live.length) {
      return { code: product, name: inst.name, ex: inst.ex, exName: inst.exName,
        built: true, hasLive: false, status: 'na', annual: null, farCount: 0, contractCount: 0,
        baseSymbol: null, basePrice: null, sampleMin: null, sampleMax: null, note: '当前无实时行情' };
    }
    live.sort(function (a, b) { return a.ym - b.ym; });
    var minLiqShare = opts.minLiqShare != null ? opts.minLiqShare : 0.01;
    var maxV = 0;
    live.forEach(function (x) { if ((x.q.volume || 0) > maxV) maxV = x.q.volume; });
    var liquid = maxV > 0 ? live.filter(function (x) { return (x.q.volume || 0) >= maxV * minLiqShare; }) : live;
    var poolRows = liquid.length >= 2 ? liquid : live;
    var baseRow = (opts.base || 'main') === 'near' ? live[0]
      : poolRows.reduce(function (b, x) { return ((x.q.oi || 0) > (b.q.oi || 0) ? x : b); }, poolRows[0]);
    var basePx = baseRow.q.last;
    var maxRate = opts.maxRate || 0.6;
    var anns = [];
    live.forEach(function (x) {
      var D = x.ym - baseRow.ym;
      if (D > 0 && D <= MAX_BUCKET) {
        var rate = (x.q.last - basePx) / basePx;
        var a = rate * 12 / D;
        if (isFinite(a) && Math.abs(a) <= maxRate) anns.push(a);
      }
    });
    var annual = null, status = 'na', note = '';
    if (anns.length >= 2) annual = median(anns);
    else if (anns.length === 1) { annual = anns[0]; note = '远月样本仅 1 个'; }
    else {
      var naArr = (sp.daily && sp.daily.nearAnnual) || [];
      var na = null;
      for (var i = naArr.length - 1; i >= 0; i--) { if (naArr[i] != null) { na = naArr[i]; break; } }
      if (na != null) { annual = na; note = '仅主力挂牌，取近月-次月结构'; }
      else { annual = null; note = '无远月挂牌且无历史结构'; }
    }
    if (annual == null) status = 'na';
    else if (annual > 0.005) status = 'contango';
    else if (annual < -0.005) status = 'back';
    else status = 'flat';
    return {
      code: product, name: inst.name, ex: inst.ex, exName: inst.exName,
      built: true, hasLive: true, status: status, annual: annual,
      farCount: anns.length, contractCount: live.length,
      baseSymbol: baseRow.sym, basePrice: basePx,
      sampleMin: anns.length ? Math.min.apply(null, anns) : null,
      sampleMax: anns.length ? Math.max.apply(null, anns) : null, note: note
    };
  }

  global.Analytics = {
    getSpreads: getSpreads, invalidate: invalidate,
    percentile: percentile, histogram: histogram, productBasis: productBasis,
    productOverview: productOverview, median: median, MAX_BUCKET: MAX_BUCKET
  };
})(typeof window !== 'undefined' ? window : this);
