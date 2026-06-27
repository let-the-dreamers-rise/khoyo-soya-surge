// Geospatial helpers — distances, wander radii, and the zone-priority score.
// Coordinates are real WGS84 lat/lng around the Nashik–Trimbakeshwar Simhastha area.

const R = 6371000; // earth radius, metres
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing in degrees from point 1 to point 2. */
export function bearing(lat1, lng1, lat2, lng2) {
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

// Normalise the dataset's age bands (uses an en-dash) to a search-wander radius.
const WANDER = {
  "0-12": 600,
  "13-17": 1100,
  "18-40": 1500,
  "41-60": 1200,
  "61-70": 900,
  "71-80": 900,
  "80+": 700,
};

const normBand = (b) => (b || "").replace(/[–—]/g, "-").trim();

/** Expected wander radius (metres) for an age band. */
export function wanderRadius(ageBand) {
  return WANDER[normBand(ageBand)] ?? 1000;
}

/**
 * Zone search-priority score (0–100), per the field-ops formula:
 *   0.35 cctv density + 0.30 proximity + 0.20 chokepoints + 0.15 age-wander fit
 * Each term is normalised 0–1 before weighting.
 */
export function zoneScore({ zone, lastSeen, ageBand, maxCctv, maxChoke }) {
  const cctvTerm = maxCctv > 0 ? zone.cctv_count / maxCctv : 0;
  const chokeTerm = maxChoke > 0 ? zone.chokepoint_count / maxChoke : 0;

  let proxTerm = 0.4; // neutral when we have no last-seen fix
  let ageTerm = 0.4;
  if (lastSeen && Number.isFinite(lastSeen.lat)) {
    const dist = haversine(
      lastSeen.lat,
      lastSeen.lng,
      zone.centroid_lat,
      zone.centroid_lng
    );
    // proximity falls off over ~4km
    proxTerm = Math.max(0, 1 - dist / 4000);
    // age-wander fit: peaks when the zone sits within the expected wander ring
    const wr = wanderRadius(ageBand);
    ageTerm = Math.max(0, 1 - Math.abs(dist - wr * 0.6) / (wr * 2));
  }

  const score =
    0.35 * cctvTerm + 0.3 * proxTerm + 0.2 * chokeTerm + 0.15 * ageTerm;
  return Math.round(score * 100);
}

/** RED / ORANGE / YELLOW / GREY bands for a zone score. */
export function zoneColor(score) {
  if (score >= 70) return { band: "RED", color: "#c0392b", action: "Search first" };
  if (score >= 50) return { band: "ORANGE", color: "#d4711a", action: "Search second" };
  if (score >= 30) return { band: "YELLOW", color: "#d9a40a", action: "Search third" };
  return { band: "GREY", color: "#9aa0a6", action: "Skip" };
}

/** A circle approximated as a GeoJSON polygon ring — used for last-seen wander rings. */
export function circlePolygon(lat, lng, radiusM, steps = 48) {
  const coords = [];
  const latR = radiusM / 111320;
  const lngR = radiusM / (111320 * Math.cos(rad(lat)));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    coords.push([lng + lngR * Math.cos(t), lat + latR * Math.sin(t)]);
  }
  return [coords];
}
