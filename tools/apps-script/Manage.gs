/**
 * מצפן רשויות מקומיות — ניהול המדדים
 *
 * קובץ שני בתוך אותו פרויקט Apps Script של הגיליון. הוא בונה שלוש לשוניות
 * נוספות לצד לשוניות הסדנה, ומספק מעליהן API של קריאה וכתיבה:
 *
 *   אינדיקטורים   — מקור אמת אחד לכל מדד, עמודה לכל שדה שקיים ב-data.js
 *   הערות ודיון   — פריטי דיון עם סטטוס טיפול, תגובות והחלטה
 *   יומן שינויים  — מי שינה מה, מתי ולמה
 *
 * ההקמה: הריצו mSetup פעם אחת מהעורך. לפני הפעלת המסך — setAdminPass.
 * הוראות מלאות: tools/apps-script/README.md
 *
 * תלוי ב-Code.gs שבאותו פרויקט: book(), blank(), reply() ו-SEP. הניתוב מגיע
 * משורה אחת ב-doPost שם — כל בקשה שיש בה action מגיעה לכאן.
 */

var M = {
  IND: 'אינדיקטורים', CMT: 'הערות ודיון', CHG: 'יומן שינויים',
  POT: 'מדדים פוטנציאליים', PCMT: 'הערות מדדים פוטנציאליים', TSK: 'משימות',
  DIV: 'חלוקות שמורות'
};

/** עמודות המדד: תחילה כל שדה שקיים ב-INDICATORS שב-data.js, ואז שדות הניהול */
var IND_COLS = [
  'מזהה', 'שם המדד', 'שם מקוצר', 'נושא', 'תת נושא', 'הסבר על המדד', 'מונה', 'מכנה',
  'ישות מדידה', 'יחידת מידה', 'מקור המידע', 'תדירות', 'כיוון רצוי',
  'במפה', 'במיקוד', 'מדד ראשי', 'סדר', 'סטטוס',
  'אחראי', 'גרסה', 'עודכן בתאריך', 'מחליף את (מזהה)', 'מוחלף ע"י (מזהה)', 'סיבת שינוי אחרונה'
];

/** שדה ב-data.js ⇄ כותרת בגיליון. מה שאינו כאן הוא שדה ניהול בלבד. */
var IND_FIELDS = {
  id: 'מזהה', name: 'שם המדד', short: 'שם מקוצר', theme: 'נושא', sub: 'תת נושא',
  desc: 'הסבר על המדד', nom: 'מונה', den: 'מכנה', identity: 'ישות מדידה', unit: 'יחידת מידה',
  source: 'מקור המידע', freq: 'תדירות', positive: 'כיוון רצוי', map: 'במפה',
  focus: 'במיקוד', core: 'מדד ראשי', order: 'סדר', status: 'סטטוס'
};

/** שדות שמוחזרים כמספר בייצוא חזרה לפורמט data.js */
var IND_NUMERIC = { id: 1, positive: 1, map: 1, focus: 1, core: 1, order: 1 };

var CMT_COLS = [
  'מזהה הערה', 'מזהה מדד', 'שם המדד', 'ממי התקבל', 'תאריך', 'סוג הערה',
  'תוכן ההערה', 'סטטוס טיפול', 'מי טיפל', 'החלטה/פתרון', 'בתגובה להערה',
  'מקור', 'מפתח מקור'
];

var CHG_COLS = [
  'מזהה שינוי', 'תאריך', 'סוג פעולה', 'מי ביצע', 'מזהה מדד',
  'שדה שהשתנה', 'ערך קודם', 'ערך חדש', 'סיבה'
];

/** שדות שאין טעם לתעד בנפרד ביומן — הם נגזרים מהשינוי עצמו */
var CHG_SKIP = { 'עודכן בתאריך': 1, 'גרסה': 1, 'סיבת שינוי אחרונה': 1 };

/** מדד פוטנציאלי: פרמטרים עסקיים, ואחריהם פרמטרים אנליטיים ושדות ניהול */
var POT_COLS = [
  'מזהה זמני', 'שם מדד', 'הסבר על שיטת המדידה', 'נושא', 'תת נושא', 'סטטוס',
  'אופן חישוב', 'מקור הנתונים', 'יחידת מידה', 'כיוון רצוי',
  'נוצר בתאריך', 'עודכן בתאריך', 'סיבת שינוי אחרונה'
];

var TSK_COLS = [
  'מזהה משימה', 'כותרת המשימה', 'פירוט המשימה', 'גורם לביצוע',
  'תאריך פתיחה', 'תאריך לביצוע', 'סטטוס', 'הערות ביצוע', 'עודכן בתאריך'
];

/**
 * חלוקה שמורה של עץ קבוצות דומים (dashboard.html) — שורה לכל חלוקה, והשם הוא המפתח.
 *   עמודות        — המפתחות הטכניים של עמודות השלבים, לפי הסדר (JSON)
 *   שמות העמודות  — שם התצוגה של כל עמודה ביום השמירה (JSON), כדי שאפשר יהיה למצוא
 *                   חלוקה לפי שם הפרמטר גם אחרי שהעמודה יצאה מהנתונים
 *   הגדרות        — החלוקה המלאה, באותו פורמט ש«העתקת הגדרות» מעתיקה (JSON)
 */
var DIV_COLS = ['שם החלוקה', 'עמודות', 'שמות העמודות', 'הגדרות', 'נשמר על ידי', 'נשמר בתאריך'];
var DIV_NAME_MAX = 100;     /* כמו NAME_MAX שב-assets/dashboard.js */
var DIV_CELL_MAX = 50000;   /* מגבלת התווים של תא ב-Google Sheets */

/**
 * הישויות שנשמרות דרך mSaveRow. המדדים עצמם אינם כאן — יש להם גרסה,
 * הורדה רכה ומרחב מזהים מספרי, ולכן הם נשארים ב-mSaveIndicator.
 *   idCol   — העמודה שמזהה שורה; ריק בשמירה = המזהה הבא בתור עם prefix
 *   dates   — עמודות שנכתבות כטקסט, כדי ש-Sheets לא ימיר אותן לתאריך
 *   defs    — ערכי ברירת מחדל לשורה חדשה
 */
