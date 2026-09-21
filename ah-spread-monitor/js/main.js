/*
 * 主页面：双模式 + 品种增删（localStorage 持久化）
 *   实时模式: POST ./api/quotes（携带当前品种列表，支持 UI 新增的品种）
 *   静态模式: ./data/quotes.json（仅含构建期品种；新增品种显示"需构建"）
 *   品种定义来源: ./data/products.json（构建期生成）；localStorage 存增删覆盖。
 * 使用相对路径，确保项目页子路径（user.github.io/<repo>/）也能正确解析。
 */
const REFRESH_MS = 15000;
let timer = null, staticMode = false;
const LS_KEY = 'ahm_products_v1';

/* ---------------- 品种列表（基础 + 本地增删覆盖） ---------------- */
function getOv() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || { added: [], removed: [] }; }
  catch (e) { return { added: [], removed: [] }; }
}
function setOv(o) { localStorage.setItem(LS_KEY, JSON.stringify(o)); }

async function getBaseProducts() {
  try { const r = await fetch('./data/products.json'); if (r.ok) { const j = await r.json(); if (j && Array.isArray(j.products)) return j.products; } } catch (e) {}
  try { const r = await fetch('./data/quotes.json'); if (r.ok) { const j = await r.json(); return (j.rows || []).map(x => ({ type: x.type, name: x.name, aCode: x.aCode, hCode: x.hCode, metricName: x.metricName })); } } catch (e) {}
  return [];
}
async function getEffective() {
  const base = await getBaseProducts();
  const ov = getOv();
  const removed = new Set(ov.removed || []);
  const byCode = new Map();
  base.filter(p => !removed.has(p.aCode)).forEach(p => byCode.set(p.aCode, p));
  (ov.added || []).forEach(a => byCode.set(a.aCode, a));
  return [...byCode.values()];
}

/* ---------------- 渲染 ---------------- */
function renderRows(rows, mode, rate, updated, builtAt) {
  staticMode = (mode === 'static');
  document.getElementById('rateLabel').textContent = 'CNY→HKD 汇率: ' + fmt(rate, 4);
  const upd = builtAt ? new Date(builtAt).toLocaleString() : (updated ? new Date(updated).toLocaleTimeString() : '');
  document.getElementById('updLabel').textContent = (staticMode ? '快照: ' : '更新: ') + upd;

  const srcEl = document.getElementById('srcLabel');
  if (staticMode) { srcEl.textContent = '静态快照(构建数据)'; srcEl.className = 'badge demo'; }
  else {
    const live = rows.filter(x => x.live).length;
    const s = live === rows.length ? '实时' : (live === 0 ? '演示' : '混合');
    srcEl.textContent = s + '数据'; srcEl.className = 'badge ' + (live === rows.length ? 'live' : (live === 0 ? 'demo' : 'mix'));
  }

  const tb = document.getElementById('tbody'); tb.innerHTML = '';
  rows.forEach(x => {
    const f = x.fields || {}; const pending = x.pending; const mc = x.metricName || 'A/H比值';
    document.getElementById('metricCol').textContent = mc;
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + x.name + '</td>' +
      '<td>' + (x.type || 'ah').toUpperCase() + '</td>' +
      '<td>' + x.aCode + '</td>' +
      (pending
        ? '<td colspan="2" style="color:#999">— 详情页在线看 —</td>'
        : '<td class="' + cls(f.aChg) + '">' + fmt(f.aPrice) + '</td><td class="' + cls(f.aChg) + '">' + pct(f.aChg) + '</td>') +
      '<td>' + x.hCode + '</td>' +
      (pending
        ? '<td colspan="2" style="color:#999">点开详情页在线拉历史</td>'
        : '<td class="' + cls(f.hChg) + '">' + fmt(f.hPrice) + '</td><td class="' + cls(f.hChg) + '">' + pct(f.hChg) + '</td>') +
      (pending ? '<td style="color:#999">—</td>' : '<td class="' + cls(x.metric) + '">' + fmt(x.metric, 3) + '</td>') +
      '<td><a href="./detail.html?aCode=' + x.aCode + '&hCode=' + x.hCode + '&name=' + encodeURIComponent(x.name) + '">查看</a></td>';
    tb.appendChild(tr);
  });

  if (!staticMode && !timer) timer = setInterval(load, REFRESH_MS); // 静态快照无需轮询
}

