/* ============================================================
   מצפן רשויות מקומיות — כלי עזר לסדנה (משימה 2)
   דשבורד Power BI Report Server + שאלות מכווינות לכל מסך.
   התשובות נשמרות בדפדפן וניתנות לייצוא ל-CSV.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- הגדרות ---------- */
  /* כתובת הדשבורד ב-Report Server. rs:Embed=true פותח אותו במצב הטמעה (ללא תפריטי הפורטל). */
  /* בדוח Power BI ב-Report Server הפרמטר הוא rs:embed באותיות קטנות
     (rs:Embed בגדולה שייך לדוחות מעומדים/RDL ולא פותח דוח PBIX במצב הטמעה). */
  var DASH_PATH = '//biportal/Reports/powerbi/BokerTovManager/Gap_Analyzer_Mashah?rs:embed=true';

  /* כתובת חסרת פרוטוקול: ההטמעה נטענת תמיד באותו פרוטוקול של הדף.
     דף HTTP → הדשבורד ב-HTTP; דף HTTPS → נסיון ב-HTTPS, כי דפדפן לא מתיר
     להטמיע HTTP בתוך דף HTTPS. הקישור לפתיחה בלשונית נפרדת נשאר HTTP,
     שם אין מגבלה כזו. */
  var DASH_URL = DASH_PATH;
  var DASH_HTTP = 'http:' + DASH_PATH;

  /* יעד לאיסוף התשובות (POST עם גוף JSON). ריק = שמירה מקומית בלבד. */
  var SUBMIT_URL = '';
  var STORE_KEY = 'kyd_molsa_workshop_v1';
  var USER_KEY = 'kyd_molsa_compass_v1';   /* הזדהות משותפת עם מסך תפיסת המדידה */

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

  /* ---------- מאגר הפעולות המשלימות (חוזר בשני מסכים) ---------- */
  var ACTIONS = [
    'שיחה עם מפקח',
    'שיחה עם המש"ח',
    'העמקה במדדים נוספים',
    'העמקה במאפיינים הספציפיים של כל רשות',
    'העמקה במקורות נתונים / דשבורדים נוספים של המשרד'
  ];

  /* ---------- שאלות לפי מסכי הדשבורד ---------- */
  var SCREENS = [
    {
      id: 'map',
      name: 'מפת מדדים רשותית',
      qs: [
        { id: 'm1', t: 'איפה זה משתלב בתהליכי העבודה שלך?', type: 'multi', other: true,
          hint: 'אפשר לסמן יותר מאפשרות אחת',
          opts: ['ישיבת מנהלי נפות', 'ישיבת מפקחים', 'פורום עם מנהלי מחוז'] },
        { id: 'm2', t: 'מה אפשר ללמוד על הרשויות בנפה בנושא משאבי אנוש?', type: 'text',
          ph: 'מה עולה מהמפה בנושא כוח אדם, איוש תקנים, תחלופה…' },
        { id: 'm3', t: 'מה פעולות ההמשך שצריך לעשות כדי להשלים את הבנת המצב?', type: 'multi', other: true,
          opts: ACTIONS },
        { id: 'm4', t: 'מהי צורת המדידה של כל רשות שמלמדת אותך בצורה הטובה ביותר?', type: 'single', other: true,
          opts: ['ביחס לכלל הרשויות בארץ', 'ביחס לרשויות בקבוצת הדומים',
                 'ביחס לקבוצת דומים אבל רלוונטית יותר', 'ביחס לרשות עצמה בשנה האחרונה'] },
        { id: 'm5', t: 'האם יש רשות שאתה רוצה להעמיק בה?', type: 'text',
          hint: 'שאלה לקראת המסך הבא — דוח רשות', ph: 'שם הרשות, ולמה דווקא היא' }
      ]
    },
    {
      id: 'report',
      name: 'דוח רשות',
      qs: [
        { id: 'r1', t: 'מה אפשר ללמוד על הרשות?', type: 'text',
          ph: 'התמונה שעולה מדוח הרשות' },
        { id: 'r2', t: 'האם הנושאים שהרשות חזקה או חלשה בהם מתאימים למה שאתה יודע על הרשות?', type: 'themes',
          hint: 'סמנו כן / לא לכל אחד מנושאי המדידה' },
        { id: 'r3', t: 'באיזו תצורה חשוב לכם לראות את המגמה ההיסטורית כדי ללמוד על האינדיקטורים?', type: 'single',
          opts: ['חודשית בשנה האחרונה', 'רבעונית בשנתיים האחרונות', 'שנתית בחמש השנים האחרונות'] },
        { id: 'r4', t: 'אילו נתונים היית מוסיף לתעודת הזהות הרשותית?', type: 'text',
          ph: 'נתוני רקע, מאפייני אוכלוסייה, תקציב…' },
        { id: 'r5', t: 'אילו פעולות משלימות אתה צריך לעשות?', type: 'multi', other: true,
          opts: ACTIONS },
        { id: 'r6', t: 'איזה מדד שבחנת מעניין אותך להבין באופן מעמיק יותר ובצורה רוחבית?', type: 'text',
          hint: 'שאלה לקראת המסך הבא — Data Explorer', ph: 'שם המדד' }
      ]
    },
    {
      id: 'explorer',
      name: 'Data Explorer',
      qs: [
        { id: 'e1', t: 'איזה פילוח גורם לך להבין את המדד בצורה הטובה ביותר?', type: 'single',
          opts: ['ארצי', 'לפי אשכול חברתי-כלכלי', 'לפי אשכול פריפריאלי',
                 'לפי נפות', 'לפי מחוזות', 'לפי רשויות'] },
        { id: 'e2', t: 'מה חסר לך כדי להבין את המדד בצורה טובה יותר?', type: 'text',
          ph: 'פילוחים, נתוני רקע, הגדרות, השוואות…' },
        { id: 'e3', t: 'לאחר שהבנת את המדד — לאיזה מסך ולאיזו רשות היית חוזר כדי להבין טוב יותר את הפעילות בה?', type: 'text',
          ph: 'המסך, הרשות, ומה היית בודק שם' }
      ]
    }
  ];

  /* נושאי המדידה לשאלת ה"כן / לא" — מגיעים משכבת הנתונים */
  function themeNames() {
    if (typeof THEMES !== 'undefined' && THEMES && THEMES.length) {
      return THEMES.map(function (t) { return t.name; });
    }
    return [];
  }

  /* ---------- אחסון ---------- */
  var store = loadStore();
  var user = loadUser();
  var cur = 0;

  function loadStore() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && s.ans) return s;
    } catch (e) {}
    return { ans: {} };
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}
  }
  function loadUser() {
    try {
      var s = JSON.parse(localStorage.getItem(USER_KEY));
      if (s && s.user) return s.user;
    } catch (e) {}
    return null;
  }
  function ansOf(qid) { return store.ans[qid] || null; }
  function setAns(qid, patch) {
    var a = store.ans[qid] || { v: null, other: '' };
    for (var k in patch) a[k] = patch[k];
    a.ts = new Date().toISOString();
    store.ans[qid] = a;
    saveStore();
    submitAns(qid, a);
  }
  function submitAns(qid, a) {
    if (!SUBMIT_URL || !window.fetch) return;
    var f = findQ(qid);
    try {
      fetch(SUBMIT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: (user && user.name) || '', district: (user && user.district) || '',
          screen: f.screen, qid: qid, question: f.q.t,
          answer: a.v, other: a.other || '', ts: a.ts
        })
      }).catch(function () {});
    } catch (e) {}
  }
  function findQ(qid) {
    for (var i = 0; i < SCREENS.length; i++) {
      for (var j = 0; j < SCREENS[i].qs.length; j++) {
        if (SCREENS[i].qs[j].id === qid) return { screen: SCREENS[i].name, q: SCREENS[i].qs[j] };
      }
    }
    return { screen: '', q: {} };
  }

  /* ---------- מצב מענה ---------- */
  function answered(q) {
    var a = ansOf(q.id);
    if (!a) return false;
    if (q.type === 'text') return !!String(a.v || '').trim();
    if (q.type === 'multi') return !!(a.v && a.v.length);
    if (q.type === 'themes') {
      var names = themeNames(), o = a.v || {}, n = 0;
      names.forEach(function (t) { if (o[t]) n++; });
      return names.length > 0 && n === names.length;
    }
    return !!a.v;
  }
  function hasOther(q) {
    var a = ansOf(q.id);
    if (!a || !q.other) return false;
    if (q.type === 'multi') return !!(a.v && a.v.indexOf('אחר') >= 0);
    return a.v === 'אחר';
  }

  /* ---------- בניית השאלות ---------- */
  function qHtml(q, i) {
    var a = ansOf(q.id) || {}, o = [];
    o.push('<div class="qz' + (answered(q) ? ' done' : '') + '" data-qz="' + q.id + '">');
    o.push('<div class="qt"><span class="ix">' + (i + 1) + '</span><span>' + esc(q.t) + '</span></div>');
    if (q.hint) o.push('<div class="qh">' + esc(q.hint) + '</div>');

    if (q.type === 'text') {
      o.push('<textarea data-q="' + q.id + '" data-role="text" rows="3" placeholder="' +
        esc(q.ph || 'כתבו כאן…') + '">' + esc(a.v || '') + '</textarea>');

    } else if (q.type === 'themes') {
      var names = themeNames(), map = a.v || {};
      if (!names.length) {
        o.push('<div class="qh">לא נטענה רשימת הנושאים.</div>');
      } else {
        o.push('<div class="yn">');
        names.forEach(function (t, k) {
          var nm = 'th_' + q.id + '_' + k;
          o.push('<div class="ynr"><span class="ynn">' + esc(t) + '</span><span class="ynb">' +
            '<label><input type="radio" name="' + nm + '" data-q="' + q.id + '" data-role="theme" data-theme="' +
              esc(t) + '" value="כן"' + (map[t] === 'כן' ? ' checked' : '') + '><span>כן</span></label>' +
            '<label><input type="radio" name="' + nm + '" data-q="' + q.id + '" data-role="theme" data-theme="' +
              esc(t) + '" value="לא"' + (map[t] === 'לא' ? ' checked' : '') + '><span>לא</span></label>' +
            '</span></div>');
        });
        o.push('</div>');
      }

    } else {
      var multi = q.type === 'multi';
      var opts = q.opts.slice();
      if (q.other) opts.push('אחר');
      o.push('<div class="opts">');
      opts.forEach(function (op) {
        var on = multi ? !!(a.v && a.v.indexOf(op) >= 0) : a.v === op;
        o.push('<label class="op' + (on ? ' on' : '') + '">' +
          '<input type="' + (multi ? 'checkbox' : 'radio') + '" name="q_' + q.id + '"' +
          ' data-q="' + q.id + '" data-role="' + (multi ? 'multi' : 'single') + '"' +
          ' value="' + esc(op) + '"' + (on ? ' checked' : '') + '>' +
          '<span>' + esc(op) + '</span></label>');
      });
      o.push('</div>');
      if (q.other) {
        o.push('<input class="oth" type="text" data-q="' + q.id + '" data-role="othertext"' +
          ' placeholder="פרטו…" value="' + esc(a.other || '') + '"' +
          (hasOther(q) ? '' : ' hidden') + '>');
      }
    }
    o.push('</div>');
    return o.join('');
  }

  function renderScreen(i, note) {
    cur = i;
    var sc = SCREENS[i];

    Array.prototype.forEach.call($('#steps').children, function (b, k) {
      b.classList.toggle('on', k === i);
      b.setAttribute('aria-pressed', String(k === i));
    });

    var bd = $('#qbody'), h = [];
    if (note) {
      h.push('<div class="remind" id="remind">' +
        '<span class="ic" aria-hidden="true">!</span>' +
        '<span>עברתם לשאלות של «' + esc(sc.name) + '». <b>החליפו גם בתוך הדשבורד</b> ' +
        'למסך «' + esc(sc.name) + '» — המעבר בין מסכי הדשבורד נעשה בדשבורד עצמו.</span>' +
        '<button type="button" class="x" id="remindX" aria-label="סגירת התזכורת">✕</button></div>');
    }
    h.push('<div class="scname">' + esc(sc.name) + '</div>');
    sc.qs.forEach(function (q, k) { h.push(qHtml(q, k)); });

    h.push('<div class="qnav">');
    if (i < SCREENS.length - 1) {
      h.push('<button type="button" class="btn-primary nx" id="nextScr">המשך למסך «' +
        esc(SCREENS[i + 1].name) + '»</button>');
      h.push('<div class="nh">לאחר המעבר — החליפו גם את המסך בתוך הדשבורד</div>');
    } else {
      h.push('<button type="button" class="btn-primary nx" id="doneBtn">סיום · ייצוא התשובות</button>');
      h.push('<div class="nh">זהו המסך האחרון. אפשר לחזור אחורה בכל שלב.</div>');
    }
    h.push('</div>');

    bd.innerHTML = h.join('');
    bd.scrollTop = 0;

    if (note) {
      $('#remindX').addEventListener('click', function () {
        var r = $('#remind'); if (r) r.remove();
      });
    }
    var nb = $('#nextScr');
    if (nb) nb.addEventListener('click', function () { renderScreen(cur + 1, true); });
    var db = $('#doneBtn');
    if (db) db.addEventListener('click', exportCsv);

    updateProgress();
  }

  function updateProgress() {
    var sc = SCREENS[cur], n = 0;
    sc.qs.forEach(function (q) { if (answered(q)) n++; });
    $('#prog').textContent = n + '/' + sc.qs.length;
    Array.prototype.forEach.call($('#steps').children, function (b, k) {
      var m = 0;
      SCREENS[k].qs.forEach(function (q) { if (answered(q)) m++; });
      b.classList.toggle('full', m === SCREENS[k].qs.length);
    });
  }

  function syncQz(qid) {
    var q = findQ(qid).q;
    var zone = document.querySelector('[data-qz="' + qid + '"]');
    if (!zone) return;
    zone.classList.toggle('done', answered(q));
    var oth = zone.querySelector('.oth');
    if (oth) oth.hidden = !hasOther(q);
    Array.prototype.forEach.call(zone.querySelectorAll('.op'), function (lb) {
      lb.classList.toggle('on', lb.querySelector('input').checked);
    });
  }

  /* ---------- זיהוי המשתמש (משותף עם מסך תפיסת המדידה) ---------- */
  function saveUser() {
    try {
      var s = JSON.parse(localStorage.getItem(USER_KEY)) || {};
      if (!s.ratings) s.ratings = {};
      if (!s.subvotes) s.subvotes = {};
      s.user = user;
      localStorage.setItem(USER_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  function districts() {
    if (typeof SCOPES === 'undefined' || !SCOPES) return [];
    var nat = (typeof META !== 'undefined' && META && META.national) || 'ארצי';
    return SCOPES.filter(function (s) { return s !== nat; });
  }

  function renderUserBar() {
    var w = $('#navUser');
    if (!user) { w.innerHTML = ''; return; }
    w.innerHTML = '<span class="nm">' + esc(user.name) + '</span>' +
      (user.district ? '<span class="dv">· נפת ' + esc(user.district) + '</span>' : '') +
      '<button type="button" id="switchUser">החלפת משתמש</button>';
    $('#switchUser').addEventListener('click', function () { openGate(); });
  }

  function openGate() {
    var sel = $('#gDistrict');
    sel.innerHTML = '<option value="">— ללא שיוך —</option>';
    districts().forEach(function (d) {
      var o = document.createElement('option');
      o.value = d; o.textContent = 'נפת ' + d;
      sel.appendChild(o);
    });
    if (user) {
      $('#gName').value = user.name || '';
      sel.value = user.district || '';
    }
    $('#gate').classList.add('on');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { $('#gName').focus(); }, 60);
  }

  function submitGate(e) {
    e.preventDefault();
    var name = $('#gName').value.trim();
    if (!name) return;
    user = {
      name: name, district: $('#gDistrict').value,
      since: (user && user.since) || new Date().toISOString()
    };
    saveUser();
    $('#gate').classList.remove('on');
    document.body.style.overflow = '';
    renderUserBar();
  }

  /* ---------- ייצוא ---------- */
  function exportCsv() {
    if (!Object.keys(store.ans).length) { alert('טרם נרשמו תשובות.'); return; }
    var BOM = String.fromCharCode(0xFEFF), CRLF = String.fromCharCode(13, 10);
    var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var uName = (user && user.name) || '', uDist = (user && user.district) || '';

    var rows = [['שם המשתמש', 'נפה', 'מסך', 'מזהה שאלה', 'שאלה', 'נושא',
      'תשובה', 'פירוט (אחר)', 'עודכן'].map(q).join(',')];

    SCREENS.forEach(function (sc) {
      sc.qs.forEach(function (qq) {
        var a = ansOf(qq.id);
        if (!a) return;
        if (qq.type === 'themes') {
          var map = a.v || {};
          themeNames().forEach(function (t) {
            if (!map[t]) return;
            rows.push([uName, uDist, sc.name, qq.id, qq.t, t, map[t], '', a.ts || ''].map(q).join(','));
          });
        } else {
          var v = qq.type === 'multi' ? (a.v || []).join(' | ') : (a.v || '');
          if (!String(v).trim() && !String(a.other || '').trim()) return;
          rows.push([uName, uDist, sc.name, qq.id, qq.t, '', v, a.other || '', a.ts || ''].map(q).join(','));
        }
      });
    });

    var blob = new Blob([BOM + rows.join(CRLF)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'תשובות סדנה - ' + (uName || 'משתמש') + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- הדשבורד: הטמעה, ואם היא נחסמת — עבודה בשני חלונות ----------
     דף HTTPS לא רשאי להטמיע מסגרת HTTP, ואין הגדרה בשרת שמבטלת זאת. לעומת זאת
     פתיחת חלון נפרד ב-HTTP מותרת תמיד — ולכן זו דרך העקיפה שעובדת מכל מקום. */
  var dashWin = null, dashTimer = null, watchTimer = null;

  function dashOpen() { return !!(dashWin && !dashWin.closed); }

  function openDashWindow() {
    var w = Math.max(880, Math.round(screen.availWidth * 0.58));
    var h = Math.max(600, screen.availHeight - 60);
    dashWin = window.open(DASH_HTTP, 'gapAnalyzer',
      'width=' + w + ',height=' + h + ',left=0,top=0,resizable=yes,scrollbars=yes');
    if (!dashWin) {
      $('#winBody').innerHTML = '<b>הדפדפן חסם את פתיחת החלון.</b> אשרו את פתיחת החלונות ' +
        'הקופצים לאתר הזה ונסו שוב, או פתחו את הדשבורד בלשונית רגילה בקישור שלמטה.';
      return;
    }
    dashWin.focus();
    store.winMode = true; saveStore();
    applyDashMode();
    clearInterval(watchTimer);
    watchTimer = setInterval(function () {
      if (!dashOpen()) { clearInterval(watchTimer); applyDashMode(); }
    }, 1500);
  }

  /* חזרה מהמצב של שני החלונות להטמעה בתוך הדף */
  function backToFrame() {
    store.winMode = false; saveStore();
    if (dashOpen()) dashWin.close();
    clearInterval(watchTimer);
    applyDashMode();
  }

  function applyDashMode() {
    var main = document.querySelector('main.ws'), f = $('#dashFrame');
    var win = store.winMode === true, opened = dashOpen();

    main.classList.toggle('wmode', win);
    main.classList.toggle('opened', win && opened);
    $('#winBar').hidden = !(win && opened);
    $('#winPanel').hidden = !(win && !opened);

    if (win) {
      f.hidden = true;
      if (f.getAttribute('src')) f.setAttribute('src', 'about:blank');
      clearTimeout(dashTimer);
      $('#slow').hidden = true;
      $('#winHead').textContent = 'הדשבורד עובד בחלון נפרד';
      $('#winEmbed').hidden = location.protocol === 'https:';
      if (!$('#winBody').innerHTML) setWinBody();
    } else {
      loadFrame();
    }
  }

  function setWinBody() {
    $('#winBody').innerHTML = location.protocol === 'https:'
      ? 'הדף מוגש ב-HTTPS והדשבורד ב-HTTP, ולכן הדפדפן חוסם את הטמעתו במסגרת. ' +
        'פתיחה בחלון נפרד אינה כפופה למגבלה הזו — השאלות יישארו כאן, בחלון שלצדו.'
      : 'הדשבורד לא נטען בתוך המסגרת. אפשר לעבוד בשני חלונות: הדשבורד בחלון אחד, השאלות בשני.';
  }

  function loadFrame() {
    var f = $('#dashFrame');
    f.hidden = false;
    f.src = DASH_URL;
    $('#winPanel').hidden = true;
    $('#slow').hidden = true;
    clearTimeout(dashTimer);
    /* אם המסגרת לא נטענה — מציעים את מצב שני החלונות */
    dashTimer = setTimeout(function () {
      setWinBody();
      $('#winHead').textContent = 'הדשבורד לא נטען במסגרת';
      $('#winPanel').hidden = false;
    }, location.protocol === 'https:' ? 6000 : 14000);
  }

  function setupDash() {
    var f = $('#dashFrame');
    $('#dashOpen').href = DASH_HTTP;
    $('#pendOpen').href = DASH_HTTP;
    $('#dashUrl').textContent = DASH_HTTP;

    f.addEventListener('load', function () {
      clearTimeout(dashTimer);
      if (store.winMode !== true) { $('#winPanel').hidden = true; $('#slow').hidden = true; }
    });

    $('#winOpen').addEventListener('click', openDashWindow);
    $('#winEmbed').addEventListener('click', backToFrame);
    $('#winDismiss').addEventListener('click', function () {
      $('#winPanel').hidden = true;
      $('#slow').hidden = false;
    });
    $('#winFocus').addEventListener('click', function () {
      if (dashOpen()) dashWin.focus(); else openDashWindow();
    });
    $('#winReload').addEventListener('click', function () {
      if (dashOpen()) { dashWin.location.href = DASH_HTTP; dashWin.focus(); }
      else openDashWindow();
    });
    $('#winBack').addEventListener('click', backToFrame);
    $('#dashReload').addEventListener('click', function () {
      if (store.winMode === true) { openDashWindow(); return; }
      loadFrame();
    });

    applyDashMode();
  }

  /* ---------- אתחול ---------- */
  function init() {
    setupDash();

    var st = $('#steps');
    SCREENS.forEach(function (sc, i) {
      var b = el('button', 'step',
        '<span class="k">' + (i + 1) + '</span><span class="nm">' + esc(sc.name) + '</span>');
      b.type = 'button';
      b.addEventListener('click', function () { renderScreen(i, i !== cur); });
      st.appendChild(b);
    });

    renderUserBar();
    $('#gateForm').addEventListener('submit', submitGate);
    if (!user) openGate();

    $('#wsExport').addEventListener('click', exportCsv);

    var bd = $('#qbody');
    bd.addEventListener('change', function (e) {
      var t = e.target, qid = t.getAttribute('data-q');
      if (!qid) return;
      var role = t.getAttribute('data-role'), a = ansOf(qid) || {};
      if (role === 'single') {
        setAns(qid, { v: t.value });
      } else if (role === 'multi') {
        var arr = (a.v && a.v.slice) ? a.v.slice() : [];
        var k = arr.indexOf(t.value);
        if (t.checked && k < 0) arr.push(t.value);
        if (!t.checked && k >= 0) arr.splice(k, 1);
        setAns(qid, { v: arr });
      } else if (role === 'theme') {
        var m = {}, old = a.v || {};
        for (var x in old) m[x] = old[x];
        m[t.getAttribute('data-theme')] = t.value;
        setAns(qid, { v: m });
      } else { return; }
      syncQz(qid);
      updateProgress();
    });

    var tmr = {};
    bd.addEventListener('input', function (e) {
      var t = e.target, qid = t.getAttribute('data-q');
      if (!qid) return;
      var role = t.getAttribute('data-role');
      if (role !== 'text' && role !== 'othertext') return;
      clearTimeout(tmr[qid + role]);
      tmr[qid + role] = setTimeout(function () {
        if (role === 'text') setAns(qid, { v: t.value });
        else setAns(qid, { other: t.value });
        syncQz(qid);
        updateProgress();
      }, 400);
    });

    renderScreen(0, false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
