// Seed the unified registry with realistic Simhastha data.
// Real WGS84 coordinates for the Nashik–Trimbakeshwar Kumbh area; 2,500 cases
// with PLANTED ground-truth so cross-center matching & the benchmark are honest.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, migrate, reset } from "./db.js";
import { wanderRadius } from "./geo.js";
import { assignLane, getCase } from "./lane.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

// ---- deterministic RNG (reproducible benchmarks) ----
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20270815);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const chance = (p) => rng() < p;
const jitter = (v, amt) => v + (rng() - 0.5) * amt;
const pad = (n, w = 4) => String(n).padStart(w, "0");

// ---- tactical zone grid over the Nashik ghat core (~4.4 x 4.3 km) ----
const BBOX = { minLat: 19.992, maxLat: 20.03, minLng: 73.775, maxLng: 73.815 };
const ROWS = 4, COLS = 8;
const dLat = (BBOX.maxLat - BBOX.minLat) / ROWS;
const dLng = (BBOX.maxLng - BBOX.minLng) / COLS;

const ZONE_NAMES = [
  "Ramkund Ghat", "Kapaleshwar Lane", "Lakshman Kund", "Naroshankar Steps",
  "Panchavati Gate", "Kala Ram Approach", "Sita Gufa Path", "Tapovan Field",
  "Ahilyabai Bridge", "Victoria Bridge", "Gadge Maharaj Pul", "Holkar Bridge",
  "Sardar Chowk", "Malegaon Stand", "Sadhugram Sector A", "Sadhugram Sector B",
  "Sadhugram Sector C", "Akharas Camp", "Dwarka Circle", "CBS Corridor",
  "Mahatma Nagar", "Old Gangapur Rd", "Saraf Bazaar", "Main Road Ghat",
  "Godavari North Bank", "Godavari South Bank", "Someshwar Path", "Anandvalli",
  "Govind Nagar", "Ganeshwadi", "Nimani Stand", "Tapovan East",
];

function cellOf(lat, lng) {
  let r = Math.floor((lat - BBOX.minLat) / dLat);
  let c = Math.floor((lng - BBOX.minLng) / dLng);
  r = Math.max(0, Math.min(ROWS - 1, r));
  c = Math.max(0, Math.min(COLS - 1, c));
  return `Z-${pad(r * COLS + c + 1, 2)}`;
}

// Operational "hot" anchor (Ramkund) — density falls off from here.
const HOT = { lat: 19.9975, lng: 73.7898 };
function hotWeightedPoint() {
  // bias points toward the hot anchor using a squared random
  const t = rng() ** 2;
  const lat = HOT.lat + (rng() - 0.5) * (BBOX.maxLat - BBOX.minLat) * (0.25 + 0.75 * t);
  const lng = HOT.lng + (rng() - 0.5) * (BBOX.maxLng - BBOX.minLng) * (0.25 + 0.75 * t);
  return {
    lat: Math.max(BBOX.minLat, Math.min(BBOX.maxLat, lat)),
    lng: Math.max(BBOX.minLng, Math.min(BBOX.maxLng, lng)),
  };
}

// ---- reference entities ----
const CENTERS = [
  { name: "Ramkund Khoya-Paya Kendra", lat: 19.9975, lng: 73.7898 },
  { name: "Kapaleshwar Khoya-Paya Kendra", lat: 19.9972, lng: 73.7906 },
  { name: "Panchavati Khoya-Paya Kendra", lat: 20.0083, lng: 73.792 },
  { name: "Tapovan Khoya-Paya Kendra", lat: 20.0186, lng: 73.806 },
  { name: "Sadhugram Khoya-Paya Kendra", lat: 20.025, lng: 73.785 },
  { name: "Dwarka Khoya-Paya Kendra", lat: 20.0, lng: 73.78 },
  { name: "Gangapur Road Khoya-Paya Kendra", lat: 20.012, lng: 73.776 },
  { name: "Nashik Road Khoya-Paya Kendra", lat: 19.946, lng: 73.84 },
  { name: "Trimbakeshwar Khoya-Paya Kendra", lat: 19.932, lng: 73.5302 },
  { name: "Kushavarta Khoya-Paya Kendra", lat: 19.9333, lng: 73.529 },
];

