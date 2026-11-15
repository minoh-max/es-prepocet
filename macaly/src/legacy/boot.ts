// ES Prepočet – spustenie aplikácie v Macaly.
// Obrazovky a výpočet sú overená aplikácia ES Prepočet (public/legacy/*.js, Preact + htm).
// Tento súbor jej dáva rovnaké rozhranie, aké mala na vlastnom serveri (window.claude.use + window.ESServer),
// len nad databázou Convex: prihlásenie, dokumenty, používatelia a čítanie štúdie cez Claude.
import { ConvexClient } from "convex/browser"
import { api } from "@/convex/_generated/api"

declare global {
  interface Window { claude?: any; ESServer?: any; __esBooted?: boolean }
}

const TOKEN_KEY = "es_prepocet_token"
const CDN = [
  "https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.umd.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js",
  "https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js",
]
const AI_LIMITS = { maxPromptBytes: 400000, jobs: false, configured: true, images: { maxCount: 16, maxInputBytes: 5_000_000, maxTotalBase64: 9_000_000, mediaTypes: ["image/jpeg", "image/png", "image/webp"] } }

const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || "" } catch { return "" } }
const setToken = (t: string) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* súkromné okno */ } }
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
const root = () => document.getElementById("root")!

/** Chyba z Convexu → Error so slovenskou správou a kódom (ako na pôvodnom serveri). */
function esErr(e: any): Error {
  const d = e && e.data
  const message = (d && d.message) || (e && e.message) || "Požiadavka zlyhala."
  return Object.assign(new Error(message), { code: (d && d.code) || "failed" })
}
function onAuthLost(e: any) {
  if (e && e.code === "unauthenticated") { setToken(""); location.reload() }
  throw e
}

function loadScript(src: string) {
  return new Promise<void>((ok, bad) => {
    const s = document.createElement("script")
    s.src = src; s.async = false
    s.onload = () => ok(); s.onerror = () => bad(new Error("Nepodarilo sa načítať " + src))
    document.body.appendChild(s)
  })
}

