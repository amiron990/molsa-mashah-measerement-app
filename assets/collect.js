/* ============================================================
   מצפן רשויות מקומיות — שכבת איסוף התשובות
   נטענת בשני המסכים לפני concept.js / workshop.js.

   כל שינוי שמשתתף עושה נכנס לתור מקומי, ומשם נשלח במנות לנקודת
   הקליטה. רשת מקרטעת או סגירת דפדפן לא מאבדות תשובות: התור שורד
   ב-localStorage ומתרוקן בכניסה הבאה.
   ============================================================ */
(function (w) {
  'use strict';

  /* ---------- תצורה ----------
     COLLECT_URL — כתובת ה-Web App המסתיימת ב-/exec.
     הקמה: tools/apps-script/README.md. ריק = איסוף מושבת, הכלי עובד רגיל. */
  var COLLECT_URL = 'https://script.google.com/macros/s/AKfycbwJGfQabO_ZndJd3Wk6Rd9GWk4fcNheVWVVigPVrgnNm_gxQwPZgdoaIIdQUONaNypCmQ/exec';
  var COLLECT_TOKEN = 'molsa-workshop-2026';   /* חייב להיות זהה ל-TOKEN שבסקריפט */

  var OUTBOX_KEY = 'kyd_molsa_outbox_v1';
  var RID_KEY = 'kyd_molsa_rid';
  var BATCH = 25;
  var BACKOFF = [2000, 5000, 15000, 60000];    /* השהיה עולה בין ניסיונות */

  var queue = load();
  var timer = null, sending = false, tries = 0;
  var lastOk = null, lastErr = null;
  var listeners = [];

  /* ---------- אחסון ---------- */
  function load() {
    try {
      var q = JSON.parse(localStorage.getItem(OUTBOX_KEY));
      if (q && q.length) return q;
    } catch (e) {}
    return [];
  }
  function save() {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(queue)); } catch (e) {}
  }

  /* מזהה משיב — מלווה את כל האירועים ומחזיק את הקישור ביניהם */
  function rid() {
    var v = null;
    try { v = localStorage.getItem(RID_KEY); } catch (e) {}
    if (!v) {
      v = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem(RID_KEY, v); } catch (e) {}
    }
    return v;
  }

  /* ---------- שליחה ---------- */
  function enabled() { return !!COLLECT_URL; }

  function send(ev) {
    if (!enabled() || !ev) return;
    ev.rid = rid();
    if (!ev.ts) ev.ts = new Date().toISOString();
    queue.push(ev);
    save();
    notify();
    schedule(400);
  }

  function schedule(ms) {
    if (timer || sending || !queue.length) return;
    timer = setTimeout(function () { timer = null; flush(); }, ms);
  }

  function flush() {
    if (!enabled() || sending || !queue.length) return;
    if (!w.fetch) return;

    sending = true;
    var batch = queue.slice(0, BATCH);

    /* text/plain הוא simple request — בלי preflight, ש-Apps Script אינו עונה לו */
    fetch(COLLECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: COLLECT_TOKEN, events: batch })
    }).then(function (res) {
      return res.text().then(function (t) {
        var ok = true;
        try { ok = JSON.parse(t).ok !== false; } catch (e) {}
        if (!ok) throw new Error(t.slice(0, 120));
        return true;
      });
    }).then(function () {
      queue = queue.slice(batch.length);
      save();
      tries = 0; lastOk = new Date(); lastErr = null;
      sending = false;
      notify();
      schedule(300);
    }).catch(function (err) {
      tries++;
      lastErr = String(err && err.message || err);
      sending = false;
      notify();
      schedule(BACKOFF[Math.min(tries - 1, BACKOFF.length - 1)]);
    });
  }

  /* שליחה אחרונה בעת עזיבת הדף — sendBeacon שורד את הסגירה */
  function beacon() {
    if (!enabled() || !queue.length || !navigator.sendBeacon) return;
    try {
      var blob = new Blob(
        [JSON.stringify({ token: COLLECT_TOKEN, events: queue.slice(0, BATCH) })],
        { type: 'text/plain;charset=utf-8' });
      navigator.sendBeacon(COLLECT_URL, blob);
    } catch (e) {}
  }

  /* ---------- מצב וחיווי ---------- */
  function status() {
    return {
      enabled: enabled(), pending: queue.length,
      lastOk: lastOk, lastErr: lastErr, online: navigator.onLine !== false
    };
  }
  function onChange(fn) { listeners.push(fn); fn(status()); }
  function notify() {
    var s = status();
    listeners.forEach(function (fn) { try { fn(s); } catch (e) {} });
  }

  /* חיווי קטן בפס הניווט. מוסתר כשהאיסוף מושבת. */
  function mountPill(sel) {
    var host = document.querySelector(sel);
    if (!host) return;
    if (!enabled()) { host.hidden = true; return; }
    host.hidden = false;

    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sync';
    b.title = 'התשובות נשמרות אוטומטית. לחצו לשליחה מיידית.';
    b.addEventListener('click', function () { tries = 0; flush(); });
    host.appendChild(b);

    onChange(function (s) {
      var cls = 'sync', txt;
      if (s.pending) {
        cls += s.online ? ' wait' : ' off';
        txt = s.online ? 'ממתין לשליחה · ' + s.pending : 'אין חיבור · ' + s.pending;
      } else {
        cls += ' ok';
        txt = 'נשמר';
      }
      b.className = cls;
      b.textContent = txt;
    });
  }

  w.KYD = w.KYD || {};
  /* מסך הניהול פונה לאותה נקודת קליטה. הוא קורא את הכתובת מכאן במקום
     להחזיק עותק שני שלה, כדי שהחלפת פריסה תישאר שינוי בשורה אחת. */
  function url() { return COLLECT_URL; }

  /* פנייה חד-פעמית לנקודת הקליטה, עם הטוקן — לבקשות שאינן אירועי סדנה
     ואינן עוברות בתור. משמשת את מסך תפיסת המדידה למשיכת רשימת המדדים. */
  function post(body) {
    if (!enabled() || !w.fetch) return Promise.reject(new Error('איסוף מושבת'));
    var payload = { token: COLLECT_TOKEN };
    for (var k in body) payload[k] = body[k];

    return fetch(COLLECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.text();
    }).then(function (t) {
      var j = JSON.parse(t);
      if (j.ok === false) throw new Error(j.error || 'שגיאה');
      return j;
    });
  }

  w.KYD.collect = {
    send: send, flush: flush, status: status, onChange: onChange,
    mountPill: mountPill, rid: rid, enabled: enabled, url: url, post: post
  };

  w.addEventListener('online', function () { tries = 0; notify(); schedule(200); });
  w.addEventListener('offline', notify);
  w.addEventListener('pagehide', beacon);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') beacon(); else schedule(200);
  });

  schedule(1500);   /* ריקון שאריות מהכניסה הקודמת */
})(window);
