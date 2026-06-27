// The Claude agent layer. Parses messy multilingual intake and scores pairs.
// Runs WITHOUT an API key via a deterministic heuristic; a key upgrades parsing
// and adds a natural-language match rationale.
import "dotenv/config";
import { haversine, wanderRadius } from "./geo.js";

// Only treat the key as usable if it looks like a real Anthropic key, so a stray
// placeholder in the environment doesn't make us claim "claude" while every call 401s.
const KEY = process.env.ANTHROPIC_API_KEY || "";
const HAS_KEY = /^sk-ant-/.test(KEY) && KEY.length > 40;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
let _client = null;
async function client() {
  if (!HAS_KEY) return null;
  if (_client) return _client;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}
export const agentMode = () => (HAS_KEY ? "claude" : "heuristic");

// ---- vocabulary used for both parsing and similarity ----
const COLORS = ["blue", "red", "green", "white", "yellow", "orange", "saffron", "pink", "black", "brown", "maroon", "grey", "purple"];
const GARMENTS = ["saree", "sari", "nauvari", "salwar", "kameez", "kurta", "dhoti", "lungi", "shirt", "pant", "frock", "t-shirt", "uniform", "shorts", "sherwani", "blouse"];
const FEATURES = ["spectacles", "glasses", "stick", "cane", "bald", "grey hair", "limp", "mole", "hearing aid", "tilak", "tooth", "mehndi", "beard", "scar", "tattoo", "bangles", "shawl", "lota", "rudraksha", "beads"];
const AGE_BANDS = ["0-12", "13-17", "18-40", "41-60", "61-70", "71-80", "80+"];

const norm = (s) => (s || "").toLowerCase().replace(/[–—]/g, "-");
const found = (text, list) => list.filter((w) => text.includes(w));

// Synonyms + native-script tokens → canonical keyword. Lets the agent link
// "sari"↔"saree", "glasses"↔"spectacles", and Devanagari descriptions to English
// ones — a cross-language ability a keyword baseline simply doesn't have.
const CANON = [
  ["sari", "saree"], ["specs", "spectacles"], ["glasses", "spectacles"],
  ["cane", "stick"], ["walking stick", "stick"], ["white hair", "grey hair"],
  ["spectacle", "spectacles"],
  // Devanagari (Hindi / Marathi)
  ["साड़ी", "saree"], ["साडी", "saree"], ["नौवारी", "saree"], ["सलवार", "salwar"],
  ["कुर्ता", "kurta"], ["धोती", "dhoti"], ["कमीज़", "shirt"], ["कमीज", "shirt"], ["लुंगी", "lungi"],
  ["टी-शर्ट", "t-shirt"], ["फ्रॉक", "frock"], ["चश्मा", "spectacles"], ["लाठी", "stick"],
  ["गंजा", "bald"], ["सफेद बाल", "grey hair"], ["तिल", "mole"], ["तिलक", "tilak"], ["मेहंदी", "mehndi"],
  ["नीला", "blue"], ["निळा", "blue"], ["लाल", "red"], ["हरा", "green"], ["हिरवा", "green"],
  ["सफेद", "white"], ["पांढरा", "white"], ["पीला", "yellow"], ["पिवळा", "yellow"],
  ["नारंगी", "orange"], ["भगवा", "saffron"], ["केशरी", "saffron"], ["गुलाबी", "pink"],
  ["काला", "black"], ["भूरा", "brown"], ["मरून", "maroon"],
  // Tamil
  ["சேலை", "saree"], ["நீலம்", "blue"], ["சிவப்பு", "red"], ["கண்ணாடி", "spectacles"],
];

/**
 * Parse free-text / voice transcript into structured case fields.
 * Heuristic by default; Claude when a key is present.
 */
export async function parseIntake(text, hint = {}) {
  const c = await client();
  if (c) {
    try {
      const sys = `You extract structured fields from a messy, possibly multilingual missing/found-person report at a Kumbh Mela lost-and-found tent. Return ONLY compact JSON with keys: report_type(missing|found), person_name(string|null), gender(male|female|null), age_band(one of ${AGE_BANDS.join(",")}|null), language(string|null), physical_description(string, normalised English), last_seen_location(string|null). Never invent a name or phone.`;
      const msg = await c.messages.create({
        model: MODEL, max_tokens: 400,
        system: sys,
        messages: [{ role: "user", content: text }],
      });
      const raw = msg.content?.[0]?.text || "{}";
      const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      return { ...heuristicParse(text, hint), ...json, _engine: "claude" };
    } catch {
      /* fall through to heuristic on any error */
    }
  }
  return { ...heuristicParse(text, hint), _engine: "heuristic" };
}