var ENT = {
  pot: { sheet: M.POT, cols: POT_COLS, idCol: 'מזהה זמני', nameCol: 'שם מדד', prefix: 'POT',
         dates: ['נוצר בתאריך', 'עודכן בתאריך'], defs: { 'סטטוס': 'בחינה ראשונית' },
         deletable: true, key: 'potentials' },
  tsk: { sheet: M.TSK, cols: TSK_COLS, idCol: 'מזהה משימה', nameCol: 'כותרת המשימה', prefix: 'TSK',
         dates: ['תאריך פתיחה', 'תאריך לביצוע', 'עודכן בתאריך'], defs: { 'סטטוס': 'טרם החל' } }
};

/** לשונית ההערות וקידומת המזהה לכל תחום. לתחום pot יש לשונית משלו באותן עמודות. */
var CMT_SCOPES = {
  ind: { sheet: M.CMT, prefix: 'CMT', key: 'comments' },
  pot: { sheet: M.PCMT, prefix: 'PCM', key: 'potComments' }
};

/** ערכים לרשימות הנפתחות במסך הניהול */
var LISTS = {
  'סטטוס': ['פעיל', 'בבחינה', 'בתהליך פיתוח', 'יורד'],
  'סוג הערה': ['ניסוח', 'הגדרה', 'מקור נתונים', 'רלוונטיות', 'דירוג מדד', 'שאלת סדנה', 'כללי', 'תגובה'],
  'סטטוס טיפול': ['פתוח', 'בבדיקה', 'טופל', 'נדחה'],
  'סטטוס פוטנציאל': ['בחינה ראשונית', 'בבדיקה מול יחידת הדאטה', 'בתהליך שליפה',
                     'בתהליך בדיקה של שליפות הנתונים', 'מחכה לאישור עסקי', 'אושר'],
  'סטטוס משימה': ['טרם החל', 'בתהליך', 'בוצע']
};

/* ---------- הקמה ---------- */

/** הריצו פעם אחת מהעורך. יוצר את הלשוניות החסרות; אינו נוגע בקיימות. */
function mSetup() {
  var made = [M.IND, M.CMT, M.CHG, M.POT, M.PCMT, M.TSK, M.DIV];
  mSheet(M.IND, IND_COLS);
  mSheet(M.CMT, CMT_COLS);
  mSheet(M.CHG, CHG_COLS);
  mSheet(M.POT, POT_COLS);
  mSheet(M.PCMT, CMT_COLS);
  mSheet(M.TSK, TSK_COLS);
  mDivSheet();
  mRenameCols();
  Logger.log('הגיליון: ' + book().getName());
  Logger.log('נוצרו או קיימות הלשוניות: ' + made.join(', '));
  return made;
}

/**
 * שינויי-שם עדינים לכותרות, לגיליון שכבר אותחל לפני השינוי. לא נוגע בנתונים:
 * הכותרת מתחלפת במקום, והעמודה נשארת עם כל תוכנה.
 */
function mRenameCols() {
  var sh = book().getSheetByName(M.IND);
  if (!sh || sh.getLastColumn() === 0) return;
  var renames = { 'הגדרה': 'הסבר על המדד' };
  var m = mMap(sh);
  for (var from in renames) {
    var to = renames[from];
    if (m[from] !== undefined && m[to] === undefined) sh.getRange(1, m[from] + 1).setValue(to);
  }
}

/**
 * קובע את סיסמת הניהול. הסיסמה נשמרת ב-Script Properties ולא בקוד —
 * הריפו ציבורי, וכל מה שיושב בקובץ הזה גלוי לכל.
 * שנו את המחרוזת, הריצו פעם אחת, ואז החזירו אותה למקומה כדי לא להשאיר עקבות.
 */
function setAdminPass() {
  var pass = 'שנו-אותי';
  if (pass === 'שנו-אותי') {
    throw new Error('החליפו את הערך של pass בתוך setAdminPass לסיסמה אמיתית, ואז הריצו שוב.');
  }
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASS', pass);
  Logger.log('סיסמת הניהול נשמרה. מחקו עכשיו את הסיסמה מהקוד.');
}

/* ---------- עזרי גיליון ---------- */

/**
 * הלשונית לפי שם, עם כותרות. גם לשונית שכבר קיימת אבל ריקה לגמרי — כזו שנפתחה ידנית
 * לפני ההרצה הראשונה — מקבלת את הכותרות: בלעדיהן mMap נופל עליה, כי אין בה אף עמודה.
 * לשונית שיש בה תוכן אינה נדרסת.
 */
