// REST API for the Khoya-Paya Surge Engine.
import { Router } from "express";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, audit, nextCaseId } from "../src/db.js";
import { agentMode, parseIntake } from "../src/agent.js";
import { evaluateLane, assignLane, getCase } from "../src/lane.js";
import { findMatches, findDuplicates, summarize } from "../src/match.js";
import { buildBroadcast, logBroadcast, confirmReunion, paScript } from "../src/reunion.js";
import { buildTask, rankZones, surgeStatus, priorityQueue } from "../src/search.js";
import { zonesGeo, heatmap, signs, fullGeo, sweepRoute, cctvSample } from "../src/map.js";
import { nearestPolice, route } from "../src/police.js";
import { syncBatch, snapshot } from "../src/sync.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const r = Router();
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(500).json({ error: String(e.message || e) }));
const need = (row, res) => { if (!row) { res.status(404).json({ error: "case not found" }); return false; } return true; };

// ---- system ----
r.get("/health", (_req, res) => {
  const n = (q) => db().prepare(q).get().n;
  res.json({
    ok: true,
    agent: agentMode(),
    surge: surgeStatus(),
    cases: n("SELECT COUNT(*) n FROM cases"),
    open: n("SELECT COUNT(*) n FROM cases WHERE status IN ('pending','in_search','matched')"),
  });
});

r.get("/dashboard-data", (_req, res) => {
  const d = db();
  const n = (q) => d.prepare(q).get().n;
  const byStatus = d.prepare("SELECT status, COUNT(*) n FROM cases GROUP BY status").all();
  const byCenter = d.prepare("SELECT reporting_center center, COUNT(*) n FROM cases WHERE status IN ('pending','in_search','matched') GROUP BY reporting_center ORDER BY n DESC").all();
  const byLane = d.prepare("SELECT lane, COUNT(*) n FROM cases WHERE status IN ('pending','in_search','matched') GROUP BY lane").all();
  res.json({
    generated_at: new Date().toISOString(),
    agent: agentMode(),
    surge: surgeStatus(),
    totals: {
      cases: n("SELECT COUNT(*) n FROM cases"),
      open: n("SELECT COUNT(*) n FROM cases WHERE status IN ('pending','in_search','matched')"),
      reunited: n("SELECT COUNT(*) n FROM cases WHERE status='reunited'"),
      reunited_today: n("SELECT COUNT(*) n FROM cases WHERE status='reunited' AND resolved_at >= datetime('now','-1 day')"),
      reunion_lane: n("SELECT COUNT(*) n FROM cases WHERE lane='reunion' AND status IN ('matched','in_search')"),
      search_lane: n("SELECT COUNT(*) n FROM cases WHERE lane='search' AND status IN ('pending','in_search')"),
      duplicates: n("SELECT COUNT(*) n FROM cases WHERE is_duplicate_report=1"),
      phoneless: n("SELECT COUNT(*) n FROM cases WHERE report_type='missing' AND reporter_mobile IS NULL AND status IN ('pending','in_search','matched')"),
      offline_queued: n("SELECT COUNT(*) n FROM cases WHERE offline=1"),
      avg_resolution_hours: d.prepare("SELECT ROUND(AVG(resolution_hours),2) v FROM cases WHERE resolution_hours IS NOT NULL").get().v,
    },
    by_status: byStatus, by_lane: byLane, by_center: byCenter,
    activity: d.prepare("SELECT case_id, action, detail, actor, ts FROM audit ORDER BY id DESC LIMIT 12").all(),
  });
});

r.get("/metrics", (_req, res) => {
  try { res.json(JSON.parse(readFileSync(join(DATA_DIR, "metrics.json"), "utf8"))); }
  catch { res.status(404).json({ error: "run `npm run benchmark` first" }); }
});

// ---- cases ----
r.get("/cases", (req, res) => {
  const { status, type, center, lane, q, limit = 60 } = req.query;
  const where = [], args = [];
  if (status) { where.push(`status IN (${status.split(",").map(() => "?").join(",")})`); args.push(...status.split(",")); }
  if (type) { where.push("report_type=?"); args.push(type); }
  if (center) { where.push("reporting_center=?"); args.push(center); }
  if (lane) { where.push("lane=?"); args.push(lane); }
  if (q) { where.push("(physical_description LIKE ? OR person_name LIKE ? OR case_id LIKE ? OR last_seen_location LIKE ?)"); args.push(...Array(4).fill(`%${q}%`)); }
  const sql = `SELECT case_id,report_type,reporting_center,person_name,gender,age_band,language,physical_description,
      last_seen_location,lat,lng,zone_id,reporter_mobile,status,lane,match_score,matched_case_id,is_duplicate_report,
      priority,reported_at,resolution_hours FROM cases
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY reported_at DESC LIMIT ?`;
  res.json(db().prepare(sql).all(...args, Math.min(+limit, 300)));
});

r.get("/cases/:id", wrap((req, res) => {
  const row = getCase(req.params.id);
  if (!need(row, res)) return;
  const evalRes = evaluateLane(row);
  const out = { case: row, evaluation: evalRes };
  if (evalRes.lane === "reunion" && evalRes.best) {
    out.broadcast = buildBroadcast(row, getCase(evalRes.best.case_id));
  } else {
    out.task = buildTask(row);
  }
  res.json(out);
}));

