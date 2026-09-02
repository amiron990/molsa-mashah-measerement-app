# -*- coding: utf-8 -*-
"""Builds assets/data.js for the 'Compass for Local Authorities' app from the source CSVs.

Values come from one file, נתונים.csv, which carries all three reporting levels:
national, district (מחוז) and sub-district (נפה). Its `Pop_Category_Heb` column
is the level and `קטגוריה` is the name.

Level and name together form the scope key, because the two are not unique on
their own: ירושלים is both a district and a sub-district, with different series.
Keying by name alone would have silently merged them.
"""
import csv, io, json, os, collections

SRC = u"c:/Users/Amir Ron/OneDrive - Know Your Data/BABI/Dashboard Open Data/Clients/Molsa/משחים"
APP = SRC + u"/כלי עזר לסדנה - מנהלי נפות"
OUT = APP + u"/assets/data.js"

NATIONAL = u"ארצי"
DISTRICT = u"מחוז"
SUBDIST = u"נפה"

# סדר הרמות בבורר רמת התצוגה, ושם הקבוצה שמעליהן
LEVELS = [
    (NATIONAL, u"ארצי"),
    (DISTRICT, u"מחוזות"),
    (SUBDIST, u"נפות"),
]

SEP = u"§"   # מפריד בין רמה לשם במפתח הסקופ


def rd(name, root=None):
    return list(csv.DictReader(io.open(os.path.join(root or SRC, name), encoding='utf-8-sig')))


tax_rows = rd(u"מספר אינדקטורים לפי נושא ותת נושא.csv")
ix_rows = rd(u"רשימת מדדים משחים.csv")
val_rows = rd(u"נתונים.csv", APP)

# ---- taxonomy -------------------------------------------------------------
THEME_ORDER = [
    u"תשתיות עבודה",
    u"תפקוד מקצועי של העובדים",
    u"תפקוד מקצועי של המחלקה",
    u"שירות לתושב",
    u"אקלים ארגוני ותרבות ארגונית",
]

subs_by_theme = collections.OrderedDict()
for r in tax_rows:
    t = r[u'נושא'].strip()
    s = r[u'תת נושא'].strip()
    subs_by_theme.setdefault(t, [])
    if s not in subs_by_theme[t]:
        subs_by_theme[t].append(s)

themes = []
for i, t in enumerate(THEME_ORDER):
    themes.append({"id": "t%d" % (i + 1), "name": t, "subs": subs_by_theme[t]})

# ---- indicators -----------------------------------------------------------
def clean(v):
    if v is None:
        return ""
    v = v.strip()
    if v in ("NULL", ""):
        return ""
    return " ".join(v.split())


DETAIL_PREFIX = u"איוש תקנים - "   # per-role staffing breakdown rows

inds = []
for r in ix_rows:
    name = clean(r['IX_Name'])
    inds.append({
        "id": int(r['IX_ID']),
        "name": name,
        "short": clean(r['IX_NameShort']) or name,
        "theme": clean(r['IX_MainSubject']),
        "sub": clean(r['IX_Str_Step']),
        "desc": clean(r['IX_Description']).strip('"'),
        "nom": clean(r['IX_Description_Nominator']) or clean(r['IX_Nominator']),
        "den": clean(r['IX_Description_Denominator']) or clean(r['IX_Denominator']),
        "identity": clean(r['IX_Identity']),
        "unit": clean(r['IX_MeasurementUnit']),
        "source": clean(r['IX_SourceName']),
        "freq": clean(r['IX_Frequency']),
        "positive": None if clean(r['IX_Positive_Ind']) == "" else int(r['IX_Positive_Ind']),
        "map": int(r['IX_Map_Ind']),
        "focus": int(r['IX_MapFocus_Ind']),
        "status": clean(r['IX_Status']),
        "core": 0 if name.startswith(DETAIL_PREFIX) else 1,
        "order": int(r['IX_Order']),
    })

by_name = {}
for d in inds:
    by_name.setdefault(d["name"], d)

# נתונים.csv מכנה מדד אחד בשם מאוחר יותר מזה שברשימת המדדים. בלי הגישור הזה
# הסדרה שלו נופלת בשקט והמדד מוצג כאילו אין לו נתונים.
RENAMES = {
    u"אחוז תפוסה במסגרות בקהילה": u"אחוז תפוסה במסגרות",   # id 1031
}
for alias, canonical in RENAMES.items():
    if canonical in by_name:
        by_name[alias] = by_name[canonical]


# ---- series (national + districts + sub-districts) ------------------------
def parse_val(s):
    s = (s or "").strip()
    if not s:
        return None
    if s.endswith('%'):
        s = s[:-1]
    try:
        return float(s.replace(',', ''))
    except ValueError:
        return None


def scope_key(level, name):
    """ארצי is its own key; the other two levels are namespaced by level,
    because a name alone is not unique across them (ירושלים)."""
    return name if level == NATIONAL else level + SEP + name


# raw[id][scope_key][ym] = value
raw = collections.defaultdict(lambda: collections.defaultdict(dict))
unknown_names = set()
unknown_levels = collections.Counter()
scope_meta = {}          # key -> {level, name}