function mSheet(name, cols) {
  var sh = book().getSheetByName(name) || book().insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.setRightToLeft(true);
    sh.appendRow(cols);
    sh.getRange(1, 1, 1, cols.length)
      .setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** כותרת → אינדקס עמודה (מבוסס 0) */
function mMap(sh) {
  var hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var m = {};
  for (var i = 0; i < hdr.length; i++) {
    var h = String(hdr[i]).trim();
    if (h) m[h] = i;
  }
  return m;
}

/** כל שורות הלשונית כאובייקטים לפי הכותרות, עם _row למיקום המקורי */
function mRead(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var m = mMap(sh);
  var vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var out = [];
  for (var r = 0; r < vals.length; r++) {
    var o = { _row: r + 2 };
    for (var h in m) o[h] = mCell(vals[r][m[h]]);
    out.push(o);
  }
  return out;
}

function mCell(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Jerusalem', 'yyyy-MM-dd');
  return String(v);
}

function mToday() { return Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM-dd'); }
function mStamp() { return Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM-dd HH:mm:ss'); }

/**
 * mNextIds allocates n ids in one go.
 * הכתיבה ל-Script Properties היא אחת לכל המנה — קריאה וכתיבה של מאפיין הן
 * הפעולות היקרות כאן, ואחת לכל שורה חצתה את זמן הנעילה של הבקשה.
 * המונה מתמשך: אינו ממחזר מספר גם אחרי מחיקת שורה, ומאותחל פעם אחת
 * מהמקסימום שכבר קיים בגיליון כדי לא להתנגש בנתונים שנוצרו לפניו.
 */
function mNextIds(prefix, sheetName, col, n) {
  var props = PropertiesService.getScriptProperties();
  var key = 'SEQ_' + prefix;
  var cur = parseInt(props.getProperty(key) || '0', 10);
  if (!cur) cur = mSeedSeq(prefix, sheetName, col);

  var out = [];
  for (var i = 1; i <= n; i++) out.push(prefix + '-' + ('000' + (cur + i)).slice(-3));
  props.setProperty(key, String(cur + n));
  return out;
}

function mNextId(prefix, sheetName, col) {
  return mNextIds(prefix, sheetName, col, 1)[0];
}

/** איתחול המונה מהמזהה הגבוה ביותר שכבר קיים בלשונית */
function mSeedSeq(prefix, sheetName, col) {
  var max = 0;
  var sh = book().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return max;
  var m = mMap(sh);
  if (m[col] === undefined) return max;

  var vals = sh.getRange(2, m[col] + 1, sh.getLastRow() - 1, 1).getValues();
  /* [0-9] ולא \d — כדי שהתו הבורח לא ייעלם בשום עריכה עתידית של הקובץ */
  var re = new RegExp('^' + prefix + '-([0-9]+)$');
  for (var i = 0; i < vals.length; i++) {
    var hit = String(vals[i][0]).trim().match(re);
    if (hit) max = Math.max(max, parseInt(hit[1], 10));
  }
  return max;
}

/** בונה שורה בסדר הכותרות מתוך אובייקט, לפי מפת כותרות שכבר נקראה */
function mRowWith(map, width, obj) {
  var row = [];
  for (var i = 0; i < width; i++) row.push('');
  for (var h in obj) if (map[h] !== undefined) row[map[h]] = blank(obj[h]);
  return row;
}

/** נוחות לשורה בודדת. בלולאה יש להשתמש ב-mRowWith עם מפה שנקראה פעם אחת. */
function mRow(sh, obj) {
  return mRowWith(mMap(sh), sh.getLastColumn(), obj);
}

/* ---------- יומן השינויים ---------- */

/** כותב מנה של רשומות יומן בכתיבה אחת. פריט: {who,id,action,field,oldV,newV,reason} */
function mLogMany(entries) {
  if (!entries || !entries.length) return;
  var sh = mSheet(M.CHG, CHG_COLS);
  var map = mMap(sh), width = sh.getLastColumn();
  var ids = mNextIds('CHG', M.CHG, 'מזהה שינוי', entries.length);
  var stamp = mStamp();

  var rows = entries.map(function (e, i) {
    return mRowWith(map, width, {
      'מזהה שינוי': ids[i],
      'תאריך': stamp,
      'סוג פעולה': e.action,
      'מי ביצע': e.who,
      'מזהה מדד': blank(e.id),
      'שדה שהשתנה': blank(e.field),
      'ערך קודם': blank(e.oldV),
      'ערך חדש': blank(e.newV),
      'סיבה': blank(e.reason)
    });
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, width).setValues(rows);
}

function mLog(who, id, action, field, oldV, newV, reason) {
  mLogMany([{ who: who, id: id, action: action, field: field,
              oldV: oldV, newV: newV, reason: reason }]);
}

/* ---------- ניתוב ---------- */

/** נקראת מ-doPost שב-Code.gs עבור כל בקשה שיש בה action */
function manageApi(body) {
  var stored = PropertiesService.getScriptProperties().getProperty('ADMIN_PASS');
  if (!stored) return reply({ ok: false, error: 'לא הוגדרה סיסמת ניהול. הריצו setAdminPass מעורך הסקריפט.' });
  /* code: 'login' — כדי שדף שהחזיק סיסמה ישנה ידע לשכוח אותה ולבקש אחרת */
  if (String(body.pass || '') !== stored) return reply({ ok: false, code: 'login', error: 'סיסמת ניהול שגויה.' });

  var who = String(blank(body.who)).trim() || 'לא ידוע';

  try {
    switch (body.action) {
      case 'bootstrap':       return reply(mBootstrap());
      case 'seed':            return reply(mSeed(body.indicators, who));
      case 'saveIndicator':   return reply(mSaveIndicator(body.indicator, body.reason, who));
      case 'retireIndicator': return reply(mRetire(body.id, body.reason, who));
      case 'saveRow':         return reply(mSaveRow(body.kind, body.row, body.reason, who));
      case 'deleteRow':       return reply(mDeleteRow(body.kind, body.id, body.reason, who));
      case 'addComment':      return reply(mAddComment(body.comment, who, body.scope));
      case 'updateComment':   return reply(mUpdateComment(body.id, body.patch, who, body.scope));
      case 'ingest':          return reply(mIngestNow());
      case 'export':          return reply({ ok: true, indicators: mExport() });
      case 'saveDivision':    return reply(mSaveDivision(body.division, body.overwrite === true, who));
      case 'deleteDivision':  return reply(mDeleteDivision(body.name, who));
      default:                return reply({ ok: false, error: 'פעולה לא מוכרת: ' + body.action });
    }
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/* ---------- קריאה ---------- */

function mBootstrap() {
  mSetup();
  var ing = mIngest();
  var chg = mRead(mSheet(M.CHG, CHG_COLS));
  return {
    ok: true,
    indicators: mRead(mSheet(M.IND, IND_COLS)),
    comments: mRead(mSheet(M.CMT, CMT_COLS)),
    changes: chg.slice(Math.max(0, chg.length - 300)).reverse(),
    potentials: mRead(mSheet(M.POT, POT_COLS)),
    potComments: mRead(mSheet(M.PCMT, CMT_COLS)),
    tasks: mRead(mSheet(M.TSK, TSK_COLS)),
    lists: LISTS,
    ingested: ing,
    scores: mScores(),
    serverNow: mStamp()
  };
}

/* ---------- אתחול מ-data.js ---------- */

/**
 * ממלא את לשונית האינדיקטורים מהמערך שהדפדפן שולח (INDICATORS שב-data.js).
 * הנתונים מגיעים מהלקוח בכוונה: אין עותק שני שלהם בקוד השרת, ולכן אין מה שיתיישן.
 * נעילת בטיחות: לא נוגעים בלשונית שכבר יש בה שורות.
 */
function mSeed(indicators, who) {
  var sh = mSheet(M.IND, IND_COLS);
  if (sh.getLastRow() > 1) {
    return { ok: false, error: 'לשונית האינדיקטורים כבר מכילה נתונים. האתחול נועד לפעם הראשונה בלבד.' };
  }
  if (!indicators || !indicators.length) return { ok: false, error: 'לא התקבלו מדדים לאתחול.' };

  var map = mMap(sh), width = sh.getLastColumn();
  var rows = [];
  for (var i = 0; i < indicators.length; i++) {
    var one = indicators[i], obj = {};
    for (var f in IND_FIELDS) if (one[f] !== undefined) obj[IND_FIELDS[f]] = one[f];
    if (!obj['סטטוס']) obj['סטטוס'] = 'פעיל';
    obj['גרסה'] = '1.0';
    obj['עודכן בתאריך'] = mToday();
    rows.push(mRowWith(map, width, obj));
  }
  sh.getRange(2, 1, rows.length, width).setValues(rows);
  mDateAsText(sh);
  mLog(who, '', 'אתחול', '—', '', rows.length + ' מדדים', 'אתחול מ-data.js');
  return { ok: true, count: rows.length, indicators: mRead(sh) };
}

/** «עודכן בתאריך» כטקסט — אחרת Sheets ממיר אותו לתאריך ומציג פורמט אחר */
function mDateAsText(sh) {
  var m = mMap(sh);
  if (m['עודכן בתאריך'] === undefined) return;
  sh.getRange(2, m['עודכן בתאריך'] + 1, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
}

/* ---------- כתיבת מדד ---------- */

function mSaveIndicator(data, reason, who) {
  if (!data) return { ok: false, error: 'לא התקבל מדד.' };
  var sh = mSheet(M.IND, IND_COLS);
  var m = mMap(sh);
  var id = String(blank(data['מזהה'])).trim();
  var at = id ? mFindRow(sh, id) : null;
  var h;

  /* מזהה שאינו קיים בגיליון — מדד חדש עם המזהה שהוקלד. ריק — המזהה הבא בתור. */
  if (!at) {
    if (!id) id = String(mNextIndId(sh));
    data['מזהה'] = id;
    if (!data['סטטוס']) data['סטטוס'] = 'בתהליך פיתוח';
    data['גרסה'] = '1.0';
    data['עודכן בתאריך'] = mToday();
    data['סיבת שינוי אחרונה'] = blank(reason);
    sh.appendRow(mRow(sh, data));
    mDateAsText(sh);
    mLog(who, id, 'הוספה', '—', '', data['שם המדד'] || '(ללא שם)', reason || 'מדד חדש');
    return { ok: true, indicator: mOne(sh, sh.getLastRow()) };
  }

  var cur = sh.getRange(at, 1, 1, sh.getLastColumn()).getValues()[0];
  var logs = [], bump = false;
  for (h in m) {
    if (data[h] === undefined || CHG_SKIP[h] || h === 'מזהה') continue;
    var was = mCell(cur[m[h]]);
    var now = String(blank(data[h]));
    if (was === now) continue;
    logs.push({ who: who, id: id, action: 'עדכון', field: h,
                oldV: was, newV: now, reason: reason });
    if (h === 'שם המדד' || h === 'הסבר על המדד') bump = true;
  }
  if (!logs.length) return { ok: true, indicator: mOne(sh, at), unchanged: true };
  mLogMany(logs);

  if (bump) {
    var parts = String(mCell(cur[m['גרסה']]) || '1.0').split('.');
    data['גרסה'] = parts[0] + '.' + ((parseInt(parts[1] || '0', 10)) + 1);
  }
  data['עודכן בתאריך'] = mToday();
  data['סיבת שינוי אחרונה'] = blank(reason);

  for (h in m) {
    if (data[h] === undefined) continue;
    var cell = sh.getRange(at, m[h] + 1);
    if (h === 'עודכן בתאריך') cell.setNumberFormat('@');
    cell.setValue(blank(data[h]));
  }
  return { ok: true, indicator: mOne(sh, at) };
}

/** הורדת מדד = מחיקה רכה. השורה וההיסטוריה נשארות, הסטטוס משתנה. */
function mRetire(id, reason, who) {
  var sh = mSheet(M.IND, IND_COLS);
  var at = mFindRow(sh, id);
  if (!at) return { ok: false, error: 'לא נמצא מדד ' + id };
  var m = mMap(sh);
  var was = mCell(sh.getRange(at, m['סטטוס'] + 1).getValue());
  if (was === 'יורד') return { ok: true, indicator: mOne(sh, at), unchanged: true };

  sh.getRange(at, m['סטטוס'] + 1).setValue('יורד');
  sh.getRange(at, m['עודכן בתאריך'] + 1).setNumberFormat('@').setValue(mToday());
  sh.getRange(at, m['סיבת שינוי אחרונה'] + 1).setValue(blank(reason));
  mLog(who, id, 'הורדה', 'סטטוס', was, 'יורד', reason || 'הורדת מדד');
  return { ok: true, indicator: mOne(sh, at) };
}

function mFindRow(sh, id) {
  if (sh.getLastRow() < 2) return null;
  var m = mMap(sh);
  var ids = sh.getRange(2, m['מזהה'] + 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) return i + 2;
  }
  return null;
}

/** המזהה הפנוי הבא — אותו מרחב מזהים מספרי שב-data.js */
function mNextIndId(sh) {
  var max = 1000;
  if (sh.getLastRow() > 1) {
    var m = mMap(sh);
    var ids = sh.getRange(2, m['מזהה'] + 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      var n = parseInt(String(ids[i][0]).trim(), 10);
      if (!isNaN(n)) max = Math.max(max, n);
    }
  }
  return max + 1;
}

function mOne(sh, at) {
  var m = mMap(sh);
  var row = sh.getRange(at, 1, 1, sh.getLastColumn()).getValues()[0];
  var o = { _row: at };
  for (var h in m) o[h] = mCell(row[m[h]]);
  return o;
}

/* ---------- הערות ---------- */

/** התחום של הערה: ind — מדדים, pot — מדדים פוטנציאליים. ברירת המחדל ind. */
function mScope(scope) {
  return CMT_SCOPES[scope] || CMT_SCOPES.ind;
}

/** התשובה לפעולת הערה: הלשונית המעודכנת, תחת המפתח של התחום שלה */
function mCmtReply(sc, sh) {
  var out = { ok: true };
  out[sc.key] = mRead(sh);
  return out;
}

function mAddComment(c, who, scope) {
  if (!c || !String(blank(c['תוכן ההערה'])).trim()) return { ok: false, error: 'הערה ריקה.' };
  var sc = mScope(scope);
  var sh = mSheet(sc.sheet, CMT_COLS);
  var parent = String(blank(c['בתגובה להערה'])).trim();
  var id = mNextId(sc.prefix, sc.sheet, 'מזהה הערה');

  sh.appendRow(mRow(sh, {
    'מזהה הערה': id,
    'מזהה מדד': blank(c['מזהה מדד']),
    'שם המדד': blank(c['שם המדד']),
    'ממי התקבל': blank(c['ממי התקבל']) || who,
    'תאריך': mToday(),
    'סוג הערה': blank(c['סוג הערה']) || (parent ? 'תגובה' : 'כללי'),
    'תוכן ההערה': c['תוכן ההערה'],
    /* לתגובה אין סטטוס טיפול — היא אינה פריט שמטפלים בו, אלא חלק מהשרשור */
    'סטטוס טיפול': parent ? '' : (blank(c['סטטוס טיפול']) || 'פתוח'),
    'בתגובה להערה': parent,
    'מקור': 'ידני'
  }));

  mLog(who, blank(c['מזהה מדד']), 'הערה', parent ? 'תגובה' : 'הערה חדשה', '',
       String(c['תוכן ההערה']).slice(0, 120), parent ? ('בתגובה ל-' + parent) : '');
  return mCmtReply(sc, sh);
}

function mUpdateComment(id, patch, who, scope) {
  var sc = mScope(scope);
  var sh = mSheet(sc.sheet, CMT_COLS);
  var m = mMap(sh);
  var at = null;
  var rows = mRead(sh);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['מזהה הערה']).trim() === String(id).trim()) { at = rows[i]._row; break; }
  }
  if (!at) return { ok: false, error: 'לא נמצאה הערה ' + id };

  var cur = sh.getRange(at, 1, 1, sh.getLastColumn()).getValues()[0];
  var indId = mCell(cur[m['מזהה מדד']]);
  var fields = ['סוג הערה', 'תוכן ההערה', 'סטטוס טיפול', 'החלטה/פתרון'];

  for (var f = 0; f < fields.length; f++) {
    var h = fields[f];
    if (patch[h] === undefined || m[h] === undefined) continue;
    var was = mCell(cur[m[h]]), now = String(blank(patch[h]));
    if (was === now) continue;
    sh.getRange(at, m[h] + 1).setValue(now);
    mLog(who, indId, 'הערה', h + ' (' + id + ')', was, now, '');
  }
  /* מי שסגר את ההערה הוא מי שטיפל בה */
  if (patch['סטטוס טיפול'] === 'טופל' || patch['סטטוס טיפול'] === 'נדחה') {
    sh.getRange(at, m['מי טיפל'] + 1).setValue(who);
  }
  return mCmtReply(sc, sh);
}

/* ---------- מדדים פוטנציאליים ומשימות ---------- */

/**
 * שמירת שורה של מדד פוטנציאלי (kind=pot) או משימה (kind=tsk).
 * אותה שיטה כמו mSaveIndicator: שורה חדשה מקבלת מזהה ונרשמת ביומן כ«הוספה»,
 * ובשורה קיימת נכתב ביומן כל שדה שהשתנה, עם הערך הקודם, החדש והסיבה.
 * היומן משותף לכל הישויות — «מזהה מדד» בו מחזיק גם POT-… ו-TSK-….
 */
function mSaveRow(kind, data, reason, who) {
  var def = ENT[kind];
  if (!def) return { ok: false, error: 'סוג לא מוכר: ' + kind };
  if (!data) return { ok: false, error: 'לא התקבלו נתונים.' };

  var sh = mSheet(def.sheet, def.cols);
  var m = mMap(sh);
  var id = String(blank(data[def.idCol])).trim();
  var at = id ? mFindRowBy(sh, def.idCol, id) : null;
  var h;

  if (!at) {
    if (!id) id = mNextId(def.prefix, def.sheet, def.idCol);
    data[def.idCol] = id;
    for (h in def.defs) if (!String(blank(data[h])).trim()) data[h] = def.defs[h];
    if (kind === 'pot') data['נוצר בתאריך'] = mToday();
    if (kind === 'tsk' && !String(blank(data['תאריך פתיחה'])).trim()) data['תאריך פתיחה'] = mToday();
    data['עודכן בתאריך'] = mToday();
    if (m['סיבת שינוי אחרונה'] !== undefined) data['סיבת שינוי אחרונה'] = blank(reason);

    var row = sh.getLastRow() + 1;
    mTextCols(sh, def.dates, row);
    sh.getRange(row, 1, 1, sh.getLastColumn()).setValues([mRow(sh, data)]);
    mLog(who, id, 'הוספה', '—', '', data[def.nameCol] || '(ללא שם)', reason || 'חדש');
    return { ok: true, kind: kind, row: mOne(sh, row) };
  }

  var cur = sh.getRange(at, 1, 1, sh.getLastColumn()).getValues()[0];
  var logs = [];
  for (h in m) {
    if (data[h] === undefined || CHG_SKIP[h] || h === def.idCol || h === 'נוצר בתאריך') continue;
    var was = mCell(cur[m[h]]);
    var now = String(blank(data[h]));
    if (was === now) { delete data[h]; continue; }
    logs.push({ who: who, id: id, action: 'עדכון', field: h, oldV: was, newV: now, reason: reason });
  }
  if (!logs.length) return { ok: true, kind: kind, row: mOne(sh, at), unchanged: true };
  mLogMany(logs);

  data['עודכן בתאריך'] = mToday();
  if (m['סיבת שינוי אחרונה'] !== undefined) data['סיבת שינוי אחרונה'] = blank(reason);
  mTextCols(sh, def.dates, at);
  for (h in m) {
    if (data[h] === undefined || h === def.idCol || h === 'נוצר בתאריך') continue;
    sh.getRange(at, m[h] + 1).setValue(blank(data[h]));
  }
  return { ok: true, kind: kind, row: mOne(sh, at) };
}

/**
 * מחיקה של שורה — רק לישויות שמסומנות deletable (כרגע מדדים פוטנציאליים).
 * בניגוד להורדת מדד, השורה נעלמת מהגיליון. לכן היומן מקבל את כל תוכנה
 * כ-JSON ב«ערך קודם» — זה העותק היחיד שנשאר, ואפשר לשחזר ממנו ידנית.
 * ההערות על הפריט נשארות בלשונית שלהן: הן חלק מהתיעוד של ההחלטה למחוק.
 */
function mDeleteRow(kind, id, reason, who) {
  var def = ENT[kind];
  if (!def || !def.deletable) return { ok: false, error: 'מחיקה אינה אפשרית כאן.' };
  if (!String(blank(reason)).trim()) return { ok: false, error: 'חסרה סיבת המחיקה.' };

  var sh = mSheet(def.sheet, def.cols);
  var at = mFindRowBy(sh, def.idCol, id);
  if (!at) return { ok: false, error: 'לא נמצא ' + id };

  var snap = mOne(sh, at);
  delete snap._row;
  mLog(who, id, 'מחיקה', '—', JSON.stringify(snap), '', reason);
  sh.deleteRow(at);

  var out = { ok: true, deleted: id };
  out[def.key] = mRead(sh);
  return out;
}

/** עמודות התאריך של שורה נתונה כטקסט — לפני הכתיבה, כדי שהערך יישמר כפי שנשלח */
function mTextCols(sh, cols, row) {
  var m = mMap(sh);
  (cols || []).forEach(function (h) {
    if (m[h] !== undefined) sh.getRange(row, m[h] + 1).setNumberFormat('@');
  });
}

function mFindRowBy(sh, col, id) {
  if (sh.getLastRow() < 2) return null;
  var m = mMap(sh);
  if (m[col] === undefined) return null;
  var ids = sh.getRange(2, m[col] + 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) return i + 2;
  }
  return null;
}

/* ---------- משיכת ההערות מהסדנה ---------- */

/**
 * מעביר לטבלת הדיון כל הערה חופשית שמשתתף השאיר בסדנה:
 *   ratings.הערה   — הערה על מדד מסוים
 *   answers.פירוט  — פירוט חופשי על שאלת סדנה, בלי שיוך למדד
 *
 * «מפתח מקור» הוא מפתח ה-upsert של הסדנה, ולכן הפעולה אידמפוטנטית: הרצה חוזרת
 * אינה מכפילה שורות. משתתף ששינה את ההערה שלו מעדכן את השורה בסדנה — כאן זה מזוהה
 * לפי שינוי בטקסט, ומעדכן את ההערה הקיימת במקום ליצור חדשה.
 *
 * הסריקה מלאה ואינה מדלגת לפי מונה שורות — דווקא עדכון במקום אינו מזיז את מספר
 * השורות, ומונה כזה היה מפספס אותו. בהיקף של סדנה זו קריאה זולה.
 */
function mIngest() {
  var sh = mSheet(M.CMT, CMT_COLS);
  var map = mMap(sh), width = sh.getLastColumn();

  var have = {};
  mRead(sh).forEach(function (r) {
    var k = r['מפתח מקור'];
    if (k) have[k] = r;
  });

  var found = []
    .concat(mScan('ratings', ['rid', 'מזהה מדד'], 'הערה', 'דירוג מדד', 'מזהה מדד', 'שם המדד'))
    .concat(mScan('answers', ['rid', 'מזהה שאלה', 'פריט'], 'פירוט', 'שאלת סדנה', null, 'שאלה'));

  var fresh = [], updates = [];
  found.forEach(function (ev) {
    var prev = have[ev.key];
    if (!prev) fresh.push(ev);
    else if (prev['תוכן ההערה'] !== ev.text) updates.push({ prev: prev, ev: ev });
  });

  /* כל החדשות בכתיבה אחת. שורה-שורה כאן היה מה שחצה את זמן הנעילה של הבקשה. */
  if (fresh.length) {
    var ids = mNextIds('CMT', M.CMT, 'מזהה הערה', fresh.length);
    var rows = fresh.map(function (ev, i) {
      return mRowWith(map, width, {
        'מזהה הערה': ids[i],
        'מזהה מדד': ev.indId,
        'שם המדד': ev.title,
        'ממי התקבל': ev.name,
        'תאריך': ev.date,
        'סוג הערה': ev.kind,
        'תוכן ההערה': ev.text,
        'סטטוס טיפול': 'פתוח',
        'מקור': 'סדנה',
        'מפתח מקור': ev.key
      });
    });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, width).setValues(rows);
  }

  var logs = [];
  updates.forEach(function (u) {
    sh.getRange(u.prev._row, map['תוכן ההערה'] + 1).setValue(u.ev.text);
    sh.getRange(u.prev._row, map['תאריך'] + 1).setValue(u.ev.date);
    logs.push({
      who: 'סדנה', id: u.ev.indId, action: 'הערה',
      field: 'עדכון מהסדנה (' + u.prev['מזהה הערה'] + ')',
      oldV: u.prev['תוכן ההערה'], newV: u.ev.text, reason: u.ev.name
    });
  });
  mLogMany(logs);

  return { added: fresh.length, updated: updates.length };
}

/**
 * ציון ממוצע לכל מדד, מלשונית ratings — שם שכל שורה בה היא משיב אחד ומדד
 * אחד (upsert לפי rid+מזהה מדד), ולכן ספירת השורות היא ספירת המדרגים.
 *
 * שורה בלי דירוג אינה נספרת: אפס בעמודה «דירוג» הוא ניקוי הדירוג במסך
 * הציבורי, לא ציון גרוע, וספירתו כאחד הייתה מושכת את הממוצע כלפי מטה. שורה
 * כזו עדיין מגיעה למסך כהערה, אם יש בה טקסט — זה תפקידו של mIngest.
 *
 *   → { '1031': { avg: 4.25, n: 8 }, … }
 */
function mScores() {
  var sh = book().getSheetByName('ratings');
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;

  var m = mMap(sh);
  if (m['מזהה מדד'] === undefined || m['דירוג'] === undefined) return out;

  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  for (var r = 0; r < vals.length; r++) {
    var id = mCell(vals[r][m['מזהה מדד']]).trim();
    var stars = Number(vals[r][m['דירוג']]);
    if (!id || !stars || stars < 1) continue;
    if (!out[id]) out[id] = { sum: 0, n: 0 };
    out[id].sum += stars;
    out[id].n++;
  }

  Object.keys(out).forEach(function (id) {
    out[id] = { avg: Math.round((out[id].sum / out[id].n) * 100) / 100, n: out[id].n };
  });
  return out;
}

function mIngestNow() {
  var r = mIngest();
  return { ok: true, ingested: r, comments: mRead(mSheet(M.CMT, CMT_COLS)), scores: mScores() };
}

/**
 * סורק לשונית סדנה אחת ומחזיר את השורות שיש בהן טקסט חופשי.
 *   keyCols  — העמודות שמרכיבות את מפתח ה-upsert של אותה לשונית
 *   textCol  — העמודה שבה הטקסט החופשי
 *   idCol    — העמודה שמזהה את המדד, או null כשאין שיוך למדד
 *   titleCol — העמודה שתשמש ככותרת מוצגת
 */
function mScan(sheetName, keyCols, textCol, kind, idCol, titleCol) {
  var sh = book().getSheetByName(sheetName);
  var out = [];
  if (!sh || sh.getLastRow() < 2) return out;

  var m = mMap(sh);
  if (m[textCol] === undefined) return out;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();

  for (var r = 0; r < vals.length; r++) {
    var text = mCell(vals[r][m[textCol]]).trim();
    if (!text) continue;

    var parts = [];
    for (var k = 0; k < keyCols.length; k++) {
      parts.push(m[keyCols[k]] === undefined ? '' : mCell(vals[r][m[keyCols[k]]]));
    }
    out.push({
      key: sheetName + SEP + parts.join(SEP),
      text: text,
      kind: kind,
      indId: (idCol && m[idCol] !== undefined) ? mCell(vals[r][m[idCol]]) : '',
      title: (titleCol && m[titleCol] !== undefined) ? mCell(vals[r][m[titleCol]]) : '',
      name: m['שם'] === undefined ? '' : mCell(vals[r][m['שם']]),
      date: mCell(vals[r][m['ts']]).slice(0, 10)
    });
  }
  return out;
}

/* ---------- הרשימה הציבורית ---------- */

/**
 * רשימת המדדים למסך תפיסת המדידה, באותה צורה כמו INDICATORS שב-data.js.
 *
 * מדד בסטטוס «יורד» אינו מוחזר — הורדה במסך הניהול היא מחיקה רכה, והמסך
 * הציבורי הוא בדיוק המקום שבו היא אמורה להתבטא.
 *
 * שדה מספרי ריק מקבל ברירת מחדל ולא אפס: «מדד ראשי» ריק נחשב 1, אחרת מדד
 * שנוצר במסך הניהול היה נכתב לגיליון ולא מופיע בשום מקום; «כיוון רצוי» ריק
 * נחשב 1, אחרת חץ המגמה היה נצבע הפוך.
 */
function mPublicIndicators() {
  var defaults = { core: 1, positive: 1 };
  var rows = mRead(mSheet(M.IND, IND_COLS));
  var out = [];

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['סטטוס']).trim() === 'יורד') continue;
    var o = {};
    for (var f in IND_FIELDS) {
      var v = rows[i][IND_FIELDS[f]];
      if (!IND_NUMERIC[f]) { o[f] = String(v === undefined ? '' : v); continue; }
      o[f] = (v === '' || v === undefined) ? (defaults[f] || 0) : (parseInt(v, 10) || 0);
    }
    out.push(o);
  }
  return out;
}

