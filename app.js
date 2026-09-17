/* 工具箱首页 — 数据驱动，仅依赖 catalog.json，新增工具无需改此文件 */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };

  var state = { cat: 'all', q: '', data: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function load() {
    fetch('catalog.json?t=' + Date.now())
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(render)
      .catch(function (e) {
        $('#main').innerHTML = '<div class="err">目录加载失败：' + esc(e.message) +
          '<br>请确认 catalog.json 与本页面同目录，且通过 http(s) 访问（GitHub Pages 正常）。</div>';
      });
  }

  function render(data) {
    state.data = data;
    var cats = data.categories || [];
    var tools = data.tools || [];

    if (data.title) $('#siteTitle').textContent = data.title;
    if (data.subtitle) $('#siteSub').textContent = data.subtitle;
    if (data.updated) $('#footUpdated').textContent = '更新于 ' + data.updated;

    // 分类导航
    var nav = '<button class="cat-chip' + (state.cat === 'all' ? ' on' : '') + '" data-cat="all">全部</button>';
    cats.forEach(function (c) {
      nav += '<button class="cat-chip' + (state.cat === c.id ? ' on' : '') + '" data-cat="' +
        esc(c.id) + '">' + esc(c.icon || '') + ' ' + esc(c.name) + '</button>';
    });
    $('#catNavInner').innerHTML = nav;
    Array.prototype.forEach.call(document.querySelectorAll('.cat-chip'), function (b) {
      b.onclick = function () { state.cat = b.dataset.cat; render(state.data); };
    });

    // 搜索
    $('#q').oninput = function (e) { state.q = e.target.value.trim().toLowerCase(); render(state.data); };

    // 主区
    var main = $('#main');
    var list = tools.filter(match);
    if (!list.length) { main.innerHTML = '<div class="empty">没有匹配的工具。</div>'; return; }

    if (state.cat === 'all') {
      var html = '';
      cats.forEach(function (c) {
        var grp = list.filter(function (t) { return t.cat === c.id; });
        if (grp.length) html += block(c, grp);
      });
      // 未归类工具兜底
      var unc = list.filter(function (t) { return !cats.some(function (c) { return c.id === t.cat; }); });
      if (unc.length) html += block({ name: '其他', icon: '📦', desc: '' }, unc);
      main.innerHTML = html || '<div class="empty">目录为空。</div>';
    } else {
      var cur = cats.filter(function (c) { return c.id === state.cat; })[0];
      main.innerHTML = block(cur || { name: '工具', icon: '', desc: '' }, list);
    }
    bindCards();
  }

  function match(t) {
    if (state.cat !== 'all' && t.cat !== state.cat) return false;
    if (!state.q) return true;
    var hay = (t.title + ' ' + (t.desc || '') + ' ' + (t.tags || []).join(' ')).toLowerCase();
    return hay.indexOf(state.q) >= 0;
  }

  function block(c, tools) {
    var cards = tools.map(card).join('');
    return '<section class="cat-block"><div class="cat-head"><span class="icon">' + esc(c.icon || '') +
      '</span><h2>' + esc(c.name) + '</h2>' + (c.desc ? '<span class="desc">' + esc(c.desc) + '</span>' : '') +
      '</div><div class="grid">' + cards + '</div></section>';
  }

  function card(t) {
    var tags = (t.tags || []).slice(0, 4).map(function (x) { return '<span class="tag">' + esc(x) + '</span>'; }).join('');
    return '<a class="card" href="' + esc(t.file) + '" data-id="' + esc(t.id) + '">' +
      '<div class="ct">' + esc(t.title) + '</div>' +
      '<div class="cd">' + esc(t.desc || '') + '</div>' +
      (tags ? '<div class="tags">' + tags + '</div>' : '') +
      '<div class="meta"><span>' + esc(t.date || '') + '</span><span>打开 ›</span></div>' +
      '</a>';
  }

  function bindCards() { /* 卡片为纯 <a> 链接，无需额外绑定 */ }

  load();
})();
