"use strict";
// HTTP rozhranie ES Prepočet: prihlásenie, používatelia, dokumenty (prepočty, profily, nastavenia), súbory a AI.

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { callAi, AiError, LIMITS } = require("./ai");
const jobs = require("./jobs");

const SESSION_DAYS = 30;
const COOKIE = "es_session";
const ROLES = ["admin", "sales"];
const newId = (p) => p + "_" + crypto.randomBytes(12).toString("base64url");
const now = () => Date.now();
const normEmail = (e) => String(e || "").trim().toLowerCase();
const validPath = (p) => typeof p === "string" && /^[A-Za-z0-9_\-.~:@+]{1,200}(\/[A-Za-z0-9_\-.~:@+]{1,200}){0,14}$/.test(p) && !p.split("/").some((s) => s === "." || s === "..");

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, mustChange: u.must_change, itemized: !!u.itemized, createdAt: Number(u.created_at) };
}

function parseCookies(h) {
  const out = {};
  String(h || "").split(";").forEach((p) => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}

/** Kto smie zapisovať: admin všetko; obchodník len svoj profil a svoje prepočty. Čítať môže každý prihlásený. */
function canWrite(user, docPath) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return docPath === "profiles/" + user.id || docPath.startsWith("estimates/" + user.id + "/");
}

/**
 * opts: secureCookies, publicDir, serveStatic (false na Netlify – súbory posiela Netlify sám),
 *       maxUploadBytes (limit nahrávaného súboru), aiLimits (doplnenie limitov pre prehliadač),
 *       dispatchJob(job, req) – spustenie AI úlohy (predvolene hneď na tomto serveri).
 */