/* ---------- ייצוא ---------- */

/** מחזיר את הלשונית בפורמט המערך של INDICATORS שב-data.js */
function mExport() {
  var rows = mRead(mSheet(M.IND, IND_COLS));
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var o = {};
    for (var f in IND_FIELDS) {
      var v = rows[i][IND_FIELDS[f]];
      o[f] = IND_NUMERIC[f] ? (parseInt(v, 10) || 0) : String(v === undefined ? '' : v);
    }
    out.push(o);
  }
  return out;
}

/* ---------- חלוקות שמורות (עץ קבוצות דומים) ----------
   רשימה משותפת אחת. הקריאה ציבורית — מנותבת מ-doPost שב-Code.gs לפני בדיקת הסיסמה,
   בלי נעילה ובלי לכתוב לגיליון. שמירה ומחיקה עוברות ב-manageApi: סיסמת ניהול, נעילה,
   ורישום ביומן השינויים. כשל נושא code שהדף מגיב לו:
     exists  — השם תפוס, והבקשה לא ביקשה להחליף
     missing — אין חלוקה בשם הזה
     name    — השם אינו עומד בכללים
     login   — סיסמת ניהול שגויה (נקבע ב-manageApi) */

/** הלשונית לכתיבה. כותרת שחסרה בה — למשל בלשונית שכותרותיה הוקלדו ידנית — נוספת בסוף השורה. */
function mDivSheet() {
  var sh = mSheet(M.DIV, DIV_COLS);
  var m = mMap(sh);
  var missing = DIV_COLS.filter(function (h) { return m[h] === undefined; });
  if (missing.length) {
    sh.getRange(1, sh.getLastColumn() + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  }
  return sh;
}

/** השורות לקריאה בלבד: לשונית חסרה או ריקה היא רשימה ריקה, ואינה נוצרת מכאן */
function mDivRows() {
  var sh = book().getSheetByName(M.DIV);
  return sh ? mRead(sh) : [];
}

function mJson(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

/** חלוקה בלי ההגדרות עצמן — מה שהרשימה צריכה כדי להציג ולחפש */
function mDivSummary(r) {
  return {
    name: String(r['שם החלוקה']).trim(),
    columns: mJson(r['עמודות'], []),
    labels: mJson(r['שמות העמודות'], {}),
    savedBy: r['נשמר על ידי'],
    savedAt: r['נשמר בתאריך']
  };
}

function mListDivisions() {
  var out = [];
  mDivRows().forEach(function (r) {
    if (String(r['שם החלוקה']).trim()) out.push(mDivSummary(r));
  });
  return { ok: true, divisions: out };
}

function mGetDivision(name) {
  var key = String(blank(name)).trim();
  var rows = mDivRows();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['שם החלוקה']).trim() !== key) continue;
    var config = mJson(rows[i]['הגדרות'], null);
    if (!config) return { ok: false, code: 'broken', error: 'ההגדרות של החלוקה הזאת בגיליון אינן תקינות.' };
    var d = mDivSummary(rows[i]);
    d.config = config;
    return { ok: true, division: d };
  }
  return { ok: false, code: 'missing', error: 'החלוקה הזאת כבר לא ברשימה.' };
}

