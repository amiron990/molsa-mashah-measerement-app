/* ============================================================
   מצפן רשויות מקומיות — ממשק הניהול

   ארבעה מסכים בדף אחד, מאחורי כניסה אחת:
     ראשי          — מדדי-על ושני גרפים
     מדדים         — «אינדיקטורים», «הערות ודיון», «יומן שינויים»
     פוטנציאל מדדים — «מדדים פוטנציאליים», «הערות מדדים פוטנציאליים»
     משימות        — «משימות»
   כל הלשוניות מוקמות ב-tools/apps-script/Manage.gs. הכתובת היא אותה נקודת
   קליטה של הסדנה — נקראת מ-collect.js כדי שלא יהיה לה עותק שני.

   כל בקשה נושאת את סיסמת הניהול ואת שם המבצע. השרת דוחה בקשה בלי סיסמה
   נכונה, ולכן גם הקריאה אינה חשופה למי שסתם הגיע לכתובת.
   ============================================================ */
(function (w, d) {
  'use strict';

  var STORE = 'kyd_molsa_admin_v1';

  /* data.js מגדיר את הנתונים ב-const. קבוע ברמה העליונה אינו נעשה תכונה של
     window, ולכן מגיעים אליו בשם ולא דרך w — בדיוק כמו ב-concept.js. */
  var DATA_IND = (typeof INDICATORS !== 'undefined') ? INDICATORS : [];
  var DATA_THEMES = (typeof THEMES !== 'undefined') ? THEMES : [];

  var S = {
    who: '', pass: '',
    ind: [], cmt: [], chg: [], lists: {}, score: {},
    pot: [], pcmt: [], tsk: [],
    screen: 'home', view: 'ind', pview: 'pot',
    sel: null,       /* { kind, id } של הפריט הפתוח בחלונית; id ריק = חדש */
    openOnly: false, noRefOnly: false, popenOnly: false, lateOnly: false,
    reply: null      /* מזהה ההערה שתיבת התגובה פתוחה עליה */
  };

  /* ---------- הגדרת השדות ----------
     h = הכותרת בגיליון. שדות שאינם ברשימה נשארים בגיליון ואינם נשלחים
     בשמירה — כלומר הערך הקיים שלהם נשמר כפי שהוא.
     combo עם also — ההצעות נאספות גם מעמודה אחרת בלשונית המדדים. */
  var IND_FIELDS = [
    { h: 'מזהה', t: 'text', lock: 1 },
    { h: 'שם המדד', t: 'text', wide: 1 },
    { h: 'שם מקוצר', t: 'text', wide: 1 },
    { h: 'נושא', t: 'list', src: 'themes' },
    { h: 'תת נושא', t: 'list', src: 'subs' },
    { h: 'הסבר על המדד', t: 'area', wide: 1 },
    { h: 'ישות מדידה', t: 'combo' },
    { h: 'יחידת מידה', t: 'combo' },
    { h: 'מקור המידע', t: 'combo' },
    { h: 'תדירות', t: 'combo' },
    { h: 'כיוון רצוי', t: 'sel', opts: [['1', 'ערך גבוה = טוב'], ['0', 'ערך נמוך = טוב']] },
    { h: 'סטטוס', t: 'list', src: 'סטטוס' },
    { h: 'אחראי', t: 'text' },
    { h: 'במפה', t: 'toggle', on: 'מוצג במפת המדידה', off: 'אינו מוצג במפה' }
  ];

  var POT_FIELDS = [
    { h: 'מזהה זמני', t: 'text', lock: 1, ph: 'ריק = POT-### הפנוי הבא' },
    { h: 'שם מדד', t: 'text', wide: 1 },
    { h: 'הסבר על שיטת המדידה', t: 'area', wide: 1 },
    { h: 'נושא', t: 'list', src: 'themes' },
    { h: 'תת נושא', t: 'list', src: 'subs' },
    { h: 'סטטוס', t: 'list', src: 'סטטוס פוטנציאל', wide: 1 },
    { sep: 'פרמטרים אנליטיים' },
    { h: 'אופן חישוב', t: 'area', wide: 1 },
    { h: 'מקור הנתונים', t: 'combo', also: 'מקור המידע' },
    { h: 'יחידת מידה', t: 'combo', also: 'יחידת מידה' },
    { h: 'כיוון רצוי', t: 'sel', opts: [['1', 'ערך גבוה = טוב'], ['0', 'ערך נמוך = טוב']] }
  ];

  var TSK_FIELDS = [
    { h: 'מזהה משימה', t: 'text', lock: 1, ph: 'ריק = TSK-### הפנוי הבא' },
    { h: 'כותרת המשימה', t: 'text', wide: 1 },
    { h: 'פירוט המשימה', t: 'area', wide: 1 },
    { h: 'גורם לביצוע', t: 'combo' },
    { h: 'סטטוס', t: 'list', src: 'סטטוס משימה' },
    { h: 'תאריך פתיחה', t: 'date' },
    { h: 'תאריך לביצוע', t: 'date' },
    { h: 'הערות ביצוע', t: 'area', wide: 1 }
  ];

  /* ברירות המחדל של הרשימות, אם השרת עוד לא פורסם מחדש ואינו מחזיר אותן */
  var DEF_LISTS = {
    'סטטוס': ['פעיל', 'בבחינה', 'בתהליך פיתוח', 'יורד'],
    'סטטוס טיפול': ['פתוח', 'בבדיקה', 'טופל', 'נדחה'],
    'סטטוס פוטנציאל': ['בחינה ראשונית', 'בבדיקה מול יחידת הדאטה', 'בתהליך שליפה',
                       'בתהליך בדיקה של שליפות הנתונים', 'מחכה לאישור עסקי', 'אושר'],
    'סטטוס משימה': ['טרם החל', 'בתהליך', 'בוצע']
  };

  /**
   * שלוש הישויות שהחלונית יודעת לערוך.
   *   thread  — תחום ההערות (ind / pot), או null כשאין לישות שרשור הערות
   *   reason  — האם סיבת השינוי חובה
   */
  var ENT = {
    ind: {
      fields: IND_FIELDS, idCol: 'מזהה', nameCol: 'שם המדד', rows: function () { return S.ind; },
      /* מדד חדש נפתח כמוצג במפה — אחרת הוא נשמר ומיד נעלם מאחורי מסנן ברירת המחדל */
      defs: { 'במפה': '1', 'סטטוס': 'בתהליך פיתוח' },
      thread: 'ind', reason: true, noun: 'מדד', fresh: 'מדד חדש', add: 'הוספת מדד'
    },
    pot: {
      fields: POT_FIELDS, idCol: 'מזהה זמני', nameCol: 'שם מדד', rows: function () { return S.pot; },
      defs: { 'סטטוס': 'בחינה ראשונית' },
      thread: 'pot', reason: true, noun: 'מדד פוטנציאלי', fresh: 'מדד פוטנציאלי חדש', add: 'הוספת מדד פוטנציאלי',
      del: true
    },
    tsk: {
      fields: TSK_FIELDS, idCol: 'מזהה משימה', nameCol: 'כותרת המשימה', rows: function () { return S.tsk; },
      defs: { 'סטטוס': 'טרם החל' },
      thread: null, reason: false, noun: 'משימה', fresh: 'משימה חדשה', add: 'הוספת משימה'
    }
  };

  var TBL_COLS = ['מזהה', 'שם המדד', 'נושא', 'תת נושא', 'מקור המידע', 'תדירות', 'סטטוס', 'במפה'];

  var ST_CLASS = {
    'פעיל': 'st-active', 'בבחינה': 'st-check', 'בתהליך פיתוח': 'st-new', 'יורד': 'st-down',
    'בחינה ראשונית': 'st-reword', 'בבדיקה מול יחידת הדאטה': 'st-new', 'בתהליך שליפה': 'st-new',
    'בתהליך בדיקה של שליפות הנתונים': 'st-new', 'מחכה לאישור עסקי': 'st-check', 'אושר': 'st-active',
    'טרם החל': 'st-reword', 'בתהליך': 'st-new', 'בוצע': 'st-active'
  };
  var CMT_CLASS = { 'פתוח': 'open', 'בבדיקה': 'check', 'טופל': 'done', 'נדחה': 'rej' };

  var SCREENS = {
    home: { title: 'ניהול — מסך ראשי', tag: 'תמונת מצב של המדדים, המדדים הפוטנציאליים והמשימות הפתוחות.' },
    ind: { title: 'ניהול מדדים', tag: 'המדדים, ההערות והחלטות הצוות — כולם בגיליון אחד. כל שינוי נרשם ביומן עם השם, המועד והסיבה.' },
    pot: { title: 'ניהול פוטנציאל מדדים', tag: 'מדדים שנבחנים לפני כניסה למפה — מהבחינה הראשונית ועד האישור העסקי. אותה שיטה כמו המדדים: הערות, החלטות ויומן.' },
    tsk: { title: 'ניהול משימות', tag: 'משימות הצוות, הגורם לביצוע ומועד היעד. כל שינוי נרשם ביומן.' }
  };

  /* ---------- עזרים ---------- */

  function $(id) { return d.getElementById(id); }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
  }

  function today() {
    var t = new Date();
    return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2);
  }

  function list(name) { return S.lists[name] || DEF_LISTS[name] || []; }

  var toastTimer = null;
  function toast(msg, bad) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast on' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, bad ? 5200 : 2600);
  }

  /* מה מוצג בשכבת הטעינה, לפי הפעולה שרצה */
  var LOADING = {
    bootstrap: 'טוען נתונים…',
    seed: 'מאתחל את רשימת המדדים…',
    saveIndicator: 'שומר…',
    saveRow: 'שומר…',
    retireIndicator: 'מוריד מדד…',
    deleteRow: 'מוחק…',
    addComment: 'שומר הערה…',
    updateComment: 'מעדכן הערה…',
    ingest: 'מושך הערות מהסדנה…',
    'export': 'מייצא…'
  };

  function busy(on, msg) {
    var box = $('load');
    if (on && msg) $('loadTx').textContent = msg;
    box.hidden = !on;
  }

  /** ערכים ייחודיים של עמודה בשורות נתונות, בתוספת ערכים קבועים */
  function values(rows, field, extra) {
    var seen = {}, out = [];
    function add(v) { v = String(v || '').trim(); if (v && !seen[v]) { seen[v] = 1; out.push(v); } }
    (extra || []).forEach(add);
    rows.forEach(function (r) { add(r[field]); });
    return out.sort(function (a, b) { return a.localeCompare(b, 'he'); });
  }

  function themeNames() {
    return DATA_THEMES.map(function (t) { return t.name; });
  }
  function subNames() {
    var out = [];
    DATA_THEMES.forEach(function (t) { out = out.concat(t.subs || []); });
    return out;
  }

  /** הצעות לשדה combo: מהישות עצמה, ומעמודה מקבילה בלשונית המדדים אם הוגדרה */
  function suggest(kind, f) {
    var extra = f.also ? values(S.ind, f.also, []) : [];
    return values(ENT[kind].rows(), f.h, extra);
  }

  /** ערכי הרשימה הסגורה של שדה — מ-data.js לנושאים, מהשרת לסטטוסים */
  function listFor(src) {
    if (src === 'themes') return themeNames();
    if (src === 'subs') return subNames();
    return list(src);
  }

  /** תתי הנושאים של נושא נתון. נושא ריק — כל תתי הנושאים. */
  function subsOf(theme) {
    if (!theme) return subNames();
    for (var i = 0; i < DATA_THEMES.length; i++) {
      if (DATA_THEMES[i].name === theme) return (DATA_THEMES[i].subs || []).slice();
    }
    return subNames();
  }

  /** אלמנט של שדה בחלונית לפי הכותרת שלו */
  function fEl(kind, h) {
    var fs = ENT[kind].fields;
    for (var i = 0; i < fs.length; i++) if (fs[i].h === h) return $('f_' + i);
    return null;
  }

  /** ממלא select בערכים, ושומר ערך קיים שאינו ברשימה כדי לא לאבד נתון */
  function fillList(sel, items, cur) {
    var opts = ['<option value=""></option>'];
    var seen = false;
    items.forEach(function (v) {
      if (v === cur) seen = true;
      opts.push('<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>');
    });
    if (cur && !seen) opts.push('<option selected>' + esc(cur) + '</option>');
    sel.innerHTML = opts.join('');
  }

  /** select של מסנן: תווית «הכול» ואחריה הערכים, בלי לאבד את הבחירה הנוכחית */
  function fillSel(id, label, items) {
    var sel = $(id);
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + esc(label) + '</option>' +
      items.map(function (v) {
        var val = Array.isArray(v) ? v[0] : v, tx = Array.isArray(v) ? v[1] : v;
        return '<option value="' + esc(val) + '"' + (val === cur ? ' selected' : '') + '>' + esc(tx) + '</option>';
      }).join('');
  }

  function stPill(v) {
    return '<span class="st ' + (ST_CLASS[v] || 'st-new') + '">' + esc(v || '—') + '</span>';
  }

  function byKey(rows, col, id) {
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][col]) === String(id)) return rows[i];
    }
    return null;
  }
  function byId(id) { return byKey(S.ind, 'מזהה', id); }

  function hay(r, cols) {
    return cols.map(function (c) { return r[c] || ''; }).join(' ').toLowerCase();
  }

  /* ---------- שיחה עם השרת ---------- */

  function api(action, extra) {
    var url = w.KYD && w.KYD.collect && w.KYD.collect.url && w.KYD.collect.url();
    if (!url) return Promise.reject(new Error('לא מוגדרת כתובת נקודת קליטה ב-assets/collect.js.'));

    var body = { action: action, pass: S.pass, who: S.who };
    for (var k in extra) body[k] = extra[k];

    /* text/plain הוא simple request — בלי preflight, ש-Apps Script אינו עונה לו */
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text();
    }).then(function (txt) {
      var j;
      try { j = JSON.parse(txt); }
      catch (e) { throw new Error('תשובה לא צפויה מהשרת: ' + txt.slice(0, 160)); }
      if (j.ok === false) throw new Error(j.error || 'שגיאה לא ידועה');
      return j;
    });
  }

  /** מריצה פעולה, מרעננת מה שחזר ומדווחת למשתמש */
  function run(action, extra, okMsg) {
    busy(true, LOADING[action] || 'טוען…');
    return api(action, extra).then(function (r) {
      if (r.indicators) S.ind = r.indicators;
      if (r.comments) S.cmt = r.comments;
      if (r.potentials) S.pot = r.potentials;
      if (r.potComments) S.pcmt = r.potComments;
      if (r.tasks) S.tsk = r.tasks;
      if (r.scores) S.score = r.scores;
      if (r.changes) S.chg = r.changes;
      if (r.lists) S.lists = r.lists;
      if (r.indicator) merge('ind', r.indicator);
      if (r.kind && r.row) merge(r.kind, r.row);
      if (okMsg) toast(okMsg);
      afterData();
      return r;
    }).catch(function (err) {
      toast(err.message, true);
      throw err;
    }).finally(function () { busy(false); });
  }

  /** מחליף שורה יחידה ברשימה בלי טעינה מלאה מחדש */
  function merge(kind, row) {
    var e = ENT[kind], rows = e.rows();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][e.idCol]) === String(row[e.idCol])) { rows[i] = row; return; }
    }
    rows.push(row);
  }

  /* ---------- כניסה ---------- */

  function saveAuth() {
    try { sessionStorage.setItem(STORE, JSON.stringify({ who: S.who, pass: S.pass })); } catch (e) {}
  }
  function loadAuth() {
    try {
      var a = JSON.parse(sessionStorage.getItem(STORE));
      if (a && a.pass) { S.who = a.who || ''; S.pass = a.pass; return true; }
    } catch (e) {}
    return false;
  }
  function clearAuth() {
    try { sessionStorage.removeItem(STORE); } catch (e) {}
  }

  function enter() {
    d.body.classList.remove('locked');
    $('gate').classList.remove('on');
    $('navUser').innerHTML =
      '<span class="nm">' + esc(S.who) + '</span><span class="dv">ניהול</span>' +
      '<button type="button" id="outBtn">יציאה</button>';
    $('outBtn').addEventListener('click', function () {
      clearAuth();
      w.location.reload();
    });
  }

  function bootstrap() {
    return run('bootstrap').then(function (r) {
      enter();
      var g = r.ingested || {};
      if (g.added || g.updated) {
        toast('נמשכו מהסדנה: ' + (g.added || 0) + ' הערות חדשות, ' + (g.updated || 0) + ' עודכנו');
      }
      if (!r.potentials && !r.tasks) {
        toast('השרת עדיין בגרסה הקודמת — פרסמו מחדש את ה-Web App כדי להפעיל פוטנציאל מדדים ומשימות.', true);
      }
    });
  }

  function gate() {
    $('gate').classList.add('on');
    $('gName').value = S.who || '';
    setTimeout(function () { ($('gName').value ? $('gPass') : $('gName')).focus(); }, 40);
  }

  /* ---------- ציון והתייחסות ---------- */

  /** הציון הממוצע שנאסף עד כה למדד, או null אם טרם דירגו אותו */
  function scoreOf(id) {
    var s = S.score[String(id)];
    return s && s.n ? s : null;
  }

  /* חמישה כוכבים במילוי חלקי לפי הממוצע — הכוכב האחרון נחתך בחלקו, כדי
     ש-3.4 ייראה שונה מ-3.8 ולא ייעגל לאותה תמונה. */
  function starBar(avg) {
    var pc = Math.max(0, Math.min(100, (avg / 5) * 100));
    return '<span class="sbar"><span class="on" style="width:' + pc.toFixed(1) + '%">★★★★★</span>' +
      '<span class="off">★★★★★</span></span>';
  }

  /** תא הציון בטבלה: ממוצע, כוכבים ומספר המדרגים */
  function scoreCell(id) {
    var s = scoreOf(id);
    if (!s) return '<td><span class="sc zero">—</span></td>';
    return '<td><span class="sc" title="' + s.n + ' מדרגים">' +
      '<b>' + s.avg.toFixed(1) + '</b>' + starBar(s.avg) +
      '<i>' + s.n + '</i></span></td>';
  }

  function cmtsOf(scope) { return scope === 'pot' ? S.pcmt : S.cmt; }

  function isReply(c) { return !!String(c['בתגובה להערה'] || '').trim(); }

  /** הערות פתוחות של פריט — רק הערות-אם, לא תגובות */
  function openCount(id, scope) {
    return cmtsOf(scope || 'ind').filter(function (c) {
      return String(c['מזהה מדד']) === String(id) && !isReply(c) &&
             String(c['סטטוס טיפול'] || '').trim() === 'פתוח';
    }).length;
  }

  /** ערך «במפה» מנורמל: ריק נחשב «לא במפה» */
  function inMap(r) { return String(r['במפה']).trim() === '1' ? '1' : '0'; }

  function live(r) { return String(r['סטטוס']).trim() !== 'יורד'; }

  /** מדד שאיש לא התייחס אליו: אין לו דירוג ואין עליו אף הערה */
  function noRef(r) {
    var id = String(r['מזהה']);
    if (scoreOf(id)) return false;
    return !S.cmt.some(function (c) { return String(c['מזהה מדד']) === id && !isReply(c); });
  }

  /* ---------- מסך ראשי ---------- */

  function isOpenTask(t) { return String(t['סטטוס']).trim() !== 'בוצע'; }
  function isLate(t) {
    var due = String(t['תאריך לביצוע'] || '').trim();
    return isOpenTask(t) && !!due && due < today();
  }

  function kpi(v, label, sub, go) {
    return '<button type="button" class="kpi mg-kpi" data-go="' + esc(go) + '">' +
      '<div class="v">' + v + '</div><div class="l">' + esc(label) + '</div>' +
      '<div class="s">' + sub + '</div></button>';
  }

  /**
   * שורות של גרף עמודות אופקי, בעיצוב .bars של מסך תפיסת המדידה — סדרה אחת,
   * צבע אחד. ריחוף מציג את הפירוט ב-title, ולחיצה עוברת למסך המסונן.
   */
  function barsHtml(items, kind) {
    var max = 0;
    items.forEach(function (it) { max = Math.max(max, it.n); });
    if (!max) return '<div class="empty">אין עדיין נתונים</div>';
    return items.map(function (it) {
      var pc = it.n ? Math.max(2, (it.n / max) * 100) : 0;
      return '<button type="button" class="bar mg-bar" data-kind="' + kind + '" data-val="' + esc(it.key) +
        '" title="' + esc(it.tip || '') + '">' +
        '<span class="lb">' + esc(it.label) + '</span>' +
        '<span class="tr"><span class="fl" style="width:' + pc.toFixed(1) + '%"></span>' +
        '<span class="vl">' + it.n + '</span>' + (it.note ? '<span class="nt">' + esc(it.note) + '</span>' : '') +
        '</span></button>';
    }).join('');
  }

  function renderHome() {
    var liveInd = S.ind.filter(live);
    var onMap = liveInd.filter(function (r) { return inMap(r) === '1'; });
    var noRefN = onMap.filter(noRef).length;
    var approved = S.pot.filter(function (p) { return String(p['סטטוס']).trim() === 'אושר'; }).length;
    var open = S.tsk.filter(isOpenTask);
    var late = open.filter(isLate).length;

    $('homeKpis').innerHTML =
      kpi(liveInd.length, 'מדדים במערכת', onMap.length + ' מוצגים במפה', 'ind') +
      kpi(noRefN, 'מדדים ללא התייחסות', 'מתוך ' + onMap.length + ' שבמפה — בלי דירוג ובלי הערה', 'noref') +
      kpi(S.pot.length, 'מדדים פוטנציאליים', approved + ' אושרו', 'pot') +
      kpi(open.length, 'משימות פתוחות', late ? '<span class="late">' + late + ' באיחור</span>' : 'אין משימות באיחור', 'tsk');

    /* מדדים פוטנציאליים לפי נושא — כל חמשת הנושאים, גם מה שעוד ריק */
    var byTheme = {}, statuses = {};
    S.pot.forEach(function (p) {
      var t = String(p['נושא'] || '').trim() || '';
      byTheme[t] = (byTheme[t] || 0) + 1;
      statuses[t] = statuses[t] || {};
      var st = String(p['סטטוס'] || '').trim() || 'ללא סטטוס';
      statuses[t][st] = (statuses[t][st] || 0) + 1;
    });
    var themes = themeNames();
    Object.keys(byTheme).forEach(function (t) { if (t && themes.indexOf(t) < 0) themes.push(t); });
    var tItems = themes.map(function (t) {
      return { key: t, label: t, n: byTheme[t] || 0, tip: tipOf(statuses[t]) };
    });
    if (byTheme['']) tItems.push({ key: '__none', label: 'ללא נושא', n: byTheme[''], tip: tipOf(statuses['']) });
    $('potBars').innerHTML = barsHtml(tItems, 'pot');

    /* משימות פתוחות לפי גורם — מהגדול לקטן; האיחור נכתב במילים, לא רק בצבע */
    var byOwner = {}, lateBy = {};
    open.forEach(function (t) {
      var o = String(t['גורם לביצוע'] || '').trim();
      byOwner[o] = (byOwner[o] || 0) + 1;
      if (isLate(t)) lateBy[o] = (lateBy[o] || 0) + 1;
    });
    var oItems = Object.keys(byOwner).map(function (o) {
      return {
        key: o || '__none', label: o || 'ללא גורם', n: byOwner[o],
        note: lateBy[o] ? lateBy[o] + ' באיחור' : '',
        tip: byOwner[o] + ' פתוחות' + (lateBy[o] ? ', ' + lateBy[o] + ' מהן באיחור' : '')
      };
    }).sort(function (a, b) { return b.n - a.n || a.label.localeCompare(b.label, 'he'); });
    $('tskBars').innerHTML = oItems.length ? barsHtml(oItems, 'tsk')
      : '<div class="empty">אין משימות פתוחות</div>';
  }

  function tipOf(m) {
    if (!m) return '';
    return Object.keys(m).map(function (k) { return m[k] + ' ' + k; }).join(' · ');
  }

  /* ---------- מסך המדדים ---------- */

  function matches(r) {
    var q = $('q').value.trim().toLowerCase();
    var mp = $('fMap').value;
    if (mp !== '' && inMap(r) !== mp) return false;
    var pairs = [['fTheme', 'נושא'], ['fSub', 'תת נושא'], ['fStatus', 'סטטוס'], ['fSource', 'מקור המידע']];
    for (var i = 0; i < pairs.length; i++) {
      var v = $(pairs[i][0]).value;
      if (v && String(r[pairs[i][1]] || '') !== v) return false;
    }
    if (S.openOnly && !openCount(r['מזהה'])) return false;
    if (S.noRefOnly && (!live(r) || !noRef(r))) return false;
    if (q && hay(r, ['מזהה', 'שם המדד', 'שם מקוצר', 'נושא', 'תת נושא']).indexOf(q) < 0) return false;
    return true;
  }

  function renderInd() {
    $('indHead').innerHTML = '<tr>' +
      TBL_COLS.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '<th>ציון ממוצע</th><th>הערות פתוחות</th><th>עודכן</th></tr>';

    var rows = S.ind.filter(matches).sort(function (a, b) {
      return String(a['נושא']).localeCompare(String(b['נושא']), 'he') ||
             String(a['תת נושא']).localeCompare(String(b['תת נושא']), 'he') ||
             String(a['שם המדד']).localeCompare(String(b['שם המדד']), 'he');
    });

    var span = TBL_COLS.length + 3;
    if (!rows.length) {
      $('indBody').innerHTML = '<tr><td colspan="' + span + '" class="empty">אין מדדים תואמים</td></tr>';
      return;
    }

    $('indBody').innerHTML = rows.map(function (r) {
      var n = openCount(r['מזהה']);
      return '<tr data-kind="ind" data-id="' + esc(r['מזהה']) + '">' +
        '<td class="id">' + esc(r['מזהה']) + '</td>' +
        '<td class="nm">' + esc(r['שם המדד']) +
          (r['שם מקוצר'] && r['שם מקוצר'] !== r['שם המדד']
            ? '<span class="sb">' + esc(r['שם מקוצר']) + '</span>' : '') + '</td>' +
        '<td class="mut">' + esc(r['נושא']) + '</td>' +
        '<td class="mut">' + esc(r['תת נושא']) + '</td>' +
        '<td class="mut">' + esc(r['מקור המידע']) + '</td>' +
        '<td class="mut">' + esc(r['תדירות']) + '</td>' +
        '<td>' + stPill(r['סטטוס']) + '</td>' +
        '<td><span class="mp' + (inMap(r) === '1' ? ' on' : '') + '">' + inMap(r) + '</span></td>' +
        scoreCell(r['מזהה']) +
        '<td><span class="oc' + (n ? '' : ' zero') + '">' + (n || '—') + '</span></td>' +
        '<td class="mut">' + esc(r['עודכן בתאריך']) + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderSeed() {
    var box = $('seedBox');
    if (S.ind.length) { box.innerHTML = ''; return; }
    var n = DATA_IND.length;
    box.innerHTML =
      '<div class="mg-seed"><div class="tx"><b>לשונית האינדיקטורים ריקה.</b> אפשר לאתחל אותה ' +
      'מרשימת המדדים שבקוד הכלי (' + n + ' מדדים ב-assets/data.js). האתחול אפשרי פעם אחת בלבד — ' +
      'מרגע שיש שורות בלשונית, היא מקור האמת.</div>' +
      '<button class="btn-primary" id="seedBtn" type="button">אתחול מ-data.js</button></div>';
    $('seedBtn').addEventListener('click', function () {
      if (!n) return toast('לא נטענו מדדים מ-data.js', true);
      run('seed', { indicators: DATA_IND }, 'אותחלו ' + n + ' מדדים').catch(function () {});
    });
  }

  /* ---------- מסך פוטנציאל המדדים ---------- */

  function potMatches(r) {
    var q = $('pq').value.trim().toLowerCase();
    var pairs = [['pTheme', 'נושא'], ['pSub', 'תת נושא'], ['pStatus', 'סטטוס'], ['pSource', 'מקור הנתונים']];
    for (var i = 0; i < pairs.length; i++) {
      var v = $(pairs[i][0]).value;
      if (v === '__none') { if (String(r[pairs[i][1]] || '').trim()) return false; continue; }
      if (v && String(r[pairs[i][1]] || '') !== v) return false;
    }
    if (S.popenOnly && !openCount(r['מזהה זמני'], 'pot')) return false;
    if (q && hay(r, ['מזהה זמני', 'שם מדד', 'הסבר על שיטת המדידה', 'נושא', 'תת נושא']).indexOf(q) < 0) return false;
    return true;
  }

  function renderPot() {
    var theme = $('pTheme').value;
    fillSel('pTheme', 'כל הנושאים', values(S.pot, 'נושא', themeNames()));
    if (theme === '__none') $('pTheme').insertAdjacentHTML('beforeend', '<option value="__none" selected>ללא נושא</option>');
    fillSel('pSub', 'כל תתי הנושאים', values(S.pot, 'תת נושא', subsOf($('pTheme').value === '__none' ? '' : $('pTheme').value)));
    fillSel('pStatus', 'כל הסטטוסים', list('סטטוס פוטנציאל'));
    fillSel('pSource', 'כל מקורות הנתונים', values(S.pot, 'מקור הנתונים', []));

    var order = list('סטטוס פוטנציאל');
    var rows = S.pot.filter(potMatches).sort(function (a, b) {
      return String(a['נושא']).localeCompare(String(b['נושא']), 'he') ||
             order.indexOf(a['סטטוס']) - order.indexOf(b['סטטוס']) ||
             String(a['שם מדד']).localeCompare(String(b['שם מדד']), 'he');
    });

    if (!rows.length) {
      $('potBody').innerHTML = '<tr><td colspan="9" class="empty">' +
        (S.pot.length ? 'אין מדדים פוטנציאליים תואמים' : 'עדיין אין מדדים פוטנציאליים. «+ מדד פוטנציאלי» מוסיף את הראשון.') +
        '</td></tr>';
      return;
    }
    $('potBody').innerHTML = rows.map(function (r) {
      var n = openCount(r['מזהה זמני'], 'pot');
      return '<tr data-kind="pot" data-id="' + esc(r['מזהה זמני']) + '">' +
        '<td class="id">' + esc(r['מזהה זמני']) + '</td>' +
        '<td class="nm">' + esc(r['שם מדד'] || '(ללא שם)') +
          (r['הסבר על שיטת המדידה'] ? '<span class="sb">' + esc(clip(r['הסבר על שיטת המדידה'], 90)) + '</span>' : '') + '</td>' +
        '<td class="mut">' + esc(r['נושא']) + '</td>' +
        '<td class="mut">' + esc(r['תת נושא']) + '</td>' +
        '<td class="mut">' + esc(r['מקור הנתונים']) + '</td>' +
        '<td class="mut">' + esc(r['יחידת מידה']) + '</td>' +
        '<td>' + stPill(r['סטטוס']) + '</td>' +
        '<td><span class="oc' + (n ? '' : ' zero') + '">' + (n || '—') + '</span></td>' +
        '<td class="mut">' + esc(r['עודכן בתאריך']) + '</td>' +
        '</tr>';
    }).join('');
  }

  function clip(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /* ---------- מסך המשימות ---------- */

  function tskMatches(r) {
    var q = $('tq').value.trim().toLowerCase();
    var st = $('tStatus').value, ow = $('tOwner').value;
    if (st === '__open') { if (!isOpenTask(r)) return false; }
    else if (st && String(r['סטטוס'] || '') !== st) return false;
    if (ow === '__none') { if (String(r['גורם לביצוע'] || '').trim()) return false; }
    else if (ow && String(r['גורם לביצוע'] || '') !== ow) return false;
    if (S.lateOnly && !isLate(r)) return false;
    if (q && hay(r, ['מזהה משימה', 'כותרת המשימה', 'פירוט המשימה', 'גורם לביצוע', 'הערות ביצוע']).indexOf(q) < 0) return false;
    return true;
  }

  function renderTsk() {
    var owner = $('tOwner').value;
    fillSel('tStatus', 'כל הסטטוסים', [['__open', 'פתוחות (טרם החל + בתהליך)']].concat(list('סטטוס משימה')));
    fillSel('tOwner', 'כל הגורמים', values(S.tsk, 'גורם לביצוע', []));
    if (owner === '__none') $('tOwner').insertAdjacentHTML('beforeend', '<option value="__none" selected>ללא גורם</option>');

    var order = list('סטטוס משימה');
    var rows = S.tsk.filter(tskMatches).sort(function (a, b) {
      return order.indexOf(a['סטטוס']) - order.indexOf(b['סטטוס']) ||
             String(a['תאריך לביצוע'] || '9999').localeCompare(String(b['תאריך לביצוע'] || '9999')) ||
             String(a['מזהה משימה']).localeCompare(String(b['מזהה משימה']));
    });

    if (!rows.length) {
      $('tskBody').innerHTML = '<tr><td colspan="7" class="empty">' +
        (S.tsk.length ? 'אין משימות תואמות' : 'עדיין אין משימות. «+ משימה» מוסיפה את הראשונה.') + '</td></tr>';
      return;
    }
    $('tskBody').innerHTML = rows.map(function (r) {
      var late = isLate(r);
      return '<tr data-kind="tsk" data-id="' + esc(r['מזהה משימה']) + '">' +
        '<td class="id">' + esc(r['מזהה משימה']) + '</td>' +
        '<td class="nm">' + esc(r['כותרת המשימה'] || '(ללא כותרת)') +
          (r['פירוט המשימה'] ? '<span class="sb">' + esc(clip(r['פירוט המשימה'], 90)) + '</span>' : '') + '</td>' +
        '<td class="mut">' + esc(r['גורם לביצוע'] || '—') + '</td>' +
        '<td class="mut">' + esc(r['תאריך פתיחה']) + '</td>' +
        '<td class="mut' + (late ? ' late' : '') + '">' + esc(r['תאריך לביצוע'] || '—') +
          (late ? ' · באיחור' : '') + '</td>' +
        '<td>' + stPill(r['סטטוס']) + '</td>' +
        '<td class="mut">' + esc(r['עודכן בתאריך']) + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ---------- חלונית העריכה ---------- */

  function field(kind, f, i, val, isNew) {
    if (f.sep) return '<div class="mg-sep">' + esc(f.sep) + '</div>';
    var id = 'f_' + i;
    var cls = 'mg-f' + (f.wide ? ' wide' : '');
    var head = '<label class="' + cls + '"><span>' + esc(f.h) + '</span>';

    if (f.t === 'area') {
      return head + '<textarea id="' + id + '">' + esc(val) + '</textarea></label>';
    }
    if (f.t === 'date') {
      return head + '<input type="date" id="' + id + '" value="' + esc(val) + '"></label>';
    }
    if (f.t === 'sel') {
      var o = f.opts.map(function (p) {
        return '<option value="' + esc(p[0]) + '"' +
               (String(val) === p[0] ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
      }).join('');
      return head + '<select id="' + id + '"><option value=""></option>' + o + '</select></label>';
    }
    if (f.t === 'toggle') {
      var on = String(val).trim() === '1';
      return head + '<button type="button" class="toggle' + (on ? ' on' : '') + '" id="' + id +
             '" data-v="' + (on ? '1' : '0') + '" aria-pressed="' + on + '">' +
             '<span class="sw" aria-hidden="true"></span>' +
             '<span class="tx">' + esc(on ? f.on : f.off) + '</span></button>';
    }
    if (f.t === 'list') {
      /* הרשימה עצמה נבנית אחרי ההצגה — «תת נושא» תלוי בנושא שנבחר */
      return head + '<select id="' + id + '"></select></label>';
    }
    if (f.t === 'combo') {
      var lid = 'dl_' + id;
      var opts = suggest(kind, f).map(function (v) { return '<option value="' + esc(v) + '">'; }).join('');
      return head + '<input id="' + id + '" list="' + lid + '" value="' + esc(val) + '">' +
             '<datalist id="' + lid + '">' + opts + '</datalist></label>';
    }
    if (f.lock) {
      return head + '<input id="' + id + '" value="' + esc(val) + '"' +
             (isNew ? ' placeholder="' + esc(f.ph || 'ריק = המספר הפנוי הבא') + '"' : ' readonly class="lock"') + '></label>';
    }
    return head + '<input id="' + id + '" value="' + esc(val) + '"></label>';
  }

  function histOf(id) {
    return S.chg.filter(function (c) {
      return String(c['מזהה מדד']) === String(id) && String(c['סוג פעולה']) !== 'הערה';
    });
  }

  function openDrawer(kind, id) {
    var e = ENT[kind];
    var isNew = !id;
    var r = isNew ? {} : (byKey(e.rows(), e.idCol, id) || {});
    if (isNew) {
      for (var k in e.defs) r[k] = e.defs[k];
      if (kind === 'tsk') r['תאריך פתיחה'] = today();
    }
    S.sel = { kind: kind, id: id || '' };
    S.reply = null;

    var name = r[e.nameCol] || '(ללא שם)';
    var head = isNew ? e.fresh : esc(name);
    var bc = isNew ? 'הוספה' : esc(e.noun) + ' · ' + esc(r[e.idCol]) +
      (kind === 'ind' ? ' · גרסה ' + esc(r['גרסה'] || '1.0') : '');

    var html =
      '<div class="dh"><div><div class="bc">' + bc + '</div><h3>' + head + '</h3></div>' +
      '<button class="x" type="button" id="dClose" aria-label="סגירה">✕</button></div>' +
      '<div class="db">' +
        '<div class="mg-grid">' +
          e.fields.map(function (f, i) { return field(kind, f, i, r[f.h] || '', isNew); }).join('') +
          '<label class="mg-f wide' + (e.reason ? ' req' : '') + '"><span>' +
          (e.reason ? 'סיבת השינוי — נרשמת ביומן' : 'סיבת השינוי — לא חובה, נרשמת ביומן') + '</span>' +
          '<input id="f_reason" placeholder="' + (kind === 'tsk' ? 'למשל: הוקדם בעקבות ישיבת צוות'
            : 'למשל: אוחד עם מדד 1042 בעקבות הערות הסדנה') + '"></label>' +
        '</div>';

    if (!isNew && kind === 'ind') {
      var sc = scoreOf(r['מזהה']);
      html += '<div class="msec"><h4>ציון ממוצע עד כה</h4>' +
        (sc
          ? '<div class="scbig"><b>' + sc.avg.toFixed(1) + '</b><span class="of">מתוך 5</span>' +
            starBar(sc.avg) + '<span class="n">' + sc.n + ' מדרגים</span></div>'
          : '<div class="mg-note">טרם דורג. הציון נאסף מתיבת ההערכה שבתחתית פירוט המדד במסך «סקירת מדדים».</div>') +
        '</div>';
    }
    if (!isNew && e.thread) {
      html += '<div class="msec" id="dThread"><h4>הערות ודיון</h4>' +
                threadHtml(r[e.idCol], name, e.thread) + '</div>';
    }
    if (!isNew) {
      html += '<div class="msec"><h4>היסטוריית שינויים</h4>' + histHtml(histOf(r[e.idCol])) + '</div>';
    }

    html += '</div><div class="df">' +
      '<button class="btn-primary" type="button" id="dSave">' + (isNew ? e.add : 'שמירה') + '</button>' +
      (!isNew && kind === 'ind' ? '<button class="btn-ghost" type="button" id="dRetire">הורדת מדד</button>' : '') +
      (!isNew && e.del ? '<button class="btn-ghost mg-del" type="button" id="dDelete">מחיקה</button>' : '') +
      '<span class="spacer"></span><button class="btn-ghost" type="button" id="dCancel">סגירה</button></div>';

    var dr = $('drawer');
    dr.innerHTML = html;
    dr.classList.add('on');

    e.fields.forEach(function (f) {
      if (f.t === 'list' && f.src !== 'subs') fillList(fEl(kind, f.h), listFor(f.src), r[f.h] || '');
      if (f.t !== 'toggle') return;
      var b = fEl(kind, f.h);
      b.addEventListener('click', function () {
        var next = b.getAttribute('data-v') === '1' ? '0' : '1';
        b.setAttribute('data-v', next);
        b.setAttribute('aria-pressed', next === '1');
        b.classList.toggle('on', next === '1');
        b.querySelector('.tx').textContent = next === '1' ? f.on : f.off;
      });
    });

    /* «תת נושא» נגזר מהנושא שנבחר, כדי שלא ייווצר צירוף שאינו קיים בעץ */
    var th = fEl(kind, 'נושא'), sb = fEl(kind, 'תת נושא');
    if (th && sb) {
      fillList(sb, subsOf(th.value), r['תת נושא'] || '');
      th.addEventListener('change', function () { fillList(sb, subsOf(th.value), ''); });
    }

    $('dClose').addEventListener('click', closeDrawer);
    $('dCancel').addEventListener('click', closeDrawer);
    $('dSave').addEventListener('click', function () { saveDrawer(kind, isNew ? '' : r[e.idCol]); });
    if (!isNew && kind === 'ind') $('dRetire').addEventListener('click', function () { retire(r); });
    if (!isNew && e.del) $('dDelete').addEventListener('click', function () { remove(kind, r); });
    if (!isNew && e.thread) bindThread($('dThread'), r[e.idCol], name, refreshThread, e.thread);
  }

  /**
   * בונה מחדש רק את מקטע ההערות שבחלונית. הטופס עצמו אינו נוגע — אחרת כל
   * תגובה או שינוי סטטוס היו מוחקים שדות שהמשתמש כבר הקליד ולא שמר.
   */
  function refreshThread() {
    var box = $('dThread');
    if (!box || !S.sel || !S.sel.id) return;
    var e = ENT[S.sel.kind];
    if (!e.thread) return;
    var r = byKey(e.rows(), e.idCol, S.sel.id) || {};
    box.innerHTML = '<h4>הערות ודיון</h4>' + threadHtml(S.sel.id, r[e.nameCol], e.thread);
    bindThread(box, S.sel.id, r[e.nameCol], refreshThread, e.thread);
  }

  /** אחרי כל שינוי נתונים: המסכים נבנים מחדש, והחלונית מתעדכנת בהערות בלבד */
  function afterData() {
    render();
    refreshThread();
  }

  function closeDrawer() {
    S.sel = null;
    S.reply = null;
    $('drawer').classList.remove('on');
    $('drawer').innerHTML = '';
  }

  function saveDrawer(kind, id) {
    var e = ENT[kind];
    var data = {};
    e.fields.forEach(function (f, i) {
      if (f.sep) return;
      var el = $('f_' + i);
      if (!el) return;
      data[f.h] = (f.t === 'toggle') ? el.getAttribute('data-v') : el.value.trim();
    });
    if (id) data[e.idCol] = id;
    var reason = $('f_reason').value.trim();
    if (!String(data[e.nameCol] || '').trim()) return toast('«' + e.nameCol + '» חסר', true);
    if (e.reason && !reason) return toast('מלאו את סיבת השינוי — היא נרשמת ביומן', true);

    var p = kind === 'ind'
      ? run('saveIndicator', { indicator: data, reason: reason }, 'נשמר')
      : run('saveRow', { kind: kind, row: data, reason: reason }, 'נשמר');
    p.then(function (r) {
      if (r.unchanged) toast('לא היה מה לשמור — שום שדה לא השתנה');
      closeDrawer();
    }).catch(function () {});
  }

  function retire(r) {
    var reason = $('f_reason').value.trim();
    if (!reason) return toast('מלאו את סיבת ההורדה — היא נרשמת ביומן', true);
    if (!w.confirm('להוריד את «' + r['שם המדד'] + '»?\nהשורה נשמרת בגיליון והסטטוס משתנה ל«יורד».')) return;
    run('retireIndicator', { id: r['מזהה'], reason: reason }, 'המדד ירד').then(closeDrawer).catch(function () {});
  }

  /**
   * מחיקה של ממש — השורה יוצאת מהגיליון. השרת שומר את כל תוכנה ביומן
   * השינויים, ולכן גם כאן הסיבה חובה: היא מה שיסביר את המחיקה בדיעבד.
   */
  function remove(kind, r) {
    var e = ENT[kind];
    var reason = $('f_reason').value.trim();
    if (!reason) return toast('מלאו את סיבת המחיקה — היא נרשמת ביומן', true);
    if (!w.confirm('למחוק את «' + (r[e.nameCol] || r[e.idCol]) + '»?\n' +
        'השורה תימחק מהגיליון. תוכנה נשמר ביומן השינויים, וההערות עליו נשארות.')) return;
    run('deleteRow', { kind: kind, id: r[e.idCol], reason: reason }, 'נמחק').then(closeDrawer).catch(function () {});
  }

  /* ---------- הערות ---------- */

  function roots(id, scope) {
    return cmtsOf(scope).filter(function (c) {
      return String(c['מזהה מדד']) === String(id) && !isReply(c);
    });
  }
  function repliesOf(cid, scope) {
    return cmtsOf(scope).filter(function (c) {
      return String(c['בתגובה להערה'] || '').trim() === String(cid);
    });
  }
  function cmtById(cid, scope) { return byKey(cmtsOf(scope), 'מזהה הערה', cid); }

  function cmtCard(c, reply) {
    var st = String(c['סטטוס טיפול'] || '').trim();
    var cls = 'cmt ' + (reply ? 'reply' : (CMT_CLASS[st] || ''));
    var h = '<div class="' + cls + '" data-cid="' + esc(c['מזהה הערה']) + '">' +
      '<div class="meta"><b>' + esc(c['ממי התקבל'] || '—') + '</b>' +
      '<span>' + esc(c['תאריך']) + '</span>' +
      '<span class="src">' + esc(c['מקור'] || 'ידני') + '</span>' +
      (c['סוג הערה'] ? '<span>' + esc(c['סוג הערה']) + '</span>' : '') +
      (st ? '<span class="st ' + (st === 'טופל' ? 'st-active' : st === 'נדחה' ? 'st-down' :
            st === 'בבדיקה' ? 'st-new' : 'st-check') + '">' + esc(st) + '</span>' : '') +
      '</div><div class="tx">' + esc(c['תוכן ההערה']) + '</div>';

    if (c['החלטה/פתרון']) {
      h += '<div class="dec"><b>החלטה:</b> ' + esc(c['החלטה/פתרון']) +
           (c['מי טיפל'] ? ' · ' + esc(c['מי טיפל']) : '') + '</div>';
    }

    if (!reply) {
      h += '<div class="acts">' +
        '<select class="cst" data-cid="' + esc(c['מזהה הערה']) + '">' +
        list('סטטוס טיפול').map(function (v) {
          return '<option' + (v === st ? ' selected' : '') + '>' + esc(v) + '</option>';
        }).join('') + '</select>' +
        '<input class="cdec" data-cid="' + esc(c['מזהה הערה']) + '" placeholder="החלטה / פתרון" ' +
        'value="' + esc(c['החלטה/פתרון'] || '') + '">' +
        '<button type="button" class="csave" data-cid="' + esc(c['מזהה הערה']) + '">עדכון</button>' +
        '<button type="button" class="creply" data-cid="' + esc(c['מזהה הערה']) + '">תגובה</button>' +
        '</div>';

      if (S.reply === String(c['מזהה הערה'])) {
        h += '<div class="newcmt reply-box">' +
          '<textarea class="replyTx" placeholder="תגובה להערה…"></textarea>' +
          '<div class="row"><button class="btn-primary replySend" type="button">שליחה</button>' +
          '<button class="btn-ghost replyCancel" type="button">ביטול</button></div></div>';
      }
    }
    return h + '</div>';
  }

  function threadHtml(id, name, scope) {
    var rs = roots(id, scope);
    var h = '';
    if (!rs.length) h += '<p class="mg-note">אין עדיין הערות על הפריט הזה.</p>';
    rs.forEach(function (c) {
      h += cmtCard(c, false);
      repliesOf(c['מזהה הערה'], scope).forEach(function (rp) { h += cmtCard(rp, true); });
    });
    h += '<div class="newcmt new-box">' +
      '<textarea class="newTx" placeholder="הערה חדשה…"></textarea>' +
      '<div class="row"><select class="fsel newKind">' +
      (S.lists['סוג הערה'] || ['כללי']).map(function (v) {
        return '<option' + (v === 'כללי' ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('') + '</select>' +
      '<button class="btn-primary newSend" type="button">הוספת הערה</button></div></div>';
    return h;
  }

  /** מחבר את כפתורי ההערות בתוך אלמנט נתון (החלונית או מסך ההערות) */
  function bindThread(root, id, name, refresh, scope) {
    root.querySelectorAll('.csave').forEach(function (b) {
      b.addEventListener('click', function () {
        var cid = b.getAttribute('data-cid');
        var st = root.querySelector('.cst[data-cid="' + cid + '"]').value;
        var dec = root.querySelector('.cdec[data-cid="' + cid + '"]').value.trim();
        run('updateComment', { scope: scope, id: cid, patch: { 'סטטוס טיפול': st, 'החלטה/פתרון': dec } },
            'ההערה עודכנה').catch(function () {});
      });
    });

    root.querySelectorAll('.creply').forEach(function (b) {
      b.addEventListener('click', function () {
        var cid = b.getAttribute('data-cid');
        S.reply = (S.reply === cid) ? null : cid;
        refresh();
      });
    });

    var send = root.querySelector('.replySend');
    if (send) {
      send.addEventListener('click', function () {
        var tx = root.querySelector('.replyTx').value.trim();
        if (!tx) return toast('התגובה ריקה', true);
        var parent = S.reply;
        var src = cmtById(parent, scope) || {};
        S.reply = null;
        run('addComment', {
          scope: scope,
          comment: {
            'מזהה מדד': src['מזהה מדד'] || id || '',
            'שם המדד': src['שם המדד'] || name || '',
            'תוכן ההערה': tx, 'בתגובה להערה': parent, 'סוג הערה': 'תגובה'
          }
        }, 'התגובה נוספה').catch(function () {});
      });
      root.querySelector('.replyCancel').addEventListener('click', function () {
        S.reply = null;
        refresh();
      });
      root.querySelector('.replyTx').focus();
    }

    var add = root.querySelector('.newSend');
    if (add) {
      add.addEventListener('click', function () {
        var tx = root.querySelector('.newTx').value.trim();
        if (!tx) return toast('ההערה ריקה', true);
        run('addComment', {
          scope: scope,
          comment: {
            'מזהה מדד': id || '', 'שם המדד': name || '',
            'תוכן ההערה': tx, 'סוג הערה': root.querySelector('.newKind').value
          }
        }, 'ההערה נוספה').catch(function () {});
      });
    }
  }

  /* ---------- מסכי ההערות ----------
     אותו מסך לשני התחומים; האלמנטים של תחום pot מתחילים ב-p (pcq, pcStatus…). */

  function cmtIds(scope) {
    var p = scope === 'pot' ? 'p' : '';
    return { q: p + 'cq', st: p + 'cStatus', src: p + 'cSource', note: p + 'cmtNote', list: p + 'cmtList' };
  }

  function renderCmt(scope) {
    var ids = cmtIds(scope), all = cmtsOf(scope);
    var e = ENT[scope];
    fillSel(ids.st, 'כל הסטטוסים', list('סטטוס טיפול'));
    fillSel(ids.src, 'כל המקורות', ['סדנה', 'ידני']);

    var q = $(ids.q).value.trim().toLowerCase();
    var stv = $(ids.st).value, srcv = $(ids.src) ? $(ids.src).value : '';
    function ok(c) {
      if (stv && String(c['סטטוס טיפול'] || '') !== stv) return false;
      if (srcv && String(c['מקור'] || '') !== srcv) return false;
      return !q || hay(c, ['תוכן ההערה', 'שם המדד', 'ממי התקבל', 'מזהה מדד']).indexOf(q) >= 0;
    }

    var open = all.filter(function (c) { return !isReply(c) && String(c['סטטוס טיפול']) === 'פתוח'; }).length;
    $(ids.note).innerHTML = 'סך הכול <b>' + all.length + '</b> הערות, מתוכן <b>' + open + '</b> פתוחות.' +
      (scope === 'ind' ? ' הערות המשתתפים נמשכות מלשוניות הסדנה בכל טעינה של המסך.' : '');

    /* קיבוץ לפי פריט; הערות בלי שיוך — בקבוצה אחת בסוף */
    var groups = {}, order = [];
    all.forEach(function (c) {
      if (isReply(c) || !ok(c)) return;   /* תגובות נתלות בהערת-האם */
      var k = String(c['מזהה מדד'] || '');
      if (!groups[k]) { groups[k] = { name: c['שם המדד'] || '', items: [] }; order.push(k); }
      groups[k].items.push(c);
    });
    order.sort(function (a, b) { return (a === '' ? 1 : 0) - (b === '' ? 1 : 0); });

    if (!order.length) {
      $(ids.list).innerHTML = '<div class="empty">אין הערות תואמות</div>';
      return;
    }

    $(ids.list).innerHTML = order.map(function (k) {
      var g = groups[k];
      var row = k ? byKey(e.rows(), e.idCol, k) : null;
      var title = k ? (row ? row[e.nameCol] : g.name) : 'הערות כלליות מהסדנה';
      var h = '<div class="thread"><div class="th">' +
        (k ? '<a data-open="' + esc(k) + '">' + esc(title) + '</a><span class="id">' + esc(k) + '</span>'
           : '<span>' + esc(title) + '</span>') +
        '<span class="id">' + g.items.length + ' הערות</span></div>';
      g.items.forEach(function (c) {
        h += cmtCard(c, false);
        repliesOf(c['מזהה הערה'], scope).forEach(function (rp) { h += cmtCard(rp, true); });
      });
      return h + '</div>';
    }).join('');

    bindThread($(ids.list), '', '', function () { renderCmt(scope); }, scope);
    $(ids.list).querySelectorAll('[data-open]').forEach(function (a) {
      a.addEventListener('click', function () { openDrawer(scope, a.getAttribute('data-open')); });
    });
  }

  /* ---------- יומן ---------- */

  function histHtml(rows) {
    if (!rows.length) return '<p class="mg-note">אין עדיין שינויים מתועדים.</p>';
    return '<div class="hist">' + rows.map(function (c) {
      return '<div class="h"><span class="d">' + esc(String(c['תאריך']).slice(0, 16)) + '</span>' +
        '<span class="w">' + esc(c['מי ביצע']) + '</span>' +
        '<span class="f">' + esc(c['סוג פעולה']) + (c['שדה שהשתנה'] && c['שדה שהשתנה'] !== '—'
          ? ' · ' + esc(c['שדה שהשתנה']) : '') + '</span>' +
        (c['ערך קודם'] ? '<span class="old">' + esc(c['ערך קודם']) + '</span>' : '') +
        (c['ערך חדש'] ? '<span class="new">' + esc(c['ערך חדש']) + '</span>' : '') +
        (c['סיבה'] ? '<span class="w">— ' + esc(c['סיבה']) + '</span>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  function renderChg() {
    if (!S.chg.length) {
      $('chgBody').innerHTML = '<tr><td colspan="8" class="empty">היומן ריק</td></tr>';
      return;
    }
    $('chgBody').innerHTML = S.chg.map(function (c) {
      return '<tr><td class="id">' + esc(String(c['תאריך']).slice(0, 16)) + '</td>' +
        '<td class="mut">' + esc(c['מי ביצע']) + '</td>' +
        '<td>' + esc(c['סוג פעולה']) + '</td>' +
        '<td class="id">' + esc(c['מזהה מדד']) + '</td>' +
        '<td class="mut">' + esc(c['שדה שהשתנה']) + '</td>' +
        /* במחיקה «ערך קודם» הוא כל השורה כ-JSON — מקוצר כאן, המלא בריחוף */
        '<td class="mut" title="' + esc(c['ערך קודם']) + '">' + esc(clip(c['ערך קודם'], 80)) + '</td>' +
        '<td>' + esc(c['ערך חדש']) + '</td>' +
        '<td class="mut">' + esc(c['סיבה']) + '</td></tr>';
    }).join('');
  }

  /* ---------- רינדור ראשי ---------- */

  function render() {
    var sc = SCREENS[S.screen];
    $('pgTitle').textContent = sc.title;
    $('pgTag').textContent = sc.tag;
    d.title = 'מצפן רשויות מקומיות — ' + sc.title;
    $('screenTabs').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-s') === S.screen);
    });
    $('ingestBtn').hidden = $('exportBtn').hidden = S.screen !== 'ind';

    $('cInd').textContent = S.ind.length || '';
    $('cCmt').textContent = S.cmt.length || '';
    $('cChg').textContent = S.chg.length || '';
    $('cPot').textContent = S.pot.length || '';
    $('cPcmt').textContent = S.pcmt.length || '';

    ['home', 'ind', 'pot', 'tsk'].forEach(function (s) {
      $('scr_' + s).hidden = S.screen !== s;
    });

    if (S.screen === 'home') renderHome();

    if (S.screen === 'ind') {
      $('viewInd').hidden = S.view !== 'ind';
      $('viewCmt').hidden = S.view !== 'cmt';
      $('viewChg').hidden = S.view !== 'chg';
      if (S.view === 'ind') {
        renderSeed();
        fillSel('fTheme', 'כל הנושאים', values(S.ind, 'נושא', []));
        fillSel('fSub', 'כל תתי הנושאים', values(S.ind, 'תת נושא', []));
        fillSel('fStatus', 'כל הסטטוסים', values(S.ind, 'סטטוס', list('סטטוס')));
        fillSel('fSource', 'כל המקורות', values(S.ind, 'מקור המידע', []));
        renderInd();
      } else {
        $('seedBox').innerHTML = '';
      }
      if (S.view === 'cmt') renderCmt('ind');
      if (S.view === 'chg') renderChg();
    }

    if (S.screen === 'pot') {
      $('viewPot').hidden = S.pview !== 'pot';
      $('viewPcmt').hidden = S.pview !== 'cmt';
      if (S.pview === 'pot') renderPot();
      else renderCmt('pot');
    }

    if (S.screen === 'tsk') renderTsk();
  }

  /** מעבר מסך. ה-hash נשמר כדי שרענון הדף יחזיר לאותו מסך. */
  function go(screen) {
    if (!SCREENS[screen]) screen = 'home';
    S.screen = screen;
    if (w.location.hash !== '#' + screen) {
      try { history.replaceState(null, '', '#' + screen); } catch (e) { w.location.hash = screen; }
    }
    closeDrawer();
    render();
    w.scrollTo(0, 0);
  }

  function setTabs(groupId, attr, val) {
    $(groupId).querySelectorAll('button').forEach(function (x) {
      x.classList.toggle('on', x.getAttribute(attr) === val);
    });
  }

  /** מאפס את מסנני מסך, כדי שמעבר מהמסך הראשי יציג בדיוק את מה שנלחץ */
  function clearFilters(ids) {
    ids.forEach(function (id) { $(id).value = ''; });
  }

  /* ---------- ייצוא ---------- */

  function exportInd() {
    busy(true, LOADING['export']);
    api('export').then(function (r) {
      var txt = JSON.stringify(r.indicators, null, 1);
      var blob = new Blob([txt], { type: 'application/json;charset=utf-8' });
      var a = d.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'indicators.json';
      d.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
      toast('יוצאו ' + r.indicators.length + ' מדדים בפורמט של data.js');
    }).catch(function (e) { toast(e.message, true); }).finally(function () { busy(false); });
  }

  /* ---------- חיווט ---------- */

  function wireInputs(ids, fn) {
    ids.forEach(function (id) {
      $(id).addEventListener('input', fn);
      $(id).addEventListener('change', fn);
    });
  }

  function chip(id, key, fn) {
    $(id).addEventListener('click', function () {
      S[key] = !S[key];
      $(id).classList.toggle('on', S[key]);
      fn();
    });
  }

  function wire() {
    $('gateForm').addEventListener('submit', function (e) {
      e.preventDefault();
      S.who = $('gName').value.trim();
      S.pass = $('gPass').value;
      if (!S.who || !S.pass) return;
      $('gErr').textContent = '';
      $('gBtn').disabled = true;
      bootstrap().then(function () {
        saveAuth();
      }).catch(function (err) {
        $('gErr').textContent = err.message;
      }).finally(function () { $('gBtn').disabled = false; });
    });

    $('screenTabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-s]');
      if (b) go(b.getAttribute('data-s'));
    });

    $('viewTabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]');
      if (!b) return;
      S.view = b.getAttribute('data-v');
      setTabs('viewTabs', 'data-v', S.view);
      render();
    });
    $('potTabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]');
      if (!b) return;
      S.pview = b.getAttribute('data-v');
      setTabs('potTabs', 'data-v', S.pview);
      render();
    });

    /* המסך הראשי: כל מדד-על וכל עמודה מובילים למסך המסונן שמאחוריהם */
    $('scr_home').addEventListener('click', function (e) {
      var k = e.target.closest('[data-go]');
      if (k) {
        var to = k.getAttribute('data-go');
        if (to === 'ind' || to === 'noref') {
          S.view = 'ind';
          setTabs('viewTabs', 'data-v', 'ind');
          clearFilters(['q', 'fTheme', 'fSub', 'fStatus', 'fSource']);
          $('fMap').value = to === 'noref' ? '1' : '';
          S.noRefOnly = to === 'noref';
          S.openOnly = false;
          $('noRefOnly').classList.toggle('on', S.noRefOnly);
          $('openOnly').classList.remove('on');
          go('ind');
        } else if (to === 'pot') {
          S.pview = 'pot';
          setTabs('potTabs', 'data-v', 'pot');
          clearFilters(['pq', 'pTheme', 'pSub', 'pStatus', 'pSource']);
          go('pot');
        } else if (to === 'tsk') {
          /* הערך נקבע אחרי go — רשימת הסטטוסים נבנית רק ברינדור הראשון של המסך */
          clearFilters(['tq', 'tOwner']);
          go('tsk');
          $('tStatus').value = '__open';
          renderTsk();
        }
        return;
      }
      var b = e.target.closest('.mg-bar');
      if (!b) return;
      var val = b.getAttribute('data-val');
      if (b.getAttribute('data-kind') === 'pot') {
        S.pview = 'pot';
        setTabs('potTabs', 'data-v', 'pot');
        clearFilters(['pq', 'pSub', 'pStatus', 'pSource']);
        go('pot');
        if (val === '__none') $('pTheme').insertAdjacentHTML('beforeend', '<option value="__none">ללא נושא</option>');
        $('pTheme').value = val;
        renderPot();
      } else {
        clearFilters(['tq']);
        go('tsk');
        $('tStatus').value = '__open';
        if (val === '__none') $('tOwner').insertAdjacentHTML('beforeend', '<option value="__none">ללא גורם</option>');
        $('tOwner').value = val;
        renderTsk();
      }
    });

    wireInputs(['q', 'fTheme', 'fSub', 'fStatus', 'fSource', 'fMap'], renderInd);
    wireInputs(['cq', 'cStatus', 'cSource'], function () { renderCmt('ind'); });
    wireInputs(['pq', 'pTheme', 'pSub', 'pStatus', 'pSource'], renderPot);
    wireInputs(['pcq', 'pcStatus'], function () { renderCmt('pot'); });
    wireInputs(['tq', 'tStatus', 'tOwner'], renderTsk);

    chip('openOnly', 'openOnly', renderInd);
    chip('noRefOnly', 'noRefOnly', renderInd);
    chip('popenOnly', 'popenOnly', renderPot);
    chip('lateOnly', 'lateOnly', renderTsk);

    ['indBody', 'potBody', 'tskBody'].forEach(function (id) {
      $(id).addEventListener('click', function (e) {
        var tr = e.target.closest('tr[data-id]');
        if (tr) openDrawer(tr.getAttribute('data-kind'), tr.getAttribute('data-id'));
      });
    });

    $('newBtn').addEventListener('click', function () { openDrawer('ind', null); });
    $('newPotBtn').addEventListener('click', function () { openDrawer('pot', null); });
    $('newTskBtn').addEventListener('click', function () { openDrawer('tsk', null); });

    $('reloadBtn').addEventListener('click', function () {
      run('bootstrap', null, 'רוענן').catch(function () {});
    });
    $('exportBtn').addEventListener('click', exportInd);
    $('ingestBtn').addEventListener('click', function () {
      run('ingest', null).then(function (r) {
        var g = r.ingested || {};
        toast('נוספו ' + (g.added || 0) + ' הערות, עודכנו ' + (g.updated || 0));
      }).catch(function () {});
    });

    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.sel !== null) closeDrawer();
    });
    w.addEventListener('hashchange', function () {
      var h = w.location.hash.slice(1);
      if (h !== S.screen) go(h);
    });
  }

  /* ---------- אתחול ---------- */

  wire();
  var start = w.location.hash.slice(1);
  S.screen = SCREENS[start] ? start : 'home';
  render();
  if (loadAuth()) {
    bootstrap().catch(function (err) {
      clearAuth();
      $('gErr').textContent = err.message;
      gate();
    });
  } else {
    gate();
  }

})(window, document);