const POLICE = [
  ["Panchavati Police Station", 20.006, 73.7905, "+912532629100"],
  ["Bhadrakali Police Station", 19.9955, 73.789, "+912532505101"],
  ["Sarkarwada Police Station", 19.999, 73.787, "+912532505102"],
  ["Mela Control Room — Ramkund", 19.9978, 73.7902, "100"],
  ["Tapovan Mela Chowki", 20.018, 73.805, "100"],
  ["Sadhugram Police Chowki", 20.0245, 73.7855, "100"],
  ["Gangapur Road Police Station", 20.013, 73.7755, "+912532345110"],
  ["Adgaon Police Station", 20.03, 73.83, "+912532451120"],
  ["Mhasrul Police Chowki", 20.022, 73.78, "100"],
  ["Nashik Road Police Station", 19.945, 73.841, "+912532465130"],
  ["CBS Traffic Chowki", 19.998, 73.785, "100"],
  ["Trimbakeshwar Police Station", 19.9325, 73.531, "+912594233100"],
  ["Kushavarta Mela Chowki", 19.9335, 73.5295, "100"],
  ["Anandvalli Police Chowki", 20.005, 73.77, "100"],
];

const CHOKE_NAMES = [
  "Ahilyabai Holkar Bridge", "Victoria Bridge", "Gadge Maharaj Pul",
  "Ramkund South Gate", "Ramkund North Gate", "Kapaleshwar Steps",
  "Sadhugram Gate 1", "Sadhugram Gate 2", "Sadhugram Gate 3",
  "Panchavati Karanja", "Kala Ram Mandir Gate", "Sita Gufa Junction",
  "Tapovan Sangam", "Nimani Bus Stand", "CBS Junction",
];

// ---- person attribute pools ----
const MALE = ["Ramesh", "Suresh", "Mohan", "Ganpat", "Vitthal", "Shankar", "Arjun", "Kishan", "Babu", "Hari", "Raju", "Dattatray", "Namdev", "Eknath"];
const FEMALE = ["Lakshmi", "Sita", "Radha", "Sunita", "Kamala", "Parvati", "Anjali", "Meena", "Saraswati", "Gauri", "Mangala", "Indu", "Shobha", "Kalpana"];
const CHILD = ["Aarav", "Ananya", "Krish", "Riya", "Soham", "Diya", "Aditya", "Pari", "Vivaan", "Anvi"];
const LANGS = ["Hindi", "Hindi", "Marathi", "Marathi", "Marathi", "Tamil", "Gujarati", "Telugu", "Nepali", "Bengali", "Kannada"];
const AGE_BANDS = ["0-12", "0-12", "18-40", "41-60", "61-70", "61-70", "61-70", "71-80", "71-80", "80+"];
const COLORS = ["blue", "red", "green", "white", "yellow", "orange", "pink", "saffron", "brown", "maroon"];
const FEMALE_WEAR = ["saree", "nauvari saree", "salwar kameez"];
const MALE_WEAR = ["kurta", "dhoti", "shirt and pant", "lungi"];
const CHILD_WEAR = ["t-shirt", "frock", "shorts and shirt", "school uniform"];
const FEATURES = ["wears spectacles", "carries a walking stick", "has grey hair", "is bald", "limps slightly", "has a mole on the cheek", "wears a hearing aid", "has a tilak on forehead", "missing front tooth", "has mehndi on hands", "has a scar above the eyebrow", "wears gold bangles", "has a saffron shawl", "carries a brass lota", "wears rudraksha beads", "has a green tattoo on the arm"];
const LOC_HINTS = ["near Ramkund", "at Kapaleshwar steps", "near Panchavati gate", "at Tapovan sangam", "near the main bridge", "at Sadhugram camp", "near Kala Ram temple", "by the river bank", "at the bus stand", "near Sita Gufa"];

function makePerson(idx) {
  const r = rng();
  let gender, name, ageBand, wear;
  if (r < 0.16) { gender = "child"; ageBand = "0-12"; name = pick(CHILD); wear = pick(CHILD_WEAR); }
  else if (chance(0.5)) { gender = "female"; ageBand = pick(AGE_BANDS.filter(a => a !== "0-12")); name = pick(FEMALE); wear = pick(FEMALE_WEAR); }
  else { gender = "male"; ageBand = pick(AGE_BANDS.filter(a => a !== "0-12")); name = pick(MALE); wear = pick(MALE_WEAR); }
  return {
    truth: `P-${pad(idx, 5)}`,
    gender,
    name,
    ageBand,
    language: pick(LANGS),
    color: pick(COLORS),
    wear,
    feature: pick(FEATURES),
    feature2: pick(FEATURES), // a second distinguishing detail (real reports have these)
  };
}

