# -*- coding: utf-8 -*-
"""Builds assets/data.js for the 'Compass for Local Authorities' app from the source CSVs."""
import csv, io, json, os, collections

SRC = u"c:/Users/Amir Ron/OneDrive - Know Your Data/BABI/Dashboard Open Data/Clients/Molsa/\u05de\u05e9\u05d7\u05d9\u05dd"
OUT = SRC + u"/\u05db\u05dc\u05d9 \u05e2\u05d6\u05e8 \u05dc\u05e1\u05d3\u05e0\u05d4 - \u05de\u05e0\u05d4\u05dc\u05d9 \u05e0\u05e4\u05d5\u05ea/assets/data.js"

NATIONAL = u"\u05d0\u05e8\u05e6\u05d9"  # "ארצי"


def rd(name):
    return list(csv.DictReader(io.open(os.path.join(SRC, name), encoding='utf-8-sig')))


tax_rows = rd(u"\u05de\u05e1\u05e4\u05e8 \u05d0\u05d9\u05e0\u05d3\u05e7\u05d8\u05d5\u05e8\u05d9\u05dd \u05dc\u05e4\u05d9 \u05e0\u05d5\u05e9\u05d0 \u05d5\u05ea\u05ea \u05e0\u05d5\u05e9\u05d0.csv")
ix_rows = rd(u"\u05e8\u05e9\u05d9\u05de\u05ea \u05de\u05d3\u05d3\u05d9\u05dd \u05de\u05e9\u05d7\u05d9\u05dd.csv")
nat_rows = rd(u"\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05d0\u05e8\u05e6\u05d9\u05d9\u05dd \u05de\u05d3\u05d3\u05d9 \u05de\u05d7\u05dc\u05e7\u05d5\u05ea.csv")
dis_rows = rd(u"\u05e0\u05ea\u05d5\u05e0\u05d9 \u05e0\u05e4\u05d5\u05ea \u05de\u05d3\u05d3\u05d9 \u05de\u05d7\u05dc\u05e7\u05d5\u05ea.csv")

# ---- taxonomy -------------------------------------------------------------
THEME_ORDER = [
    u"\u05ea\u05e9\u05ea\u05d9\u05d5\u05ea \u05e2\u05d1\u05d5\u05d3\u05d4",
    u"\u05ea\u05e4\u05e7\u05d5\u05d3 \u05de\u05e7\u05e6\u05d5\u05e2\u05d9 \u05e9\u05dc \u05d4\u05e2\u05d5\u05d1\u05d3\u05d9\u05dd",
    u"\u05ea\u05e4\u05e7\u05d5\u05d3 \u05de\u05e7\u05e6\u05d5\u05e2\u05d9 \u05e9\u05dc \u05d4\u05de\u05d7\u05dc\u05e7\u05d4",
    u"\u05e9\u05d9\u05e8\u05d5\u05ea \u05dc\u05ea\u05d5\u05e9\u05d1",
    u"\u05d0\u05e7\u05dc\u05d9\u05dd \u05d0\u05e8\u05d2\u05d5\u05e0\u05d9 \u05d5\u05ea\u05e8\u05d1\u05d5\u05ea \u05d0\u05e8\u05d2\u05d5\u05e0\u05d9\u05ea",
]

subs_by_theme = collections.OrderedDict()
for r in tax_rows:
    t = r[u'\u05e0\u05d5\u05e9\u05d0'].strip()
    s = r[u'\u05ea\u05ea \u05e0\u05d5\u05e9\u05d0'].strip()
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


DETAIL_PREFIX = u"\u05d0\u05d9\u05d5\u05e9 \u05ea\u05e7\u05e0\u05d9\u05dd - "  # per-role staffing breakdown rows

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


# ---- series (national + districts) ----------------------------------------
def parse_val(s):
    s = s.strip()
    if s.endswith('%'):
        s = s[:-1]
    return float(s.replace(',', ''))


# raw[id][scope][ym] = value
raw = collections.defaultdict(lambda: collections.defaultdict(dict))
unknown = set()

for rows in (nat_rows, dis_rows):
    for r in rows:
        nm = clean(r['IX_Name'])
        d = by_name.get(nm)
        if not d:
            unknown.add(nm)
            continue
        scope = r[u'\u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4'].strip()
        ym = r[u'\u05d7\u05d5\u05d3\u05e9 \u05d5\u05e9\u05e0\u05d4'][:7]
        raw[d["id"]][scope][ym] = round(parse_val(r['DE_Index_Trend']), 3)

if unknown:
    print("UNMATCHED SERIES NAMES:", unknown)

