function fmt(n, d) { d = d || 2; return (n == null || isNaN(n)) ? '-' : Number(n).toFixed(d); }
function pct(n) { const v = Number(n); if (isNaN(v)) return '-'; return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }
function cls(n) { const v = Number(n); if (isNaN(v)) return ''; return v >= 0 ? 'up' : 'down'; }

// ---------------- 浏览器端在线拉取（纯静态 GitHub Pages 也能按需取历史，无需重建） ----------------
// 经公共 CORS 代理取东财/腾讯原始数据；仅用于无后端、无预构建历史的静态部署。
// 如你有自己的代理/Cloudflare Worker，改下面这一行即可。
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';
function secidOf(sym) {
  if (sym.startsWith('sh')) return '1.' + sym.slice(2);
  if (sym.startsWith('sz')) return '0.' + sym.slice(2);
  if (sym.startsWith('hk')) return '116.' + sym.slice(2);
  return sym;
}
function onlineQuote(sym) {
  const u = CORS_PROXY + encodeURIComponent('https://qt.gtimg.cn/q=' + sym);
  return fetch(u).then(r => r.text()).then(t => {
    const m = t.match(/="([^"]*)"/);
    if (!m) throw new Error('无行情 ' + sym);
    const f = m[1].split('~');
    return { price: parseFloat(f[3]), prevClose: parseFloat(f[4]), name: f[1] };
  });
}
function onlineHistory(aCode, hCode) {
  const end = new Date().toISOString().slice(0, 10);
  const mk = (sec) => 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + sec +
    '&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55&klt=101&fqt=0&beg=2015-01-01&end=' + end;
  return Promise.all([
    fetch(CORS_PROXY + encodeURIComponent(mk(secidOf(aCode)))).then(r => r.text()),
    fetch(CORS_PROXY + encodeURIComponent(mk(secidOf(hCode)))).then(r => r.text())
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