/** אותם כללים כמו nameProblem שב-assets/dashboard.js. השרת בודק שוב — הדף אינו המגן. */
function mDivNameProblem(name) {
  if (!name) return 'צריך לתת לחלוקה שם.';
  if (/[\r\n]/.test(name)) return 'השם לא יכול לכלול מעבר שורה.';
  /* שם שמתחיל ב-= היה נכתב לגיליון כנוסחה */
  if (name.charAt(0) === '=') return 'השם לא יכול להתחיל בסימן =.';
  if (name.length > DIV_NAME_MAX) return 'השם ארוך מדי: עד ' + DIV_NAME_MAX + ' תווים.';
  return '';
}

/** שמות השלבים לקריאה, לעמודת «ערך חדש» ביומן — ה-JSON המלא ארוך מדי לטבלה שם */
function mDivStages(columns, labels) {
  return columns.map(function (k) { return (labels && labels[k]) || k; }).join(' · ') || 'אין שלבים';
}

/**
 * כותב את השדות לשורה כטקסט — כדי ש-Sheets לא יהפוך שם כמו "2024" למספר או את
 * חותמת הזמן לתאריך. עמודות אחרות באותה שורה, אם הצוות הוסיף כאלה, אינן נדרסות.
 */
function mPutText(sh, row, obj) {
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), row - sh.getMaxRows());
  var m = mMap(sh);
  for (var h in obj) {
    if (m[h] !== undefined) sh.getRange(row, m[h] + 1).setNumberFormat('@').setValue(String(blank(obj[h])));
  }
}

