import { v, ConvexError } from "convex/values"
import { query, mutation, internalQuery, internalMutation } from "./_generated/server"
import type { QueryCtx, MutationCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

// ES Prepočet – dokumenty, relácie a používatelia (prenesené zo server/app.js).
const SESSION_DAYS = 30
const DAY = 864e5
const MAX_DOC_BYTES = 900_000 // Convex: max. 1 MB na záznam

export const validPath = (p: string) =>
  typeof p === "string" && /^[A-Za-z0-9_\-.~:@+]{1,200}(\/[A-Za-z0-9_\-.~:@+]{1,200}){0,14}$/.test(p) && !p.split("/").some((s) => s === "." || s === "..")

export function publicUser(u: Doc<"esUsers">) {
  return { id: u._id as string, email: u.email, name: u.name, role: u.role, active: u.active, mustChange: u.mustChange, createdAt: u.createdAt }
}

/** Kto smie zapisovať: admin všetko; obchodník len svoj profil a svoje prepočty. Čítať môže každý prihlásený. */
export function canWrite(user: { _id: string; role: string } | null, docPath: string) {
  if (!user) return false
  if (user.role === "admin") return true
  return docPath === "profiles/" + user._id || docPath.startsWith("estimates/" + user._id + "/")
}

async function sessionUser(ctx: QueryCtx | MutationCtx, token: string) {
  if (!token) return null
  const s = await ctx.db.query("esSessions").withIndex("by_token", (q) => q.eq("token", token)).unique()
  if (!s || s.expiresAt < Date.now()) return null
  const u = await ctx.db.get(s.userId)
  if (!u || !u.active) return null
  return u
}

// ConvexError: správa a kód sa dostanú až do prehliadača (bežná chyba sa v produkcii skryje)
export const fail = (message: string, code: string): never => { throw new ConvexError({ message, code }) }

async function requireUser(ctx: QueryCtx | MutationCtx, token: string, role?: "admin") {
  const u = await sessionUser(ctx, token)
  if (!u) fail("Nie ste prihlásený.", "unauthenticated")
  if (role === "admin" && u!.role !== "admin") fail("Na túto akciu potrebujete práva administrátora.", "forbidden")
  return u!
}

const docOut = (d: Doc<"esDocs">) => ({ id: d.path.split("/").pop()!, path: d.path, exists: true, data: JSON.parse(d.dataJson), version: d.version, updatedAt: d.updatedAt })

// ---------- relácia ----------
export const me = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const u = await sessionUser(ctx, token)
    return u ? publicUser(u) : null
  },
})

export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const s = await ctx.db.query("esSessions").withIndex("by_token", (q) => q.eq("token", token)).unique()
    if (s) await ctx.db.delete(s._id)
    return null
  },
})

// ---------- dokumenty ----------
export const getDoc = query({
  args: { token: v.string(), path: v.string() },
  handler: async (ctx, { token, path }) => {
    await requireUser(ctx, token)
    if (!validPath(path) || path.split("/").length % 2) fail("Neplatná cesta dokumentu.", "bad_path")
    const d = await ctx.db.query("esDocs").withIndex("by_path", (q) => q.eq("path", path)).unique()
    return d ? docOut(d) : { id: path.split("/").pop()!, path, exists: false, data: null }
  },
})

export const listCollection = query({
  args: { token: v.string(), path: v.string(), orderBy: v.optional(v.string()), dir: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { token, path, orderBy, dir, limit }) => {
    await requireUser(ctx, token)
    if (!validPath(path) || path.split("/").length % 2 === 0) fail("Neplatná cesta kolekcie.", "bad_path")
    const rows = await ctx.db.query("esDocs").withIndex("by_parent", (q) => q.eq("parent", path)).collect()
    const docs = rows.map(docOut)
    if (orderBy) {
      const k = dir === "desc" ? -1 : 1
      docs.sort((a, b) => { const x = a.data?.[orderBy], y = b.data?.[orderBy]; return (x === y ? 0 : x == null ? 1 : y == null ? -1 : x < y ? -1 : 1) * k })
    }
    return docs.slice(0, Math.min(1000, limit || 1000))
  },
})

