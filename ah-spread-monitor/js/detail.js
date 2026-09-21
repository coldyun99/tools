/*
 * 详情页数据加载：双模式自动降级
 *   1) 优先 ./api/spread?aCode=...&hCode=... —— 自托管 Node 后端（实时 + 服务端缓存）
 *   2) 失败则 ./data/hist_<aCode>.json        —— GitHub Pages 等静态站点（构建期快照）
 * 使用相对路径，确保项目页子路径（user.github.io/<repo>/）也能正确解析。
 */
const params = new URLSearchParams(location.search);
const aCode = params.get('aCode'), hCode = params.get('hCode'), name = params.get('name') || aCode;
document.getElementById('title').textContent = name + ' · 价差历史';
let ALL = [], chart = null, staticMode = false;

async function load() {
  if (location.protocol === 'file:') {
    const el = document.getElementById('srcLabel');
    el.textContent = '请用服务器打开'; el.className = 'badge demo';
    document.getElementById('stats').innerHTML =
      '<span style="color:#c00;line-height:1.9">本页不能直接双击(file://)打开——浏览器会拦截本地数据读取。<br>' +
      '请运行 <b>node server.js</b> 后访问 http://localhost:3000/detail.html?aCode=sh601318&hCode=hk02318&name=中国平安</span>';
    return;
  }
  // 模式一：后端实时 API
  try {
    const r = await fetch('./api/spread?aCode=' + encodeURIComponent(aCode) + '&hCode=' + encodeURIComponent(hCode));
    if (r.ok) { apply(await r.json(), 'live'); return; }
  } catch (e) { /* 无后端，继续尝试静态 */ }
  // 模式二：静态快照（GitHub Pages）—— 仅当为"真实构建数据"时才用；演示数据忽略，回落在线取真实
  try {
    const r = await fetch('./data/hist_' + encodeURIComponent(aCode) + '.json');
    if (r.ok) {
      const d = await r.json();
      if (d && Array.isArray(d.series) && d.series.length && !d.demo) { apply(d, 'static'); return; }
    }
  } catch (e) { /* 继续在线 */ }
  // 模式三：浏览器端在线拉取（纯静态部署 / 新加股票 / 静态仅为演示数据时，现拉真实历史，无需重建）
  try {
    let series = getHistCache(aCode);
    if (!series) { const d = await onlineHistory(aCode, hCode); series = d.series; setHistCache(aCode, series); }
    apply({ series: series, demo: false, online: true }, 'online'); return;
  } catch (e) {
    const el = document.getElementById('srcLabel');
    el.textContent = '在线拉取失败'; el.className = 'badge demo';
    document.getElementById('stats').innerHTML = '<span style="color:#c00">在线拉取历史失败：' + e.message + '。可点"在线拉取"重试，或检查网络 / CORS 代理可达性。</span>';
  }
}
function apply(d, mode) {
  staticMode = (mode === 'static' || mode === 'online');
  ALL = d.series || [];
  const el = document.getElementById('srcLabel');
  if (mode === 'static') {
    el.textContent = '静态快照(构建数据)'; el.className = 'badge demo';
  } else if (mode === 'online') {
    el.textContent = '在线实时(代理)'; el.className = 'badge live';
  } else {
    el.textContent = d.demo ? '演示数据' : '实时+缓存'; el.className = 'badge ' + (d.demo ? 'demo' : 'live');
  }
  document.querySelector('.controls button[data-r="365"]').classList.add('active');
  render(365);
}
function statsFor(rows) {
  if (!rows.length) return {};
  const vals = rows.map(r => r.spread);
  const cur = vals[vals.length - 1];
  const min = Math.min(...vals), max = Math.max(...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length * 0.5)];
  return { cur, min, max, avg, median };
}
// 当前溢价在"全部历史"中的分位（0~100%），用于判断贵/便宜
function percentileOf(series, value) {
  if (!series.length || value == null || isNaN(value)) return null;
  let c = 0; for (const r of series) if (r.spread <= value) c++;
  return c / series.length; // 区间分位：0~1 小数，非百分比
}
function pctLabel(p) {
  if (p == null) return '';
  if (p >= 0.8) return '（历史高位）';
  if (p <= 0.2) return '（历史低位）';
  return '';
}
function render(days) {
  let rows = ALL;
  if (days > 0) {
    const cut = new Date(); cut.setDate(cut.getDate() - days);
    const cs = cut.toISOString().slice(0, 10);
    rows = ALL.filter(r => r.date >= cs);
  }
  const s = statsFor(rows);
  const pct = percentileOf(rows, s.cur);
  document.getElementById('stats').innerHTML =
    '当前: <b class="' + cls(s.cur) + '">' + fmt(s.cur, 3) + '</b>' +
    (pct != null ? ' ｜ <b>区间分位: ' + pct.toFixed(3) + pctLabel(pct) + '</b>' : '') +
    ' ｜ 区间均值: ' + fmt(s.avg, 3) + ' ｜ 中位数: ' + fmt(s.median, 3) + ' ｜ 区间最低: ' + fmt(s.min, 3) +
    ' ｜ 最高: ' + fmt(s.max, 3);
  if (!chart) chart = echarts.init(document.getElementById('chart'));
  const markLines = [{ yAxis: 0, lineStyle: { color: '#999' } }];
  if (s.cur != null && !isNaN(s.cur)) {
    markLines.push({
      yAxis: s.cur, lineStyle: { color: cls(s.cur) === 'up' ? '#e11d48' : '#16a34a', type: 'dashed' },
      label: { formatter: '当前 ' + (pct != null ? pct.toFixed(2) : ''), position: 'end' }
    });
  }
  chart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 55, right: 20, top: 30, bottom: 70 },
    xAxis: { type: 'category', data: rows.map(r => r.date) },
    dataZoom: [{ type: 'slider', start: 60, end: 100 }, { type: 'inside' }],
    yAxis: { type: 'value', name: 'A/H比值' },
    series: [{
      name: 'A/H比值', type: 'line', data: rows.map(r => r.spread),
      showSymbol: false, lineStyle: { width: 1.5 },
      markLine: { silent: true, data: markLines }
    }]
  });
}
document.querySelectorAll('.controls button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.controls button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  render(Number(b.dataset.r));
});
const onlineBtn = document.getElementById('onlineBtn');
if (onlineBtn) onlineBtn.onclick = () => { try { localStorage.removeItem(histCacheKey(aCode)); } catch (e) {} load(); };
load();
