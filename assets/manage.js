/* ============================================================
   מצפן רשויות מקומיות — מסך ניהול המדדים

   קורא וכותב אל שלוש הלשוניות שמקים tools/apps-script/Manage.gs:
   «אינדיקטורים», «הערות ודיון» ו«יומן שינויים». הכתובת היא אותה נקודת
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
    ind: [], cmt: [], chg: [], lists: {},
    view: 'ind', sel: null, openOnly: false,
    reply: null      /* מזהה ההערה שתיבת התגובה פתוחה עליה */
  };

  /* השדות בחלונית העריכה, בסדר הצגתם. h = הכותרת בגיליון.
     שדות שאינם כאן (מונה, מכנה, מדד ראשי, סדר, במפה, במיקוד, מחליף/מוחלף) נשארים
     בגיליון ואינם נשלחים בשמירה — כלומר הערך הקיים שלהם נשמר כפי שהוא. */
  var FIELDS = [
    { h: 'מזהה', t: 'text', lock: 1 },
    { h: 'שם המדד', t: 'text', wide: 1 },
    { h: 'שם מקוצר', t: 'text', wide: 1 },
    { h: 'נושא', t: 'list', src: 'themes' },
    { h: 'תת נושא', t: 'list', src: 'subs' },
    { h: 'הסבר על המדד', t: 'area', wide: 1 },
    { h: 'ישות מדידה', t: 'combo', src: 'identity' },
    { h: 'יחידת מידה', t: 'combo', src: 'unit' },
    { h: 'מקור המידע', t: 'combo', src: 'source' },
    { h: 'תדירות', t: 'combo', src: 'freq' },
    { h: 'כיוון רצוי', t: 'sel', opts: [['1', 'ערך גבוה = טוב'], ['0', 'ערך נמוך = טוב']] },
    { h: 'סטטוס', t: 'list', src: 'סטטוס' },
    { h: 'אחראי', t: 'text' },
    { h: 'במפה', t: 'toggle', on: 'מוצג במפת המדידה', off: 'אינו מוצג במפה' }
  ];

  /* מדד חדש נפתח כמוצג במפה — אחרת הוא נשמר ומיד נעלם מאחורי מסנן ברירת המחדל */
  var NEW_DEFAULTS = { 'במפה': '1', 'סטטוס': 'בתהליך פיתוח' };

  var STATUSES = ['פעיל', 'בבחינה', 'בתהליך פיתוח', 'יורד'];

  var TBL_COLS = ['מזהה', 'שם המדד', 'נושא', 'תת נושא', 'מקור המידע', 'תדירות', 'סטטוס', 'במפה'];

  var ST_CLASS = {
    'פעיל': 'st-active', 'בבחינה': 'st-check',
    'בתהליך פיתוח': 'st-new', 'יורד': 'st-down'
  };
  var CMT_CLASS = { 'פתוח': 'open', 'בבדיקה': 'check', 'טופל': 'done', 'נדחה': 'rej' };

  /* ---------- עזרים ---------- */

  function $(id) { return d.getElementById(id); }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
  }

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
    retireIndicator: 'מוריד מדד…',
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

  /** ערכים ייחודיים של שדה, מהגיליון ומ-data.js גם יחד */
  function values(field, extra) {
    var seen = {}, out = [];
    (extra || []).forEach(function (v) { if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
    S.ind.forEach(function (r) {
      var v = String(r[field] || '').trim();
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    });
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

  function suggest(src) {
    if (src === 'themes') return values('נושא', themeNames());
    if (src === 'subs') return values('תת נושא', subNames());
    if (S.lists[src]) return values(src, S.lists[src]);
    var byField = { identity: 'ישות מדידה', unit: 'יחידת מידה', source: 'מקור המידע', freq: 'תדירות' };
    return values(byField[src] || src, []);
  }

  /** ערכי הרשימה הסגורה של שדה — מ-data.js לנושאים, מהשרת לסטטוס */
  function listFor(src) {
    if (src === 'themes') return themeNames();
    if (src === 'subs') return subNames();
    if (src === 'סטטוס') return S.lists['סטטוס'] || STATUSES;
    return [];
  }

  /** תתי הנושאים של נושא נתון. נושא ריק — כל תתי הנושאים. */
  function subsOf(theme) {
    if (!theme) return subNames();
    for (var i = 0; i < DATA_THEMES.length; i++) {
      if (DATA_THEMES[i].name === theme) return (DATA_THEMES[i].subs || []).slice();
    }
    return subNames();
  }

  /** אלמנט של שדה לפי הכותרת שלו */
  function fEl(h) {
    for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].h === h) return $('f_' + i);
    return null;
  }

  /** ממלא select בערכים, ושומר ערך קיים שאינו ברשימה כדי לא לאבד נתון */
  function fillList(sel, list, cur) {
    var opts = ['<option value=""></option>'];
    var seen = false;
    list.forEach(function (v) {
      if (v === cur) seen = true;
      opts.push('<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>');
    });
    if (cur && !seen) opts.push('<option selected>' + esc(cur) + '</option>');
    sel.innerHTML = opts.join('');
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
      if (r.changes) S.chg = r.changes;
      if (r.indicator) mergeInd(r.indicator);
      if (okMsg) toast(okMsg);
      afterData();
      return r;
    }).catch(function (err) {
      toast(err.message, true);
      throw err;
    }).finally(function () { busy(false); });
  }

  /** מחליף מדד יחיד ברשימה בלי טעינה מלאה מחדש */
  function mergeInd(row) {
    for (var i = 0; i < S.ind.length; i++) {
      if (String(S.ind[i]['מזהה']) === String(row['מזהה'])) { S.ind[i] = row; return; }
    }
    S.ind.push(row);
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
    });
  }

  function gate() {
    $('gate').classList.add('on');
    $('gName').value = S.who || '';
    setTimeout(function () { ($('gName').value ? $('gPass') : $('gName')).focus(); }, 40);
  }

  /* ---------- תצוגת המדדים ---------- */

  /** הערות פתוחות של מדד — רק הערות-אם, לא תגובות */
  function openCount(id) {
    var n = 0;
    for (var i = 0; i < S.cmt.length; i++) {
      var c = S.cmt[i];
      if (String(c['מזהה מדד']) !== String(id)) continue;
      if (String(c['בתגובה להערה'] || '').trim()) continue;
      if (String(c['סטטוס טיפול'] || '').trim() === 'פתוח') n++;
    }
    return n;
  }

  /** ערך «במפה» מנורמל: ריק נחשב «לא במפה» */
  function inMap(r) { return String(r['במפה']).trim() === '1' ? '1' : '0'; }

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
    if (q) {
      var hay = (r['מזהה'] + ' ' + r['שם המדד'] + ' ' + r['שם מקוצר'] + ' ' +
                 r['נושא'] + ' ' + r['תת נושא']).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }

  function fillFilter(id, field, label) {
    var sel = $(id), cur = sel.value;
    var opts = ['<option value="">' + esc(label) + '</option>'];
    values(field, field === 'סטטוס' ? (S.lists['סטטוס'] || []) : []).forEach(function (v) {
      opts.push('<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>');
    });
    sel.innerHTML = opts.join('');
  }

  function stPill(v) {
    return '<span class="st ' + (ST_CLASS[v] || 'st-new') + '">' + esc(v || '—') + '</span>';
  }

  function renderInd() {
    $('indHead').innerHTML = '<tr>' +
      TBL_COLS.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '<th>הערות פתוחות</th><th>עודכן</th></tr>';

    var rows = S.ind.filter(matches).sort(function (a, b) {
      return String(a['נושא']).localeCompare(String(b['נושא']), 'he') ||
             String(a['תת נושא']).localeCompare(String(b['תת נושא']), 'he') ||
             String(a['שם המדד']).localeCompare(String(b['שם המדד']), 'he');
    });

    var span = TBL_COLS.length + 2;
    if (!rows.length) {
      $('indBody').innerHTML = '<tr><td colspan="' + span + '" class="empty">אין מדדים תואמים</td></tr>';
      return;
    }

    $('indBody').innerHTML = rows.map(function (r) {
      var n = openCount(r['מזהה']);
      return '<tr data-id="' + esc(r['מזהה']) + '">' +
        '<td class="id">' + esc(r['מזהה']) + '</td>' +
        '<td class="nm">' + esc(r['שם המדד']) +
          (r['שם מקוצר'] && r['שם מקוצר'] !== r['שם המדד']
            ? '<span class="sb">' + esc(r['שם מקוצר']) + '</span>' : '') + '</td>' +
        '<td class="mut">' + esc(r['נושא']) + '</td>' +
        '<td class="mut">' + esc(r['תת נושא']) + '</td>' +
        '<td class="mut">' + esc(r['מקור המידע']) + '</td>' +
        '<td class="mut">' + esc(r['תדירות']) + '</td>' +
        '<td>' + stPill(r['סטטוס']) + '</td>' +
        '<td><span class="mp' + (inMap(r) === '1' ? ' on' : '') + '">' +
          (inMap(r) === '1' ? '1' : '0') + '</span></td>' +
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

  /* ---------- חלונית העריכה ---------- */

  function field(f, val, isNew) {
    var id = 'f_' + FIELDS.indexOf(f);
    var cls = 'mg-f' + (f.wide ? ' wide' : '');
    var head = '<label class="' + cls + '"><span>' + esc(f.h) + '</span>';

    if (f.t === 'area') {
      return head + '<textarea id="' + id + '">' + esc(val) + '</textarea></label>';
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
      var opts = suggest(f.src).map(function (v) { return '<option value="' + esc(v) + '">'; }).join('');
      return head + '<input id="' + id + '" list="' + lid + '" value="' + esc(val) + '">' +
             '<datalist id="' + lid + '">' + opts + '</datalist></label>';
    }
    if (f.lock) {
      return head + '<input id="' + id + '" value="' + esc(val) + '"' +
             (isNew ? ' placeholder="ריק = המספר הפנוי הבא"' : ' readonly class="lock"') + '></label>';
    }
    return head + '<input id="' + id + '" value="' + esc(val) + '"></label>';
  }

  function histOf(id) {
    return S.chg.filter(function (c) {
      return String(c['מזהה מדד']) === String(id) && String(c['סוג פעולה']) !== 'הערה';
    });
  }

  function openDrawer(id) {
    var r = id ? byId(id) : NEW_DEFAULTS;
    S.sel = id || null;
    S.reply = null;

    var isNew = !id;
    var head = isNew ? 'מדד חדש' : esc(r['שם המדד'] || '(ללא שם)');
    var bc = isNew ? 'הוספה' : 'מזהה ' + esc(r['מזהה']) + ' · גרסה ' + esc(r['גרסה'] || '1.0');

    var html =
      '<div class="dh"><div><div class="bc">' + bc + '</div><h3>' + head + '</h3></div>' +
      '<button class="x" type="button" id="dClose" aria-label="סגירה">✕</button></div>' +
      '<div class="db">' +
        '<div class="mg-grid">' +
          FIELDS.map(function (f) { return field(f, r[f.h] || '', isNew); }).join('') +
          '<label class="mg-f wide req"><span>סיבת השינוי — נרשמת ביומן</span>' +
          '<input id="f_reason" placeholder="למשל: אוחד עם מדד 1042 בעקבות הערות הסדנה"></label>' +
        '</div>';

    if (!isNew) {
      html += '<div class="msec" id="dThread"><h4>הערות ודיון</h4>' +
                threadHtml(r['מזהה'], r['שם המדד']) + '</div>' +
              '<div class="msec"><h4>היסטוריית שינויים</h4>' + histHtml(histOf(r['מזהה'])) + '</div>';
    }

    html += '</div><div class="df">' +
      '<button class="btn-primary" type="button" id="dSave">' + (isNew ? 'הוספת מדד' : 'שמירה') + '</button>' +
      (isNew ? '' : '<button class="btn-ghost" type="button" id="dRetire">הורדת מדד</button>') +
      '<span class="sp"></span><button class="btn-ghost" type="button" id="dCancel">סגירה</button></div>';

    var dr = $('drawer');
    dr.innerHTML = html;
    dr.classList.add('on');

    FIELDS.forEach(function (f) {
      if (f.t === 'list' && f.src !== 'subs') fillList(fEl(f.h), listFor(f.src), r[f.h] || '');
    });

    FIELDS.forEach(function (f) {
      if (f.t !== 'toggle') return;
      var b = fEl(f.h);
      if (!b) return;
      b.addEventListener('click', function () {
        var next = b.getAttribute('data-v') === '1' ? '0' : '1';
        b.setAttribute('data-v', next);
        b.setAttribute('aria-pressed', next === '1');
        b.classList.toggle('on', next === '1');
        b.querySelector('.tx').textContent = next === '1' ? f.on : f.off;
      });
    });

    /* «תת נושא» נגזר מהנושא שנבחר, כדי שלא ייווצר צירוף שאינו קיים בעץ */
    var th = fEl('נושא'), sb = fEl('תת נושא');
    if (th && sb) {
      fillList(sb, subsOf(th.value), r['תת נושא'] || '');
      th.addEventListener('change', function () { fillList(sb, subsOf(th.value), ''); });
    }

    $('dClose').addEventListener('click', closeDrawer);
    $('dCancel').addEventListener('click', closeDrawer);
    $('dSave').addEventListener('click', function () { saveDrawer(isNew ? '' : r['מזהה']); });
    if (!isNew) {
      $('dRetire').addEventListener('click', function () { retire(r); });
      bindThread($('dThread'), r['מזהה'], r['שם המדד'], refreshThread);
    }
  }

  /**
   * בונה מחדש רק את מקטע ההערות שבחלונית. הטופס עצמו אינו נוגע — אחרת כל
   * תגובה או שינוי סטטוס היו מוחקים שדות שהמשתמש כבר הקליד ולא שמר.
   */
  function refreshThread() {
    var box = $('dThread');
    if (!box || !S.sel) return;
    var r = byId(S.sel) || {};
    box.innerHTML = '<h4>הערות ודיון</h4>' + threadHtml(S.sel, r['שם המדד']);
    bindThread(box, S.sel, r['שם המדד'], refreshThread);
  }

  /** אחרי כל שינוי נתונים: הטבלאות נבנות מחדש, והחלונית מתעדכנת בהערות בלבד */
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

  function byId(id) {
    for (var i = 0; i < S.ind.length; i++) {
      if (String(S.ind[i]['מזהה']) === String(id)) return S.ind[i];
    }
    return null;
  }

  function saveDrawer(id) {
    var data = {};
    FIELDS.forEach(function (f) {
      var el = $('f_' + FIELDS.indexOf(f));
      if (!el) return;
      data[f.h] = (f.t === 'toggle') ? el.getAttribute('data-v') : el.value.trim();
    });
    if (id) data['מזהה'] = id;
    var reason = $('f_reason').value.trim();
    if (!String(data['שם המדד'] || '').trim()) return toast('שם המדד חסר', true);
    if (!reason) return toast('מלאו את סיבת השינוי — היא נרשמת ביומן', true);

    run('saveIndicator', { indicator: data, reason: reason }, 'נשמר').then(function (r) {
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

  /* ---------- הערות ---------- */

  function roots(id) {
    return S.cmt.filter(function (c) {
      return String(c['מזהה מדד']) === String(id) && !String(c['בתגובה להערה'] || '').trim();
    });
  }
  function repliesOf(cid) {
    return S.cmt.filter(function (c) {
      return String(c['בתגובה להערה'] || '').trim() === String(cid);
    });
  }

  function cmtCard(c, isReply) {
    var st = String(c['סטטוס טיפול'] || '').trim();
    var cls = 'cmt ' + (isReply ? 'reply' : (CMT_CLASS[st] || ''));
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

    if (!isReply) {
      h += '<div class="acts">' +
        '<select class="cst" data-cid="' + esc(c['מזהה הערה']) + '">' +
        (S.lists['סטטוס טיפול'] || ['פתוח', 'בבדיקה', 'טופל', 'נדחה']).map(function (v) {
          return '<option' + (v === st ? ' selected' : '') + '>' + esc(v) + '</option>';
        }).join('') + '</select>' +
        '<input class="cdec" data-cid="' + esc(c['מזהה הערה']) + '" placeholder="החלטה / פתרון" ' +
        'value="' + esc(c['החלטה/פתרון'] || '') + '">' +
        '<button type="button" class="csave" data-cid="' + esc(c['מזהה הערה']) + '">עדכון</button>' +
        '<button type="button" class="creply" data-cid="' + esc(c['מזהה הערה']) + '">תגובה</button>' +
        '</div>';

      if (S.reply === String(c['מזהה הערה'])) {
        h += '<div class="newcmt reply-box">' +
          '<textarea id="replyTx" placeholder="תגובה להערה…"></textarea>' +
          '<div class="row"><button class="btn-primary" type="button" id="replySend">שליחה</button>' +
          '<button class="btn-ghost" type="button" id="replyCancel">ביטול</button></div></div>';
      }
    }
    return h + '</div>';
  }

  function threadHtml(id, name) {
    var rs = roots(id);
    var h = '';
    if (!rs.length) h += '<p class="mg-note">אין עדיין הערות על המדד הזה.</p>';
    rs.forEach(function (c) {
      h += cmtCard(c, false);
      repliesOf(c['מזהה הערה']).forEach(function (rp) { h += cmtCard(rp, true); });
    });
    h += '<div class="newcmt new-box">' +
      '<textarea id="newTx" placeholder="הערה חדשה על המדד…"></textarea>' +
      '<div class="row"><select class="fsel" id="newKind">' +
      (S.lists['סוג הערה'] || ['כללי']).map(function (v) {
        return '<option' + (v === 'כללי' ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('') + '</select>' +
      '<button class="btn-primary" type="button" id="newSend">הוספת הערה</button></div></div>';
    return h;
  }

  /** מחבר את כפתורי ההערות בתוך אלמנט נתון (החלונית או מסך ההערות) */
  function bindThread(root, id, name, refresh) {
    root.querySelectorAll('.csave').forEach(function (b) {
      b.addEventListener('click', function () {
        var cid = b.getAttribute('data-cid');
        var st = root.querySelector('.cst[data-cid="' + cid + '"]').value;
        var dec = root.querySelector('.cdec[data-cid="' + cid + '"]').value.trim();
        run('updateComment', { id: cid, patch: { 'סטטוס טיפול': st, 'החלטה/פתרון': dec } },
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

    var send = root.querySelector('#replySend');
    if (send) {
      send.addEventListener('click', function () {
        var tx = root.querySelector('#replyTx').value.trim();
        if (!tx) return toast('התגובה ריקה', true);
        var parent = S.reply;
        var src = cmtById(parent) || {};
        S.reply = null;
        run('addComment', {
          comment: {
            'מזהה מדד': src['מזהה מדד'] || id || '',
            'שם המדד': src['שם המדד'] || name || '',
            'תוכן ההערה': tx, 'בתגובה להערה': parent, 'סוג הערה': 'תגובה'
          }
        }, 'התגובה נוספה').catch(function () {});
      });
      root.querySelector('#replyCancel').addEventListener('click', function () {
        S.reply = null;
        refresh();
      });
      root.querySelector('#replyTx').focus();
    }

    var add = root.querySelector('#newSend');
    if (add) {
      add.addEventListener('click', function () {
        var tx = root.querySelector('#newTx').value.trim();
        if (!tx) return toast('ההערה ריקה', true);
        run('addComment', {
          comment: {
            'מזהה מדד': id || '', 'שם המדד': name || '',
            'תוכן ההערה': tx, 'סוג הערה': root.querySelector('#newKind').value
          }
        }, 'ההערה נוספה').catch(function () {});
      });
    }
  }

  function cmtById(cid) {
    for (var i = 0; i < S.cmt.length; i++) {
      if (String(S.cmt[i]['מזהה הערה']) === String(cid)) return S.cmt[i];
    }
    return null;
  }

  /* ---------- מסך ההערות ---------- */

  function cmtMatches(c) {
    var q = $('cq').value.trim().toLowerCase();
    var st = $('cStatus').value, src = $('cSource').value;
    if (st && String(c['סטטוס טיפול'] || '') !== st) return false;
    if (src && String(c['מקור'] || '') !== src) return false;
    if (q) {
      var hay = (c['תוכן ההערה'] + ' ' + c['שם המדד'] + ' ' + c['ממי התקבל'] + ' ' +
                 c['מזהה מדד']).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }

  function renderCmt() {
    fillSel('cStatus', 'כל הסטטוסים', S.lists['סטטוס טיפול'] || []);
    fillSel('cSource', 'כל המקורות', ['סדנה', 'ידני']);

    var open = S.cmt.filter(function (c) {
      return !String(c['בתגובה להערה'] || '').trim() && String(c['סטטוס טיפול']) === 'פתוח';
    }).length;
    $('cmtNote').innerHTML = 'סך הכול <b>' + S.cmt.length + '</b> הערות, מתוכן <b>' + open +
      '</b> פתוחות. הערות המשתתפים נמשכות מלשוניות הסדנה בכל טעינה של המסך.';

    /* קיבוץ לפי מדד; הערות בלי שיוך למדד — בקבוצה אחת בסוף */
    var groups = {}, order = [];
    S.cmt.forEach(function (c) {
      if (String(c['בתגובה להערה'] || '').trim()) return;   /* תגובות נתלות בהערת-האם */
      if (!cmtMatches(c)) return;
      var k = String(c['מזהה מדד'] || '');
      if (!groups[k]) { groups[k] = { name: c['שם המדד'] || '', items: [] }; order.push(k); }
      groups[k].items.push(c);
    });

    order.sort(function (a, b) { return (a === '' ? 1 : 0) - (b === '' ? 1 : 0); });

    if (!order.length) {
      $('cmtList').innerHTML = '<div class="empty">אין הערות תואמות</div>';
      return;
    }

    $('cmtList').innerHTML = order.map(function (k) {
      var g = groups[k];
      var title = k ? (byId(k) ? byId(k)['שם המדד'] : g.name) : 'הערות כלליות מהסדנה';
      var h = '<div class="thread"><div class="th">' +
        (k ? '<a data-open="' + esc(k) + '">' + esc(title) + '</a><span class="id">' + esc(k) + '</span>'
           : '<span>' + esc(title) + '</span>') +
        '<span class="id">' + g.items.length + ' הערות</span></div>';
      g.items.forEach(function (c) {
        h += cmtCard(c, false);
        repliesOf(c['מזהה הערה']).forEach(function (rp) { h += cmtCard(rp, true); });
      });
      return h + '</div>';
    }).join('');

    bindThread($('cmtList'), '', '', renderCmt);
    $('cmtList').querySelectorAll('[data-open]').forEach(function (a) {
      a.addEventListener('click', function () { openDrawer(a.getAttribute('data-open')); });
    });
  }

  function fillSel(id, label, list) {
    var sel = $(id), cur = sel.value;
    sel.innerHTML = '<option value="">' + esc(label) + '</option>' +
      list.map(function (v) {
        return '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>';
      }).join('');
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
        '<td class="mut">' + esc(c['ערך קודם']) + '</td>' +
        '<td>' + esc(c['ערך חדש']) + '</td>' +
        '<td class="mut">' + esc(c['סיבה']) + '</td></tr>';
    }).join('');
  }

  /* ---------- רינדור ראשי ---------- */

  function render() {
    $('cInd').textContent = S.ind.length || '';
    $('cCmt').textContent = S.cmt.length || '';
    $('cChg').textContent = S.chg.length || '';

    $('viewInd').hidden = S.view !== 'ind';
    $('viewCmt').hidden = S.view !== 'cmt';
    $('viewChg').hidden = S.view !== 'chg';

    if (S.view === 'ind') {
      renderSeed();
      fillFilter('fTheme', 'נושא', 'כל הנושאים');
      fillFilter('fSub', 'תת נושא', 'כל תתי הנושאים');
      fillFilter('fStatus', 'סטטוס', 'כל הסטטוסים');
      fillFilter('fSource', 'מקור המידע', 'כל המקורות');
      renderInd();
    } else {
      $('seedBox').innerHTML = '';
    }
    if (S.view === 'cmt') renderCmt();
    if (S.view === 'chg') renderChg();
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

    $('viewTabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]');
      if (!b) return;
      S.view = b.getAttribute('data-v');
      $('viewTabs').querySelectorAll('button').forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
      render();
    });

    ['q', 'fTheme', 'fSub', 'fStatus', 'fSource', 'fMap'].forEach(function (id) {
      $(id).addEventListener('input', renderInd);
      $(id).addEventListener('change', renderInd);
    });
    ['cq', 'cStatus', 'cSource'].forEach(function (id) {
      $(id).addEventListener('input', renderCmt);
      $(id).addEventListener('change', renderCmt);
    });

    $('openOnly').addEventListener('click', function () {
      S.openOnly = !S.openOnly;
      $('openOnly').classList.toggle('on', S.openOnly);
      renderInd();
    });

    $('indBody').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-id]');
      if (tr) openDrawer(tr.getAttribute('data-id'));
    });

    $('newBtn').addEventListener('click', function () { openDrawer(null); });
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
  }

  /* ---------- אתחול ---------- */

  wire();
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