for r in val_rows:
    nm = clean(r['IX_Name'])
    d = by_name.get(nm)
    if not d:
        unknown_names.add(nm)
        continue

    level = clean(r['Pop_Category_Heb'])
    name = clean(r[u'קטגוריה'])
    if level not in (NATIONAL, DISTRICT, SUBDIST):
        unknown_levels[level] += 1
        continue

    v = parse_val(r['DE_Index_Trend'])
    if v is None:
        continue

    key = scope_key(level, name)
    scope_meta[key] = {"key": key, "name": name, "level": level}
    raw[d["id"]][key][r[u'חודש ושנה'][:7]] = round(v, 3)

if unknown_names:
    print("UNMATCHED SERIES NAMES:", len(unknown_names))
if unknown_levels:
    print("UNKNOWN LEVELS:", dict(unknown_levels))

# Series that break at a known point: from these months on the values jump in a
# way that reflects a change in recording rather than in the field, so the tail
# is dropped. Key is the first month NOT shown.
CUTOFF = {
    1031: "2025-05",   # ahuz tefusa be-misgarot
    1032: "2025-05",   # mushamim lelo nizkakut
    1034: "2026-01",   # pniyot tzibur - reporting stops, tail is all zeros
    1035: "2025-12",   # meshech tipul be-pniyat tzibur
}

# Shared month axis per indicator; values aligned per scope (null where missing).
series = {}
for ix_id, scopes in raw.items():
    months = sorted({ym for sc in scopes.values() for ym in sc})
    cut = CUTOFF.get(ix_id)
    if cut:
        months = [m for m in months if m < cut]
    vals = {}
    for key, pts in scopes.items():
        vals[key] = [pts.get(m) for m in months]
    series[ix_id] = {"m": months, "v": vals}

# Scopes ordered by level, alphabetically within each level.
scopes_all = []
for level, _label in LEVELS:
    named = [m for m in scope_meta.values() if m["level"] == level]
    scopes_all.extend(sorted(named, key=lambda m: m["name"]))

level_labels = [{"level": lv, "label": lb} for lv, lb in LEVELS]

# ---- funnel (mapping process, from the methodology deck) ------------------
funnel = [
    {"label": u"אינדיקטורים שמופו", "value": 156,
     "note": u"כלל האינדיקטורים שעלו במיפוי מול בעלי העניין"},
    {"label": u"מתועדפים עסקית", "value": 60,
     "note": u"אינדיקטורים שנבחרו כבעלי ערך ניהולי גבוה"},
    {"label": u"פוטנציאל לפיתוח", "value": 32,
     "note": u"אינדיקטורים שקיים עבורם מקור נתונים בר-מימוש"},
    {"label": u"קיימים במערכת", "value": 18,
     "note": u"מדדים שפותחו ועולים במערכת המדידה"},
]

meta = {
    "system": u"מצפן רשויות מקומיות",
    "subtitle": u"מפת מדדים להערכת איכות עבודת המחלקות לשירותים חברתיים",
    "owner": u"אגף בכיר איכות, פיקוח ובקרה",
    "national": NATIONAL,
}

HEADER = u"""/* ============================================================
   מצפן רשויות מקומיות — שכבת הנתונים
   נוצר אוטומטית מקבצי המקור (tools/gen_data.py):
     • רשימת מדדים משחים.csv
     • מספר אינדקטורים לפי נושא ותת נושא.csv
     • נתונים.csv — ערכים לשלוש הרמות: ארצי, מחוז ונפה
   ============================================================ */

const META = {meta};

/* חמשת הנושאים ותתי הנושאים */
const THEMES = {themes};

/* רמות התצוגה. key הוא המפתח ב-SERIES, name מה שמוצג, level שיוך לקבוצה.
   שם לבדו אינו ייחודי — «ירושלים» היא גם מחוז וגם נפה — ולכן המפתח כולל רמה. */
const SCOPES = {scopes};

/* כותרות הקבוצות בבורר רמת התצוגה, לפי הסדר */
const SCOPE_LEVELS = {levels};

/* שלבי תהליך מיפוי האינדיקטורים */
const FUNNEL = {funnel};

/* כל המדדים. core=1 → מדד ראשי, core=0 → פירוט איוש לפי תפקיד */
const INDICATORS = {inds};

/* סדרות עת: id → { m:[חודשים], v:{ מפתח רמה: [ערכים מול אותו ציר] } } */
const SERIES = {series};
"""

js = (HEADER
      .replace("{meta}", json.dumps(meta, ensure_ascii=False, indent=2))
      .replace("{themes}", json.dumps(themes, ensure_ascii=False, indent=2))
      .replace("{scopes}", json.dumps(scopes_all, ensure_ascii=False, indent=1))
      .replace("{levels}", json.dumps(level_labels, ensure_ascii=False))
      .replace("{funnel}", json.dumps(funnel, ensure_ascii=False, indent=2))
      .replace("{inds}", json.dumps(inds, ensure_ascii=False, indent=1))
      .replace("{series}", json.dumps(series, ensure_ascii=False)))

io.open(OUT, 'w', encoding='utf-8', newline='\n').write(js)

print("wrote data.js:", len(js), "chars")
print("indicators:", len(inds), "core:", sum(d['core'] for d in inds), "map:", sum(d['map'] for d in inds))
print("series:", len(series))
for level, _ in LEVELS:
    n = len([m for m in scopes_all if m["level"] == level])
    print("scopes", repr(level.encode('utf-8')), ":", n)
