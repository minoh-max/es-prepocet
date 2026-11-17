"use strict";
// Testy servera: prihlásenie, oprávnenia, dokumenty, súbory, AI (testovacia odpoveď).
const test = require("node:test");
const assert = require("node:assert");
const { createPool } = require("../server/db");
const { createApp, ensureAdmin } = require("../server/app");

process.env.AI_MOCK = "1";
let base, srv;
const jar = {};
async function call(who, method, url, body, headers = {}) {
  const h = { ...headers };
  if (jar[who]) h.cookie = jar[who];
  if (body !== undefined && !Buffer.isBuffer(body)) { h["content-type"] = "application/json"; body = JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers: h, body });
  const sc = r.headers.get("set-cookie"); if (sc) jar[who] = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = t; }
  return { status: r.status, body: j };
}

test.before(async () => {
  // TEST_DATABASE_URL=postgres://… → testy proti skutočnému PostgreSQL (tabuľky sa vymažú), inak databáza v pamäti
  const real = process.env.TEST_DATABASE_URL;
  if (real) {
    process.env.DATABASE_URL = real;
    const { Pool } = require("pg");
    const p = new Pool({ connectionString: real });
    await p.query("DROP TABLE IF EXISTS users, sessions, docs, assets, ai_usage, login_fails, ai_jobs");
    await p.end();
  }
  const pool = await createPool({ memory: !real });
  await ensureAdmin(pool, "Admin@Firma.sk", "heslo12345");
  srv = createApp(pool, { secureCookies: false }).listen(0);
  base = "http://localhost:" + srv.address().port;
});
test.after(() => { srv.close(); if (process.env.TEST_DATABASE_URL) setTimeout(() => process.exit(0), 100); });

