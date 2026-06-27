// Officer dashboard — totals, benchmark, lane split, center load, live map.
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cap = (s) => (s || "").charAt(0).toUpperCase() + (s || "").slice(1);
  const ago = (iso) => { const m = Math.max(0, (Date.now() - new Date(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? `${Math.round(m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  const SVG = { match: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 12h8M13 9l3 3-3 3"/></svg>', reunion_confirmed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>', lane_flip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7"/></svg>', broadcast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1Z"/><path d="M16 8a5 5 0 0 1 0 8"/></svg>', intake: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>' };

  $("#menuBtn").onclick = () => { $("#rail").classList.add("open"); $("#scrim").hidden = false; };
  $("#scrim").onclick = () => { $("#rail").classList.remove("open"); $("#scrim").hidden = true; };
  const clock = () => ($("#clock").textContent = new Date().toTimeString().slice(0, 5) + " IST");
  clock(); setInterval(clock, 1000);

  async function load() {
    const [d, metrics] = await Promise.all([API.get("/api/dashboard-data"), API.get("/api/metrics").catch(() => null)]);
    const t = d.totals;
    $("#agentTag").textContent = "agent: " + d.agent;
    $("#surgePill").hidden = !d.surge.active;

    const stats = [
      { k: "Total cases", v: t.cases.toLocaleString() },
      { k: "Open", v: t.open, c: "var(--indigo)" },
      { k: "Reunited", v: t.reunited.toLocaleString(), c: "var(--teal-ink)" },
      { k: "Cross-center dups", v: t.duplicates, c: "var(--saffron-ink)" },
      { k: "Phoneless (PA)", v: t.phoneless },
      { k: "Avg resolution", v: t.avg_resolution_hours + "h" },
    ];
    $("#statStrip").innerHTML = stats.map((s) => `<div class="stat"><span class="k">${s.k}</span><span class="v num" ${s.c ? `style="color:${s.c}"` : ""}>${s.v}</span></div>`).join("");

    // lane split
    const lr = t.reunion_lane, ls = t.search_lane, tot = lr + ls || 1;
    $("#laneSplit").innerHTML = `
      <div class="bar-row" style="grid-template-columns:120px 1fr 52px"><span class="nm">Reunion lane</span><div class="bar-track"><i style="width:${(100 * lr / tot).toFixed(0)}%;background:var(--saffron)"></i></div><span class="vv">${lr}</span></div>
      <div class="bar-row" style="grid-template-columns:120px 1fr 52px;margin-top:10px"><span class="nm">Search lane</span><div class="bar-track"><i style="width:${(100 * ls / tot).toFixed(0)}%;background:var(--indigo)"></i></div><span class="vv">${ls}</span></div>
      <p style="margin-top:14px;color:var(--muted);font-size:.83rem">${d.surge.policy}</p>`;

    // center load
    const max = Math.max(...d.by_center.map((c) => c.n), 1);
    $("#centerLoad").innerHTML = d.by_center.slice(0, 8).map((c) => `
      <div class="center-bar"><span>${esc(c.center.replace(" Khoya-Paya Kendra", ""))}</span><span class="vv mono">${c.n}</span>
      <div class="track"><i style="width:${(100 * c.n / max).toFixed(0)}%"></i></div></div>`).join("");

    // feed
    const txt = { match: "Match proposed", lane_flip: "Lane flip", reunion_confirmed: "Reunion confirmed", broadcast: "Broadcast", intake: "New report", lane_assign: "Lane assigned", search_task: "Team dispatched", sync_upload: "Offline sync" };
    $("#feed").innerHTML = d.activity.slice(0, 9).map((a) => `<li><span class="fi ${a.action}">${SVG[a.action] || SVG.intake}</span><div><p><b>${esc(txt[a.action] || a.action)}</b> — ${esc(a.detail || "")}</p><div class="t">${ago(a.ts + "Z")} · ${esc(a.case_id || "")}</div></div></li>`).join("");

    // benchmark
    if (metrics) renderBench(metrics);
    else $("#bars").innerHTML = '<p style="color:var(--muted);padding:8px 0">Run <span class="mono">npm run benchmark</span> to populate.</p>';
  }

  function renderBench(m) {
    $("#benchSub").textContent = `${m.dataset.matchable_pairs} matchable pairs · ${m.avg_match_time_ms} ms/match`;
    const rows = [
      { nm: "Cross-center recall", a: m.recall.agent_pct, b: m.recall.baseline_pct, unit: "%" },
      { nm: "No-name cases", a: m.no_name_cases.agent_pct, b: 0, unit: "%", note: "baseline can't" },
      { nm: "Duplicate linking", a: m.duplicate_linking.agent_pct, b: m.duplicate_linking.baseline_pct, unit: "%" },
      { nm: "Auto-reunion ready", a: m.confident_auto_reunion_pct, b: 0, unit: "%" },
    ];
    $("#bars").innerHTML = rows.map((r) => `
      <div class="bar-row"><span class="nm">${r.nm}</span>
        <div style="display:flex;flex-direction:column;gap:5px">
          <div class="bar-track" style="height:13px"><i style="width:${r.a}%;background:var(--saffron)"></i></div>
          <div class="bar-track" style="height:13px"><i style="width:${r.b}%;background:var(--line-2)"></i></div>
        </div>
        <span class="vv">${r.a}${r.unit}</span></div>`).join("") +
      `<p style="margin-top:8px;color:var(--muted);font-size:.82rem">Cross-center matches found: <b style="color:var(--ink)">${m.cross_center_matches.agent}</b> vs ${m.cross_center_matches.baseline} baseline (${m.cross_center_matches.multiple}×).</p>`;
  }

  // mini map (overview)
  SurgeMap.init("mapMini");
  SurgeMap.load(null).then(() => { SurgeMap.toggle("cctv", false); setTimeout(() => SurgeMap.invalidate(), 200); });

  load();
  setInterval(load, 20000);
})();
