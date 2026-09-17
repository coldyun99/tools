/* 轻量 SVG 图表（零依赖、离线可用、自适应宽度） */
(function (global) {
  const NS = 'http://www.w3.org/2000/svg';
  const C = {
    axis: '#e3e7ed', grid: '#f1f4f7', text: '#8b95a3', text2: '#5b6472',
    line: '#1a56db', fill: 'rgba(26,86,219,.10)',
    cur: '#d92b2b', median: '#98a2b3', band: 'rgba(139,149,163,.10)',
    up: '#d92b2b', dn: '#0d8a4f', zero: '#c4ccd6',
  };

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function svg(w, h) {
    const s = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', height: h, preserveAspectRatio: 'xMidYMid meet' });
    s.style.display = 'block'; s.style.overflow = 'visible';
    return s;
  }
  const pct = (v, d = 2) => (v === null || v === undefined || !isFinite(v)) ? '—' : (v * 100).toFixed(d) + '%';
  const fmtN = (v, d = 1) => (v === null || v === undefined || !isFinite(v)) ? '—' : Number(v).toFixed(d);

  function niceCeil(v) { const m = Math.pow(10, Math.floor(Math.log10(Math.abs(v) || 1))); return Math.ceil(v / m * 1.1) * m / 1.1; }

  /** 绘制：历史分布直方图 + 当前值位置 */
  function histogram(host, o) {
    host.innerHTML = '';
    const hist = o.hist, cur = o.current, stat = o.stat;
    if (!hist || !hist.bins || !hist.bins.length) { host.textContent = '暂无历史数据'; return; }
    const W = 640, H = 230, L = 46, R = 14, T = 14, B = 34;
    const s = svg(W, H);
    let lo = hist.min, hi = hist.max;
    if (cur != null && isFinite(cur)) { lo = Math.min(lo, cur); hi = Math.max(hi, cur); }
    if (hi - lo < 1e-9) { hi = lo + 1e-6; }
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    const x = v => L + (v - lo) / (hi - lo) * (W - L - R);
    const maxC = Math.max.apply(null, hist.bins);
    const y = c => H - B - c / maxC * (H - T - B);

    // 网格
    for (let i = 0; i <= 4; i++) {
      const yy = T + (H - T - B) * i / 4;
      el('line', { x1: L, y1: yy, x2: W - R, y2: yy, stroke: i === 4 ? C.axis : C.grid, 'stroke-width': 1 }, s);
      const t = el('text', { x: L - 6, y: yy + 3.5, 'text-anchor': 'end', fill: C.text, 'font-size': 10 }, s);
      t.textContent = Math.round(maxC * (4 - i) / 4);
    }
    // P25~P75 区间
    if (stat && stat.p25 != null && stat.p75 != null) {
      el('rect', {
        x: x(stat.p25), y: T, width: Math.max(1, x(stat.p75) - x(stat.p25)),
        height: H - T - B, fill: C.band,
      }, s);
    }
    // 柱子
    const step = (hist.edges[1] - hist.edges[0]);
    hist.bins.forEach((c, i) => {
      const x0 = x(hist.edges[i]), x1 = x(hist.edges[i + 1]);
      const r = el('rect', {
        x: x0 + 0.5, y: y(c), width: Math.max(0.8, x1 - x0 - 1), height: Math.max(0, H - B - y(c)),
        fill: '#c9d8f5', rx: 1,
      }, s);
      el('title', {}, r).textContent = `${pct(hist.edges[i])} ~ ${pct(hist.edges[i + 1])}\n样本 ${c} 天 (${(c / hist.total * 100).toFixed(1)}%)`;
      // 当前值落在的柱子高亮
      if (cur != null && cur >= hist.edges[i] && cur < hist.edges[i + 1]) r.setAttribute('fill', '#f0a9a9');
    });
    // 中位数线
    if (stat && stat.median != null) {
      el('line', { x1: x(stat.median), y1: T, x2: x(stat.median), y2: H - B, stroke: C.median, 'stroke-width': 1, 'stroke-dasharray': '3 3' }, s);
      const t = el('text', { x: x(stat.median), y: T - 3, 'text-anchor': 'middle', fill: C.text2, 'font-size': 10 }, s);
      t.textContent = '中位 ' + pct(stat.median);
    }
    // 当前值
    if (cur != null && isFinite(cur)) {
      const cx = x(cur);
      el('line', { x1: cx, y1: T - 6, x2: cx, y2: H - B, stroke: C.cur, 'stroke-width': 2.2 }, s);
      el('circle', { cx, cy: T - 8, r: 3.4, fill: C.cur }, s);
      const label = '当前 ' + pct(cur);
      const w = label.length * 6.6 + 10;
      const bx = Math.min(Math.max(cx - w / 2, L), W - R - w);
      el('rect', { x: bx, y: 0, width: w, height: 16, rx: 4, fill: C.cur }, s);
      const t = el('text', { x: bx + w / 2, y: 11.5, 'text-anchor': 'middle', fill: '#fff', 'font-size': 10.5, 'font-weight': 600 }, s);
      t.textContent = label;
    }
    // X 轴
    el('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, stroke: C.axis }, s);
    [[lo, 'min'], [(lo + hi) / 2, ''], [hi, 'max']].forEach((p, i) => {
      const t = el('text', {
        x: i === 0 ? L : i === 2 ? W - R : (L + W - R) / 2,
        y: H - B + 15, 'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle',
        fill: C.text, 'font-size': 10,
      }, s);
      t.textContent = pct(p[0], 1) + (p[1] ? ' (' + p[1] + ')' : '');
    });
    const cap = el('text', { x: (L + W - R) / 2, y: H - B + 29, 'text-anchor': 'middle', fill: C.text, 'font-size': 10 }, s);
    cap.textContent = `年化升水率（远−近）　样本 ${hist.total} 个交易日`;
    host.appendChild(s);
  }

  /** 绘制：历史时间序列折线 */
  function series(host, o) {
    host.innerHTML = '';
    const d = o.d || [], a = o.a || [];
    if (d.length < 2) { host.textContent = '暂无历史序列'; return; }
    const W = 640, H = 210, L = 46, R = 14, T = 14, B = 30;
    const s = svg(W, H);
    let lo = Math.min.apply(null, a), hi = Math.max.apply(null, a);
    if (o.current != null && isFinite(o.current)) { lo = Math.min(lo, o.current); hi = Math.max(hi, o.current); }
    if (hi - lo < 1e-9) { hi = lo + 1e-6; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const x = i => L + i / (d.length - 1) * (W - L - R);
    const y = v => T + (hi - v) / (hi - lo) * (H - T - B);

    for (let i = 0; i <= 4; i++) {
      const v = lo + (hi - lo) * (4 - i) / 4;
      const yy = y(v);
      el('line', { x1: L, y1: yy, x2: W - R, y2: yy, stroke: (lo < 0 && hi > 0 && Math.abs(v) < (hi - lo) / 40) ? C.zero : C.grid, 'stroke-width': 1 }, s);
      const t = el('text', { x: L - 6, y: yy + 3.5, 'text-anchor': 'end', fill: C.text, 'font-size': 10 }, s);
      t.textContent = (v * 100).toFixed(1) + '%';
    }
    // 零轴
    if (lo < 0 && hi > 0) el('line', { x1: L, y1: y(0), x2: W - R, y2: y(0), stroke: C.zero, 'stroke-dasharray': '4 3' }, s);

    // 面积 + 折线
    let p = `M ${x(0)} ${y(a[0])}`, ap = `M ${x(0)} ${y(Math.max(lo, 0))} L ${x(0)} ${y(a[0])}`;
    for (let i = 1; i < d.length; i++) { p += ` L ${x(i)} ${y(a[i])}`; ap += ` L ${x(i)} ${y(a[i])}`; }
    ap += ` L ${x(d.length - 1)} ${y(Math.max(lo, 0))} Z`;
    el('path', { d: ap, fill: C.fill, stroke: 'none' }, s);
    el('path', { d: p, fill: 'none', stroke: C.line, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, s);

    // 当前值水平线
    if (o.current != null && isFinite(o.current)) {
      const cy = y(o.current);
      el('line', { x1: L, y1: cy, x2: W - R, y2: cy, stroke: C.cur, 'stroke-width': 1.6, 'stroke-dasharray': '5 3' }, s);
      const t = el('text', { x: W - R, y: cy - 4, 'text-anchor': 'end', fill: C.cur, 'font-size': 10.5, 'font-weight': 600 }, s);
      t.textContent = '当前 ' + pct(o.current);
    }
    // X 轴刻度
    [0, Math.floor(d.length / 2), d.length - 1].forEach((i, k) => {
      const t = el('text', {
        x: x(i), y: H - B + 15, 'text-anchor': k === 0 ? 'start' : k === 2 ? 'end' : 'middle',
        fill: C.text, 'font-size': 10,
      }, s);
      t.textContent = d[i];
    });
    host.appendChild(s);
  }

  /** 绘制：期限结构（各合约年化升水率柱状 + 分位标注） */
  function curve(host, o) {
    host.innerHTML = '';
    const rows = (o.rows || []).filter(r => r.annual != null && isFinite(r.annual));
    if (!rows.length) { host.textContent = '暂无可比较的合约（需至少 2 个有报价的合约）'; return; }
    const W = 640, H = 220, L = 46, R = 14, T = 16, B = 46;
    const s = svg(W, H);
    const vals = rows.map(r => r.annual);
    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    lo = Math.min(lo, 0); hi = Math.max(hi, 0);
    if (hi - lo < 1e-9) { hi = lo + 1e-6; }
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    const bw = (W - L - R) / rows.length;
    const y = v => T + (hi - v) / (hi - lo) * (H - T - B);

    for (let i = 0; i <= 4; i++) {
      const v = lo + (hi - lo) * (4 - i) / 4, yy = y(v);
      el('line', { x1: L, y1: yy, x2: W - R, y2: yy, stroke: Math.abs(v) < (hi - lo) / 60 ? C.zero : C.grid, 'stroke-width': 1 }, s);
      const t = el('text', { x: L - 6, y: yy + 3.5, 'text-anchor': 'end', fill: C.text, 'font-size': 10 }, s);
      t.textContent = (v * 100).toFixed(1) + '%';
    }
    el('line', { x1: L, y1: y(0), x2: W - R, y2: y(0), stroke: C.zero, 'stroke-width': 1.2 }, s);

    rows.forEach((r, i) => {
      const cx = L + bw * i + bw / 2;
      const y0 = y(Math.max(0, r.annual)), y1 = y(Math.min(0, r.annual));
      const col = r.annual >= 0 ? C.up : C.dn;
      const rect = el('rect', {
        x: cx - Math.min(20, bw * 0.32), y: y0, width: Math.min(40, bw * 0.64),
        height: Math.max(1, y1 - y0), fill: col, opacity: r.isBase ? 0.35 : 0.82, rx: 2,
      }, s);
      el('title', {}, rect).textContent =
        `${r.symbol}${r.isBase ? '（基准）' : ''}\n年化升水率 ${pct(r.annual)}\n价差 ${fmtN(r.spread)}\n${o.win === 5 ? '5' : '3'}年分位 ${r.p == null ? '—' : r.p.toFixed(1)}`;
      // 分位数字
      if (r.p != null) {
        const t = el('text', { x: cx, y: (r.annual >= 0 ? y0 - 5 : y1 + 12), 'text-anchor': 'middle', fill: C.text2, 'font-size': 9.5 }, s);
        t.textContent = r.p.toFixed(0);
      }
      // X 标签：合约月份
      const lb = el('text', { x: cx, y: H - B + 15, 'text-anchor': 'middle', fill: r.isBase ? '#8a6212' : C.text, 'font-size': 9.5, 'font-weight': r.isBase ? 700 : 400 }, s);
      lb.textContent = r.symbol.slice(-4) + (r.isBase ? '★' : '');
      if (r.p != null) {
        const lb2 = el('text', { x: cx, y: H - B + 27, 'text-anchor': 'middle', fill: pctColor(r.p), 'font-size': 9 }, s);
        lb2.textContent = '分位' + r.p.toFixed(0);
      }
    });
    host.appendChild(s);
  }

  function pctColor(p) {
    if (p == null) return C.text;
    if (p >= 80) return '#d92b2b';
    if (p >= 60) return '#e2703a';
    if (p >= 40) return '#8b95a3';
    if (p >= 20) return '#4b9e73';
    return '#0d8a4f';
  }

  global.Chart = { histogram, series, curve, pct, fmtN, pctColor };
})(window);
