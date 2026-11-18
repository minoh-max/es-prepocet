/* ES Prepočet – prepojenie aplikácie so serverom.
 * Aplikácia bola pôvodne písaná pre Claude (window.claude.use("db" | "user" | "sample" | "assets" | "downloads")).
 * Tu je to isté rozhranie nad vlastným serverom, takže kód aplikácie ostáva rovnaký pre obe verzie.
 * Navyše: prihlásenie, zmena hesla a window.ESServer pre správu používateľov. */
(function () {
  "use strict";
  const root = () => document.getElementById("root");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  async function api(method, url, body, raw) {
    const opt = { method, credentials: "same-origin", headers: {} };
    if (raw) { opt.body = raw.body; Object.assign(opt.headers, raw.headers || {}); }
    else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers["content-type"] = "application/json"; }
    const res = await fetch(url, opt);
    const j = await res.json().catch(() => ({}));
    if (res.status === 401 && !/\/api\/auth\//.test(url)) { location.reload(); throw Object.assign(new Error("Prihlásenie vypršalo."), { code: "unauthenticated" }); }
    if (!res.ok) throw Object.assign(new Error(j.error || "Požiadavka zlyhala (" + res.status + ")."), { code: j.code || "http_" + res.status, status: res.status });
    return j;
  }

  // ---------- databáza ----------
  const listeners = new Set(); // { path, kind: "doc"|"col", refresh }
  const notify = (p) => listeners.forEach((l) => { if (l.kind === "doc" ? l.path === p : p.startsWith(l.path + "/")) l.refresh(); });
  setInterval(() => { if (document.visibilityState === "visible") listeners.forEach((l) => l.refresh()); }, 30000);

  const snap = (d) => ({ id: d.id, exists: !!d.exists, data: () => (d.exists ? d.data : undefined), metadata: {}, ref: { path: d.path } });
  function docRef(path) {
    return {
      id: path.split("/").pop(), path,
      async get() { return snap(await api("GET", "/api/doc?path=" + encodeURIComponent(path))); },
      async set(data) { const r = await api("PUT", "/api/doc", { path, data }); notify(path); return r; },
      async update(data) { const r = await api("PATCH", "/api/doc", { path, data }); notify(path); return r; },
      async delete() { await api("DELETE", "/api/doc?path=" + encodeURIComponent(path)); notify(path); },
      onSnapshot(next, err) {
        let live = true;
        const l = { path, kind: "doc", refresh: () => this.get().then((s) => live && next(s), (e) => live && err && err(e)) };
        listeners.add(l); l.refresh();
        return () => { live = false; listeners.delete(l); };
      },
      collection: (c) => colRef(path + "/" + c),
    };
  }
  function colRef(path, q = {}) {
    const ref = {
      path,
      where: () => ref, // filtrovanie aplikácia robí sama
      orderBy: (field, dir) => colRef(path, { ...q, orderBy: field, dir: dir || "asc" }),
      limit: (n) => colRef(path, { ...q, limit: n }),
      doc: (id) => docRef(path + "/" + (id || Math.random().toString(36).slice(2))),
      async get() {
        const u = "/api/collection?path=" + encodeURIComponent(path) + (q.orderBy ? "&orderBy=" + encodeURIComponent(q.orderBy) + "&dir=" + q.dir : "") + (q.limit ? "&limit=" + q.limit : "");
        const r = await api("GET", u);
        const docs = r.docs.map(snap);
        return { docs, size: docs.length, empty: !docs.length };
      },
      onSnapshot(next, err) {
        let live = true;
        const l = { path, kind: "col", refresh: () => ref.get().then((s) => live && next(s), (e) => live && err && err(e)) };
        listeners.add(l); l.refresh();
        return () => { live = false; listeners.delete(l); };
      },
    };
    return ref;
  }
  const db = { doc: docRef, collection: (p) => colRef(p) };

  // ---------- AI ----------
  const blobToB64 = (b) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = bad; r.readAsDataURL(b); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let limitsP = null;
  const getLimits = () => (limitsP = limitsP || api("GET", "/api/ai/limits").catch((e) => { limitsP = null; throw e; }));

  /** Prekreslí obrázok s nižšou kvalitou / menší (keď sú výkresy spolu väčšie, ako server prijme). */
  async function reencode(blob, quality, scale) {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((ok) => c.toBlob((b) => ok(b || blob), "image/jpeg", quality));
  }
  async function encodeImages(blobs, maxTotal) {
    const steps = [[1, 1], [0.72, 1], [0.6, 1], [0.6, 0.85], [0.5, 0.75], [0.45, 0.65]];
    for (const [q, s] of steps) {
      const out = [];
      for (const b of blobs) {
        const bb = q === 1 ? b : await reencode(b, q, s);
        out.push({ data: await blobToB64(bb), mediaType: bb.type || "image/jpeg" });
      }
      if (!maxTotal || out.reduce((n, x) => n + x.data.length, 0) <= maxTotal) return out;
    }
    throw Object.assign(new Error("Výkres je príliš veľký na odoslanie. Skúste PDF s menším počtom strán alebo menším rozlíšením."), { code: "too_large" });
  }

  async function aiCall(prompt, opts, json) {
    const lim = await getLimits().catch(() => ({}));
    const images = await encodeImages((opts && opts.images) || [], lim.images && lim.images.maxTotalBase64);
    const body = { prompt, images, json, tier: opts && opts.modelTier === "quick" ? "quick" : "complex" };
    if (!lim.jobs) return (await api("POST", "/api/ai", body)).result;
    // úloha na pozadí: založ a pýtaj sa na výsledok (čítanie výkresu môže trvať aj minútu)
    const job = await api("POST", "/api/ai/jobs", body);
    const t0 = Date.now();
    for (let i = 0; ; i++) {
      await sleep(i < 3 ? 1500 : 2500);
      let s;
      try { s = await api("GET", "/api/ai/jobs/" + encodeURIComponent(job.id)); }
      catch (e) { if (e.status >= 500 && Date.now() - t0 < 20 * 60e3) continue; throw e; }
      if (s.status === "done") return s.result;
      if (s.status === "error") throw Object.assign(new Error(s.error || "Čítanie cez AI zlyhalo."), { code: s.code || "failed" });
      if (Date.now() - t0 > 20 * 60e3) throw Object.assign(new Error("Čítanie cez AI trvá príliš dlho. Skúste to znova."), { code: "timeout" });
    }
  }
  const sample = async (prompt, opts) => ({ text: await aiCall(prompt, opts, false) });
  sample.json = (prompt, opts) => aiCall(prompt, opts, true);
  sample.limits = () => getLimits();

  // ---------- súbory a sťahovanie ----------
  const assets = {
    async upload(blob) {
      return api("POST", "/api/assets", undefined, { body: blob, headers: { "content-type": blob.type || "application/octet-stream", "x-file-name": encodeURIComponent(blob.name || "") } });
    },
    list: async () => ({ assets: [] }),
  };
  const downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url; a.download = filename || "subor"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return { status: "saved" };
    },
  };

  // ---------- prihlásenie ----------
  const loginCss = `
    .auth { min-height: 100vh; display: grid; place-items: center; background: var(--bg); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 24px; }
    .auth form { width: min(400px, 100%); background: var(--surface); border-radius: 24px; box-shadow: var(--shadow); padding: 40px 36px 36px; display: flex; flex-direction: column; gap: 16px; }
    .auth .logo { display: flex; flex-direction: column; align-items: center; gap: 18px; margin-bottom: 10px; text-align: center; }
    .auth .logo svg { width: 96px; height: 48px; color: var(--accent); }
    .auth h1 { font-size: 20px; font-weight: 300; text-transform: uppercase; letter-spacing: 0.16em; color: var(--fg); margin: 0; }
    .auth p { margin: 0; color: var(--fg-2); font-size: 13px; }
    .auth .logo p { letter-spacing: 0.08em; margin-top: 4px; }
    .auth .btn { margin-top: 6px; }
    .auth .err { color: var(--danger); background: var(--danger-soft); padding: 10px 12px; border-radius: 12px; font-size: 13px; }`;
  function authScreen(title, intro, fields, button, onSubmit) {
    if (!document.getElementById("auth-css")) { const st = document.createElement("style"); st.id = "auth-css"; st.textContent = loginCss; document.head.appendChild(st); }
    root().innerHTML = `<div class="auth"><form novalidate>
      <div class="logo"><svg viewBox="70 80 380 190" aria-hidden="true"><use href="#es-logo"/></svg><div><h1>${esc(title)}</h1><p>Ekonomické stavby</p></div></div>
      ${intro ? `<p>${esc(intro)}</p>` : ""}
      ${fields.map((f) => `<div class="field"><label for="${f.id}">${esc(f.label)}</label><input class="input" id="${f.id}" name="${f.id}" type="${f.type}" autocomplete="${f.ac}" required></div>`).join("")}
      <div class="err" hidden></div>
      <button class="btn primary lg" type="submit">${esc(button)}</button></form></div>`;
    const form = root().querySelector("form"), err = form.querySelector(".err"), btn = form.querySelector("button");
    form.querySelector("input").focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.hidden = true; btn.disabled = true;
      const v = {}; fields.forEach((f) => (v[f.id] = form.querySelector("#" + f.id).value));
      try { await onSubmit(v); } catch (x) { err.textContent = x.message || "Nepodarilo sa."; err.hidden = false; btn.disabled = false; }
    });
  }
  function showLogin() {
    authScreen("ES Prepočet", "Prihláste sa e-mailom a heslom, ktoré vám nastavil administrátor.",
      [{ id: "email", label: "E-mail", type: "email", ac: "username" }, { id: "password", label: "Heslo", type: "password", ac: "current-password" }],
      "Prihlásiť sa", async (v) => { await api("POST", "/api/auth/login", { email: v.email, password: v.password }); location.reload(); });
  }
  function showChangePassword() {
    authScreen("Nastavte si heslo", "Pri prvom prihlásení si zmeňte heslo od administrátora. Nové heslo musí mať aspoň 8 znakov.",
      [{ id: "current", label: "Heslo od administrátora", type: "password", ac: "current-password" }, { id: "next", label: "Nové heslo", type: "password", ac: "new-password" }, { id: "again", label: "Nové heslo ešte raz", type: "password", ac: "new-password" }],
      "Uložiť heslo", async (v) => {
        if (v.next !== v.again) throw new Error("Nové heslá sa nezhodujú.");
        await api("POST", "/api/auth/password", { current: v.current, next: v.next });
        location.reload();
      });
  }

  // ---------- štart ----------
  function loadScript(src) { return new Promise((ok, bad) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => bad(new Error("Nepodarilo sa načítať " + src)); document.body.appendChild(s); }); }
  (async () => {
    let me;
    try { me = (await api("GET", "/api/auth/me")).user; } catch (e) { me = null; }
    if (!me) return showLogin();
    if (me.mustChange) return showChangePassword();
    const user = {
      me: async () => ({ id: me.id, name: me.name, email: me.email, isOwner: me.role === "admin", canEdit: me.role === "admin" }),
      id: async () => me.id,
      canEdit: async () => me.role === "admin",
      isOwner: async () => me.role === "admin",
      can: async () => true,
    };
    const caps = { db, user, sample, assets, downloads };
    window.claude = { use: async (name) => caps[name] || null };
    window.ESServer = {
      me,
      logout: async () => { await api("POST", "/api/auth/logout"); location.reload(); },
      changePassword: (current, next) => api("POST", "/api/auth/password", { current, next }),
      verifyPassword: (password) => api("POST", "/api/auth/verify", { password }),
      calc: (draft, opts) => api("POST", "/api/calc", { draft, itemized: !!(opts && opts.itemized) }),
      users: {
        list: () => api("GET", "/api/users").then((r) => r.users),
        create: (u) => api("POST", "/api/users", u).then((r) => r.user),
        update: (id, patch) => api("PATCH", "/api/users/" + encodeURIComponent(id), patch).then((r) => r.user),
      },
      aiConfigured: () => api("GET", "/api/ai/limits").then((r) => !!r.configured).catch(() => false),
    };
    await loadScript("engine.js");
    await loadScript("app.js");
  })();
})();
