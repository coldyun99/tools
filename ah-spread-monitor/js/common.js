function fmt(n, d) { d = d || 2; return (n == null || isNaN(n)) ? '-' : Number(n).toFixed(d); }
function pct(n) { const v = Number(n); if (isNaN(v)) return '-'; return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }
function cls(n) { const v = Number(n); if (isNaN(v)) return ''; return v >= 0 ? 'up' : 'down'; }

// ---------------- 浏览器端数据中继（国内云函数，替代公共 CORS 代理） ----------------
// 地址来源优先级：config.js 的 RELAY_BASE > localStorage('ahm_relay') > 空（未配置）。
// 详见 relay/README.md。地址格式示例：https://xxx.apigw.tencentcs.com/release/?url=
function getRelayBase() {
  try {
    const ls = localStorage.getItem('ahm_relay');
    if (ls && ls.trim()) return ls.trim();
  } catch (e) {}
  try {
    if (typeof RELAY_BASE !== 'undefined' && RELAY_BASE && RELAY_BASE.trim()) return RELAY_BASE.trim();
  } catch (e) {}
  return '';
}
function relayFetch(targetUrl) {
  const base = getRelayBase();
  if (!base) return Promise.reject(new Error('未配置中继地址（RELAY_BASE 为空）。请在「管理品种」面板填入你的云函数网关地址，或部署 relay/ 里的函数。'));
  return fetch(base + encodeURIComponent(targetUrl)).then(r => {
    if (!r.ok) throw new Error('中继返回 ' + r.status);
    return r.text();
  });
}
// 解析腾讯 gtimg 行情文本（形如 "sh601318,平安银行,..."~...），数值为 ASCII，GBK 编码不影响数字解析
function parseGtimg(t) {
  const m = (t || '').match(/="([^"]*)"/);
  if (!m) return {};
  const f = m[1].split('~');
  return { name: f[1], price: parseFloat(f[3]), prevClose: parseFloat(f[4]) };
}

function secidOf(sym) {
  if (sym.startsWith('sh')) return '1.' + sym.slice(2);
  if (sym.startsWith('sz')) return '0.' + sym.slice(2);
  if (sym.startsWith('hk')) return '116.' + sym.slice(2);
  return sym;
}
function onlineQuote(sym) {
  return relayFetch('https://qt.gtimg.cn/q=' + sym).then(t => {
    const f = parseGtimg(t);
    if (!f.price) throw new Error('无行情 ' + sym);
    return { price: f.price, prevClose: f.prevClose, name: f.name };
  });
}
function onlineHistory(aCode, hCode) {
  // ⚠️ 东财 kline 接口日期必须是 YYYYMMDD（不带横杠）：带横杠会静默返回空 klines（实测 2026-09-22）
  const end = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const mk = (sec) => 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + sec +
    '&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55&klt=101&fqt=0&beg=20150101&end=' + end;
  return Promise.all([
    relayFetch(mk(secidOf(aCode))),
    relayFetch(mk(secidOf(hCode)))
  ]).then(([ta, th]) => {
    const parse = (t) => { const j = JSON.parse(t); const kl = (j.data && j.data.klines) || []; return kl.map(r => { const f = r.split(','); return { date: f[0], close: parseFloat(f[2]) }; }).filter(r => !isNaN(r.close)); };
    const a = parse(ta), h = parse(th);
    const hm = new Map(h.map(x => [x.date, x.close]));
    const rate = 1.099;
    const series = [];
    for (const x of a) { const hc = hm.get(x.date); if (hc > 0) series.push({ date: x.date, a: +x.close.toFixed(3), h: +hc.toFixed(3), spread: +(x.close * rate / hc) }); }
    if (!series.length) throw new Error('空历史');
    return { series, demo: false, online: true };
  });
}
// 简易本地缓存，减少代理调用（1 天）
function histCacheKey(a) { return 'ahm_hist_' + a; }
function getHistCache(a) { try { const o = JSON.parse(localStorage.getItem(histCacheKey(a))); if (o && o.t && Date.now() - o.t < 864e5) return o.series; } catch (e) {} return null; }
function setHistCache(a, s) { try { localStorage.setItem(histCacheKey(a), JSON.stringify({ t: Date.now(), series: s })); } catch (e) {} }
