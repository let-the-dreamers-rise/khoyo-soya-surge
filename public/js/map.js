// Leaflet dispatch map over real OpenStreetMap tiles. Renders the GeoJSON layers
// from /api/map/* — zones (priority-coloured), CCTV, chokepoints, police, tents,
// last-seen + wander ring, and the real OSRM sweep route.
const SurgeMap = (() => {
  let map, groups = {}, onZone = null;
  const NASHIK = [20.006, 73.793];

  const ICON = {
    center: { color: "#0a7d5a", glyph: "⛺" },
    police: { color: "#1f3aa8", glyph: "▣" },
    chokepoint: { color: "#b5651d", glyph: "▲" },
    cctv: { color: "#6b7280", glyph: "" },
    pa: { color: "#8a5a00", glyph: "📢" },
    last_seen: { color: "#c0392b", glyph: "◎" },
    anchor: { color: "#0a7d5a", glyph: "✚" },
    search_sign: { color: "#c0392b", glyph: "" },
  };

  function dot(latlng, layer, props) {
    const i = ICON[layer] || ICON.cctv;
    const big = layer === "center" || layer === "police" || layer === "last_seen" || layer === "anchor" || layer === "search_sign";
    const size = layer === "cctv" ? 5 : big ? 13 : 8;
    return L.circleMarker(latlng, {
      radius: size / 1.6, color: "#fff", weight: layer === "cctv" ? 0.5 : 1.4,
      fillColor: props.color || i.color, fillOpacity: layer === "cctv" ? 0.5 : 0.95,
    });
  }

  function init(elId) {
    map = L.map(elId, { zoomControl: true, attributionControl: true }).setView(NASHIK, 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    for (const k of ["zone", "cctv", "chokepoint", "police", "center", "pa", "last_seen", "wander", "anchor", "search_sign", "route"])
      groups[k] = L.layerGroup().addTo(map);
    return map;
  }

  function clearAll() { for (const k in groups) groups[k].clearLayers(); }

  function renderFeature(f) {
    const p = f.properties || {};
    const layer = p.layer;
    const g = groups[layer];
    if (!g) return;

    if (f.geometry.type === "Polygon") {
      const coords = f.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]);
      if (layer === "zone") {
        const poly = L.polygon(coords, { color: p.color, weight: 1, fillColor: p.color, fillOpacity: 0.32 });
        poly.bindPopup(`<b>${p.name}</b><br>${p.zone_id} · score <b>${p.score}</b> (${p.band})<br>${p.cctv} cams · ${p.chokepoints} chokepoints`);
        poly.on("click", () => onZone && onZone(p));
        g.addLayer(poly);
      } else if (layer === "wander") {
        g.addLayer(L.polygon(coords, { color: "#c0392b", weight: 1, dashArray: "5 5", fill: false }));
      }
      return;
    }
    if (f.geometry.type === "LineString") {
      const coords = f.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      g.addLayer(L.polyline(coords, { color: "#1f3aa8", weight: 4, opacity: 0.8, dashArray: "1 8", lineCap: "round" }));
      return;
    }
    // Point
    const [lng, lat] = f.geometry.coordinates;
    const m = dot([lat, lng], layer, p);
    const title = p.name || p.label || p.sign;
    const sub = p.sign === "SEARCH_FIRST" ? "Search first" : p.sign === "SEARCH_SECOND" ? "Search second" : p.sign === "SEARCH_THIRD" ? "Search third"
      : p.risk ? `${p.risk}-risk chokepoint` : p.phone ? p.phone : p.sign?.replace(/_/g, " ").toLowerCase();
    if (layer !== "cctv") m.bindPopup(`<b>${title || ""}</b>${sub ? "<br>" + sub : ""}`);
    g.addLayer(m);
  }

  async function load(caseId) {
    clearAll();
    const url = caseId ? `/api/map/geojson?case_id=${caseId}` : "/api/map/geojson";
    const fc = await fetch(url).then((r) => r.json());
    fc.features.forEach(renderFeature);
    // fit to case context or whole grid
    if (caseId) {
      try {
        const r = await fetch(`/api/map/route?case_id=${caseId}`).then((x) => x.json());
        renderFeature(r);
      } catch {}
      const ls = fc.features.find((f) => f.properties.layer === "last_seen");
      if (ls) map.setView([ls.geometry.coordinates[1], ls.geometry.coordinates[0]], 15);
    } else {
      map.setView(NASHIK, 14);
    }
  }

  function toggle(layer, on) { if (groups[layer]) (on ? map.addLayer(groups[layer]) : map.removeLayer(groups[layer])); }
  function setZoneHandler(fn) { onZone = fn; }
  function invalidate() { map && map.invalidateSize(); }

  return { init, load, toggle, setZoneHandler, invalidate };
})();
