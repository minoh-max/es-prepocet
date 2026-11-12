"use strict";
// Pripojenie k PostgreSQL a vytvorenie tabuliek. V testoch sa namiesto skutočnej databázy použije pg-mem.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'sales',
    pass_hash TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS docs (
    path TEXT PRIMARY KEY,
    parent TEXT NOT NULL,
    data JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS docs_parent ON docs (parent)`,
  `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BYTEA NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ai_usage (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    at BIGINT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS login_fails (
    key TEXT PRIMARY KEY,
    n INTEGER NOT NULL,
    until_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ai_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL,
    status TEXT NOT NULL,
    request JSONB,
    result JSONB,
    error TEXT,
    code TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
];

async function createPool(opts = {}) {
  let pool;
  if (opts.memory) {
    const { newDb } = require("pg-mem");
    const mem = newDb();
    const { Pool } = mem.adapters.createPg();
    pool = new Pool();
  } else {
    const { Pool } = require("pg");
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Chýba premenná DATABASE_URL (pripojenie k databáze PostgreSQL).");
    const local = /localhost|127\.0\.0\.1/.test(url);
    // Na Netlify beží každá funkcia zvlášť, preto len pár spojení (Neon ich zdieľa cez „pooled“ adresu).
    pool = new Pool({
      connectionString: url,
      ssl: local || process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
      max: opts.max || 10,
      idleTimeoutMillis: opts.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: 15000,
    });
    pool.on("error", (e) => console.error("[db]", e.message));
  }
  if (opts.memory) for (const sql of SCHEMA) await pool.query(sql);
  else {
    // jedna požiadavka = rýchlejší štart funkcie; dve funkcie štartujúce naraz sa môžu zraziť → skús znova
    try { await pool.query(SCHEMA.join(";\n")); }
    catch (e) { if (!["23505", "42P07"].includes(e.code)) throw e; await new Promise((r) => setTimeout(r, 300)); await pool.query(SCHEMA.join(";\n")); }
  }
  return pool;
}

module.exports = { createPool };