# Series that break at a known point: from these months on the values jump in a
# way that reflects a change in recording rather than in the field, so the tail
# is dropped. Key is the first month NOT shown.
CUTOFF = {
    1031: "2025-05",  # ahuz tefusa be-misgarot
    1032: "2025-05",  # mushamim lelo nizkakut
    1035: "2025-12",  # meshech tipul be-pniyat tzibur
}

# Shared month axis per indicator; values aligned per scope (null where missing).
series = {}
for ix_id, scopes in raw.items():
    months = sorted({ym for sc in scopes.values() for ym in sc})
    cut = CUTOFF.get(ix_id)
    if cut:
        months = [m for m in months if m < cut]
    vals = {}
    for scope, pts in scopes.items():
        vals[scope] = [pts.get(m) for m in months]
    series[ix_id] = {"m": months, "v": vals}

districts = sorted({sc for scopes in raw.values() for sc in scopes if sc != NATIONAL})
scopes_all = [NATIONAL] + districts

# ---- funnel (mapping process, from the methodology deck) ------------------
funnel = [
    {"label": u"\u05d0\u05d9\u05e0\u05d3\u05d9\u05e7\u05d8\u05d5\u05e8\u05d9\u05dd \u05e9\u05de\u05d5\u05e4\u05d5", "value": 156,
     "note": u"\u05db\u05dc\u05dc \u05d4\u05d0\u05d9\u05e0\u05d3\u05d9\u05e7\u05d8\u05d5\u05e8\u05d9\u05dd \u05e9\u05e2\u05dc\u05d5 \u05d1\u05de\u05d9\u05e4\u05d5\u05d9 \u05de\u05d5\u05dc \u05d1\u05e2\u05dc\u05d9 \u05d4\u05e2\u05e0\u05d9\u05d9\u05df"},
    {"label": u"\u05de\u05ea\u05d5\u05e2\u05d3\u05e4\u05d9\u05dd \u05e2\u05e1\u05e7\u05d9\u05ea", "value": 60,
     "note": u"\u05d0\u05d9\u05e0\u05d3\u05d9\u05e7\u05d8\u05d5\u05e8\u05d9\u05dd \u05e9\u05e0\u05d1\u05d7\u05e8\u05d5 \u05db\u05d1\u05e2\u05dc\u05d9 \u05e2\u05e8\u05da \u05e0\u05d9\u05d4\u05d5\u05dc\u05d9 \u05d2\u05d1\u05d5\u05d4"},
    {"label": u"\u05e4\u05d5\u05d8\u05e0\u05e6\u05d9\u05d0\u05dc \u05dc\u05e4\u05d9\u05ea\u05d5\u05d7", "value": 32,
     "note": u"\u05d0\u05d9\u05e0\u05d3\u05d9\u05e7\u05d8\u05d5\u05e8\u05d9\u05dd \u05e9\u05e7\u05d9\u05d9\u05dd \u05e2\u05d1\u05d5\u05e8\u05dd \u05de\u05e7\u05d5\u05e8 \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05d1\u05e8-\u05de\u05d9\u05de\u05d5\u05e9"},
    {"label": u"\u05e7\u05d9\u05d9\u05de\u05d9\u05dd \u05d1\u05de\u05e2\u05e8\u05db\u05ea", "value": 18,
     "note": u"\u05de\u05d3\u05d3\u05d9\u05dd \u05e9\u05e4\u05d5\u05ea\u05d7\u05d5 \u05d5\u05e2\u05d5\u05dc\u05d9\u05dd \u05d1\u05de\u05e2\u05e8\u05db\u05ea \u05d4\u05de\u05d3\u05d9\u05d3\u05d4"},
]

meta = {
    "system": u"\u05de\u05e6\u05e4\u05df \u05e8\u05e9\u05d5\u05d9\u05d5\u05ea \u05de\u05e7\u05d5\u05de\u05d9\u05d5\u05ea",
    "subtitle": u"\u05de\u05e4\u05ea \u05de\u05d3\u05d3\u05d9\u05dd \u05dc\u05d4\u05e2\u05e8\u05db\u05ea \u05d0\u05d9\u05db\u05d5\u05ea \u05e2\u05d1\u05d5\u05d3\u05ea \u05d4\u05de\u05d7\u05dc\u05e7\u05d5\u05ea \u05dc\u05e9\u05d9\u05e8\u05d5\u05ea\u05d9\u05dd \u05d7\u05d1\u05e8\u05ea\u05d9\u05d9\u05dd",
    "owner": u"\u05d0\u05d2\u05e3 \u05d1\u05db\u05d9\u05e8 \u05d0\u05d9\u05db\u05d5\u05ea, \u05e4\u05d9\u05e7\u05d5\u05d7 \u05d5\u05d1\u05e7\u05e8\u05d4",
    "national": NATIONAL,
}

