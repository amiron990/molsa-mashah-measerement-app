/* ============================================================
   מצפן רשויות מקומיות — מסך תפיסת המדידה
   ============================================================ */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var el = function (t, c, h) {
    var n = document.createElement(t);
    if (c) n.className = c;
    if (h != null) n.innerHTML = h;
    return n;
  };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  var NATIONAL = META.national || 'ארצי';

  /* ---------- אחסון מקומי: משתמש + הערכות ----------
     כל דירוג נשמר בדפדפן וניתן לייצוא ל-CSV.
     כשיוחלט לאן נאספים הנתונים — מלאו כתובת ב-SUBMIT_URL
     וכל שמירה תישלח גם לשם (POST עם גוף JSON). */
  var SUBMIT_URL = '';
  var STORE_KEY = 'kyd_molsa_compass_v1';
  var store = loadStore();

  function loadStore() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && s.ratings) { if (!s.subvotes) s.subvotes = {}; return s; }
    } catch (e) {}
    return { user: null, ratings: {}, subvotes: {} };
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}
  }
  function ratingOf(id) { return store.ratings[id] || null; }
  function setRating(id, patch) {
    var r = store.ratings[id] || { stars: 0, note: '' };
    for (var k in patch) r[k] = patch[k];
    r.ts = new Date().toISOString();
    if (!r.stars && !String(r.note || '').trim()) delete store.ratings[id];
    else store.ratings[id] = r;
    saveStore();
    submitRating(id, r);
  }

  /* ---------- חיבוב תתי נושאים (לייק / דיסלייק) ----------
     כל סימון נשמר בדפדפן לצד דירוגי המדדים, ומיוצא באותו קובץ CSV. */
  function subKey(theme, sub) { return theme + '§' + sub; }
  function voteOf(theme, sub) {
    var v = store.subvotes[subKey(theme, sub)];
    return v ? v.v : 0;
  }
  function setVote(theme, sub, v) {
    var k = subKey(theme, sub);
    if (!v) delete store.subvotes[k];
    else store.subvotes[k] = { v: v, ts: new Date().toISOString() };
    saveStore();
    submitVote(theme, sub, v);
  }

  /* שליחה לשרת — פעילה רק כש-SUBMIT_URL מוגדר */
  function submitRating(id, r) {
    if (!SUBMIT_URL || !window.fetch) return;
    var d = INDICATORS.filter(function (x) { return x.id == id; })[0] || {};
    try {
      fetch(SUBMIT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: (store.user && store.user.name) || '',
          district: (store.user && store.user.district) || '',
          indicatorId: Number(id), indicatorName: d.name || '',
          theme: d.theme || '', sub: d.sub || '',
          kind: 'indicator',
          stars: r.stars || 0, note: r.note || '', ts: r.ts
        })
      }).catch(function () {});
    } catch (e) {}
  }

  function submitVote(theme, sub, v) {
    if (!SUBMIT_URL || !window.fetch) return;
    try {
      fetch(SUBMIT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: (store.user && store.user.name) || '',
          district: (store.user && store.user.district) || '',
          kind: 'sub', theme: theme, sub: sub,
          vote: v, ts: new Date().toISOString()
        })
      }).catch(function () {});
    } catch (e) {}
  }

  /* ---------- עזרי נתונים ---------- */
  var CORE = INDICATORS.filter(function (d) { return d.core === 1; });

  /* סדרה של מדד ברמת תצוגה נתונה → [[YYYY-MM, value], ...] ללא ערכים חסרים */
  function seriesOf(d, scope) {
    var s = SERIES[d.id];
    if (!s) return [];
    var vals = s.v[scope || state.scope];
    if (!vals) return [];
    var out = [];
    for (var i = 0; i < s.m.length; i++) {
      if (vals[i] != null) out.push([s.m[i], vals[i]]);
    }
    return out;
  }
  function hasScope(d, scope) {
    var s = SERIES[d.id];
    return !!(s && s.v[scope]);
  }
  function lastPt(d, scope) { var s = seriesOf(d, scope); return s.length ? s[s.length - 1] : null; }

  function fmtNum(v, dec) {
    return v.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtVal(d, v) {
    if (v == null) return '—';
    if (d.unit === 'אחוז') return fmtNum(v, 1) + '%';
    if (d.unit === 'אנשים') return fmtNum(v, 0);
    return fmtNum(v, Math.abs(v) >= 100 ? 0 : 1);
  }
  function unitCaption(d) {
    if (d.unit === 'אחוז') return '';
    return d.unit.length <= 10 ? d.unit : '';
  }
  function ymLabel(ym) {
    if (!ym) return '';
    var p = ym.split('-');
    return p[1] + '/' + p[0];
  }

  /* השוואה מול אותו חודש בשנה הקודמת; אם אין — מול נקודת המדידה הקודמת */
  function deltaOf(d, scope) {
    var s = seriesOf(d, scope);
    if (s.length < 2) return null;
    var last = s[s.length - 1];
    var y = last[0].split('-'), prevYm = (parseInt(y[0], 10) - 1) + '-' + y[1], base = null;
    for (var i = 0; i < s.length; i++) if (s[i][0] === prevYm) base = s[i];
    if (!base) base = s[s.length - 2];
    if (base[1] === 0) return null;
    var pct = ((last[1] - base[1]) / Math.abs(base[1])) * 100;
    var dir = Math.abs(pct) < 1 ? 'fl' : (pct > 0 ? 'up' : 'dn');
    var good = null;
    if (d.positive === 1) good = pct > 0;
    if (d.positive === 0) good = pct < 0;
    return { pct: pct, dir: dir, good: good, base: base, last: last };
  }

  /* ---------- מצב המסך ---------- */
  var state = {
    q: '', theme: null, sub: null,
    dataOnly: false, unratedOnly: false, view: 'cards',
    scope: NATIONAL
  };

  /* ---------- 01 · עץ הנושאים ---------- */
  function countsBySub() {
    var m = {};
    CORE.forEach(function (d) { m[d.theme + '§' + d.sub] = (m[d.theme + '§' + d.sub] || 0) + 1; });
    return m;
  }
  var SUBCOUNT = countsBySub();

  function heatBucket(n) {
    if (!n) return '0';
    if (n <= 2) return '1';
    if (n <= 4) return '2';
    if (n <= 6) return '3';
    return '4';
  }

  /* אייקוני אגודל — למעלה, ולמטה (אותו נתיב בסיבוב 180°) */
  var THUMB = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M7 21V10.2l4.6-7.2c1.4.2 2.2 1.2 2.2 2.6 0 .9-.2 1.9-.7 3.1h4.6c1.4 0 2.4 1 2.4 2.3 0 .4-.1.8-.2 1.1l-2 6.5c-.4 1.4-1.5 2.4-3 2.4H7Z"/>' +
    '<path d="M7 10.5H4.6c-.9 0-1.6.7-1.6 1.6v7.3c0 .9.7 1.6 1.6 1.6H7"/></svg>';

  function subNode(theme, sub) {
    var n = SUBCOUNT[theme + '§' + sub] || 0;
    var wrap = el('div', 'sub' + (n ? ' click' : ''));
    wrap.setAttribute('data-h', heatBucket(n));

    var lbl = el('button', 'slbl',
      '<span class="n">' + esc(sub) + '</span><span class="b">' + n + '</span>');
    lbl.type = 'button';
    lbl.title = n ? n + ' מדדים קיימים · לחצו לצפייה' : 'טרם פותחו מדדים לתת נושא זה';
    if (n) lbl.addEventListener('click', function () { focusSub(theme, sub, wrap); });
    wrap.appendChild(lbl);

    var vt = el('div', 'vt');
    [[1, 'up', 'תת נושא חשוב בעיניי'], [-1, 'dn', 'תת נושא פחות חשוב בעיניי']].forEach(function (o) {
      var b = el('button', 'v ' + o[1], THUMB);
      b.type = 'button';
      b.dataset.v = o[0];
      b.title = o[2];
      b.setAttribute('aria-label', o[2] + ': ' + sub);
      b.addEventListener('click', function () {
        var cur = voteOf(theme, sub);
        var next = cur === o[0] ? 0 : o[0];   /* לחיצה חוזרת מבטלת */
        setVote(theme, sub, next);
        paintVotes(wrap, next);
        renderVoteSummary();
      });
      vt.appendChild(b);
    });
    wrap.appendChild(vt);
    paintVotes(wrap, voteOf(theme, sub));
    return wrap;
  }

  function paintVotes(wrap, v) {
    wrap.classList.toggle('voted-up', v === 1);
    wrap.classList.toggle('voted-dn', v === -1);
    Array.prototype.forEach.call(wrap.querySelectorAll('.vt .v'), function (b) {
      var on = Number(b.dataset.v) === v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /* מונה הסימונים מעל עץ הנושאים */
  function renderVoteSummary() {
    var box = $('#voteSum');
    if (!box) return;
    var up = 0, dn = 0;
    Object.keys(store.subvotes).forEach(function (k) {
      if (store.subvotes[k].v === 1) up++; else if (store.subvotes[k].v === -1) dn++;
    });
    var total = 0;
    THEMES.forEach(function (t) { total += t.subs.length; });
    box.hidden = !(up || dn);
    box.innerHTML = '<b>' + (up + dn) + '</b> מתוך ' + total + ' תתי נושאים סומנו · ' +
      '<span class="u">' + up + ' חשובים</span> · <span class="d">' + dn + ' פחות</span>';
  }

  function renderTree() {
    var cols = $('#treeCols');
    THEMES.forEach(function (t) {
      var col = el('div', 'tcol');

      col.appendChild(el('div', 'th',
        '<div class="nm">' + esc(t.name) + '</div>' +
        '<div class="ct">' + t.subs.length + ' תתי נושאים</div>'));

      var box = el('div', 'subs');
      t.subs.forEach(function (s) {
        box.appendChild(subNode(t.name, s));
      });
      col.appendChild(box);
      cols.appendChild(col);
    });

    renderVoteSummary();

    var tg = $('#cntToggle'), tree = $('#tree'), lg = $('#heatLegend');
    tg.addEventListener('click', function () {
      var on = tree.classList.toggle('counts');
      tg.classList.toggle('on', on);
      tg.setAttribute('aria-pressed', String(on));
      lg.hidden = !on;
    });
  }

  function focusSub(theme, sub, btn) {
    document.querySelectorAll('.sub.sel').forEach(function (n) { n.classList.remove('sel'); });
    btn.classList.add('sel');
    state.theme = theme;
    state.sub = sub;
    syncChips();
    renderList();
    $('#list').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 02 · משפך המיפוי ---------- */
  var FUNNEL_COLORS = ['#CFE8F6', '#8FCBEA', '#3FA3DC', '#0688CA'];

  function renderFunnel() {
    var W = 920, rowH = 40, gap = 13, top = 46, labelW = 232;
    var H = top + FUNNEL.length * (rowH + gap) + 40;
    var max = FUNNEL[0].value;
    var bandW = (W - labelW) - 24;
    var cx = 24 + bandW / 2;
    var iX = W - labelW + 11;           /* עמודת אייקוני ה-i */

    var s = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="תהליך מיפוי האינדיקטורים" style="direction:ltr" font-family="Heebo,sans-serif">'];

    var yTop = 30;
    s.push('<path d="M24 ' + (yTop + 7) + ' V' + yTop + ' H' + (24 + bandW) + ' V' + (yTop + 7) + '" fill="none" stroke="#8A8886" stroke-width="1.2"/>');
    s.push('<text x="' + cx + '" y="' + (yTop - 7) + '" text-anchor="middle" font-size="13" font-family="Space Grotesk,sans-serif" fill="#454341">100%</text>');

    FUNNEL.forEach(function (f, i) {
      var w = Math.max(56, (f.value / max) * bandW);
      var x = cx - w / 2;
      var y = top + i * (rowH + gap);
      var cy = y + rowH / 2;
      var light = i < 2;
      s.push('<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + w.toFixed(1) + '" height="' + rowH + '" rx="5" fill="' + FUNNEL_COLORS[i] + '"/>');
      s.push('<text x="' + cx + '" y="' + (cy + 6) + '" text-anchor="middle" font-size="17" font-weight="700" font-family="Space Grotesk,sans-serif" fill="' + (light ? '#0B3B54' : '#FFFFFF') + '">' + f.value + '</text>');
      s.push('<line x1="' + (x + w + 8) + '" y1="' + cy + '" x2="' + (iX - 13) + '" y2="' + cy + '" stroke="#E6E6E6" stroke-width="1"/>');
      s.push('<text x="' + (W - 12) + '" y="' + (cy + 5) + '" text-anchor="end" font-size="14" font-weight="700" fill="#1A1A2E">' + esc(f.label) + '</text>');
      s.push('<g class="i-badge" tabindex="0" role="button" data-tip="' + esc(f.label) + ' — ' + esc(f.note) + '" aria-label="' + esc(f.note) + '">' +
        '<circle cx="' + iX + '" cy="' + cy + '" r="8" fill="#FFFFFF" stroke="#9CC9DF" stroke-width="1.2"/>' +
        '<text x="' + iX + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="11" font-weight="700" font-family="Space Grotesk,sans-serif" fill="#0688CA">i</text></g>');
    });

    var lastW = Math.max(56, (FUNNEL[FUNNEL.length - 1].value / max) * bandW);
    var yB = top + FUNNEL.length * (rowH + gap) + 4;
    var pct = (FUNNEL[FUNNEL.length - 1].value / max * 100).toFixed(1) + '%';
    s.push('<path d="M' + (cx - lastW / 2) + ' ' + (yB - 7) + ' V' + yB + ' H' + (cx + lastW / 2) + ' V' + (yB - 7) + '" fill="none" stroke="#8A8886" stroke-width="1.2"/>');
    s.push('<text x="' + cx + '" y="' + (yB + 20) + '" text-anchor="middle" font-size="13" font-family="Space Grotesk,sans-serif" fill="#454341">' + pct + '</text>');
    s.push('</svg>');

    var box = $('#funnel');
    box.innerHTML = s.join('');
    wireTips(box);
  }

  /* טולטיפ קל לכל אלמנט עם data-tip */
  function wireTips(box) {
    var tip = el('div', 'tip');
    tip.hidden = true;
    box.appendChild(tip);
    var show = function (t) {
      tip.textContent = t.getAttribute('data-tip');
      tip.hidden = false;
      var cb = box.getBoundingClientRect(), tb = t.getBoundingClientRect();
      tip.style.top = (tb.bottom - cb.top + 9) + 'px';
      var right = cb.right - tb.right - 12;
      tip.style.right = Math.max(4, Math.min(right, cb.width - 60)) + 'px';
    };
    var hide = function () { tip.hidden = true; };
    ['mouseover', 'focusin'].forEach(function (ev) {
      box.addEventListener(ev, function (e) {
        var t = e.target.closest ? e.target.closest('[data-tip]') : null;
        if (t) show(t);
      });
    });
    ['mouseout', 'focusout'].forEach(function (ev) {
      box.addEventListener(ev, function (e) {
        var t = e.target.closest ? e.target.closest('[data-tip]') : null;
        if (t) hide();
      });
    });
  }

  /* ---------- 03 · מקורות נתונים ---------- */
  function renderSources() {
    var m = {};
    CORE.forEach(function (d) { m[d.source] = (m[d.source] || 0) + 1; });
    var rows = Object.keys(m).map(function (k) { return { k: k, v: m[k] }; })
      .sort(function (a, b) { return b.v - a.v; });
    var max = rows[0].v;
    var w = $('#srcBars');
    w.innerHTML = '';
    rows.forEach(function (r) {
      var row = el('div', 'bar',
        '<div class="lb">' + esc(r.k) + '</div>' +
        '<div class="tr"><div class="fl" style="width:0"></div><div class="vl">' + r.v + '</div></div>');
      w.appendChild(row);
      requestAnimationFrame(function () { $('.fl', row).style.width = (r.v / max * 100) + '%'; });
    });
  }

  /* ---------- 04 · מסננים ---------- */
  function themesWithData() {
    var order = THEMES.map(function (t) { return t.name; });
    var extra = [];
    CORE.forEach(function (d) {
      if (order.indexOf(d.theme) < 0 && extra.indexOf(d.theme) < 0) extra.push(d.theme);
    });
    return order.filter(function (t) {
      return CORE.some(function (d) { return d.theme === t; });
    }).concat(extra);
  }

  function subsFor(theme) {
    var out = [];
    var pool = CORE.filter(function (d) { return !theme || d.theme === theme; });
    var order = [];
    THEMES.forEach(function (t) { order = order.concat(t.subs); });
    pool.forEach(function (d) { if (out.indexOf(d.sub) < 0) out.push(d.sub); });
    return out.sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  }

  function opt(v, label) {
    var o = document.createElement('option');
    o.value = v; o.textContent = label;
    return o;
  }

  function renderThemeSel() {
    var ts = $('#themeSel');
    ts.innerHTML = '';
    ts.appendChild(opt('', 'כל הנושאים (' + CORE.length + ')'));
    themesWithData().forEach(function (t) {
      var n = CORE.filter(function (d) { return d.theme === t; }).length;
      ts.appendChild(opt(t, t + ' (' + n + ')'));
    });
    ts.value = state.theme || '';
    renderSubSel();
  }

  function renderSubSel() {
    var ss = $('#subSel');
    var subs = subsFor(state.theme);
    ss.innerHTML = '';
    ss.appendChild(opt('', state.theme ? 'כל תתי הנושאים בנושא' : 'כל תתי הנושאים'));
    subs.forEach(function (sn) {
      var n = CORE.filter(function (d) { return d.sub === sn && (!state.theme || d.theme === state.theme); }).length;
      ss.appendChild(opt(sn, sn + ' (' + n + ')'));
    });
    if (state.sub && subs.indexOf(state.sub) < 0) state.sub = null;
    ss.value = state.sub || '';
  }

  function syncChips() {
    $('#themeSel').value = state.theme || '';
    renderSubSel();
    $('#dataToggle').classList.toggle('on', state.dataOnly);
    $('#rateToggle').classList.toggle('on', state.unratedOnly);
  }

  function filtered() {
    var q = state.q.trim();
    return CORE.filter(function (d) {
      if (state.theme && d.theme !== state.theme) return false;
      if (state.sub && d.sub !== state.sub) return false;
      if (state.dataOnly && !seriesOf(d).length) return false;
      if (state.unratedOnly && ratingOf(d.id)) return false;
      if (q && (d.name + ' ' + d.sub + ' ' + d.theme + ' ' + d.source + ' ' + d.desc).indexOf(q) < 0) return false;
      return true;
    });
  }

  /* ---------- 05 · תצוגת כרטיסים ---------- */
  function sparkline(d) {
    var s = seriesOf(d);
    if (s.length < 3) return '';
    var vals = s.map(function (p) { return p[1]; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var rng = (mx - mn) || 1, W = 78, H = 26, pad = 3;
    var pts = s.map(function (p, i) {
      var x = (i / (s.length - 1)) * (W - 2 * pad) + pad;
      var y = H - pad - ((p[1] - mn) / rng) * (H - 2 * pad);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var lastXY = pts.split(' ').pop().split(',');
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" style="direction:ltr" aria-hidden="true">' +
      '<polyline points="' + pts + '" fill="none" stroke="#0E9ADC" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + lastXY[0] + '" cy="' + lastXY[1] + '" r="2.4" fill="#0E9ADC"/></svg>';
  }

  function deltaHtml(d) {
    var dl = deltaOf(d);
    if (!dl) return '';
    var cls = dl.dir === 'fl' ? 'fl' : (dl.good === null ? 'fl' : (dl.good ? 'up' : 'dn'));
    var arrow = dl.dir === 'up' ? '▲' : dl.dir === 'dn' ? '▼' : '■';
    return '<span class="delta ' + cls + '" title="שינוי מול ' + ymLabel(dl.base[0]) + '">' +
      (dl.pct > 0 ? '+' : '') + dl.pct.toFixed(1) + '% ' + arrow + '</span>';
  }

  /* תצוגה מקדימה בהובר — כל הכוכבים עד לזה שמעליו העכבר נדלקים */
  function clearStarHover(box) {
    var boxes = box ? [box] : document.querySelectorAll('.stars.hov');
    Array.prototype.forEach.call(boxes, function (b) {
      b.classList.remove('hov');
      Array.prototype.forEach.call(b.children, function (x) { x.classList.remove('hv'); });
    });
  }

  function bindStarHover() {
    document.addEventListener('mouseover', function (e) {
      var t = e.target, b = t && t.closest ? t.closest('.stars button') : null;
      if (!b) {
        if (!(t && t.closest && t.closest('.stars'))) clearStarHover();
        return;
      }
      var box = b.parentNode;
      if (box.classList.contains('sm')) return;      /* תצוגה בלבד, ללא אינטראקציה */
      var n = parseInt(b.dataset.s, 10);
      box.classList.add('hov');
      Array.prototype.forEach.call(box.children, function (x, i) {
        x.classList.toggle('hv', i < n);
      });
    });
    document.addEventListener('mouseout', function (e) {
      var box = e.target && e.target.closest ? e.target.closest('.stars') : null;
      if (box && !box.contains(e.relatedTarget)) clearStarHover(box);
    });
  }

  function starsHtml(n, cls) {
    var o = ['<span class="stars ' + (cls || '') + '">'];
    for (var i = 1; i <= 5; i++) {
      o.push('<button type="button" tabindex="-1" class="' + (i <= n ? 'on' : '') + '" data-s="' + i + '" aria-label="' + i + ' כוכבים">★</button>');
    }
    o.push('</span>');
    return o.join('');
  }

  function card(d) {
    var p = lastPt(d);
    var r = ratingOf(d.id);
    var b = el('button', 'mcard');
    b.type = 'button';

    var head = '<div class="top"><span class="tag">' + esc(d.sub) + '</span></div>' +
      '<div class="nm">' + esc(d.short || d.name) + '</div>';

    var body;
    if (p) {
      body = '<div class="row">' +
        '<div><div class="val">' + fmtVal(d, p[1]) +
        (unitCaption(d) ? '<small>' + esc(unitCaption(d)) + '</small>' : '') + '</div>' +
        '<div class="asof">' + esc(state.scope) + ' · נכון ל-<span class="num">' + ymLabel(p[0]) + '</span></div></div>' +
        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">' +
        sparkline(d) + deltaHtml(d) + '</div></div>';
    } else {
      body = '<div class="nodata">' +
        (hasScope(d, NATIONAL) ? 'אין נתונים ברמת ' + esc(state.scope) : 'אין סדרת נתונים בקובץ הנוכחי') +
        '</div>';
    }

    var foot = '<div class="ft"><span>' + esc(d.source) + '</span>' +
      (r ? '<span class="rated">' + starsHtml(r.stars, 'sm') + '</span>'
         : '<span>' + esc(d.freq) + '</span>') + '</div>';

    b.innerHTML = head + body + foot;
    b.addEventListener('click', function () { openModal(d); });
    return b;
  }

  /* ---------- 05ב · תצוגת טבלה (טבלה אחת לכל המדדים) ---------- */
  function renderTable(list, items) {
    var themeOrder = THEMES.map(function (t) { return t.name; });
    var ordered = items.slice().sort(function (a, b) {
      var ia = themeOrder.indexOf(a.theme), ib = themeOrder.indexOf(b.theme);
      ia = ia < 0 ? 99 : ia; ib = ib < 0 ? 99 : ib;
      if (ia !== ib) return ia - ib;
      if (a.sub !== b.sub) return a.sub < b.sub ? -1 : 1;
      return a.order - b.order;
    });

    var head = ['שם המדד', 'נושא / תת נושא', 'ערך (' + state.scope + ')', 'נכון ל-',
      'שינוי שנתי', 'מקור נתונים', 'תדירות', 'הדירוג שלי'];
    var h = ['<div class="tblwrap"><table class="tbl"><thead><tr>'];
    head.forEach(function (t) { h.push('<th>' + esc(t) + '</th>'); });
    h.push('</tr></thead><tbody>');

    ordered.forEach(function (d) {
      var p = lastPt(d), r = ratingOf(d.id);
      h.push('<tr data-id="' + d.id + '">');
      h.push('<td class="tnm">' + esc(d.short || d.name) + '</td>');
      h.push('<td>' + esc(d.theme) + '<span class="tsub">' + esc(d.sub) + '</span></td>');
      h.push('<td class="tv">' + (p ? fmtVal(d, p[1]) : '<span class="mut">—</span>') + '</td>');
      h.push('<td class="mut num">' + (p ? ymLabel(p[0]) : '') + '</td>');
      h.push('<td>' + (deltaHtml(d) || '<span class="mut">—</span>') + '</td>');
      h.push('<td class="mut">' + esc(d.source) + '</td>');
      h.push('<td class="mut">' + esc(d.freq) + '</td>');
      h.push('<td>' + starsHtml(r ? r.stars : 0, 'tb') + '</td>');
      h.push('</tr>');
    });
    h.push('</tbody></table></div>');

    var wrap = el('div', null, h.join(''));
    list.appendChild(wrap);
    wrap.addEventListener('click', function (e) {
      /* דירוג ישירות מהטבלה */
      var sb = e.target.closest('.stars.tb button');
      if (sb) {
        e.stopPropagation();
        var trs = sb.closest('tr[data-id]');
        var id = trs.dataset.id;
        var n = parseInt(sb.dataset.s, 10);
        if (n === ((ratingOf(id) || {}).stars || 0)) n = 0;   /* לחיצה חוזרת מבטלת */
        setRating(id, { stars: n });
        paintStars(sb.parentNode, n);
        var rn = $('#ratedN');
        if (rn) rn.textContent = CORE.filter(function (x) { return ratingOf(x.id); }).length;
        return;
      }
      var tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      var d = CORE.filter(function (x) { return x.id == tr.dataset.id; })[0];
      if (d) openModal(d);
    });
  }

  /* ---------- רינדור הרשימה ---------- */
  function renderList() {
    var list = $('#list');
    list.innerHTML = '';
    var items = filtered();
    var rated = CORE.filter(function (d) { return ratingOf(d.id); }).length;
    $('#cntLabel').innerHTML = items.length + ' מדדים מוצגים מתוך ' + CORE.length +
      ' · דורגו על ידכם <span class="num" id="ratedN">' + rated + '</span>';

    if (state.sub) {
      var bar = el('div', 'filters', '');
      var c = el('button', 'chip on', 'תת נושא: ' + esc(state.sub) + ' ✕');
      c.type = 'button';
      c.addEventListener('click', function () {
        state.sub = null; state.theme = null;
        document.querySelectorAll('.sub.sel').forEach(function (n) { n.classList.remove('sel'); });
        syncChips(); renderList();
      });
      bar.appendChild(c);
      list.appendChild(bar);
    }

    if (!items.length) {
      list.appendChild(el('div', 'empty', 'לא נמצאו מדדים התואמים לסינון הנוכחי.'));
      return;
    }

    if (state.view === 'table') { renderTable(list, items); return; }

    var themeOrder = THEMES.map(function (t) { return t.name; });
    var groups = {};
    items.forEach(function (d) { (groups[d.theme] = groups[d.theme] || []).push(d); });
    var names = Object.keys(groups).sort(function (a, b) {
      var ia = themeOrder.indexOf(a), ib = themeOrder.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    names.forEach(function (tn) {
      var g = el('div', 'grp');
      var isFramework = themeOrder.indexOf(tn) >= 0;
      g.appendChild(el('h3', null,
        esc(tn) + '<span class="n">' + groups[tn].length + ' מדדים</span>' +
        (isFramework ? '' : '<span class="n">· נתוני רקע, מחוץ למפת הנושאים</span>')));

      var bySub = {};
      groups[tn].forEach(function (d) { (bySub[d.sub] = bySub[d.sub] || []).push(d); });
      var subOrder = isFramework ? (THEMES.filter(function (t) { return t.name === tn; })[0].subs) : Object.keys(bySub);
      var subs = Object.keys(bySub).sort(function (a, b) {
        var ia = subOrder.indexOf(a), ib = subOrder.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });

      subs.forEach(function (sn) {
        if (subs.length > 1 || state.sub == null) g.appendChild(el('div', 'subhead', esc(sn)));
        var cw = el('div', 'cards');
        bySub[sn].sort(function (a, b) { return a.order - b.order; })
          .forEach(function (d) { cw.appendChild(card(d)); });
        g.appendChild(cw);
      });
      list.appendChild(g);
    });
  }

  /* ---------- גרף מגמה ---------- */
  /* גיאומטריית הגרף שמוצג כרגע — משמשת את הטולטיפ (מודאל אחד בכל רגע) */
  var chartGeo = null;

  function trendChart(d) {
    var s = seriesOf(d);
    var ref = state.scope !== NATIONAL ? seriesOf(d, NATIONAL) : [];
    chartGeo = null;
    if (!s.length) {
      return '<div class="empty">' +
        (hasScope(d, NATIONAL) ? 'אין נתונים עבור ' + esc(state.scope) + ' במדד זה.' : 'אין סדרת נתונים עבור מדד זה בקובץ הנוכחי.') +
        '</div>';
    }

    var W = 660, H = 258, L = 52, R = 18, T = 18, B = 34;
    var iw = W - L - R, ih = H - T - B;
    var all = s.map(function (p) { return p[1]; }).concat(ref.map(function (p) { return p[1]; }));
    var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all);
    if (mn === mx) { mn -= 1; mx += 1; }
    var span = mx - mn;
    var nonNeg = mn >= 0;
    var sc = niceScale(mn - span * 0.06, mx + span * 0.1, 4);
    if (nonNeg && sc.lo < 0) sc.lo = 0;
    mn = sc.lo; mx = sc.hi;

    var X = function (i, n) { return n === 1 ? L + iw / 2 : L + (i / (n - 1)) * iw; };
    var Y = function (v) { return T + ih - ((v - mn) / (mx - mn)) * ih; };

    var o = ['<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" style="direction:ltr" font-family="Heebo,sans-serif" role="img" aria-label="גרף מגמה">'];

    for (var v = sc.lo; v <= sc.hi + 1e-9; v += sc.step) {
      var y = Y(v);
      o.push('<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) + '" stroke="#E6E6E6" stroke-width="1"/>');
      o.push('<text x="' + (L - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11" font-family="Space Grotesk,sans-serif" fill="#8A8886">' + fmtVal(d, v) + '</text>');
    }

    xLabels(s).forEach(function (t) {
      o.push('<text x="' + X(t.i, s.length).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="11" font-family="Space Grotesk,sans-serif" fill="#8A8886">' + t.t + '</text>');
    });

    var refShown = ref.length > 1 && ref.length === s.length;
    if (refShown) {
      o.push('<polyline points="' + ref.map(function (p, i) { return X(i, ref.length).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join(' ') +
        '" fill="none" stroke="#9AB6C4" stroke-width="1.6" stroke-dasharray="4 3" stroke-linejoin="round"/>');
    }

    if (s.length > 1) {
      o.push('<polyline points="' + s.map(function (p, i) { return X(i, s.length).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join(' ') +
        '" fill="none" stroke="#0E9ADC" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
    }
    (s.length === 1 ? [0] : [0, s.length - 1]).forEach(function (i) {
      var p = s[i], x = X(i, s.length), y = Y(p[1]);
      o.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.6" fill="#0E9ADC"/>');
      o.push('<text x="' + (i === 0 ? x + 8 : x - 8).toFixed(1) + '" y="' + (y - 9).toFixed(1) + '" text-anchor="' + (i === 0 ? 'start' : 'end') +
        '" font-size="12" font-weight="700" font-family="Space Grotesk,sans-serif" fill="#1A1A2E">' + fmtVal(d, p[1]) + '</text>');
    });
    /* שכבת ריחוף: קו מנחה ונקודות מסומנות (מצוירות מעל הקווים) */
    o.push('<g class="cx-hover" style="display:none" aria-hidden="true">' +
      '<line class="cx-guide" x1="0" x2="0" y1="' + T + '" y2="' + (T + ih) + '" stroke="#B9CBD5" stroke-width="1" stroke-dasharray="3 3"/>' +
      '<circle class="cx-ref" r="4" fill="#FFFFFF" stroke="#9AB6C4" stroke-width="2" style="display:none"/>' +
      '<circle class="cx-dot" r="4.5" fill="#FFFFFF" stroke="#0E9ADC" stroke-width="2.5"/></g>');
    o.push('<rect class="cx-hit" x="' + L + '" y="' + T + '" width="' + iw + '" height="' + ih + '" fill="transparent" style="cursor:crosshair"/>');
    o.push('</svg>');

    var refMap = {};
    ref.forEach(function (p) { refMap[p[0]] = p[1]; });
    chartGeo = {
      d: d, s: s, scope: state.scope, refMap: refShown ? refMap : null,
      W: W, L: L, T: T, iw: iw, ih: ih, X: X, Y: Y
    };

    var legend = '<div class="chart-lg">' +
      '<span><i style="background:#0E9ADC"></i>' + esc(state.scope) + '</span>' +
      (refShown ? '<span><i class="dash"></i>' + esc(NATIONAL) + '</span>' : '') +
      '</div>';
    return '<div class="chart-wrap">' + o.join('') +
      '<div class="chart-tip" hidden></div></div>' + legend;
  }

  /* טולטיפ עקיבה על גרף המגמה: תאריך וערך בכל נקודת זמן */
  function wireChart(m) {
    var g = chartGeo, wrap = $('.chart-wrap', m);
    if (!g || !wrap) return;
    var svg = $('.chart', wrap), tip = $('.chart-tip', wrap);
    var hov = $('.cx-hover', svg), guide = $('.cx-guide', svg),
        dot = $('.cx-dot', svg), rdot = $('.cx-ref', svg);
    var n = g.s.length;

    function hide() { hov.style.display = 'none'; tip.hidden = true; }

    function show(clientX) {
      var rb = svg.getBoundingClientRect(), wb = wrap.getBoundingClientRect();
      var k = rb.width / g.W;                    /* פיקסלים על המסך ליחידת viewBox */
      if (!k) return;
      var i = n === 1 ? 0
        : Math.round((((clientX - rb.left) / k - g.L) / g.iw) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));

      var p = g.s[i], x = g.X(i, n), y = g.Y(p[1]);
      guide.setAttribute('x1', x.toFixed(1));
      guide.setAttribute('x2', x.toFixed(1));
      dot.setAttribute('cx', x.toFixed(1));
      dot.setAttribute('cy', y.toFixed(1));

      var rv = g.refMap ? g.refMap[p[0]] : null;
      if (rv != null) {
        rdot.setAttribute('cx', x.toFixed(1));
        rdot.setAttribute('cy', g.Y(rv).toFixed(1));
        rdot.style.display = '';
      } else {
        rdot.style.display = 'none';
      }
      hov.style.display = '';

      tip.innerHTML = '<div class="ct-d">' + ymLabel(p[0]) + '</div>' +
        '<div class="ct-r"><i></i><span>' + esc(g.scope) + '</span>' +
        '<b>' + fmtVal(g.d, p[1]) + '</b></div>' +
        (rv != null ? '<div class="ct-r"><i class="dash"></i><span>' + esc(NATIONAL) + '</span>' +
          '<b>' + fmtVal(g.d, rv) + '</b></div>' : '');
      tip.hidden = false;

      var tw = tip.offsetWidth, ox = rb.left - wb.left;
      tip.style.left = Math.max(tw / 2, Math.min(ox + x * k, wb.width - tw / 2)).toFixed(1) + 'px';
      tip.style.top = ((rb.top - wb.top) + y * k - 13).toFixed(1) + 'px';
    }

    ['pointermove', 'pointerdown'].forEach(function (ev) {
      svg.addEventListener(ev, function (e) { show(e.clientX); });
    });
    svg.addEventListener('pointerleave', hide);
  }

  /* סקאלה עם ערכי ציר "עגולים" */
  function niceScale(min, max, ticks) {
    var raw = (max - min) / ticks || 1;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step: step };
  }

  /* תוויות שנה על ציר הזמן, בלי חפיפות */
  function xLabels(s) {
    if (s.length <= 6) return s.map(function (p, i) { return { i: i, t: ymLabel(p[0]) }; });
    var out = [], seen = {};
    s.forEach(function (p, i) {
      var yy = p[0].slice(0, 4);
      if (p[0].slice(5) === '01' && !seen[yy]) { seen[yy] = 1; out.push({ i: i, t: yy }); }
    });
    var firstYy = s[0][0].slice(0, 4);
    if (!seen[firstYy] && (!out.length || out[0].i > s.length * 0.08)) out.unshift({ i: 0, t: firstYy });
    return out.length ? out : [{ i: 0, t: s[0][0].slice(0, 4) }];
  }

  /* ---------- מודאל מדד ---------- */
  function row(k, v) {
    if (!v) return '';
    return '<div class="r"><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>';
  }

  function openModal(d) {
    var p = lastPt(d), dl = deltaOf(d), ser = seriesOf(d);
    var dirTxt = d.positive === 1 ? 'ערך גבוה = טוב יותר' : d.positive === 0 ? 'ערך נמוך = טוב יותר' : 'ללא כיוון מוגדר';
    var r = ratingOf(d.id) || { stars: 0, note: '' };

    var h = '<div class="mh"><div>' +
      '<div class="bc">' + esc(d.theme) + ' · ' + esc(d.sub) + '</div>' +
      '<h3 id="mTitle">' + esc(d.name) + '</h3></div>' +
      '<button class="x" type="button" aria-label="סגירה">✕</button></div><div class="mb">';

    /* 1 · הגדרת המדד */
    h += '<section class="msec"><h4>הגדרת המדד</h4>';
    if (d.desc) h += '<p class="defn">' + esc(d.desc) + '</p>';
    if (d.nom || d.den) {
      h += '<p class="defn">' +
        (d.nom ? '<b>מונה:</b> ' + esc(d.nom) : '') +
        (d.nom && d.den ? '<br>' : '') +
        (d.den ? '<b>מכנה:</b> ' + esc(d.den) : '') + '</p>';
    }
    h += '<dl class="dl">' +
      row('נושא', d.theme) +
      row('תת נושא', d.sub) +
      row('ישות נמדדת', d.identity) +
      row('יחידת מידה', d.unit) +
      row('כיווניות רצויה', dirTxt) +
      row('מקור נתונים', d.source) +
      row('תדירות עדכון', d.freq) +
      row('מזהה מדד', d.id) +
      '</dl></section>';

    /* 2 · הערך והמגמה */
    h += '<section class="msec"><h4>הערך והמגמה</h4><div class="mstat">';
    if (p) {
      h += '<div><div class="big">' + fmtVal(d, p[1]) + '</div>' +
        '<div class="cap">' + esc(state.scope) + ' · נכון ל-<span class="num">' + ymLabel(p[0]) + '</span>' +
        (unitCaption(d) ? ' · ' + esc(unitCaption(d)) : '') + '</div></div>';
      if (dl) {
        var cls = dl.dir === 'fl' ? 'fl' : (dl.good === null ? 'fl' : (dl.good ? 'up' : 'dn'));
        h += '<div><span class="delta ' + cls + '">' + (dl.pct > 0 ? '+' : '') + dl.pct.toFixed(1) + '%</span>' +
          '<div class="cap">מול <span class="num">' + ymLabel(dl.base[0]) + '</span> (' + fmtVal(d, dl.base[1]) + ')</div></div>';
      }
      h += '<div><div class="cap">' + ser.length + ' נקודות מדידה · ' +
        '<span class="num">' + ymLabel(ser[0][0]) + '</span>–<span class="num">' + ymLabel(p[0]) + '</span></div></div>';
    } else {
      h += '<div class="cap">אין ערך להצגה ברמת ' + esc(state.scope) + '.</div>';
    }
    h += '</div>' + trendChart(d) + '</section>';

    /* 3 · הערכה */
    h += '<section class="msec rate"><h4>הערכה של המדד</h4>' +
      '<div class="rate-sub">עד כמה המדד רלוונטי ושימושי לניהול העבודה בנפה? הדירוג נשמר בדפדפן ומיוצא בסוף הסדנה.</div>' +
      '<div class="row"><span class="lbl">דירוג:</span>' + starsHtml(r.stars) +
      '<button class="clr" type="button" id="rClear">ניקוי</button></div>' +
      '<textarea id="rNote" placeholder="הערות, הסתייגויות, שימוש אפשרי במדד…">' + esc(r.note) + '</textarea>' +
      '<div class="saved" id="rSaved"></div></section>';

    h += '</div>';

    var m = $('#modal');
    m.innerHTML = h;
    m.scrollTop = 0;
    $('.x', m).addEventListener('click', closeModal);
    wireChart(m);
    wireRating(m, d);
    $('#ovl').classList.add('on');
    document.body.style.overflow = 'hidden';
  }

  function wireRating(m, d) {
    var box = $('.rate .stars', m), note = $('#rNote', m), saved = $('#rSaved', m);
    var flash = function (t) { saved.textContent = t || 'נשמר ✓'; setTimeout(function () { saved.textContent = ''; }, 1800); };

    box.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var n = parseInt(b.dataset.s, 10);
      var cur = (ratingOf(d.id) || {}).stars || 0;
      if (n === cur) n = 0;                       /* לחיצה חוזרת מבטלת */
      setRating(d.id, { stars: n });
      paintStars(box, n);
      flash(n ? 'נשמר ✓' : 'הדירוג נוקה');
      renderList();
    });

    $('#rClear', m).addEventListener('click', function () {
      setRating(d.id, { stars: 0, note: '' });
      paintStars(box, 0);
      note.value = '';
      flash('ההערכה נוקתה');
      renderList();
    });

    var t = null;
    note.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        setRating(d.id, { note: note.value });
        flash();
        renderList();
      }, 500);
    });
  }

  function paintStars(box, n) {
    Array.prototype.forEach.call(box.children, function (b, i) {
      b.classList.toggle('on', i < n);
    });
  }

  function closeModal() {
    $('#ovl').classList.remove('on');
    document.body.style.overflow = '';
  }

  /* ---------- משתמש, רמת תצוגה, ייצוא ---------- */
  function districts() { return SCOPES.filter(function (s) { return s !== NATIONAL; }); }

  function renderScopeSel() {
    var sel = $('#scopeSel');
    sel.innerHTML = '';
    SCOPES.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s;
      o.textContent = s === NATIONAL ? 'ארצי (כל הנפות)' : 'נפת ' + s;
      sel.appendChild(o);
    });
    sel.value = state.scope;
    sel.addEventListener('change', function () {
      state.scope = sel.value;
      renderList();
    });
  }

  function renderUserBar() {
    var w = $('#navUser');
    if (!store.user) { w.innerHTML = ''; return; }
    w.innerHTML = '<span class="nm">' + esc(store.user.name) + '</span>' +
      (store.user.district ? '<span class="dv">· נפת ' + esc(store.user.district) + '</span>' : '') +
      '<button type="button" id="switchUser">החלפת משתמש</button>';
    $('#switchUser').addEventListener('click', function () { openGate(true); });
  }

  function openGate(isSwitch) {
    var sel = $('#gDistrict');
    sel.innerHTML = '<option value="">— ללא שיוך —</option>';
    districts().forEach(function (s) {
      var o = document.createElement('option');
      o.value = s; o.textContent = 'נפת ' + s;
      sel.appendChild(o);
    });
    if (store.user) {
      $('#gName').value = store.user.name || '';
      sel.value = store.user.district || '';
    }
    $('#gate').classList.add('on');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { $('#gName').focus(); }, 60);
    $('#gateForm').dataset.sw = isSwitch ? '1' : '';
  }

  function submitGate(e) {
    e.preventDefault();
    var name = $('#gName').value.trim();
    if (!name) return;
    var dist = $('#gDistrict').value;
    store.user = { name: name, district: dist, since: (store.user && store.user.since) || new Date().toISOString() };
    saveStore();
    $('#gate').classList.remove('on');
    document.body.style.overflow = '';
    if (dist) { state.scope = dist; $('#scopeSel').value = dist; }
    renderUserBar(); renderList();
  }

  function exportCsv() {
    var ids = Object.keys(store.ratings);
    var keys = Object.keys(store.subvotes);
    if (!ids.length && !keys.length) {
      alert('טרם נשמרו הערכות. דרגו מדדים או סמנו תתי נושאים, ולאחר מכן ייצאו את הקובץ.');
      return;
    }
    var byId = {};
    INDICATORS.forEach(function (d) { byId[d.id] = d; });
    var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var uName = (store.user && store.user.name) || '';
    var uDist = (store.user && store.user.district) || '';

    var rows = [['סוג רשומה', 'שם המשתמש', 'נפה', 'נושא', 'תת נושא',
      'מזהה מדד', 'שם המדד', 'דירוג (1-5)', 'סימון תת נושא (1 חשוב / -1 פחות)',
      'הערה', 'עודכן'].map(q).join(',')];

    /* דירוגי מדדים */
    ids.sort(function (a, b) { return a - b; }).forEach(function (id) {
      var d = byId[id] || {}, r = store.ratings[id];
      rows.push(['מדד', uName, uDist, d.theme || '', d.sub || '',
        id, d.name || '', r.stars || '', '', r.note || '', r.ts || ''].map(q).join(','));
    });

    /* סימוני תתי נושאים — בסדר מפת הנושאים */
    THEMES.forEach(function (t) {
      t.subs.forEach(function (sub) {
        var v = store.subvotes[subKey(t.name, sub)];
        if (!v) return;
        rows.push(['תת נושא', uName, uDist, t.name, sub,
          '', '', '', v.v, '', v.ts || ''].map(q).join(','));
      });
    });

    var blob = new Blob(['\ufeff' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'הערכות מדדים ותתי נושאים - ' + (uName || 'משתמש') + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- אתחול ---------- */
  function init() {
    if (store.user && store.user.district && SCOPES.indexOf(store.user.district) >= 0) {
      state.scope = store.user.district;
    }

    renderScopeSel();
    renderUserBar();
    renderTree();
    renderFunnel();
    renderSources();
    renderThemeSel();
    renderList();

    var qt = null;
    $('#q').addEventListener('input', function (e) {
      var v = e.target.value;
      clearTimeout(qt);
      qt = setTimeout(function () { state.q = v; renderList(); }, 120);
    });

    $('#themeSel').addEventListener('change', function () {
      state.theme = this.value || null;
      state.sub = null;
      document.querySelectorAll('.sub.sel').forEach(function (n) { n.classList.remove('sel'); });
      renderSubSel(); renderList();
    });
    $('#subSel').addEventListener('change', function () {
      state.sub = this.value || null;
      renderList();
    });

    $('#dataToggle').addEventListener('click', function () {
      state.dataOnly = !state.dataOnly;
      syncChips(); renderList();
    });
    $('#rateToggle').addEventListener('click', function () {
      state.unratedOnly = !state.unratedOnly;
      syncChips(); renderList();
    });

    $('#viewSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      state.view = b.dataset.v;
      Array.prototype.forEach.call(this.children, function (n) { n.classList.toggle('on', n === b); });
      renderList();
    });

    bindStarHover();

    $('#exportBtn').addEventListener('click', exportCsv);
    $('#gateForm').addEventListener('submit', submitGate);

    $('#ovl').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

    if (!store.user) openGate(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