// Native-script (Devanagari) words so some found reports defeat ASCII keyword search.
const DEVA_COLOR = { blue: "नीला", red: "लाल", green: "हरा", white: "सफेद", yellow: "पीला", orange: "नारंगी", saffron: "भगवा", pink: "गुलाबी", black: "काला", brown: "भूरा", maroon: "मरून" };
const DEVA_WEAR = { saree: "साड़ी", "nauvari saree": "नौवारी साड़ी", "salwar kameez": "सलवार", kurta: "कुर्ता", dhoti: "धोती", "shirt and pant": "कमीज़", lungi: "लुंगी", "t-shirt": "टी-शर्ट", frock: "फ्रॉक", "shorts and shirt": "शॉर्ट्स", "school uniform": "यूनिफॉर्म" };
const DEVA_FEAT = { "wears spectacles": "चश्मा", "carries a walking stick": "लाठी", "has grey hair": "सफेद बाल", "is bald": "गंजा", "has a mole on the cheek": "तिल", "has a tilak on forehead": "तिलक", "has mehndi on hands": "मेहंदी" };
// Synonym swaps that keep meaning but reduce literal word overlap.
const SYN = { saree: "sari", spectacles: "glasses", "walking stick": "cane", "grey hair": "white hair" };
function synonymise(s) { let out = s; for (const [a, b] of Object.entries(SYN)) out = out.replace(a, b); return out; }