/**
 * שמירה ברשימה המשותפת. שם שכבר תפוס נדחה עם code 'exists', אלא אם overwrite — ואז
 * השורה מוחלפת, והיומן שומר את תוכנה הקודם כ-JSON כי זה העותק היחיד שנשאר ממנו.
 * רצה תחת הנעילה של doPost, ולכן הבדיקה אם השם תפוס והכתיבה הן פעולה אחת.
 */
function mSaveDivision(d, overwrite, who) {
  d = d || {};
  var name = String(blank(d.name)).trim();
  var bad = mDivNameProblem(name);
  if (bad) return { ok: false, code: 'name', error: bad };
  if (!d.config || typeof d.config !== 'object' || !(d.config.levels instanceof Array)) {
    return { ok: false, error: 'חסרות הגדרות החלוקה.' };
  }
  var columns = d.columns instanceof Array ? d.columns
    : d.config.levels.map(function (l) { return l.column; });
  var labels = d.labels && typeof d.labels === 'object' ? d.labels : {};

  var obj = {
    'שם החלוקה': name,
    'עמודות': JSON.stringify(columns),
    'שמות העמודות': JSON.stringify(labels),
    'הגדרות': JSON.stringify(d.config),
    'נשמר על ידי': who,
    'נשמר בתאריך': Utilities.formatDate(new Date(), 'Asia/Jerusalem', "yyyy-MM-dd'T'HH:mm:ssXXX")
  };
  for (var h in obj) {
    if (String(obj[h]).length > DIV_CELL_MAX) return { ok: false, error: 'החלוקה גדולה מדי לשמירה בגיליון.' };
  }

  var sh = mDivSheet();
  var at = mFindRowBy(sh, 'שם החלוקה', name);
  if (at && !overwrite) return { ok: false, code: 'exists', error: 'כבר יש חלוקה בשם הזה.' };

  var stages = mDivStages(columns, labels);
  if (at) {
    var old = mOne(sh, at);
    delete old._row;
    mLog(who, name, 'החלפת חלוקה', '—', JSON.stringify(old), stages, '');
  } else {
    at = sh.getLastRow() + 1;
    mLog(who, name, 'שמירת חלוקה', '—', '', stages, '');
  }
  mPutText(sh, at, obj);

  return { ok: true, division: {
    name: name, columns: columns, labels: labels, savedBy: who, savedAt: obj['נשמר בתאריך']
  } };
}

