function fmt(n, d) { d = d || 2; return (n == null || isNaN(n)) ? '-' : Number(n).toFixed(d); }
function pct(n) { const v = Number(n); if (isNaN(v)) return '-'; return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }
function cls(n) { const v = Number(n); if (isNaN(v)) return ''; return v >= 0 ? 'up' : 'down'; }