r.post("/cases", wrap((req, res) => {
  const b = req.body || {};
  if (!b.reporting_center) return res.status(400).json({ error: "reporting_center required" });
  const center = db().prepare("SELECT * FROM centers WHERE name=?").get(b.reporting_center);
  let lat = b.lat, lng = b.lng;
  if ((lat == null || lng == null) && b.zone_id) {
    const z = db().prepare("SELECT centroid_lat, centroid_lng FROM zones WHERE zone_id=?").get(b.zone_id);
    if (z) { lat = z.centroid_lat; lng = z.centroid_lng; }
  }
  if (lat == null && center) { lat = center.lat; lng = center.lng; }
  const zone_id = b.zone_id || null;
  const case_id = nextCaseId();
  const priority = (b.age_band || "").startsWith("0-12") || (b.age_band || "").startsWith("80") ? 1 : 3;
  db().prepare(
    `INSERT INTO cases (case_id,report_type,reporting_center,person_name,gender,age_band,language,physical_description,
       last_seen_location,lat,lng,zone_id,reporter_name,reporter_mobile,relation,status,priority,reported_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)`
  ).run(case_id, b.report_type || "missing", b.reporting_center, b.person_name ?? null, b.gender ?? null,
    b.age_band ?? null, b.language ?? null, b.physical_description ?? "", b.last_seen_location ?? null,
    lat ?? null, lng ?? null, zone_id, b.reporter_name ?? null, b.reporter_mobile ?? null, b.relation ?? null,
    priority, b.reported_at || new Date().toISOString());
  audit(case_id, "intake", `${b.report_type || "missing"} @ ${b.reporting_center}`, "volunteer");

  const evalRes = assignLane(getCase(case_id));
  const row = getCase(case_id);
  const out = { case_id, receipt_code: case_id, ...evalRes };
  if (evalRes.lane === "reunion" && evalRes.best) out.broadcast = buildBroadcast(row, getCase(evalRes.best.case_id));
  else out.task = buildTask(row);
  res.status(201).json(out);
}));

// ---- intake parsing ----
r.post("/intake/parse", wrap(async (req, res) => {
  const { text, report_type, language, last_seen_location } = req.body || {};
  if (!text) return res.status(400).json({ error: "text required" });
  res.json(await parseIntake(text, { report_type, language, last_seen_location }));
}));

// ---- lane ----
r.post("/lane/evaluate", wrap((req, res) => {
  const row = getCase(req.body?.case_id);
  if (!need(row, res)) return;
  res.json(evaluateLane(row));
}));
r.get("/lane/:case_id", wrap((req, res) => {
  const row = getCase(req.params.case_id);
  if (!need(row, res)) return;
  res.json(assignLane(row));
}));

// ---- reunion ----
r.post("/reunion/broadcast", wrap((req, res) => {
  const a = getCase(req.body?.case_id), b = getCase(req.body?.matched_case_id);
  if (!need(a, res)) return;
  if (!b) return res.status(400).json({ error: "matched_case_id required" });
  const plan = buildBroadcast(a, b);
  logBroadcast(a, b, plan);
  res.json({ lane: "reunion", ...plan });
}));
r.post("/reunion/confirm", wrap((req, res) => {
  const { case_id, matched_case_id, actor } = req.body || {};
  if (!getCase(case_id) || !getCase(matched_case_id)) return res.status(404).json({ error: "case not found" });
  res.json(confirmReunion(case_id, matched_case_id, actor || "volunteer"));
}));

// ---- search ----
r.post("/search/task", wrap((req, res) => {
  const row = getCase(req.body?.case_id);
  if (!need(row, res)) return;
  res.json(buildTask(row));
}));
r.get("/search/rescan/:case_id", wrap((req, res) => {
  const row = getCase(req.params.case_id);
  if (!need(row, res)) return;
  res.json(assignLane(row));
}));
r.get("/search/surge", (_req, res) => res.json(surgeStatus()));
r.get("/queue", (_req, res) => res.json(priorityQueue(+(_req.query?.limit || 12))));

// ---- map ----
const caseFromQuery = (req) => (req.query.case_id ? getCase(req.query.case_id) : null);
r.get("/map/geojson", wrap((req, res) => res.json(fullGeo(caseFromQuery(req)))));
r.get("/map/signs", wrap((req, res) => res.json(signs(caseFromQuery(req)))));
r.get("/map/zones", wrap((req, res) => res.json(zonesGeo(caseFromQuery(req)))));
r.get("/map/cctv", wrap((_req, res) => res.json(cctvSample())));
r.get("/heatmap", wrap((req, res) => res.json(heatmap(caseFromQuery(req)))));
r.get("/map/route", wrap(async (req, res) => {
  const row = caseFromQuery(req);
  if (!need(row, res)) return;
  res.json(await sweepRoute(row));
}));
r.get("/police/nearest", wrap((req, res) => {
  const { lat, lng } = req.query;
  if (lat == null || lng == null) return res.status(400).json({ error: "lat,lng required" });
  res.json(nearestPolice(+lat, +lng));
}));

// ---- duplicates ----
r.post("/duplicates/link", wrap((req, res) => {
  const row = getCase(req.body?.case_id);
  if (!need(row, res)) return;
  const dups = findDuplicates(row);
  res.json({ case_id: row.case_id, duplicates: dups.slice(0, 6).map(summarize) });
}));

// ---- sync ----
r.get("/sync/snapshot", (_req, res) => res.json(snapshot()));
r.post("/sync/batch", wrap((req, res) => res.json(syncBatch(req.body?.cases || []))));

// ---- reference ----
r.get("/centers", (_req, res) => res.json(db().prepare("SELECT * FROM centers").all()));
r.get("/zones", (_req, res) => res.json(db().prepare("SELECT * FROM zones").all()));
r.get("/audit", (req, res) => {
  const cid = req.query.case_id;
  res.json(cid
    ? db().prepare("SELECT * FROM audit WHERE case_id=? ORDER BY id DESC").all(cid)
    : db().prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 50").all());
});

export default r;
