// Volunteer console controller — wires the dual-lane flow to the Surge API.
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const state = { lang: "Hindi", center: null, case: null, mapReady: false };

  const SVG = {
    match: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 12h8M13 9l3 3-3 3"/></svg>',
    reunion_confirmed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>',
    lane_flip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7"/></svg>',
    broadcast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1Z"/><path d="M16 8a5 5 0 0 1 0 8"/></svg>',
    intake: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    tick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 3v18M3 12h18"/></svg>',
  };
  const cap = (s) => (s || "").charAt(0).toUpperCase() + (s || "").slice(1);
  const ago = (iso) => {
    const m = Math.max(0, (Date.now() - new Date(iso)) / 60000);
    return m < 1 ? "just now" : m < 60 ? `${Math.round(m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  };

  // ---- toast ----
  let toastTimer;
  function toast(html, kind = "ok") {
    const t = $("#toast");
    t.className = "toast " + kind;
    $("#toastMsg").innerHTML = html;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 4200);
  }

  // ---- nav ----
  function nav(view) {
    $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
    const titles = {
      registry: ["Live registry", "All open cases across every Khoya-Paya center"],
      report: ["New report", "Voice or tap — works fully offline"],
      case: ["Case", "Dual-lane decision"],
      map: ["Dispatch map", "Where to look first — real coordinates, live routing"],
      queue: ["Surge queue", "Priority order during snan-day spikes"],
    };
    if (titles[view]) { $("#pageTitle").textContent = titles[view][0]; $("#pageSub").textContent = titles[view][1]; }
    closeRail();
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    if (view === "map") openMap();
    if (view === "queue") loadQueue();
  }
  function bindNav() {
    $$("[data-view]").forEach((b) => { if (b.tagName !== "A") b.addEventListener("click", () => nav(b.dataset.view)); });
  }
  const openRail = () => { $("#rail").classList.add("open"); $("#scrim").hidden = false; };
  const closeRail = () => { $("#rail").classList.remove("open"); $("#scrim").hidden = true; };

  // ---- boot ----
  async function boot() {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    bindNav();
    $("#menuBtn").onclick = openRail; $("#scrim").onclick = closeRail;
    clock();
    bindLang(); bindOffline(); bindIntake();
    await loadCenters();
    await loadZones();
    await refresh();
    setInterval(refresh, 20000);
    setInterval(clock, 1000);
    route(); window.addEventListener("hashchange", route);
  }
  function route() {
    const h = location.hash.slice(1);
    if (!h) return;
    if (h.startsWith("case/")) openCase(h.slice(5));
    else if (h.startsWith("map/")) { nav("map"); openMap(h.slice(4)); }
    else if (["report", "map", "queue", "registry"].includes(h)) nav(h);
  }

  function clock() {
    const d = new Date();
    $("#clock").textContent = d.toTimeString().slice(0, 5) + " IST";
  }

  async function loadCenters() {
    const centers = await API.get("/api/centers");
    state.center = centers[0]?.name;
    $("#centerSelect").innerHTML = centers.map((c) => `<option>${esc(c.name)}</option>`).join("");
    $("#centerSelect").onchange = (e) => (state.center = e.target.value);
  }
  async function loadZones() {
    const z = await API.get("/api/zones");
    $("#f-zone").innerHTML = '<option value="">Auto</option>' + z.map((x) => `<option value="${x.zone_id}">${x.zone_id} · ${esc(x.name)}</option>`).join("");
  }

  // ---- dashboard / registry refresh ----
  async function refresh() {
    const [d, cases] = await Promise.all([
      API.get("/api/dashboard-data"),
      API.get("/api/cases?status=pending,in_search,matched&limit=40"),
    ]);
    renderStats(d); renderFeed(d); renderRegistry(cases); renderBanner(cases);
    $("#agentMode").textContent = "agent: " + d.agent;
    $("#navOpen").textContent = d.totals.open;
    $("#reuToday").textContent = d.totals.reunited_today;
    $("#surgePill").hidden = !d.surge.active;
    const q = await API.get("/api/queue?limit=1").catch(() => []);
    $("#navQueue").textContent = d.totals.search_lane;
  }

  function renderStats(d) {
    const t = d.totals;
    const cards = [
      { k: "Open cases", v: t.open, sub: "across all centers", svg: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>' },
      { k: "Reunion lane", v: t.reunion_lane, sub: "match proposed", cls: "var(--saffron-ink)", svg: '<path d="M8 12h8M13 9l3 3-3 3"/>' },
      { k: "Search lane", v: t.search_lane, sub: "teams deployed", cls: "var(--indigo)", svg: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/>' },
      { k: "Reunited today", v: t.reunited_today, sub: "human-confirmed", cls: "var(--teal-ink)", svg: '<path d="M20 6 9 17l-5-5"/>' },
      { k: "Phoneless", v: t.phoneless, sub: "PA-broadcast path", svg: '<path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1Z"/><path d="M16 8a5 5 0 0 1 0 8"/>' },
      { k: "Avg resolution", v: t.avg_resolution_hours + "h", sub: "report → reunion", svg: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>' },
    ];
    $("#statStrip").innerHTML = cards.map((c) => `
      <div class="stat"><span class="k"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${c.svg}</svg> ${c.k}</span>
      <span class="v num" ${c.cls ? `style="color:${c.cls}"` : ""}>${c.v}</span><span class="delta flat">${c.sub}</span></div>`).join("");
  }

  function renderFeed(d) {
    const txt = { match: "Cross-center match proposed", lane_flip: "Lane flip", reunion_confirmed: "Reunion confirmed", broadcast: "Broadcast sent", intake: "New report filed", lane_assign: "Lane assigned", search_task: "Search team dispatched", sync_upload: "Synced from offline queue" };
    $("#feed").innerHTML = d.activity.slice(0, 8).map((a) => `
      <li><span class="fi ${a.action}">${SVG[a.action] || SVG.intake}</span>
      <div><p><b>${esc(txt[a.action] || a.action)}</b> — ${esc(a.detail || "")}</p><div class="t">${ago(a.ts + "Z")} · ${esc(a.case_id || "")}</div></div></li>`).join("");
  }

  function laneChip(lane) { return lane ? `<span class="chip ${lane}">${cap(lane)}</span>` : "—"; }
  function renderRegistry(cases) {
    $("#regBody").innerHTML = cases.map((c) => `
      <tr data-id="${c.case_id}">
        <td><span class="who deva">${esc(c.person_name || (c.report_type === "found" ? "Unidentified" : "Unnamed"))} ${c.age_band ? "· " + c.age_band : ""}<small>${esc((c.physical_description || "").slice(0, 46))} · <span class="id">#${c.case_id}</span></small></span></td>
        <td class="ctr">${esc(c.reporting_center.replace(" Khoya-Paya Kendra", ""))}</td>
        <td><span class="chip ${c.report_type === "found" ? "found" : "in_search"}">${c.report_type === "found" ? "Found" : "Missing"}</span></td>
        <td>${laneChip(c.lane)}</td>
        <td><span class="chip ${c.status}"><span class="d"></span>${cap(c.status.replace("_", " "))}</span></td>
        <td style="text-align:right"><span class="conf ${c.match_score >= 80 ? "hi" : "lo"}">${c.match_score ? c.match_score + "%" : "—"}</span></td>
      </tr>`).join("");
    $$("#regBody tr").forEach((tr) => (tr.onclick = () => openCase(tr.dataset.id)));
  }

  function renderBanner(cases) {
    const m = cases.find((c) => c.status === "matched" && c.match_score >= 80);
    const el = $("#alertBanner");
    if (!m) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="alert-banner"><span class="live"><span class="d"></span> MATCH</span>
      <div class="body"><b>Cross-center match surfaced — ${m.match_score}% confidence</b>
      <p>${esc(m.report_type)} report <span class="mono">#${m.case_id}</span> at ${esc(m.reporting_center.replace(" Khoya-Paya Kendra", ""))} matches an open case at another center. ${m.reporter_mobile ? "Family reachable by SMS." : "Family phoneless — PA broadcast ready."}</p></div>
      <button class="btn primary" id="bannerBtn">Review match →</button></div>`;
    $("#bannerBtn").onclick = () => openCase(m.case_id);
  }

  // ---- language ----
  function bindLang() {
    $$(".langset button").forEach((b) => (b.onclick = () => {
      $$(".langset button").forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true"); state.lang = b.dataset.lang;
      $("#f-lang").value = b.dataset.lang;
    }));
  }

  // ---- offline ----
  function bindOffline() {
    const apply = (off) => {
      $("#conn").classList.toggle("off", off);
      $("#connTxt").textContent = off ? "Offline · queued locally" : "Synced · all centers";
      $("#connToggle").textContent = off ? "Reconnect" : "Go offline";
    };
    $("#connToggle").onclick = async () => {
      API.online = !API.online;
      apply(!API.online);
      if (API.online) {
        const res = await API.flush();
        if (res.uploaded) toast(`<b>Synced ${res.uploaded} queued report${res.uploaded > 1 ? "s" : ""}</b> <span>· ${res.lane_flips} flipped to reunion</span>`, res.lane_flips ? "ok" : "info");
        refresh();
      }
    };
    document.addEventListener("net:offline", () => apply(true));
    document.addEventListener("net:online", () => apply(false));
  }

  // ---- intake ----
  const SAMPLES = {
    Hindi: "मेरी माँ खो गई है, उम्र करीब सत्तर, नीली साड़ी, चश्मा लगाती हैं, राम कुंड के पास बिछड़ीं।",
    Marathi: "माझी आई हरवली आहे, वय सत्तर, निळी साडी, चष्मा, रामकुंड जवळ हरवली.",
    Tamil: "என் தாயை காணவில்லை, வயது எழுபது, நீலச் சேலை, கண்ணாடி, ராம்குண்ட் அருகில்.",
    English: "My mother is missing, around seventy, blue saree, wears spectacles, last seen near Ramkund.",
  };
  function bindIntake() {
    const mic = $("#mic"); let busy = false;
    mic.onclick = async () => {
      if (busy) return; busy = true; mic.classList.add("rec");
      $("#micState").textContent = "Listening… सुन रहे हैं";
      const text = SAMPLES[state.lang] || SAMPLES.English;
      await new Promise((r) => setTimeout(r, reduce ? 200 : 1500));
      $("#micState").textContent = "Understanding…";
      try {
        const p = await API.post("/api/intake/parse", { text, language: state.lang });
        $("#f-desc").value = p.physical_description || text; flash("#f-desc");
        if (p.age_band) $("#f-age").value = p.age_band;
        if (p.gender) $("#f-gender").value = p.gender;
        if (p.last_seen_location) { $("#f-last").value = p.last_seen_location; flash("#f-last"); }
        $("#f-lang").value = state.lang;
        $("#parseFlag").querySelector("span").textContent = p._engine === "claude"
          ? "Claude understood the report and filled the fields — review, fix, then run the match."
          : "Parsed the report and filled the fields — review, fix, then run the match.";
        $("#parseFlag").classList.add("show");
      } catch (e) { $("#f-desc").value = text; }
      mic.classList.remove("rec"); $("#micState").textContent = "Understood ✓"; busy = false;
    };
    $("#reportForm").onsubmit = onSubmit;
  }
  const flash = (sel) => { const f = $(sel).closest(".field"); f.classList.add("filled"); setTimeout(() => f.classList.remove("filled"), 1400); };

  async function onSubmit(e) {
    e.preventDefault();
    const btn = $("#submitBtn"); const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Matching across all centers…';
    const record = {
      report_type: $("#f-type").value,
      reporting_center: state.center,
      gender: $("#f-gender").value || null,
      age_band: $("#f-age").value || null,
      language: $("#f-lang").value,
      physical_description: $("#f-desc").value,
      last_seen_location: $("#f-last").value || null,
      zone_id: $("#f-zone").value || null,
      reporter_mobile: $("#f-mobile").value || null,
    };
    try {
      const res = await API.createCase(record);
      if (res.mode === "queued") {
        toast(`<b>Saved offline</b> <span>· ${res.queued} report${res.queued > 1 ? "s" : ""} queued — will sync on reconnect</span>`, "warn");
        nav("registry");
      } else {
        $("#parseFlag").classList.remove("show");
        $("#reportForm").reset(); $("#f-age").value = "61-70";
        await refresh();
        openCase(res.case_id);
      }
    } catch (err) { toast(`<b>Error</b> <span>· ${esc(err.message)}</span>`, "warn"); }
    btn.disabled = false; btn.innerHTML = orig;
  }

  // ---- case / lane ----
  function ringSVG(pct, color = "var(--saffron)") {
    const C = 314.16, off = C * (1 - pct / 100);
    return `<div class="ring"><svg width="108" height="108" viewBox="0 0 108 108"><circle cx="54" cy="54" r="50" fill="none" stroke="var(--surface-3)" stroke-width="9"/><circle cx="54" cy="54" r="50" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${off}" style="animation:ringfill .9s var(--ease)"/></svg><div class="lbl"><b>${pct}</b><span>match</span></div></div>`;
  }
  function reasonRows(reasons) {
    return reasons.map((r) => `<div class="reason"><span class="ic ${r.ok ? "" : "warn"}">${r.ok ? SVG.tick : SVG.cross}</span><p>${esc(r.text)}</p><div class="meter"><i style="width:${r.w}%;animation:meterfill .9s var(--ease)"></i></div></div>`).join("");
  }

  async function openCase(id) {
    nav("case");
    $("#caseBody").innerHTML = '<div class="loading-row"><span class="spinner"></span> Loading case…</div>';
    const data = await API.get("/api/cases/" + id);
    state.case = data;
    const c = data.case, ev = data.evaluation;
    $("#caseId").textContent = "#" + c.case_id;
    $("#caseTitle").textContent = (c.person_name || (c.report_type === "found" ? "Unidentified person" : "Missing person")) + (c.age_band ? " · " + c.age_band : "");
    const tag = $("#caseLaneTag"); tag.className = "lane-tag " + ev.lane; tag.textContent = ev.lane + " lane";
    if (ev.lane === "reunion" && data.broadcast) renderReunion(c, ev, data.broadcast);
    else renderSearch(c, ev, data.task);
  }

  function renderReunion(c, ev, b) {
    const best = ev.best;
    $("#caseBody").innerHTML = `
      <div class="lane-grid">
        <div class="panel">
          <div class="ring-row">${ringSVG(ev.match_score)}
            <div class="who-block"><h3 class="deva">${esc(best.person_name || "Unidentified")} ${best.age_band ? "· " + best.age_band : ""}</h3>
            <p class="desc">${esc(best.physical_description)}</p>
            <span class="cross"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg> ${best.report_type === "found" ? "Found at" : "Reported at"} ${esc(best.reporting_center.replace(" Khoya-Paya Kendra", ""))} · case <b>#${best.case_id}</b></span></div>
          </div>
          <div class="reasons"><div class="lab">Why the agent matched these · मिलान के कारण</div>${reasonRows(best.reasons)}</div>
          <div class="decide"><button class="btn ok" id="confirmBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5"/></svg> Confirm reunion · यही हैं</button>
          <button class="btn ghost" id="rejectBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6 6 18M6 6l12 12"/></svg> Not a match</button></div>
        </div>
        <div class="panel pa-card">
          <h3>${SVG.broadcast} Broadcast plan <span class="lane-tag reunion" style="margin-left:auto">on confirm</span></h3>
          ${b.channels.map((ch) => `<div class="channel ${ch.status}"><span class="ci">${chIcon(ch.id)}</span><div><b>${esc(ch.label)}</b><small>${esc(ch.note || "")}</small></div><span class="st">${esc(cap(ch.status))}</span></div>`).join("")}
          <div class="pa-box"><div class="lab">${SVG.broadcast} PA script · ${esc(b.pa_language)}</div>
          <p class="${b.pa_language === "Tamil" ? "tamil" : "deva"}">${esc(b.pa_script)}</p><p class="en">${esc(b.pa_script_english)}</p></div>
          <p style="font-size:.8rem;color:var(--muted);margin-top:10px">${esc(b.handoff)}</p>
        </div>
      </div>`;

    $("#rejectBtn").onclick = () => { toast("<b>Match rejected</b> <span>· returned to search lane</span>", "info"); nav("registry"); };
    $("#confirmBtn").onclick = () => confirmModal(c, ev.best, b);
  }

  function chIcon(id) {
    return { pa: SVG.broadcast, centers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16"/></svg>', sms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>', police: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 4 6v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V6z"/></svg>' }[id] || SVG.broadcast;
  }

  function renderSearch(c, ev, task) {
    const best = ev.best;
    const zoneRow = (z, i) => `<div class="zone-pill"><span class="badge" style="background:${z.color}">${z.score}</span><div><b>${esc(z.name)}</b><small>${z.zone_id} · ${z.band}</small></div><span class="rank">#${i + 1}</span></div>`;
    $("#caseBody").innerHTML = `
      <div class="lane-grid search-mode">
        <div class="panel task-card">
          <div class="lab">Search-first zones · खोज क्षेत्र</div>
          <div class="zone-pills">${(task.top_zones || []).map(zoneRow).join("")}</div>
          <div class="lab">Volunteer task card · अगले कदम</div>
          <ol class="steps">${task.next_steps.map((s, i) => `<li><span class="n">${i + 1}</span><span>${esc(s)}</span></li>`).join("")}</ol>
          <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">
            <button class="btn primary" id="openMapBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/></svg> Open on dispatch map</button>
            <button class="btn" id="rescanBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg> Re-scan</button>
          </div>
        </div>
        <div class="panel" style="padding:20px">
          ${best && best.score >= 50 ? `
            <h3 style="font-size:1rem;margin-bottom:4px">Best candidate — needs review</h3>
            <p style="color:var(--muted);font-size:.84rem;margin-bottom:14px">Below the ${ev.threshold.match}% auto-broadcast bar; a volunteer should verify.</p>
            <div class="ring-row" style="padding:0 0 16px;border:0">${ringSVG(best.score, "var(--amber)")}
              <div class="who-block"><h3 class="deva" style="font-size:1.1rem">${esc(best.person_name || "Unidentified")}</h3><p class="desc" style="font-size:.86rem">${esc(best.physical_description)}</p>
              <span class="cross" style="background:var(--amber-wash);border-color:oklch(0.86 0.08 80);color:var(--amber-ink)">${esc(best.reporting_center.replace(" Khoya-Paya Kendra",""))} · <b>#${best.case_id}</b></span></div></div>
            <button class="btn go" id="promoteBtn" style="width:100%"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg> Verify & open reunion</button>
          ` : `
            <div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><h3>No match yet</h3><p>Search teams deployed. The agent re-scans every new report — this case will flip to the reunion lane automatically when a match arrives.</p></div>
            <div style="padding:0 4px"><div class="lab" style="margin-bottom:8px">Family anchor</div><p style="font-size:.88rem"><b>${esc(task.family_anchor.replace(" Khoya-Paya Kendra",""))}</b> — keep family seated here, receipt <span class="mono">#${c.case_id}</span>.</p>
            ${task.nearest_police ? `<div class="lab" style="margin:14px 0 8px">Nearest police</div><p style="font-size:.88rem">${esc(task.nearest_police.name)} · ${(task.nearest_police.distance_m/1000).toFixed(1)} km · <span class="mono">${esc(task.nearest_police.phone)}</span></p>` : ""}</div>
          `}
        </div>
      </div>`;

    $("#openMapBtn").onclick = () => { nav("map"); openMap(c.case_id); };
    $("#rescanBtn").onclick = async () => {
      const r = await API.get("/api/search/rescan/" + c.case_id);
      if (r.lane === "reunion") { toast("<b>Lane flip!</b> <span>· match found — moved to reunion lane</span>"); openCase(c.case_id); }
      else toast("<b>Re-scanned</b> <span>· still searching, no match yet</span>", "info");
      refresh();
    };
    const pb = $("#promoteBtn"); if (pb) pb.onclick = async () => {
      const plan = await API.post("/api/reunion/broadcast", { case_id: c.case_id, matched_case_id: best.case_id });
      confirmModal(c, best, plan);
    };
  }

  // ---- confirm modal ----
  let lastFocus;
  function confirmModal(c, best, b) {
    lastFocus = document.activeElement;
    $("#modal").innerHTML = `
      <div class="modal-h"><div class="seal b">${SVG.broadcast}</div><div><h3 id="modalTitle">Confirm reunion & broadcast</h3><p>Human-confirmed — the agent never reunites on its own.</p></div></div>
      <div class="modal-b">
        ${b.channels.map((ch) => `<div class="channel ${ch.status}"><span class="ci">${chIcon(ch.id)}</span><div><b>${esc(ch.label)}</b><small>${esc(ch.note || "")}</small></div><span class="st">${esc(cap(ch.status))}</span></div>`).join("")}
        <div class="pa-box"><div class="lab">PA script · ${esc(b.pa_language)}</div><p class="${b.pa_language === "Tamil" ? "tamil" : "deva"}">${esc(b.pa_script)}</p><p class="en">${esc(b.pa_script_english)}</p></div>
      </div>
      <div class="modal-f"><button class="btn ghost" id="mCancel">Cancel</button><button class="btn ok" id="mConfirm">${SVG.broadcast} Broadcast & mark reunited</button></div>`;
    $("#backdrop").classList.add("show");
    $("#mConfirm").focus();
    $("#mCancel").onclick = closeModal;
    $("#mConfirm").onclick = async () => {
      $("#mConfirm").disabled = true; $("#mConfirm").innerHTML = '<span class="spinner"></span> Broadcasting…';
      const res = await API.post("/api/reunion/confirm", { case_id: c.case_id, matched_case_id: best.case_id, actor: "V. Pawar" });
      closeModal();
      toast(`<b>Reunion confirmed 🪔</b> <span>· #${res.reunited[0]} ↔ #${res.reunited[1]} · ${res.resolution_hours}h</span>`);
      await refresh(); nav("registry");
    };
  }
  function closeModal() { $("#backdrop").classList.remove("show"); lastFocus && lastFocus.focus(); }
  $("#backdrop").addEventListener("click", (e) => { if (e.target.id === "backdrop") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // ---- map ----
  const LAYERS = [
    { id: "zone", label: "Priority zones", on: true, sw: "#c0392b" },
    { id: "search_sign", label: "Search-first markers", on: true, sw: "#c0392b" },
    { id: "chokepoint", label: "Chokepoints", on: true, sw: "#b5651d" },
    { id: "police", label: "Police stations", on: true, sw: "#1f3aa8" },
    { id: "center", label: "Khoya-Paya tents", on: true, sw: "#0a7d5a" },
    { id: "cctv", label: "CCTV coverage", on: false, sw: "#6b7280" },
    { id: "last_seen", label: "Last seen + wander", on: true, sw: "#c0392b" },
    { id: "route", label: "Sweep route", on: true, sw: "#1f3aa8" },
  ];
  function buildLayerControls() {
    $("#layers").innerHTML = LAYERS.map((l) => `<label class="layer-row"><input type="checkbox" data-layer="${l.id}" ${l.on ? "checked" : ""}><span class="sw" style="background:${l.sw}"></span> ${l.label}</label>`).join("");
    $$('#layers input').forEach((i) => (i.onchange = () => { SurgeMap.toggle(i.dataset.layer, i.checked); if (i.dataset.layer === "last_seen") SurgeMap.toggle("wander", i.checked); }));
  }
  async function openMap(caseId) {
    if (!state.mapReady) {
      SurgeMap.init("map"); buildLayerControls();
      SurgeMap.setZoneHandler(showZoneInfo);
      state.mapReady = true;
    }
    SurgeMap.invalidate();
    await SurgeMap.load(caseId);
    LAYERS.forEach((l) => SurgeMap.toggle(l.id, $(`#layers input[data-layer="${l.id}"]`).checked));
    SurgeMap.toggle("wander", $('#layers input[data-layer="last_seen"]').checked);
    $("#mapTitle").textContent = caseId ? "Tracking #" + caseId : "Dispatch map";
    $("#mapSub").textContent = caseId ? "Search ring + sweep route for this case" : "32 zones · 1,280 CCTV · 85 chokepoints · 14 police";
  }
  function showZoneInfo(p) {
    $("#zinfo").innerHTML = `<h3 class="num" style="font-size:1.3rem">${p.zone_id}</h3><p class="muted" style="margin-bottom:10px">${esc(p.name)} · ${p.band}</p>
      <div class="zb">
        <div class="zrow"><span class="lab">Priority score</span><span class="val" style="color:${p.color}">${p.score}</span><div class="ztrack"><i style="width:${p.score}%;background:${p.color}"></i></div></div>
        <div class="zrow"><span class="lab">CCTV coverage</span><span class="val">${p.cctv} cams</span><div class="ztrack"><i style="width:${Math.min(100, p.cctv * 1.4)}%"></i></div></div>
        <div class="zrow"><span class="lab">Chokepoints</span><span class="val">${p.chokepoints}</span><div class="ztrack"><i style="width:${Math.min(100, p.chokepoints * 18)}%"></i></div></div>
      </div>
      <p class="muted" style="margin-top:12px;font-size:.8rem">${esc(p.action)} — ${p.band === "RED" ? "deploy a team here first." : p.band === "GREY" ? "low priority." : "include in the sweep."}</p>`;
  }

  // ---- queue ----
  async function loadQueue() {
    const q = await API.get("/api/queue?limit=14");
    $("#queueList").innerHTML = q.map((c) => `
      <div class="qitem"><span class="pri p${c.priority}">${c.priority}</span>
        <div class="meta"><b class="deva">${esc(c.person_name || "Unidentified")} ${c.age_band ? "· " + c.age_band : ""}</b><small>${esc((c.physical_description || "").slice(0, 60))} · #${c.case_id}</small></div>
        ${laneChip(c.lane)}</div>`).join("");
  }

  boot();
})();
