/**
 * מצפן רשויות מקומיות — קליטת תשובות המשתתפים אל הגיליון
 *
 * הקובץ הזה יושב בתוך גיליון Google (תוספים ← Apps Script) וכותב אליו.
 * הוראות הקמה מלאות: tools/apps-script/README.md
 *
 * הכלי שולח מנות של אירועים ב-POST. כל אירוע נכתב פעמיים:
 *   1. upsert לגיליון לפי הסוג שלו — שורה אחת לכל משיב ופריט, תמיד עדכנית.
 *   2. append לגיליון log — היסטוריה מלאה, כולל שינויים שנדרסו.
 */

/** חייב להיות זהה ל-COLLECT_TOKEN שב-assets/collect.js */
var TOKEN = 'molsa-workshop-2026';

/** הגדרת הגיליונות: הכותרות, ומאילו שדות מורכב מפתח ה-upsert */
var SHEETS = {
  ratings: {
    key: ['rid', 'indicatorId'],
    cols: ['ts', 'rid', 'שם', 'נפה', 'מזהה מדד', 'שם המדד', 'נושא', 'תת נושא', 'דירוג', 'הערה'],
    row: function (e) {
      return [e.ts, e.rid, e.name, e.district, e.indicatorId, e.indicatorName,
              e.theme, e.sub, e.stars, e.note];
    }
  },
  subvotes: {
    key: ['rid', 'theme', 'sub'],
    cols: ['ts', 'rid', 'שם', 'נפה', 'נושא', 'תת נושא', 'הצבעה'],
    row: function (e) {
      return [e.ts, e.rid, e.name, e.district, e.theme, e.sub,
              e.vote === 1 ? 'לייק' : (e.vote === -1 ? 'דיסלייק' : '')];
    }
  },
  answers: {
    key: ['rid', 'qid', 'optionKey'],
    cols: ['ts', 'rid', 'שם', 'נפה', 'מסך', 'מזהה שאלה', 'שאלה', 'פריט', 'תשובה', 'פירוט'],
    row: function (e) {
      return [e.ts, e.rid, e.name, e.district, e.screen, e.qid, e.question,
              e.optionKey, e.answer, e.detail];
    }
  },
  sessions: {
    key: ['rid'],
    cols: ['ts', 'rid', 'שם', 'נפה', 'מסך', 'דפדפן'],
    row: function (e) {
      return [e.ts, e.rid, e.name, e.district, e.screen, e.ua];
    }
  }
};

var LOG_COLS = ['ts', 'rid', 'שם', 'סוג', 'תוכן'];

/* ---------- נקודות הכניסה ---------- */

/** בדיקה ידנית: פתיחת כתובת ה-Web App בדפדפן */
function doGet() {
  return ContentService
    .createTextOutput('OK — מצפן רשויות מקומיות, נקודת קליטה פעילה.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return reply({ ok: false, error: 'empty' });

    var body = JSON.parse(e.postData.contents);
    if (body.token !== TOKEN) return reply({ ok: false, error: 'bad token' });

    var events = body.events || [];
    if (!events.length) return reply({ ok: true, written: 0 });

    /* נעילה — משתתפים עונים במקביל, ובלעדיה שתי כתיבות עלולות לדרוס זו את זו */
    var lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      for (var i = 0; i < events.length; i++) write(events[i]);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
    return reply({ ok: true, written: events.length });

  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

/* ---------- כתיבה ---------- */

function write(ev) {
  var def = SHEETS[ev.kind];
  logRow(ev);
  if (!def) return;

  var sh = sheetOf(ev.kind, def.cols);
  var keyIx = keyIndex(sh, def);
  var k = keyOf(ev, def.key);
  var row = def.row(ev).map(blank);

  var at = keyIx[k];
  if (at) sh.getRange(at, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}

function logRow(ev) {
  var sh = sheetOf('log', LOG_COLS);
  sh.appendRow([ev.ts, ev.rid, blank(ev.name), ev.kind, JSON.stringify(ev)]);
}

/** מיפוי מפתח → מספר שורה, נבנה מחדש בכל קריאה (היקף סדנה, עשרות עד מאות שורות) */
function keyIndex(sh, def) {
  var last = sh.getLastRow();
  var out = {};
  if (last < 2) return out;

  var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var at = def.key.map(function (f) { return def.cols.indexOf(headerFor(f, def)); });

  for (var r = 0; r < vals.length; r++) {
    var parts = [];
    for (var i = 0; i < at.length; i++) parts.push(String(vals[r][at[i]]));
    out[parts.join('')] = r + 2;
  }
  return out;
}

/** שם השדה באירוע → הכותרת שלו בגיליון */
function headerFor(field, def) {
  var map = {
    rid: 'rid', indicatorId: 'מזהה מדד', theme: 'נושא', sub: 'תת נושא',
    qid: 'מזהה שאלה', optionKey: 'פריט'
  };
  return map[field] || field;
}

function keyOf(ev, fields) {
  var parts = [];
  for (var i = 0; i < fields.length; i++) parts.push(String(blank(ev[fields[i]])));
  return parts.join('');
}

function sheetOf(name, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(cols);
    sh.getRange(1, 1, 1, cols.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function blank(v) { return (v === undefined || v === null) ? '' : v; }

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- בדיקה מתוך העורך ----------
   הריצו את הפונקציה הזו פעם אחת אחרי ההדבקה: היא יוצרת את הגיליונות
   ומאשרת את ההרשאות, בלי להמתין למשתתף ראשון. */
function testWrite() {
  write({
    kind: 'sessions', ts: new Date().toISOString(), rid: 'test-rid',
    name: 'בדיקה', district: 'חיפה', screen: 'בדיקה', ua: 'editor'
  });
  Logger.log('נכתב. בדקו את הגיליונות sessions ו-log.');
}