export async function boot(convexUrl: string) {
  if (window.__esBooted) return
  window.__esBooted = true
  const client = new ConvexClient(convexUrl)
  const T = getToken
  const q = (fn: any, args: any) => client.query(fn, { token: T(), ...args }).catch((e) => onAuthLost(esErr(e)))
  const m = (fn: any, args: any) => client.mutation(fn, { token: T(), ...args }).catch((e) => onAuthLost(esErr(e)))
  const a = (fn: any, args: any) => client.action(fn, { token: T(), ...args }).catch((e) => onAuthLost(esErr(e)))

  // ---------- databáza (rozhranie ako window.claude db) ----------
  const snap = (d: any) => ({ id: d.id, exists: !!d.exists, data: () => (d.exists ? d.data : undefined), metadata: {}, ref: { path: d.path } })
  function docRef(path: string): any {
    return {
      id: path.split("/").pop(), path,
      async get() { return snap(await q(api.es.getDoc, { path })) },
      async set(data: any) { return m(api.es.writeDoc, { path, mode: "set", dataJson: JSON.stringify(data) }) },
      async update(data: any) { return m(api.es.writeDoc, { path, mode: "update", dataJson: JSON.stringify(data) }) },
      async delete() { await m(api.es.writeDoc, { path, mode: "delete" }) },
      onSnapshot(next: any, err?: any) {
        return client.onUpdate(api.es.getDoc, { token: T(), path }, (d: any) => next(snap(d)), (e: any) => err && err(esErr(e)))
      },
      collection: (c: string) => colRef(path + "/" + c),
    }
  }
  function colRef(path: string, o: { orderBy?: string; dir?: string; limit?: number } = {}): any {
    const args = () => ({ path, ...(o.orderBy ? { orderBy: o.orderBy, dir: o.dir || "asc" } : {}), ...(o.limit ? { limit: o.limit } : {}) })
    const wrap = (docs: any[]) => { const d = docs.map(snap); return { docs: d, size: d.length, empty: !d.length } }
    const ref: any = {
      path,
      where: () => ref, // filtrovanie robí aplikácia sama
      orderBy: (field: string, dir?: string) => colRef(path, { ...o, orderBy: field, dir: dir || "asc" }),
      limit: (n: number) => colRef(path, { ...o, limit: n }),
      doc: (id?: string) => docRef(path + "/" + (id || Math.random().toString(36).slice(2))),
      async get() { return wrap(await q(api.es.listCollection, args())) },
      onSnapshot(next: any, err?: any) {
        return client.onUpdate(api.es.listCollection, { token: T(), ...args() }, (docs: any) => next(wrap(docs)), (e: any) => err && err(esErr(e)))
      },
    }
    return ref
  }
  const db = { doc: docRef, collection: (p: string) => colRef(p) }

  // ---------- AI ----------
  const blobToB64 = (b: Blob) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = bad; r.readAsDataURL(b) })
  async function reencode(blob: Blob, quality: number, scale: number) {
    const bmp = await createImageBitmap(blob)
    const c = document.createElement("canvas")
    c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale))
    const g = c.getContext("2d")!
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height)
    g.drawImage(bmp, 0, 0, c.width, c.height)
    return new Promise<Blob>((ok) => c.toBlob((b) => ok(b || blob), "image/jpeg", quality))
  }
  async function encodeImages(blobs: Blob[], maxTotal: number) {
    const steps = [[1, 1], [0.72, 1], [0.6, 1], [0.6, 0.85], [0.5, 0.75], [0.45, 0.65]]
    for (const [qq, s] of steps) {
      const out: { data: string; mediaType: string }[] = []
      for (const b of blobs) {
        const bb = qq === 1 ? b : await reencode(b, qq, s)
        out.push({ data: await blobToB64(bb), mediaType: bb.type || "image/jpeg" })
      }
      if (!maxTotal || out.reduce((n, x) => n + x.data.length, 0) <= maxTotal) return out
    }
    throw Object.assign(new Error("Výkres je príliš veľký na odoslanie. Skúste PDF s menším počtom strán alebo menším rozlíšením."), { code: "too_large" })
  }
  async function aiCall(prompt: string, opts: any, json: boolean) {
    const images = await encodeImages((opts && opts.images) || [], AI_LIMITS.images.maxTotalBase64)
    const r: any = await a(api.esNode.ai, { prompt, images, json, tier: opts && opts.modelTier === "quick" ? "quick" : "complex" })
    return r.result
  }
  const sample: any = async (prompt: string, opts: any) => ({ text: await aiCall(prompt, opts, false) })
  sample.json = (prompt: string, opts: any) => aiCall(prompt, opts, true)
  sample.limits = async () => AI_LIMITS

  // ---------- súbory (logo, číselník, PDF štúdie) ----------
  // Aplikácia odkazuje na súbor ako "/_blob/<id>" (ako na pôvodnom serveri). Tu sa taká adresa
  // zmení na krátkodobú súkromnú adresu z Macaly: pri fetch(), pri <img> a pri kliknutí na odkaz.
  const assets = {
    async upload(blob: Blob & { name?: string }) {
      const name = blob.name || "subor"
      const g: any = await a(api.esFiles.createUpload, { filename: name, contentType: blob.type || "application/octet-stream", fileSize: blob.size })
      const res = await fetch(g.uploadUrl, { method: g.method, headers: g.headers, body: blob })
      if (!res.ok) throw Object.assign(new Error("Nahratie súboru zlyhalo (" + res.status + ")."), { code: "upload_failed" })
      return a(api.esFiles.finalizeUpload, { fileId: g.fileId, name })
    },
    list: async () => ({ assets: [] }),
    delete: (id: string) => a(api.esFiles.remove, { fileId: id }),
  }
  const blobCache = new Map<string, { url: string; until: number }>()
  const blobId = (u: string) => { const mm = /^(?:https?:\/\/[^/]+)?\/_blob\/([^?#]+)/.exec(u || ""); return mm ? decodeURIComponent(mm[1]) : null }
  async function blobUrl(id: string) {
    const c = blobCache.get(id)
    if (c && c.until > Date.now()) return c.url
    const d: any = await a(api.esFiles.downloadUrl, { fileId: id })
    blobCache.set(id, { url: d.url, until: Date.now() + 4 * 60e3 })
    return d.url as string
  }
  const origFetch = window.fetch.bind(window)
  window.fetch = (async (input: any, init?: any) => {
    const id = typeof input === "string" ? blobId(input) : null
    if (!id) return origFetch(input, init)
    try { return await origFetch(await blobUrl(id), init) } catch { return new Response(null, { status: 404 }) }
  }) as typeof window.fetch
  const fixImg = (img: HTMLImageElement) => {
    const id = blobId(img.getAttribute("src") || "")
    if (id) blobUrl(id).then((u) => { if (blobId(img.getAttribute("src") || "") === id) img.src = u }).catch(() => {})
  }
  new MutationObserver((muts) => {
    for (const mu of muts) {
      if (mu.type === "attributes" && mu.target instanceof HTMLImageElement) fixImg(mu.target)
      mu.addedNodes.forEach((n) => { if (n instanceof HTMLElement) { if (n instanceof HTMLImageElement) fixImg(n); n.querySelectorAll("img[src^='/_blob/']").forEach((i) => fixImg(i as HTMLImageElement)) } })
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] })
  document.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement)?.closest?.("a[href^='/_blob/']") as HTMLAnchorElement | null
    if (!link) return
    e.preventDefault()
    const w = window.open("", "_blank")
    blobUrl(blobId(link.getAttribute("href")!)!).then((u) => { if (w) w.location.href = u; else location.href = u }).catch((x) => { if (w) w.close(); alert(x.message || "Súbor sa nepodarilo otvoriť.") })
  }, true)

  // ---------- sťahovanie súborov (PDF výstup) ----------
  const downloads = {
    async save({ filename, data }: { filename: string; data: Blob }) {
      const url = URL.createObjectURL(data)
      const el = document.createElement("a")
      el.href = url; el.download = filename || "subor"; document.body.appendChild(el); el.click(); el.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
      return { status: "saved" }
    },
  }

  // ---------- prihlásenie ----------
  function authScreen(title: string, intro: string, fields: { id: string; label: string; type: string; ac: string }[], button: string, onSubmit: (v: Record<string, string>) => Promise<void>) {
    root().innerHTML = `<div class="auth"><form novalidate>
      <div class="logo"><svg viewBox="70 80 380 190" aria-hidden="true"><use href="#es-logo"/></svg><div><h1>${esc(title)}</h1><p>Ekonomické stavby</p></div></div>
      ${intro ? `<p>${esc(intro)}</p>` : ""}
      ${fields.map((f) => `<div class="field"><label for="${f.id}">${esc(f.label)}</label><input class="input" id="${f.id}" name="${f.id}" type="${f.type}" autocomplete="${f.ac}" required></div>`).join("")}
      <div class="err" hidden></div>
      <button class="btn primary lg" type="submit">${esc(button)}</button></form></div>`
    const form = root().querySelector("form")!, err = form.querySelector(".err") as HTMLElement, btn = form.querySelector("button") as HTMLButtonElement
    ;(form.querySelector("input") as HTMLInputElement).focus()
    form.addEventListener("submit", async (e) => {
      e.preventDefault()
      err.hidden = true; btn.disabled = true
      const v: Record<string, string> = {}
      fields.forEach((f) => (v[f.id] = (form.querySelector("#" + f.id) as HTMLInputElement).value))
      try { await onSubmit(v) } catch (x: any) { err.textContent = (x && x.message) || "Nepodarilo sa."; err.hidden = false; btn.disabled = false }
    })
  }
  const showLogin = () => authScreen("ES Prepočet", "Prihláste sa e-mailom a heslom, ktoré vám nastavil administrátor.",
    [{ id: "email", label: "E-mail", type: "email", ac: "username" }, { id: "password", label: "Heslo", type: "password", ac: "current-password" }],
    "Prihlásiť sa", async (v) => {
      const r: any = await client.action(api.esNode.login, { email: v.email, password: v.password }).catch((e) => { throw esErr(e) })
      setToken(r.token); location.reload()
    })
  const showChangePassword = () => authScreen("Nastavte si heslo", "Pri prvom prihlásení si zmeňte heslo od administrátora. Nové heslo musí mať aspoň 8 znakov.",
    [{ id: "current", label: "Heslo od administrátora", type: "password", ac: "current-password" }, { id: "next", label: "Nové heslo", type: "password", ac: "new-password" }, { id: "again", label: "Nové heslo ešte raz", type: "password", ac: "new-password" }],
    "Uložiť heslo", async (v) => {
      if (v.next !== v.again) throw new Error("Nové heslá sa nezhodujú.")
      await client.action(api.esNode.changePassword, { token: T(), current: v.current, next: v.next }).catch((e) => { throw esErr(e) })
      location.reload()
    })

  // ---------- štart ----------
  const libs = CDN.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
  let me: any = null
  if (T()) { try { me = await client.query(api.es.me, { token: T() }) } catch { me = null } }
  if (!me) { setToken(""); return showLogin() }
  if (me.mustChange) return showChangePassword()

  const user = {
    me: async () => ({ id: me.id, name: me.name, email: me.email, isOwner: me.role === "admin", canEdit: me.role === "admin" }),
    id: async () => me.id,
    canEdit: async () => me.role === "admin",
    isOwner: async () => me.role === "admin",
    can: async () => true,
  }
  const caps: Record<string, any> = { db, user, sample, assets, downloads }
  window.claude = { use: async (name: string) => caps[name] || null }
  window.ESServer = {
    me,
    logout: async () => { await client.mutation(api.es.logout, { token: T() }).catch(() => {}); setToken(""); location.reload() },
    changePassword: (current: string, next: string) => a(api.esNode.changePassword, { current, next }),
    users: {
      list: () => q(api.es.listUsers, {}),
      create: (u: any) => a(api.esNode.createUser, { email: u.email, name: u.name, role: u.role, password: u.password }),
      update: async (id: string, patch: any) => {
        if (patch.password !== undefined) await a(api.esNode.resetPassword, { id, password: String(patch.password) })
        const rest: any = { id }
        for (const k of ["name", "role", "active"]) if (patch[k] !== undefined) rest[k] = patch[k]
        return Object.keys(rest).length > 1 ? m(api.es.updateUser, rest) : null
      },
    },
    aiConfigured: async () => true,
  }
  await libs
  await loadScript("/legacy/engine.js")
  await loadScript("/legacy/app.js")
}