export const writeDoc = mutation({
  args: { token: v.string(), path: v.string(), mode: v.union(v.literal("set"), v.literal("update"), v.literal("delete")), dataJson: v.optional(v.string()) },
  handler: async (ctx, { token, path, mode, dataJson }) => {
    const u = await requireUser(ctx, token)
    if (!validPath(path) || path.split("/").length % 2) fail("Neplatná cesta dokumentu.", "bad_path")
    if (!canWrite(u, path)) fail("Na zmenu tohto záznamu nemáte oprávnenie.", "forbidden")
    const cur = await ctx.db.query("esDocs").withIndex("by_path", (q) => q.eq("path", path)).unique()
    if (mode === "delete") { if (cur) await ctx.db.delete(cur._id); return null }
    let incoming: any
    try { incoming = JSON.parse(dataJson || "null") } catch { incoming = null }
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) fail("Chýbajú údaje dokumentu.", "bad_data")
    let data = mode === "update" && cur ? { ...JSON.parse(cur.dataJson), ...incoming } : incoming
    if (mode === "update") for (const k of Object.keys(incoming)) if (incoming[k] && incoming[k].__delete__ === true) delete data[k]
    const json = JSON.stringify(data)
    if (json.length > MAX_DOC_BYTES) fail("Záznam je príliš veľký.", "too_large")
    const parent = path.split("/").slice(0, -1).join("/")
    if (cur) await ctx.db.patch(cur._id, { dataJson: json, version: cur.version + 1, updatedAt: Date.now() })
    else await ctx.db.insert("esDocs", { path, parent, dataJson: json, version: 1, updatedAt: Date.now() })
    const d = await ctx.db.query("esDocs").withIndex("by_path", (q) => q.eq("path", path)).unique()
    return docOut(d!)
  },
})

// ---------- používatelia (admin) ----------
export const listUsers = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireUser(ctx, token, "admin")
    const users = await ctx.db.query("esUsers").collect()
    const since = new Date(); since.setDate(1); since.setHours(0, 0, 0, 0)
    const usage = await ctx.db.query("esAiUsage").withIndex("by_at", (q) => q.gte("at", since.getTime())).collect()
    const calls: Record<string, number> = {}
    usage.forEach((x) => (calls[x.userId] = (calls[x.userId] || 0) + 1))
    return users.sort((a, b) => a.createdAt - b.createdAt).map((u) => ({ ...publicUser(u), aiThisMonth: { calls: calls[u._id] || 0, inputTokens: 0, outputTokens: 0 } }))
  },
})

export const updateUser = mutation({
  args: { token: v.string(), id: v.string(), name: v.optional(v.string()), role: v.optional(v.string()), active: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const me = await requireUser(ctx, a.token, "admin")
    const id = ctx.db.normalizeId("esUsers", a.id)
    const u = id && (await ctx.db.get(id))
    if (!u) fail("Používateľ neexistuje.", "not_found")
    if (u!._id === me._id && (a.active === false || (a.role && a.role !== "admin"))) fail("Svoj vlastný účet nemôžete deaktivovať ani mu odobrať práva administrátora.", "self")
    const patch: Partial<Doc<"esUsers">> = {}
    if (a.name !== undefined) patch.name = a.name.trim()
    if (a.role === "admin" || a.role === "sales") patch.role = a.role
    if (a.active !== undefined) patch.active = a.active
    await ctx.db.patch(u!._id, patch)
    if (a.active === false) await dropSessions(ctx, u!._id)
    return publicUser((await ctx.db.get(u!._id))!)
  },
})

async function dropSessions(ctx: MutationCtx, userId: Id<"esUsers">, keepToken?: string) {
  const ss = await ctx.db.query("esSessions").withIndex("by_user", (q) => q.eq("userId", userId)).collect()
  for (const s of ss) if (s.token !== keepToken) await ctx.db.delete(s._id)
}