/** מחיקה של ממש, כמו במדדים הפוטנציאליים: כל תוכן השורה נשמר ב«ערך קודם» ביומן */
function mDeleteDivision(name, who) {
  var key = String(blank(name)).trim();
  var sh = mDivSheet();
  var at = key ? mFindRowBy(sh, 'שם החלוקה', key) : null;
  if (!at) return { ok: false, code: 'missing', error: 'החלוקה הזאת כבר לא ברשימה.' };

  var snap = mOne(sh, at);
  delete snap._row;
  mLog(who, key, 'מחיקת חלוקה', '—', JSON.stringify(snap), '', '');
  sh.deleteRow(at);
  return { ok: true, deleted: key };
}

/* ---------- בדיקה מתוך העורך ---------- */

function mDiag() {
  var names = book().getSheets().map(function (s) { return s.getName(); });
  Logger.log('גיליון: ' + book().getName());
  Logger.log('לשוניות: ' + names.join(', '));
  Logger.log('מדדים: ' + mRead(mSheet(M.IND, IND_COLS)).length);
  Logger.log('הערות: ' + mRead(mSheet(M.CMT, CMT_COLS)).length);
  Logger.log('שורות יומן: ' + mRead(mSheet(M.CHG, CHG_COLS)).length);
  Logger.log('מדדים פוטנציאליים: ' + mRead(mSheet(M.POT, POT_COLS)).length);
  Logger.log('משימות: ' + mRead(mSheet(M.TSK, TSK_COLS)).length);
  Logger.log('חלוקות שמורות: ' + mDivRows().length);
  Logger.log('סיסמת ניהול מוגדרת: ' +
    (PropertiesService.getScriptProperties().getProperty('ADMIN_PASS') ? 'כן' : 'לא'));
  return 'ok';
}
