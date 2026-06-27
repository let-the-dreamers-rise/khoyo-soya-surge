// Search Lane: rank zones, build a volunteer dispatch task card, surge mode.
import { db, audit } from "./db.js";
import { zoneScore, zoneColor, wanderRadius } from "./geo.js";
import { nearestPolice } from "./police.js";

function maxima() {
  const z = db().prepare("SELECT MAX(cctv_count) mc, MAX(chokepoint_count) mk FROM zones").get();
  return { maxCctv: z.mc || 1, maxChoke: z.mk || 1 };
}

/** Rank all 32 zones for a case (or generically when no last-seen fix). */
export function rankZones(caseRow) {
  const { maxCctv, maxChoke } = maxima();
  const lastSeen = caseRow && Number.isFinite(caseRow.lat) ? { lat: caseRow.lat, lng: caseRow.lng } : null;
  const ageBand = caseRow?.age_band;
  return db()
    .prepare("SELECT * FROM zones")
    .all()
    .map((zone) => {
      const score = zoneScore({ zone, lastSeen, ageBand, maxCctv, maxChoke });
      return { ...zone, score, ...zoneColor(score) };
    })
    .sort((a, b) => b.score - a.score);
}

/** Build (and persist) a dispatch task card for a Search-Lane case. */
export function buildTask(caseRow) {
  const zones = rankZones(caseRow);
  const top = zones.slice(0, 3);
  const first = top[0];

  const choke = db()
    .prepare("SELECT * FROM chokepoints WHERE zone_id=? ORDER BY CASE risk WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END LIMIT 2")
    .all(first?.zone_id);

  const police = Number.isFinite(caseRow.lat)
    ? nearestPolice(caseRow.lat, caseRow.lng)
    : null;

  const wr = wanderRadius(caseRow.age_band);
  const steps = [
    `Keep family seated at ${caseRow.reporting_center} — receipt ${caseRow.case_id}`,
    `Deploy a team to ${first?.name} (${first?.band}, zone ${first?.zone_id})`,
    ...choke.map((c) => `Post a volunteer at ${c.name} (${c.risk}-risk chokepoint)`),
    `Broadcast PA: still searching ${caseRow.case_id} in ${caseRow.language || "Hindi"}`,
    `Search ring ≈ ${wr} m for age ${caseRow.age_band || "?"} — re-scan in 15 min`,
  ];
  if ((caseRow.age_band || "").startsWith("0-12") && police)
    steps.push(`Alert ${police.name} (${(police.distance_m / 1000).toFixed(1)} km) — child protocol`);

  db().prepare(
    "INSERT INTO tasks (case_id, zone_id, team, steps) VALUES (?,?,?,?)"
  ).run(caseRow.case_id, first?.zone_id, "Team A", JSON.stringify(steps));
  audit(caseRow.case_id, "search_task", `dispatch to ${first?.zone_id}`, "volunteer");

  return {
    case_id: caseRow.case_id,
    family_anchor: caseRow.reporting_center,
    wander_radius_m: wr,
    top_zones: top.map((z) => ({ zone_id: z.zone_id, name: z.name, score: z.score, band: z.band, color: z.color })),
    chokepoints: choke.map((c) => ({ name: c.name, risk: c.risk, lat: c.lat, lng: c.lng })),
    nearest_police: police,
    next_steps: steps,
  };
}

/** Surge status from the snan calendar + recent intake volume. */
export function surgeStatus() {
  const today = new Date().toISOString().slice(0, 10);
  const snan = db().prepare("SELECT * FROM snan_days WHERE date>=? ORDER BY date LIMIT 1").get(today);
  const recent = db().prepare("SELECT COUNT(*) n FROM cases WHERE reported_at >= datetime('now','-1 hour')").get().n;
  const baseline = 8;
  const ratio = recent / baseline;
  const active = ratio >= 2;
  return {
    active,
    intake_last_hour: recent,
    baseline_per_hour: baseline,
    load_ratio: +ratio.toFixed(1),
    next_snan: snan ? { date: snan.date, name: snan.name, surge_factor: snan.surge_factor } : null,
    policy: active
      ? "Priority queue ON — children (0–12) and elderly (80+) first"
      : "Normal queue",
  };
}

/** Priority-ordered open queue (surge: minors & 80+ first). */
export function priorityQueue(limit = 12) {
  return db()
    .prepare(
      `SELECT case_id, report_type, reporting_center, person_name, age_band, language,
              physical_description, status, lane, priority, reported_at
       FROM cases WHERE status IN ('pending','in_search','matched')
       ORDER BY priority ASC, reported_at DESC LIMIT ?`
    )
    .all(limit);
}
