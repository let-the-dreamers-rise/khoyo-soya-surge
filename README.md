<div align="center">

# 🪔 Khoya-Paya Surge Engine

### Dual-Lane Reunification Operations for Kumbh Mela 2027

**Claude Impact Lab Mumbai 2026 · Nashik–Trimbakeshwar Simhastha Pilot**

![Node](https://img.shields.io/badge/Node-20%2B-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-OSM%20%2B%20OSRM-199900?logo=leaflet&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-offline--first-5A0FC8?logo=pwa&logoColor=white)
![Claude](https://img.shields.io/badge/Claude-agent-D97757)
![Status](https://img.shields.io/badge/status-runnable-2ea44f)

*One tablet per existing Khoya-Paya tent. No pilgrim app. Works phoneless. Works offline.*

</div>

---

> When a pilgrim is lost, the government doesn't need another app for 80 crore people.
> It needs **one tablet per existing Khoya-Paya tent** that tells volunteers **what to
> announce on the PA**, **where to send search teams**, and **which family to keep
> seated** — especially on snan days when cases spike **4–5×**.

**Khoya-Paya Surge** is a complete, end-to-end reunification platform — not a prototype.
A hardened Express + SQLite backend, a dual-lane decision engine, a Claude-powered intake
agent with a deterministic fallback, an **offline-first Progressive Web App**, a
command-grade officer dashboard, and a **real geospatial dispatch map** (OpenStreetMap
tiles + live OSRM routing) running on actual Nashik–Trimbakeshwar coordinates.

---

## ✨ Why it's different

| 2025 solved | We solve |
|---|---|
| "Find a face on a CCTV feed" | **Fuse 2,500 messy, multilingual, incomplete reports across every center** |
| One dashboard | Two **operable lanes** + a field dispatch map with real routes |
| Smartphone-first | **Phoneless-first** — the PA loudspeaker *is* the notification system |
| Online-only | **Offline-first** — intake never needs network or a SIM |

The hard problem at Kumbh isn't the camera — it's that someone is **found at Trimbakeshwar
while their family waits at Ramkund, and the two lists never talk.** Eight percent of all
reports are the same person logged at two centers. We close that gap in milliseconds.

---

## 🧠 The dual lane — the core engine

Every report at any tent is parsed, fused, scored **against open cases at all 10 centers**, and routed:

```
                                 ┌──────────────────────────────────────────────┐
   voice / tap intake            │             SURGE AGENT                       │
   (any language, phoneless) ───▶│  parse → normalize → cross-center scan → fuse │
                                 └───────────────────┬──────────────────────────┘
                                                     │  confidence 0–100
                       ┌─────────────────────────────┴─────────────────────────────┐
                       ▼                                                             ▼
            ╔══════════════════════╗                                   ╔══════════════════════╗
            ║   REUNION LANE  ≥80  ║                                   ║   SEARCH LANE   <80  ║
            ╠══════════════════════╣                                   ╠══════════════════════╣
            ║ • PA script (lang)   ║                                   ║ • ranked zones (heat)║
            ║ • all-center alert   ║         ◀── lane FLIP ──▶          ║ • dispatch task card ║
            ║ • SMS if mobile      ║      (new report / sync)          ║ • chokepoints + route║
            ║ • human confirms 🪔  ║                                   ║ • nearest police     ║
            ╚══════════════════════╝                                   ╚══════════════════════╝
```

A fresh report or an offline sync can **flip** a case Search → Reunion — that flip *is* the
cross-center value, made visible.

---

## 🏗️ Architecture

A clean, modular backend — **12 domain modules, 28 REST endpoints**, one SQLite source of truth.

```
┌──────────────────────────── CLIENT (PWA) ────────────────────────────┐
│  Volunteer console  ·  Officer dashboard  ·  Service Worker + IndexedDB │
│  Leaflet + OpenStreetMap + OSRM   ·   offline intake queue              │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │  REST / JSON
┌───────────────────────────────┴───────────────────────────────────────┐
│                       EXPRESS API  ( routes/api.js )                    │
├────────────┬───────────┬───────────┬───────────┬───────────┬───────────┤
│   agent    │   match   │   lane    │  reunion  │  search   │    map     │
│ parse+score│ x-center  │  router   │ PA·SMS·   │ zones·task│ geojson·   │
│ (Claude/   │ + dupes   │  + flips  │ confirm   │ ·surge    │ heatmap    │
│  heuristic)│           │           │           │           │            │
├────────────┴───────────┴───────────┴───────────┴───────────┴───────────┤
│   geo (haversine·wander·scoring)  ·  police (OSRM)  ·  sync  ·  bench    │
├────────────────────────────────────────────────────────────────────────┤
│        SQLite registry (WAL)  —  cases · zones · cctv · chokepoints       │
│        · police · centers · snan calendar · broadcasts · tasks · audit    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Feature set

**Backend / engine**
- ⚡ **Sub-10 ms cross-center matching** over the full registry — gender, age band, description
  similarity (with synonym + Devanagari→English canonicalization), geo-proximity, time and name signals.
- 🔁 **Dual-lane router** with automatic Search→Reunion **lane flips** and a full **audit trail**.
- 🧩 **Duplicate auto-linker** (the same person logged at two centers) with N-way grouping.
- 🗣️ **Multilingual PA-script generator** — Hindi, Marathi, Tamil, Gujarati, Telugu + romanized + English.
- 🤖 **Claude-powered intake parsing** of messy/voice/multilingual text, with a **deterministic
  fallback** so the platform runs fully **without any API key**.
- 📊 **Built-in benchmark harness** that scores the agent against a keyword baseline on planted ground truth.
- 🌊 **Surge mode** — snan-calendar aware priority queue (children & elderly first).

**Geospatial**
- 🗺️ **Real dispatch map** — Leaflet over OpenStreetMap, on true Nashik WGS84 coordinates.
- 🧭 **Live road routing** via the public **OSRM** API (real sweep routes, not straight lines).
- 🔥 **Zone-priority heatmap** (32 zones) from a weighted CCTV-density / proximity / chokepoint / age-wander score.
- 🎯 Per-case **last-seen pin + age-based wander ring**, search-first markers, nearest-police routing.

**Frontend**
- 📱 **Offline-first PWA** — service worker app-shell cache + **IndexedDB intake queue**; reports
  captured with no network sync and re-scan on reconnect.
- 🖥️ Two surfaces: a **volunteer console** (registry, intake, lane views, map, surge queue) and a
  **command dashboard** (totals, lane split, center load, live benchmark, live map).
- ♿ WCAG-minded: high contrast, large targets, bilingual labels, full keyboard paths, reduced-motion support.

---

## 📈 Benchmark — agent vs. keyword baseline

`npm run benchmark` — measured on deliberately messy ground truth (found pilgrims are usually
**nameless**, often **sparse** or described in their **own script** — exactly what breaks keyword search).

| Metric | **Surge Agent** | Keyword baseline |
|---|---:|---:|
| Cross-center matches found (120 pairs) | **102** | 74 — **1.4× more** |
| Recall | **85.0 %** | 61.7 % |
| No-name found-person cases | **95 %** | — (no name to match) |
| Duplicate linking | **95.5 %** | 100 %* |
| Confident, auto-reunion-ready | **73.3 %** | — |
| Avg. match latency | **~10 ms / case** | — |

<sub>*duplicates often share a family-given name, so keyword search does well there — the agent's edge is the nameless, cross-lingual cross-center reports.*</sub>

---

## ⚡ Quick start

```bash
git clone https://github.com/let-the-dreamers-rise/khoyo-soya-surge.git
cd khoyo-soya-surge

cp .env.example .env        # optional: add a real sk-ant-... key to enable Claude parsing
npm install
npm run seed                # build the registry + geo data (+ CSV copies in data/)
npm run dev                 # ▶ http://localhost:8000
npm run benchmark           # agent vs baseline → data/metrics.json
```

| Surface | URL |
|---|---|
| 🧑‍🤝‍🧑 Volunteer console | `http://localhost:8000/` |
| 🛰️ Officer dashboard | `http://localhost:8000/dashboard` |
| ❤️ API health | `http://localhost:8000/api/health` |

> Runs **fully without an API key** — the agent uses a deterministic matcher and honestly
> reports `agent: heuristic`. Drop in a valid `ANTHROPIC_API_KEY` and intake parsing upgrades
> to Claude automatically; nothing else changes.

---

## 🔌 API reference (28 endpoints)

```
SYSTEM    GET  /api/health · /api/dashboard-data · /api/metrics
CASES     GET/POST /api/cases · GET /api/cases/:id          → returns lane + broadcast OR task
AGENT     POST /api/intake/parse · POST /api/lane/evaluate · GET /api/lane/:id
REUNION   POST /api/reunion/broadcast · POST /api/reunion/confirm
SEARCH    POST /api/search/task · GET /api/search/rescan/:id · GET /api/search/surge · GET /api/queue
MAP       GET /api/map/geojson · /map/zones · /map/signs · /map/cctv · /heatmap
          GET /api/map/route   (live OSRM)  · GET /api/police/nearest
OPS       POST /api/duplicates/link · POST /api/sync/batch · GET /api/sync/snapshot · GET /api/audit
REF       GET /api/centers · /api/zones
```

```bash
# Intake → lane decision in a single call
curl -X POST localhost:8000/api/cases -H "Content-Type: application/json" -d '{
  "report_type":"missing","reporting_center":"Ramkund Khoya-Paya Kendra",
  "physical_description":"Old man in white dhoti, grey hair, brass lota, cannot recall name",
  "age_band":"80+","language":"Tamil","last_seen_location":"Kapaleshwar steps"}'
```

---

## 🗃️ The registry

Seeded with realistic operational data on **real coordinates**, with planted ground truth so
matching and the benchmark are honest:

| | |
|---|---:|
| Cases (missing + found) | **2,500** |
| Khoya-Paya centers | 10 |
| Search zones | 32 |
| CCTV locations (coverage hints only) | 1,280 |
| Chokepoints / separation hotspots | 85 |
| Police stations | 14 |
| Cross-center duplicate reports | ~8 % |
| Phoneless / no-name cases | 20 % / 15 % |

---

## 📁 Project structure

```
khoyo-soya-surge/
├── server.js              # Express: API + static PWA
├── routes/api.js          # 28 REST endpoints
├── src/                   # 12 domain modules
│   ├── db.js              # SQLite schema + helpers (WAL)
│   ├── seed.js            # realistic data + planted ground truth
│   ├── geo.js             # haversine · wander radius · zone score
│   ├── agent.js           # Claude parse + deterministic scorePair
│   ├── match.js           # cross-center candidates + duplicates
│   ├── lane.js            # dual-lane router + flips
│   ├── reunion.js         # multilingual PA · SMS · confirm
│   ├── search.js          # zone ranking · task cards · surge
│   ├── map.js             # GeoJSON layer builders
│   ├── police.js          # nearest station + OSRM route
│   ├── sync.js            # offline batch + lane flip
│   └── benchmark.js       # agent vs baseline
└── public/                # PWA — index.html · dashboard.html · css · js · sw.js · manifest
```

---

## 🛡️ Design & safety

- **Human confirms every reunion.** The agent proposes; a volunteer decides. Minors get a police-handoff channel.
- **Phoneless-first.** Blank name / blank mobile is the *happy path*, not the error state.
- **No biometrics, no live face scan.** CCTV locations are used only as coverage hints for zone ranking.
- **Auditable.** Every lane assignment, flip, broadcast and reunion is written to an append-only log.
- **Secrets stay local.** `.env`, the database, and generated CSVs are never committed.

---

## 🗺️ Roadmap

- Wire Claude into the *scoring* step (not just parsing) for semantic re-ranking of close calls.
- Optional face-embedding tie-breaker for cases with a photo.
- BHASHINI TTS so PA scripts play automatically; LED-board push API.
- Govt registry sync + multi-district federation.

---

<div align="center">

**Built for India's first Claude Impact Lab · 27 June 2026**
*In partnership with the Kumbhathon Innovation Foundation*

🪔 *No app. No biometrics. One tablet per tent. Nashik 2027 ready.*

</div>
