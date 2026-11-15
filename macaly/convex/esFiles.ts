import { v, ConvexError } from "convex/values"
import { action, internalMutation, internalQuery } from "./_generated/server"
import type { ActionCtx } from "./_generated/server"
import { internal } from "./_generated/api"
import { callMacalyJson } from "./macaly"

// ES Prepočet – súbory (logo firmy, importovaný číselník, PDF štúdie k prepočtu).
// Bajty sú v súkromnom úložisku Macaly (App Files / R2), v Convexe len záznam o súbore.
// Čítať môže každý prihlásený (ako na pôvodnom serveri), mazať vlastník alebo administrátor.
const PROTOCOL = "bindings_v1" as const
const env = () => (process.env.MACALY_DATABASE_ENVIRONMENT === "development" ? "development" : "production")
const fail = (message: string, code: string): never => { throw new ConvexError({ message, code }) }

async function requireUser(ctx: Pick<ActionCtx, "runQuery">, token: string) {
  const u = await ctx.runQuery(internal.es._sessionUser, { token })
  if (!u) fail("Nie ste prihlásený.", "unauthenticated")
  return u!
}

export const createUpload = action({
  args: { token: v.string(), filename: v.string(), contentType: v.string(), fileSize: v.number() },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx, a.token)
    if (!(a.fileSize > 0)) fail("Súbor je prázdny.", "empty")
    const r = await callMacalyJson("/api/client-app/app-files/create-upload", {
      filename: a.filename.slice(0, 200) || "subor", contentType: a.contentType || "application/octet-stream", fileSize: a.fileSize,
      visibility: "private", protocolVersion: PROTOCOL, databaseEnvironment: env(), appSubjectId: u._id,
    })
    const g = r.upload as { fileId: string; uploadUrl: string; method: "PUT"; headers: Record<string, string>; maxBytes: number }
    if (g.maxBytes && a.fileSize > g.maxBytes) fail(`Súbor je väčší ako ${Math.floor(g.maxBytes / 1048576)} MB, nedá sa uložiť.`, "too_large")
    return { fileId: g.fileId, uploadUrl: g.uploadUrl, method: g.method, headers: g.headers }
  },
})

export const finalizeUpload = action({
  args: { token: v.string(), fileId: v.string(), name: v.string() },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx, a.token)
    const r = await callMacalyJson("/api/client-app/app-files/complete-upload", { fileId: a.fileId, protocolVersion: PROTOCOL, databaseEnvironment: env(), appSubjectId: u._id })
    const f = r.file as { fileId: string; contentType: string; fileSize: number }
    try {
      await ctx.runMutation(internal.esFiles._record, { fileId: f.fileId, ownerId: u._id, name: a.name.slice(0, 200), mime: f.contentType, size: f.fileSize })
    } catch (e) {
      await callMacalyJson("/api/client-app/app-files/delete", { fileId: f.fileId, protocolVersion: PROTOCOL, databaseEnvironment: env(), appSubjectId: u._id }).catch(() => undefined)
      throw e
    }
    return { id: f.fileId, url: "/_blob/" + f.fileId, sizeBytes: f.fileSize, contentType: f.contentType }
  },
})

/** Krátkodobá adresa na stiahnutie (len pre prihláseného; nikde sa neukladá). */
export const downloadUrl = action({
  args: { token: v.string(), fileId: v.string() },
  handler: async (ctx, a) => {
    await requireUser(ctx, a.token)
    const f = await ctx.runQuery(internal.esFiles._get, { fileId: a.fileId })
    if (!f) fail("Súbor neexistuje.", "not_found")
    const r = await callMacalyJson("/api/client-app/app-files/create-download-url", { fileId: a.fileId, protocolVersion: PROTOCOL, databaseEnvironment: env() })
    const d = r.download as { url: string; expiresAt: string | null }
    return { url: d.url, expiresAt: d.expiresAt, name: f!.name, mime: f!.mime }
  },
})

export const remove = action({
  args: { token: v.string(), fileId: v.string() },
  handler: async (ctx, a) => {
    const u = await requireUser(ctx, a.token)
    const f = await ctx.runQuery(internal.esFiles._get, { fileId: a.fileId })
    if (!f) return { ok: true }
    if (f.ownerId !== u._id && u.role !== "admin") fail("Tento súbor môže zmazať len ten, kto ho nahral, alebo administrátor.", "forbidden")
    await callMacalyJson("/api/client-app/app-files/delete", { fileId: a.fileId, protocolVersion: PROTOCOL, databaseEnvironment: env(), appSubjectId: f.ownerId })
    await ctx.runMutation(internal.esFiles._delete, { fileId: a.fileId })
    return { ok: true }
  },
})

export const _record = internalMutation({
  args: { fileId: v.string(), ownerId: v.id("esUsers"), name: v.string(), mime: v.string(), size: v.number() },
  handler: async (ctx, a) => { await ctx.db.insert("esFiles", { ...a, createdAt: Date.now() }); return null },
})
export const _get = internalQuery({
  args: { fileId: v.string() },
  handler: (ctx, { fileId }) => ctx.db.query("esFiles").withIndex("by_file", (q) => q.eq("fileId", fileId)).unique(),
})
export const _delete = internalMutation({
  args: { fileId: v.string() },
  handler: async (ctx, { fileId }) => {
    const f = await ctx.db.query("esFiles").withIndex("by_file", (q) => q.eq("fileId", fileId)).unique()
    if (f) await ctx.db.delete(f._id)
    return null
  },
})
