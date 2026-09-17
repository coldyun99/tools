/* 实时行情拉取（浏览器版，纯前端，无后端）
 * 数据源：东方财富期货快照（CORS*，已实测 https://push2delay.eastmoney.com 带 access-control-allow-origin:*）
 *   - 主源 push2.eastmoney.com（实时）失败/为空时回退 push2delay.eastmoney.com（延时约15分钟）
 *   - 6 家交易所（SHFE/DCE/CZCE/INE/GFEX/CFFEX）逐市场分页拉取，聚合为 {CODE:{last,oi,volume,...}}
 * 说明：GitHub Pages 为 HTTPS，故全部用 https；行情源自带 CORS*，浏览器 fetch 直连无跨域问题。
 */
(function (global) {
  'use strict';

  var MARKETS = { SHFE: '113', DCE: '114', CZCE: '115', INE: '142', GFEX: '225', CFFEX: '220' };
  var FIELDS = 'f1,f2,f3,f4,f5,f6,f7,f12,f13,f14,f15,f16,f17,f18,f20,f21';
  var MAX_PAGES = 25;

  function num(v) {
    if (v == null) return null;
    if (typeof v === 'string') { if (v === '-' || v === '') return null; v = parseFloat(v.replace(/,/g, '')); }
    return isFinite(v) ? v : null;
  }

  async function marketQuotes(host, ex) {
    var mkt = MARKETS[ex];
    var out = {};
    var count = 0;
    for (var pn = 1; pn <= MAX_PAGES; pn++) {
      var url = 'https://' + host + '/api/qt/clist/get?pn=' + pn + '&pz=100&po=0&np=1&fltt=2&invt=2&fid=f12&fs=m:' + mkt + '&fields=' + FIELDS;
      var r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var j = await r.json();
      if (!j.data || !Array.isArray(j.data.diff) || !j.data.diff.length) break;
      j.data.diff.forEach(function (x) {
        var code = (x.f12 || '').toUpperCase();
        var last = num(x.f2);
        if (!code || !isFinite(last)) return;
        out[code] = {
          code: code, name: x.f14 || '', last: last, pct: num(x.f3), chg: num(x.f4),
          volume: num(x.f5), amount: num(x.f6), open: num(x.f17), high: num(x.f15),
          low: num(x.f16), prevClose: num(x.f18), oi: num(x.f20),
          exchange: ex, kind: ex === 'CFFEX' ? 'financial' : 'commodity'
        };
        count++;
      });
      if (j.data.total && count >= j.data.total) break;
    }
    return out;
  }

  // 单 host 尝试：成功且有数据则返回；否则抛错由上层回退
  async function tryHost(host, name) {
    var exs = Object.keys(MARKETS);
    var data = {};
    var meta = {};
    var results = await Promise.all(exs.map(async function (ex) {
      try {
        var r = await marketQuotes(host, ex);
        return { ex: ex, rows: r, err: null };
      } catch (e) { return { ex: ex, rows: {}, err: e.message }; }
    }));
    results.forEach(function (res) {
      Object.keys(res.rows).forEach(function (k) { data[k] = res.rows[k]; });
      meta[res.ex] = { ok: !res.err, count: Object.keys(res.rows).length, error: res.err };
    });
    if (!Object.keys(data).length) throw new Error(name + ' 无数据');
    return { source: host, sourceName: name, data: data, meta: meta, ts: Date.now() };
  }

  async function quotes() {
    var plans = [
      { host: 'push2.eastmoney.com', name: '东方财富(实时)' },
      { host: 'push2delay.eastmoney.com', name: '东方财富(延时15分钟)' }
    ];
    var lastErr = null;
    for (var i = 0; i < plans.length; i++) {
      try {
        var r = await tryHost(plans[i].host, plans[i].name);
        if (r.data && Object.keys(r.data).length) return r;
        lastErr = plans[i].name + ' 返回空';
      } catch (e) { lastErr = e.message; }
    }
    throw new Error('行情获取失败: ' + (lastErr || '未知'));
  }

  global.Quote = { quotes: quotes, MARKETS: MARKETS };
})(typeof window !== 'undefined' ? window : this);