function createApp(pool, opts = {}) {
  const app = express();
  const secure = opts.secureCookies ?? process.env.NODE_ENV === "production";
  const publicDir = opts.publicDir || path.join(__dirname, "..", "public");
  const maxUpload = opts.maxUploadBytes || 30 * 1024 * 1024;
  const aiLimits = { ...LIMITS, ...(opts.aiLimits || {}), images: { ...LIMITS.images, ...((opts.aiLimits && opts.aiLimits.images) || {}) } };
  const dispatchJob = opts.dispatchJob || (async (job) => { setImmediate(() => jobs.runJob(pool, job.id, job.token).catch((e) => console.error("[ai job]", e))); });
  const clientIp = (req) => String(req.headers["x-nf-client-connection-ip"] || req.ip || "");
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    next();
  });

  // ---- session ----
  async function loadUser(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const r = await pool.query("SELECT u.* , s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1", [token]);
    const row = r.rows[0];
    if (!row || Number(row.expires_at) < now() || !row.active) return null;
    // posuň platnosť, ak je za polovicou
    if (Number(row.expires_at) - now() < (SESSION_DAYS / 2) * 864e5) {
      await pool.query("UPDATE sessions SET expires_at = $1 WHERE token = $2", [now() + SESSION_DAYS * 864e5, token]);
    }
    row.token = token;
    return row;
  }
  const auth = (role) => async (req, res, next) => {
    try {
      const u = await loadUser(req);
      if (!u) return res.status(401).json({ error: "Nie ste prihlásený.", code: "unauthenticated" });
      if (role === "admin" && u.role !== "admin") return res.status(403).json({ error: "Na túto akciu potrebujete práva administrátora.", code: "forbidden" });
      req.user = u;
      next();
    } catch (e) { next(e); }
  };
  function setCookie(res, token, maxAgeMs) {
    res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? "; Secure" : ""}`);
  }

  const json = express.json({ limit: "40mb" });

  // ---- prihlásenie ----
  // neúspešné pokusy sú v databáze, aby zámok platil aj keď beží viac kópií servera (Netlify)
  app.post("/api/auth/login", json, async (req, res, next) => {
    try {
      const email = normEmail(req.body && req.body.email);
      const password = String((req.body && req.body.password) || "");
      const key = (email + "|" + clientIp(req)).slice(0, 300);
      const fr = await pool.query("SELECT n, until_at FROM login_fails WHERE key = $1", [key]);
      const f = fr.rows[0] ? { n: Number(fr.rows[0].n), until: Number(fr.rows[0].until_at) } : null;
      if (f && f.n >= 5 && f.until > now()) return res.status(429).json({ error: "Priveľa neúspešných pokusov. Skúste to znova o 15 minút.", code: "locked" });
      const r = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
      const u = r.rows[0];
      const ok = u && u.active && (await bcrypt.compare(password, u.pass_hash));
      if (!ok) {
        const n = (f && f.until > now() ? f.n : 0) + 1;
        if (f) await pool.query("UPDATE login_fails SET n = $1, until_at = $2 WHERE key = $3", [n, now() + 15 * 60e3, key]);
        else await pool.query("INSERT INTO login_fails (key, n, until_at) VALUES ($1, $2, $3)", [key, n, now() + 15 * 60e3]);
        await pool.query("DELETE FROM login_fails WHERE until_at < $1", [now()]);
        return res.status(401).json({ error: "Nesprávny e-mail alebo heslo.", code: "bad_credentials" });
      }
      if (f) await pool.query("DELETE FROM login_fails WHERE key = $1", [key]);
      const token = crypto.randomBytes(32).toString("base64url");
      await pool.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [token, u.id, now() + SESSION_DAYS * 864e5]);
      await pool.query("DELETE FROM sessions WHERE expires_at < $1", [now()]);
      setCookie(res, token, SESSION_DAYS * 864e5);
      res.json({ user: publicUser(u) });
    } catch (e) { next(e); }
  });
  app.post("/api/auth/logout", async (req, res, next) => {
    try {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
      setCookie(res, "", 0);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  app.get("/api/auth/me", auth(), (req, res) => res.json({ user: publicUser(req.user) }));
  app.post("/api/auth/password", json, auth(), async (req, res, next) => {
    try {
      const { current, next: pw } = req.body || {};
      if (!(await bcrypt.compare(String(current || ""), req.user.pass_hash))) return res.status(400).json({ error: "Súčasné heslo nie je správne.", code: "bad_password" });
      if (String(pw || "").length < 8) return res.status(400).json({ error: "Nové heslo musí mať aspoň 8 znakov.", code: "weak_password" });
      await pool.query("UPDATE users SET pass_hash = $1, must_change = FALSE WHERE id = $2", [await bcrypt.hash(String(pw), 10), req.user.id]);
      await pool.query("DELETE FROM sessions WHERE user_id = $1 AND token <> $2", [req.user.id, req.user.token]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // Overenie hesla pred odomknutím položkového rozpočtu (prístup má admin alebo používateľ, ktorému ho admin povolil).
  app.post("/api/auth/verify", json, auth(), async (req, res, next) => {
    try {
      const u = req.user;
      if (u.role !== "admin" && !u.itemized) return res.status(403).json({ error: "Prístup k položkovému rozpočtu vám musí povoliť administrátor.", code: "forbidden" });
      const key = ("verify|" + u.id).slice(0, 300);
      const fr = await pool.query("SELECT n, until_at FROM login_fails WHERE key = $1", [key]);
      const f = fr.rows[0] ? { n: Number(fr.rows[0].n), until: Number(fr.rows[0].until_at) } : null;
      if (f && f.n >= 5 && f.until > now()) return res.status(429).json({ error: "Priveľa neúspešných pokusov. Skúste to znova o 15 minút.", code: "locked" });
      if (!(await bcrypt.compare(String((req.body && req.body.password) || ""), u.pass_hash))) {
        const n = (f && f.until > now() ? f.n : 0) + 1;
        if (f) await pool.query("UPDATE login_fails SET n = $1, until_at = $2 WHERE key = $3", [n, now() + 15 * 60e3, key]);
        else await pool.query("INSERT INTO login_fails (key, n, until_at) VALUES ($1, $2, $3)", [key, n, now() + 15 * 60e3]);
        return res.status(401).json({ error: "Nesprávne heslo.", code: "bad_password" });
      }
      if (f) await pool.query("DELETE FROM login_fails WHERE key = $1", [key]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---- správa používateľov (admin) ----
  app.get("/api/users", auth("admin"), async (req, res, next) => {
    try {
      const r = await pool.query("SELECT * FROM users ORDER BY created_at");
      const since = new Date(); since.setDate(1); since.setHours(0, 0, 0, 0);
      const u = await pool.query("SELECT user_id, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens FROM ai_usage WHERE at >= $1 GROUP BY user_id", [since.getTime()]);
      const usage = {}; u.rows.forEach((x) => (usage[x.user_id] = { calls: Number(x.calls), inputTokens: Number(x.input_tokens || 0), outputTokens: Number(x.output_tokens || 0) }));
      res.json({ users: r.rows.map((x) => ({ ...publicUser(x), aiThisMonth: usage[x.id] || { calls: 0, inputTokens: 0, outputTokens: 0 } })) });
    } catch (e) { next(e); }
  });
  app.post("/api/users", json, auth("admin"), async (req, res, next) => {
    try {
      const email = normEmail(req.body.email), name = String(req.body.name || "").trim(), role = ROLES.includes(req.body.role) ? req.body.role : "sales";
      const pw = String(req.body.password || "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Zadajte platný e-mail.", code: "bad_email" });
      if (pw.length < 8) return res.status(400).json({ error: "Heslo musí mať aspoň 8 znakov.", code: "weak_password" });
      const ex = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
      if (ex.rows.length) return res.status(409).json({ error: "Používateľ s týmto e-mailom už existuje.", code: "exists" });
      const id = newId("u");
      await pool.query("INSERT INTO users (id, email, name, role, pass_hash, active, must_change, created_at) VALUES ($1,$2,$3,$4,$5,TRUE,TRUE,$6)", [id, email, name, role, await bcrypt.hash(pw, 10), now()]);
      const r = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
      res.status(201).json({ user: publicUser(r.rows[0]) });
    } catch (e) { next(e); }
  });
  app.patch("/api/users/:id", json, auth("admin"), async (req, res, next) => {
    try {
      const r = await pool.query("SELECT * FROM users WHERE id = $1", [req.params.id]);
      const u = r.rows[0];
      if (!u) return res.status(404).json({ error: "Používateľ neexistuje.", code: "not_found" });
      const b = req.body || {};
      if (u.id === req.user.id && (b.active === false || (b.role && b.role !== "admin"))) return res.status(400).json({ error: "Svoj vlastný účet nemôžete deaktivovať ani mu odobrať práva administrátora.", code: "self" });
      if (b.name !== undefined) await pool.query("UPDATE users SET name = $1 WHERE id = $2", [String(b.name).trim(), u.id]);
      if (b.role !== undefined && ROLES.includes(b.role)) await pool.query("UPDATE users SET role = $1 WHERE id = $2", [b.role, u.id]);
      if (b.itemized !== undefined) await pool.query("UPDATE users SET itemized = $1 WHERE id = $2", [!!b.itemized, u.id]);
      if (b.active !== undefined) {
        await pool.query("UPDATE users SET active = $1 WHERE id = $2", [!!b.active, u.id]);
        if (!b.active) await pool.query("DELETE FROM sessions WHERE user_id = $1", [u.id]);
      }
      if (b.password !== undefined) {
        if (String(b.password).length < 8) return res.status(400).json({ error: "Heslo musí mať aspoň 8 znakov.", code: "weak_password" });
        await pool.query("UPDATE users SET pass_hash = $1, must_change = TRUE WHERE id = $2", [await bcrypt.hash(String(b.password), 10), u.id]);
        await pool.query("DELETE FROM sessions WHERE user_id = $1", [u.id]);
      }
      const r2 = await pool.query("SELECT * FROM users WHERE id = $1", [u.id]);
      res.json({ user: publicUser(r2.rows[0]) });
    } catch (e) { next(e); }
  });

  // ---- dokumenty (rovnaký model ako v Claude: kolekcia/dokument/…) ----
  const docOut = (row) => ({ id: row.path.split("/").pop(), path: row.path, exists: true, data: row.data, version: row.version, updatedAt: Number(row.updated_at) });
  const calc = require("./calc");
  async function readConfig() {
    const r = await pool.query("SELECT data FROM docs WHERE path = $1", ["config/app"]);
    return (r.rows[0] && r.rows[0].data) || {};
  }
  async function activePriceList(cfg) {
    const id = cfg && cfg.priceList && cfg.priceList.assetId;
    if (!id) return null;
    const r = await pool.query("SELECT data FROM assets WHERE id = $1", [id]);
    try { return r.rows[0] ? JSON.parse(Buffer.from(r.rows[0].data).toString("utf8")) : null; } catch (e) { return null; }
  }
  // Výpočet odhadu na serveri (obchodník nedostáva číselník s výrobnými cenami).
  app.post("/api/calc", json, auth(), async (req, res, next) => {
    try {
      const u = req.user, draft = (req.body && req.body.draft) || {};
      const cfg = await readConfig();
      const out = calc.calculate({ draft, config: cfg, priceList: await activePriceList(cfg), costs: u.role === "admin", itemized: !!(req.body && req.body.itemized) && (u.role === "admin" || !!u.itemized) });
      res.json(out);
    } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message, code: e.code }); next(e); }
  });
  // Číselník: administrátor celý, ostatní bez výrobných cien (názvy pre výber materiálu + ceny prípojok).
  app.get("/data/ciselnik.json", auth(), (req, res, next) => {
    try {
      const full = calc.load().ciselnik;
      res.setHeader("Cache-Control", "private, no-store");
      res.json(req.user.role === "admin" ? full : calc.stripPriceList(full));
    } catch (e) { next(e); }
  });

  app.get("/api/doc", auth(), async (req, res, next) => {
    try {
      const p = String(req.query.path || "");
      if (!validPath(p) || p.split("/").length % 2) return res.status(400).json({ error: "Neplatná cesta dokumentu.", code: "bad_path" });
      const r = await pool.query("SELECT * FROM docs WHERE path = $1", [p]);
      const out = r.rows[0] ? docOut(r.rows[0]) : { id: p.split("/").pop(), path: p, exists: false, data: null };
      // nastavenia firmy: obchodník nedostane úpravy cien číselníka ani sadzby výpočtu
      if (p === "config/app" && req.user.role !== "admin" && out.data) out.data = calc.stripConfig(out.data);
      res.json(out);
    } catch (e) { next(e); }
  });
  app.get("/api/collection", auth(), async (req, res, next) => {
    try {
      const p = String(req.query.path || "");
      if (!validPath(p) || p.split("/").length % 2 === 0) return res.status(400).json({ error: "Neplatná cesta kolekcie.", code: "bad_path" });
      const r = await pool.query("SELECT * FROM docs WHERE parent = $1", [p]);
      let docs = r.rows.map(docOut);
      const field = req.query.orderBy ? String(req.query.orderBy) : null;
      if (field) {
        const dir = req.query.dir === "desc" ? -1 : 1;
        docs.sort((a, b) => { const x = a.data[field], y = b.data[field]; return (x === y ? 0 : x == null ? 1 : y == null ? -1 : x < y ? -1 : 1) * dir; });
      }
      const limit = Math.min(1000, Number(req.query.limit) || 1000);
      res.json({ docs: docs.slice(0, limit) });
    } catch (e) { next(e); }
  });
  async function writeDoc(req, res, mode) {
    const p = String((req.body && req.body.path) || req.query.path || "");
    if (!validPath(p) || p.split("/").length % 2) return res.status(400).json({ error: "Neplatná cesta dokumentu.", code: "bad_path" });
    if (!canWrite(req.user, p)) return res.status(403).json({ error: "Na zmenu tohto záznamu nemáte oprávnenie.", code: "forbidden" });
    const parent = p.split("/").slice(0, -1).join("/");
    const cur = (await pool.query("SELECT * FROM docs WHERE path = $1", [p])).rows[0];
    if (mode === "delete") {
      await pool.query("DELETE FROM docs WHERE path = $1", [p]);
      return res.json({ ok: true });
    }
    const incoming = req.body && req.body.data;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return res.status(400).json({ error: "Chýbajú údaje dokumentu.", code: "bad_data" });
    let data = mode === "update" && cur ? { ...cur.data, ...incoming } : incoming;
    if (mode === "update") for (const k of Object.keys(incoming)) if (incoming[k] && incoming[k].__delete__ === true) delete data[k];
    if (JSON.stringify(data).length > 5_000_000) return res.status(413).json({ error: "Záznam je príliš veľký.", code: "too_large" });
    if (cur) await pool.query("UPDATE docs SET data = $1, version = version + 1, updated_at = $2 WHERE path = $3", [JSON.stringify(data), now(), p]);
    else await pool.query("INSERT INTO docs (path, parent, data, version, updated_at) VALUES ($1, $2, $3, 1, $4)", [p, parent, JSON.stringify(data), now()]);
    const r = await pool.query("SELECT * FROM docs WHERE path = $1", [p]);
    res.json(docOut(r.rows[0]));
  }
  app.put("/api/doc", json, auth(), (req, res, next) => writeDoc(req, res, "set").catch(next));
  app.patch("/api/doc", json, auth(), (req, res, next) => writeDoc(req, res, "update").catch(next));
  app.delete("/api/doc", auth(), (req, res, next) => writeDoc(req, res, "delete").catch(next));

  // ---- súbory (logo, podklady prepočtu, importovaný číselník) ----
  app.post("/api/assets", auth(), (req, res, next) => {
    const len = Number(req.headers["content-length"] || 0);
    if (len > maxUpload) return res.status(413).json({ error: `Súbor je väčší ako ${String(Math.floor(maxUpload / 1048576 * 10) / 10).replace(".", ",")} MB, nedá sa uložiť.`, code: "too_large" });
    next();
  }, express.raw({ type: () => true, limit: maxUpload }), async (req, res, next) => {
    try {
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: "Súbor je prázdny.", code: "empty" });
      const id = crypto.randomBytes(16).toString("hex");
      const name = decodeURIComponent(String(req.headers["x-file-name"] || "")).slice(0, 200);
      const mime = String(req.headers["content-type"] || "application/octet-stream").slice(0, 100);
      await pool.query("INSERT INTO assets (id, owner_id, name, mime, size, data, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, req.user.id, name, mime, buf.length, buf, now()]);
      res.status(201).json({ id, url: "/_blob/" + id, sizeBytes: buf.length });
    } catch (e) { next(e); }
  });
  app.get("/_blob/:id", auth(), async (req, res, next) => {
    try {
      if (!/^[0-9a-f]{32}$/.test(req.params.id)) return res.status(404).end();
      if (req.user.role !== "admin") {
        const cfg = await readConfig();
        if (cfg.priceList && cfg.priceList.assetId === req.params.id) return res.status(403).json({ error: "Číselník je dostupný len administrátorovi.", code: "forbidden" });
      }
      const r = await pool.query("SELECT mime, name, data FROM assets WHERE id = $1", [req.params.id]);
      const a = r.rows[0];
      if (!a) return res.status(404).end();
      res.setHeader("Content-Type", a.mime);
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      if (a.name) res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(a.name)}`);
      res.end(Buffer.from(a.data));
    } catch (e) { next(e); }
  });

  // ---- AI: čítanie štúdií a zhrnutie ----
  app.get("/api/ai/limits", auth(), (req, res) => res.json({ ...aiLimits, jobs: true, configured: !!process.env.ANTHROPIC_API_KEY || process.env.AI_MOCK === "1" }));
  function aiRequest(b) {
    if (typeof b.prompt !== "string" || !b.prompt) throw new AiError("Chýba zadanie pre AI.", "bad_request", 400);
    if (Buffer.byteLength(b.prompt) > LIMITS.maxPromptBytes) throw new AiError("Zadanie pre AI je príliš dlhé.", "too_large", 413);
    const images = Array.isArray(b.images) ? b.images.filter((x) => x && typeof x.data === "string").map((x) => ({ data: x.data, mediaType: String(x.mediaType || "image/jpeg") })) : [];
    if (images.length > LIMITS.images.maxCount) throw new AiError("Priveľa obrázkov v jednej požiadavke.", "too_many_images", 400);
    return { prompt: b.prompt, images, json: !!b.json, tier: b.tier === "quick" ? "quick" : "complex" };
  }
  // úloha: založ → spracuje sa na pozadí → prehliadač sa pýta na výsledok
  app.post("/api/ai/jobs", json, auth(), async (req, res, next) => {
    try {
      if (!process.env.ANTHROPIC_API_KEY && process.env.AI_MOCK !== "1") throw new AiError("Čítanie štúdií nie je nastavené – chýba kľúč ANTHROPIC_API_KEY na serveri.", "not_configured", 503);
      const job = await jobs.createJob(pool, req.user.id, aiRequest(req.body || {}));
      await dispatchJob(job, req);
      res.status(202).json({ id: job.id, status: "queued" });
    } catch (e) {
      if (e instanceof AiError) return res.status(e.status || 400).json({ error: e.message, code: e.code });
      next(e);
    }
  });
  app.get("/api/ai/jobs/:id", auth(), async (req, res, next) => {
    try {
      const j = await jobs.getJob(pool, String(req.params.id), req.user.id);
      if (!j) return res.status(404).json({ error: "Úloha neexistuje.", code: "not_found" });
      res.json(j);
    } catch (e) { next(e); }
  });
  app.post("/api/ai", json, auth(), async (req, res) => {
    const b = req.body || {};
    try {
      const out = await callAi(aiRequest(b));
      pool.query("INSERT INTO ai_usage (user_id, at, model, input_tokens, output_tokens) VALUES ($1,$2,$3,$4,$5)", [req.user.id, now(), out.usage.model, out.usage.input_tokens, out.usage.output_tokens]).catch(() => {});
      res.json({ result: out.result });
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError("Čítanie cez AI zlyhalo.", "failed");
      if (!(e instanceof AiError)) console.error("[ai]", e);
      res.status(err.status || 502).json({ error: err.message, code: err.code });
    }
  });

  app.get("/healthz", (req, res) => res.json({ ok: true }));

  // ---- statické súbory aplikácie ----
  if (opts.serveStatic !== false) app.use(express.static(publicDir, {
    index: "index.html",
    setHeaders: (res, file) => {
      if (/\.(json|js|css)$/.test(file) && /[\\/]data[\\/]/.test(file)) res.setHeader("Cache-Control", "public, max-age=86400");
      else if (/index\.html$/.test(file)) res.setHeader("Cache-Control", "no-cache");
    },
  }));

  app.use((err, req, res, next) => {
    console.error("[error]", err);
    if (res.headersSent) return next(err);
    res.status(err.status === 413 ? 413 : 500).json({ error: err.status === 413 ? "Súbor alebo požiadavka je príliš veľká." : "Na serveri nastala chyba. Skúste to znova.", code: "server_error" });
  });
  return app;
}

/** Pri prvom spustení vytvorí administrátora z ADMIN_EMAIL a ADMIN_PASSWORD. */
async function ensureAdmin(pool, email, password) {
  const r = await pool.query("SELECT COUNT(*) AS n FROM users");
  if (Number(r.rows[0].n) > 0) return false;
  if (!email || !password) { console.warn("[setup] Žiadny používateľ – nastavte ADMIN_EMAIL a ADMIN_PASSWORD a reštartujte."); return false; }
  await pool.query("INSERT INTO users (id, email, name, role, pass_hash, active, must_change, created_at) VALUES ($1,$2,$3,'admin',$4,TRUE,FALSE,$5)", [newId("u"), normEmail(email), "Administrátor", await bcrypt.hash(String(password), 10), now()]);
  console.log("[setup] Vytvorený administrátor " + normEmail(email));
  return true;
}

module.exports = { createApp, ensureAdmin, canWrite };
