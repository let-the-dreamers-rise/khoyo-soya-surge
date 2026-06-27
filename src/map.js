// GeoJSON builders for the volunteer dispatch map. Real coordinates; Leaflet
// renders these as layers over OpenStreetMap tiles.
import { db } from "./db.js";
import { circlePolygon, wanderRadius } from "./geo.js";
import { rankZones } from "./search.js";
import { nearestPolice } from "./police.js";

const fc = (features) => ({ type: "FeatureCollection", features });
const feat = (geometry, properties) => ({ type: "Feature", geometry, properties });
const point = (lat, lng) => ({ type: "Point", coordinates: [lng, lat] });

function zoneRect(z) {
  return {
    type: "Polygon",
    coordinates: [[
      [z.min_lng, z.min_lat], [z.max_lng, z.min_lat],
      [z.max_lng, z.max_lat], [z.min_lng, z.max_lat], [z.min_lng, z.min_lat],
    ]],
  };
}

/** Zone polygons coloured by search-priority score (case-specific if provided). */
export function zonesGeo(caseRow) {
  return fc(rankZones(caseRow).map((z) =>
    feat(zoneRect(z), {
      layer: "zone", zone_id: z.zone_id, name: z.name,
      score: z.score, band: z.band, color: z.color, action: z.action,
      cctv: z.cctv_count, chokepoints: z.chokepoint_count,
    })
  ));
}

/** Heatmap points (zone centroids with score) for a quick density view. */
export function heatmap(caseRow) {
  return rankZones(caseRow).map((z) => ({
    zone_id: z.zone_id, name: z.name,
    lat: z.centroid_lat, lng: z.centroid_lng,
    score: z.score, band: z.band, color: z.color,
  }));
}

/** Signage overlay: tents, PA points, chokepoints, police, + case-specific signs. */
export function signs(caseRow) {
  const features = [];

  for (const c of db().prepare("SELECT * FROM centers").all()) {
    features.push(feat(point(c.lat, c.lng), { layer: "center", sign: "KHOYA_PAYA_TENT", name: c.name }));
    features.push(feat(point(c.lat, c.lng), { layer: "pa", sign: "PA_POINT", name: c.name }));
  }
  for (const p of db().prepare("SELECT * FROM police").all())
    features.push(feat(point(p.lat, p.lng), { layer: "police", sign: "POLICE", name: p.name, phone: p.phone }));
  for (const k of db().prepare("SELECT * FROM chokepoints").all())
    features.push(feat(point(k.lat, k.lng), { layer: "chokepoint", sign: "CHOKEPOINT", name: k.name, risk: k.risk }));

  if (caseRow && Number.isFinite(caseRow.lat)) {
    features.push(feat(point(caseRow.lat, caseRow.lng), {
      layer: "last_seen", sign: "LAST_SEEN", case_id: caseRow.case_id,
      label: caseRow.last_seen_location, wander_m: wanderRadius(caseRow.age_band),
    }));
    features.push(feat(
      { type: "Polygon", coordinates: circlePolygon(caseRow.lat, caseRow.lng, wanderRadius(caseRow.age_band)) },
      { layer: "wander", sign: "WANDER_RING", case_id: caseRow.case_id }
    ));
    const anchor = db().prepare("SELECT * FROM centers WHERE name=?").get(caseRow.reporting_center);
    if (anchor) features.push(feat(point(anchor.lat, anchor.lng), {
      layer: "anchor", sign: "RECEIPT_ANCHOR", code: caseRow.case_id, name: anchor.name,
    }));

    const top = rankZones(caseRow).slice(0, 3);
    const order = ["SEARCH_FIRST", "SEARCH_SECOND", "SEARCH_THIRD"];
    top.forEach((z, i) => features.push(feat(point(z.centroid_lat, z.centroid_lng), {
      layer: "search_sign", sign: order[i], zone: z.zone_id, name: z.name, score: z.score, color: z.color,
    })));
  }
  return fc(features);
}

/** A sampled set of CCTV points (1,280 is too many to draw individually). */
export function cctvSample(n = 280) {
  const rows = db().prepare("SELECT lat,lng,zone_id,label FROM cctv ORDER BY id").all();
  const step = Math.max(1, Math.floor(rows.length / n));
  return fc(rows.filter((_, i) => i % step === 0).map((c) =>
    feat(point(c.lat, c.lng), { layer: "cctv", sign: "CCTV", zone: c.zone_id, label: c.label })
  ));
}

/** Everything in one FeatureCollection (zones + signs + sampled CCTV). */
export function fullGeo(caseRow) {
  return fc([
    ...zonesGeo(caseRow).features,
    ...cctvSample().features,
    ...signs(caseRow).features,
  ]);
}

/** Suggested sweep route: last-seen → top search zone (real road geometry). */
export async function sweepRoute(caseRow) {
  const { route } = await import("./police.js");
  const top = rankZones(caseRow)[0];
  const r = await route(caseRow.lat, caseRow.lng, top.centroid_lat, top.centroid_lng);
  return feat({ type: "LineString", coordinates: r.coordinates }, {
    layer: "route", sign: "ROUTE", source: r.source,
    distance_m: r.distance_m, duration_s: r.duration_s, to_zone: top.zone_id,
  });
}

export { nearestPolice };
