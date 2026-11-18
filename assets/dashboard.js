/* ============================================================
   מצפן רשויות מקומיות — עץ קבוצות דומים (dashboard.html)

   הנתונים ב-assets/dashboard_data.js והחלוקה המומלצת ב-assets/dashboard_split.js.
   שניהם נבנים בריפו mashah-similarity-groups-dashboard (dashboard/build_data.py)
   ומועתקים לכאן — לא לערוך ידנית.

   הדף משווה חלוקות, זו מתחת לזו. createDivision בונה חלוקה אחת ומחזיק את כל המצב שלה;
   מה שמחוצה לו משותף: הנתונים, חישוב העץ, הציונים (R² או מדד מטרה, `scoring`), החיפוש של
   הספים, הדיאלוגים והדף עצמו (בסוף הקובץ).
   ============================================================ */
(() => {
  'use strict';

  const D = window.MASHAH_DATA;
  const REC = window.RECOMMENDED_SPLIT || { levels: [] };
  if (!D) {
    document.querySelector('main').innerHTML =
      '<p class="panel empty-state">נתוני הדשבורד לא נמצאו.</p>';
    return;
  }

  // Set by build_artifact.py: the shared page cannot download files or keep state in the
  // URL.
  const IN_ARTIFACT = !!window.MASHAH_ARTIFACT;
  // The tree's stages, in the order the user sets: one per characteristic, offering only its
  // own columns, and an optional extra stage that offers every column. A stage is known by its
  // slot: the characteristic's key, or EXTRA.
  const THEMES = D.themes;
  const EXTRA = 'EXTRA';
  const SLOT_LABEL = { ...Object.fromEntries(THEMES.map(t => [t.key, t.label])), [EXTRA]: 'פרמטר נוסף' };
  const AUTH = D.authorities;
  const COLS = D.columns;
  const COL = {};
  const SCALE_NAMES = { linear: 'לינארית', quantile: 'אחוזונים' };
  // Columns the data has but the lists of columns do not offer. A split saved with one still
  // shows it in its stage.
  const OFF_LIST = new Set(['pop_19_20', 'shr_19_20', 'fin_is_regional_council']);

  // Blue ordinal ramp (steps 250-650): segments are ordered low -> high.
  const RAMP = ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const collator = new Intl.Collator('he');
  const AUTH_BY_ID = new Map(AUTH.map(a => [a.id, a]));
  AUTH.forEach((a, ai) => { a.ai = ai; });

  COLS.forEach((c, i) => {
    c.idx = i;
    // one form for every placement column, as the rates already have it: "מושמי ..." and not
    // "מושמים - ..."; the total reads "סה"כ מושמים ...", like its rate
    c.label = c.label.replace(/^מושמים - סה"כ/, 'סה"כ מושמים').replace(/^מושמים - /, 'מושמי ');
    c.short = c.short || c.label;
    c.offList = OFF_LIST.has(c.key);
    c.sorted = AUTH.map(a => a.v[i]).filter(v => v != null).sort((a, b) => a - b);
    c.missing = AUTH.length - c.sorted.length;
    c.min = c.sorted[0];
    c.max = c.sorted[c.sorted.length - 1];
    c.median = c.sorted[Math.floor(c.sorted.length / 2)];
    c.discrete = c.kind === 'binary' || c.kind === 'ordinal' || c.kind === 'category';
    if (c.discrete) {
      c.cats = [...new Set(c.sorted)];
      c.catIdx = new Map(c.cats.map((v, k) => [v, k]));
    }
    // very skewed columns (counts of residents, placements) open in percentiles
    c.defaultScale = c.discrete ? 'band'
      : (c.min >= 0 && c.median > 0 && c.max / c.median > 8 ? 'quantile' : 'linear');
    COL[c.key] = c;
  });

  // ---------- formatting ----------
  const NF = {};
  const nf = d => (NF[d] ||= new Intl.NumberFormat('he-IL', { maximumFractionDigits: d }));
  function num(x) {
    if (Math.abs(x) >= 100) return nf(0).format(Math.round(x));
    if (x === 0) return '0';
    return nf(4).format(Number(x.toPrecision(3)));
  }
  function fmt(v, col) {
    if (v == null) return 'אין נתון';
    if (col.discrete && col.categories[String(v)] != null) return col.categories[String(v)];
    if (col.kind === 'percent') return num(v * 100) + '%';
    if (col.kind === 'count') return nf(0).format(Math.round(v));
    return num(v);
  }
  // Round a dragged threshold to 2 significant digits in display units.
  function niceRound(v, col) {
    if (col.discrete || !isFinite(v)) return v;
    const unit = col.kind === 'percent' ? 100 : 1;
    const x = v * unit;
    if (x === 0) return 0;
    let step = Math.pow(10, Math.floor(Math.log10(Math.abs(x))) - 1);
    if (col.kind === 'count') step = Math.max(1, step);
    return Number(((Math.round(x / step) * step) / unit).toPrecision(12));
  }
  const editStr = (v, col) => String(Number((col.kind === 'percent' ? v * 100 : v).toPrecision(10)));
  function parseInput(s, col) {
    const t = s.replace(/[,\s%]/g, '');
    if (t === '') return null;
    const x = Number(t);
    if (!isFinite(x)) return null;
    return col.kind === 'percent' ? x / 100 : x;
  }

  // ---------- scales: value <-> position p in [0,1] (0 = lowest value) ----------
  function interp(xs, ys, x) {
    const n = xs.length;
    if (n === 1 || x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    return ys[lo] + (x - xs[lo]) / (xs[hi] - xs[lo]) * (ys[hi] - ys[lo]);
  }
  function makeScale(col, type) {
    if (col.discrete) {
      const cats = col.cats, k = cats.length;
      return {
        toP(v) {
          const i = cats.indexOf(v);
          if (i >= 0) return (i + 0.5) / k;
          const b = cats.findIndex(c => c > v);
          return (b < 0 ? k : b) / k;
        },
        fromP(p) {
          const b = clamp(Math.round(p * k), 1, k - 1);
          return (cats[b - 1] + cats[b]) / 2;
        },
      };
    }
    const { min, max } = col;
    if (max === min) return { toP: () => 0.5, fromP: () => min };
    if (type === 'quantile') {
      const s = col.sorted, u = [], q = [];
      for (let i = 0; i < s.length;) {
        let j = i;
        while (j < s.length && s[j] === s[i]) j++;
        u.push(s[i]);
        q.push((i + j - 1) / 2);
        i = j;
      }
      const q0 = q[0], q1 = q[q.length - 1];
      const qn = q.map(x => (x - q0) / (q1 - q0));
      return { toP: v => interp(u, qn, v), fromP: p => interp(qn, u, p) };
    }
    return { toP: v => (v - min) / (max - min), fromP: p => min + p * (max - min) };
  }
  // RTL: low values sit on the right.
  const xOf = (p, w) => (1 - clamp(p, 0, 1)) * w;

  function rampColor(i, n) {
    const R = RAMP;
    if (n <= 1) return 'var(--axis)';
    return R[Math.round(i * (R.length - 1) / (n - 1))];
  }

  function segLabels(col, ts) {
    if (col.discrete) {
      const out = [];
      let lo = -Infinity;
      for (let s = 0; s <= ts.length; s++) {
        const hi = s < ts.length ? ts[s] : Infinity;
        const cs = col.cats.filter(c => c >= lo && c < hi).map(c => col.categories[String(c)] ?? c);
        // categories without an order (kind 'category') are listed; ordered ones give a range
        out.push(!cs.length ? 'ריק' : cs.length <= 2 || col.kind === 'category' ? cs.join(', ') : `${cs[0]} עד ${cs[cs.length - 1]}`);
        lo = hi;
      }
      return out;
    }
    if (!ts.length) return ['ללא פיצול'];
    const f = v => fmt(v, col);
    return Array.from({ length: ts.length + 1 }, (_, s) =>
      s === 0 ? `פחות מ-${f(ts[0])}`
        : s === ts.length ? `${f(ts[s - 1])} ומעלה`
          : `${f(ts[s - 1])} עד ${f(ts[s])}`);
  }

  // ---------- group names: the step taken at each stage, in words ----------
  const ADJ = {
    low: { m: 'נמוך', f: 'נמוכה', mp: 'נמוכים', fp: 'נמוכות' },
    mid: { m: 'בינוני', f: 'בינונית', mp: 'בינוניים', fp: 'בינוניות' },
    high: { m: 'גבוה', f: 'גבוהה', mp: 'גבוהים', fp: 'גבוהות' },
    small: { m: 'קטן', f: 'קטנה', mp: 'קטנים', fp: 'קטנות' },
    large: { m: 'גדול', f: 'גדולה', mp: 'גדולים', fp: 'גדולות' },
  };
  // A segment's word by its rank among the n segments of its branch, and whether it adds "מאוד".
  const RANKS = {
    2: [['low'], ['high']],
    3: [['low'], ['mid'], ['high']],
    4: [['low', true], ['low'], ['high'], ['high', true]],
    5: [['low', true], ['low'], ['mid'], ['high'], ['high', true]],
  };
  function stepName({ col, label, s, n, ts }) {
    const nm = col.naming || {};
    if (nm.cats && col.discrete) {
      const lo = s ? ts[s - 1] : -Infinity, hi = s < ts.length ? ts[s] : Infinity;
      const cs = col.cats.filter(c => c >= lo && c < hi);
      if (cs.length === 1 && nm.cats[String(cs[0])]) return nm.cats[String(cs[0])];
    }
    const rank = RANKS[n] && RANKS[n][s];
    if (!nm.noun || !rank) return `${col.short}: ${label}`; // more than 5 segments: say the range
    let word = rank[0];
    if (nm.scale === 'size') word = { low: 'small', high: 'large' }[word] || word;
    return `${nm.noun} ${ADJ[word][nm.g]}${rank[1] ? ' מאוד' : ''}`;
  }
  const groupName = node => pathSteps(node).map(stepName).join(' · ') || 'כל הרשויות';

  // ---------- scores ----------
  // Every division on the page is scored the same way, by one of two metrics (scoring.mode).
  // 'r2', the default, is the computation of analysis/build_tree.py tree_score: how alike the
  // authorities of a group are in the profile columns of each stage. 'target': how little one
  // chosen column, the target measurement, varies inside the groups. A metric gives each
  // authority a vector x and each stage the entries of x it is scored on, so the threshold search
  // below works for either.
  const SCORE = D.score || null;
  const PROFILE = SCORE ? new Map(SCORE.ids.map((id, k) => [id, SCORE.x[k]])) : new Map();

  // 1 - SS_within / SS_total over the columns `cols`, rows grouped by keyOf(row).
  function weightedR2(rows, cols, keyOf) {
    const n = rows.length, m = cols.length;
    if (!n || !m) return 0;
    const s1 = new Float64Array(m), groups = new Map();
    let s2 = 0;
    for (const r of rows) {
      const k = keyOf(r);
      let g = groups.get(k);
      if (!g) { g = { n: 0, s: new Float64Array(m) }; groups.set(k, g); }
      g.n++;
      for (let c = 0; c < m; c++) {
        const v = r.x[cols[c]];
        s1[c] += v;
        g.s[c] += v;
        s2 += v * v;
      }
    }
    let total = s2, within = s2;
    for (let c = 0; c < m; c++) total -= (s1[c] * s1[c]) / n;
    for (const g of groups.values()) for (let c = 0; c < m; c++) within -= (g.s[c] * g.s[c]) / g.n;
    return total > 0 ? 1 - within / total : 0;
  }

  // The target's fit, on the single value x[0]: one less the variance inside the groups over the
  // variance of all the authorities. The variance inside is pooled over the groups and divided by
  // n - k, not n, so more groups do not raise the fit by themselves: random groups fit about 0,
  // at any number of groups. This is ε², the effect size of a one-way analysis of variance
  // (adjusted R² of the target on the groups). It is 1 when every group is uniform.
  function adjustedFit(rows, keyOf) {
    let n = 0, s = 0, q = 0;
    const groups = new Map();
    for (const r of rows) {
      const y = r.x[0], k = keyOf(r), g = groups.get(k);
      n++;
      s += y;
      q += y * y;
      if (g) { g.n++; g.s += y; } else groups.set(k, { n: 1, s: y });
    }
    const total = q - (s * s) / n, k = groups.size;
    if (n - k < 1 || !(total > 1e-12 * q)) return 0;
    let within = q;
    for (const g of groups.values()) within -= (g.s * g.s) / g.n;
    return 1 - (within / (n - k)) / (total / (n - 1));
  }

  // The target measurement: the page's choice of column and scale. On the percentile scale each
  // authority's value is its rank, 0 to 100, so a few very large authorities do not decide the
  // score. TARGET holds what the scores and the distribution view need: x per authority (absent
  // without a value), and pos(y), where a value on that scale sits on the chart (0 = lowest).
  // A column of categories without an order has no variance, and cannot be a target.
  // The scale is the user's: linear until they choose otherwise, and it stays when the column
  // changes (a column of steps has no scale, and keeps the choice for the next one).
  const scoring = { mode: SCORE ? 'r2' : 'target', col: '', scale: 'linear' };
  let TARGET = null;
  const canTarget = col => !!col && col.kind !== 'category';

  function setTarget() {
    const col = scoring.mode === 'target' && canTarget(COL[scoring.col]) ? COL[scoring.col] : null;
    if (!col) { TARGET = null; return; }
    const type = col.discrete ? 'band' : SCALE_NAMES[scoring.scale] ? scoring.scale : 'linear';
    const scale = makeScale(col, type), pct = type === 'quantile', x = new Map();
    for (const a of AUTH) {
      const v = a.v[col.idx];
      if (v != null) x.set(a.id, [pct ? 100 * scale.toP(v) : v]);
    }
    const mids = col.discrete ? col.cats.map((c, k) => (k + 0.5) / col.cats.length) : null;
    const pos = col.discrete ? y => interp(col.cats, mids, y) : pct ? y => y / 100 : scale.toP;
    TARGET = { col, type, scale, x, pos };
  }

  const TARGET_HELP = 'ציון מדד המטרה, מ-0 עד 10: עד כמה הרשויות שבאותה קבוצה דומות זו לזו במדד המטרה. ' +
    'הציון הוא 10 × (1 − השונות בתוך הקבוצות ÷ השונות של כל הרשויות). השונות בתוך הקבוצות משוקללת לפי גודל הקבוצה ' +
    'ומתוקנת למספר הקבוצות, כך שחלוקה אקראית מקבלת בערך 0 גם כשיש בה הרבה קבוצות. ' +
    '10 פירושו שאין שונות בכלל בתוך הקבוצות. זה מצב חשוד, שקורה בדרך כלל כשמדד המטרה הוא אחד מפרמטרי החלוקה או קרוב לאחד מהם.';
  const METRICS = {
    r2: {
      k: 100, // the score in points out of 100
      ok: () => !!SCORE,
      xOf: id => PROFILE.get(id),
      colsOf: col => SCORE.scoreCols[col.key] || [],
      fit: weightedR2,
      chip: 'R²', score: 'ציון R²', of: 'ה-R² של השלב', inOf: 'ב-R² של השלב', ofAll: 'ה-R² שלו',
      help: () => 'כמה השלב מוסיף ל-R² המשוקלל, בנקודות: עד כמה רשויות באותה קבוצה דומות זו לזו בפרופיל העמודות.',
      scoreHelp: () => 'ציון R²: סכום מה שכל השלבים מוסיפים ל-R² המשוקלל, בנקודות. R² מודד עד כמה רשויות באותה קבוצה דומות זו לזו בפרופיל העמודות של כל שלב: ככל שהוא גבוה יותר, הקבוצות אחידות יותר.',
    },
    target: {
      k: 10, // a score out of 10
      ok: () => !!TARGET,
      xOf: id => TARGET.x.get(id),
      colsOf: () => [0],
      fit: (rows, cols, keyOf) => adjustedFit(rows, keyOf),
      chip: 'מטרה', score: 'ציון מדד המטרה', of: 'תרומת השלב לציון מדד המטרה', inOf: 'בתרומת השלב לציון מדד המטרה',
      ofAll: 'תרומתו לציון מדד המטרה',
      help: () => 'כמה השלב מוסיף לציון מדד המטרה (מתוך 10): בכמה הוא מקטין את השונות של מדד המטרה בתוך הקבוצות, ביחס לקבוצות שמעליו.',
      scoreHelp: () => TARGET_HELP + (TARGET?.type === 'quantile'
        ? ' בסקאלת אחוזונים הציון מחושב על הדירוג של הרשויות במדד, כך שכמה רשויות גדולות במיוחד לא קובעות אותו.' : ''),
    },
  };
  const metric = () => METRICS[scoring.mode];
  // changes whenever the scores change meaning, for the searches that wait on the split
  const metricSig = () => scoring.mode + (TARGET ? `:${TARGET.col.key}:${TARGET.type}` : '');

  // A score as shown: R² in points out of 100; the target out of 10, never below 0.
  const scoreValue = t => (metric().k === 10 ? 10 * clamp(t, 0, 1) : 100 * t);
  const scoreText = t => scoreValue(t).toFixed(1);
  const gainText = g => (g < 0 ? '−' : '+') + Math.abs(g * metric().k).toFixed(1);
  const scoreChip = g => (g == null ? ''
    : `<span class="r2" title="${esc(metric().help())}">${metric().chip} <span class="v">${gainText(g)}</span></span>`);

  // What each stage adds to the score: the fit of its groups less the fit of the groups above it,
  // on the columns the stage is scored on. Added up, the stages give the division's score.
  function stageGains(T) {
    const M = metric();
    if (!M.ok()) return T.act.map(() => null);
    const rows = [];
    for (const l of T.leaves) {
      for (const a of l.members) {
        const x = M.xOf(a.id);
        if (x) rows.push({ x, path: l.path });
      }
    }
    return T.act.map((A, d) => {
      const cols = M.colsOf(A.col);
      return M.fit(rows, cols, r => r.path.slice(0, d + 1).join('.')) -
        M.fit(rows, cols, r => r.path.slice(0, d).join('.'));
    });
  }

  // A target that is also a split column, or almost the same as one, scores high for that reason
  // alone. "Almost": a rank (Spearman) correlation of 0.9 or more, so a count and its share or
  // percentiles still count as close.
  const TOO_CLOSE = 0.9;
  const RANKED = new Map(); // column key -> Map(authority id -> rank, ties sharing the mean rank)
  function ranksOf(col) {
    if (RANKED.has(col.key)) return RANKED.get(col.key);
    const xs = AUTH.filter(a => a.v[col.idx] != null).sort((a, b) => a.v[col.idx] - b.v[col.idx]), r = new Map();
    for (let i = 0; i < xs.length;) {
      let j = i;
      while (j < xs.length && xs[j].v[col.idx] === xs[i].v[col.idx]) j++;
      for (let k = i; k < j; k++) r.set(xs[k].id, (i + j - 1) / 2);
      i = j;
    }
    RANKED.set(col.key, r);
    return r;
  }
  function rankCorr(c1, c2) {
    const r1 = ranksOf(c1), r2 = ranksOf(c2), ps = [];
    for (const [id, a] of r1) { const b = r2.get(id); if (b != null) ps.push([a, b]); }
    const n = ps.length;
    if (n < 3) return 0;
    const ma = ps.reduce((s, p) => s + p[0], 0) / n, mb = ps.reduce((s, p) => s + p[1], 0) / n;
    let sab = 0, saa = 0, sbb = 0;
    for (const [a, b] of ps) { sab += (a - ma) * (b - mb); saa += (a - ma) ** 2; sbb += (b - mb) ** 2; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
  }
  // The stages of tree T whose column is the target, or close to it.
  function targetIssues(T) {
    if (!TARGET) return [];
    return T.act.flatMap(A => {
      if (A.col.key === TARGET.col.key) return [{ A, same: true }];
      if (isCatCol(A.col)) return [];
      const r = rankCorr(A.col, TARGET.col);
      return Math.abs(r) >= TOO_CLOSE ? [{ A, r }] : [];
    });
  }
  const issueText = x => (x.same
    ? `מדד המטרה הוא גם פרמטר החלוקה בשלב "${SLOT_LABEL[x.A.slot]}". הקבוצות נבנו לפיו, ולכן השונות שלו בתוכן קטנה מטבעה, והציון לא מלמד הרבה על החלוקה.`
    : `מדד המטרה קשור מאוד לפרמטר "${x.A.col.short}" שבשלב "${SLOT_LABEL[x.A.slot]}" (מתאם דירוג ${x.r.toFixed(2)}), ולכן הציון עלול להיות גבוה בגלל זה בלבד.`);

  // ---------- state ----------
  // state.stages lists the stages in tree order. Each splits by one column. In "shared" mode every branch
  // uses stage.shared; in "branch" mode each parent node (keyed by its 0-based path, e.g.
  // "1.0") can have its own list in stage.branches, falling back to stage.shared.
  let uid = 0;
  const newHs = vs => (Array.isArray(vs) ? vs : []).filter(Number.isFinite).map(v => ({ id: ++uid, v }));
  const cloneHs = hs => hs.map(h => ({ id: h.id, v: h.v }));
  const tsOf = hs => hs.map(h => h.v).sort((a, b) => a - b);
  const segOf = (v, ts) => { let s = 0; while (s < ts.length && v >= ts[s]) s++; return s; };
  const codeOf = path => path.map(s => s + 1).join('.');
  const keyOfCode = code => String(code).split('.').map(x => Number(x) - 1).join('.');
  const parentKey = key => (key.includes('.') ? key.slice(0, key.lastIndexOf('.')) : '');
  const emptyStage = slot => ({ slot, col: '', scale: null, mode: 'shared', shared: [], branches: new Map() });

  // A column of categories without an order (kind 'category') splits into groups formed freely:
  // its lists hold { part }, where part[c] is the group of the c-th category (col.cats order),
  // groups numbered 0..n-1 with none empty. Other columns' lists are thresholds.
  const isCatCol = col => !!col && col.kind === 'category';
  const isPart = x => !!x && !Array.isArray(x);
  const partN = part => (part.length ? Math.max(...part) + 1 : 1);
  const newPart = part => ({ part: part.slice() });
  const cloneList = x => (isPart(x) ? newPart(x.part) : cloneHs(x));
  const normPart = part => {
    const ids = [...new Set(part)].sort((a, b) => a - b);
    return part.map(g => ids.indexOf(g));
  };
  const catName = (col, ci) => col.categories[String(col.cats[ci])] ?? String(col.cats[ci]);
  // A category stage's groups from settings: lists of category names (or codes), or thresholds
  // between the codes; nothing at all gives each category a group of its own.
  function partFromConfig(col, v) {
    if (Array.isArray(v) && v.length && v.every(Array.isArray)) {
      const find = x => col.cats.findIndex((c, ci) => c === x || String(c) === String(x) || catName(col, ci) === x ||
        (col.values && col.values[String(c)] === x));
      const part = col.cats.map(() => -1);
      v.forEach((g, gi) => g.forEach(x => { const ci = find(x); if (ci >= 0 && part[ci] < 0) part[ci] = gi; }));
      let next = v.length;
      part.forEach((g, ci) => { if (g < 0) part[ci] = next++; }); // left out: a group of its own
      return normPart(part);
    }
    if (v == null) return col.cats.map((c, ci) => ci);
    const ts = (Array.isArray(v) ? v : []).filter(Number.isFinite).sort((a, b) => a - b);
    return normPart(col.cats.map(c => segOf(c, ts)));
  }
  // The groups a stage's list makes of a category column, whatever the list holds.
  const partOf = (col, list) => (isPart(list) && list.part.length === col.cats.length ? list.part
    : partFromConfig(col, Array.isArray(list) && list.length ? tsOf(list) : null));
  const partLabels = (col, part) => Array.from({ length: partN(part) }, (_, g) =>
    col.cats.map((c, ci) => ci).filter(ci => part[ci] === g).map(ci => catName(col, ci)).join(', ') || 'ריק');
  const partOut = (col, part) => Array.from({ length: partN(part) }, (_, g) =>
    col.cats.map((c, ci) => ci).filter(ci => part[ci] === g).map(ci => catName(col, ci)));
  // How many groups a stage's list makes.
  const listN = (col, list) => (isCatCol(col) ? partN(partOf(col, list)) : list.length + 1);
  const stageOf = (st, slot) => st.stages.find(S => S.slot === slot);
  const scaleType = S => S.scale || COL[S.col].defaultScale;

  // Levels are in tree order. A level goes to the stage of its column's characteristic, or to
  // the extra stage when it says `extra: true` or that stage is taken. Unused stages follow.
  function stateFromConfig(cfg) {
    const st = {
      min: Number(cfg.min_group_size) > 0 ? Math.round(Number(cfg.min_group_size)) : 15,
      stages: [],
    };
    const free = new Set([...THEMES.map(t => t.key), EXTRA]);
    for (const c of cfg.levels || []) {
      const col = c && COL[c.column];
      if (!col) continue;
      const slot = !c.extra && free.has(col.theme) ? col.theme : free.has(EXTRA) ? EXTRA : null;
      if (!slot) continue;
      free.delete(slot);
      const S = emptyStage(slot);
      st.stages.push(S);
      S.col = c.column;
      const scale = c.scale === 'log' ? 'quantile' : c.scale; // the log view is gone; percentiles are closest
      S.scale = !col.discrete && SCALE_NAMES[scale] ? scale : null;
      const listOf = isCatCol(col) ? v => newPart(partFromConfig(col, v)) : newHs;
      S.shared = listOf(isCatCol(col) ? c.groups ?? c.thresholds : c.thresholds);
      const br = c.branches && typeof c.branches === 'object' ? Object.entries(c.branches) : [];
      if (br.length) {
        S.mode = 'branch';
        for (const [code, vs] of br) S.branches.set(keyOfCode(code), listOf(vs));
      }
    }
    THEMES.forEach(t => { if (free.has(t.key)) st.stages.push(emptyStage(t.key)); });
    return st;
  }

  function effectiveHs(st, slot, key) {
    const S = stageOf(st, slot);
    return S.mode === 'branch' && key != null && S.branches.has(key) ? S.branches.get(key) : S.shared;
  }

  function computeTree(st) {
    const act = [];
    st.stages.forEach(S => { if (S.col) act.push({ slot: S.slot, S, col: COL[S.col] }); });
    const root = { key: '', path: [], depth: 0, members: AUTH, parent: null };
    const rows = [[root]], unassigned = [], byKey = new Map([['', root]]);
    act.forEach((A, d) => {
      const next = [];
      const cat = isCatCol(A.col);
      for (const node of rows[d]) {
        const list = effectiveHs(st, A.slot, node.key);
        const ts = cat ? null : tsOf(list), part = cat ? partOf(A.col, list) : null;
        node.stage = A;
        node.ts = ts;
        node.part = part;
        node.n = cat ? partN(part) : ts.length + 1;
        node.labels = cat ? partLabels(A.col, part) : segLabels(A.col, ts);
        node.children = Array.from({ length: node.n }, (_, s) => {
          const path = [...node.path, s];
          const ch = { key: path.join('.'), path, depth: d + 1, seg: s, parent: node, members: [] };
          byKey.set(ch.key, ch);
          return ch;
        });
        for (const a of node.members) {
          if (node.n === 1) { node.children[0].members.push(a); continue; }
          const v = a.v[A.col.idx];
          if (v == null) unassigned.push({ a, col: A.col });
          else node.children[cat ? part[A.col.catIdx.get(v)] ?? 0 : segOf(v, ts)].members.push(a);
        }
        next.push(...node.children);
      }
      rows.push(next);
    });
    for (let d = rows.length - 1; d >= 0; d--) {
      for (const nd of rows[d]) nd.count = nd.children ? nd.children.reduce((s, c) => s + c.count, 0) : nd.members.length;
    }
    return { st, act, rows, leaves: rows[rows.length - 1], unassigned, byKey, total: root.count };
  }

  // Steps that actually split, from the root down to the node.
  function pathSteps(node) {
    const steps = [];
    for (let nd = node; nd.parent; nd = nd.parent) {
      const p = nd.parent;
      if (p.n > 1) steps.unshift({ col: p.stage.col, label: p.labels[nd.seg], s: nd.seg, n: p.n, ts: p.ts });
    }
    return steps;
  }

  function exportConfig(st, T) {
    return {
      min_group_size: st.min,
      levels: T.act.map((A, d) => {
        const cat = isCatCol(A.col);
        const o = cat ? { column: A.S.col, groups: partOut(A.col, partOf(A.col, A.S.shared)) } : { column: A.S.col, thresholds: tsOf(A.S.shared) };
        if (A.slot === EXTRA) o.extra = true;
        if (A.S.scale && A.S.scale !== A.col.defaultScale) o.scale = A.S.scale;
        if (A.S.mode === 'branch' && d > 0) {
          o.branches = {};
          for (const nd of T.rows[d]) o.branches[codeOf(nd.path)] = cat ? partOut(A.col, nd.part) : nd.ts;
        }
        return o;
      }),
    };
  }
  // Mode-independent fingerprint: the thresholds every node actually uses.
  const canonical = (st, T) => JSON.stringify([st.min, T.act.map((A, d) => [
    A.col.key, A.S.scale && A.S.scale !== A.col.defaultScale ? A.S.scale : null, T.rows[d].map(nd => nd.part ? ['g', ...nd.part] : nd.ts),
  ])]);

  const recState = stateFromConfig(REC);
  const REC_CANON = canonical(recState, computeTree(recState));

  // A copy of a split, to work a change out on, or to undo one with.
  const cloneState = st => ({
    min: st.min,
    stages: st.stages.map(S => ({
      ...S, shared: cloneList(S.shared), branches: new Map([...S.branches].map(([k, hs]) => [k, cloneList(hs)])),
    })),
  });
  const totalScore = T => stageGains(T).reduce((sum, g) => sum + (g || 0), 0);

  // A characteristic's columns by their sub-category (group), or (theme null) every column: by
  // characteristic, and inside each by sub-category, whose name is a line that cannot be chosen
  // (a list cannot nest its groups). keep: which columns to offer; none: the empty choice's text.
  function columnOptions(theme, { keep = () => true, none } = {}) {
    const cols = COLS.filter(c => (!theme || c.theme === theme) && keep(c));
    const byGroup = cs => cs.reduce((m, c) => m.set(c.group, [...(m.get(c.group) || []), c]), new Map());
    const opt = c => `<option value="${c.key}"${c.offList ? ' hidden' : ''}>${esc(c.label)}</option>`;
    const listed = cols.filter(c => !c.offList);
    let html = `<option value="">${none ?? (theme ? 'ללא פיצול בשלב זה' : 'בחרו עמודה')}</option>`;
    if (theme) {
      for (const [g, cs] of byGroup(listed)) html += `<optgroup label="${esc(g)}">${cs.map(opt).join('')}</optgroup>`;
    } else {
      for (const t of [...new Set([...THEMES.map(x => x.key), ...listed.map(c => c.theme)])]) {
        const cs = listed.filter(c => c.theme === t);
        if (!cs.length) continue;
        html += `<optgroup label="${esc(SLOT_LABEL[t] ?? t)}">`;
        for (const [g, gs] of byGroup(cs)) html += `<option class="opt-sub" disabled>${esc(g)}</option>${gs.map(opt).join('')}`;
        html += '</optgroup>';
      }
    }
    // off the list, but a split from before may still have one: it keeps its name in the box
    return html + cols.filter(c => c.offList).map(opt).join('');
  }

  // The site's square tabs mark the chosen button with `on`; aria-pressed says the same to screen readers.
  function pressOnly(group, chosen) {
    group.querySelectorAll('button').forEach(b => {
      const on = chosen(b);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  const GRIP = '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><g fill="currentColor">' +
    [3, 8, 13].map(y => `<circle cx="2" cy="${y}" r="1.4"></circle><circle cx="8" cy="${y}" r="1.4"></circle>`).join('') + '</g></svg>';

  // ---------- map: one point per authority, colored by its group ----------
  // Positions come from build_map.py: a city or local council at its locality, a regional
  // council at the average position of its localities. The projection is equirectangular
  // around 31.5°N, true enough in shape at the scale of the country.
  const BASE = D.basemap || null;
  const LOCATED = AUTH.filter(a => a.loc);
  const HAS_MAP = !!BASE && LOCATED.length > 0;
  const KX = Math.cos(31.5 * Math.PI / 180);
  const project = ([lon, lat]) => [(lon - 34) * KX, 34 - lat];
  LOCATED.forEach(a => { a.xy = project(a.loc); });
  const PTS_BOX = LOCATED.reduce((b, a) => ({
    x0: Math.min(b.x0, a.xy[0]), x1: Math.max(b.x1, a.xy[0]), y0: Math.min(b.y0, a.xy[1]), y1: Math.max(b.y1, a.xy[1]),
  }), { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
  const POP = COL.pop_total ? COL.pop_total.idx : -1;
  const REGIONAL = COL.fin_is_regional_council ? COL.fin_is_regional_council.idx : -1;
  const SEA = { text: 'הים התיכון', xy: project([34.3, 32.2]) };
  // Always named, for orientation: Jerusalem, Tel Aviv-Yafo, Haifa, Be'er Sheva.
  const ANCHORS = new Set([103, 313, 501, 102]);
  const ZOOM_MIN = 0.85, ZOOM_MAX = 18; // relative to the zoom that fits the whole country

  // The country, drawn once and copied into every division's map.
  const BASE_HTML = (() => {
    if (!HAS_MAP) return '';
    const ring = r => 'M' + r.map(p => project(p).map(v => v.toFixed(4)).join(' ')).join('L') + 'Z';
    return `<path class="land" fill-rule="evenodd" d="${BASE.land.map(ring).join('')}"></path>` +
      BASE.lakes.map(r => `<path class="lake" d="${ring(r)}"></path>`).join('');
  })();

  // A division's section: its header, its stage cards and its three views. Ids carry the
  // division's number u, so labels and tabs point at their own division.
  function divisionHTML(u) {
    return `
      <header class="div-head">
        <h2 class="div-title" id="div-title-${u}"><span class="div-num"></span><span class="div-name"></span><span class="div-mod" hidden>שונתה</span></h2>
        <div class="div-tools">
          <label class="min-field" title="קבוצה קטנה מזה מסומנת באזהרה">
            מינימום
            <input class="min-size" type="number" min="1" step="1" dir="ltr">
          </label>
          <div class="opt-all">
            <button class="btn-ghost btn-opt-all" type="button">✦ מיטוב כל השלבים</button>
            <span class="opt-warn" hidden><span class="ow-text"></span><button type="button" class="ow-fix"></button><span class="ow-hint" hidden>צריך פחות קבוצות</span></span>
          </div>
          <button class="btn-ghost btn-rec" type="button"></button>
        </div>
        <div class="div-actions">
          <button class="btn-ghost" type="button" data-act="load">טעינת חלוקה שמורה</button>
          <button class="btn-ghost" type="button" data-act="save">שמירת החלוקה</button>
          <div class="menu">
            <button class="btn-ghost btn-icon menu-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="פעולות נוספות">⋯</button>
            <div class="menu-pop" role="menu" hidden>
              <button type="button" role="menuitem" data-act="copy">העתקת הגדרות</button>
              <button type="button" role="menuitem" data-act="import">ייבוא הגדרות</button>
              <button type="button" role="menuitem" data-act="file">שמירת הגדרות לקובץ</button>
              <button type="button" role="menuitem" data-act="csv">ייצוא CSV</button>
            </div>
          </div>
          <button class="btn-ghost btn-icon div-x" type="button" data-act="remove" title="הסרת החלוקה מההשוואה" aria-label="הסרת החלוקה מההשוואה" hidden>✕</button>
        </div>
      </header>
      <div class="layout">
        <aside class="params" aria-label="שלבי העץ"></aside>
        <div class="div-main">
          <section class="panel tree-panel" aria-labelledby="div-title-${u}">
            <div class="panel-head">
              <div class="viewseg view-switch" role="tablist" aria-label="תצוגה">
                <button type="button" role="tab" data-view="tree" aria-controls="tree-${u}">עץ</button>
                <button type="button" role="tab" data-view="map" aria-controls="map-${u}">מפה</button>
                <button type="button" role="tab" data-view="dist" aria-controls="dist-${u}">התפלגות</button>
              </div>
              <div class="stats"></div>
            </div>
            <div class="tree-view" id="tree-${u}" role="tabpanel" aria-label="עץ"></div>
            <div class="map-view" id="map-${u}" role="tabpanel" aria-label="מפה" hidden>
              <div class="map-grid">
                <div class="map-box">
                  <svg class="map" tabindex="0" role="img" aria-label="מפת הרשויות, צבועות לפי קבוצה">
                    <g class="map-base"></g>
                    <g class="map-pts"></g>
                    <g class="map-labels"></g>
                  </svg>
                  <div class="map-ctl">
                    <button type="button" class="map-btn" data-zoom="in" aria-label="הגדלה">+</button>
                    <button type="button" class="map-btn" data-zoom="out" aria-label="הקטנה">−</button>
                    <button type="button" class="map-btn" data-zoom="fit" title="כל הארץ" aria-label="הצגת כל הארץ">⤢</button>
                  </div>
                </div>
                <div class="map-legend"></div>
              </div>
            </div>
            <div class="dist-view" id="dist-${u}" role="tabpanel" aria-label="התפלגות מדד המטרה" hidden></div>
            <p class="unassigned" hidden></p>
          </section>
        </div>
      </div>`;
  }

  // ---------- a division ----------
  // The page compares divisions, one under the other. Each has its own stages, tree, map and
  // distribution of the target, and all of them are scored the same way (`scoring`). Everything
  // inside createDivision belongs to one division. It builds the division's section in the page,
  // before the section `before` (null: at the end), draws it, and returns what the page uses.
  let divSeq = 0;
  function createDivision({ st, source, view = 'tree', before = null }) {
    const u = ++divSeq;
    const root = document.createElement('section');
    root.className = 'division';
    root.setAttribute('aria-labelledby', `div-title-${u}`);
    root.innerHTML = divisionHTML(u);
    $('#divisions').insertBefore(root, before);
    const $d = sel => root.querySelector(sel);
    const observers = [];
    const watch = (ro, ...els) => { els.forEach(el => ro.observe(el)); observers.push(ro); };

    // The split, its tree and stage gains as last drawn, and where the split came from (src):
    // kind 'rec' (the recommended split), 'saved' (a saved division, by name), 'import', 'link'
    // (a link from before the page compared divisions) or 'new'. canon: the split as it came, so
    // a change shows; mod: it had already changed when the page was reloaded.
    let state = st, lastTree = null, lastGains = [], src = null, place = 1;

    // ---------- threshold edits ----------
    // `i` below is a stage's slot.
    const depthOf = i => lastTree.act.findIndex(A => A.slot === i);

    function ensureHs(i, key) {
      const S = stageOf(state, i);
      if (S.mode !== 'branch' || key == null) return S.shared;
      if (!S.branches.has(key)) S.branches.set(key, cloneList(S.shared)); // keep ids so a drag survives
      return S.branches.get(key);
    }
    // The same for a category stage, as an editable { part }.
    function ensurePart(i, key) {
      const S = stageOf(state, i), col = COL[S.col];
      if (!isPart(S.shared)) S.shared = newPart(partOf(col, S.shared));
      if (S.mode !== 'branch' || key == null) return S.shared;
      if (!isPart(S.branches.get(key))) S.branches.set(key, newPart(S.branches.has(key) ? partOf(col, S.branches.get(key)) : S.shared.part));
      return S.branches.get(key);
    }

    // Move category ci of a category stage (branch `key`, or every branch) to group `to`, or to a
    // new group ('new'). A group left empty goes; a new group takes the lists below of the one left.
    function moveCategory(i, key, ci, to) {
      const part = ensurePart(i, key).part, from = part[ci], n = partN(part);
      const alone = part.filter(g => g === from).length === 1;
      if (to === 'new') { if (alone || n >= part.length) return; to = n; }
      if (to === from || to < 0 || to > n) return;
      part[ci] = to;
      const newToOld = Array.from({ length: n }, (_, j) => j);
      if (to === n) newToOld.push(from);
      if (alone) {
        part.forEach((g, k) => { if (g > from) part[k] = g - 1; });
        newToOld.splice(from, 1);
      }
      remapBelow(depthOf(i), key, newToOld);
      updateAll();
    }

    // A threshold was added/removed at `depth` (under node `nodeKey`, or every node when
    // null): move the per-branch lists of deeper stages to the new segment numbering.
    function remapBelow(depth, nodeKey, newToOld) {
      if (depth < 0) return;
      lastTree.act.forEach((A, e) => {
        if (e <= depth || A.S.mode !== 'branch') return;
        const next = new Map();
        for (const [k, hs] of A.S.branches) {
          const parts = k.split('.');
          if (nodeKey != null && parts.slice(0, depth).join('.') !== nodeKey) { next.set(k, hs); continue; }
          const c = Number(parts[depth]);
          let first = true;
          newToOld.forEach((o, j) => {
            if (o !== c) return;
            const np = parts.slice();
            np[depth] = String(j);
            next.set(np.join('.'), first ? hs : cloneList(hs));
            first = false;
          });
        }
        A.S.branches = next;
      });
    }

    // The stages below go back to one shared list: their branches are numbered by this stage's groups.
    function resetAfter(st, i) {
      let any = false;
      for (const S of st.stages.slice(st.stages.findIndex(T => T.slot === i) + 1)) {
        if (S.mode === 'branch') { S.mode = 'shared'; S.branches = new Map(); any = true; }
      }
      return any;
    }
    function resetBelow(i, quiet) {
      const any = resetAfter(state, i);
      if (any && !quiet) toast('הספים לפי ענף בשלבים הבאים אופסו');
      return any;
    }

    // Per-branch thresholds are keyed by the branches above, so a stage whose stages above
    // change (by a move, an added or a removed stage) goes back to one shared list.
    function changeStages(mutate) {
      const above = () => {
        const out = new Map(), seen = [];
        for (const S of state.stages) { out.set(S.slot, seen.join('>')); if (S.col) seen.push(S.slot); }
        return out;
      };
      const before = above();
      mutate();
      const after = above();
      let any = false;
      for (const S of state.stages) {
        if (S.mode === 'branch' && before.get(S.slot) !== after.get(S.slot)) { S.mode = 'shared'; S.branches = new Map(); any = true; }
      }
      if (any) toast('הספים לפי ענף אופסו בשלבים שהשלבים מעליהם השתנו');
      updateAll();
    }

    function moveStage(i, dir) {
      const k = state.stages.findIndex(S => S.slot === i), j = k + dir;
      if (k < 0 || j < 0 || j >= state.stages.length) return;
      changeStages(() => state.stages.splice(j, 0, ...state.stages.splice(k, 1)));
    }

    function addThreshold(i, key, atP) {
      const S = stageOf(state, i), col = COL[S.col];
      if (isCatCol(col)) return; // its groups are formed on the board
      const hs = ensureHs(i, key), oldTs = tsOf(hs);
      let v;
      if (atP != null) {
        v = stageUI.get(i).scale.fromP(atP);
      } else {
        // split the largest segment of this branch at its median
        const node = key == null ? null : lastTree.byKey.get(key);
        const vals = (node ? node.members : AUTH).map(a => a.v[col.idx]).filter(x => x != null).sort((a, b) => a - b);
        const seg = Array.from({ length: oldTs.length + 1 }, () => []);
        vals.forEach(x => seg[segOf(x, oldTs)].push(x));
        const big = seg.reduce((a, b) => (b.length > a.length ? b : a));
        const med = big.length ? big[Math.floor(big.length / 2)] : col.median;
        if (col.discrete) {
          const free = col.cats.slice(1).map((c, b) => (col.cats[b] + c) / 2).filter(b => !oldTs.includes(b));
          if (!free.length) return;
          v = free.reduce((a, b) => (Math.abs(b - med) < Math.abs(a - med) ? b : a));
        } else {
          v = med;
        }
      }
      v = niceRound(v, col);
      if (oldTs.includes(v)) { toast('כבר יש סף בערך הזה'); return; }
      const s = segOf(v, oldTs);
      const h = { id: ++uid, v };
      hs.push(h);
      remapBelow(depthOf(i), key, Array.from({ length: oldTs.length + 2 }, (_, j) => (j <= s ? j : j - 1)));
      updateAll();
      stageUI.get(i).rows.get(key ?? '*')?.hEls.get(h.id)?.focus({ preventScroll: true });
    }

    function removeThreshold(i, key, id) {
      const hs = ensureHs(i, key), oldTs = tsOf(hs);
      const h = hs.find(x => x.id === id);
      if (!h) return;
      const r = oldTs.indexOf(h.v);
      hs.splice(hs.indexOf(h), 1);
      remapBelow(depthOf(i), key, Array.from({ length: oldTs.length }, (_, j) => (j <= r ? j : j + 1)));
      updateAll();
    }

    function setThreshold(i, key, id, v, round) {
      const col = COL[stageOf(state, i).col];
      const hs = ensureHs(i, key);
      const h = hs.find(x => x.id === id);
      if (!h) return;
      const nv = round ? niceRound(v, col) : v;
      if (nv === h.v) return;
      if (col.discrete && hs.some(x => x.id !== id && x.v === nv)) return;
      h.v = nv;
      scheduleUpdate();
    }

    function setColumn(i, key) {
      const S = stageOf(state, i);
      Object.assign(S, emptyStage(i), { col: key });
      resetBelow(i);
      if (isCatCol(COL[key])) { // each category starts as a group of its own
        S.shared = newPart(partFromConfig(COL[key], null));
        updateAll();
        return;
      }
      lastTree = computeTree(state);
      if (key) {
        stageUI.get(i).scaleSig = '';
        syncStageScale(i);
        addThreshold(i, null);
      } else {
        updateAll();
      }
    }

    function setMode(i, mode) {
      const S = stageOf(state, i);
      if (S.mode === mode) return;
      if (mode === 'shared') { S.branches = new Map(); resetBelow(i); }
      S.mode = mode;
      updateAll();
    }

    // ---------- threshold search (the method of analysis/build_tree.py) ----------
    // A stage's thresholds are set to raise its own R² the most, given the stages above: the
    // least within-group sum of squares of its profile columns over the authorities in the R²
    // calibration. Every group keeps the minimum for each final group the later stages will make
    // of it (when every branch of a stage makes as many groups, the minimum times their product,
    // as in build_tree.py). Cuts fall only between two different values, so the search is exact;
    // each threshold is then the roundest number in its gap, which keeps the groups.
    // When the page scores by the target measurement, the sum of squares is the target's instead
    // (metric().xOf and colsOf), and every stage is set to raise its share of the target's score.

    // The roundest t with lo < t <= hi (a value equal to a threshold goes to the upper group).
    function roundBetween(lo, hi) {
      const mid = (lo + hi) / 2;
      for (let e = Math.ceil(Math.log10(Math.max(Math.abs(lo), Math.abs(hi), 1e-9))) + 1; e > -12; e--) {
        for (const f of [10, 5, 2, 1]) {
          const step = f * 10 ** (e - 1);
          let t = Math.round(mid / step) * step;
          if (t <= lo) t += step;
          if (t > hi) t -= step;
          if (t > lo && t <= hi) return Number(t.toPrecision(12));
        }
      }
      return mid;
    }

    // Running sums over rows sorted by value: calibration rows, and the profile columns' sums.
    function prefixSums(rows, cols) {
      const n = rows.length, m = cols.length;
      const nc = new Int32Array(n + 1), s1 = new Float64Array((n + 1) * m), s2 = new Float64Array(n + 1);
      rows.forEach((r, i) => {
        nc[i + 1] = nc[i] + (r.x ? 1 : 0);
        s2[i + 1] = s2[i];
        for (let c = 0; c < m; c++) {
          const v = r.x ? r.x[cols[c]] : 0;
          s1[(i + 1) * m + c] = s1[i * m + c] + v;
          s2[i + 1] += v * v;
        }
      });
      return { m, nc, s1, s2 };
    }
    // Within-group sum of squares of rows a..b-1.
    function withinSS(P, a, b) {
      const k = P.nc[b] - P.nc[a];
      if (!k) return 0;
      let ss = P.s2[b] - P.s2[a];
      for (let c = 0; c < P.m; c++) {
        const d = P.s1[b * P.m + c] - P.s1[a * P.m + c];
        ss -= (d * d) / k;
      }
      return ss;
    }

    // Best split of positions 0..L-1 into k groups. A group runs from one position to a later
    // one; cost(a, b) prices it and ok(a, b, j) says whether it may be group j (from 1).
    // Returns the inner positions of the best split, or null when none is allowed.
    function bestSplit(L, cost, ok, k) {
      const memo = new Float64Array(L * L).fill(NaN);
      const at = (a, b, j) => {
        if (!ok(a, b, j)) return Infinity;
        const i = a * L + b;
        if (Number.isNaN(memo[i])) memo[i] = cost(a, b);
        return memo[i];
      };
      const last = L - 1, from = [null, null];
      let f = Float64Array.from({ length: L }, (_, q) => (q ? at(0, q, 1) : Infinity));
      for (let j = 2; j <= k; j++) {
        const fj = new Float64Array(L).fill(Infinity), arg = new Int32Array(L).fill(-1);
        for (let q = j; q < L; q++) {
          for (let r = j - 1; r < q; r++) {
            if (f[r] === Infinity) continue;
            const c = at(r, q, j);
            if (c !== Infinity && f[r] + c < fj[q]) { fj[q] = f[r] + c; arg[q] = r; }
          }
        }
        f = fj;
        from.push(arg);
      }
      if (!(f[last] < Infinity)) return null;
      const cuts = [];
      for (let q = last, j = k; j > 1; j--) { q = from[j][q]; cuts.unshift(q); }
      return cuts;
    }

    // Final groups the node `key` at depth e of tree T will hold (itself, past the last stage).
    // fresh: the later stages use their shared thresholds, as after a change of shape resets them.
    function groupsUnder(T, e, key, fresh) {
      if (e >= T.act.length) return 1;
      const A = T.act[e];
      const n = listN(A.col, fresh || !e ? A.S.shared : effectiveHs(T.st, A.slot, key));
      let total = 0;
      for (let s = 0; s < n; s++) total += groupsUnder(T, e + 1, key ? `${key}.${s}` : String(s), fresh);
      return total;
    }
    // The least each of a node's k groups may hold at depth d: the minimum for every final group in it.
    const needOf = (T, d, nd, k, min, fresh) =>
      Array.from({ length: k }, (_, s) => min * groupsUnder(T, d + 1, nd.key ? `${nd.key}.${s}` : String(s), fresh));
    // Branches of the stage at depth d whose present thresholds leave a group too small for that.
    function underMin(T, d, min = state.min) {
      return T.rows[d].filter(nd => nd.count && nd.n > 1 &&
        nd.children.some(ch => ch.members.length < min * groupsUnder(T, d + 1, ch.key, false))).map(nd => codeOf(nd.path));
    }
    // Groups (final, not empty) under the minimum.
    const underCount = (T, min) => T.leaves.filter(l => l.count && l.count < min).length;
    // Which authorities share a group: two trees with the same groups match.
    const groupsSig = T => T.leaves.map(l => l.members.map(a => a.id).join(',')).join('|');

    // Thresholds for the stage at depth d of tree T. 'branch': each branch on its own, with
    // countOf(node) thresholds; 'shared': one list for every branch, countOf(null) thresholds.
    // Returns { shared } (null when nothing fits) or { branches, failed }.
    function searchStage(T, d, mode, countOf, { min = state.min, fresh = false } = {}) {
      const M = metric(), col = T.act[d].col, cols = M.colsOf(col);
      if (isCatCol(col)) return searchGroups(T, d, mode, countOf, min, fresh);
      const nodes = T.rows[d].filter(nd => nd.count);
      const sorted = nodes.map(nd => nd.members
        .filter(a => a.v[col.idx] != null)
        .map(a => ({ v: a.v[col.idx], x: M.xOf(a.id) || null }))
        .sort((p, q) => p.v - q.v));
      const sums = sorted.map(rows => prefixSums(rows, cols));
      const cut = (lo, hi) => (col.discrete ? (lo + hi) / 2 : roundBetween(lo, hi));
      if (mode === 'branch') {
        const branches = new Map(), failed = [];
        nodes.forEach((nd, b) => {
          const rows = sorted[b], k = countOf(nd) + 1, need = needOf(T, d, nd, k, min, fresh), pos = [0];
          for (let r = 1; r < rows.length; r++) if (rows[r].v !== rows[r - 1].v) pos.push(r);
          pos.push(rows.length);
          const best = k === 1 ? [] : bestSplit(pos.length, (a, c) => withinSS(sums[b], pos[a], pos[c]),
            (a, c, j) => pos[c] - pos[a] >= need[j - 1], k);
          if (best) branches.set(nd.key, best.map(q => cut(rows[pos[q] - 1].v, rows[pos[q]].v)));
          else failed.push(codeOf(nd.path));
        });
        return { branches, failed };
      }
      const k = countOf(null) + 1, needs = nodes.map(nd => needOf(T, d, nd, k, min, fresh));
      const U = [...new Set(sorted.flat().map(r => r.v))].sort((p, q) => p - q);
      const below = sorted.map(rows => { // per branch: how many of its rows lie under each value
        const c = new Int32Array(U.length + 1);
        let r = 0;
        for (let g = 0; g < U.length; g++) { while (r < rows.length && rows[r].v < U[g]) r++; c[g] = r; }
        c[U.length] = rows.length;
        return c;
      });
      const best = k === 1 ? [] : bestSplit(U.length + 1,
        (a, c) => below.reduce((sum, bl, b) => sum + withinSS(sums[b], bl[a], bl[c]), 0),
        (a, c, j) => below.every((bl, b) => bl[c] - bl[a] >= needs[b][j - 1]), k);
      return { shared: best && best.map(g => cut(U[g - 1], U[g])) };
    }
    // The same for a category column: groups instead of thresholds (a part per branch, or one
    // shared). Every way to put the categories into k groups is tried - a few hundred at most for
    // six categories - and, when a node's children need different minimums, every order of the groups.
    function searchGroups(T, d, mode, countOf, min, fresh) {
      const M = metric(), col = T.act[d].col, cols = M.colsOf(col), C = col.cats.length, m = cols.length;
      const nodes = T.rows[d].filter(nd => nd.count);
      // per node and category: authorities with a value (for the minimum), and the calibration sums
      const stats = nodes.map(nd => {
        const st = col.cats.map(() => ({ cnt: 0, k: 0, s: new Float64Array(m), q: 0 }));
        for (const a of nd.members) {
          const v = a.v[col.idx];
          if (v == null) continue;
          const t = st[col.catIdx.get(v)];
          t.cnt++;
          const x = M.xOf(a.id);
          if (!x) continue;
          t.k++;
          for (let j = 0; j < m; j++) { t.s[j] += x[cols[j]]; t.q += x[cols[j]] * x[cols[j]]; }
        }
        return st;
      });
      const groupsOf = (st, part, k) => {
        const g = Array.from({ length: k }, () => ({ cnt: 0, k: 0, s: new Float64Array(m), q: 0 }));
        part.forEach((b, ci) => {
          const t = st[ci], G = g[b];
          G.cnt += t.cnt; G.k += t.k; G.q += t.q;
          for (let j = 0; j < m; j++) G.s[j] += t.s[j];
        });
        return g;
      };
      const within = g => g.reduce((sum, G) => sum + (G.k ? G.q - G.s.reduce((a, v) => a + v * v, 0) / G.k : 0), 0);
      // every partition into exactly k groups, numbered by their first category
      const partitions = k => {
        const out = [], a = new Array(C).fill(0);
        const rec = (i, used) => {
          if (i === C) { if (used === k) out.push(a.slice()); return; }
          if (used + (C - i) < k) return;
          for (let b = 0; b <= Math.min(used, k - 1); b++) { a[i] = b; rec(i + 1, Math.max(used, b + 1)); }
        };
        if (k >= 1 && k <= C) rec(0, 0);
        return out;
      };
      const orders = k => { // every order of k groups, the plain one first
        const out = [];
        const rec = (p, rest) => { if (!rest.length) { out.push(p); return; } rest.forEach((x, j) => rec([...p, x], rest.filter((_, y) => y !== j))); };
        rec([], Array.from({ length: k }, (_, j) => j));
        return out;
      };
      // the place of each group among the children so that every branch's groups meet their minimums
      const placeFor = (sizes, needs, k) => {
        for (const ord of k > 1 && needs.some(nd => nd.some(x => x !== nd[0])) ? orders(k) : [Array.from({ length: k }, (_, j) => j)]) {
          if (sizes.every((sz, b) => ord.every((g, slot) => sz[g] >= needs[b][slot]))) {
            const at = new Array(k);
            ord.forEach((g, slot) => { at[g] = slot; });
            return at;
          }
        }
        return null;
      };
      const best = (bs, k, needs) => {
        if (k === 1) return col.cats.map(() => 0);
        let top = null, cost = Infinity;
        for (const p of partitions(k)) {
          const gs = bs.map(b => groupsOf(stats[b], p, k));
          const c = gs.reduce((sum, g) => sum + within(g), 0);
          if (c >= cost) continue;
          const at = placeFor(gs.map(g => g.map(G => G.cnt)), needs, k);
          if (!at) continue;
          top = p.map(g => at[g]);
          cost = c;
        }
        return top;
      };
      if (mode === 'branch') {
        const branches = new Map(), failed = [];
        nodes.forEach((nd, b) => {
          const k = countOf(nd) + 1, part = best([b], k, [needOf(T, d, nd, k, min, fresh)]);
          if (part) branches.set(nd.key, part); else failed.push(codeOf(nd.path));
        });
        return { branches, failed };
      }
      const k = countOf(null) + 1;
      return { shared: best(nodes.map((nd, b) => b), k, nodes.map(nd => needOf(T, d, nd, k, min, fresh))) };
    }
    const foundAny = (mode, found) => (mode === 'shared' ? !!found.shared : found.branches.size > 0);

    function applyFound(st, slot, d, mode, found) {
      const S = stageOf(st, slot), listOf = isCatCol(COL[S.col]) ? newPart : newHs;
      if (mode === 'branch') {
        S.mode = 'branch';
        for (const [key, ts] of found.branches) S.branches.set(key, listOf(ts));
      } else {
        S.shared = listOf(found.shared);
        if (d > 0) { S.mode = 'shared'; S.branches = new Map(); }
      }
    }

    // The search with the stage's present shape, and with one change of shape each. delta: the
    // change in the stage's own gain (R², or its share of the target's score) against now; of: the
    // stage's branches.
    function stageOptions(i) {
      const T = lastTree, d = depthOf(i);
      if (!metric().ok() || d < 0) return null;
      const S = stageOf(state, i), nodes = T.rows[d].filter(nd => nd.count);
      const branch = S.mode === 'branch' && d > 0, mode = branch ? 'branch' : 'shared';
      const counts = new Map(nodes.map(nd => [nd.key, nd.n - 1])); // thresholds, or groups less one
      const most = Math.max(0, ...counts.values()), fewest = Math.min(...counts.values());
      const gainNow = stageGains(T)[d];
      // a new number of groups, or one shared list, resets the per-branch lists below
      const make = (kind, m, countOf, fresh = false) => {
        const found = searchStage(T, d, m, countOf, { fresh });
        if (!foundAny(m, found)) return { kind, of: nodes.length, found: null };
        const st = cloneState(state);
        if (fresh) resetAfter(st, i);
        applyFound(st, i, d, m, found);
        return { kind, of: nodes.length, mode: m, found, delta: stageGains(computeTree(st))[d] - gainNow };
      };
      const now = nd => (nd ? counts.get(nd.key) : most);
      const out = [make('same', mode, now), make('more', mode, nd => now(nd) + 1, true)];
      if (branch ? fewest >= 2 : most >= 2) out.push(make('less', mode, nd => now(nd) - 1, true));
      if (d > 0) out.push(branch ? make('shared', 'shared', () => most, true) : make('branch', 'branch', () => most));
      out[0].small = underMin(T, d);
      return out;
    }

    const scoreChange = (a, b) => {
      const f = scoreText, name = metric().score;
      return f(a) === f(b) ? `${name} נשאר ${f(b)}` : `${name} ${scoreValue(b) > scoreValue(a) ? 'עלה' : 'ירד'} מ-${f(a)} ל-${f(b)}`;
    };
    const undoTo = st => ({ label: 'ביטול', run: () => loadState(st) });
    const inBranches = cs => `${cs.length > 1 ? 'בענפים' : 'בענף'} ${cs.join(', ')}`;

    function applyOption(i, kind) {
      const opt = (stageOptions(i) || []).find(o => o.kind === kind); // fresh, in case the split moved
      if (!opt || !opt.found) return;
      const before = cloneState(state), s0 = totalScore(lastTree), d = depthOf(i);
      // a new number of groups renumbers the branches below, so per-branch lists there reset
      const reset = ['more', 'less', 'shared'].includes(kind) && resetBelow(i, true);
      applyFound(state, i, d, opt.mode, opt.found);
      updateAll();
      const failed = opt.found.failed?.length ? `. ${inBranches(opt.found.failed)} אין מספיק רשויות לזה, ${opt.found.failed.length > 1 ? 'והם לא השתנו' : 'והוא לא השתנה'}` : '';
      toast(scoreChange(s0, totalScore(lastTree)) + (reset ? '. הספים לפי ענף בשלבים הבאים אופסו' : '') + failed, undoTo(before));
    }

    // Every stage from the top down, each keeping its number of thresholds and kind of threshold,
    // worked out on a copy. failed: the stages, or branches of a stage, that nothing fits; under0 and
    // under1: groups under the minimum now and after; changed: whether any group would change.
    function planAll(min = state.min) {
      const st = cloneState(state), failed = [];
      st.min = min;
      let moved = 0;
      for (let d = 0; d < lastTree.act.length; d++) {
        const T = computeTree(st), A = T.act[d], label = SLOT_LABEL[A.slot];
        const mode = A.S.mode === 'branch' && d > 0 ? 'branch' : 'shared';
        const counts = T.rows[d].filter(nd => nd.count).map(nd => nd.n - 1);
        const found = searchStage(T, d, mode, nd => (nd ? nd.n - 1 : Math.max(0, ...counts)), { min });
        if (!foundAny(mode, found)) { failed.push({ label }); continue; }
        if (found.failed?.length) failed.push({ label, branches: found.failed });
        applyFound(st, A.slot, d, mode, found);
        moved++;
      }
      const T = computeTree(st);
      return { st, T, failed, none: !moved, under0: underCount(lastTree, min), under1: underCount(T, min), changed: groupsSig(T) !== groupsSig(lastTree) };
    }
    const failedPart = f => f.label + (f.branches ? ' ' + inBranches(f.branches) : '');
    // The largest minimum the search can meet with the present stages and numbers of thresholds.
    function largestMin() {
      let lo = 1, hi = state.min; // always met at 1; not at the present minimum
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (planAll(mid).under1) hi = mid; else lo = mid;
      }
      return lo;
    }

    function optimizeAll() {
      if (!metric().ok() || !lastTree || !lastTree.act.length) return;
      const plan = planAll(), before = cloneState(state), s0 = totalScore(lastTree), min = state.min;
      if (!plan.changed) { toast(plan.under1 ? `אין ספים שבהם כל הקבוצות מגיעות ל-${min}` : 'כל השלבים כבר מיטביים'); return; }
      loadState(plan.st);
      const groups = plan.under1 ? `. ${plan.under1} קבוצות עדיין מתחת ל-${min}` : plan.under0 ? `. כל הקבוצות כוללות עכשיו לפחות ${min} רשויות` : '';
      toast(scoreChange(s0, totalScore(lastTree)) + groups, undoTo(before));
    }

    // The header's button, worked out a moment after the split stops moving, like the card's row:
    // what the search would do, and a warning joined to it when the minimum cannot be met. It
    // optimizes for the page's score, whichever it is.
    const allHelp = () => `כל שלב, מלמעלה למטה, מקבל את הספים שמעלים הכי הרבה את ${metric().ofAll}, בלי לשנות את מספר הספים ואת סוג הסף, כך שכל הקבוצות יגיעו למינימום.`;
    let allTimer = 0, allSig = '';
    function scheduleAll() {
      const btn = $d('.btn-opt-all'), box = $d('.opt-all');
      box.hidden = scoring.mode === 'r2' && !SCORE; // no R² without its profile
      if (!metric().ok() || !lastTree.act.length) {
        clearTimeout(allTimer);
        allSig = '';
        btn.disabled = true;
        btn.textContent = '✦ מיטוב כל השלבים';
        btn.title = metric().ok() ? 'אין שלבים לפיצול' : 'בחרו מדד מטרה בסרגל העליון כדי למטב לפיו';
        box.classList.remove('stale', 'warned');
        $d('.opt-warn').hidden = true;
        return;
      }
      const sig = `${metricSig()}|${canonical(state, lastTree)}|${state.stages.map(S => S.slot + ':' + S.mode).join()}`;
      if (sig === allSig) return;
      box.classList.add('stale');
      clearTimeout(allTimer);
      allTimer = setTimeout(() => { allSig = sig; renderAll(planAll()); }, 150);
    }
    function renderAll(plan) {
      const btn = $d('.btn-opt-all'), box = $d('.opt-all'), warn = $d('.opt-warn'), min = state.min;
      box.classList.remove('stale');
      const pts = T => Number(scoreText(totalScore(T))); // as the score shows
      const gain = plan.changed ? pts(plan.T) - pts(lastTree) : 0;
      btn.disabled = !plan.changed;
      // what it does, in words: a lower score is what meeting the minimum costs, so it shows no minus
      btn.innerHTML = !plan.changed && !plan.none ? '✓ כל השלבים מיטביים'
        : '✦ מיטוב כל השלבים' + (!plan.changed ? ''
          : plan.under0 && !plan.under1 ? ` · כל הקבוצות יגיעו ל-${min}`
          : gain > 0 ? ` <span class="v">${gainText(gain / metric().k)}</span>` : '');
      btn.title = allHelp();
      box.classList.toggle('warned', plan.under1 > 0);
      warn.hidden = !plan.under1;
      if (!plan.under1) return;
      const groups = plan.T.leaves.filter(l => l.count).length, fit = largestMin(), fix = $d('.ow-fix');
      warn.querySelector('.ow-text').innerHTML = `<span class="ico">⚠</span>לא כל ${groups} הקבוצות יכולות להגיע ל-${min}`;
      // a minimum that low is no answer (a category held by a few authorities): ask for fewer groups
      const lowerIt = fit * 2 >= min;
      fix.hidden = !lowerIt;
      fix.textContent = `הורדת המינימום ל-${fit}`;
      fix.dataset.min = fit;
      warn.querySelector('.ow-hint').hidden = lowerIt;
      warn.title = `עם השלבים ומספרי הספים האלה אין ספים שבהם כל הקבוצות כוללות לפחות ${min} רשויות` +
        (plan.failed.length ? ` (${plan.failed.map(failedPart).join('; ')})` : '') +
        '. אפשר להוריד את המינימום, או להסיר ספים או שלב כדי שיהיו פחות קבוצות.';
    }

    // The open card's search row, worked out a moment after the split stops moving.
    const OPT_NAMES = { more: 'סף נוסף', less: 'סף אחד פחות', branch: 'ספים לפי ענף', shared: 'סף משותף' };
    const OPT_NAMES_CAT = { more: 'קבוצה נוספת', less: 'קבוצה אחת פחות', branch: 'קבוצות לפי ענף', shared: 'חלוקה משותפת' };
    let optTimer = 0, optSig = '';
    const optSigOf = i => `${i}|${metricSig()}|${canonical(state, lastTree)}|${state.stages.map(S => S.slot + ':' + S.mode).join()}`;
    function scheduleOptions() {
      const ui = openStage != null && stageUI.get(openStage);
      stageUI.forEach(u => { if (u !== ui) u.opt.hidden = true; });
      if (!ui || !metric().ok() || depthOf(openStage) < 0) { if (ui) ui.opt.hidden = true; return; }
      if (optSigOf(openStage) === optSig && !ui.opt.hidden) return;
      ui.opt.classList.add('stale');
      clearTimeout(optTimer);
      optTimer = setTimeout(() => {
        const i = openStage, u = i != null && stageUI.get(i);
        if (!u || depthOf(i) < 0) return;
        optSig = optSigOf(i);
        renderOptions(u, stageOptions(i));
      }, 150);
    }
    function renderOptions(ui, opts) {
      ui.opt.classList.remove('stale');
      if (!opts) { ui.opt.hidden = true; return; }
      const [same, ...alts] = opts, min = state.min, cat = isCatCol(COL[stageOf(state, ui.i).col]), M = metric();
      const names = cat ? OPT_NAMES_CAT : OPT_NAMES;
      const v = o => `<span class="v">${gainText(o.delta)}</span>`;
      const stuck = (same.found && same.found.failed) || [];
      // groups too small today that the search can make big enough: it does that even at a cost in
      // the score, so the button says so in words instead of showing a minus
      const fixes = !!same.found && same.small.some(c => !stuck.includes(c));
      const better = !!same.found && same.delta > 0.05 / M.k; // half the last digit shown
      const codes = same.small.filter(c => c && !stuck.includes(c));
      const help = (cat ? `החלוקה לקבוצות שמעלה הכי הרבה את ${M.of}, באותו מספר קבוצות,`
        : `הספים שמעלים הכי הרבה את ${M.of}, בלי לשנות את מספר הספים ואת סוג הסף,`) +
        ` כך שכל הקבוצות יוכלו להגיע ל-${min} רשויות גם אחרי השלבים הבאים. המספר: השינוי ${M.inOf}.` +
        (fixes ? ` היום יש ${codes.length ? inBranches(codes) : 'בשלב'} קבוצות קטנות מדי; ההתאמה מגדילה אותן, גם במחיר ירידה ${M.inOf}.` : '');
      const what = cat ? 'הקבוצות' : 'הספים';
      const label = !same.found ? `✦ מיטוב ${what}`
        : fixes ? `✦ התאמת ${what} למינימום` + (better ? ' ' + v(same) : '')
        : better ? `✦ מיטוב ${what} ${v(same)}` : cat ? '✓ הקבוצות מיטביות לשלב' : '✓ הספים מיטביים לשלב';
      const note = !same.found ? (cat ? `אין כאן חלוקה שבה כל הקבוצות יגיעו ל-${min}. נסו פחות קבוצות או מינימום נמוך יותר.`
        : `אין כאן ספים שבהם כל הקבוצות יגיעו ל-${min}. נסו פחות ספים או מינימום נמוך יותר.`)
        : stuck.length ? `${inBranches(stuck)} אין מספיק רשויות כדי שכל הקבוצות יגיעו ל-${min}; ${stuck.length > 1 ? 'הם יישארו כמו שהם' : 'הוא יישאר כמו שהוא'}.` : '';
      ui.opt.innerHTML =
        `<button type="button" class="opt-btn" data-opt="same"${fixes || better ? '' : ' disabled'} title="${esc(help)}">${label}</button>` +
        alts.map(o => {
          const left = o.found?.failed?.length ? o.of - o.found.failed.length : 0;
          const title = !o.found ? `אין ${cat ? 'חלוקה שבה' : 'ספים שבהם'} כל הקבוצות יגיעו ל-${min}`
            : `${names[o.kind]}, ${cat ? 'עם החלוקה הטובה ביותר' : 'עם הספים הטובים ביותר'}. המספר: השינוי ${M.inOf}.` +
              (left ? ` ${inBranches(o.found.failed)} אין מספיק רשויות לזה, ${o.found.failed.length > 1 ? 'והם יישארו כמו שהם' : 'והוא יישאר כמו שהוא'}.` : '');
          return `<button type="button" class="chip${o.found ? '' : ' off'}" data-opt="${o.kind}"${o.found ? '' : ' disabled'} title="${esc(title)}">` +
            `${names[o.kind]} ${o.found ? v(o) + (left ? ` · ${left} מתוך ${o.of} ענפים` : '') : '· לא אפשרי'}</button>`;
        }).join('') +
        (note ? `<p class="opt-note"><span class="ico">⚠</span>${esc(note)}</p>` : '');
      ui.opt.hidden = false;
    }

    // ---------- stage cards ----------
    const stageUI = new Map(); // slot -> card
    let openStage = THEMES[0].key; // the one stage card showing its sliders; null = all folded
    let reordering = false; // a card is being dragged: leave the card order alone

    function openOnly(i) {
      openStage = i;
      updateAll();
    }

    // One line for a folded card: the column and its thresholds.
    function stageSummary(i, T) {
      const S = stageOf(state, i);
      if (!S.col) return i === EXTRA ? 'בחרו עמודה' : 'ללא פיצול';
      const col = COL[S.col], depth = T.act.findIndex(A => A.slot === i);
      const cat = isCatCol(col);
      const list = ts => (!ts.length ? 'ללא ספים' : col.discrete ? segLabels(col, ts).join(' / ') : ts.map(t => fmt(t, col)).join(', '));
      const groups = part => (partN(part) < 2 ? 'קבוצה אחת' : partLabels(col, part).join(' / '));
      let th;
      if (S.mode === 'branch' && depth > 0) {
        const parts = T.rows[depth].filter(nd => nd.count).map(nd => (cat ? groups(nd.part) : list(nd.ts)));
        th = parts.join(' | ');
        if (th.length > 34) th = `${cat ? 'קבוצות' : 'ספים'} לפי ענף (${parts.length} ענפים)`;
      } else {
        th = cat ? groups(partOf(col, S.shared)) : list(tsOf(S.shared));
      }
      return `${col.short} · ${th}`;
    }

    function buildStages() {
      const host = $d('.params');
      [...THEMES.map(t => t.key), EXTRA].forEach(i => {
        const label = SLOT_LABEL[i], extra = i === EXTRA;
        const el = document.createElement('section');
        el.className = 'panel stage' + (extra ? ' extra' : '');
        el.dataset.slot = i;
        el.innerHTML = `
          <div class="stage-head">
            <button type="button" class="grip" title="גררו כדי לשנות את סדר השלבים" aria-label="שינוי מקום השלב ${esc(label)}: גררו, או חצים למעלה ולמטה">${GRIP}</button>
            <h3 class="stage-title"><button type="button" class="stage-toggle" aria-expanded="false" aria-controls="stage-body-${u}-${i}">
              <span>${esc(label)}${extra ? '<span class="opt-chip">לא חובה</span>' : ''}</span>
              <span class="gain"></span>
              <svg class="chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>
              <span class="stage-sum"></span>
            </button></h3>
            ${extra ? '<button type="button" class="stage-x" title="הסרת הפרמטר הנוסף" aria-label="הסרת הפרמטר הנוסף">✕</button>' : ''}
          </div>
          <div class="stage-body" id="stage-body-${u}-${i}">
            <div class="stage-pick">
              <select class="fsel" aria-label="עמודת הפיצול: ${esc(label)}">${columnOptions(extra ? null : i)}</select>
              <button type="button" class="info-btn" aria-label="על העמודה">ⓘ</button>
            </div>
            <div class="stage-ctrl">
              <div class="viewseg mode" role="group" aria-label="ספים">
                <button type="button" data-mode="shared">סף משותף</button>
                <button type="button" data-mode="branch">לפי ענף</button>
              </div>
              <div class="viewseg scale" role="group" aria-label="סקאלת הציר">
                <button type="button" data-scale="linear" title="מרחק על הציר לפי הערך">לינארית</button>
                <button type="button" data-scale="quantile" title="מרחק על הציר לפי מספר הרשויות: כל רשות מקבלת אותו רוחב">אחוזונים</button>
              </div>
              <span class="grow"></span>
              <button type="button" class="add-btn add-shared">+ סף</button>
            </div>
            <div class="opt" hidden></div>
            <div class="rows"></div>
          </div>`;
        host.appendChild(el);
        const ui = {
          i, el, grip: $('.grip', el),
          toggle: $('.stage-toggle', el), sum: $('.stage-sum', el),
          sel: $('.fsel', el), info: $('.info-btn', el), gain: $('.gain', el), ctrl: $('.stage-ctrl', el),
          modeCtl: $('.mode', el), scaleBtn: $('.scale', el), addShared: $('.add-shared', el),
          rowsHost: $('.rows', el), rows: new Map(), scale: null, scaleSig: '', opt: $('.opt', el),
        };
        stageUI.set(i, ui);

        ui.toggle.addEventListener('click', () => openOnly(openStage === i ? null : i));
        ui.grip.addEventListener('pointerdown', e => dragStage(ui, e));
        ui.grip.addEventListener('keydown', e => {
          const dir = { ArrowUp: -1, ArrowDown: 1 }[e.key];
          if (!dir) return;
          e.preventDefault();
          moveStage(i, dir);
          ui.grip.focus();
        });
        $('.stage-x', el)?.addEventListener('click', () => {
          if (openStage === EXTRA) openStage = null;
          ui.rows.forEach(r => r.el.remove());
          ui.rows.clear();
          ui.scaleSig = '';
          changeStages(() => { state.stages = state.stages.filter(S => S.slot !== EXTRA); });
          $d('.stage-add').focus();
        });
        ui.sel.addEventListener('change', () => setColumn(i, ui.sel.value));
        ui.modeCtl.addEventListener('click', e => {
          const b = e.target.closest('button[data-mode]');
          if (b) setMode(i, b.dataset.mode);
        });
        ui.scaleBtn.addEventListener('click', e => {
          const b = e.target.closest('button[data-scale]'), S = stageOf(state, i);
          if (!b || scaleType(S) === b.dataset.scale) return;
          S.scale = b.dataset.scale;
          updateAll();
        });
        ui.addShared.addEventListener('click', () => addThreshold(i, null));
        ui.opt.addEventListener('click', e => {
          const b = e.target.closest('button[data-opt]');
          if (b && !b.disabled) applyOption(i, b.dataset.opt);
        });
        const showInfo = () => {
          const col = COL[stageOf(state, i)?.col];
          if (!col) return;
          const r = ui.info.getBoundingClientRect();
          showTip(`<b>${esc(col.label)}</b>${col.description ? '<br>' + esc(col.description) : ''}` +
            (col.notes ? `<br><span class="t-dim">${esc(col.notes)}</span>` : '') +
            (col.missing ? `<br><span class="t-dim">${col.missing} רשויות ללא נתון</span>` : ''), r.left, r.bottom);
        };
        ui.info.addEventListener('pointerenter', showInfo);
        ui.info.addEventListener('focus', showInfo);
        ui.info.addEventListener('pointerleave', hideTip);
        ui.info.addEventListener('blur', hideTip);
      });

      // the optional extra stage starts as a dashed "add" card at the end of the list
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'stage-add';
      add.innerHTML = '<span class="sa-plus" aria-hidden="true">+</span><span class="sa-text"><b>פרמטר נוסף</b>' +
        '<span>לא חובה. לחצו כאן כדי להוסיף פרמטר חלוקה מתוך כל העמודות</span></span>';
      host.appendChild(add);
      add.addEventListener('click', () => {
        if (stageOf(state, EXTRA)) return;
        state.stages.push(emptyStage(EXTRA)); // no column yet, so nothing below it changes
        openStage = EXTRA;
        updateAll();
        const sel = stageUI.get(EXTRA).sel;
        sel.focus();
        try { sel.showPicker(); } catch (e) { /* the browser cannot open the list from script */ }
      });
    }

    // Cards follow state.stages; the extra card shows only once it is added, the "add" card until then.
    function syncStageOrder() {
      if (reordering) return;
      const host = $d('.params'), add = $d('.stage-add'), extraUI = stageUI.get(EXTRA);
      const hasExtra = !!stageOf(state, EXTRA);
      extraUI.el.hidden = !hasExtra;
      add.hidden = hasExtra;
      const want = [...state.stages.map(S => stageUI.get(S.slot).el), add];
      if (!hasExtra) want.push(extraUI.el);
      const cur = [...host.children];
      if (want.some((el, n) => cur[n] !== el)) want.forEach(el => host.appendChild(el));
    }

    // Run `change`, then slide each card from where it was drawn to its new place (FLIP), so
    // cards glide instead of jumping. Measuring the drawn place keeps a slide already under way smooth.
    function slideCards(els, change) {
      const before = new Map(els.map(el => [el, el.getBoundingClientRect().top]));
      change();
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      for (const el of els) {
        el.style.transition = 'none';
        el.style.transform = '';
        const dy = before.get(el) - el.getBoundingClientRect().top;
        if (still || Math.abs(dy) < 0.5) continue;
        el.style.transform = `translateY(${dy.toFixed(1)}px)`;
        void el.offsetHeight; // start the slide from the old place
        el.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.7, 0.3, 1)';
        el.style.transform = '';
      }
    }

    // Drag a card by its grip. The cards fold while one moves, the others slide out of its way,
    // and on release it glides into its slot and the new order applies. Esc puts everything back.
    // Moving the card in the page drops the grip's pointer capture, so the drag listens on the window.
    function dragStage(ui, e) {
      if (e.button) return;
      e.preventDefault();
      const host = $d('.params'), card = ui.el, pid = e.pointerId, y0 = e.clientY, reopen = openStage;
      const visible = () => [...host.querySelectorAll('.stage:not([hidden])')];
      const yIn = ev => ev.clientY - host.getBoundingClientRect().top - host.clientTop + host.scrollTop;
      const startOrder = visible();
      let active = false, grab = 0;

      const move = ev => {
        if (ev.pointerId !== pid) return;
        if (!active) {
          if (Math.abs(ev.clientY - y0) < 4) return;
          active = reordering = true;
          hideTip();
          if (openStage != null) { openStage = null; updateAll(); } // fold the cards so they are easy to move
          document.documentElement.classList.add('stage-drag');
          card.classList.add('dragging');
          card.style.transition = 'none';
          grab = clamp(yIn(ev) - card.offsetTop, 10, card.offsetHeight - 10);
        }
        ev.preventDefault();
        const y = yIn(ev), others = visible().filter(c => c !== card);
        const ref = others.find(c => y < c.offsetTop + c.offsetHeight / 2) || $d('.stage-add');
        if (card.nextElementSibling !== ref) slideCards(others, () => host.insertBefore(card, ref));
        card.style.transform = `translateY(${(y - grab - card.offsetTop).toFixed(1)}px)`;
      };

      const finish = commit => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('blur', onCancel);
        if (!active) return;
        reordering = false;
        document.documentElement.classList.remove('stage-drag');
        card.classList.remove('dragging');
        card.classList.add('settling');
        setTimeout(() => card.classList.remove('settling'), 260);
        slideCards(visible(), () => {
          if (!commit) startOrder.forEach(c => host.insertBefore(c, $d('.stage-add')));
          const order = visible().map(c => c.dataset.slot);
          openStage = reopen;
          if (commit && order.join() !== state.stages.map(S => S.slot).join()) {
            changeStages(() => state.stages.sort((x, z) => order.indexOf(x.slot) - order.indexOf(z.slot)));
          } else {
            updateAll();
          }
        });
      };
      const onUp = ev => { if (ev.pointerId === pid) finish(true); };
      const onCancel = ev => { if (!ev || ev.type === 'blur' || ev.pointerId === pid) finish(false); };
      const onKey = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); } };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('blur', onCancel);
    }

    function syncStageScale(i) {
      const S = stageOf(state, i), ui = stageUI.get(i);
      const sig = S.col + '|' + scaleType(S);
      if (ui.scaleSig !== sig) {
        ui.scale = makeScale(COL[S.col], scaleType(S));
        ui.scaleSig = sig;
      }
    }

    let usedSig = '';
    function renderStages(T, gains) {
      syncStageOrder();
      // a column already split on in one stage is greyed out in the others
      const used = new Map(state.stages.filter(S => S.col).map(S => [S.col, S.slot]));
      const sig = [...used].join();
      if (sig !== usedSig) {
        usedSig = sig;
        stageUI.forEach(ui => ui.sel.querySelectorAll('option:not(.opt-sub)').forEach(o => {
          o.disabled = !!o.value && used.has(o.value) && used.get(o.value) !== ui.i;
        }));
      }
      for (const S of state.stages) {
        const i = S.slot, ui = stageUI.get(i), open = openStage === i;
        ui.el.classList.toggle('open', open);
        ui.toggle.setAttribute('aria-expanded', String(open));
        ui.sum.textContent = stageSummary(i, T);
        ui.sel.value = S.col;
        ui.el.classList.toggle('is-empty', !S.col);
        ui.info.hidden = !S.col;
        ui.ctrl.hidden = !S.col;
        if (!S.col) {
          ui.gain.innerHTML = '';
          ui.rows.forEach(r => r.el.remove());
          ui.rows.clear();
          continue;
        }
        const col = COL[S.col], depth = T.act.findIndex(A => A.slot === i);
        const branch = S.mode === 'branch' && depth > 0;
        ui.gain.innerHTML = scoreChip(gains[depth]);
        if (!open) continue; // folded: its sliders are redrawn when it opens
        syncStageScale(i);
        ui.modeCtl.hidden = depth === 0;
        pressOnly(ui.modeCtl, b => b.dataset.mode === (branch ? 'branch' : 'shared'));
        ui.scaleBtn.hidden = col.discrete;
        pressOnly(ui.scaleBtn, b => b.dataset.scale === scaleType(S));
        const cat = isCatCol(col);
        ui.addShared.hidden = branch || cat;
        ui.addShared.disabled = !cat && col.discrete && new Set(tsOf(S.shared)).size >= col.cats.length - 1;
        $('[data-mode="shared"]', ui.modeCtl).textContent = cat ? 'חלוקה משותפת' : 'סף משותף';

        const nodes = branch ? T.rows[depth] : [null];
        const want = nodes.map(nd => (nd ? nd.key : '*'));
        // a category column has boards, the others sliders
        ui.rows.forEach((r, k) => { if (!want.includes(k) || !!r.board !== cat) { r.el.remove(); ui.rows.delete(k); } });
        const rows = want.map(k => {
          if (!ui.rows.has(k)) ui.rows.set(k, (cat ? createBoard : createRow)(i, k === '*' ? null : k));
          return ui.rows.get(k);
        });
        const cur = [...ui.rowsHost.children];
        if (cur.length !== rows.length || rows.some((r, n) => cur[n] !== r.el)) rows.forEach(r => ui.rowsHost.appendChild(r.el));
        rows.forEach((r, n) => (cat ? updateBoard(r, nodes[n], n === 0) : updateRow(r, nodes[n])));
      }
      scheduleOptions();
    }

    // One slider: the shared one of a stage, or one per branch.
    function createRow(i, key) {
      const el = document.createElement('div');
      el.className = 'srow' + (key != null ? ' branch' : '');
      el.innerHTML = (key != null
        ? '<div class="srow-head"><span class="code"></span><span class="path"></span><span class="cnt"></span><button type="button" class="add-btn" aria-label="הוספת סף" title="הוספת סף">+</button></div>'
        : '') +
        '<svg class="dots" aria-hidden="true"></svg>' +
        '<div class="track" title="גררו להזזה · לחיצה כפולה מוסיפה סף"><div class="segs"></div><div class="handles"></div></div>' +
        '<div class="bubbles"></div><div class="axis"></div>';
      const r = {
        i, key, el,
        dots: $('.dots', el), track: $('.track', el), segs: $('.segs', el), handles: $('.handles', el),
        bubbles: $('.bubbles', el), axis: $('.axis', el),
        code: $('.code', el), path: $('.path', el), cnt: $('.cnt', el),
        hEls: new Map(), dotEls: [], sig: '', width: 0,
      };
      wireRow(r);
      return r;
    }

    function wireRow(r) {
      const { i, key } = r;
      const scale = () => stageUI.get(i).scale;
      const pFromEvent = ev => {
        const rect = r.track.getBoundingClientRect();
        return clamp(1 - (ev.clientX - rect.left) / rect.width, 0, 1);
      };
      $('.srow-head .add-btn', r.el)?.addEventListener('click', () => addThreshold(i, key));
      r.track.addEventListener('dblclick', e => { if (!e.target.closest('.handle')) addThreshold(i, key, pFromEvent(e)); });
      r.dots.addEventListener('dblclick', e => addThreshold(i, key, pFromEvent(e)));

      r.handles.addEventListener('pointerdown', e => {
        const hEl = e.target.closest('.handle');
        if (!hEl) return;
        e.preventDefault();
        try { hEl.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
        hEl.focus({ preventScroll: true });
        hEl.classList.add('dragging');
        const id = Number(hEl.dataset.id);
        const move = ev => setThreshold(i, key, id, scale().fromP(pFromEvent(ev)), true);
        const up = () => {
          hEl.classList.remove('dragging');
          hEl.removeEventListener('pointermove', move);
          hEl.removeEventListener('pointerup', up);
          hEl.removeEventListener('pointercancel', up);
        };
        hEl.addEventListener('pointermove', move);
        hEl.addEventListener('pointerup', up);
        hEl.addEventListener('pointercancel', up);
      });
      r.handles.addEventListener('keydown', e => {
        const hEl = e.target.closest('.handle');
        if (!hEl) return;
        const col = COL[stageOf(state, i).col], id = Number(hEl.dataset.id);
        const h = effectiveHs(state, i, key).find(x => x.id === id);
        if (!h) return;
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeThreshold(i, key, id); return; }
        const dir = { ArrowLeft: 1, ArrowUp: 1, ArrowRight: -1, ArrowDown: -1 }[e.key]; // RTL: left = higher
        if (!dir) return;
        e.preventDefault();
        const step = col.discrete ? 1 / col.cats.length : 0.01;
        const p0 = scale().toP(h.v);
        for (let k = 1; k <= 20; k++) {
          const v = niceRound(scale().fromP(clamp(p0 + dir * step * k, 0, 1)), col);
          if (v !== h.v) { setThreshold(i, key, id, v, false); break; }
        }
      });
      r.bubbles.addEventListener('click', e => {
        const del = e.target.closest('.b-del');
        if (del) { removeThreshold(i, key, Number(del.dataset.id)); return; }
        const val = e.target.closest('.b-val');
        if (val) startEdit(i, key, Number(val.dataset.id), val);
      });
      r.dots.addEventListener('pointermove', e => {
        const c = e.target.closest('circle');
        if (!c) { hideTip(); return; }
        const a = AUTH[Number(c.dataset.ai)], col = COL[stageOf(state, i).col];
        showTip(`<b>${esc(a.name)}</b><br><span class="t-dim">${esc(col.short)}:</span> ${esc(fmt(a.v[col.idx], col))}`, e.clientX, e.clientY);
      });
      r.dots.addEventListener('pointerleave', hideTip);
      if (key != null) {
        r.el.addEventListener('pointerenter', () => focusTree(key));
        r.el.addEventListener('pointerleave', () => focusTree(null));
      }
    }

    function updateRow(r, node) {
      const S = stageOf(state, r.i), col = COL[S.col], ui = stageUI.get(r.i);
      const ts = tsOf(effectiveHs(state, r.i, r.key)), n = ts.length + 1;
      const members = node ? node.members : AUTH;
      const w = r.track.clientWidth;
      const sig = `${ui.scaleSig}|${w}|${node ? members.map(a => a.id).join(',') : '*'}`;
      if (sig !== r.sig) { layoutDots(r, col, ui.scale, members, w, node ? 40 : 56); r.sig = sig; r.width = w; }

      if (node) {
        r.code.textContent = codeOf(node.path);
        r.path.textContent = pathSteps(node).map(s => s.label).join(' › ');
        r.cnt.textContent = node.count;
        r.el.classList.toggle('void', !node.count);
        $('.srow-head .add-btn', r.el).disabled = col.discrete && new Set(ts).size >= col.cats.length - 1;
      }

      const sc = ui.scale;
      const bounds = [0, ...ts.map(t => clamp(sc.toP(t), 0, 1)), 1];
      r.segs.innerHTML = bounds.slice(0, -1).map((b, s) => {
        const b2 = bounds[s + 1];
        return `<div class="tseg" style="left:${xOf(b2, w)}px;width:${Math.max(0, (b2 - b) * w)}px;background:${rampColor(s, n)}"></div>`;
      }).join('');
      r.dotEls.forEach(d => d.el.setAttribute('fill', rampColor(segOf(d.v, ts), n)));

      // handles are kept by id so a drag survives re-renders
      const hs = effectiveHs(state, r.i, r.key);
      const live = new Set();
      for (const h of hs) {
        live.add(h.id);
        let el = r.hEls.get(h.id);
        if (!el) {
          el = document.createElement('div');
          el.className = 'handle';
          el.tabIndex = 0;
          el.setAttribute('role', 'slider');
          el.dataset.id = h.id;
          r.handles.appendChild(el);
          r.hEls.set(h.id, el);
        }
        el.style.left = xOf(sc.toP(h.v), w) + 'px';
        el.setAttribute('aria-label', `סף: ${SLOT_LABEL[r.i]}` + (node ? `, ענף ${codeOf(node.path)}` : ''));
        el.setAttribute('aria-valuetext', fmt(h.v, col));
      }
      r.hEls.forEach((el, id) => { if (!live.has(id)) { el.remove(); r.hEls.delete(id); } });

      // value bubbles, staggered into two rows only when they would overlap
      const placed = hs.map(h => {
        const text = col.discrete ? '' : fmt(h.v, col);
        return { h, text, x: clamp(xOf(sc.toP(h.v), w), 26, w - 26), bw: 26 + (text ? 10 + 7 * text.length : 0) };
      }).sort((a, b) => b.x - a.x);
      const last = [null, null];
      const fits = (L, b) => !L || L.x - b.x >= (L.bw + b.bw) / 2 + 4;
      let twoRows = false;
      r.bubbles.innerHTML = placed.map(b => {
        const row = fits(last[0], b) ? 0 : fits(last[1], b) ? 1 : 0;
        last[row] = b;
        if (row) twoRows = true;
        const val = b.text ? `<button type="button" class="b-val" data-id="${b.h.id}" title="עריכת ערך">${esc(b.text)}</button>` : '';
        return `<div class="bubble${row ? ' row1' : ''}" style="left:${b.x}px">${val}<button type="button" class="b-del" data-id="${b.h.id}" aria-label="הסרת הסף" title="הסרת הסף">×</button></div>`;
      }).join('');
      r.bubbles.classList.toggle('two-rows', twoRows);
    }

    // The groups of a category column: one box per group with its categories as chips. A chip moves
    // by dragging it to another box, or by a click on it and then on the box (keyboard and touch too).
    function createBoard(i, key) {
      const el = document.createElement('div');
      el.className = 'srow board' + (key != null ? ' branch' : '');
      el.innerHTML = (key != null ? '<div class="srow-head"><span class="code"></span><span class="path"></span><span class="cnt"></span></div>' : '') +
        '<p class="cb-hint">גררו קטגוריה לקבוצה אחרת, או לחצו עליה ואז על הקבוצה.</p><div class="cgroups"></div>';
      const r = {
        i, key, el, board: true, groups: $('.cgroups', el), hint: $('.cb-hint', el),
        code: $('.code', el), path: $('.path', el), cnt: $('.cnt', el), picked: null, sig: '', dotEls: [],
      };
      wireBoard(r);
      return r;
    }

    function wireBoard(r) {
      const { i, key } = r;
      const node = () => (key == null ? null : lastTree.byKey.get(key));
      const refresh = () => updateBoard(r, node(), !r.hint.hidden);
      const target = el => {
        const g = el && el.closest('.cgroup');
        return !g || g.getAttribute('aria-disabled') === 'true' ? null : g.dataset.g === 'new' ? 'new' : Number(g.dataset.g);
      };
      const drop = (ci, to) => {
        r.picked = null;
        if (to == null) { refresh(); return; }
        moveCategory(i, key, ci, to);
        refresh();
      };
      r.groups.addEventListener('click', e => {
        const chip = e.target.closest('.cchip');
        const part = partOf(COL[stageOf(state, i).col], effectiveHs(state, i, key));
        if (chip) {
          const ci = Number(chip.dataset.c);
          // a chip in another group, while one is picked, takes it into that group
          if (r.picked != null && r.picked !== ci && part[ci] !== part[r.picked]) { drop(r.picked, part[ci]); return; }
          r.picked = r.picked === ci ? null : ci;
          refresh();
          return;
        }
        if (r.picked != null) drop(r.picked, target(e.target));
      });
      r.groups.addEventListener('keydown', e => {
        if (e.key === 'Escape' && r.picked != null) { e.preventDefault(); r.picked = null; refresh(); return; }
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('cgroup') && r.picked != null) {
          e.preventDefault();
          drop(r.picked, target(e.target));
        }
      });
      let dragC = null;
      r.groups.addEventListener('dragstart', e => {
        const chip = e.target.closest('.cchip');
        if (!chip) return;
        dragC = Number(chip.dataset.c);
        chip.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(dragC));
      });
      r.groups.addEventListener('dragend', e => {
        e.target.closest('.cchip')?.classList.remove('dragging');
        r.groups.querySelectorAll('.over').forEach(g => g.classList.remove('over'));
        dragC = null;
      });
      r.groups.addEventListener('dragover', e => {
        if (dragC == null || target(e.target) == null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const g = e.target.closest('.cgroup');
        r.groups.querySelectorAll('.over').forEach(x => { if (x !== g) x.classList.remove('over'); });
        g.classList.add('over');
      });
      r.groups.addEventListener('dragleave', e => {
        const g = e.target.closest('.cgroup');
        if (g && !g.contains(e.relatedTarget)) g.classList.remove('over');
      });
      r.groups.addEventListener('drop', e => {
        const ci = dragC ?? Number(e.dataTransfer.getData('text/plain'));
        const to = target(e.target);
        if (!Number.isInteger(ci) || to == null) return;
        e.preventDefault();
        drop(ci, to);
      });
      if (key != null) {
        r.el.addEventListener('pointerenter', () => focusTree(key));
        r.el.addEventListener('pointerleave', () => focusTree(null));
      }
    }

    function updateBoard(r, node, first) {
      const col = COL[stageOf(state, r.i).col];
      const part = partOf(col, effectiveHs(state, r.i, r.key)), n = partN(part);
      const members = node ? node.members : AUTH;
      const per = col.cats.map(() => 0);
      for (const a of members) { const v = a.v[col.idx]; if (v != null) per[col.catIdx.get(v)]++; }
      if (node) {
        r.code.textContent = codeOf(node.path);
        r.path.textContent = pathSteps(node).map(s => s.label).join(' › ');
        r.cnt.textContent = node.count;
        r.el.classList.toggle('void', !node.count);
      }
      r.hint.hidden = !first;
      if (r.picked != null && r.picked >= part.length) r.picked = null;
      const sig = `${part.join()}|${per.join()}|${r.picked}|${n}`;
      if (sig === r.sig) return;
      r.sig = sig;
      const focused = r.groups.contains(document.activeElement) ? document.activeElement : null;
      const refocus = focused && (focused.dataset.c != null ? `.cchip[data-c="${focused.dataset.c}"]` : `.cgroup[data-g="${focused.dataset.g}"]`);
      const picking = r.picked != null;
      const alone = picking && part.filter(g => g === part[r.picked]).length === 1;
      const groupBox = g => {
        const cs = part.map((x, ci) => ci).filter(ci => part[ci] === g);
        const total = cs.reduce((sum, ci) => sum + per[ci], 0);
        const own = picking && part[r.picked] === g;
        return `<div class="cgroup" data-g="${g}" style="--gc:${rampColor(g, n)}"${picking && !own ? ' role="button" tabindex="0"' : ''}` +
          ` aria-label="קבוצה ${g + 1}${picking && !own ? `: העברת ${esc(catName(col, r.picked))} לכאן` : ''}">` +
          `<span class="cg-head${total < state.min ? ' small' : ''}">קבוצה ${g + 1}<span class="n">${total}</span></span>` +
          cs.map(ci => `<button type="button" class="cchip" draggable="true" data-c="${ci}" aria-pressed="${ci === r.picked}">` +
            `${esc(catName(col, ci))}<span class="n">${per[ci]}</span></button>`).join('') + '</div>';
      };
      const canNew = !(picking && alone) && n < part.length;
      r.groups.innerHTML = Array.from({ length: n }, (_, g) => groupBox(g)).join('') +
        `<div class="cgroup new" data-g="new"${picking && canNew ? ' role="button" tabindex="0"' : ''}${canNew ? '' : ' aria-disabled="true"'}>+ קבוצה חדשה</div>`;
      r.groups.classList.toggle('picking', picking);
      if (refocus) $(refocus, r.groups)?.focus({ preventScroll: true });
    }

    // Dot plot: one dot per authority, stacked where they collide.
    function layoutDots(r, col, scale, members, w, H) {
      const items = dotItems(members, col, scale, w), rad = placeDots(items, col, w, H);
      r.dots.setAttribute('viewBox', `0 0 ${w} ${H}`);
      r.dots.style.height = H + 'px';
      r.dots.innerHTML = items.map(it =>
        `<circle cx="${it.cx.toFixed(1)}" cy="${it.cy.toFixed(1)}" r="${rad.toFixed(2)}" data-ai="${it.ai}"></circle>`).join('');
      r.dotEls = [...r.dots.children].map((el, k) => ({ el, v: items[k].v, id: AUTH[items[k].ai].id }));

      r.axis.classList.toggle('cats', col.discrete);
      if (col.discrete) {
        // one equal slot per category, low codes on the right; long names wrap inside their slot
        r.axis.innerHTML = col.cats.map(c => `<span class="cat">${esc(col.categories[String(c)] ?? c)}</span>`).join('');
      } else if (r.key == null) {
        r.axis.innerHTML = `<span>${esc(fmt(col.min, col))}</span><span>${esc(fmt(col.max, col))}</span>`;
      } else {
        r.axis.innerHTML = '';
      }
    }
    // The members with a value in col, each at its place x on a scale w wide.
    function dotItems(members, col, scale, w) {
      const items = [];
      for (const a of members) {
        const v = a.v[col.idx];
        if (v != null) items.push({ ai: a.ai, v, x: xOf(scale.toP(v), w) });
      }
      return items;
    }
    // Dots for the items in a box w × H, from the bottom up: a column of categories gets one
    // block per category, the others stack where they collide. Sets each item's cx and cy, and
    // returns the dots' radius.
    function placeDots(items, col, w, H) {
      let rad;
      if (col.discrete) {
        const k = col.cats.length, bw = (w / k) * 0.86;
        const byCat = col.cats.map(c => items.filter(it => it.v === c));
        const maxN = Math.max(1, ...byCat.map(b => b.length));
        let d = 7, cols = 1;
        for (; d > 2.5; d -= 0.5) {
          cols = Math.max(1, Math.floor(bw / (d + 1.5)));
          if (Math.ceil(maxN / cols) * (d + 1.5) <= H) break;
        }
        const step = d + 1.5;
        byCat.forEach((list, ci) => {
          const cx = xOf((ci + 0.5) / k, w), nc = Math.min(cols, list.length);
          list.forEach((it, j) => {
            it.cx = cx - (nc * step) / 2 + ((j % nc) + 0.5) * step;
            it.cy = H - (Math.floor(j / nc) + 0.5) * step;
          });
        });
        rad = d / 2;
      } else {
        items.sort((a, b) => a.v - b.v);
        const stack = step => {
          const bins = new Map();
          let mx = 0;
          for (const it of items) {
            const b = Math.round(it.x / step), n = bins.get(b) || 0;
            bins.set(b, n + 1);
            it.stack = n;
            mx = Math.max(mx, n + 1);
          }
          return mx;
        };
        let step = 8.5, mx = stack(step);
        while (mx * step > H && step > 4) { step -= 0.5; mx = stack(step); }
        const rowH = Math.min(step, H / Math.max(1, mx));
        items.forEach(it => { it.cx = it.x; it.cy = H - (it.stack + 0.5) * rowH; });
        rad = Math.max(1.5, Math.min(step, rowH) - 1.5) / 2;
      }
      return rad;
    }

    function startEdit(i, key, id, btn) {
      const col = COL[stageOf(state, i).col];
      const h = effectiveHs(state, i, key).find(x => x.id === id);
      if (!h) return;
      const input = document.createElement('input');
      input.className = 'b-input';
      input.dir = 'ltr';
      input.value = editStr(h.v, col);
      input.setAttribute('aria-label', 'ערך הסף' + (col.kind === 'percent' ? ' באחוזים' : ''));
      btn.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const commit = ok => {
        if (done) return;
        done = true;
        const v = ok ? parseInput(input.value, col) : null;
        if (v != null) setThreshold(i, key, id, v, false);
        updateAll();
      };
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') commit(true);
        else if (e.key === 'Escape') commit(false);
      });
      input.addEventListener('blur', () => commit(true));
    }

    // ---------- tree ----------
    // Top to bottom: all authorities, one row per stage, the groups as the leaves. Each node
    // spans the columns of its groups; the branches are drawn in an SVG behind the grid, their
    // width set by size. A group's authorities show under the tree once its leaf is clicked.
    // The clicked group is the same one the map lights (mapState.pin).
    function selectedLeaf(T) {
      const nd = mapState.pin != null ? T.byKey.get(mapState.pin) : null;
      return nd && !nd.children && nd.count ? nd : null;
    }
    function pathKeys(nd) {
      const keys = new Set();
      for (; nd; nd = nd.parent) keys.add(nd.key);
      return keys;
    }

    function renderTree(T, gains) {
      const host = $d('.tree-view');
      if (!T.act.length) { host.innerHTML = '<p class="empty-state">בחרו עמודה לאחד השלבים</p>'; return; }
      const leaves = T.leaves.filter(l => l.count > 0);
      const sel = selectedLeaf(T), onPath = pathKeys(sel);
      const colOf = new Map(leaves.map((l, c) => [l.key, c + 2])); // column 1 holds the stage names
      const span = new Map();
      for (const l of leaves) {
        const c = colOf.get(l.key);
        for (let nd = l; nd; nd = nd.parent) {
          const s = span.get(nd.key);
          if (s) s[1] = c; else span.set(nd.key, [c, c]);
        }
      }
      const cols = key => { const [a, b] = span.get(key); return `${a} / ${b + 1}`; };

      let html = `<div class="tree-scroll"><div class="vtree" style="--leaves:${leaves.length}"><svg class="links" aria-hidden="true"></svg>` +
        `<div class="tn-cell" style="grid-row:1;grid-column:${cols('')}"><div class="tn tn-root" data-key=""><b>${T.total}</b><span class="tn-n">רשויות</span></div></div>`;
      T.act.forEach((A, d) => {
        html += `<div class="vt-label" data-stage="${A.slot}" style="grid-row:${d + 2};grid-column:1">` +
          `<span class="vt-theme">${esc(SLOT_LABEL[A.slot])}</span><span class="vt-col" title="${esc(A.col.label)}">${esc(A.col.short)}</span>${scoreChip(gains[d])}</div>`;
        for (const nd of T.rows[d + 1]) {
          if (!nd.count) continue;
          const split = nd.parent.n > 1, lab = esc(split ? nd.parent.labels[nd.seg] : 'ללא פיצול');
          const pos = `grid-row:${d + 2};grid-column:${cols(nd.key)}`;
          if (nd.children) {
            html += `<div class="tn-cell" style="${pos}"><div class="tn${split ? '' : ' pass'}${onPath.has(nd.key) ? ' onpath' : ''}" data-key="${nd.key}">` +
              `<span class="tn-lab">${lab}</span><span class="tn-n">${nd.count}</span></div></div>`;
            continue;
          }
          const warn = nd.count < state.min;
          html += `<button type="button" class="tn leaf${split ? '' : ' pass'}${warn ? ' warn' : ''}${nd === sel ? ' sel' : ''}"` +
            ` data-key="${nd.key}" style="${pos};${dotStyle(nd.key)}" aria-pressed="${nd === sel}">` +
            `<span class="leaf-code">${codeOf(nd.path)}</span><span class="tn-lab">${lab}</span>` +
            `<span class="tn-n">${warn ? '⚠ ' : ''}${nd.count}</span></button>`;
        }
      });
      html += '</div></div>';
      html += sel ? groupCard(sel) : '<p class="gcard-empty">לחצו על אחת הקבוצות בתחתית העץ כדי לראות אילו רשויות יש בה</p>';
      const scrolled = $('.tree-scroll', host)?.scrollLeft || 0;
      host.innerHTML = html;
      const sc = $('.tree-scroll', host);
      sc.scrollLeft = scrolled; // a re-render keeps the sideways scroll
      if (sc.offsetParent) {
        const leaf = sel && $('.tn.sel', sc);
        if (leaf && sel.key !== revealed) revealLeaf(sc, leaf);
        revealed = sel ? sel.key : null;
      }
      drawLinks();
    }

    // Scroll a newly picked group's leaf into view when the tree is wider than the panel.
    let revealed = null;
    function revealLeaf(sc, el) {
      const s = sc.getBoundingClientRect(), r = el.getBoundingClientRect();
      const right = s.right - ($('.vt-label', sc)?.offsetWidth || 0) - 8, left = s.left + 8; // the stage names cover the right edge
      if (r.right > right) sc.scrollBy({ left: r.right - right });
      else if (r.left < left) sc.scrollBy({ left: r.left - left });
    }

    function groupCard(l) {
      const warn = l.count < state.min, code = codeOf(l.path);
      const steps = pathSteps(l).map(st => `<span><span class="t-dim">${esc(st.col.short)}:</span> ${esc(st.label)}</span>`)
        .join('<span class="t-dim">›</span>');
      const members = [...l.members].sort((a, b) => collator.compare(a.name, b.name))
        .map(a => `<span class="m" data-id="${a.id}">${esc(a.name)}</span>`).join('');
      return `<section class="gcard${warn ? ' warn' : ''}" aria-label="קבוצה ${code}">` +
        `<div class="gc-head"><i class="g-dot" style="${dotStyle(l.key)}"></i><span class="gc-code">${code}</span>` +
        `<h3 class="gc-name">${esc(groupName(l))}</h3>` +
        `<span class="gc-count">${warn ? '⚠ ' : ''}${l.count} רשויות${warn ? ` · מתחת ל-${state.min}` : ''}</span>` +
        `<span class="gc-actions">${HAS_MAP ? '<button type="button" class="chip" data-act="map">הצגה במפה</button>' : ''}` +
        `<button type="button" class="chip" data-act="close" aria-label="סגירת הקבוצה">✕</button></span></div>` +
        (steps ? `<div class="gc-path">${steps}</div>` : '') +
        `<div class="g-members">${members}</div></section>`;
    }

    // Branch widths follow the number of authorities; siblings stack along the parent's
    // bottom edge, the first segment rightmost.
    function drawLinks() {
      const grid = $d('.tree-view .vtree'), T = lastTree;
      const svg = grid && $('.links', grid);
      if (!svg || !T) return;
      if (!grid.offsetParent) { svg.innerHTML = ''; return; } // hidden behind the map
      const gr = grid.getBoundingClientRect();
      const node = new Map();
      grid.querySelectorAll('.tn').forEach(el => {
        const r = el.getBoundingClientRect();
        node.set(el.dataset.key, { x: (r.left + r.right) / 2 - gr.left, top: r.top - gr.top, bottom: r.bottom - gr.top });
      });
      const onPath = pathKeys(selectedLeaf(T));
      const widthOf = n => Math.max(1.5, (16 * n) / T.total);
      const f = v => v.toFixed(1);
      const curve = (x1, y1, x2, y2) => {
        const my = (y1 + y2) / 2;
        return `M${f(x1)} ${f(y1)}C${f(x1)} ${f(my)} ${f(x2)} ${f(my)} ${f(x2)} ${f(y2)}`;
      };
      let paths = '';
      for (let d = 0; d < T.act.length; d++) {
        for (const p of T.rows[d]) {
          const from = node.get(p.key);
          if (!from || !p.children) continue;
          const kids = p.children.filter(c => c.count && node.has(c.key));
          let x = from.x + kids.reduce((s, c) => s + widthOf(c.count), 0) / 2;
          for (const c of kids) {
            const w = widthOf(c.count), to = node.get(c.key);
            paths += `<path data-key="${c.key}"${onPath.has(c.key) ? ' class="onpath"' : ''} stroke-width="${w.toFixed(2)}" d="${curve(x - w / 2, from.bottom, to.x, to.top)}"></path>`;
            x -= w;
          }
        }
      }
      svg.innerHTML = paths;
    }

    // Light up a node, its ancestors and everything under it; dim the rest.
    function focusTree(key) {
      const host = $d('.tree-view');
      host.classList.toggle('focus', key != null);
      if (key == null) return;
      const anc = new Set([key]);
      for (let k = key; k !== ''; k = parentKey(k)) anc.add(parentKey(k));
      const on = k => anc.has(k) || key === '' || k.startsWith(key + '.');
      host.querySelectorAll('[data-key]').forEach(el => el.classList.toggle('on', on(el.dataset.key)));
    }

    function renderUnassigned(T) {
      const U = T.unassigned, el = $d('.unassigned');
      el.hidden = !U.length;
      const byCol = new Map();
      for (const u of U) {
        if (!byCol.has(u.col)) byCol.set(u.col, []);
        byCol.get(u.col).push(u.a.name);
      }
      el.innerHTML = U.length
        ? `<b>${U.length} רשויות לא שובצו</b> כי חסר להן נתון. ` +
          [...byCol].map(([col, names]) => `חסר ${esc(col.short)}: ${names.map(esc).join(', ')}`).join('. ')
        : '';
    }

    function renderSummary(T, gains) {
      const groups = T.leaves.filter(l => l.count > 0);
      const under = groups.filter(l => l.count < state.min).length;
      let html = `<span class="stat"><b>${groups.length}</b>קבוצות</span>`;
      if (under) html += `<span class="stat bad"><span class="ico">⚠</span><b>${under}</b>מתחת ל-${state.min}</span>`;
      const M = metric();
      if (gains.length && gains[0] != null) {
        const total = gains.reduce((s, g) => s + g, 0);
        html += `<span class="stat score"><b class="v">${scoreText(total)}${M.k === 10 ? '<span class="of">/10</span>' : ''}</b>${M.score}` +
          `<button type="button" class="help-btn" data-help="${esc(M.scoreHelp())}" aria-label="מה זה ${M.score}">?</button></span>`;
      } else if (scoring.mode === 'target' && !TARGET) {
        html += '<span class="stat">בחרו מדד מטרה</span>';
      }
      // a target that the groups were built from, or nearly, scores high for that alone
      const issues = targetIssues(T);
      if (issues.length) {
        html += `<span class="stat bad" tabindex="0" data-help="${esc(issues.map(issueText).join(' '))}"><span class="ico">⚠</span>` +
          `${issues.some(x => x.same) ? 'מדד המטרה הוא פרמטר בחלוקה' : 'מדד המטרה קרוב לפרמטר בחלוקה'}</span>`;
      }
      if (T.unassigned.length) html += `<span class="stat"><b>${T.unassigned.length}</b>לא שובצו</span>`;
      $d('.stats').innerHTML = html;
    }

    function syncRecButton(T) {
      const btn = $d('.btn-rec');
      const same = canonical(state, T) === REC_CANON;
      btn.disabled = same;
      btn.textContent = same ? '✓ החלוקה המומלצת' : 'טעינת החלוקה המומלצת';
      btn.title = REC.label || '';
    }

    // ---------- group colors, shared by the tree and the map ----------
    // Groups with the same parent form a family: one hue per family, light to dark from the
    // lowest segment of the last split to the highest. Families under different first-stage
    // branches sit further apart on the hue list.
    const HUES = [255, 195, 145, 95, 55, 5, 325, 290]; // OKLCH: blue, teal, green, ochre, orange, rose, magenta, violet
    let colorOf = new Map();

    function families(T) {
      const fams = [];
      for (const l of T.leaves) {
        if (!l.count) continue;
        const f = fams[fams.length - 1];
        if (f && f.parent === l.parent) f.leaves.push(l);
        else fams.push({ parent: l.parent, top: l.path[0] || 0, leaves: [l] });
      }
      return fams;
    }

    function groupColors(T) {
      const fams = families(T), out = new Map();
      const tops = new Set(fams.map(f => f.top)).size;
      const gaps = tops > 1 && fams.length + tops <= HUES.length;
      const slots = fams.length + (gaps ? tops : 0);
      const step = slots <= HUES.length ? HUES.length / slots : 1;
      let pos = 0;
      fams.forEach((f, i) => {
        if (gaps && i && f.top !== fams[i - 1].top) pos++;
        const h = HUES[Math.round(pos * step) % HUES.length];
        pos++;
        const m = f.leaves.length;
        f.leaves.forEach((l, j) => {
          const t = m === 1 ? 0.5 : j / (m - 1);
          const L = 0.82 - 0.36 * t;
          const C = 0.15 - 0.08 * Math.max(0, L - 0.6);
          const ok = (l2, c) => `oklch(${l2.toFixed(3)} ${c.toFixed(3)} ${h})`;
          out.set(l.key, { fill: ok(L, C), stroke: ok(L - 0.24, C) });
        });
      });
      return out;
    }
    const dotStyle = key => { const c = colorOf.get(key); return c ? `--c:${c.fill};--c2:${c.stroke}` : ''; };

    // ---------- map: one point per authority, colored by its group ----------
    // mode: which view shows ('tree', 'map' or 'dist'). pin: the group or family kept lit, in
    // every view; hover: one previewed from the legend. leafOf: each authority's group.
    // k, tx, ty: screen = unit * k + t. fitK: the k that fits the country.
    const mapState = {
      mode: 'tree', pin: null, hover: null, hoverId: null, hits: new Set(),
      k: 0, tx: 0, ty: 0, fitK: 1, moved: false, w: 0, h: 0, leafOf: new Map(), pts: [],
    };

    function fitView(list, maxK) {
      const s = mapState, pad = 26;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const a of list) {
        x0 = Math.min(x0, a.xy[0]); x1 = Math.max(x1, a.xy[0]);
        y0 = Math.min(y0, a.xy[1]); y1 = Math.max(y1, a.xy[1]);
      }
      s.k = Math.min((s.w - 2 * pad) / Math.max(x1 - x0, 1e-3), (s.h - 2 * pad) / Math.max(y1 - y0, 1e-3), maxK || Infinity);
      s.tx = s.w / 2 - ((x0 + x1) / 2) * s.k;
      s.ty = s.h / 2 - ((y0 + y1) / 2) * s.k;
    }

    // Keep the zoom in range and the middle of the view over the country.
    function clampView() {
      const s = mapState, b = PTS_BOX;
      const cx = (s.w / 2 - s.tx) / s.k, cy = (s.h / 2 - s.ty) / s.k;
      s.k = clamp(s.k, s.fitK * ZOOM_MIN, s.fitK * ZOOM_MAX);
      s.tx = s.w / 2 - clamp(cx, b.x0, b.x1) * s.k;
      s.ty = s.h / 2 - clamp(cy, b.y0, b.y1) * s.k;
    }

    function zoomAt(f, px, py) {
      const s = mapState, k = clamp(s.k * f, s.fitK * ZOOM_MIN, s.fitK * ZOOM_MAX);
      s.tx = px - ((px - s.tx) * k) / s.k;
      s.ty = py - ((py - s.ty) * k) / s.k;
      s.k = k;
      s.moved = true;
      clampView();
      requestDraw();
    }

    // Refit on a size change; a view the user moved keeps its middle and relative zoom.
    function syncMapSize() {
      const box = $d('.map-box'), s = mapState, w = box.clientWidth, h = box.clientHeight;
      if (!w || !h) return false;
      if (w === s.w && h === s.h) return true;
      const cx = s.k ? (s.w / 2 - s.tx) / s.k : 0, cy = s.k ? (s.h / 2 - s.ty) / s.k : 0, rel = s.k / s.fitK;
      s.w = w; s.h = h;
      fitView(LOCATED);
      s.fitK = s.k;
      if (s.moved) {
        s.k = s.fitK * rel;
        s.tx = w / 2 - cx * s.k;
        s.ty = h / 2 - cy * s.k;
        clampView();
      }
      return true;
    }

    let mapRaf = 0;
    function requestDraw() {
      if (!mapRaf) mapRaf = requestAnimationFrame(() => { mapRaf = 0; drawMap(); });
    }

    const inKey = (key, focus) => focus == null || key === focus || key.startsWith(focus + '.');

    function drawMap() {
      const s = mapState;
      if (s.mode !== 'map' || !lastTree || !syncMapSize()) return;
      const { k, tx, ty, w, h } = s;
      $d('.map-base').setAttribute('transform', `matrix(${k} 0 0 ${k} ${tx} ${ty})`);
      const focus = s.hover ?? s.pin;
      const r0 = clamp(3.6 + 0.9 * Math.log2(k / s.fitK), 3.6, 6.5); // points grow a little as you zoom in
      const pts = [];
      let back = '', front = '', top = '';
      for (const a of LOCATED) {
        const x = a.xy[0] * k + tx, y = a.xy[1] * k + ty;
        if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
        const leaf = s.leafOf.get(a.id), c = leaf && colorOf.get(leaf.key);
        const on = leaf ? inKey(leaf.key, focus) : focus == null;
        const hit = s.hits.has(a.id), hov = a.id === s.hoverId;
        const r = hit || hov ? r0 + 1.5 : r0;
        const cls = [c ? '' : 'none', on ? '' : 'dim', hit ? 'hit' : '', hov ? 'hover' : ''].filter(Boolean).join(' ');
        const el = `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"` +
          `${c ? ` fill="${c.fill}" stroke="${c.stroke}"` : ''}${cls ? ` class="${cls}"` : ''}></circle>`;
        if (hit || hov) top += el; else if (on) front += el; else back += el;
        pts.push({ a, x, y, r, on, hit });
      }
      $d('.map-pts').innerHTML = back + front + top;
      s.pts = pts;
      drawLabels(pts, focus != null);
    }

    // Names go next to their points, biggest authorities first, wherever they cover neither
    // another name nor another point. Zooming in makes room for more.
    const measure = (() => {
      const ctx = document.createElement('canvas').getContext('2d'), cache = new Map();
      return str => {
        if (!cache.has(str)) {
          ctx.font = '500 11.5px Heebo, system-ui, "Segoe UI", Arial, sans-serif';
          cache.set(str, ctx.measureText(str).width);
        }
        return cache.get(str);
      };
    })();
    function drawLabels(pts, focused) {
      const s = mapState, boxes = [{ x0: 0, y0: 0, x1: 52, y1: 124 }]; // the zoom buttons
      // search matches and the anchor cities may cover other points, so they always get a name
      const firm = p => p && (p.hit || ANCHORS.has(p.a.id));
      const clear = (b, self) =>
        b.x0 > 2 && b.x1 < s.w - 2 && b.y0 > 2 && b.y1 < s.h - 2 &&
        !boxes.some(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) &&
        (firm(self) || !pts.some(p => p !== self && (p.on || p.hit) && p.x + p.r > b.x0 && p.x - p.r < b.x1 && p.y + p.r > b.y0 && p.y - p.r < b.y1));
      let out = '';
      const sx = SEA.xy[0] * s.k + s.tx, sy = SEA.xy[1] * s.k + s.ty, sw = measure(SEA.text) + 8;
      const seaBox = { x0: sx - sw / 2, x1: sx + sw / 2, y0: sy - 8, y1: sy + 8 };
      if (clear(seaBox, null)) {
        boxes.push(seaBox);
        out += `<text class="sea" x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" text-anchor="middle" dominant-baseline="central">${SEA.text}</text>`;
      }
      const pop = p => (POP >= 0 ? p.a.v[POP] || 0 : 0);
      const cand = pts.filter(p => p.on || firm(p))
        .sort((p, q) => (q.hit - p.hit) || (firm(q) - firm(p)) || pop(q) - pop(p));
      for (const p of cand) {
        const tw = measure(p.a.name);
        for (const west of [true, false]) {
          const x0 = west ? p.x - p.r - 3 - tw : p.x + p.r + 3;
          const b = { x0: x0 - 1, x1: x0 + tw + 1, y0: p.y - 7, y1: p.y + 7 };
          if (!clear(b, p)) continue;
          boxes.push(b);
          const cls = p.hit ? 'hit' : !p.on ? 'anchor' : focused ? 'on' : '';
          // rtl text: "start" is its right edge, "end" its left edge
          out += `<text class="${cls}" x="${(west ? x0 + tw : x0).toFixed(1)}" y="${p.y.toFixed(1)}"` +
            ` text-anchor="${west ? 'start' : 'end'}" dominant-baseline="central">${esc(p.a.name)}</text>`;
          break;
        }
      }
      $d('.map-labels').innerHTML = out;
    }

    function pointAt(px, py) {
      let best = null, bd = Infinity;
      for (const p of mapState.pts) {
        const d = Math.hypot(p.x - px, p.y - py);
        if (d <= p.r + 4 && d - (p.on ? 3 : 0) < bd) { bd = d - (p.on ? 3 : 0); best = p; }
      }
      return best;
    }

    function pointTip(a) {
      const leaf = mapState.leafOf.get(a.id);
      const regional = REGIONAL >= 0 && a.v[REGIONAL] === 1;
      return `<b>${esc(a.name)}</b>${regional ? ' <span class="t-dim">· מועצה אזורית</span>' : ''}<br>` +
        (leaf ? `קבוצה ${codeOf(leaf.path)}: ${esc(groupName(leaf))}` : '<span class="t-dim">לא שובצה: חסר נתון</span>') +
        lastTree.act.map(A => `<br><span class="t-dim">${esc(A.col.short)}:</span> ${esc(fmt(a.v[A.col.idx], A.col))}`).join('');
    }

    // The groups in tree order, a family under its parent's name; each row lights its points.
    function renderLegend(T) {
      const s = mapState, fams = families(T);
      const n = fams.reduce((t, f) => t + f.leaves.length, 0);
      let html = `<div class="lg-head"><b>קבוצות</b><span>${n}</span>` +
        `${s.pin != null ? '<button type="button" class="lg-clear">ניקוי הסימון</button>' : ''}</div>`;
      for (const f of fams) {
        const head = f.leaves.length > 1 && f.parent.parent;
        html += '<div class="lg-fam">';
        if (head) {
          html += `<button type="button" class="lg-fhead" data-key="${f.parent.key}">` +
            `<span class="g-code">${codeOf(f.parent.path)}</span><span class="lg-name">${esc(groupName(f.parent))}</span></button>`;
        }
        for (const l of f.leaves) {
          const steps = pathSteps(l), warn = l.count < state.min;
          html += `<button type="button" class="lg-row${warn ? ' warn' : ''}" data-key="${l.key}" title="${esc(groupName(l))}">` +
            `<i class="g-dot" style="${dotStyle(l.key)}"></i><span class="g-code">${codeOf(l.path)}</span>` +
            `<span class="lg-name">${esc(head ? stepName(steps[steps.length - 1]) : groupName(l))}</span>` +
            `<span class="lg-n">${warn ? '⚠ ' : ''}${l.count}</span></button>`;
        }
        html += '</div>';
      }
      const off = AUTH.filter(a => !a.loc);
      const blank = T.unassigned.some(u => u.a.loc);
      html += `<p class="lg-note">מועצה אזורית מוצגת במיקום הממוצע של יישוביה.` +
        `${blank ? ' עיגול ריק: רשות שלא שובצה.' : ''}${off.length ? ` לא במפה: ${off.map(a => esc(a.name)).join(', ')}.` : ''}</p>`;
      $d('.map-legend').innerHTML = html;
      syncLegend();
    }

    function syncLegend() {
      const s = mapState, focus = s.hover ?? s.pin, lg = $d('.map-legend');
      lg.classList.toggle('focus', focus != null);
      lg.querySelectorAll('[data-key]').forEach(el => {
        const k = el.dataset.key;
        el.classList.toggle('on', focus != null && (inKey(k, focus) || focus.startsWith(k + '.')));
        el.setAttribute('aria-pressed', String(k === s.pin));
      });
    }

    function setPin(key) {
      mapState.pin = key;
      if (lastTree) renderLegend(lastTree);
      requestDraw();
    }

    function renderMap(T) {
      const s = mapState;
      s.leafOf = new Map(); // the distribution's tips use it too
      for (const l of T.leaves) for (const a of l.members) s.leafOf.set(a.id, l);
      if (s.pin != null && !T.byKey.get(s.pin)?.count) s.pin = null; // that branch is gone
      if (!HAS_MAP || s.mode !== 'map') return;
      renderLegend(T);
      drawMap();
    }

    function setView(mode, remember = true) {
      if (!viewOk(mode)) mode = 'tree';
      mapState.mode = mode;
      $d('.tree-view').hidden = mode !== 'tree';
      $d('.map-view').hidden = mode !== 'map';
      $d('.dist-view').hidden = mode !== 'dist';
      $d('.tree-panel').classList.toggle('map-mode', mode === 'map');
      root.querySelectorAll('.view-switch [data-view]').forEach(b => {
        b.classList.toggle('on', b.dataset.view === mode);
        b.setAttribute('aria-selected', String(b.dataset.view === mode));
      });
      if (remember) try { localStorage.setItem(VIEW_KEY, mode); } catch (e) { /* storage blocked */ }
      hideTip();
      if (!lastTree) return;
      if (mode === 'map') { renderLegend(lastTree); drawMap(); } else scheduleUpdate();
    }

    function wireMap() {
      const svg = $d('.map'), s = mapState, ptrs = new Map();
      let gesture = null;
      const local = e => { const r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      const restart = moved => ({ k: s.k, tx: s.tx, ty: s.ty, start: [...ptrs.values()].map(p => [...p]), moved });

      svg.addEventListener('pointerdown', e => {
        if (e.button) return;
        svg.setPointerCapture(e.pointerId);
        ptrs.set(e.pointerId, local(e));
        gesture = restart(ptrs.size > 1);
        hideTip();
      });
      svg.addEventListener('pointermove', e => {
        const p = local(e);
        if (!ptrs.has(e.pointerId)) { // hover
          const hit = pointAt(p[0], p[1]), id = hit ? hit.a.id : null;
          if (id !== s.hoverId) { s.hoverId = id; requestDraw(); }
          if (hit) showTip(pointTip(hit.a), e.clientX, e.clientY); else hideTip();
          return;
        }
        ptrs.set(e.pointerId, p);
        const now = [...ptrs.values()], g = gesture;
        if (now.length === 1) {
          const dx = p[0] - g.start[0][0], dy = p[1] - g.start[0][1];
          if (!g.moved && Math.hypot(dx, dy) < 4) return;
          g.moved = true;
          svg.classList.add('dragging');
          s.tx = g.tx + dx;
          s.ty = g.ty + dy;
        } else {
          // pinch: the point under the fingers' midpoint follows it
          const [a0, b0] = g.start, [a1, b1] = now;
          const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) || 1, d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
          const k = clamp((g.k * d1) / d0, s.fitK * ZOOM_MIN, s.fitK * ZOOM_MAX);
          const wx = ((a0[0] + b0[0]) / 2 - g.tx) / g.k, wy = ((a0[1] + b0[1]) / 2 - g.ty) / g.k;
          s.k = k;
          s.tx = (a1[0] + b1[0]) / 2 - wx * k;
          s.ty = (a1[1] + b1[1]) / 2 - wy * k;
          g.moved = true;
        }
        s.moved = true;
        clampView();
        requestDraw();
      });
      const end = e => {
        if (!ptrs.has(e.pointerId)) return;
        const p = ptrs.get(e.pointerId);
        ptrs.delete(e.pointerId);
        if (ptrs.size) { gesture = restart(true); return; }
        svg.classList.remove('dragging');
        if (e.type === 'pointerup' && gesture && !gesture.moved) {
          // a click on a point lights its group; a click elsewhere clears it
          const hit = pointAt(p[0], p[1]), leaf = hit && s.leafOf.get(hit.a.id);
          setPin(leaf ? (s.pin === leaf.key ? null : leaf.key) : null);
          if (hit && e.pointerType !== 'mouse') showTip(pointTip(hit.a), e.clientX, e.clientY);
        }
        gesture = null;
      };
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', end);
      svg.addEventListener('pointerleave', e => {
        if (e.pointerType === 'mouse' && s.hoverId != null) { s.hoverId = null; requestDraw(); }
        if (e.pointerType === 'mouse') hideTip();
      });
      svg.addEventListener('wheel', e => {
        e.preventDefault();
        const [x, y] = local(e);
        zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002)), x, y);
      }, { passive: false });
      svg.addEventListener('dblclick', e => { const [x, y] = local(e); zoomAt(2, x, y); });
      svg.addEventListener('keydown', e => {
        const pan = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] }[e.key];
        if (pan) { s.tx += pan[0]; s.ty += pan[1]; s.moved = true; clampView(); requestDraw(); }
        else if (e.key === '+' || e.key === '=') zoomAt(1.6, s.w / 2, s.h / 2);
        else if (e.key === '-') zoomAt(1 / 1.6, s.w / 2, s.h / 2);
        else if (e.key === '0') $d('[data-zoom="fit"]').click();
        else if (e.key === 'Escape') setPin(null);
        else return;
        e.preventDefault();
      });

      $d('[data-zoom="in"]').addEventListener('click', () => zoomAt(1.6, s.w / 2, s.h / 2));
      $d('[data-zoom="out"]').addEventListener('click', () => zoomAt(1 / 1.6, s.w / 2, s.h / 2));
      $d('[data-zoom="fit"]').addEventListener('click', () => { fitView(LOCATED); s.moved = false; requestDraw(); });

      const lg = $d('.map-legend');
      lg.addEventListener('pointerover', e => {
        const el = e.target.closest('[data-key]'), k = el ? el.dataset.key : null;
        if (k !== s.hover) { s.hover = k; syncLegend(); requestDraw(); }
      });
      lg.addEventListener('pointerleave', () => { s.hover = null; syncLegend(); requestDraw(); });
      lg.addEventListener('click', e => {
        if (e.target.closest('.lg-clear')) { setPin(null); return; }
        const el = e.target.closest('[data-key]');
        if (el) setPin(s.pin === el.dataset.key ? null : el.dataset.key);
      });

      watch(new ResizeObserver(() => requestDraw()), $d('.map-box'));
    }

    // ---------- search ----------
    // The page's search (searchIds) lit in this division's views.
    function applySearch() {
      const ids = searchIds;
      root.querySelectorAll('.m').forEach(el => el.classList.toggle('hit', ids.has(Number(el.dataset.id))));
      stageUI.forEach(ui => ui.rows.forEach(r => r.dotEls.forEach(d => {
        const hit = ids.has(d.id);
        d.el.classList.toggle('hit', hit);
        if (hit) d.el.parentNode.appendChild(d.el); // draw on top
      })));
      root.querySelectorAll('.dist-view circle[data-ai]').forEach(c => {
        const hit = ids.has(AUTH[Number(c.dataset.ai)].id);
        c.classList.toggle('hit', hit);
        if (hit) c.parentNode.insertBefore(c, c.parentNode.querySelector('.dr-mu')); // on top of the dots
      });
      const hitKeys = new Set();
      if (lastTree) {
        for (const l of lastTree.leaves) {
          if (!l.members.some(a => ids.has(a.id))) continue;
          for (let nd = l; nd && nd.key !== ''; nd = nd.parent) hitKeys.add(nd.key);
        }
      }
      root.querySelectorAll('.tree-view .tn').forEach(el => el.classList.toggle('has-hit', hitKeys.has(el.dataset.key)));
      mapState.hits = ids;
      if (mapState.mode === 'map') requestDraw();
    }

    // ---------- update loop ----------
    let rafId = 0;
    function scheduleUpdate() {
      if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; updateAll(); });
    }
    function updateAll() {
      lastTree = computeTree(state);
      const gains = lastGains = stageGains(lastTree);
      colorOf = groupColors(lastTree);
      renderStages(lastTree, gains);
      renderTree(lastTree, gains);
      renderUnassigned(lastTree);
      renderSummary(lastTree, gains);
      syncRecButton(lastTree);
      scheduleAll();
      renderMap(lastTree);
      renderDist(lastTree, gains);
      renderHead();
      applySearch();
      pageChanged();
    }
    // A split into this division; with a source, the division is that split from here on.
    function loadState(st, source) {
      state = st;
      if (source) src = { ...source, canon: canonical(st, computeTree(st)) };
      stageUI.forEach(ui => { ui.rows.forEach(r => r.el.remove()); ui.rows.clear(); ui.scaleSig = ''; });
      if (openStage != null && !stageOf(state, openStage)) openStage = null;
      $d('.min-size').value = state.min;
      updateAll();
    }

    const copyConfig = () => copyText(JSON.stringify(exportConfig(state, lastTree), null, 2), 'ההגדרות הועתקו');

    function groupTable() {
      const T = lastTree, cols = T.act.map(A => A.col);
      // categories without an order go out by name; other values as they are
      const cell = (a, c) => (c.kind === 'category' && a.v[c.idx] != null ? fmt(a.v[c.idx], c) : a.v[c.idx]);
      const lines = [['קבוצה', 'שם הקבוצה', 'מסלול בעץ', 'גודל הקבוצה', 'מתחת למינימום', 'סמל רשות', 'שם רשות', ...cols.map(c => c.label)]];
      for (const l of T.leaves) {
        if (!l.count) continue;
        const name = groupName(l);
        const pathTxt = pathSteps(l).map(st => `${st.col.short}: ${st.label}`).join(' > ');
        for (const a of [...l.members].sort((x, y) => collator.compare(x.name, y.name))) {
          lines.push([codeOf(l.path), name, pathTxt, l.count, l.count < state.min ? 'כן' : 'לא', a.id, a.name, ...cols.map(c => cell(a, c))]);
        }
      }
      for (const u of T.unassigned) {
        lines.push(['לא שובץ', '', `חסר: ${u.col.short}`, '', '', u.a.id, u.a.name, ...cols.map(c => cell(u.a, c))]);
      }
      return lines;
    }

    // The shared page cannot download files, so there it copies the table for pasting into Excel.
    function exportTable() {
      const lines = groupTable();
      if (IN_ARTIFACT) {
        const cell = v => String(v ?? '').replace(/[\t\n]/g, ' ');
        copyText(lines.map(r => r.map(cell).join('\t')).join('\n'), 'הטבלה הועתקה. אפשר להדביק ב-Excel');
        return;
      }
      const q = v => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      downloadText('﻿' + lines.map(r => r.map(q).join(',')).join('\r\n'), 'קבוצות_דומים.csv', 'text/csv;charset=utf-8');
    }

    // ---------- the distribution of the target measurement ----------
    // One row per group, every row on the same scale: the group's authorities as dots in its
    // color on the map, its mean as a line, and the mean ± one standard deviation as a band. On
    // top, the row of all the authorities is the yardstick; the dashed line through every row is
    // their mean. The rows sort by the tree's order, by mean or by variance.
    const distSort = { by: 'tree', dir: -1 }; // dir -1: the largest first

    // The mean and the (sample) standard deviation of the values ys.
    function moments(ys) {
      const n = ys.length;
      if (!n) return { n, mean: null, sd: null };
      const mean = ys.reduce((s, y) => s + y, 0) / n;
      const sd = n > 1 ? Math.sqrt(ys.reduce((s, y) => s + (y - mean) ** 2, 0) / (n - 1)) : null;
      return { n, mean, sd };
    }
    // A mean or a standard deviation on the target's scale, for the table.
    function yText(y) {
      if (y == null) return '—';
      const { col, type } = TARGET;
      if (type === 'quantile') return nf(0).format(Math.round(y));
      if (col.kind === 'binary') return num(y * 100) + '%';
      return col.discrete ? num(y) : fmt(y, col);
    }
    // A standard deviation as a plain number on the values' own units — never as a percent,
    // even when the target is a share (0.12, not 12%).
    function sdText(sd) {
      if (sd == null) return '—';
      return TARGET.type === 'quantile' ? nf(0).format(Math.round(sd)) : num(sd);
    }
    // Round values for an axis from lo to hi, about n of them.
    function niceTicks(lo, hi, n) {
      if (!(hi > lo)) return [lo];
      const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw));
      const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw);
      const out = [];
      for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
      return out;
    }
    function distTicks(w) {
      const { col, type, scale } = TARGET;
      if (col.discrete) {
        return col.cats.map((c, k) => ({ x: xOf((k + 0.5) / col.cats.length, w), t: col.categories[String(c)] ?? String(c) }));
      }
      if (type === 'quantile') return [0, 0.25, 0.5, 0.75, 1].map(p => ({ x: xOf(p, w), t: fmt(scale.fromP(p), col) }));
      return niceTicks(col.min, col.max, clamp(Math.floor(w / 90), 2, 8)).map(v => ({ x: xOf(scale.toP(v), w), t: fmt(v, col) }));
    }

    function renderDist(T, gains) {
      const host = $d('.dist-view');
      if (mapState.mode !== 'dist') return;
      if (!TARGET) {
        host.innerHTML = '<p class="empty-state">בחרו מדד מטרה בסרגל העליון כדי לראות איך הוא מתפזר בכל קבוצה</p>';
        return;
      }
      const { col, x } = TARGET, pct = TARGET.type === 'quantile', sel = mapState.pin;
      const yOf = a => x.get(a.id)[0];
      const groups = T.leaves.filter(l => l.count).map((l, order) => {
        const members = l.members.filter(a => x.has(a.id));
        return { l, order, members, ...moments(members.map(yOf)) };
      });
      const everyone = groups.flatMap(g => g.members);
      const all = { l: null, members: everyone, ...moments(everyone.map(yOf)) };
      const missing = groups.reduce((s, g) => s + g.l.count - g.n, 0);
      const by = { mean: g => g.mean, var: g => g.sd }[distSort.by];
      const rows = !by ? groups : [...groups].sort((a, b) => {
        const va = by(a), vb = by(b);
        if (va == null || vb == null) return (va == null) - (vb == null) || a.order - b.order;
        return (distSort.dir < 0 ? vb - va : va - vb) || a.order - b.order;
      });
      const fit = gains.reduce((s, g) => s + (g || 0), 0);
      const sortBtn = (key, label) => `<button type="button" data-sort="${key}">${label}` +
        (key !== 'tree' && distSort.by === key ? (distSort.dir < 0 ? ' ↓' : ' ↑') : '') + '</button>';
      const row = (g, cls, lab) => `<div class="dr${cls}"${g.l ? ` data-key="${g.l.key}"` : ''}>${lab}` +
        `<svg class="dr-strip" aria-hidden="true"></svg><span class="dr-v">${yText(g.mean)}</span><span class="dr-v">${sdText(g.sd)}</span></div>`;
      const groupLab = g => {
        const l = g.l, name = groupName(l);
        return `<button type="button" class="dr-lab" aria-pressed="${l.key === sel}" title="${esc(name)}">` +
          `<i class="g-dot" style="${dotStyle(l.key)}"></i><span class="g-code">${codeOf(l.path)}</span>` +
          `<span class="dr-name">${esc(name)}</span>` +
          `<span class="dr-n">${l.count < state.min ? '⚠ ' : ''}${g.n < l.count ? `${g.n}/${l.count}` : l.count}</span></button>`;
      };
      host.innerHTML =
        `<div class="dist-head"><p class="dist-title"><span class="t-dim">מדד המטרה:</span> <b>${esc(col.label)}</b>` +
        (TARGET.type === 'band' ? '' : ` <span class="t-dim">· סקאלת ${SCALE_NAMES[TARGET.type]}</span>`) + '</p>' +
        `<p class="dist-sum">ציון <b class="v">${scoreText(fit)}<span class="of">/10</span></b> · השונות בתוך הקבוצות: ` +
        `<b>${Math.round(100 * (1 - fit))}%</b> מהשונות של כל הרשויות</p>` +
        `<div class="viewseg dist-sort" role="group" aria-label="מיון הקבוצות">` +
        `${sortBtn('tree', 'סדר העץ')}${sortBtn('mean', 'ממוצע')}${sortBtn('var', 'שונות')}</div></div>` +
        targetIssues(T).map(i => `<p class="dist-warn"><span class="ico">⚠</span>${esc(issueText(i))}</p>`).join('') +
        '<div class="dist-rows">' +
        `<div class="dr dr-cols"><span>קבוצה</span><span></span><span>${pct ? 'ממוצע (אחוזון)' : 'ממוצע'}</span><span>סטיית תקן</span></div>` +
        row(all, ' dr-all', `<span class="dr-lab"><span class="dr-name">כל הרשויות</span><span class="dr-n">${all.n}</span></span>`) +
        rows.map(g => row(g, (g.l.count < state.min ? ' warn' : '') + (g.l.key === sel ? ' sel' : ''), groupLab(g))).join('') +
        '<div class="dr dr-axis" aria-hidden="true"><span></span><div class="dr-ticks"></div><span></span><span></span></div></div>' +
        '<p class="dist-note">קו מלא: ממוצע הקבוצה, והרצועה סביבו: סטיית תקן אחת לכל צד. קו מקווקו: הממוצע של כל הרשויות.' +
        (missing ? ` ${missing} רשויות בלי נתון ב${esc(col.short)} לא נכללות בציון ובגרף.` : '') + '</p>';
      const strips = host.querySelectorAll('.dr-strip'), w = strips[0].clientWidth;
      if (!w) return;
      const avg = all.mean == null ? null : xOf(TARGET.pos(all.mean), w);
      [all, ...rows].forEach((g, k) => drawStrip(strips[k], g, w, k ? 30 : 44, avg));
      $d('.dr-ticks').innerHTML = distTicks(w)
        .map(t => `<span class="dr-tick" style="left:${t.x.toFixed(1)}px">${esc(t.t)}</span>`).join('');
    }

    // One row's chart: the band, the yardstick's mean, the dots and the group's mean, in that order.
    function drawStrip(svg, g, w, H, avg) {
      const col = TARGET.col, c = g.l ? colorOf.get(g.l.key) : null, f = v => v.toFixed(1);
      const items = dotItems(g.members, col, TARGET.scale, w);
      const rad = placeDots(items, col, w, H);
      const hit = it => mapState.hits.has(AUTH[it.ai].id);
      let s = '';
      if (g.sd != null) {
        const xa = xOf(TARGET.pos(g.mean - g.sd), w), xb = xOf(TARGET.pos(g.mean + g.sd), w);
        s += `<rect class="dr-band" x="${f(Math.min(xa, xb))}" y="0" width="${f(Math.abs(xa - xb))}" height="${H}"${c ? ` fill="${c.fill}"` : ''}></rect>`;
      }
      if (avg != null) s += `<line class="dr-avg" x1="${f(avg)}" x2="${f(avg)}" y1="0" y2="${H}"></line>`;
      items.sort((a, b) => hit(a) - hit(b)); // search matches on top
      s += items.map(it => {
        const cls = [c ? '' : 'all', hit(it) ? 'hit' : ''].filter(Boolean).join(' ');
        return `<circle cx="${f(it.cx)}" cy="${f(it.cy)}" r="${rad.toFixed(2)}" data-ai="${it.ai}"` +
          `${c ? ` fill="${c.fill}" stroke="${c.stroke}"` : ''}${cls ? ` class="${cls}"` : ''}></circle>`;
      }).join('');
      if (g.mean != null) {
        const m = f(xOf(TARGET.pos(g.mean), w));
        s += `<line class="dr-mu" x1="${m}" x2="${m}" y1="1" y2="${H - 1}"></line>`;
      }
      svg.setAttribute('viewBox', `0 0 ${w} ${H}`);
      svg.style.height = H + 'px';
      svg.innerHTML = s;
    }

    function wireDist() {
      const host = $d('.dist-view');
      host.addEventListener('click', e => {
        const b = e.target.closest('button[data-sort]');
        if (b) {
          const by = b.dataset.sort;
          if (distSort.by === by) distSort.dir = -distSort.dir;
          else Object.assign(distSort, { by, dir: -1 });
          renderDist(lastTree, lastGains);
          $d(`.dist-sort [data-sort="${by}"]`)?.focus();
          return;
        }
        const row = e.target.closest('.dr[data-key]');
        if (!row || !e.target.closest('.dr-lab')) return;
        const key = row.dataset.key;
        selectGroup(mapState.pin === key ? null : key);
        $d(`.dr[data-key="${key}"] .dr-lab`)?.focus();
      });
      host.addEventListener('pointermove', e => {
        const c = e.target.closest('circle[data-ai]');
        if (!c) { hideTip(); return; }
        const a = AUTH[Number(c.dataset.ai)], col = TARGET.col, leaf = mapState.leafOf.get(a.id);
        showTip(`<b>${esc(a.name)}</b><br><span class="t-dim">${esc(col.short)}:</span> ${esc(fmt(a.v[col.idx], col))}` +
          (TARGET.type === 'quantile' ? ` <span class="t-dim">· אחוזון ${Math.round(TARGET.x.get(a.id)[0])}</span>` : '') +
          (leaf ? `<br><span class="t-dim">קבוצה ${codeOf(leaf.path)}:</span> ${esc(groupName(leaf))}` : ''), e.clientX, e.clientY);
      });
      host.addEventListener('pointerleave', hideTip);
    }

    // ---------- the division's header ----------
    const SOURCE_NAMES = { rec: 'החלוקה המומלצת', import: 'הגדרות שיובאו', link: 'חלוקה מקישור', new: 'חלוקה חדשה' };
    const nameOf = () => (src.kind === 'saved' ? src.name : SOURCE_NAMES[src.kind]);
    const isModified = () => src.kind !== 'new' && (src.mod || canonical(state, lastTree) !== src.canon);
    function renderHead() {
      const name = $d('.div-name');
      $d('.div-num').innerHTML = `<span class="sr-only">חלוקה </span>${place}`;
      name.textContent = nameOf();
      name.title = src.kind === 'rec' ? REC.label || '' : '';
      $d('.div-mod').hidden = !isModified();
      $d('.div-x').hidden = divisions.length < 2;
    }

    // The division as the saved list keeps it: its settings, and its columns' names as they are
    // today, so it can still be found by them after a column leaves the data.
    function entry(name) {
      const config = exportConfig(state, lastTree), columns = config.levels.map(l => l.column);
      return { name, columns, labels: Object.fromEntries(columns.map(k => [k, COL[k].label])), config };
    }

    // ---------- views ----------
    const viewOk = m => m === 'tree' || (m === 'map' && HAS_MAP) || (m === 'dist' && scoring.mode === 'target');
    function syncViewTabs() {
      $d('[data-view="map"]').hidden = !HAS_MAP;
      $d('[data-view="dist"]').hidden = scoring.mode !== 'target';
      $d('.view-switch').hidden = !HAS_MAP && scoring.mode !== 'target';
    }
    // The page's score changed: the searches start over, and the distribution comes or goes.
    function rescore() {
      optSig = allSig = '';
      syncViewTabs();
      if (!viewOk(mapState.mode)) setView('tree', false);
      updateAll();
    }

    // A group lit in every view, and shown under the tree.
    function selectGroup(key) {
      mapState.pin = key;
      updateAll();
      const card = key != null && mapState.mode === 'tree' && $d('.gcard');
      if (card) card.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }

    // Enter in the search: the map zooms to the matches; the tree and the distribution open the
    // first group with a match. Returns what to flash, if anything.
    function searchEnter() {
      const ids = mapState.hits;
      if (mapState.mode === 'map') {
        const hits = LOCATED.filter(a => ids.has(a.id));
        if (hits.length) { fitView(hits, mapState.fitK * 6); mapState.moved = true; clampView(); requestDraw(); }
        return null;
      }
      const l = lastTree.leaves.find(g => g.count && g.members.some(a => ids.has(a.id)));
      if (!l) return null;
      selectGroup(l.key);
      return mapState.mode === 'tree' ? $d('.gcard') : $d(`.dr[data-key="${l.key}"]`);
    }

    // ---------- the division's controls ----------
    function wire() {
      $d('.btn-opt-all').addEventListener('click', optimizeAll);
      $d('.ow-fix').addEventListener('click', e => {
        const v = Number(e.currentTarget.dataset.min);
        if (!(v >= 1)) return;
        state.min = v;
        $d('.min-size').value = v;
        updateAll();
      });
      $d('.min-size').addEventListener('input', e => {
        const v = Math.round(Number(e.target.value));
        if (v >= 1) { state.min = v; updateAll(); }
      });
      $d('.btn-rec').addEventListener('click', () => loadInto(api, stateFromConfig(REC), { kind: 'rec' }, 'נטענה החלוקה המומלצת'));

      const menuBtn = $d('.menu-btn'), menu = $d('.menu-pop');
      menuBtn.addEventListener('click', () => {
        const open = menu.hidden;
        closeMenus(null);
        menu.hidden = !open;
        menuBtn.setAttribute('aria-expanded', String(open));
      });
      if (IN_ARTIFACT) { // the shared page cannot download files
        $d('[data-act="csv"]').textContent = 'העתקת הטבלה ל-Excel';
        $d('[data-act="file"]').hidden = true;
      }
      $d('.div-head').addEventListener('click', e => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        if (b.closest('.menu-pop')) closeMenus(null);
        const act = b.dataset.act;
        if (act === 'load') openList(api);
        else if (act === 'save') openSave(api);
        else if (act === 'remove') removeDivision(api);
        else if (act === 'copy') copyConfig();
        else if (act === 'import') openImport(api);
        else if (act === 'file') downloadText(JSON.stringify(exportConfig(state, lastTree), null, 2) + '\n', 'הגדרות_חלוקה.json', 'application/json');
        else if (act === 'csv') exportTable();
      });

      // "?" buttons and warnings explain a figure on hover, focus or tap
      const stats = $d('.stats');
      const helpTip = e => {
        const b = e.target.closest('[data-help]');
        if (!b) return;
        const r = b.getBoundingClientRect();
        showTip(esc(b.dataset.help), r.left, r.bottom);
      };
      ['pointerover', 'focusin', 'click'].forEach(t => stats.addEventListener(t, helpTip));
      stats.addEventListener('pointerout', e => { if (e.target.closest('[data-help]')) hideTip(); });
      stats.addEventListener('focusout', hideTip);

      $d('.view-switch').addEventListener('click', e => {
        const b = e.target.closest('button[data-view]');
        if (b) setView(b.dataset.view);
      });

      // tree: hover lights a branch; a branch opens the slider that splits it, a leaf shows its group
      const tree = $d('.tree-view');
      tree.addEventListener('pointerover', e => {
        const el = e.target.closest('.tn');
        focusTree(el ? el.dataset.key : null);
      });
      tree.addEventListener('pointerleave', () => { focusTree(null); hideTip(); });
      // branches slide with a sideways scroll, so their links follow
      let linksRaf = 0;
      tree.addEventListener('scroll', () => {
        if (!linksRaf) linksRaf = requestAnimationFrame(() => { linksRaf = 0; drawLinks(); });
      }, { capture: true, passive: true });
      tree.addEventListener('pointermove', e => {
        const m = e.target.closest('.m');
        if (m && lastTree) {
          const a = AUTH_BY_ID.get(Number(m.dataset.id));
          const lines = lastTree.act.map(A => `<span class="t-dim">${esc(A.col.short)}:</span> ${esc(fmt(a.v[A.col.idx], A.col))}`);
          showTip(`<b>${esc(a.name)}</b>${lines.length ? '<br>' + lines.join('<br>') : ''}`, e.clientX, e.clientY);
          return;
        }
        const el = e.target.closest('.tn');
        const nd = el && lastTree && lastTree.byKey.get(el.dataset.key);
        if (!nd) { hideTip(); return; }
        const head = !nd.parent ? 'כל הרשויות' : nd.children ? `ענף ${codeOf(nd.path)}` : `קבוצה ${codeOf(nd.path)}: ${esc(groupName(nd))}`;
        const hint = nd.children ? 'לחיצה פותחת את הסף שמפצל אותו' : 'לחיצה מציגה את הרשויות בקבוצה';
        showTip(`<b>${head}</b> · ${nd.count} רשויות` +
          pathSteps(nd).map(st => `<br><span class="t-dim">${esc(st.col.short)}:</span> ${esc(st.label)}`).join('') +
          `<br><span class="t-dim">${hint}</span>`, e.clientX, e.clientY);
      });
      tree.addEventListener('click', e => {
        const act = e.target.closest('[data-act]');
        if (act) {
          if (act.dataset.act === 'map') setView('map');
          else selectGroup(null);
          return;
        }
        const label = e.target.closest('.vt-label');
        if (label) {
          const i = label.dataset.stage;
          if (openStage !== i) openOnly(i);
          flash(stageUI.get(i).el);
          return;
        }
        const el = e.target.closest('.tn');
        const nd = el && lastTree && lastTree.byKey.get(el.dataset.key);
        if (!nd) return;
        if (!nd.children) { selectGroup(mapState.pin === nd.key ? null : nd.key); return; }
        const i = nd.stage.slot;
        if (openStage !== i) openOnly(i);
        const ui = stageUI.get(i);
        const row = ui.rows.get(nd.key) || ui.rows.get('*');
        flash(row ? row.el : ui.el);
      });
      wireDist();

      // relayout on size changes: the stage column (its sliders), and the panel's width (the
      // tree and the distribution; the panel's height changes on every render)
      let resizeRaf = 0;
      watch(new ResizeObserver(() => {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => updateAll());
      }), $d('.params'));
      let panelW = 0;
      watch(new ResizeObserver(entries => {
        const w = Math.round(entries[0].contentRect.width);
        if (w !== panelW) { panelW = w; scheduleUpdate(); }
      }), $d('.tree-panel'));
    }

    // ---------- init, and what the page uses ----------
    buildStages();
    if (HAS_MAP) {
      $d('.map-base').innerHTML = BASE_HTML;
      wireMap();
    }
    wire();
    syncViewTabs();
    const api = {
      root,
      get state() { return state; },
      tree: () => lastTree,
      place: () => place,
      total: () => lastGains.reduce((s, g) => s + (g || 0), 0),
      under: () => (lastTree ? underCount(lastTree, state.min) : 0),
      label: () => nameOf() + (isModified() ? ' · שונתה' : ''),
      source: () => ({ kind: src.kind, name: src.name, mod: isModified() }),
      view: () => mapState.mode,
      setPlace(n) { place = n; renderHead(); },
      loadState, rescore, applySearch, searchEnter, entry,
      // saved under `name` just now: the division is that saved division from here on
      saved(name) {
        src = { kind: 'saved', name, canon: canonical(state, lastTree) };
        renderHead();
        pageChanged();
      },
      hashEntry: () => ({ kind: src.kind, name: src.name, mod: isModified() || undefined, config: exportConfig(state, lastTree) }),
      redraw() { drawLinks(); requestDraw(); },
      destroy() {
        observers.forEach(ro => ro.disconnect());
        clearTimeout(optTimer);
        clearTimeout(allTimer);
        hideTip();
        root.remove();
      },
    };
    loadState(st, source);
    setView(view, false);
    return api;
  }

  // ---------- floating bits ----------
  const tip = $('#tip');
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 12;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { tip.hidden = true; }

  let toastTimer = 0;
  function toast(msg, action) {
    const t = $('#toast');
    t.textContent = msg;
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = action.label;
      b.addEventListener('click', () => { t.hidden = true; action.run(); });
      t.appendChild(b);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    // long notes stay longer, and a note with a button stays long enough to press it
    toastTimer = setTimeout(() => { t.hidden = true; }, Math.max(action ? 8000 : 2600, msg.length * 55));
  }

  function flash(el) {
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  // ---------- actions ----------
  // Call inside the click handler. Falls back to a hidden textarea where the async
  // clipboard API is missing or refused.
  function copyText(txt, done) {
    const legacy = () => {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* unsupported */ }
      ta.remove();
      toast(ok ? done : 'הדפדפן חסם את ההעתקה');
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(() => toast(done), legacy);
    else legacy();
  }

  // Settings as "העתקת הגדרות" copies them (JSON). recommended_split.js loads too: it is a JS
  // object, so its `window.X =` prefix, comments, unquoted keys and trailing commas are tidied first.
  function parseConfigText(txt) {
    const t = txt.replace(/^\uFEFF/, '').trim();
    if (!t) return { error: 'אין מה לטעון: הדביקו הגדרות או בחרו קובץ.' };
    let cfg = null;
    try { cfg = JSON.parse(t); } catch (e) {
      const code = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // comments first: they may hold braces
      const a = code.indexOf('{'), b = code.lastIndexOf('}');
      if (a >= 0 && b > a) {
        const js = code.slice(a, b + 1)
          .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
          .replace(/,\s*([}\]])/g, '$1');
        try { cfg = JSON.parse(js); } catch (e2) { /* not a settings object */ }
      }
    }
    return readConfig(cfg);
  }

  // Settings already read: checked against the data, and the state they make.
  function readConfig(cfg) {
    if (!cfg || typeof cfg !== 'object' || !Array.isArray(cfg.levels)) {
      return { error: 'לא זוהו הגדרות חלוקה. צריך אובייקט עם רשימת levels, כמו זה שמעתיקה "העתקת הגדרות".' };
    }
    const known = cfg.levels.filter(l => l && COL[l.column]);
    const unknown = cfg.levels.filter(l => !l || !COL[l.column]).map(l => (l && l.column) || '?');
    if (!known.length) {
      return { error: unknown.length ? `העמודות האלה לא קיימות בנתונים: ${unknown.join(', ')}` : 'ברשימת levels אין שלבים.' };
    }
    const numbers = ts => ts == null || (Array.isArray(ts) && ts.every(Number.isFinite));
    const groupLists = g => g == null || (Array.isArray(g) && g.every(x => Array.isArray(x) && x.every(y => typeof y === 'string' || Number.isFinite(y))));
    const bad = known.find(l => (isCatCol(COL[l.column])
      ? !groupLists(l.groups) || !numbers(l.thresholds) || Object.values(l.branches || {}).some(v => !groupLists(v) && !numbers(v))
      : !numbers(l.thresholds) || Object.values(l.branches || {}).some(ts => !numbers(ts))));
    if (bad) {
      return { error: isCatCol(COL[bad.column]) ? `הקבוצות בשלב "${COL[bad.column].short}" אינן רשימות של קטגוריות.`
        : `הספים בשלב "${COL[bad.column].short}" אינם רשימת מספרים.` };
    }
    const st = stateFromConfig(cfg);
    const skipped = known.length - st.stages.filter(S => S.col).length;
    const notes = [];
    if (unknown.length) notes.push(`דולגו עמודות שלא קיימות בנתונים: ${unknown.join(', ')}`);
    if (skipped) notes.push(`${skipped === 1 ? 'שלב אחד דולג' : `${skipped} שלבים דולגו`}: יש מקום לשלב אחד לכל מאפיין ולפרמטר נוסף אחד`);
    return { st, notes };
  }

  // Local page only: the shared page cannot download files.
  function downloadText(txt, name, type) {
    const url = URL.createObjectURL(new Blob([txt], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // The import dialog loads into the division it was opened from.
  let importInto = null;
  function openImport(dv) {
    importInto = dv;
    $('#import-title').textContent = `ייבוא הגדרות לחלוקה ${dv.place()}`;
    $('#import-error').hidden = true;
    $('#import-dlg').showModal();
    $('#import-text').focus();
  }
  function wireImport() {
    const dlg = $('#import-dlg'), text = $('#import-text'), err = $('#import-error'), file = $('#import-file');
    const fail = msg => { err.textContent = msg; err.hidden = false; };
    const load = txt => {
      const r = parseConfigText(txt);
      if (r.error) { fail(r.error); return; }
      dlg.close();
      loadInto(importInto, r.st, { kind: 'import' }, ['ההגדרות נטענו', ...r.notes].join('. '));
    };
    const readFile = f => {
      if (!f) return;
      f.text().then(txt => { text.value = txt; load(txt); }, () => fail('לא הצלחנו לקרוא את הקובץ.'));
    };
    $('#import-form').addEventListener('submit', e => { e.preventDefault(); load(text.value); });
    $('#import-cancel').addEventListener('click', () => dlg.close());
    $('#import-x').addEventListener('click', () => dlg.close());
    $('#import-pick').addEventListener('click', () => file.click());
    file.addEventListener('change', () => { readFile(file.files[0]); file.value = ''; });
    text.addEventListener('input', () => { err.hidden = true; });
    dlg.addEventListener('dragover', e => { e.preventDefault(); dlg.classList.add('drop'); });
    dlg.addEventListener('dragleave', e => { if (!dlg.contains(e.relatedTarget)) dlg.classList.remove('drop'); });
    dlg.addEventListener('drop', e => { e.preventDefault(); dlg.classList.remove('drop'); readFile(e.dataTransfer.files[0]); });
  }

  // ---------- saved divisions ----------
  // One shared list of named divisions. Anyone can search it and load from it; saving and
  // deleting need the management login.

  // The management page's login, kept for the browser tab: a login on either page counts on both.
  const LOGIN_KEY = 'kyd_molsa_admin_v1';
  function login() {
    try {
      const a = JSON.parse(sessionStorage.getItem(LOGIN_KEY));
      return a && a.pass ? { who: a.who || '', pass: a.pass } : null;
    } catch (e) { return null; }
  }

  // A division's name is its key in the shared list, a row in the sheet. mDivNameProblem in
  // tools/apps-script/Manage.gs checks the same rules again on save.
  const NAME_MAX = 100;
  function nameProblem(name) {
    if (!name) return 'צריך לתת לחלוקה שם.';
    if (/[\r\n]/.test(name)) return 'השם לא יכול לכלול מעבר שורה.';
    if (name.startsWith('=')) return 'השם לא יכול להתחיל בסימן =.'; // the sheet would read it as a formula
    if (name.length > NAME_MAX) return `השם ארוך מדי: עד ${NAME_MAX} תווים.`;
    return '';
  }

  // The only part that talks to storage: the «חלוקות שמורות» tab of the management sheet,
  // through the management page's Apps Script (tools/apps-script/Manage.gs). list(): every
  // division without its settings; get(name): one whole division; save(entry, overwrite, cred)
  // and remove(name, cred) change the list. The server checks the password on every save and
  // delete. A failure carries a code: 'exists' (the name is taken and overwrite is not set),
  // 'missing', 'name', or 'login' (the password was refused).
  const store = (() => {
    const call = body => {
      const c = window.KYD?.collect;
      if (!c?.enabled()) return Promise.reject(new Error('לא מוגדרת כתובת השרת (COLLECT_URL ב-assets/collect.js).'));
      return c.post(body);
    };
    const as = cred => ({ who: cred.who, pass: cred.pass });
    return {
      list: () => call({ action: 'divisions' }).then(r => r.divisions),
      get: name => call({ action: 'division', name }).then(r => r.division),
      save: (entry, overwrite, cred) =>
        call({ action: 'saveDivision', division: entry, overwrite, ...as(cred) }).then(r => r.division),
      remove: (name, cred) => call({ action: 'deleteDivision', name, ...as(cred) }).then(() => true),
    };
  })();

  // The list as read at load, kept up to date after each change made here; other people's
  // changes show after a reload.
  let saved = null, savedLoad = null;
  const loadSaved = () => (savedLoad ||= store.list().then(l => { saved = l; return l; },
    err => { savedLoad = null; throw err; }));

  // A saved division holds its columns' names as they were (see entry() in createDivision).
  const labelsOf = s => s.columns.map(k => COL[k]?.label || s.labels?.[k] || k);
  const goneOf = s => s.columns.filter(k => !COL[k]).map(k => s.labels?.[k] || k);

  // What no longer fits today's data: a column that is gone, a threshold outside the column's
  // values, a category that is not there.
  function staleIssues(entry) {
    const out = [];
    for (const lv of entry.config.levels || []) {
      const col = COL[lv.column];
      if (!col) { out.push(`העמודה "${entry.labels?.[lv.column] || lv.column}" כבר לא קיימת בנתונים`); continue; }
      const lists = [isCatCol(col) ? lv.groups : lv.thresholds, ...Object.values(lv.branches || {})];
      if (isCatCol(col)) {
        const known = new Set(col.cats.flatMap((c, ci) => [String(c), catName(col, ci), col.values?.[String(c)]]));
        const gone = [...new Set(lists.flat(2).filter(x => x != null && !known.has(String(x))))];
        if (gone.length) out.push(`ב"${col.short}": קטגוריות שכבר לא קיימות: ${gone.join(', ')}`);
      } else {
        const off = [...new Set(lists.flat().filter(t => Number.isFinite(t) && (t < col.min || t > col.max)))];
        if (off.length) out.push(`ב"${col.short}": ספים מחוץ לטווח הערכים של היום (${fmt(col.min, col)} עד ${fmt(col.max, col)}): ${off.map(t => fmt(t, col)).join(', ')}`);
      }
    }
    return out;
  }

  // Runs `then` with the login, asking for one first when this tab has none. `refused` is the
  // server's message when it turned down the login this tab had: that login is dropped, and
  // the dialog asks again with the message on it.
  let afterLogin = null;
  function withLogin(then, refused) {
    if (refused) forgetLogin();
    const cred = login();
    if (cred) { then(cred); return; }
    afterLogin = then;
    $('#login-error').hidden = true;
    if (refused) showError('#login-error', refused);
    $('#login-pass').value = '';
    $('#login-dlg').showModal();
    // after a refusal the name is still in its field; only the password needs typing again
    (refused && $('#login-name').value ? $('#login-pass') : $('#login-name')).focus();
  }
  function forgetLogin() {
    try { sessionStorage.removeItem(LOGIN_KEY); } catch (e) { /* storage blocked */ }
    renderLogin();
  }
  function renderLogin() {
    const cred = login();
    $('#navUser').innerHTML = cred ? `<span class="nm">${esc(cred.who)}</span><button type="button" id="outBtn">יציאה</button>` : '';
    $('#outBtn')?.addEventListener('click', () => {
      forgetLogin();
      toast('היציאה בוצעה');
    });
  }
  const showError = (sel, msg) => { $(sel).textContent = msg; $(sel).hidden = false; };

  function setSaveExists(on) {
    $('#save-exists').hidden = !on;
    $('#save-go').textContent = on ? 'החלפה' : 'שמירה';
  }
  // The save dialog saves the division it was opened from; the list loads into the division it
  // was opened from, or (null) adds the division it loads under the others.
  let saveFrom = null, listInto = null;
  function openSave(dv) {
    const T = dv.tree();
    saveFrom = dv;
    $('#save-title').textContent = `שמירת חלוקה ${dv.place()}`;
    $('#save-name').value = dv.source().kind === 'saved' ? dv.source().name : '';
    $('#save-error').hidden = true;
    setSaveExists(false);
    $('#save-what').textContent = T.act.length ? T.act.map(A => A.col.short).join(' · ') : 'אין שלבים';
    $('#save-dlg').showModal();
    $('#save-name').select();
    loadSaved().catch(() => { /* the server checks the name again on save */ });
  }

  function openList(dv) {
    listInto = dv;
    $('#list-title').textContent = dv ? `טעינת חלוקה שמורה לחלוקה ${dv.place()}` : 'הוספת חלוקה שמורה להשוואה';
    $('#list-q').value = '';
    $('#list-dlg').showModal();
    $('#list-q').focus();
    renderList();
    if (!saved) loadSaved().then(renderList, err => { $('#list-state').textContent = 'לא הצלחנו לקרוא את רשימת החלוקות: ' + err.message; });
  }
  function renderList() {
    const host = $('#list-items'), note = $('#list-state');
    if (!saved) { host.innerHTML = ''; note.textContent = 'טוען את רשימת החלוקות…'; return; }
    const q = $('#list-q').value.trim().toLowerCase();
    const all = [...saved].sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt))); // newest first
    $('#list-sugg').innerHTML = [...new Set(all.flatMap(s => [s.name, ...labelsOf(s)]))]
      .map(x => `<option value="${esc(x)}"></option>`).join('');
    const shown = all.filter(s => !q || [s.name, ...labelsOf(s)].some(x => x.toLowerCase().includes(q)));
    note.textContent = !all.length ? 'עוד לא נשמרו חלוקות. אפשר לשמור חלוקה בכפתור "שמירת החלוקה" שבראש כל חלוקה.'
      : !shown.length ? 'אין חלוקות שמתאימות לחיפוש.' : '';
    const when = iso => (iso ? new Date(iso).toLocaleDateString('he-IL') : '');
    host.innerHTML = shown.map(s => {
      const gone = goneOf(s);
      return `<li class="dv-row" data-name="${esc(s.name)}">` +
        `<div class="dv-main"><b class="dv-name">${esc(s.name)}</b>` +
        `<span class="dv-params">${esc(labelsOf(s).join(' · ') || 'אין שלבים')}</span>` +
        `<span class="dv-meta">${esc([s.savedBy, when(s.savedAt)].filter(Boolean).join(' · '))}</span>` +
        (gone.length ? `<span class="dv-warn"><span class="ico">⚠</span>עמודות שכבר לא קיימות בנתונים: ${esc(gone.join(', '))}</span>` : '') +
        '</div><div class="dv-actions">' +
        '<button type="button" class="btn-ghost" data-act="load">טעינה</button>' +
        '<button type="button" class="btn-ghost dv-del" data-act="del">מחיקה</button></div>' +
        '<div class="dv-confirm" hidden>למחוק את החלוקה?' +
        '<button type="button" class="btn-ghost dv-del" data-act="del-yes">מחיקה</button>' +
        '<button type="button" class="btn-ghost" data-act="del-no">ביטול</button></div></li>';
    }).join('');
  }

  function loadDivision(name, btn) {
    btn.disabled = true;
    store.get(name).then(entry => {
      const r = readConfig(entry.config), issues = staleIssues(entry);
      if (r.error) { showStale(issues.length ? issues : [r.error], 'none'); return; }
      $('#list-dlg').close();
      const source = { kind: 'saved', name }, msg = issues.length ? '' : [`נטענה החלוקה "${name}"`, ...r.notes].join('. ');
      if (listInto) loadInto(listInto, r.st, source, msg);
      else {
        addDivision(r.st, source, { scroll: true });
        if (msg) toast(msg);
      }
      if (issues.length) showStale(issues, goneOf(entry).length ? 'some' : 'all');
    }, err => {
      if (err.code === 'missing') { saved = saved.filter(s => s.name !== name); renderList(); }
      toast(err.message);
    }).finally(() => { btn.disabled = false; });
  }
  // loaded: 'all' of it as saved, 'some' (stages of columns that are gone are left out) or 'none'.
  function showStale(issues, loaded) {
    $('#stale-list').innerHTML = issues.map(x => `<li>${esc(x)}</li>`).join('');
    $('#stale-after').textContent = {
      all: 'החלוקה נטענה כמו שנשמרה.',
      some: 'החלוקה נטענה בלי השלבים שעמודותיהם כבר לא קיימות. שאר השלבים נטענו כמו שנשמרו.',
      none: 'אף שלב של החלוקה לא מתאים לנתונים של היום, ולכן היא לא נטענה.',
    }[loaded];
    $('#stale-dlg').showModal();
  }

  function wireSaved() {
    document.querySelectorAll('dialog [data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
    renderLogin();
    loadSaved().catch(() => { /* the list dialog says so when it opens */ });

    $('#login-form').addEventListener('submit', e => {
      e.preventDefault();
      const who = $('#login-name').value.trim(), pass = $('#login-pass').value;
      if (!who || !pass) { showError('#login-error', 'צריך למלא שם וסיסמה.'); return; }
      try { sessionStorage.setItem(LOGIN_KEY, JSON.stringify({ who, pass })); } catch (err) { /* storage blocked */ }
      const then = afterLogin;
      afterLogin = null;
      $('#login-dlg').close();
      renderLogin();
      then?.({ who, pass });
    });
    // closed without logging in. The event comes a moment after close(): if the dialog has
    // opened again by then, for a login the server refused, the retry it holds still stands.
    $('#login-dlg').addEventListener('close', () => { if (!$('#login-dlg').open) afterLogin = null; });

    $('#save-name').addEventListener('input', () => { $('#save-error').hidden = true; setSaveExists(false); });
    $('#save-form').addEventListener('submit', e => {
      e.preventDefault();
      const name = $('#save-name').value.trim(), bad = nameProblem(name);
      if (bad) { showError('#save-error', bad); return; }
      const overwrite = !$('#save-exists').hidden;
      if (!overwrite && saved?.some(s => s.name === name)) { setSaveExists(true); return; }
      const go = $('#save-go'), dv = saveFrom;
      const attempt = cred => {
        go.disabled = true;
        store.save(dv.entry(name), overwrite, cred).then(sum => {
          saved = [...(saved || []).filter(s => s.name !== name), sum];
          $('#save-dlg').close();
          dv.saved(name);
          toast(overwrite ? `החלוקה "${name}" הוחלפה` : `החלוקה "${name}" נשמרה`);
        }, err => {
          if (err.code === 'exists') setSaveExists(true); // saved by someone else since the list was read
          else if (err.code === 'login') withLogin(attempt, err.message);
          else showError('#save-error', err.message);
        }).finally(() => { go.disabled = false; });
      };
      withLogin(attempt);
    });

    $('#list-q').addEventListener('input', renderList);
    $('#list-items').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const row = b.closest('.dv-row'), name = row.dataset.name, act = b.dataset.act;
      if (act === 'load') loadDivision(name, b);
      else if (act === 'del' || act === 'del-no') {
        row.querySelector('.dv-confirm').hidden = act === 'del-no';
        row.querySelector('.dv-actions').hidden = act === 'del';
      } else if (act === 'del-yes') {
        const gone = () => { saved = saved.filter(s => s.name !== name); renderList(); toast(`החלוקה "${name}" נמחקה`); };
        const attempt = cred => {
          b.disabled = true;
          store.remove(name, cred).then(gone, err => {
            b.disabled = false;
            if (err.code === 'missing') gone();
            else if (err.code === 'login') withLogin(attempt, err.message);
            else toast(err.message);
          });
        };
        withLogin(attempt);
      }
    });
  }

  // ---------- the page ----------
  // The divisions, one under the other (`divisions`, in page order). The search, the score and
  // the divisions ranked by it sit in the top bar and apply to all of them; the URL hash keeps
  // the lot across reloads and links.
  const divisions = [];
  let searchIds = new Set();
  const VIEW_KEY = 'mashah-view';
  function rememberedView() {
    try { return localStorage.getItem(VIEW_KEY) || 'tree'; } catch (e) { return 'tree'; } // storage blocked
  }

  // A new division at place `at` (from 0; the end by default).
  function addDivision(st, source, { at = divisions.length, view = rememberedView(), scroll = false } = {}) {
    const dv = createDivision({ st, source, view, before: divisions[at]?.root || null });
    divisions.splice(at, 0, dv);
    renumber();
    if (scroll) dv.root.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    return dv;
  }
  function removeDivision(dv) {
    const at = divisions.indexOf(dv);
    if (at < 0 || divisions.length < 2) return;
    const st = cloneState(dv.state), source = dv.source(), view = dv.view();
    divisions.splice(at, 1);
    dv.destroy();
    renumber();
    toast(`חלוקה ${at + 1} הוסרה מההשוואה`,
      { label: 'ביטול', run: () => addDivision(st, source, { at: Math.min(at, divisions.length), view, scroll: true }) });
  }
  function renumber() {
    divisions.forEach((dv, k) => dv.setPlace(k + 1));
    pageChanged();
  }
  // Loads a split into a division, with a way back.
  function loadInto(dv, st, source, msg) {
    const before = cloneState(dv.state), was = dv.source();
    dv.loadState(st, source);
    if (msg) toast(msg, { label: 'ביטול', run: () => dv.loadState(before, was) });
  }

  // Every division's ⋯ menu closes on a click outside it, and on Esc.
  function closeMenus(inside) {
    document.querySelectorAll('.division .menu').forEach(m => {
      if (inside && m.contains(inside)) return;
      $('.menu-pop', m).hidden = true;
      $('.menu-btn', m).setAttribute('aria-expanded', 'false');
    });
  }

  // A division changed: the ranking and the hash follow, once a frame.
  let pageRaf = 0;
  function pageChanged() {
    if (!pageRaf) pageRaf = requestAnimationFrame(() => { pageRaf = 0; renderCompare(); saveHash(); });
  }

  // The divisions side by side in the top bar, the best score first. A click goes to the division.
  function renderCompare() {
    const host = $('#compare');
    host.hidden = divisions.length < 2;
    if (host.hidden) return;
    const M = metric(), ok = M.ok();
    const rows = divisions.map(dv => ({ dv, n: dv.place(), t: dv.total() }));
    if (ok) rows.sort((a, b) => b.t - a.t || a.n - b.n);
    host.innerHTML = `<span class="cmp-lbl">${ok ? `דירוג לפי ${esc(M.score)}` : 'החלוקות'}</span>` + rows.map((r, k) => {
      const under = r.dv.under();
      return `<button type="button" class="cmp-chip${ok && k === 0 ? ' top' : ''}" data-n="${r.n}"` +
        ` title="מעבר לחלוקה ${r.n}${under ? `. ${under} קבוצות מתחת למינימום` : ''}">` +
        `<span class="div-num">${r.n}</span><span class="cmp-name">${esc(r.dv.label())}</span>` +
        (ok ? `<b class="cmp-v">${scoreText(r.t)}</b>` : '') + (under ? '<span class="ico" aria-hidden="true">⚠</span>' : '') + '</button>';
    }).join('');
  }

  // ---------- the score: R² or a target measurement ----------
  function wireScoring() {
    const mode = $('#score-mode'), sel = $('#target-col'), scale = $('#target-scale');
    sel.innerHTML = columnOptions(null, { keep: canTarget, none: 'בחרו מדד מטרה' });
    $('[data-mode="r2"]', mode).disabled = !SCORE;
    mode.addEventListener('click', e => {
      const b = e.target.closest('button[data-mode]');
      if (!b || b.disabled || b.dataset.mode === scoring.mode) return;
      setScoring({ mode: b.dataset.mode });
      if (scoring.mode === 'target' && !TARGET) {
        sel.focus();
        try { sel.showPicker(); } catch (err) { /* the browser cannot open the list from script */ }
      }
    });
    sel.addEventListener('change', () => setScoring({ col: sel.value })); // the scale stays as it was
    scale.addEventListener('click', e => {
      const b = e.target.closest('button[data-scale]');
      if (b && b.dataset.scale !== TARGET?.type) setScoring({ scale: b.dataset.scale });
    });
    $('#compare').addEventListener('click', e => {
      const b = e.target.closest('.cmp-chip'), dv = b && divisions[Number(b.dataset.n) - 1];
      if (dv) dv.root.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  }
  function setScoring(change) {
    Object.assign(scoring, change);
    setTarget();
    syncScoring();
    divisions.forEach(dv => dv.rescore());
    pageChanged();
  }
  function syncScoring() {
    const sel = $('#target-col');
    pressOnly($('#score-mode'), b => b.dataset.mode === scoring.mode);
    sel.hidden = scoring.mode !== 'target';
    sel.value = scoring.col;
    $('#target-scale').hidden = !TARGET || TARGET.col.discrete;
    pressOnly($('#target-scale'), b => b.dataset.scale === TARGET?.type);
  }

  // ---------- search, over every division ----------
  function wireSearch() {
    const search = $('#search');
    search.addEventListener('input', () => {
      const q = search.value.trim();
      searchIds = new Set(q ? AUTH.filter(a => a.name.includes(q)).map(a => a.id) : []);
      $('#search-n').textContent = q ? (searchIds.size ? String(searchIds.size) : 'אין') : '';
      divisions.forEach(dv => dv.applySearch());
    });
    search.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const first = divisions.map(dv => dv.searchEnter()).find(Boolean);
      if (first) flash(first);
    });
  }

  // The card under the last division: a new one from scratch, or a saved one.
  function wireAdd() {
    $('#div-add').addEventListener('click', e => {
      const b = e.target.closest('button[data-add]');
      if (!b) return;
      if (b.dataset.add === 'saved') { openList(null); return; }
      const last = divisions[divisions.length - 1];
      addDivision(stateFromConfig({ min_group_size: last?.state.min, levels: [] }), { kind: 'new' }, { scroll: true });
    });
  }

  // ---------- the URL hash keeps the divisions and the score across reloads and links ----------
  function saveHash() {
    if (IN_ARTIFACT) return;
    const o = { divisions: divisions.map(dv => dv.hashEntry()) };
    if (scoring.mode === 'target') o.score = { target: scoring.col, scale: scoring.scale };
    try { history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(o))); } catch (e) { /* file:// in some browsers */ }
  }
  function readHash() {
    if (IN_ARTIFACT) return null;
    try {
      const h = decodeURIComponent(location.hash.slice(1));
      return h ? JSON.parse(h) : null;
    } catch (e) { return null; }
  }
  // The divisions a hash holds, and its score. A link from before the page compared divisions
  // holds one division's settings; no hash, or nothing usable in it, gives the recommended split.
  function fromHash(h) {
    if (h && h.score && typeof h.score === 'object') {
      scoring.mode = 'target';
      scoring.col = canTarget(COL[h.score.target]) ? h.score.target : '';
      // a link without a scale is from when the scale followed the column: it opens as it did
      const col = COL[scoring.col];
      scoring.scale = SCALE_NAMES[h.score.scale] ? h.score.scale : col && !col.discrete ? col.defaultScale : 'linear';
    }
    const list = Array.isArray(h?.divisions) ? h.divisions : Array.isArray(h?.levels) ? [{ kind: 'link', config: h }] : [];
    const out = [];
    for (const x of list) {
      const cfg = x && x.config;
      // a division with no stage yet is no error here
      const r = cfg && Array.isArray(cfg.levels) && !cfg.levels.length ? { st: stateFromConfig(cfg) } : readConfig(cfg);
      if (r.error) continue;
      let kind = x.kind === 'saved' && typeof x.name === 'string' ? 'saved' : ['rec', 'import', 'link', 'new'].includes(x.kind) ? x.kind : 'link';
      if (kind === 'link' && canonical(r.st, computeTree(r.st)) === REC_CANON) kind = 'rec';
      out.push({ st: r.st, source: { kind, name: kind === 'saved' ? x.name : undefined, mod: !!x.mod } });
    }
    return out.length ? out : [{ st: stateFromConfig(REC), source: { kind: 'rec' } }];
  }

  // ---------- init ----------
  $('#title').title = `${AUTH.length} רשויות · הנתונים עודכנו ב-${String(D.built).split('-').reverse().join('.')}`;
  const start = fromHash(readHash());
  setTarget();
  wireScoring();
  syncScoring();
  wireSearch();
  wireAdd();
  wireImport();
  wireSaved();
  document.addEventListener('click', e => closeMenus(e.target));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(null); });
  // the top bar's height, for the stage columns that stick under it
  new ResizeObserver(() => document.documentElement.style.setProperty('--head-h', $('#topbar').offsetHeight + 'px'))
    .observe($('#topbar'));
  start.forEach(x => addDivision(x.st, x.source));
  // web fonts change text widths, which moves the branch ends and the map labels
  document.fonts?.ready.then(() => divisions.forEach(dv => dv.redraw()));
})();