/* ---------------- 数据加载（双模式） ---------------- */
async function load() {
  if (location.protocol === 'file:') {
    const el = document.getElementById('srcLabel');
    el.textContent = '请用服务器打开'; el.className = 'badge demo';
    document.getElementById('tbody').innerHTML =
      '<tr><td colspan="10" style="text-align:center;color:#c00;padding:24px;line-height:1.9">' +
      '本页不能直接双击(file://)打开——浏览器会拦截本地数据读取。<br>' +
      '请在本项目目录运行 <b>node server.js</b> 后访问 <b>http://localhost:3000</b>；<br>' +
      '或任意静态服务器托管 public/（如 <b>python -m http.server 8080</b> 后开 http://localhost:8080）。</td></tr>';
    return;
  }
  const effective = await getEffective();
  // 模式一：后端实时 API（POST 当前品种列表，支持新增品种）
  try {
    const r = await fetch('./api/quotes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: effective })
    });
    if (r.ok) { const d = await r.json(); renderRows(d.rows, 'live', d.rate, d.updated, d.builtAt); return; }
  } catch (e) { /* 无后端，继续尝试静态 */ }
  // 模式二：静态快照（GitHub Pages）
  try {
    const r = await fetch('./data/quotes.json');
    if (r.ok) {
      const d = await r.json();
      const map = new Map((d.rows || []).map(x => [x.aCode, x]));
      const rows = effective.map(p => {
        const q = map.get(p.aCode);
        if (q) return q;
        return { id: p.aCode, type: p.type, name: p.name, aCode: p.aCode, hCode: p.hCode, metricName: p.metricName || 'A/H比值', live: false, pending: true, fields: {}, metric: null };
      });
      renderRows(rows, 'static', d.rate, d.updated, d.builtAt); return;
    }
  } catch (e) { /* 都失败 */ }
  const el = document.getElementById('srcLabel');
  el.textContent = '加载失败'; el.className = 'badge demo';
}

/* ---------------- 品种管理 UI ---------------- */
function renderManage() {
  getEffective().then(list => {
    const ov = getOv();
    const box = document.getElementById('mgList'); box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="hint">暂无品种</div>'; return; }
    list.forEach(p => {
      const li = document.createElement('div'); li.className = 'mg-item';
      const isAdded = (ov.added || []).some(a => a.aCode === p.aCode);
      li.innerHTML = '<span>' + p.name + ' <small>' + p.aCode + ' / ' + p.hCode + (isAdded ? ' ·新增' : '') + '</small></span>';
      const btn = document.createElement('button'); btn.textContent = '删除'; btn.className = 'mg-del';
      btn.onclick = () => removeProduct(p.aCode);
      li.appendChild(btn); box.appendChild(li);
    });
  });
}
function removeProduct(code) {
  const ov = getOv();
  if ((ov.added || []).some(a => a.aCode === code)) ov.added = ov.added.filter(a => a.aCode !== code);
  else ov.removed = [...new Set([...(ov.removed || []), code])];
  setOv(ov); renderManage(); load();
}
function addProduct() {
  const name = document.getElementById('mgName').value.trim();
  const type = document.getElementById('mgType').value.trim() || 'ah';
  const aCode = document.getElementById('mgA').value.trim();
  const hCode = document.getElementById('mgH').value.trim();
  if (!name || !aCode || !hCode) { alert('请填写名称、A股代码、H股代码'); return; }
  if (!/^(sh|sz|hk)/i.test(aCode) || !/^(sh|sz|hk)/i.test(hCode)) { alert('代码需以 sh/sz/hk 开头，如 sh601318 / hk02318'); return; }
  const ov = getOv();
  ov.added = (ov.added || []).filter(a => a.aCode !== aCode);
  ov.added.push({ type, name, aCode, hCode, metricName: type === 'ah' ? 'A/H比值' : '指标%' });
  ov.removed = (ov.removed || []).filter(c => c !== aCode);
  setOv(ov);
  document.getElementById('mgName').value = ''; document.getElementById('mgA').value = ''; document.getElementById('mgH').value = '';
  renderManage(); load();
}
function exportConfig() {
  getEffective().then(list => {
    const out = {
      rateCNYtoHKD: 1.099, historyCacheDays: 1,
      products: list.map(p => ({ type: p.type, name: p.name, aCode: p.aCode, hCode: p.hCode }))
    };
    document.getElementById('mgExport').value = JSON.stringify(out, null, 2);
  });
}

/* ---------------- 初始化 ---------------- */
document.getElementById('refreshBtn').onclick = load;
document.getElementById('manageBtn').onclick = () => {
  const p = document.getElementById('managePanel');
  p.style.display = (p.style.display === 'none') ? 'block' : 'none';
  if (p.style.display === 'block') renderManage();
};
document.getElementById('closeManage').onclick = () => { document.getElementById('managePanel').style.display = 'none'; };
document.getElementById('addBtn').onclick = addProduct;
document.getElementById('exportBtn').onclick = exportConfig;
load();