HEADER = u"""/* ============================================================
   \u05de\u05e6\u05e4\u05df \u05e8\u05e9\u05d5\u05d9\u05d5\u05ea \u05de\u05e7\u05d5\u05de\u05d9\u05d5\u05ea \u2014 \u05e9\u05db\u05d1\u05ea \u05d4\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd
   \u05e0\u05d5\u05e6\u05e8 \u05d0\u05d5\u05d8\u05d5\u05de\u05d8\u05d9\u05ea \u05de\u05e7\u05d1\u05e6\u05d9 \u05d4\u05de\u05e7\u05d5\u05e8 (tools/gen_data.py):
     \u2022 \u05e8\u05e9\u05d9\u05de\u05ea \u05de\u05d3\u05d3\u05d9\u05dd \u05de\u05e9\u05d7\u05d9\u05dd.csv
     \u2022 \u05de\u05e1\u05e4\u05e8 \u05d0\u05d9\u05e0\u05d3\u05e7\u05d8\u05d5\u05e8\u05d9\u05dd \u05dc\u05e4\u05d9 \u05e0\u05d5\u05e9\u05d0 \u05d5\u05ea\u05ea \u05e0\u05d5\u05e9\u05d0.csv
     \u2022 \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05d0\u05e8\u05e6\u05d9\u05d9\u05dd \u05de\u05d3\u05d3\u05d9 \u05de\u05d7\u05dc\u05e7\u05d5\u05ea.csv
     \u2022 \u05e0\u05ea\u05d5\u05e0\u05d9 \u05e0\u05e4\u05d5\u05ea \u05de\u05d3\u05d3\u05d9 \u05de\u05d7\u05dc\u05e7\u05d5\u05ea.csv
   ============================================================ */

const META = {meta};

/* \u05d7\u05de\u05e9\u05ea \u05d4\u05e0\u05d5\u05e9\u05d0\u05d9\u05dd \u05d5\u05ea\u05ea\u05d9 \u05d4\u05e0\u05d5\u05e9\u05d0\u05d9\u05dd */
const THEMES = {themes};

/* \u05e8\u05de\u05d5\u05ea \u05ea\u05e6\u05d5\u05d2\u05d4: \u05d0\u05e8\u05e6\u05d9 + \u05e0\u05e4\u05d5\u05ea */
const SCOPES = {scopes};

/* \u05e9\u05dc\u05d1\u05d9 \u05ea\u05d4\u05dc\u05d9\u05da \u05de\u05d9\u05e4\u05d5\u05d9 \u05d4\u05d0\u05d9\u05e0\u05d3\u05d9\u05e7\u05d8\u05d5\u05e8\u05d9\u05dd */
const FUNNEL = {funnel};

/* \u05db\u05dc \u05d4\u05de\u05d3\u05d3\u05d9\u05dd. core=1 \u2192 \u05de\u05d3\u05d3 \u05e8\u05d0\u05e9\u05d9, core=0 \u2192 \u05e4\u05d9\u05e8\u05d5\u05d8 \u05d0\u05d9\u05d5\u05e9 \u05dc\u05e4\u05d9 \u05ea\u05e4\u05e7\u05d9\u05d3 */
const INDICATORS = {inds};

/* \u05e1\u05d3\u05e8\u05d5\u05ea \u05e2\u05ea: id \u2192 { m:[\u05d7\u05d5\u05d3\u05e9\u05d9\u05dd], v:{ \u05e8\u05de\u05d4: [\u05e2\u05e8\u05db\u05d9\u05dd \u05de\u05d5\u05dc \u05d0\u05d5\u05ea\u05d5 \u05e6\u05d9\u05e8] } } */
const SERIES = {series};
"""

js = (HEADER
      .replace("{meta}", json.dumps(meta, ensure_ascii=False, indent=2))
      .replace("{themes}", json.dumps(themes, ensure_ascii=False, indent=2))
      .replace("{scopes}", json.dumps(scopes_all, ensure_ascii=False))
      .replace("{funnel}", json.dumps(funnel, ensure_ascii=False, indent=2))
      .replace("{inds}", json.dumps(inds, ensure_ascii=False, indent=1))
      .replace("{series}", json.dumps(series, ensure_ascii=False)))

io.open(OUT, 'w', encoding='utf-8', newline='\n').write(js)
print("wrote", OUT.encode('utf-8'), len(js), "chars")
print("indicators:", len(inds), "core:", sum(d['core'] for d in inds), "map:", sum(d['map'] for d in inds))
print("series:", len(series), "scopes:", len(scopes_all), scopes_all)
