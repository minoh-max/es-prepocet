"use strict";
// Volania Anthropic Messages API. Kľúč je len na serveri (premenná ANTHROPIC_API_KEY).

const API = "https://api.anthropic.com/v1/messages";
const MODEL = () => process.env.AI_MODEL || "claude-sonnet-5-5";
const MODEL_QUICK = () => process.env.AI_MODEL_QUICK || "claude-haiku-5-5";
const LIMITS = { maxPromptBytes: 400000, images: { maxCount: 16, maxInputBytes: 5_000_000, mediaTypes: ["image/jpeg", "image/png", "image/webp"] } };

class AiError extends Error {
  constructor(message, code, status = 502) { super(message); this.code = code; this.status = status; }
}

function extractJson(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(t); } catch (e) { /* hľadaj objekt v texte */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { /* nižšie */ }
  }
  throw new AiError("Odpoveď AI nebola platný JSON.", "bad_json");
}

function mockReply(prompt, json) {
  if (json && /^KONTROLA PREPOČTU/.test(prompt)) {
    return { nalezy: [{ polozka: "Strecha", problem: "Plocha strechy rastie rýchlejšie ako zastavaná plocha.", preco: "Pomer strecha / zastavaná plocha je vyšší ako pri východiskovom dome.", overit: "Sklon a presahy strechy v reze.", typ: "vymera", dopad: "vysoky" }], overitNajprv: [{ cislo: "Plocha strechy", preco: "Najväčší vplyv na cenu." }], kontrolyVymer: [{ kontrola: "Výkresy sú z poslednej revízie štúdie.", zdroj: "rohová pečiatka výkresov" }] };
  }
  if (!json) return "Cena je vyššia hlavne kvôli tepelnému čerpadlu a väčším oknám.";
  if (/technick|správ/i.test(prompt) && !/podorys|pôdorys/i.test(prompt.slice(0, 400))) {
    return { typStrany: "technicka_sprava", nazovDomu: "Lucie 89", plochy: { uzitkovaCelkomM2: 131.5, zastavanaM2: 158 }, typDomu: "bungalov", strecha: { typ: "sedlova", sklon: 38 }, technika: { zdrojTepla: "tc", rozvodTepla: "podlahove" }, nadstandardy: [], poznamky: "Testovacia odpoveď (AI_MOCK)." };
  }
  return { typStrany: "podorys", podlazie: "1.NP", nazovDomu: "Lucie 89", plochy: { uzitkovaCelkomM2: 131.5, zastavanaM2: 158 }, pocetIzieb: 4, typDomu: "bungalov", strecha: { typ: "sedlova", sklon: 38 }, miestnosti: [{ nazov: "Obývačka", plochaM2: 42 }], otvory: [{ typ: "okno", sirkaM: 1.5, vyskaM: 1.25, pocet: 4 }, { typ: "vchodove", sirkaM: 1.1, vyskaM: 2.2, pocet: 1 }, { typ: "vnutorne", pocet: 8 }], kupelne: [{ nazov: "Kúpeľňa", vana: 1, sprcha: 1, umyvadla: 1, wc: 1 }], rez: { vyskaStenyM: 2.95, typZalozenia: "pasy_dt", dtRadyMax: 1 }, technika: { zdrojTepla: "tc", rozvodTepla: "podlahove" }, nadstandardy: [], poznamky: "Testovacia odpoveď (AI_MOCK)." };
}

/**
 * prompt: text, images: [{ data: base64, mediaType }], json: odpoveď ako objekt, tier: "complex" | "quick"
 * vracia { result, usage: { model, input_tokens, output_tokens } }
 */
async function callAi({ prompt, images = [], json = false, tier = "complex" }) {
  if (process.env.AI_MOCK === "1") return { result: mockReply(prompt, json), usage: { model: "mock", input_tokens: 0, output_tokens: 0 } };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AiError("Čítanie štúdií nie je nastavené – chýba kľúč ANTHROPIC_API_KEY na serveri.", "not_configured", 503);
  if (images.length > LIMITS.images.maxCount) throw new AiError("Priveľa obrázkov v jednej požiadavke.", "too_many_images", 400);
  const model = tier === "quick" ? MODEL_QUICK() : MODEL();
  const content = [
    ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.mediaType || "image/jpeg", data: im.data } })),
    { type: "text", text: prompt },
  ];
  const body = {
    model,
    max_tokens: json ? 8192 : 1500,
    messages: [{ role: "user", content }],
    ...(json ? { system: "Odpovedaj výhradne jedným platným JSON objektom, bez ďalšieho textu a bez značiek ```." } : {}),
  };
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 180000);
    let res;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      last = new AiError("Spojenie s AI zlyhalo: " + (e.name === "AbortError" ? "vypršal čas" : e.message), "network");
      clearTimeout(timer);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    clearTimeout(timer);
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      last = new AiError(res.status === 429 ? "AI je dočasne preťažená (limit požiadaviek)." : "AI dočasne neodpovedá.", res.status === 429 ? "rate_limited" : "overloaded", 503);
      const wait = Number(res.headers.get("retry-after")) || 2 * (attempt + 1);
      await new Promise((r) => setTimeout(r, Math.min(20, wait) * 1000));
      continue;
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = j && j.error && j.error.message ? j.error.message : "HTTP " + res.status;
      throw new AiError("AI požiadavku odmietla: " + msg, res.status === 401 ? "bad_key" : "rejected", res.status === 401 ? 503 : 400);
    }
    const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    const usage = { model, input_tokens: (j.usage && j.usage.input_tokens) || 0, output_tokens: (j.usage && j.usage.output_tokens) || 0 };
    return { result: json ? extractJson(text) : text, usage };
  }
  throw last || new AiError("AI neodpovedá.", "unavailable");
}

module.exports = { callAi, extractJson, AiError, LIMITS };