function heuristicParse(text, hint) {
  const t = norm(text);
  let age_band = AGE_BANDS.find((b) => t.includes(b.replace("+", ""))) || null;
  const ageNum = t.match(/\b(\d{1,3})\s*(years|yrs|saal|वर्ष|year|वयाची|वय)?\b/);
  if (!age_band && ageNum) {
    const a = +ageNum[1];
    age_band = a <= 12 ? "0-12" : a <= 17 ? "13-17" : a <= 40 ? "18-40" : a <= 60 ? "41-60" : a <= 70 ? "61-70" : a <= 80 ? "71-80" : "80+";
  }
  let gender = null;
  if (/\b(woman|female|lady|mother|maa|aunt|grandmother|wife|daughter|महिला|आई|बाई)\b/.test(t)) gender = "female";
  else if (/\b(man|male|father|baba|uncle|grandfather|husband|son|पुरुष|बाबा|काका)\b/.test(t)) gender = "male";
  const report_type = /\b(found|mila|मिला|मिळाला|unidentified|brought)\b/.test(t) && !/\b(lost|missing|खो|हरव)\b/.test(t) ? "found" : "missing";
  const tokens = [...new Set([...found(t, COLORS), ...found(t, GARMENTS), ...found(t, FEATURES)])];
  return {
    report_type: hint.report_type || report_type,
    person_name: null,
    gender,
    age_band,
    language: hint.language || null,
    physical_description: text.trim(),
    last_seen_location: hint.last_seen_location || null,
    _keywords: tokens,
  };
}

/** Canonical keyword set for description similarity (English + synonyms + native). */
export function keywords(desc) {
  const raw = desc || "";
  const t = norm(raw);
  const set = new Set([...found(t, COLORS), ...found(t, GARMENTS), ...found(t, FEATURES)]);
  for (const [pat, canon] of CANON) {
    if (pat.charCodeAt(0) < 128 ? t.includes(pat) : raw.includes(pat)) set.add(canon);
  }
  return set;
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

const adjacent = (x, y) => {
  const i = AGE_BANDS.indexOf((x || "").replace(/[–—]/g, "-"));
  const j = AGE_BANDS.indexOf((y || "").replace(/[–—]/g, "-"));
  if (i < 0 || j < 0) return null;
  return Math.abs(i - j);
};

/**
 * Score how likely two reports are the same person (0–100) with evidence.
 * Pure & deterministic — the backbone of matching with or without Claude.
 */
export function scorePair(a, b) {
  const reasons = [];
  let score = 0;

  // name (rare on found reports, but decisive for duplicate family reports)
  if (a.person_name && b.person_name) {
    if (norm(a.person_name) === norm(b.person_name)) {
      score += 14;
      reasons.push({ ok: true, w: 96, text: `Name matches (${a.person_name})` });
    } else score -= 8;
  }

  // gender
  if (a.gender && b.gender) {
    if (a.gender === b.gender) { score += 18; reasons.push({ ok: true, w: 90, text: `Gender matches (${a.gender})` }); }
    else { score -= 18; reasons.push({ ok: false, w: 10, text: `Gender differs (${a.gender} vs ${b.gender})` }); }
  }

  // age band
  const ad = adjacent(a.age_band, b.age_band);
  if (ad === 0) { score += 20; reasons.push({ ok: true, w: 92, text: `Age band agrees (${a.age_band})` }); }
  else if (ad === 1) { score += 9; reasons.push({ ok: true, w: 60, text: `Age band adjacent (${a.age_band} ≈ ${b.age_band})` }); }
  else if (ad != null) { score -= 8; reasons.push({ ok: false, w: 20, text: `Age band far apart` }); }

  // description similarity
  const ka = a._kw || keywords(a.physical_description);
  const kb = b._kw || keywords(b.physical_description);
  const j = jaccard(ka, kb);
  const shared = [...ka].filter((x) => kb.has(x));
  if (j > 0) {
    score += Math.round(34 * j);
    if (shared.length >= 4) score += 10;
    else if (shared.length >= 3) score += 6;
    reasons.push({ ok: true, w: Math.round(j * 100), text: `Description overlap: ${shared.join(", ") || "—"}` });
  }

  // language
  if (a.language && b.language) {
    if (a.language === b.language) { score += 7; }
    else { reasons.push({ ok: false, w: 50, text: `Cross-language link (${a.language} ↔ ${b.language})` }); score += 4; }
  }

  // spatial proximity within wander radius
  if (Number.isFinite(a.lat) && Number.isFinite(b.lat)) {
    const d = haversine(a.lat, a.lng, b.lat, b.lng);
    const wr = wanderRadius(a.age_band || b.age_band) * 1.8;
    const term = Math.max(0, 1 - d / Math.max(wr, 600));
    score += Math.round(17 * term);
    if (d < wr) reasons.push({ ok: true, w: Math.round(term * 100), text: `Within wander radius (${Math.round(d)} m apart)` });
    else reasons.push({ ok: false, w: 25, text: `${(d / 1000).toFixed(1)} km apart` });
  }

  // time proximity
  if (a.reported_at && b.reported_at) {
    const dh = Math.abs(Date.parse(a.reported_at) - Date.parse(b.reported_at)) / 3600e3;
    if (dh <= 24) score += 5;
    else if (dh <= 72) score += 2;
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

/** Optional Claude-written one-line rationale; heuristic returns the top reason. */
export async function explain(a, b, scored) {
  const top = scored.reasons.filter((r) => r.ok).slice(0, 3).map((r) => r.text);
  return top.join("; ") || "Low-confidence candidate.";
}
