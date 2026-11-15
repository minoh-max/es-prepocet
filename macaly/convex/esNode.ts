"use node"
import { v, ConvexError } from "convex/values"
import { action } from "./_generated/server"
import { internal } from "./_generated/api"
import bcrypt from "bcryptjs"
import { randomBytes } from "node:crypto"

// ES Prepočet – akcie, ktoré potrebujú Node: heslá (bcrypt) a volanie AI (Claude cez Macaly).
const fail = (message: string, code: string): never => { throw new ConvexError({ message, code }) }
const normEmail = (e: string) => String(e || "").trim().toLowerCase()

async function requireUser(ctx: any, token: string, role?: "admin") {
  const u = await ctx.runQuery(internal.es._sessionUser, { token })
  if (!u) fail("Nie ste prihlásený.", "unauthenticated")
  if (role === "admin" && u.role !== "admin") fail("Na túto akciu potrebujete práva administrátora.", "forbidden")
  return u
}

// ---------- prihlásenie ----------
export const login = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, a) => {
    const email = normEmail(a.email)
    const key = email.slice(0, 300)
    const f = await ctx.runQuery(internal.es._getFail, { key })
    if (f && f.n >= 5 && f.untilAt > Date.now()) fail("Priveľa neúspešných pokusov. Skúste to znova o 15 minút.", "locked")
    // prvé spustenie: administrátor z premenných ES_ADMIN_EMAIL a ES_ADMIN_PASSWORD
    if ((await ctx.runQuery(internal.es._userCount, {})) === 0) {
      const ae = normEmail(process.env.ES_ADMIN_EMAIL || ""), ap = process.env.ES_ADMIN_PASSWORD || ""
      if (ae && ap.length >= 8) await ctx.runMutation(internal.es._insertUser, { email: ae, name: "Administrátor", role: "admin", passHash: await bcrypt.hash(ap, 10), mustChange: true })
    }
    const u = await ctx.runQuery(internal.es._userByEmail, { email })
    const ok = !!u && u.active && (await bcrypt.compare(String(a.password || ""), u.passHash))
    if (!ok) {
      await ctx.runMutation(internal.es._recordFail, { key })
      fail("Nesprávny e-mail alebo heslo.", "bad_credentials")
    }
    const token = randomBytes(32).toString("base64url")
    await ctx.runMutation(internal.es._startSession, { userId: u!._id, token, failKey: key })
    return { token }
  },
})

export const changePassword = action({
  args: { token: v.string(), current: v.string(), next: v.string() },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx, a.token)
    if (!(await bcrypt.compare(a.current, u.passHash))) fail("Súčasné heslo nie je správne.", "bad_password")
    if (a.next.length < 8) fail("Nové heslo musí mať aspoň 8 znakov.", "weak_password")
    await ctx.runMutation(internal.es._setPassword, { userId: u._id, passHash: await bcrypt.hash(a.next, 10), mustChange: false, keepToken: a.token })
    return { ok: true }
  },
})

// ---------- správa používateľov (admin) ----------
export const createUser = action({
  args: { token: v.string(), email: v.string(), name: v.optional(v.string()), role: v.optional(v.string()), password: v.string() },
  handler: async (ctx, a) => {
    await requireUser(ctx, a.token, "admin")
    const email = normEmail(a.email)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Zadajte platný e-mail.", "bad_email")
    if (a.password.length < 8) fail("Heslo musí mať aspoň 8 znakov.", "weak_password")
    return await ctx.runMutation(internal.es._insertUser, { email, name: (a.name || "").trim(), role: a.role === "admin" ? "admin" : "sales", passHash: await bcrypt.hash(a.password, 10), mustChange: true })
  },
})

export const resetPassword = action({
  args: { token: v.string(), id: v.string(), password: v.string() },
  handler: async (ctx, a) => {
    await requireUser(ctx, a.token, "admin")
    if (a.password.length < 8) fail("Heslo musí mať aspoň 8 znakov.", "weak_password")
    return await ctx.runMutation(internal.es._setPassword, { userId: a.id as any, passHash: await bcrypt.hash(a.password, 10), mustChange: true })
  },
})

// ---------- AI: čítanie štúdie (Claude cez Macaly, platí sa kreditmi Macaly) ----------
const MODEL = "anthropic/claude-sonnet-5"
const MAX_IMAGES = 16

export function extractJson(text: string) {
  const t = String(text || "").replace(/```(?:json)?/gi, "").trim()
  try { return JSON.parse(t) } catch { /* hľadaj objekt v texte */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}")
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)) } catch { /* nižšie */ } }
  fail("Odpoveď AI nebola platný JSON.", "bad_json")
}

export const ai = action({
  args: {
    token: v.string(), prompt: v.string(), json: v.boolean(), tier: v.optional(v.string()),
    images: v.array(v.object({ data: v.string(), mediaType: v.string() })),
  },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx, a.token)
    if (!a.prompt) fail("Chýba zadanie pre AI.", "bad_request")
    if (a.images.length > MAX_IMAGES) fail("Priveľa obrázkov v jednej požiadavke.", "too_many_images")
    const base = String(process.env.MACALY_BASE_URL || "").replace(/\/$/, "")
    const content = [...a.images.map((im) => ({ type: "image", image: im.data, mediaType: im.mediaType || "image/jpeg" })), { type: "text", text: a.prompt }]
    const body: Record<string, unknown> = {
      chatId: process.env.MACALY_CHAT_ID,
      messages: [
        ...(a.json ? [{ role: "system", content: "Odpovedaj výhradne jedným platným JSON objektom, bez ďalšieho textu a bez značiek ```." }] : []),
        { role: "user", content },
      ],
      maxTokens: a.json ? 8192 : 1500,
      temperature: 0,
      ...(a.tier === "quick" ? { preset: "FAST" } : { model: MODEL }),
    }
    const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: "Bearer " + process.env.MACALY_API_TOKEN }
    const bypass = process.env.MACALY_BYPASS_HEADER
    if (bypass && bypass.includes(":")) headers[bypass.slice(0, bypass.indexOf(":")).trim().toLowerCase()] = bypass.slice(bypass.indexOf(":") + 1).trim()
    let last = "AI neodpovedá."
    for (let attempt = 0; attempt < 4; attempt++) {
      let res: Response
      try {
        res = await fetch(base + "/api/client-app/llm-usage", { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(540_000) })
      } catch (e: any) {
        last = "Spojenie s AI zlyhalo: " + (e?.name === "TimeoutError" ? "vypršal čas" : e?.message || e)
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        continue
      }
      if (res.status === 429 || res.status >= 500) {
        last = res.status === 429 ? "AI je dočasne preťažená (limit požiadaviek)." : "AI dočasne neodpovedá."
        await new Promise((r) => setTimeout(r, (res.status === 429 ? 30 : 3 * (attempt + 1)) * 1000))
        continue
      }
      if (res.status === 402) { await ctx.runMutation(internal.es._logAi, { userId: u._id, model: MODEL, ok: false }); fail("Kredity AI v Macaly sú vyčerpané. Doplňte ich v Macaly.", "no_credits") }
      const j: any = await res.json().catch(() => ({}))
      if (!res.ok || j.success === false) fail("AI požiadavku odmietla: " + (j.error || "HTTP " + res.status), "rejected")
      await ctx.runMutation(internal.es._logAi, { userId: u._id, model: a.tier === "quick" ? "FAST" : MODEL, ok: true })
      const text = String(j.text || "")
      return { result: a.json ? extractJson(text) : text }
    }
    fail(last, "unavailable")
  },
})
