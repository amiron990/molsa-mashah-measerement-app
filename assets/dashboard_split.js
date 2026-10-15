// The recommended split, loaded by the "חזרה לחלוקה המומלצת" button.
// Similarity-tree work: one column per characteristic, in the order
// population -> authority as an organization -> mashah. `branches` holds the
// recommended per-branch thresholds, rounded. `thresholds` on stages 2-3 is only a
// uniform approximation for dashboards that do not read `branches` yet (it leaves
// two groups below 12); every branch is listed, so it is otherwise unused.
// Per-authority assignment: results/recommended_tree_assignment.csv
// (column group_recommended_rounded).
//
// levels: the tree's stages, top to bottom; the order is the order of the splits.
//   Up to one stage per characteristic (BLOCKS in analysis/build_tree.py), placed by its
//   column's characteristic, plus at most one optional extra stage ("חלוקה נוספת"),
//   which may use any column.
//   column     - technical name from the "הסבר מדדים" sheet (e.g. "pop_total"), of the
//                authorities table or of results/admin_columns.xlsx.
//   groups     - instead of thresholds, for a column of categories (e.g. "plc_top_admin"):
//                the groups as lists of category names, in any combination, e.g.
//                [["ותיקים", "של\"ם"], ["מוגבלויות", "אישיים וחברתיים"]]. In `branches`, each
//                branch gets such a list too. A category left out gets a group of its own.
//   extra      - optional, true for the extra stage. A level whose characteristic already
//                has a stage also goes to the extra stage.
//   thresholds - cut points in the source units, used by every branch of the stage
//                that is not listed in `branches`. Percent columns are fractions
//                (0.33 = 33%). A value equal to a threshold goes to the upper branch.
//   branches   - optional per-branch thresholds. The key is the branch path from the
//                earlier stages, numbered from 1 and from the lowest values up:
//                "2" = second branch of stage 1, "2.1" = its first branch in stage 2.
//                An empty list means the branch is not split at this stage.
//                Example: { column: "shr_0_18", branches: { "1": [0.33], "2": [0.31] } }
//   scale      - optional slider scale: "linear" | "quantile" (an older "log" reads as "quantile").
// The dashboard's "העתקת הגדרות" menu item copies the current state in this format, and
// "ייבוא הגדרות" loads it back, from pasted text or a file (this file loads too).
window.RECOMMENDED_SPLIT = {
  label: "עץ מומלץ - ספים לפי ענף, מעוגלים",
  min_group_size: 12,
  levels: [
    { column: "shr_disability", thresholds: [0.11] },
    {
      column: "fin_own_income_share",
      thresholds: [0.45],
      branches: { "1": [0.45], "2": [0.40] },
    },
    {
      column: "plc_personal_per_1000_0_18",
      thresholds: [22, 35],
      branches: { "1.1": [26, 34], "1.2": [4, 22], "2.1": [31, 41], "2.2": [27, 41] },
    },
  ],
};
