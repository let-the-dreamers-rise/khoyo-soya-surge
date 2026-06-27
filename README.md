# Khoya-Paya Surge Engine

### Dual-Lane Reunification Operations for Kumbh Mela 2027
**Claude Impact Lab Mumbai 2026 · Nashik–Trimbakeshwar Simhastha Pilot**

> When a pilgrim is lost, the government doesn't need another app for 80 crore people.
> It needs **one tablet per existing Khoya-Paya tent** that tells volunteers **what to
> announce on the PA**, **where to send search teams**, and **which family to keep
> seated** — especially on snan days when cases spike 4–5×.

A complete, runnable full-stack system: Express + SQLite backend, a dual-lane Claude
agent (with a deterministic fallback so it runs without a key), an offline-first PWA
volunteer console, an officer dashboard, and a **real map** (OpenStreetMap tiles +
OSRM routing) over actual Nashik coordinates.

---

## What's in the box

| Layer | Built with |
|---|---|
| API + server | Node 20+, Express, REST |
| Registry | SQLite (`better-sqlite3`), WAL |
| Agent | Claude (Anthropic SDK) **or** a deterministic heuristic fallback |
| Map | Leaflet · OpenStreetMap tiles · **OSRM** real routing |
| Frontend | Vanilla PWA (service worker + IndexedDB offline queue) |
| Data | 2,500 synthetic cases · 32 zones · 1,280 CCTV · 85 chokepoints · 14 police — real WGS84 coords |

---

## Core idea — the dual lane

Every new report at any tent is parsed, fused, and scanned **across all centers**, then routed:

```
                 ┌─ score ≥ 80 ──▶  REUNION LANE  → PA script + SMS + all-center alert → human confirm
new report ─▶ agent
                 └─ score < 80 ──▶  SEARCH LANE   → ranked zones + dispatch task card + police route
```

A new report or an offline sync can **flip** a case Search → Reunion — which is exactly
where the cross-center value shows up.

---

## Quick start

```bash
cd khoya-paya-surge
cp .env.example .env        # optional: add a real sk-ant-... key for Claude parsing
npm install
npm run seed                # generate registry + geo + CSV copies in data/
npm run dev                 # http://localhost:8000
npm run benchmark           # agent vs keyword baseline → data/metrics.json
```

- **Volunteer console** → `http://localhost:8000/`
- **Officer dashboard** → `http://localhost:8000/dashboard`
- **API health** → `http://localhost:8000/api/health`

Runs fully **without an API key** (the agent uses a deterministic matcher). Set a valid
`ANTHROPIC_API_KEY` to upgrade intake parsing to Claude; everything else is unchanged.

---

## Benchmark — agent vs. keyword baseline

Measured on the seeded ground truth (`npm run benchmark`). The data is deliberately
messy: found pilgrims are usually **nameless**, often described **sparsely** or in the
**pilgrim's own script** — exactly what defeats keyword search.

| Metric | Agent | Keyword baseline |
|---|---|---|
| Cross-center matches found (120 pairs) | **102** | 74 (**1.4×**) |
| Recall | **85.0%** | 61.7% |
| No-name found-person cases | **95%** | — (no name to match on) |
| Duplicate linking | 95.5% | 100% (duplicates share a name) |
| Confident auto-reunion-ready | 73.3% | — |
| Avg. match time | **~10 ms / case** | — |

The agent's edge is everything keyword search drops: nameless reports, synonyms
(*sari↔saree, glasses↔spectacles*), Devanagari descriptions linked to English ones, and
spatial + age-band reasoning.

---

## API

System: `GET /api/health` · `GET /api/dashboard-data` · `GET /api/metrics`
Cases: `GET/POST /api/cases` · `GET /api/cases/:id` (returns lane + broadcast **or** task)
Agent: `POST /api/intake/parse` · `POST /api/lane/evaluate` · `GET /api/lane/:id`
Reunion: `POST /api/reunion/broadcast` · `POST /api/reunion/confirm`
Search: `POST /api/search/task` · `GET /api/search/rescan/:id` · `GET /api/search/surge` · `GET /api/queue`
Map: `GET /api/map/geojson` · `/api/map/zones` · `/api/map/signs` · `/api/heatmap` · `/api/map/route` (OSRM) · `/api/police/nearest`
Other: `POST /api/duplicates/link` · `POST /api/sync/batch` · `GET /api/sync/snapshot` · `GET /api/audit`

```bash
# intake → lane in one call
curl -X POST localhost:8000/api/cases -H "Content-Type: application/json" -d '{
  "report_type":"missing","reporting_center":"Ramkund Khoya-Paya Kendra",
  "physical_description":"Old man in white dhoti, grey hair, brass lota, cannot recall name",
  "age_band":"80+","language":"Tamil","last_seen_location":"Kapaleshwar steps"}'
```

---

## Project structure

```
khoya-paya-surge/
├── server.js              # Express: API + static PWA
├── routes/api.js          # all REST endpoints
├── src/
│   ├── db.js              # SQLite schema + helpers
│   ├── seed.js            # realistic data w/ planted ground truth
│   ├── geo.js             # haversine, wander radius, zone score
│   ├── agent.js           # Claude parse + deterministic scorePair
│   ├── match.js           # cross-center candidates + duplicates
│   ├── lane.js            # dual-lane router + flips
│   ├── reunion.js         # multilingual PA, SMS, confirm
│   ├── search.js          # zone ranking, task cards, surge
│   ├── map.js             # GeoJSON layer builders
│   ├── police.js          # nearest station + OSRM route
│   ├── sync.js            # offline batch + lane flip
│   └── benchmark.js       # agent vs baseline
└── public/                # PWA: index.html (console), dashboard.html, css/js, sw.js, manifest
```

---

## Design & safety notes

- **Human confirms every reunion.** The agent proposes; a volunteer decides. Minors get a police-handoff channel.
- **Phoneless-first.** Blank name / blank mobile is the happy path; the PA loudspeaker is the notification system.
- **Offline-first.** Intake saves to IndexedDB with no network; the queue syncs and re-scans on reconnect.
- **No biometrics, no live face scan.** CCTV locations are used only as coverage hints for zone ranking.

*Built for India's first Claude Impact Lab · 27 June 2026.*
