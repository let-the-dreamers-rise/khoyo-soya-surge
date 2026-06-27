// Nearest police station + REAL road route via the public OSRM API.
// Falls back to a straight-line geometry when offline so the map never breaks.
import { db } from "./db.js";
import { haversine } from "./geo.js";

const OSRM = "https://router.project-osrm.org/route/v1/foot";
const _cache = new Map();

export function nearestPolice(lat, lng) {
  const stations = db().prepare("SELECT * FROM police").all();
  let best = null;
  for (const s of stations) {
    const d = haversine(lat, lng, s.lat, s.lng);
    if (!best || d < best.distance_m) best = { ...s, distance_m: Math.round(d) };
  }
  return best;
}

/**
 * Real walking route between two points. Returns GeoJSON LineString coords
 * ([lng,lat] pairs), distance (m) and duration (s). Cached; degrades gracefully.
 */
export async function route(fromLat, fromLng, toLat, toLng) {
  const key = `${fromLat.toFixed(4)},${fromLng.toFixed(4)};${toLat.toFixed(4)},${toLng.toFixed(4)}`;
  if (_cache.has(key)) return _cache.get(key);

  const straight = {
    source: "straight-line",
    coordinates: [[fromLng, fromLat], [toLng, toLat]],
    distance_m: Math.round(haversine(fromLat, fromLng, toLat, toLng)),
    duration_s: null,
  };

  try {
    const url = `${OSRM}/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const j = await res.json();
      const r = j.routes?.[0];
      if (r) {
        const out = {
          source: "osrm",
          coordinates: r.geometry.coordinates,
          distance_m: Math.round(r.distance),
          duration_s: Math.round(r.duration),
        };
        _cache.set(key, out);
        return out;
      }
    }
  } catch {
    /* offline / timeout → straight line */
  }
  _cache.set(key, straight);
  return straight;
}
