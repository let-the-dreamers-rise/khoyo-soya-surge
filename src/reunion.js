// Reunion Lane: multilingual PA scripts, SMS preview, center fan-out, and the
// human-confirmed reunion that closes a case. The agent never auto-reunites.
import { db, audit } from "./db.js";

// PA templates keyed by the pilgrim's language. {code}{center}{desc} interpolated.
const PA = {
  Hindi: ({ code, center, desc }) =>
    `सूचना: रसीद ${code}. ${desc ? desc + " वाले" : "लापता"} सज्जन/महिला के परिवार ${center} पर प्रतीक्षा कर रहे हैं। कृपया तुरंत ${center} पधारें।`,
  Marathi: ({ code, center, desc }) =>
    `सूचना: पावती ${code}. ${desc ? desc + " असलेल्या" : "हरवलेल्या"} व्यक्तीचे कुटुंब ${center} येथे थांबले आहे. कृपया लगेच ${center} येथे या.`,
  Tamil: ({ code, center, desc }) =>
    `அறிவிப்பு: ரசீது ${code}. ${desc ? desc + " அணிந்த" : "காணாமல் போன"} நபரின் குடும்பத்தினர் ${center} இல் காத்திருக்கிறார்கள். உடனே ${center} வரவும்.`,
  Gujarati: ({ code, center, desc }) =>
    `સૂચના: રસીદ ${code}. ${desc ? desc + " વાળા" : "ગુમ થયેલા"} વ્યક્તિના પરિવાર ${center} પર રાહ જુએ છે. કૃપા કરી તરત ${center} આવો.`,
  Telugu: ({ code, center, desc }) =>
    `ప్రకటన: రసీదు ${code}. ${desc ? desc + " ధరించిన" : "తప్పిపోయిన"} వ్యక్తి కుటుంబం ${center} వద్ద వేచి ఉన్నారు. దయచేసి వెంటనే ${center} రండి.`,
};

const ROMAN = ({ code, center }) =>
  `Soochna: Receipt ${code}. Aapka parivar ${center} par pratiksha kar rahe hain. Kripya turant ${center} aayein.`;
const ENGLISH = ({ code, center, desc }) =>
  `Announcement: Ref ${code}. Family of the ${desc || "missing"} person is waiting at ${center}. Please come to ${center} immediately.`;

/** Build PA script in the pilgrim's language + romanised + English fallback. */
export function paScript(language, vars) {
  const native = (PA[language] || PA.Hindi)(vars);
  return { language: language || "Hindi", native, roman: ROMAN(vars), english: ENGLISH(vars) };
}

const maskMobile = (m) => (m ? m.replace(/^(\d{2})\d{5}(\d{3})$/, "$1•••••$2") : null);

/**
 * Assemble the full broadcast plan for a confirmed/likely match.
 * `missing` carries the family contact; `found` is where the person physically is.
 */
export function buildBroadcast(a, b) {
  const missing = a.report_type === "missing" ? a : b;
  const found = a.report_type === "found" ? a : b;
  const anchor = missing.reporting_center;
  const centers = [...new Set([a.reporting_center, b.reporting_center])];
  const isMinor = (missing.age_band || found.age_band || "").startsWith("0-12");

  const pa = paScript(missing.language || found.language, {
    code: missing.case_id,
    center: anchor,
    desc: found.physical_description?.split(/[.;]/)[0]?.toLowerCase() || "",
  });

  const channels = [
    { id: "pa", label: `PA loudspeaker · ${pa.language}`, status: "ready", note: "Volunteer reads at the ghat" },
    { id: "centers", label: "All centers alerted", status: "ready", note: centers.join(" + ") },
    missing.reporter_mobile
      ? { id: "sms", label: "SMS to family", status: "ready", note: maskMobile(missing.reporter_mobile) }
      : { id: "sms", label: "SMS to family", status: "skipped", note: "No mobile on file — PA only" },
  ];
  if (isMinor) channels.push({ id: "police", label: "Police handoff (minor)", status: "ready", note: "Verification before release" });

  return {
    match_score: Math.max(a.match_score || 0, b.match_score || 0),
    family_anchor: anchor,
    person_is_at: found.reporting_center,
    centers_alerted: centers,
    pa_script: pa.native,
    pa_script_roman: pa.roman,
    pa_script_english: pa.english,
    pa_language: pa.language,
    sms_preview: missing.reporter_mobile
      ? `Family member found. Come to ${anchor}. Ref ${missing.case_id}.`
      : null,
    sms_to: maskMobile(missing.reporter_mobile),
    channels,
    handoff: isMinor ? "Minor — volunteer + police verification required before release" : "Volunteer visual confirmation required before release",
  };
}

/** Record that a broadcast was sent (audit + broadcasts table). */
export function logBroadcast(a, b, plan) {
  db().prepare(
    `INSERT INTO broadcasts (case_id, matched_case_id, pa_script, pa_script_local, channels, sms_sent)
     VALUES (?,?,?,?,?,?)`
  ).run(a.case_id, b.case_id, plan.pa_script_english, plan.pa_script, JSON.stringify(plan.channels), plan.sms_preview ? 1 : 0);
  audit(a.case_id, "broadcast", `PA(${plan.pa_language}) + ${plan.centers_alerted.length} centers`, "volunteer");
}

/** Human-confirmed reunion. Closes both cases, computes resolution time. */
export function confirmReunion(caseId, matchedId, actor = "volunteer") {
  const d = db();
  const a = d.prepare("SELECT * FROM cases WHERE case_id=?").get(caseId);
  const b = d.prepare("SELECT * FROM cases WHERE case_id=?").get(matchedId);
  if (!a || !b) throw new Error("case not found");

  const now = new Date();
  const upd = d.prepare(
    `UPDATE cases SET status='reunited', lane='reunion', matched_case_id=?,
       resolved_at=?, resolution_hours=?, updated_at=datetime('now') WHERE case_id=?`
  );
  const hrs = (row) => +(Math.max(0, (now - new Date(row.reported_at)) / 3600e3)).toFixed(2);
  upd.run(b.case_id, now.toISOString(), hrs(a), a.case_id);
  upd.run(a.case_id, now.toISOString(), hrs(b), b.case_id);

  audit(a.case_id, "reunion_confirmed", `${a.case_id} ↔ ${b.case_id} by ${actor}`, actor);
  return {
    reunited: [a.case_id, b.case_id],
    centers: [...new Set([a.reporting_center, b.reporting_center])],
    resolution_hours: hrs(a),
    confirmed_by: actor,
    at: now.toISOString(),
  };
}
