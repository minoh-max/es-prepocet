"use strict";
// Čítanie štúdie cez AI ako úloha: požiadavka sa uloží do databázy, spracuje sa na pozadí
// a prehliadač sa každé 2 sekundy pýta na výsledok. Na Netlify tak nevadí limit 60 sekúnd na jednu požiadavku
// (úlohu spracuje funkcia na pozadí, ktorá smie bežať až 15 minút).

const crypto = require("crypto");
const { callAi, AiError } = require("./ai");

const now = () => Date.now();
const KEEP_MS = 24 * 3600e3; // hotové úlohy sa po dni zmažú
const STALE_MS = 16 * 60e3; // úloha bežiaca dlhšie ako 16 min sa považuje za stratenú

async function createJob(pool, userId, req) {
  const id = "job_" + crypto.randomBytes(12).toString("base64url");
  const token = crypto.randomBytes(24).toString("base64url");
  await pool.query(
    "INSERT INTO ai_jobs (id, user_id, token, status, request, created_at, updated_at) VALUES ($1,$2,$3,'queued',$4,$5,$5)",
    [id, userId, token, JSON.stringify(req), now()],
  );
  pool.query("DELETE FROM ai_jobs WHERE updated_at < $1", [now() - KEEP_MS]).catch(() => {});
  return { id, token };
}

/** Spracuje úlohu (len raz – druhé spustenie tej istej úlohy nič nespraví). */
async function runJob(pool, id, token) {
  const r = await pool.query(
    "UPDATE ai_jobs SET status = 'running', updated_at = $1 WHERE id = $2 AND token = $3 AND status = 'queued' RETURNING user_id, request",
    [now(), id, token],
  );
  const job = r.rows[0];
  if (!job) return false;
  const req = typeof job.request === "string" ? JSON.parse(job.request) : job.request;
  try {
    const out = await callAi(req);
    await pool.query("UPDATE ai_jobs SET status = 'done', result = $1, request = NULL, updated_at = $2 WHERE id = $3", [JSON.stringify({ value: out.result }), now(), id]);
    await pool.query("INSERT INTO ai_usage (user_id, at, model, input_tokens, output_tokens) VALUES ($1,$2,$3,$4,$5)", [job.user_id, now(), out.usage.model, out.usage.input_tokens, out.usage.output_tokens]).catch(() => {});
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError("Čítanie cez AI zlyhalo.", "failed");
    if (!(e instanceof AiError)) console.error("[ai job]", e);
    await pool.query("UPDATE ai_jobs SET status = 'error', error = $1, code = $2, request = NULL, updated_at = $3 WHERE id = $4", [err.message, err.code, now(), id]);
  }
  return true;
}

async function getJob(pool, id, userId) {
  const r = await pool.query("SELECT status, result, error, code, updated_at FROM ai_jobs WHERE id = $1 AND user_id = $2", [id, userId]);
  const j = r.rows[0];
  if (!j) return null;
  if ((j.status === "running" || j.status === "queued") && now() - Number(j.updated_at) > STALE_MS) {
    return { status: "error", error: "Čítanie cez AI sa nedokončilo. Skúste to znova.", code: "stale" };
  }
  const result = typeof j.result === "string" ? JSON.parse(j.result) : j.result;
  return { status: j.status, result: result ? result.value : undefined, error: j.error || undefined, code: j.code || undefined };
}

module.exports = { createJob, runJob, getJob };