// Two overlapping-but-not-identical descriptions of the same person.
// MISSING reports are detailed (family knows them). FOUND reports are realistically
// messy: usually nameless, often sparse, sometimes in the pilgrim's own script.
function describe(p, variant) {
  const base = `${p.color} ${p.wear}, ${p.feature}`;
  const extra = p.feature2 ? `, ${p.feature2}` : "";
  if (variant !== "found") return `${cap(base)}${extra}. Last seen ${pick(LOC_HINTS)}.`;

  const conf = pick(["looks disoriented", "cannot recall the way back", "is crying", "keeps asking for family", "seems confused", "is unable to speak clearly"]);
  const roll = rng();
  if (roll < 0.12) {
    // sparse: a confused found pilgrim — volunteer notes only the clothing colour
    const who = p.gender === "child" ? "child" : p.ageBand === "80+" || p.ageBand === "71-80" ? "elderly person" : "adult";
    return `Unidentified ${who} in ${p.color} clothes, brought to the tent. ${cap(conf)}.`;
  }
  if (roll < 0.34 && DEVA_COLOR[p.color] && DEVA_WEAR[p.wear]) {
    // native-script (Devanagari) — invisible to an ASCII keyword baseline
    const f = DEVA_FEAT[p.feature] ? `, ${DEVA_FEAT[p.feature]}` : "";
    return `${DEVA_COLOR[p.color]} ${DEVA_WEAR[p.wear]}${f}। गुमशुदा हालत में मिले।`;
  }
  if (roll < 0.66) {
    // synonyms / reworded
    return synonymise(`${cap(p.wear)} in ${p.color}; ${p.feature}${extra}. ${cap(conf)}.`);
  }
  return `${cap(p.wear)} in ${p.color}; ${p.feature}${extra}. ${cap(conf)}.`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const mobile = () => "9" + String(Math.floor(rng() * 1e9)).padStart(9, "0");

// ---- timestamps: spread across a live operational window ----
const NOW = Date.now();
const HOUR = 3600e3, DAY = 24 * HOUR;
function recentTs(maxHoursAgo) { return new Date(NOW - rng() * maxHoursAgo * HOUR).toISOString(); }
function olderTs(minDays, maxDays) { return new Date(NOW - (minDays + rng() * (maxDays - minDays)) * DAY).toISOString(); }

// Move a point by up to `meters` in a random direction, clamped to the grid.
// Found pilgrims are recovered near where they wandered from.
function offsetWithin(lat, lng, meters) {
  const r = meters * Math.sqrt(rng());
  const th = rng() * 2 * Math.PI;
  const nlat = lat + (r * Math.sin(th)) / 111320;
  const nlng = lng + (r * Math.cos(th)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return {
    lat: Math.max(BBOX.minLat, Math.min(BBOX.maxLat, nlat)),
    lng: Math.max(BBOX.minLng, Math.min(BBOX.maxLng, nlng)),
  };
}

function priorityOf(ageBand) {
  if (ageBand === "0-12" || ageBand === "80+") return 1;
  if (ageBand === "71-80") return 2;
  return 3;
}

function main() {
  migrate();
  reset();
  const d = db();

  // zones
  const insZone = d.prepare(`INSERT INTO zones (zone_id,name,min_lat,min_lng,max_lat,max_lng,centroid_lat,centroid_lng,cctv_count,chokepoint_count) VALUES (?,?,?,?,?,?,?,?,0,0)`);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const id = `Z-${pad(r * COLS + c + 1, 2)}`;
    const minLat = BBOX.minLat + r * dLat, minLng = BBOX.minLng + c * dLng;
    insZone.run(id, ZONE_NAMES[r * COLS + c], minLat, minLng, minLat + dLat, minLng + dLng, minLat + dLat / 2, minLng + dLng / 2);
  }

  // centers
  const insCenter = d.prepare(`INSERT INTO centers (name,lat,lng,zone_id) VALUES (?,?,?,?)`);
  for (const c of CENTERS) insCenter.run(c.name, c.lat, c.lng, cellOf(c.lat, c.lng));

  // police
  const insPol = d.prepare(`INSERT INTO police (name,lat,lng,phone) VALUES (?,?,?,?)`);
  for (const p of POLICE) insPol.run(p[0], p[1], p[2], p[3]);

  // chokepoints (85) — named ones + generated near the ghats
  const insChoke = d.prepare(`INSERT INTO chokepoints (name,zone_id,lat,lng,risk) VALUES (?,?,?,?,?)`);
  const chokeZoneCount = {};
  for (let i = 0; i < 85; i++) {
    const pt = hotWeightedPoint();
    const name = i < CHOKE_NAMES.length ? CHOKE_NAMES[i] : `${pick(["Gate", "Junction", "Barrier", "Pul", "Crossing"])} ${i + 1}`;
    const z = cellOf(pt.lat, pt.lng);
    insChoke.run(name, z, pt.lat, pt.lng, pick(["high", "high", "medium", "low"]));
    chokeZoneCount[z] = (chokeZoneCount[z] || 0) + 1;
  }

  // cctv (1280)
  const insCctv = d.prepare(`INSERT INTO cctv (zone_id,lat,lng,label) VALUES (?,?,?,?)`);
  const cctvZoneCount = {};
  for (let i = 0; i < 1280; i++) {
    const pt = hotWeightedPoint();
    const z = cellOf(pt.lat, pt.lng);
    insCctv.run(z, pt.lat, pt.lng, `CAM-${pad(i + 1)}`);
    cctvZoneCount[z] = (cctvZoneCount[z] || 0) + 1;
  }
  // roll counts onto zones
  const updZone = d.prepare(`UPDATE zones SET cctv_count=?, chokepoint_count=? WHERE zone_id=?`);
  for (const z of d.prepare(`SELECT zone_id FROM zones`).all())
    updZone.run(cctvZoneCount[z.zone_id] || 0, chokeZoneCount[z.zone_id] || 0, z.zone_id);

  // snan calendar (Nashik Simhastha 2027 principal bathing dates)
  const insSnan = d.prepare(`INSERT INTO snan_days (date,name,surge_factor) VALUES (?,?,?)`);
  for (const s of [
    ["2027-08-08", "Shravan Amavasya (Pithori)", 4.5],
    ["2027-08-26", "First Shahi Snan", 5.0],
    ["2027-09-11", "Second Shahi Snan", 5.0],
    ["2027-09-25", "Third Shahi Snan", 4.0],
  ]) insSnan.run(...s);

  // ---- cases ----
  const insCase = d.prepare(`INSERT INTO cases
    (case_id,report_type,reporting_center,person_name,gender,age_band,language,physical_description,
     last_seen_location,lat,lng,zone_id,reporter_name,reporter_mobile,relation,status,lane,match_score,
     matched_case_id,is_duplicate_report,duplicate_group,priority,reported_at,resolved_at,resolution_hours,truth_person_id,offline)
    VALUES (@case_id,@report_type,@reporting_center,@person_name,@gender,@age_band,@language,@physical_description,
     @last_seen_location,@lat,@lng,@zone_id,@reporter_name,@reporter_mobile,@relation,@status,@lane,@match_score,
     @matched_case_id,@is_duplicate_report,@duplicate_group,@priority,@reported_at,@resolved_at,@resolution_hours,@truth_person_id,@offline)`);

  let seq = 1000;
  const nextId = () => `KYP-${++seq}`;
  const rows = [];
  let personIdx = 1;

  function baseRow(p, type, center) {
    const pt = hotWeightedPoint();
    return {
      case_id: nextId(),
      report_type: type,
      reporting_center: center,
      // found pilgrims usually can't give their name; families always know it
      person_name: (type === "found" ? chance(0.85) : chance(0.15)) ? null : p.name,
      gender: p.gender === "child" ? (chance(0.5) ? "male" : "female") : p.gender,
      age_band: p.ageBand,
      language: p.language,
      physical_description: describe(p, type === "found" ? "found" : "missing"),
      last_seen_location: pick(LOC_HINTS).replace(/^near |^at |^by /, ""),
      lat: pt.lat, lng: pt.lng, zone_id: cellOf(pt.lat, pt.lng),
      reporter_name: type === "missing" ? pick([...MALE, ...FEMALE]) : "Volunteer",
      reporter_mobile: type === "missing" && !chance(0.2) ? mobile() : null,
      relation: type === "missing" ? pick(["son", "daughter", "spouse", "grandson", "neighbour"]) : "found-by-volunteer",
      status: "pending", lane: null, match_score: 0, matched_case_id: null,
      is_duplicate_report: 0, duplicate_group: null,
      priority: priorityOf(p.ageBand),
      reported_at: recentTs(72), resolved_at: null, resolution_hours: null,
      truth_person_id: p.truth, offline: 0,
    };
  }

  // (A) planted cross-center matched pairs: missing@A + found@B (different centers)
  for (let i = 0; i < 200; i++) {
    const p = makePerson(personIdx++);
    let cA = pick(CENTERS).name, cB = pick(CENTERS).name;
    while (cB === cA) cB = pick(CENTERS).name;
    const miss = baseRow(p, "missing", cA);
    const found = baseRow(p, "found", cB);
    // found near where they were last seen (within the age-appropriate wander ring)
    const off = offsetWithin(miss.lat, miss.lng, wanderRadius(p.ageBand));
    found.lat = off.lat; found.lng = off.lng; found.zone_id = cellOf(off.lat, off.lng);
    if (i < 120) {
      // still open — matchable right now (Search → Reunion candidates)
      miss.status = "in_search"; miss.lane = "search";
      found.status = "in_search"; found.lane = "search";
    } else {
      // already reunited historically
      const hrs = +(0.4 + rng() * 3).toFixed(2);
      miss.reported_at = olderTs(1, 20); found.reported_at = miss.reported_at;
      miss.status = found.status = "reunited"; miss.lane = found.lane = "reunion";
      miss.match_score = found.match_score = 80 + Math.floor(rng() * 18);
      miss.matched_case_id = found.case_id; found.matched_case_id = miss.case_id;
      miss.resolved_at = found.resolved_at = new Date(Date.parse(miss.reported_at) + hrs * HOUR).toISOString();
      miss.resolution_hours = found.resolution_hours = hrs;
    }
    rows.push(miss, found);
  }

  // (B) duplicates: same person reported missing at two centers (8%-ish of dataset)
  for (let i = 0; i < 100; i++) {
    const p = makePerson(personIdx++);
    let cA = pick(CENTERS).name, cB = pick(CENTERS).name;
    while (cB === cA) cB = pick(CENTERS).name;
    const grp = `DUP-${pad(i + 1)}`;
    const r1 = baseRow(p, "missing", cA), r2 = baseRow(p, "missing", cB);
    const off = offsetWithin(r1.lat, r1.lng, 500); // same person, near-identical last-seen
    r2.lat = off.lat; r2.lng = off.lng; r2.zone_id = cellOf(off.lat, off.lng);
    r2.physical_description = synonymise(r1.physical_description); // a different relative's words
    if (chance(0.5)) r2.person_name = null;
    r1.is_duplicate_report = 1; r2.is_duplicate_report = 1;
    r1.duplicate_group = grp; r2.duplicate_group = grp;
    if (chance(0.55)) {
      const hrs = +(0.5 + rng() * 4).toFixed(2);
      r1.reported_at = r2.reported_at = olderTs(1, 18);
      r1.status = r2.status = "reunited"; r1.lane = r2.lane = "reunion";
      r1.resolution_hours = r2.resolution_hours = hrs;
      r1.resolved_at = r2.resolved_at = new Date(Date.parse(r1.reported_at) + hrs * HOUR).toISOString();
    } else { r1.status = r2.status = "pending"; }
    rows.push(r1, r2);
  }

  // (C) singletons to fill to 2500
  while (rows.length < 2500) {
    const p = makePerson(personIdx++);
    const type = chance(0.62) ? "missing" : "found";
    const row = baseRow(p, type, pick(CENTERS).name);
    const roll = rng();
    if (roll < 0.68) {
      const hrs = +(0.4 + rng() * 5).toFixed(2);
      row.reported_at = olderTs(1, 22);
      row.status = "reunited"; row.lane = "reunion";
      row.resolution_hours = hrs;
      row.resolved_at = new Date(Date.parse(row.reported_at) + hrs * HOUR).toISOString();
    } else if (roll < 0.94) {
      row.status = type === "found" ? "in_search" : "pending";
      row.lane = "search";
    } else {
      row.status = "unresolved"; row.lane = "search";
      row.reported_at = olderTs(2, 25);
    }
    rows.push(row);
  }

  // a few offline-queued cases for the sync demo
  for (const row of rows) if (row.status !== "reunited" && chance(0.015)) row.offline = 1;

  const tx = d.transaction((rs) => rs.forEach((r) => insCase.run(r)));
  tx(rows.slice(0, 2500));

  // Agent pre-scan: assign a lane to every open case so the live board reflects
  // the matches the agent has already surfaced (some flip to the Reunion Lane).
  const openIds = d.prepare("SELECT case_id FROM cases WHERE status IN ('pending','in_search')").all();
  const scan = d.transaction((ids) => ids.forEach(({ case_id }) => assignLane(getCase(case_id))));
  scan(openIds);

  // ---- CSV exports (organizer-style copies for inspection) ----
  exportCsv("missing_persons.csv", d.prepare(`SELECT case_id,report_type,reporting_center,person_name,gender,age_band,language,physical_description,last_seen_location,lat,lng,zone_id,reporter_mobile,is_duplicate_report,status,reported_at FROM cases`).all());
  exportCsv("zone_boundaries.csv", d.prepare(`SELECT zone_id,name,centroid_lat,centroid_lng,cctv_count,chokepoint_count FROM zones`).all());
  exportCsv("cctv_locations.csv", d.prepare(`SELECT id,zone_id,lat,lng,label FROM cctv`).all());
  exportCsv("chokepoints.csv", d.prepare(`SELECT id,name,zone_id,lat,lng,risk FROM chokepoints`).all());
  exportCsv("police_stations.csv", d.prepare(`SELECT id,name,lat,lng,phone FROM police`).all());

  const c = (q) => d.prepare(q).get().n;
  console.log("✓ Seed complete");
  console.log(`  cases            ${c("SELECT COUNT(*) n FROM cases")}`);
  console.log(`  open (matchable) ${c("SELECT COUNT(*) n FROM cases WHERE status IN ('pending','in_search')")}`);
  console.log(`  reunited         ${c("SELECT COUNT(*) n FROM cases WHERE status='reunited'")}`);
  console.log(`  duplicates       ${c("SELECT COUNT(*) n FROM cases WHERE is_duplicate_report=1")}`);
  console.log(`  offline-queued   ${c("SELECT COUNT(*) n FROM cases WHERE offline=1")}`);
  console.log(`  zones ${c("SELECT COUNT(*) n FROM zones")} · cctv ${c("SELECT COUNT(*) n FROM cctv")} · chokepoints ${c("SELECT COUNT(*) n FROM chokepoints")} · police ${c("SELECT COUNT(*) n FROM police")}`);
  console.log(`  CSV copies → data/`);
}

function exportCsv(name, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  writeFileSync(join(DATA_DIR, name), csv);
}

main();
