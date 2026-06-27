// Benchmark: the Surge agent vs a naive keyword baseline, on planted ground truth.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, migrate } from "./db.js";
import { findMatches, findDuplicates } from "./match.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const stop = new Set(["the", "a", "in", "is", "has", "near", "last", "seen", "at", "and", "with", "looks", "keeps", "asking", "cannot", "of", "seems"]);
const words = (s) => new Set((s || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)));

/** Naive keyword baseline: most raw-word-overlap candidate, needs >=2 shared + same name when both known. */
function baselineMatch(row, pool) {
  const rw = words(row.physical_description);
  let best = null, bestN = 0;
  for (const c of pool) {
    if (row.person_name && c.person_name && row.person_name !== c.person_name) continue;
    const cw = words(c.physical_description);
    let n = 0;
    for (const w of rw) if (cw.has(w)) n++;
    if (n > bestN) { bestN = n; best = c; }
  }
  return bestN >= 2 ? best : null;
}

function run() {
  migrate();
  const d = db();
  const openMissing = d.prepare("SELECT * FROM cases WHERE report_type='missing' AND status IN ('pending','in_search')").all();
  const openFound = d.prepare("SELECT * FROM cases WHERE report_type='found' AND status IN ('pending','in_search')").all();
  const foundByTruth = new Map();
  for (const f of openFound) if (f.truth_person_id) foundByTruth.set(f.truth_person_id, f);

  const matchable = openMissing.filter((m) => foundByTruth.has(m.truth_person_id));

  let agentCorrect = 0, agentConfident = 0, baseCorrect = 0;
  let noNameTotal = 0, noNameAgent = 0;
  const t0 = performance.now();
  for (const m of matchable) {
    const truth = m.truth_person_id;
    const res = findMatches(m, { limit: 3 });
    const top = res[0];
    if (top && top.candidate.truth_person_id === truth) {
      agentCorrect++;
      if (top.score >= 80) agentConfident++;
    }
    if (m.person_name == null) { noNameTotal++; if (top && top.candidate.truth_person_id === truth) noNameAgent++; }
    const b = baselineMatch(m, openFound);
    if (b && b.truth_person_id === truth) baseCorrect++;
  }
  const agentMs = (performance.now() - t0) / matchable.length;

  // duplicate linking (same person, two centers, same report_type)
  const dupRows = d.prepare("SELECT * FROM cases WHERE is_duplicate_report=1 AND status IN ('pending','in_search')").all();
  const dupGroups = new Map();
  for (const r of dupRows) (dupGroups.get(r.duplicate_group) || dupGroups.set(r.duplicate_group, []).get(r.duplicate_group)).push(r);
  let dupTotal = 0, dupAgent = 0, dupBase = 0;
  for (const [, rows] of dupGroups) {
    if (rows.length < 2) continue;
    const [a, b] = rows;
    dupTotal++;
    const link = findDuplicates(a, { minScore: 72 });
    if (link[0] && link[0].candidate.case_id === b.case_id) dupAgent++;
    const bb = baselineMatch(a, [b]);
    if (bb) dupBase++;
  }

  const pct = (n, t) => (t ? +(100 * n / t).toFixed(1) : 0);
  const metrics = {
    generated_at: new Date().toISOString(),
    dataset: { total_cases: d.prepare("SELECT COUNT(*) n FROM cases").get().n, matchable_pairs: matchable.length, duplicate_groups: dupTotal },
    cross_center_matches: { agent: agentCorrect, baseline: baseCorrect, multiple: +(agentCorrect / Math.max(1, baseCorrect)).toFixed(1) },
    recall: { agent_pct: pct(agentCorrect, matchable.length), baseline_pct: pct(baseCorrect, matchable.length) },
    confident_auto_reunion_pct: pct(agentConfident, matchable.length),
    no_name_cases: { total: noNameTotal, agent_pct: pct(noNameAgent, noNameTotal), baseline_note: "keyword baseline cannot use names it doesn't have" },
    duplicate_linking: { groups: dupTotal, agent_pct: pct(dupAgent, dupTotal), baseline_pct: pct(dupBase, dupTotal) },
    avg_match_time_ms: +agentMs.toFixed(2),
  };

  writeFileSync(join(DATA_DIR, "metrics.json"), JSON.stringify(metrics, null, 2));

  const bar = (p) => "█".repeat(Math.round(p / 5)).padEnd(20, "·");
  console.log("\n  KHOYA-PAYA SURGE — BENCHMARK  (agent vs keyword baseline)\n");
  console.log(`  Matchable cross-center pairs : ${matchable.length}`);
  console.log(`  Cross-center matches found   : agent ${agentCorrect}  vs  baseline ${baseCorrect}   (${metrics.cross_center_matches.multiple}×)`);
  console.log(`  Recall  agent   ${bar(metrics.recall.agent_pct)} ${metrics.recall.agent_pct}%`);
  console.log(`  Recall  baseline${bar(metrics.recall.baseline_pct)} ${metrics.recall.baseline_pct}%`);
  console.log(`  No-name cases (agent)        : ${metrics.no_name_cases.agent_pct}%  of ${noNameTotal}`);
  console.log(`  Duplicate linking            : agent ${metrics.duplicate_linking.agent_pct}%  vs baseline ${metrics.duplicate_linking.baseline_pct}%  (${dupTotal} groups)`);
  console.log(`  Confident auto-reunion-ready : ${metrics.confident_auto_reunion_pct}%`);
  console.log(`  Avg match time               : ${metrics.avg_match_time_ms} ms / case`);
  console.log(`\n  → data/metrics.json\n`);
}

run();