// ---------- interné (volajú akcie v esNode.ts, ktoré počítajú bcrypt) ----------
export const _userByEmail = internalQuery({ args: { email: v.string() }, handler: (ctx, { email }) => ctx.db.query("esUsers").withIndex("by_email", (q) => q.eq("email", email)).unique() })
export const _userCount = internalQuery({ args: {}, handler: async (ctx) => (await ctx.db.query("esUsers").take(1)).length })
export const _sessionUser = internalQuery({ args: { token: v.string() }, handler: (ctx, { token }) => sessionUser(ctx, token) })
export const _getFail = internalQuery({ args: { key: v.string() }, handler: (ctx, { key }) => ctx.db.query("esLoginFails").withIndex("by_key", (q) => q.eq("key", key)).unique() })

export const _recordFail = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const now = Date.now()
    const f = await ctx.db.query("esLoginFails").withIndex("by_key", (q) => q.eq("key", key)).unique()
    const n = (f && f.untilAt > now ? f.n : 0) + 1
    if (f) await ctx.db.patch(f._id, { n, untilAt: now + 15 * 60e3 })
    else await ctx.db.insert("esLoginFails", { key, n, untilAt: now + 15 * 60e3 })
    return null
  },
})

export const _startSession = internalMutation({
  args: { userId: v.id("esUsers"), token: v.string(), failKey: v.string() },
  handler: async (ctx, { userId, token, failKey }) => {
    const f = await ctx.db.query("esLoginFails").withIndex("by_key", (q) => q.eq("key", failKey)).unique()
    if (f) await ctx.db.delete(f._id)
    await ctx.db.insert("esSessions", { token, userId, expiresAt: Date.now() + SESSION_DAYS * DAY })
    return null
  },
})

export const _insertUser = internalMutation({
  args: { email: v.string(), name: v.string(), role: v.union(v.literal("admin"), v.literal("sales")), passHash: v.string(), mustChange: v.boolean() },
  handler: async (ctx, a) => {
    const ex = await ctx.db.query("esUsers").withIndex("by_email", (q) => q.eq("email", a.email)).unique()
    if (ex) fail("Používateľ s týmto e-mailom už existuje.", "exists")
    const id = await ctx.db.insert("esUsers", { ...a, active: true, createdAt: Date.now() })
    return publicUser((await ctx.db.get(id))!)
  },
})

export const _setPassword = internalMutation({
  args: { userId: v.id("esUsers"), passHash: v.string(), mustChange: v.boolean(), keepToken: v.optional(v.string()) },
  handler: async (ctx, { userId, passHash, mustChange, keepToken }) => {
    await ctx.db.patch(userId, { passHash, mustChange })
    await dropSessions(ctx, userId, keepToken)
    return publicUser((await ctx.db.get(userId))!)
  },
})

/** Úplne odstráni používateľa (testovací účet): relácie, profil, prepočty, záznamy AI. Len cez `npx convex run`. */
export const _removeUser = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const u = await ctx.db.query("esUsers").withIndex("by_email", (q) => q.eq("email", email)).unique()
    if (!u) return 0
    let n = 0
    for (const s of await ctx.db.query("esSessions").withIndex("by_user", (q) => q.eq("userId", u._id)).collect()) { await ctx.db.delete(s._id); n++ }
    for (const p of ["profiles/" + u._id]) { const d = await ctx.db.query("esDocs").withIndex("by_path", (q) => q.eq("path", p)).unique(); if (d) { await ctx.db.delete(d._id); n++ } }
    for (const d of await ctx.db.query("esDocs").withIndex("by_parent", (q) => q.eq("parent", "estimates/" + u._id + "/list")).collect()) { await ctx.db.delete(d._id); n++ }
    for (const x of await ctx.db.query("esAiUsage").collect()) if (x.userId === u._id) { await ctx.db.delete(x._id); n++ }
    await ctx.db.delete(u._id)
    return n + 1
  },
})

export const _logAi = internalMutation({
  args: { userId: v.id("esUsers"), model: v.string(), ok: v.boolean() },
  handler: async (ctx, a) => { await ctx.db.insert("esAiUsage", { ...a, at: Date.now() }); return null },
})