test("prihlásenie: zlé heslo, správne heslo, me", async () => {
  assert.equal((await call("a", "GET", "/api/auth/me")).status, 401);
  assert.equal((await call("a", "POST", "/api/auth/login", { email: "admin@firma.sk", password: "zle" })).status, 401);
  const ok = await call("a", "POST", "/api/auth/login", { email: " ADMIN@firma.sk ", password: "heslo12345" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.role, "admin");
  assert.equal((await call("a", "GET", "/api/auth/me")).body.user.email, "admin@firma.sk");
});

test("admin zakladá obchodníka, ten musí zmeniť heslo", async () => {
  const c = await call("a", "POST", "/api/users", { name: "Ján", email: "jan@firma.sk", role: "sales", password: "docasne123" });
  assert.equal(c.status, 201);
  assert.equal((await call("a", "POST", "/api/users", { name: "Ján", email: "jan@firma.sk", password: "docasne123" })).status, 409);
  const l = await call("j", "POST", "/api/auth/login", { email: "jan@firma.sk", password: "docasne123" });
  assert.equal(l.body.user.mustChange, true);
  assert.equal((await call("j", "POST", "/api/auth/password", { current: "docasne123", next: "kratke" })).status, 400);
  assert.equal((await call("j", "POST", "/api/auth/password", { current: "docasne123", next: "noveheslo1" })).status, 200);
  assert.equal((await call("j", "GET", "/api/auth/me")).body.user.mustChange, false);
  assert.equal((await call("j", "GET", "/api/users")).status, 403);
});

test("položkový rozpočet: prístup povoľuje admin, odomknutie heslom", async () => {
  assert.equal((await call("j", "POST", "/api/auth/verify", { password: "noveheslo1" })).status, 403);
  const jan = (await call("j", "GET", "/api/auth/me")).body.user;
  assert.equal(jan.itemized, false);
  assert.equal((await call("j", "PATCH", "/api/users/" + jan.id, { itemized: true })).status, 403);
  const p = await call("a", "PATCH", "/api/users/" + jan.id, { itemized: true });
  assert.equal(p.status, 200); assert.equal(p.body.user.itemized, true);
  assert.equal((await call("j", "GET", "/api/auth/me")).body.user.itemized, true);
  assert.equal((await call("j", "POST", "/api/auth/verify", { password: "zle-heslo" })).status, 401);
  assert.equal((await call("j", "POST", "/api/auth/verify", { password: "noveheslo1" })).status, 200);
  assert.equal((await call("a", "POST", "/api/auth/verify", { password: "heslo12345" })).status, 200);
  assert.equal((await call("a", "PATCH", "/api/users/" + jan.id, { itemized: false })).body.user.itemized, false);
  assert.equal((await call("j", "POST", "/api/auth/verify", { password: "noveheslo1" })).status, 403);
});

test("oprávnenia dokumentov: obchodník len svoje, admin všetko", async () => {
  const me = (await call("j", "GET", "/api/auth/me")).body.user;
  assert.equal((await call("j", "PUT", "/api/doc", { path: "config/app", data: { a: 1 } })).status, 403);
  assert.equal((await call("j", "PUT", "/api/doc", { path: `estimates/${me.id}/list/e1`, data: { updatedAt: 2, x: 1 } })).status, 200);
  assert.equal((await call("j", "PUT", "/api/doc", { path: `estimates/${me.id}/list/e2`, data: { updatedAt: 5, x: 2 } })).status, 200);
  assert.equal((await call("j", "PUT", "/api/doc", { path: "estimates/u_iny/list/e1", data: { x: 1 } })).status, 403);
  const up = await call("j", "PATCH", "/api/doc", { path: `estimates/${me.id}/list/e1`, data: { actualPrice: 210000 } });
  assert.equal(up.body.data.x, 1); assert.equal(up.body.data.actualPrice, 210000); assert.equal(up.body.version, 2);
  const del = await call("j", "PATCH", "/api/doc", { path: `estimates/${me.id}/list/e1`, data: { actualPrice: { __delete__: true } } });
  assert.equal(del.body.data.actualPrice, undefined);
  const col = await call("a", "GET", `/api/collection?path=${encodeURIComponent(`estimates/${me.id}/list`)}&orderBy=updatedAt&dir=desc`);
  assert.deepEqual(col.body.docs.map((d) => d.id), ["e2", "e1"]);
  assert.equal((await call("a", "PUT", "/api/doc", { path: "config/app", data: { company: { name: "ES" } } })).status, 200);
  assert.equal((await call("j", "GET", "/api/doc?path=config/app")).body.data.company.name, "ES");
  assert.equal((await call("j", "GET", "/api/doc?path=../x")).status, 400);
});

test("súbory: nahratie a stiahnutie len prihlásený", async () => {
  const up = await call("j", "POST", "/api/assets", Buffer.from("%PDF-1.4 test"), { "content-type": "application/pdf", "x-file-name": encodeURIComponent("štúdia.pdf") });
  assert.equal(up.status, 201);
  const got = await call("j", "GET", up.body.url);
  assert.equal(got.status, 200); assert.match(String(got.body), /%PDF/);
  assert.equal((await call("nikto", "GET", up.body.url)).status, 401);
});

test("AI: JSON odpoveď a evidencia spotreby", async () => {
  const r = await call("j", "POST", "/api/ai", { prompt: "pôdorys 1.NP", json: true });
  assert.equal(r.status, 200); assert.equal(r.body.result.typStrany, "podorys");
  const t = await call("j", "POST", "/api/ai", { prompt: "zhrnutie", json: false, tier: "quick" });
  assert.equal(typeof t.body.result, "string");
  const users = await call("a", "GET", "/api/users");
  const jan = users.body.users.find((u) => u.email === "jan@firma.sk");
  assert.equal(jan.aiThisMonth.calls, 2);
});

test("AI úloha na pozadí: založenie, výsledok, cudzí používateľ ju nevidí", async () => {
  const lim = await call("j", "GET", "/api/ai/limits");
  assert.equal(lim.body.jobs, true);
  const j = await call("j", "POST", "/api/ai/jobs", { prompt: "pôdorys 1.NP", json: true, images: [{ data: "AAAA", mediaType: "image/jpeg" }] });
  assert.equal(j.status, 202);
  let s;
  for (let i = 0; i < 50; i++) { s = await call("j", "GET", "/api/ai/jobs/" + j.body.id); if (s.body.status === "done") break; await new Promise((r) => setTimeout(r, 20)); }
  assert.equal(s.body.status, "done"); assert.equal(s.body.result.typStrany, "podorys");
  assert.equal((await call("a", "GET", "/api/ai/jobs/" + j.body.id)).status, 404);
  assert.equal((await call("j", "POST", "/api/ai/jobs", { prompt: "" })).status, 400);
  const jan = (await call("a", "GET", "/api/users")).body.users.find((u) => u.email === "jan@firma.sk");
  assert.equal(jan.aiThisMonth.calls, 3);
});

test("zámok po 5 zlých heslách (uložený v databáze)", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call("x", "POST", "/api/auth/login", { email: "zamok@firma.sk", password: "zle" })).status, 401);
  assert.equal((await call("x", "POST", "/api/auth/login", { email: "zamok@firma.sk", password: "zle" })).status, 429);
});

test("vypnutý účet sa neprihlási a stratí reláciu", async () => {
  const users = (await call("a", "GET", "/api/users")).body.users;
  const jan = users.find((u) => u.email === "jan@firma.sk");
  assert.equal((await call("a", "PATCH", "/api/users/" + jan.id, { active: false })).status, 200);
  assert.equal((await call("j", "GET", "/api/auth/me")).status, 401);
  assert.equal((await call("j", "POST", "/api/auth/login", { email: "jan@firma.sk", password: "noveheslo1" })).status, 401);
  const self = users.find((u) => u.email === "admin@firma.sk");
  assert.equal((await call("a", "PATCH", "/api/users/" + self.id, { active: false })).status, 400);
});

test("AI: odrezaný alebo mierne poškodený JSON sa opraví, text bez objektu je chyba", () => {
  const { extractJson } = require("../server/ai.js");
  const v = extractJson('{"typStrany":"podorys","plochy":{"uzitkovaCelkomM2":48.47},"miestnosti":[{"nazov":"Izba","plochaM2":10.99},{"nazov":"Chod');
  assert.equal(v.plochy.uzitkovaCelkomM2, 48.47);
  assert.deepEqual(extractJson('```json\n{"a":1,}\n```'), { a: 1 });
  assert.throws(() => extractJson("Nemôžem odpovedať."), /platný JSON/);
});
