// SQLite unified registry. One shared connection, WAL mode, foreign keys on.
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = join(DATA_DIR, "registry.sqlite");

let _db;
export function db() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  return _db;
}

/** Create the schema if it doesn't exist. Safe to call repeatedly. */
export function migrate() {
  const d = db();
  d.exec(`
    CREATE TABLE IF NOT EXISTS zones (
      zone_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      min_lat REAL, min_lng REAL, max_lat REAL, max_lng REAL,
      centroid_lat REAL, centroid_lng REAL,
      cctv_count INTEGER DEFAULT 0,
      chokepoint_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS cctv (
      id INTEGER PRIMARY KEY,
      zone_id TEXT, lat REAL, lng REAL, label TEXT
    );

    CREATE TABLE IF NOT EXISTS chokepoints (
      id INTEGER PRIMARY KEY,
      name TEXT, zone_id TEXT, lat REAL, lng REAL, risk TEXT
    );

    CREATE TABLE IF NOT EXISTS police (
      id INTEGER PRIMARY KEY,
      name TEXT, lat REAL, lng REAL, phone TEXT
    );

    CREATE TABLE IF NOT EXISTS centers (
      name TEXT PRIMARY KEY, lat REAL, lng REAL, zone_id TEXT
    );

    CREATE TABLE IF NOT EXISTS snan_days (
      date TEXT PRIMARY KEY, name TEXT, surge_factor REAL
    );

    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY,
      case_id TEXT UNIQUE NOT NULL,
      report_type TEXT NOT NULL,            -- missing | found
      reporting_center TEXT NOT NULL,
      person_name TEXT,
      gender TEXT,
      age_band TEXT,
      language TEXT,
      physical_description TEXT,
      last_seen_location TEXT,
      lat REAL, lng REAL, zone_id TEXT,
      reporter_name TEXT,
      reporter_mobile TEXT,
      relation TEXT,
      status TEXT NOT NULL DEFAULT 'pending', -- pending|in_search|matched|reunited|unresolved
      lane TEXT,                              -- reunion|search
      match_score INTEGER DEFAULT 0,
      matched_case_id TEXT,
      is_duplicate_report INTEGER DEFAULT 0,
      duplicate_group TEXT,
      priority INTEGER DEFAULT 3,            -- 1 highest .. 5 lowest
      reported_at TEXT,
      resolved_at TEXT,
      resolution_hours REAL,
      truth_person_id TEXT,                  -- ground truth for benchmark only
      offline INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
    CREATE INDEX IF NOT EXISTS idx_cases_type ON cases(report_type);
    CREATE INDEX IF NOT EXISTS idx_cases_zone ON cases(zone_id);
    CREATE INDEX IF NOT EXISTS idx_cases_truth ON cases(truth_person_id);

    CREATE TABLE IF NOT EXISTS broadcasts (
      id INTEGER PRIMARY KEY,
      case_id TEXT, matched_case_id TEXT,
      ts TEXT DEFAULT (datetime('now')),
      pa_script TEXT, pa_script_local TEXT,
      channels TEXT, sms_sent INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      case_id TEXT, ts TEXT DEFAULT (datetime('now')),
      zone_id TEXT, team TEXT, steps TEXT, status TEXT DEFAULT 'open'
    );

    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY,
      ts TEXT DEFAULT (datetime('now')),
      case_id TEXT, action TEXT, detail TEXT, actor TEXT
    );
  `);
}

export function audit(case_id, action, detail = "", actor = "system") {
  db()
    .prepare(
      "INSERT INTO audit (case_id, action, detail, actor) VALUES (?,?,?,?)"
    )
    .run(case_id, action, typeof detail === "string" ? detail : JSON.stringify(detail), actor);
}

/** Next sequential case id (KYP-####). SQLite serialises writes, so this is safe. */
export function nextCaseId() {
  const row = db()
    .prepare("SELECT MAX(CAST(substr(case_id,5) AS INTEGER)) m FROM cases WHERE case_id LIKE 'KYP-%'")
    .get();
  return `KYP-${(row.m || 1000) + 1}`;
}

/** Wipe all rows (used by the seeder). */
export function reset() {
  const d = db();
  for (const t of [
    "cases", "broadcasts", "tasks", "audit",
    "cctv", "chokepoints", "police", "zones", "centers", "snan_days",
  ]) {
    d.exec(`DELETE FROM ${t};`);
  }
}
