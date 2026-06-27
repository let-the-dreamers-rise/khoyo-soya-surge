// The dual-lane router. Every case lands in Reunion Lane (confident match) or
// Search Lane (deploy field teams). Cases FLIP lanes as new evidence arrives.
import { db, audit } from "./db.js";
import { findMatches, findDuplicates, summarize } from "./match.js";

export const THRESHOLD = { match: 80, review: 50 };

/** Pure evaluation: where should this case go, and why. */
export function evaluateLane(caseRow) {
  const matches = findMatches(caseRow);
  const duplicates = findDuplicates(caseRow);
  const best = matches[0] || null;
  const bestScore = best?.score ?? 0;

  let lane, action;
  if (bestScore >= THRESHOLD.match) { lane = "reunion"; action = "broadcast_ready"; }
  else if (bestScore >= THRESHOLD.review) { lane = "search"; action = "volunteer_review"; }
  else { lane = "search"; action = "deploy_search"; }

  return {
    case_id: caseRow.case_id,
    lane, action,
    match_score: bestScore,
    best: best ? summarize(best) : null,
    matches: matches.map(summarize),
    duplicates: duplicates.slice(0, 4).map((m) => ({
      case_id: m.candidate.case_id,
      reporting_center: m.candidate.reporting_center,
      score: m.score,
    })),
    threshold: THRESHOLD,
  };
}

/** Evaluate AND persist lane + provisional match onto the case. */
export function assignLane(caseRow) {
  const result = evaluateLane(caseRow);
  const matchedId = result.lane === "reunion" ? result.best?.case_id : null;
  const prevLane = caseRow.lane;

  db().prepare(
    `UPDATE cases SET lane=?, match_score=?, matched_case_id=?,
       status = CASE WHEN ?='reunion' AND status NOT IN ('reunited') THEN 'matched'
                     WHEN status='pending' THEN 'in_search' ELSE status END,
       updated_at=datetime('now')
     WHERE case_id=?`
  ).run(result.lane, result.match_score, matchedId, result.lane, caseRow.case_id);

  if (prevLane && prevLane !== result.lane) {
    result.flipped = { from: prevLane, to: result.lane };
    audit(caseRow.case_id, "lane_flip", `${prevLane} → ${result.lane} (score ${result.match_score})`);
  }
  audit(caseRow.case_id, "lane_assign", `${result.lane}/${result.action} score ${result.match_score}`);
  return result;
}

export function getCase(caseId) {
  return db().prepare("SELECT * FROM cases WHERE case_id=?").get(caseId);
}
