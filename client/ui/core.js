/* ES Prepočet – UI: spoločné pomôcky, kostra aplikácie (súbory ui/*.js skladá build do jednej funkcie) */
  const { html, render, useState, useEffect, useMemo, useRef } = window.htmPreact;
  const E = window.ESEngine;
  const L = window.ESL;
  const { fmtNum, fmtEur, fmtSigned, fmtPct, fmtDate, parseNum } = L;
  const fmtEur2 = (n) => (n == null ? "–" : fmtNum(n, 2) + " €");

  if (window.pdfjsLib) {
    try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; } catch (e) { /* fake worker is used */ }
  }

  // ---------- icons ----------
  const ICONS = {
    plus: "M12 5v14M5 12h14",
    list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
    home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
    table: "M3 5h18v14H3zM3 10h18M3 15h18M9 5v14",
    gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 2h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
    upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
    doc: "M6 2h9l5 5v15H6zM14 2v6h6",
    spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
    download: "M12 4v12M7 11l5 5 5-5M4 20h16",
    ext: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
    check: "M5 12.5 10 17l9-10",
    x: "M6 6l12 12M18 6 6 18",
    back: "M15 5l-7 7 7 7",
    trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
    logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4",
  };
  const Icon = ({ name }) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${ICONS[name]} /></svg>`;

  // ---------- small components ----------
  function NumInput({ value, onChange, onCommit, placeholder, inherited, step, id, cls }) {
    const [txt, setTxt] = useState(value == null ? "" : String(value).replace(".", ","));
    const focused = useRef(false);
    useEffect(() => { if (!focused.current) setTxt(value == null ? "" : String(value).replace(".", ",")); }, [value]);
    // onCommit: uloží sa až po opustení poľa alebo Enter (napr. skutočná cena), onChange: pri každom znaku
    return html`<input id=${id} class=${"input num" + (inherited ? " inherited" : "") + (cls ? " " + cls : "")} inputmode="decimal" value=${txt} placeholder=${placeholder || ""}
      onFocus=${() => (focused.current = true)}
      onKeyDown=${(e) => { if (e.key === "Enter" && onCommit) e.target.blur(); }}
      onBlur=${(e) => { focused.current = false; if (onCommit) onCommit(parseNum(e.target.value)); else setTxt(value == null ? "" : String(value).replace(".", ",")); }}
      onInput=${(e) => { setTxt(e.target.value); if (onChange) onChange(parseNum(e.target.value)); }} />`;
  }
  function Seg({ value, options, onChange }) {
    return html`<div class="seg" role="group">${options.map(([v, l]) => html`<button type="button" class=${value === v ? "on" : ""} onClick=${() => onChange(v)}>${l}</button>`)}</div>`;
  }
  const Conf = ({ c, ev }) => (c ? html`<span class=${"badge " + c} title=${ev || ""}>${{ high: "isté", medium: "odvodené", low: "overiť" }[c]}</span>` : html`<span class="faint small">ručne</span>`);
  const Pill = ({ pct }) => {
    const cls = Math.abs(pct) < 0.05 ? "flat" : pct > 0 ? "up" : "down";
    return html`<span class=${"pill " + cls}>${fmtPct(pct)}</span>`;
  };
  function Sheet({ onClose, children, wide }) {
    useEffect(() => {
      const k = (e) => e.key === "Escape" && onClose();
      window.addEventListener("keydown", k);
      return () => window.removeEventListener("keydown", k);
    }, []);
    return html`<div class="scrim" onClick=${(e) => e.target === e.currentTarget && onClose()}><div class="sheet" style=${wide ? "width:min(1000px,100%)" : ""}>${children}</div></div>`;
  }
  // Hlavné obrázky domov z webu ES (zmenšené WebP), uložené pri aplikácii v 8 balíkoch podľa id % 8 – načítajú sa až keď treba.
  const IMG = {}, IMG_LOAD = {};
  function loadImgBucket(b) {
    if (!IMG_LOAD[b]) IMG_LOAD[b] = fetch(`data/img/${b}.json`).then((r) => (r.ok ? r.json() : {})).then((j) => { for (const k in j) IMG[k] = "data:image/webp;base64," + j[k]; }).catch(() => {});
    return IMG_LOAD[b];
  }
  function HouseImg({ h, plan = true }) {
    const [src, setSrc] = useState(IMG[h.id] || null);
    useEffect(() => {
      if (IMG[h.id]) { setSrc(IMG[h.id]); return; }
      let live = true;
      loadImgBucket(h.id % 8).then(() => { if (live) setSrc(IMG[h.id] || null); });
      return () => { live = false; };
    }, [h.id]);
    return src ? html`<img class="house-img" src=${src} alt=${h.name} loading="lazy" decoding="async" />` : plan ? html`<${PlanSvg} h=${h} />` : null;
  }

  function PlanSvg({ h }) {
    const w = h.w || Math.sqrt(h.pz), l = h.l || Math.sqrt(h.pz);
    const a = Math.max(w, l), b = Math.min(w, l);
    const W = 120, H = Math.max(28, (b / a) * 120);
    const roof = { 1: "valb", 2: "sedl", 3: "rov" }[h.roof];
    return html`<svg viewBox=${`0 0 ${W + 8} ${H + 8}`} width=${W + 8} height=${H + 8} aria-hidden="true">
      <rect x="4" y="4" width=${W} height=${H} rx="2" fill="var(--surface)" stroke="var(--accent)" stroke-width="1.5" />
      ${roof === "sedl" ? html`<line x1="4" y1=${4 + H / 2} x2=${4 + W} y2=${4 + H / 2} stroke="var(--accent)" stroke-width="1" stroke-dasharray="3 3" />` : null}
      ${roof === "valb" ? html`<path d=${`M4 4 L${4 + H / 2} ${4 + H / 2} L${4 + W - H / 2} ${4 + H / 2} L${4 + W} 4 M4 ${4 + H} L${4 + H / 2} ${4 + H / 2} M${4 + W - H / 2} ${4 + H / 2} L${4 + W} ${4 + H}`} fill="none" stroke="var(--accent)" stroke-width="1" stroke-dasharray="3 3" />` : null}
    </svg>`;
  }

  // ---------- capabilities & shared data ----------
  async function useCap(name) { try { return await window.claude.use(name); } catch (e) { return null; } }

  function App() {
    const [boot, setBoot] = useState({ loading: true });
    const [view, setView] = useState("new");
    const [config, setConfig] = useState({});
    const [profile, setProfile] = useState(null);
    const [priceList, setPriceList] = useState(null);
    const [toast, setToast] = useState(null);
    const [draft, setDraft] = useState(null);
    const caps = useRef({});

    const say = (t) => { setToast(t); clearTimeout(say.t); say.t = setTimeout(() => setToast(null), 3200); };

    useEffect(() => {
      (async () => {
        try {
          const [houses, ciselnik] = await Promise.all([fetch("data/houses.json").then((r) => r.json()), fetch("data/ciselnik.json").then((r) => r.json())]);
          setBoot({ loading: false, houses, ciselnik });
          setPriceList(ciselnik);
        } catch (e) {
          setBoot({ loading: false, error: "Nepodarilo sa načítať dáta aplikácie. Obnovte stránku." });
        }
      })();
      (async () => {
        const [db, user, sample, assets, downloads] = await Promise.all(["db", "user", "sample", "assets", "downloads"].map(useCap));
        let me = null, id = null, admin = false;
        if (user) { try { [me, id, admin] = await Promise.all([user.me(), user.id(), user.canEdit()]); } catch (e) { /* signed out */ } }
        caps.current = { db, user, sample, assets, downloads, me, uid: id, admin };
        setBoot((b) => ({ ...b, capsReady: true }));
        if (db) {
          db.doc("config/app").onSnapshot((s) => setConfig(s.exists ? s.data() : {}), () => {});
          if (id) {
            db.doc("profiles/" + id).onSnapshot(async (s) => {
              if (s.exists) setProfile(s.data());
              else {
                const p = { name: me?.name || "", email: me?.email || "", phone: "", username: "", title: "obchodník", createdAt: Date.now() };
                setProfile(p);
                try { await db.doc("profiles/" + id).set(p); } catch (e) { /* view-only */ }
              }
            }, () => {});
          }
        }
      })();
    }, []);

    // load imported price list version
    useEffect(() => {
      const pl = config.priceList;
      if (pl && pl.assetId) {
        fetch("/_blob/" + pl.assetId).then((r) => (r.ok ? r.json() : null)).then((j) => j && j.items && setPriceList(j)).catch(() => {});
      } else if (boot.ciselnik) setPriceList(boot.ciselnik);
    }, [config.priceList && config.priceList.assetId, boot.ciselnik]);

    const ctx = useMemo(() => {
      if (!boot.houses || !priceList) return null;
      const prices = L.buildPrices(priceList, config.priceOverrides || {});
      const settings = L.mergeSettings(config.engine);
      const extras = L.extrasFrom(boot.houses.config);
      const housesById = Object.fromEntries(boot.houses.houses.map((h) => [h.id, h]));
      return { prices, settings, extras, houses: boot.houses.houses, housesById, houseCfg: boot.houses.config, priceList, config, caps: caps.current, profile, say, company: config.company || {} };
    }, [boot.houses, priceList, config, profile, boot.capsReady]);

    const nav = [
      ["new", "Nový prepočet", "plus"],
      ["list", "Prepočty", "list"],
      ["catalog", "Katalóg", "home"],
      ...(caps.current.admin ? [["prices", "Číselník", "table"]] : []), // výrobné ceny – len administrátor
      ["settings", "Nastavenia", "gear"],
    ];
    const startNew = (house) => { setDraft(newDraft(house)); setView("new"); };
    const openEstimate = (est) => { setDraft({ ...L.clone(est), pages: [], localFiles: [], step: 3 }); setView("new"); };
    const initials = (profile?.name || caps.current.me?.name || "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
    const logoUrl = config.company?.logoAssetId ? "/_blob/" + config.company.logoAssetId : null;

    const go = (k) => { if (k === "new" && view !== "new") setDraft(draft || newDraft()); setView(k); };
    return html`<div class="shell">
      <header class="topbar">
        <button class="brand" onClick=${() => go("new")} aria-label="ES Prepočet – nový prepočet">${logoUrl ? html`<img src=${logoUrl} alt="" />` : html`<svg viewBox="30 74 440 194" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><use href="#es-logo" /></svg>`}<span class="brand-name">Prepočet</span></button>
        <nav class="nav" aria-label="Hlavná navigácia">
          ${nav.map(([k, l, i]) => html`<button class=${"nav-btn" + (k === "new" ? " cta" : "") + (view === k ? " active" : "")} aria-current=${view === k ? "page" : null} onClick=${() => go(k)}><${Icon} name=${i} /><span>${l}</span></button>`)}
        </nav>
        <div class="me">
          <div class="avatar" title=${profile?.name || caps.current.me?.name || ""}>${initials}</div>
          <div class="who"><b>${profile?.name || caps.current.me?.name || "Neprihlásený"}</b><span>${caps.current.admin ? "administrátor" : profile?.title || "obchodník"}</span></div>
          ${window.ESServer ? html`<button class="btn plain sm" title="Odhlásiť sa" aria-label="Odhlásiť sa" onClick=${() => window.ESServer.logout()}><${Icon} name="logout" /><span class="sr-only">Odhlásiť sa</span></button>` : null}
        </div>
      </header>
      <main class="main"><div class="page">
        ${boot.error ? html`<div class="notice bad">${boot.error}</div>` : null}
        ${!ctx ? html`<div class="empty"><div class="spinner"></div><p>Načítavam katalóg a číselník…</p></div>` : null}
        ${ctx && view === "new" ? html`<${Wizard} ctx=${ctx} draft=${draft || newDraft()} setDraft=${setDraft} onSaved=${() => setView("list")} />` : null}
        ${ctx && view === "list" ? html`<${EstimatesList} ctx=${ctx} onOpen=${openEstimate} onNew=${() => startNew()} />` : null}
        ${ctx && view === "catalog" ? html`<${Catalog} ctx=${ctx} onUse=${startNew} />` : null}
        ${ctx && view === "prices" && ctx.caps.admin ? html`<${PriceList} ctx=${ctx} />` : null}
        ${ctx && view === "settings" ? html`<${Settings} ctx=${ctx} />` : null}
      </div></main>
      ${toast ? html`<div class="toast" role="status">${toast}</div>` : null}
    </div>`;
  }

  function newDraft(house) {
    return {
      id: L.uid(), clientName: "", clientNote: "", finish: "standard", baseHouseId: house ? house.id : null,
      files: [], pages: [], localFiles: [], ai: null, study: house ? { ...L.houseParams(house), materials: {}, materialTexts: {}, confidence: {}, evidence: {} } : null,
      baseOverrides: {}, status: "rozpracovaný", step: house ? 2 : 1, createdAt: Date.now(),
    };
  }

