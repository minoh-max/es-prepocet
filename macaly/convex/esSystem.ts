import { v, ConvexError } from "convex/values"
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server"
import { internal } from "./_generated/api"
import { callMacalyJson } from "./macaly"

// ES Prepočet – systémové súbory. Číselník s výrobnými cenami nie je verejný súbor:
// je v súkromnom úložisku Macaly a prihlásený používateľ dostane len krátkodobú adresu.
const PROTOCOL = "bindings_v1" as const
const env = () => (process.env.MACALY_DATABASE_ENVIRONMENT === "development" ? "development" : "production")
const SYS = "system/files"

export const _getSystem = internalQuery({
  args: {},
  handler: async (ctx) => {
    const d = await ctx.db.query("esDocs").withIndex("by_path", (q) => q.eq("path", SYS)).unique()
    return d ? (JSON.parse(d.dataJson) as Record<string, string>) : {}
  },
})

export const _setSystem = internalMutation({
  args: { key: v.string(), fileId: v.string() },
  handler: async (ctx, { key, fileId }) => {
    const d = await ctx.db.query("esDocs").withIndex("by_path", (q) => q.eq("path", SYS)).unique()
    const data = { ...(d ? JSON.parse(d.dataJson) : {}), [key]: fileId }
    if (d) await ctx.db.patch(d._id, { dataJson: JSON.stringify(data), version: d.version + 1, updatedAt: Date.now() })
    else await ctx.db.insert("esDocs", { path: SYS, parent: "system", dataJson: JSON.stringify(data), version: 1, updatedAt: Date.now() })
    return null
  },
})

/** Nahrá číselník (JSON) do súkromného úložiska. Spúšťa sa len cez `npx convex run esSystem:_storePriceList`. */
export const _storePriceList = internalAction({
  args: { json: v.string(), ownerEmail: v.string() },
  handler: async (ctx, a) => {
    const owner = await ctx.runQuery(internal.es._userByEmail, { email: a.ownerEmail.toLowerCase() })
    if (!owner) throw new Error("Vlastník neexistuje")
    const body = new TextEncoder().encode(a.json)
    const r = await callMacalyJson("/api/client-app/app-files/create-upload", {
      filename: "ciselnik.json", contentType: "application/json", fileSize: body.byteLength,
      visibility: "private", protocolVersion: PROTOCOL, databaseEnvironment: env(), appSubjectId: owner._id,
    })
    const g = r.upload as { fileId: string; uploadUrl: string; method: string; headers: Record<string, string> }
    const put = await fetch(g.uploadUrl, { method: g.method, headers: g.headers, body })
    if (!put.ok) throw new Error("Nahratie zlyhalo " + put.status)
    const c = await callMacalyJson("/api/client-app/app-files/complete-upload", { fileId: g.fileId, protocolVersion: PROTOCOL, databaseEnvironment: env(), appSubjectId: owner._id })
    const f = c.file as { fileId: string; contentType: string; fileSize: number }
    await ctx.runMutation(internal.esFiles._record, { fileId: f.fileId, ownerId: owner._id, name: "ciselnik.json", mime: f.contentType, size: f.fileSize })
    await ctx.runMutation(internal.esSystem._setSystem, { key: "ciselnik", fileId: f.fileId })
    return { fileId: f.fileId, size: f.fileSize }
  },
})

/** Krátkodobá adresa základného číselníka – len pre prihláseného. */
export const priceListUrl = action({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    const u = await ctx.runQuery(internal.es._sessionUser, { token: a.token })
    if (!u) throw new ConvexError({ message: "Nie ste prihlásený.", code: "unauthenticated" })
    const sys = await ctx.runQuery(internal.esSystem._getSystem, {})
    if (!sys.ciselnik) throw new ConvexError({ message: "Číselník nie je nahratý.", code: "not_found" })
    const r = await callMacalyJson("/api/client-app/app-files/create-download-url", { fileId: sys.ciselnik, protocolVersion: PROTOCOL, databaseEnvironment: env() })
    return { url: (r.download as { url: string }).url }
  },
})
