"use strict";
// Spoločné pre Netlify funkcie: jedno pripojenie k databáze na kópiu funkcie, vytvorenie tabuliek a administrátora.

const serverless = require("serverless-http");
const { createPool } = require("./db");
const { createApp, ensureAdmin } = require("./app");
const jobs = require("./jobs");

// Netlify: požiadavka najviac 6 MB, preto obrázky výkresov spolu najviac ~4,5 MB (v base64) a súbory do 4,4 MB.
const UPLOAD_MAX = 4.4 * 1024 * 1024;
const AI_LIMITS = { images: { maxCount: 16, maxTotalBase64: 4_500_000 } };
const BACKGROUND_FN = "/.netlify/functions/ai-worker-background";

let poolP = null;
function getPool() {
  if (!poolP) {
    poolP = (async () => {
      const pool = await createPool({ memory: process.env.DATABASE_URL === "memory", max: 3, idleTimeoutMillis: 10000 });
      await ensureAdmin(pool, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
      return pool;
    })().catch((e) => { poolP = null; throw e; });
  }
  return poolP;
}

/** Odovzdá AI úlohu funkcii na pozadí. Keby to nešlo, spracuje ju hneď (max. 60 s). */
async function dispatchToBackground(pool, job, req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const origin = process.env.ES_INTERNAL_ORIGIN || `${proto}://${req.headers.host}`;
  try {
    const r = await fetch(origin + BACKGROUND_FN, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: job.id, token: job.token }),
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 202 || r.ok) return;
    console.warn("[ai job] funkcia na pozadí odpovedala " + r.status + ", spracúvam hneď");
  } catch (e) {
    console.warn("[ai job] funkcia na pozadí nedostupná (" + e.message + "), spracúvam hneď");
  }
  await jobs.runJob(pool, job.id, job.token);
}

const json = (statusCode, body) => ({ statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });

let apiP = null;
function getApi() {
  if (!apiP) {
    apiP = getPool().then((pool) => {
      const app = createApp(pool, {
        secureCookies: process.env.NETLIFY_DEV !== "true",
        serveStatic: false,
        maxUploadBytes: UPLOAD_MAX,
        aiLimits: AI_LIMITS,
        dispatchJob: (job, req) => dispatchToBackground(pool, job, req),
      });
      // binárne odpovede (logo, PDF podklady) posiela Netlify v base64
      return serverless(app, { binary: (headers) => !/^(application\/json|text\/)/i.test(String(headers["content-type"] || "")) });
    }).catch((e) => { apiP = null; throw e; });
  }
  return apiP;
}

/** Netlify posiela cestu buď pôvodnú (/api/...), alebo s predponou funkcie (/.netlify/functions/api/api/...). */
function normalizePath(event) {
  const strip = (p) => String(p || "/").replace(/^\/\.netlify\/functions\/api(?=\/|$)/, "") || "/";
  event.path = strip(event.path);
  if (event.rawPath) event.rawPath = strip(event.rawPath);
  return event;
}

async function apiHandler(event, context) {
  if (context) context.callbackWaitsForEmptyEventLoop = false;
  let handle;
  try { handle = await getApi(); }
  catch (e) {
    console.error("[start]", e);
    return json(503, { error: "Server sa nepodarilo spustiť: " + (e.message || "chyba databázy") + ". Skontrolujte DATABASE_URL v nastaveniach Netlify.", code: "startup" });
  }
  return handle(normalizePath(event), context);
}

async function workerHandler(event, context) {
  if (context) context.callbackWaitsForEmptyEventLoop = false;
  let b = {};
  try { b = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString() : event.body || "{}"); } catch (e) { /* prázdne */ }
  if (!b.id || !b.token) return { statusCode: 400, body: "" };
  const pool = await getPool();
  await jobs.runJob(pool, String(b.id), String(b.token));
  return { statusCode: 200, body: "" };
}

module.exports = { apiHandler, workerHandler, normalizePath, getPool };
