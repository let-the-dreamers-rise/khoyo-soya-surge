// Cross-center match engine: candidate retrieval + scoring + duplicate detection.
import { db } from "./db.js";
import { scorePair, keywords } from "./agent.js";

const OPEN = "('pending','in_search','matched')";

function hydrate(row) {
  return { ...row, _kw: keywords(row.physical_description) };
}

/**
 * Find the best cross-center reunification candidates for a case.
 * A 'missing' report matches against open 'found' reports (and vice-versa),
 * scanning ALL centers — this is the core cross-center fix.
 */
export function findMatches(caseRow, { limit = 6, minScore = 1 } = {}) {
  const oppType = caseRow.report_type === "missing" ? "found" : "missing";
  const pool = db()
    .prepare(
      `SELECT * FROM cases
       WHERE report_type = ? AND status IN ${OPEN} AND case_id != ?`
    )
    .all(oppType, caseRow.case_id)
    .map(hydrate);

  const self = hydrate(caseRow);
  const scored = pool
    .map((cand) => {
      const { score, reasons } = scorePair(self, cand);
      const crossCenter = cand.reporting_center !== caseRow.reporting_center;
      return { candidate: cand, score, reasons, crossCenter };
    })
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

/**
 * Detect duplicate reports: the SAME person reported (same report_type) at a
 * DIFFERENT center. High similarity + same type = likely double-count.
 */
export function findDuplicates(caseRow, { minScore = 72 } = {}) {
  const pool = db()
    .prepare(
      `SELECT * FROM cases
       WHERE report_type = ? AND status IN ${OPEN}
         AND reporting_center != ? AND case_id != ?`
    )
    .all(caseRow.report_type, caseRow.reporting_center, caseRow.case_id)
    .map(hydrate);

  const self = hydrate(caseRow);
  return pool
    .map((cand) => ({ candidate: cand, ...scorePair(self, cand) }))
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

/** Compact candidate shape for API responses. */
export function summarize(m) {
  const c = m.candidate;
  return {
    case_id: c.case_id,
    report_type: c.report_type,
    reporting_center: c.reporting_center,
    person_name: c.person_name,
    gender: c.gender,
    age_band: c.age_band,
    language: c.language,
    physical_description: c.physical_description,
    last_seen_location: c.last_seen_location,
    lat: c.lat, lng: c.lng, zone_id: c.zone_id,
    score: m.score,
    cross_center: m.crossCenter,
    reasons: m.reasons,
  };
}
