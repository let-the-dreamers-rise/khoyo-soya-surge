// Offline-first sync. Tablets queue intake locally during snan; on reconnect the
// batch uploads, the agent re-scans, and cases may FLIP Search → Reunion.
import { db, audit, nextCaseId } from "./db.js";
import { assignLane, getCase } from "./lane.js";

/** Morning pre-sync snapshot: open cases + geo, cached on the tablet before snan. */
export function snapshot() {
  const d = db();
  return {
    generated_at: new Date().toISOString(),
    open_cases: d.prepare("SELECT case_id,report_type,reporting_center,age_band,language,physical_description,lat,lng,zone_id,status FROM cases WHERE status IN ('pending','in_search','matched')").all(),
    zones: d.prepare("SELECT zone_id,name,centroid_lat,centroid_lng,cctv_count,chokepoint_count FROM zones").all(),
    centers: d.prepare("SELECT * FROM centers").all(),
    police: d.prepare("SELECT * FROM police").all(),
  };
}

/**
 * Upload a batch of cases captured offline. Each is inserted, then lane-evaluated.
 * Returns per-case results including any Search → Reunion flips.
 */
export function syncBatch(cases = []) {
  const d = db();
  const ins = d.prepare(
    `INSERT INTO cases (case_id,report_type,reporting_center,person_name,gender,age_band,language,
       physical_description,last_seen_location,lat,lng,zone_id,reporter_name,reporter_mobile,relation,
       status,lane,priority,reported_at,offline)
     VALUES (@case_id,@report_type,@reporting_center,@person_name,@gender,@age_band,@language,
       @physical_description,@last_seen_location,@lat,@lng,@zone_id,@reporter_name,@reporter_mobile,@relation,
       'pending',NULL,@priority,@reported_at,0)`
  );

  const results = [];
  for (const c of cases) {
    const case_id = c.case_id || nextCaseId();
    const row = {
      case_id,
      report_type: c.report_type || "missing",
      reporting_center: c.reporting_center,
      person_name: c.person_name ?? null,
      gender: c.gender ?? null,
      age_band: c.age_band ?? null,
      language: c.language ?? null,
      physical_description: c.physical_description || "",
      last_seen_location: c.last_seen_location ?? null,
      lat: c.lat ?? null, lng: c.lng ?? null, zone_id: c.zone_id ?? null,
      reporter_name: c.reporter_name ?? null,
      reporter_mobile: c.reporter_mobile ?? null,
      relation: c.relation ?? null,
      priority: (c.age_band || "").startsWith("0-12") || (c.age_band || "").startsWith("80") ? 1 : 3,
      reported_at: c.reported_at || new Date().toISOString(),
    };
    try {
      ins.run(row);
      audit(case_id, "sync_upload", `from offline queue (${row.reporting_center})`, "sync");
      const evalRes = assignLane(getCase(case_id));
      results.push({
        case_id,
        lane: evalRes.lane,
        match_score: evalRes.match_score,
        flipped_to_reunion: evalRes.lane === "reunion",
        best: evalRes.best ? { case_id: evalRes.best.case_id, center: evalRes.best.reporting_center, score: evalRes.best.score } : null,
      });
    } catch (e) {
      results.push({ case_id, error: String(e.message || e) });
    }
  }

  const flips = results.filter((r) => r.flipped_to_reunion).length;
  return { uploaded: results.length, lane_flips: flips, results };
}
