import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"
import { authTables } from "@convex-dev/auth/server"

// ES Prepočet: vlastní používatelia (zakladá ich administrátor), relácie, dokumenty (prepočty, profily, nastavenia) a spotreba AI.
export default defineSchema({
  ...authTables,
  esUsers: defineTable({
    email: v.string(),
    name: v.string(),
    role: v.union(v.literal("admin"), v.literal("sales")),
    passHash: v.string(),
    active: v.boolean(),
    mustChange: v.boolean(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),
  esSessions: defineTable({ token: v.string(), userId: v.id("esUsers"), expiresAt: v.number() })
    .index("by_token", ["token"])
    .index("by_user", ["userId"]),
  esLoginFails: defineTable({ key: v.string(), n: v.number(), untilAt: v.number() }).index("by_key", ["key"]),
  // dáta dokumentu sú uložené ako JSON text (kľúče s diakritikou, lomkami a hlboké vnorenie)
  esDocs: defineTable({ path: v.string(), parent: v.string(), dataJson: v.string(), version: v.number(), updatedAt: v.number() })
    .index("by_path", ["path"])
    .index("by_parent", ["parent"]),
  esAiUsage: defineTable({ userId: v.id("esUsers"), at: v.number(), model: v.string(), ok: v.boolean() }).index("by_at", ["at"]),
})
