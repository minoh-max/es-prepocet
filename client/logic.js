/* ES Prepočet – logic layer (no UI). Exposes window.ESL */
(function () {
  const E = window.ESEngine;

  // ---------- formatting ----------
  const nb = (s) => s.replace(/ | /g, " ");
  const fmtNum = (n, d = 0) =>
    n == null || Number.isNaN(n) ? "–" : nb(Number(n).toLocaleString("sk-SK", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const fmtEur = (n) => (n == null || Number.isNaN(n) ? "–" : nb(E.fmtEur(n)));
  const fmtSigned = (n) => (n == null ? "–" : (n > 0 ? "+" : n < 0 ? "−" : "") + nb(Math.abs(Math.round(n)).toLocaleString("sk-SK")) + " €");
  const fmtPct = (n, d = 1) => (n == null ? "–" : (n > 0 ? "+" : n < 0 ? "−" : "") + fmtNum(Math.abs(n), d) + " %");
  const fmtDate = (ts) => {
    if (!ts) return "–";
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  };
  const parseNum = (s) => {
    if (s == null) return undefined;
    if (typeof s === "number") return Number.isFinite(s) ? s : undefined;
    const t = String(s).replace(/\s/g, "").replace(",", ".");
    if (t === "") return undefined;
    const v = Number(t);
    return Number.isFinite(v) ? v : undefined;
  };
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clone = (o) => JSON.parse(JSON.stringify(o ?? null));

  // ---------- catalog ----------
  const KIND = { 1: "podkrovie", 2: "bungalov", 3: "poschodovy" };
  const ROOF = { 1: "valbova", 2: "sedlova", 3: "plocha" };
  const FLOORS_LABEL = { bungalov: "Bungalov (prízemný)", podkrovie: "S podkrovím", poschodovy: "Poschodový" };
  const ROOF_LABEL = { sedlova: "Sedlová", valbova: "Valbová", pultova: "Pultová", plocha: "Plochá (rovná)", kombinovana: "Kombinovaná" };
  const HEAT_LABEL = { plyn: "Plynový kondenzačný kotol", tc: "Tepelné čerpadlo", elektro: "Elektrické kúrenie", tuhe: "Kotol na tuhé palivo" };
  const DIST_LABEL = { podlahove: "Podlahové kúrenie", radiatory: "Radiátory" };
  const houseUrl = (h) => `https://www.ekonomicke-stavby.sk/domy/${h.slug}`;

  function houseParams(h) {
    return {
      usableAreaM2: h.pu, builtAreaM2: h.pz,
      widthM: h.w || undefined, lengthM: h.l || undefined,
      floorsType: KIND[h.kind] || "bungalov", roofType: ROOF[h.roof] || "sedlova",
      bathrooms: h.bath || 1, wcs: 1, garages: h.gar || 0,
      heatingSource: "plyn", heatingDistribution: "podlahove",
      centralRecuperation: false, chimney: false, fireplace: false,
    };
  }

  /** Base = catalog house in the fixed ES standard (nothing is taken from the study, nothing is editable by the rep). */
  function effectiveBase(house, settings) {
    return { params: E.standardHouse(houseParams(house), settings), inherited: {} };
  }
  const round1 = (n) => Math.round(n * 10) / 10;
  function clean(o) {
    const out = {};
    for (const [k, v] of Object.entries(o || {})) {
      if (v === undefined || v === null || v === "" || (typeof v === "number" && !Number.isFinite(v))) continue;
      out[k] = v;
    }
    return out;
  }

  /** Name-based and similarity-based matching of a study to catalog houses. */
  function nameKey(s) {
    const t = norm(s).replace(/lucia/g, "lucie").replace(/[^a-z0-9+ ]/g, " ");
    const m = t.match(/([a-z]{3,})\s*(\d{1,3})\s*([a-d])?\b/);
    return m ? { stem: m[1].slice(0, 4), num: m[2], suf: m[3] || "" } : null;
  }
  function findClosestHouses(params, houses, text = "", limit = 5) {
    const out = [];
    const t = norm(text);
    if (t) {
      const byName = [];
      for (const h of houses) {
        const hn = norm(h.name).trim();
        if (hn.length >= 4 && t.includes(hn)) byName.push({ h, len: hn.length });
      }
      byName.sort((a, b) => b.len - a.len);
      if (byName.length) {
        out.push({ house: byName[0].h, score: 100, reasons: ["názov domu je uvedený v podkladoch"] });
      } else {
        const k = nameKey(text);
        if (k) {
          const hit = houses.find((h) => { const hk = nameKey(h.name); return hk && hk.stem === k.stem && hk.num === k.num && hk.suf === k.suf; })
            || houses.find((h) => { const hk = nameKey(h.name); return hk && hk.stem === k.stem && hk.num === k.num; });
          if (hit) out.push({ house: hit, score: 97, reasons: ["podobný názov domu v podkladoch"] });
        }
      }
    }
    if (params && params.usableAreaM2) {
      const scored = houses.map((h) => {
        const hp = houseParams(h);
        let s = 100;
        const reasons = [];
        if (params.floorsType && hp.floorsType !== params.floorsType) s -= 30; else if (params.floorsType) reasons.push(FLOORS_LABEL[hp.floorsType].toLowerCase());
        if (params.roofType && hp.roofType !== params.roofType) s -= 10; else if (params.roofType) reasons.push(`strecha ${ROOF_LABEL[hp.roofType].toLowerCase()}`);
        const rel = (a, b) => (a && b ? Math.abs(a - b) / b : 0.3);
        // Úžitková plocha sa v katalógu a v štúdiách uvádza raz s garážou, raz bez nej – porovná sa lepší z oboch výkladov.
        // Spoľahlivejšie meradlo veľkosti domu sú zastavaná plocha a vonkajšie rozmery (overené na rozpočtoch ES).
        const gar = params.garages ? params.garages * 20 : 0;
        const relUse = Math.min(rel(hp.usableAreaM2, params.usableAreaM2), gar ? rel(hp.usableAreaM2, params.usableAreaM2 + gar) : 1);
        s -= Math.min(20, relUse * 70);
        if (params.builtAreaM2) s -= Math.min(25, rel(hp.builtAreaM2, params.builtAreaM2) * 100);
        if (params.widthM && params.lengthM && hp.widthM && hp.lengthM) {
          const a = [hp.widthM, hp.lengthM].sort((x, y) => x - y), b = [params.widthM, params.lengthM].sort((x, y) => x - y);
          const d = rel(a[0], b[0]) + rel(a[1], b[1]);
          s -= Math.min(20, d * 60);
          if (d < 0.01) reasons.push("vonkajšie rozmery sedia");
        }
        if (params.bathrooms != null) s -= Math.min(8, Math.abs((h.bath || 1) - params.bathrooms) * 4);
        if (params.garages != null) s -= Math.min(8, Math.abs((h.gar || 0) - params.garages) * 6);
        if (Math.abs(hp.usableAreaM2 - params.usableAreaM2) / params.usableAreaM2 < 0.08) reasons.push("podobná úžitková plocha");
        return { house: h, score: Math.max(0, Math.round(s)), reasons };
      });
      scored.sort((a, b) => b.score - a.score);
      for (const s of scored) {
        if (out.length >= limit) break;
        if (!out.some((o) => o.house.id === s.house.id)) out.push(s);
      }
    }
    return out.slice(0, limit);
  }

  // ---------- price list ----------
  function buildPrices(list, overrides = {}) {
    const idx = {};
    for (const it of list.items) {
      const [path, name, spec, unit, mat, lab, mech, fix, cat, group, premium, check, note, row] = it;
      const o = overrides[path] || {};
      const pick = (k, v) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : v);
      idx[path] = {
        path_code: path, name, specification: spec, unit,
        price_material: pick("mat", mat), price_labor: pick("lab", lab), price_machinery: pick("mech", mech), fixed_rate: pick("fix", fix),
        check_level: check || null, is_hidden: !!o.hidden, cat, group, premium: !!premium, note, row, edited: Object.keys(o).length > 0,
      };
    }
    return idx;
  }

  /** Parses the budgeting-software export (.xlsx) into the compact price-list format. Hierarchy = leading spaces; a priced item is never a parent. */
  function parsePriceListXlsx(arrayBuffer, fileName) {
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    const header = (rows[3] || []).map((v) => norm(v));
    if (!header[0] || !header[0].startsWith("oznac")) throw new Error("Súbor nemá očakávanú hlavičku (riadok 4: Označenie, Názov, …).");
    const num = (v) => (v === null || v === "" || v === undefined ? null : typeof v === "number" ? v : parseNum(v) ?? null);
    const stack = [];
    const items = [];
    const cats = {};
    const seen = {};
    for (let i = 4; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r[0] == null) continue;
      const raw = String(r[0]);
      const ind = raw.length - raw.replace(/^ +/, "").length;
      const code = raw.trim();
      const name = String(r[1] ?? "").trim();
      const unit = String(r[3] ?? "").trim();
      if (code === "root" || code === "ES") continue;
      while (stack.length && (stack[stack.length - 1].ind >= ind || stack[stack.length - 1].leaf)) stack.pop();
      const leaf = unit !== "-" && unit !== "";
      const sec = stack[0] || { code, name };
      if (!stack.length) cats[code] = name;
      const node = { ind, code, name, leaf };
      if (["SYS", "CIS", "R", "K", "M", "P", "S"].includes(sec.code)) { stack.push(node); continue; }
      let path = [...stack.map((s) => s.code), code].join("/");
      if (seen[path]) { seen[path]++; path += "#" + seen[path]; } else seen[path] = 1;
      if (leaf) {
        const premium = stack.some((s) => s.name.startsWith("CNP")) || name.startsWith("CNP") ? 1 : 0;
        const group = stack.slice(1).filter((s) => !s.name.startsWith("CNP")).map((s) => s.name).join(" > ");
        items.push([path, name, String(r[2] ?? "").trim(), unit, num(r[4]), num(r[5]), num(r[7]), num(r[6]), sec.code, group, premium, r[11] || null, r[12] || null, i + 1]);
      }
      stack.push(node);
    }
    delete cats.SYS; delete cats.CIS; delete cats.R; delete cats.K; delete cats.M; delete cats.P; delete cats.S;
    return { version: fileName, categories: cats, fields: ["path", "name", "spec", "unit", "mat", "lab", "mech", "fix", "cat", "group", "premium", "check", "note", "row"], items };
  }

  function diffPriceLists(oldList, newList) {
    const o = new Map(oldList.items.map((i) => [i[0], i]));
    let added = 0, changed = 0, same = 0;
    for (const it of newList.items) {
      const p = o.get(it[0]);
      if (!p) added++;
      else if (p[4] !== it[4] || p[5] !== it[5] || p[6] !== it[6] || p[7] !== it[7]) changed++;
      else same++;
      o.delete(it[0]);
    }
    return { added, changed, same, removed: o.size, total: newList.items.length };
  }

  // ---------- engine settings ----------
  function mergeSettings(cfgEngine) {
    const d = clone(E.DEFAULT_ENGINE_SETTINGS);
    const c = cfgEngine || {};
    for (const k of ["vatRate", "markup", "markupShell", "optimizationThresholdPct", "accuracyBandPct"]) if (c[k] != null) d[k] = c[k];
    for (const k of ["defaults", "standardSpec", "rates", "items", "standardFoundation", "standardOpenings", "standardText", "outdoorItems", "outdoorRates", "outdoorRules", "standardOutdoor", "sizeOverhead"]) if (c[k]) Object.assign(d[k], clean(c[k]));
    if (c.standardBathroom) d.standardBathroom = { ...d.standardBathroom, ...c.standardBathroom };
    if (c.alternatives) d.alternatives = c.alternatives;
    return d;
  }
  function extrasFrom(config) {
    const acc = config?.accessories || [];
    const price = (id) => acc.find((a) => String(a.id) === id)?.price;
    const baths = (config?.bathrooms || []).map((b) => b[1]);
    const accessories = Object.fromEntries(acc.filter((a) => a.price != null).map((a) => [String(a.id), a.price]));
    return { heatPump: price("5"), chimney: price("7"), fireplace: price("8"), bathroomPackage: baths.length ? Math.min(...baths) : undefined, accessories };
  }

  // ---------- material roles ----------
  const ROLES = [
    { key: "wall", label: "Obvodové murivo", prefix: "A2/01/001/", exclude: /debniac|tehla plná|stĺp|stľp/i, unit: "m2" },
    { key: "interiorWall", label: "Vnútorné nosné murivo", prefix: "A2/01/001/", exclude: /debniac|tehla plná|stĺp|stľp/i, unit: "m2" },
    { key: "partition", label: "Priečky", prefix: "A2/01/001/", exclude: /debniac|tehla plná|stĺp|stľp/i, unit: "m2" },
    { key: "facade", label: "Zateplenie fasády", prefix: "B1/008/", include: /zatepľovací systém/i, unit: "m2" },
    { key: "roofInsulation", label: "Zateplenie strechy / stropu", prefix: "B1/009/", include: /tepelná izolácia/i, exclude: /parozábran|spádov/i, unit: "m2" },
    { key: "floorInsulation", label: "Izolácia podlahy", prefix: "B1/005/", exclude: /spádov/i, unit: "m3" },
    { key: "roofing", label: "Strešná krytina", prefix: "B4/003/003/", include: /zastrešenie krytinou/i, exclude: /polykarbon/i, unit: "m2" },
    { key: "flatRoofing", label: "Hydroizolácia plochej strechy", prefix: "B1/004/", include: /hydroizolácia strešného plášťa/i, unit: "m2" },
    { key: "window", label: "Okná", prefix: "B5/002/", unit: "ks" },
  ];
  const ROLE = Object.fromEntries(ROLES.map((r) => [r.key, r]));
  function roleItems(prices, roleKey) {
    const r = ROLE[roleKey];
    return Object.values(prices).filter((it) => {
      if (!it.path_code.startsWith(r.prefix) || it.is_hidden) return false;
      const t = `${it.name} ${it.specification || ""}`;
      if (r.include && !r.include.test(t)) return false;
      if (r.exclude && r.exclude.test(t)) return false;
      return true;
    });
  }
  const BRANDS = ["porotherm", "heluz", "ytong", "porobeton", "silka", "termobrik", "family", "profi", "dryfix", "klasik", "statik", "standard", "lambda", "uni", "plus",
    "eps", "greywall", "grafit", "mineral", "nobasil", "frontrock", "fasrock", "styrodur", "xps", "purenotherm", "baumit", "silikat", "silikon",
    "orsik", "unirol", "rockmin", "isover", "knauf", "smartroof", "aluthermo", "neofloor", "dekpir", "recticel", "perimeter",
    "bramac", "klasik", "adria", "protector", "max", "ruukki", "monterrey", "lindab", "satjam", "maslen", "skridplech", "alugapa", "fatrafol", "isoflamm",
    "euro", "plast", "drev"];
  function thicknessFromText(text) {
    const t = norm(text);
    let m = t.match(/(\d{2,3})(?:[.,]\d)?\s*mm/);
    if (m) return Number(m[1]);
    m = t.match(/(\d{1,2}(?:[.,]\d)?)\s*cm/);
    if (m) return Math.round(parseNum(m[1]) * 10);
    return undefined;
  }
  /** Maps a free-text material description from the study to the closest číselník item of the role. */
  function mapMaterial(prices, roleKey, text) {
    if (!text) return null;
    const items = roleItems(prices, roleKey);
    const t = norm(text);
    const tokens = [...new Set(t.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 || /^\d+$/.test(w)))];
    // Hrúbka chýba v texte („YTONG KLASIK“): neber hocijakú hrúbku (napr. 50 mm), ale hrúbku zo štandardu ES pre túto rolu.
    const thText = thicknessFromText(text);
    const stdPath = E.DEFAULT_ENGINE_SETTINGS && E.DEFAULT_ENGINE_SETTINGS.standardSpec && E.DEFAULT_ENGINE_SETTINGS.standardSpec[roleKey];
    const th = thText || (stdPath && prices[stdPath] ? E.parseThicknessMm(prices[stdPath]) : undefined);
    let best = null;
    for (const it of items) {
      const itxt = norm(`${it.name} ${it.specification || ""} ${it.path_code} ${it.group || ""}`);
      let s = 0;
      for (const w of tokens) {
        if (/^\d+$/.test(w)) { if (w.length <= 3 && new RegExp(`(^|[^0-9,.])${w}([^0-9]|$)`).test(itxt)) s += 2.5; continue; }
        if (itxt.includes(w)) s += BRANDS.includes(w) ? 3 : 1;
      }
      const ti = E.parseThicknessMm(it);
      if (th && ti) s += Math.max(0, 4 - Math.abs(th - ti) / 20);
      if (roleKey === "window") { if (/euro|drev/.test(t) && it.path_code.endsWith("/E1")) s += 3; if (/plast/.test(t) && it.path_code.endsWith("/P1")) s += 3; }
      if (it.check_level === "CHYBA") s -= 1;
      if (!best || s > best.score) best = { item: it, score: s };
    }
    if (!best || best.score < 4) return { path: null, score: best ? best.score : 0, thickness: th };
    const conf = best.score >= 8 ? "high" : best.score >= 5.5 ? "medium" : "low";
    return { path: best.item.path_code, score: best.score, thickness: th, confidence: !thText && conf === "high" ? "medium" : conf };
  }

  // ---------- reading uploaded files ----------
  async function blobFromCanvas(canvas, q = 0.86) {
    return new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", q));
  }
  function thumbOf(canvas) {
    const s = Math.min(1, 360 / Math.max(canvas.width, canvas.height));
    const t = document.createElement("canvas");
    t.width = Math.round(canvas.width * s); t.height = Math.round(canvas.height * s);
    t.getContext("2d").drawImage(canvas, 0, 0, t.width, t.height);
    return t;
  }
  /** Rebuilds reading order from PDF text items: rows by y, left→right by x (tables "Úžitková plocha … 85,64 m2" stay on one line). */
  function layoutText(tc) {
    const items = (tc.items || []).filter((it) => it.str && it.str.trim()).map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], h: Math.abs(it.transform[3]) || 8 }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of items) {
      const r = rows[rows.length - 1];
      if (r && Math.abs(r.y - it.y) <= Math.max(2, it.h * 0.45)) r.items.push(it); else rows.push({ y: it.y, items: [it] });
    }
    return rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join(" ")).join("\n").replace(/[ \t]+/g, " ").trim();
  }
  /** A page of running text (technical report), not a drawing. */
  function isTextPage(text, vp) {
    const t = (text || "").replace(/\s+/g, " ");
    const words = (t.match(/[a-záäčďéíĺľňóôŕšťúýž]{4,}/gi) || []).length;
    const small = Math.max(vp.width, vp.height) < 900; // A4
    return words > 120 && (small || words > 400);
  }

  /** Renders every page at high resolution (long side up to 4200 px) so dimension labels stay legible for tiling. */
  async function processFile(file, maxSide = 4200, onPage) {
    const pages = [];
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const push = async (canvas, i, text, isText = false) => {
      const blob = await blobFromCanvas(canvas);
      const th = await blobFromCanvas(thumbOf(canvas), 0.8);
      pages.push({ file: file.name, page: i, blob, w: canvas.width, h: canvas.height, url: URL.createObjectURL(th), text, isText });
    };
    if (isPdf) {
      const pdfjsLib = window.pdfjsLib;
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
      const n = Math.min(doc.numPages, 40);
      for (let i = 1; i <= n; i++) {
        const page = await doc.getPage(i);
        let text = "";
        try { text = layoutText(await page.getTextContent()); } catch (e) { /* scanned page */ }
        const v1 = page.getViewport({ scale: 1 });
        // textové strany (technická správa) netreba kresliť vo vysokom rozlíšení
        const isText = isTextPage(text, v1);
        const scale = Math.min(5, (isText ? 1600 : maxSide) / Math.max(v1.width, v1.height));
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        await push(canvas, i, text, isText);
        onPage && onPage(i, n);
      }
    } else if (/^image\//.test(file.type)) {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      await push(canvas, 1, "");
      onPage && onPage(1, 1);
    } else {
      throw new Error(`Súbor ${file.name} nie je PDF ani obrázok.`);
    }
    return pages;
  }

  /** Overview + overlapping tiles of one page, each ~1500 px so text stays readable after the platform's downsizing. */
  async function pageImages(p, maxImages, tile = 1500, overlap = 140) {
    const bmp = await createImageBitmap(p.blob);
    const out = [];
    const ov = document.createElement("canvas");
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    ov.width = Math.round(bmp.width * s); ov.height = Math.round(bmp.height * s);
    ov.getContext("2d").drawImage(bmp, 0, 0, ov.width, ov.height);
    out.push({ blob: await blobFromCanvas(ov), label: "celá strana (prehľad)" });
    if (maxImages <= 1 || Math.max(bmp.width, bmp.height) <= 1700) return out;
    let scale = 1;
    let cols = Math.ceil((bmp.width - overlap) / (tile - overlap));
    let rows = Math.ceil((bmp.height - overlap) / (tile - overlap));
    while (cols * rows > maxImages - 1 && scale > 0.4) {
      scale -= 0.1;
      cols = Math.ceil((bmp.width * scale - overlap) / (tile - overlap));
      rows = Math.ceil((bmp.height * scale - overlap) / (tile - overlap));
    }
    const W = bmp.width * scale, H = bmp.height * scale;
    const stepX = cols > 1 ? (W - tile) / (cols - 1) : 0, stepY = rows > 1 ? (H - tile) / (rows - 1) : 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = Math.max(0, c * stepX), y = Math.max(0, r * stepY);
        const tw = Math.min(tile, W), th = Math.min(tile, H);
        const cv = document.createElement("canvas");
        cv.width = Math.round(tw); cv.height = Math.round(th);
        const g = cv.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
        g.drawImage(bmp, x / scale, y / scale, tw / scale, th / scale, 0, 0, tw, th);
        out.push({ blob: await blobFromCanvas(cv), label: `výrez riadok ${r + 1}/${rows}, stĺpec ${c + 1}/${cols}` });
      }
    }
    return out;
  }

  // ---------- AI reading of the study: page by page, then deterministic merge ----------
  const OPENING_TYPES = ["okno", "balkonove", "hs", "vchodove", "vedlajsie", "vnutorne", "garazova", "stresne"];

  const JSON_SHAPE = `{"typStrany":"podorys","podlazie":"1.NP","nazovDomu":null,"pocetPodlazi":null,"typDomu":null,
"plochy":{"uzitkovaCelkomM2":null,"uzitkovaPodlazia":[{"podlazie":"1.NP","m2":null}],"obytnaM2":null,"zastavanaM2":null,"garazM2":null},
"vonkajsieRozmery":{"sirkaM":null,"dlzkaM":null},
"pocetIzieb":null,
"miestnosti":[{"cislo":"1.01","nazov":"Obývačka","plochaM2":32.5}],
"otvory":[{"oznacenie":"O1","typ":"okno","sirkaM":1.5,"vyskaM":1.45,"parapetM":0.85,"pocet":2,"odhad":false}],
"kupelne":[{"nazov":"Kúpeľňa","plochaM2":7.2,"vana":1,"rohovaVana":0,"volneStojacaVana":0,"sprcha":0,"sprchaZlab":0,"umyvadla":1,"wc":1,"wcZavesne":0,"bidet":0,"samostatneWC":false}],
"rez":{"vyskaStenyM":null,"konstrukcnaVyskaM":null,"svetlaVyskaM":null,"nadmurovkaM":null,"sklonStrechy":null,"typZalozenia":null,"dtRadyMin":null,"dtRadyMax":null,"dtHrubkaMm":null,"dtVyskaRaduMm":null,"patkaSirkaM":null,"patkaVyskaM":null,"doskaHrubkaM":null,"strkHrubkaM":null},
"strecha":{"typ":null,"sklon":null},
"materialy":{"obvodoveMurivo":null,"vnutorneNosneMurivo":null,"pricky":null,"zateplenieFasady":null,"zateplenieStrechy":null,"zateplenieStrechyHrubkaMm":null,"izolaciaPodlahy":null,"krytina":null,"okna":null},
"technika":{"zdrojTepla":null,"rozvodTepla":null,"rekuperacia":null,"komin":null,"krb":null},
"pripojky":{"vodaM":null,"kanalizaciaM":null,"dazdovaM":null,"plynM":null,"elektroM":null,"odkanalizovanie":null,"vodomernaSachta":null,"revizneSachty":null,"cerpaciaSachta":null,"terasaM2":null,"spevnenePlochyM2":null,"okapovyChodnikM2":null},
"nadstandardy":[{"kluc":"fve5","mnozstvo":1,"popis":"FV panely na streche"}],
"istota":{"plochy":"high","otvory":"medium","rez":"high"},
"poznamky":""}`;

  function rulesText(extrasCatalog) {
    const extras = (extrasCatalog || []).map((d) => `${d.key} = ${d.label} (${d.unit})`).join("; ");
    return `Pravidlá:
1. Kóty sú zvyčajne v mm (11 150 = 11,15 m). Výstup v metroch a m². Text môže byť na výkrese otočený o 90° (legenda, rohová pečiatka) – čítaj ho aj tak.
2. PLOCHY – pozor na rozdiel:
   - "uzitkovaCelkomM2" vyplň LEN ak je uvedená úžitková plocha celého domu (napr. „Úžitková plocha: 80,97 m²“, „Úžitková plocha 1NP+2NP“).
   - Ak je plocha uvedená len pre podlažie („Úžitková plocha prízemia“, „…poschodia“, „…1.NP“), zapíš ju do "uzitkovaPodlazia" s názvom podlažia, NIE do uzitkovaCelkomM2.
   - „Plocha spolu“ v tabuľke miestností, ktorá obsahuje terasu, prístrešok, balkón alebo garáž, NIE je úžitková plocha.
   - "garazM2" = plocha garáže, ak je v dome.
3. OTVORY (len z pôdorysu alebo výpisu otvorov; na pohľadoch, reze a situácii nechaj "otvory": []):
   - Prejdi systematicky každú obvodovú stenu dookola, potom vnútorné steny. Každý otvor zapíš raz; rovnaké otvory spoj s počtom.
   - Značenie ES: na kótovacej reťazi je šírka otvoru (napr. 1500) a pri nej výška s parapetom „1450(850)“ = výška 1,45 m, parapet 0,85 m. „2300“ bez parapetu = dvere/okno po zem. „FIX“ alebo „PZ“ = pevné zasklenie (okno). Dvere v pôdoryse majú pri sebe „900/1970“ = šírka/výška.
   - Ak rozmery otvorov nie sú zakótované, odhadni šírku podľa mierky z najbližších kót a nastav "odhad": true.
   - typ: "okno" (aj pevné zasklenie a francúzske okno s parapetom); "balkonove" (dvere na terasu/balkón do šírky 2,4 m, aj „okno po zem“); "hs" (posuvné presklené steny širšie ako 2,4 m); "vchodove" (hlavný vstup); "vedlajsie" (ďalšie vonkajšie dvere – zo spálne/technickej miestnosti/garáže do exteriéru); "vnutorne" (dvere medzi miestnosťami – rátaj oblúky otvárania a posuvné dvere, nie otvory bez dverí); "garazova"; "stresne".
4. MIESTNOSTI: z tabuľky/legendy miestností (číslo, názov, plocha). "pocetIzieb" = počet obytných izieb (obývacia izba, spálňa, detská izba, izba, pracovňa, hosťovská); kuchyňa spojená s obývačkou sa nepočíta zvlášť.
5. KÚPEĽNE A WC: pre každú kúpeľňu a samostatné WC zapíš vybavenie podľa symbolov v pôdoryse alebo podľa popisu v texte (vaňa, polrohová/rohová vaňa = rohovaVana, voľne stojaca vaňa, sprchový kút, sprcha so žľabom/walk-in, počet umývadiel, WC kombi alebo závesné, bidet). Kúpeľňa len s WC a umývadlom = samostatneWC true.
6. REZ A ZALOŽENIE:
   - "vyskaStenyM" = výška obvodovej steny od hornej hrany základovej dosky po hornú hranu muriva/venca pod krovom (pri bungalove).
   - "konstrukcnaVyskaM" = od podlahy po podlahu (len viacpodlažné domy); "svetlaVyskaM"; "nadmurovkaM" = výška muriva podkrovia nad stropom (napr. „4 rady tvárnic + veniec 1,25 m“ → 1.25).
   - Založenie: "pasy_dt" (betónová pätka + debniace tvárnice DT/„ztracené bednění“ + doska), "pasy", "doska".
   - Rady DT spočítaj na reze (výška DT časti / 250 mm) alebo z textu („2 rady DT“, „1 až 3 radoch“ → dtRadyMin 1, dtRadyMax 3). "dtHrubkaMm" z označenia DT 25 = 250, DT 30 = 300.
   - "patkaVyskaM" a "patkaSirkaM" = betónová pätka pod DT (napr. 750 mm na reze).
7. MATERIÁLY: presne podľa textu (výrobok + hrúbka). Zateplenie strechy/stropu: ak skladba uvádza viac vrstiev izolácie (napr. 180 + 120 + 80 mm), zapíš ich a do "zateplenieStrechyHrubkaMm" daj súčet. Ak fasáda nemá kontaktné zateplenie (len omietka na murive), napíš „bez zateplenia“.
8. TYP DOMU a STRECHA uveď len kódom: typDomu "bungalov" | "podkrovie" | "poschodovy"; strecha.typ "sedlova" | "valbova" | "pultova" | "plocha" | "kombinovana". "pocetPodlazi" = počet nadzemných podlaží (obytné podkrovie sa ráta).
TECHNIKA: zdrojTepla "plyn" | "tc" | "elektro" (aj elektrické podlahové kúrenie) | "tuhe"; rozvodTepla "podlahove" | "radiatory"; rekuperacia "centralna" | "decentralna" | "ziadna"; krb true aj pre krbové kachle; komin true ak je navrhnutý komín.
9. NADŠTANDARDY: len to, čo projekt skutočne navrhuje (nie alternatívy typu „alt. zo zámkovej dlažby“ pri okapovom chodníku, nie sokel, nie farba alebo imitácia dreva na oknách). Obklad fasády (drevo, kameň, pásiky) len ak je fasáda naozaj obložená. Podlahy a žalúzie len ak sú výslovne iné ako laminát/bez žalúzií. Krb a komín len ak sú zakreslené v pôdoryse alebo popísané v správe – všeobecné poznámky na výkrese („teleso krbu bude zhotovené…“) nie sú návrh. Ak množstvo v m alebo m² nie je uvedené, daj "mnozstvo": null. Kľúče a jednotky: ${extras}. Pri m² a m uveď množstvo, ak sa dá zistiť (napr. terasa 19,02 m²).
10. PRÍPOJKY A POZEMOK (hlavne zo situácie a zo sprievodnej správy): dĺžky prípojok na pozemku v metroch od domu po miesto napojenia alebo merania (vodomerná šachta, pilierik elektromera, hranica pozemku) – "vodaM", "kanalizaciaM" (k žumpe, ČOV alebo k verejnej sieti), "dazdovaM", "plynM", "elektroM". Dĺžku zapíš, ak je okótovaná alebo popísaná; ak je trasa len zakreslená, odmeraj ju podľa mierky situácie a uveď to v poznámke. "odkanalizovanie" = "zumpa" | "cov" | "verejna". "vodomernaSachta" true/false, "revizneSachty" = počet revíznych šachiet, "cerpaciaSachta" true ak sa splašky prečerpávajú (čerpacia / prečerpávacia šachta). "terasaM2", "spevnenePlochyM2" (chodníky, parkovanie zo zámkovej dlažby), "okapovyChodnikM2". Žumpu, ČOV a prípojky už NEZAPISUJ do nadštandardov.
11. Nič nevymýšľaj – čo nie je uvedené, daj null alebo prázdne pole. istota: "high" = priamo napísané, "medium" = odčítané z kót, "low" = odhad.`;
  }

  function pagePrompt(p, labels, extrasCatalog) {
    return `Si skúsený rozpočtár slovenskej stavebnej firmy. Čítaš JEDNU stranu podkladov štúdie rodinného domu (súbor „${p.file}“, strana ${p.page}).
Obrázky: ${labels.join(", ")}. Prvý obrázok je celá strana zmenšená, ďalšie sú výrezy tej istej strany vo vysokom rozlíšení – kóty a texty čítaj z výrezov. Prvky na hranách výrezov sa prekrývajú: nepočítaj ich dvakrát.

Najprv urči typ strany: "podorys" | "rez" | "pohlad" | "vypis_otvorov" | "technicka_sprava" | "situacia" | "ine". Potom vyčítaj LEN to, čo na tejto strane naozaj je.

${rulesText(extrasCatalog)}
${p.text ? `\nText vytiahnutý z PDF tejto strany (riadky podľa polohy, môže byť neúplný):\n${p.text.slice(0, 15000)}\n` : ""}
Odpovedz IBA jedným JSON objektom v tomto tvare:
${JSON_SHAPE}`;
  }

  function textPrompt(file, pagesLabel, text, extrasCatalog) {
    return `Si skúsený rozpočtár slovenskej stavebnej firmy. Toto je text sprievodnej a technickej správy štúdie rodinného domu (súbor „${file}“, strany ${pagesLabel}). Vyčítaj z neho všetky údaje pre cenový prepočet: plochy, počet podlaží, typ domu, strechu, založenie a rady DT, výšky, materiály a hrúbky, okná, vykurovanie, ohrev vody, rekuperáciu, komín/krb, vybavenie kúpeľní a WC podľa popisu, počet izieb podľa popisu dispozície a nadštandardy (žumpa, studňa, vsakovanie, prístrešok, terasa, balkón, spevnené plochy, FVE…). typStrany = "technicka_sprava", otvory nechaj prázdne.

${rulesText(extrasCatalog)}

TEXT SPRÁVY:
${text}

Odpovedz IBA jedným JSON objektom v tomto tvare:
${JSON_SHAPE}`;
  }

  const num = (v) => { const n = parseNum(v); return n === undefined ? undefined : n; };
  const first = (arr) => arr.find((v) => v !== undefined && v !== null && v !== "");
  const EXTERIOR_ROOM = /gar[aá][žz]|teras|balk[oó]n|lod[zž]i|prístre|pristre|státi|stati|kôln|koln|závetri|zavetri|pergol|spevnen/i;
  const LIVING_ROOM = /izba|sp[aá]l[nň]|ob[yý]va|pracov[nň]|detsk|hos[tť]ov/i;
  const floorKey = (f) => {
    const t = norm(f);
    if (!t) return "";
    const m = t.match(/(\d)\s*\.?\s*n\.?\s*p/);
    if (m) return m[1] + ".NP";
    if (/prizem|1\.?\s*podla/.test(t)) return "1.NP";
    if (/podkrov|poschod|2\.?\s*podla/.test(t)) return "2.NP";
    if (/suter|pivnic|1\.?\s*pp/.test(t)) return "1.PP";
    return t.toUpperCase().replace(/\s+/g, "");
  };

  function normFloors(v) {
    const t = norm(v);
    if (!t) return undefined;
    if (/^(bungalov|podkrovie|poschodovy)$/.test(t)) return t;
    if (/(s|so) (obytnym )?podkrovim|obytne podkrovie|\+ ?podkrovie/.test(t)) return "podkrovie";
    if (/bungal|prizem|jednopodla/.test(t)) return "bungalov";
    if (/poschod|dvojpodla|trojpodla|viacpodla/.test(t)) return "poschodovy";
    if (/podkrov/.test(t) && !/bez (obytneho )?podkrov/.test(t)) return "podkrovie";
    return undefined;
  }
  function normRoof(v) {
    const t = norm(String(v || "").split(/[,;(]/)[0]);
    if (!t) return undefined;
    if (/kombin/.test(t)) return "kombinovana";
    if (/valb/.test(t)) return "valbova";
    if (/sedl/.test(t)) return "sedlova";
    if (/pult/.test(t)) return "pultova";
    if (/ploch|rovn/.test(t)) return "plocha";
    return undefined;
  }

  /** Deterministic merge of per-page results into one study description. */
  function mergePages(results, catalog) {
    const R = results.filter(Boolean);
    const byType = (t) => R.filter((r) => r.typStrany === t);
    const plans = byType("podorys");
    const schedules = byType("vypis_otvorov");
    const sections = byType("rez");
    const views = byType("pohlad");
    const tech = byType("technicka_sprava");
    const ordered = [...tech, ...sections, ...plans, ...schedules, ...views, ...R];
    const conf = {}, evidence = {};
    const src = (r) => (r.__pages ? `${r.__file}, str. ${r.__pages}` : `${r.__file}, str. ${r.__page}`);
    const P = (r) => r.plochy || {};

    // floors (dedupe by floor label – keep the plan with more content)
    const floors = {};
    for (const r of plans) {
      const key = floorKey(r.podlazie) || `S${r.__page}`;
      const score = (r.otvory || []).length + (r.miestnosti || []).length;
      if (!floors[key] || score > floors[key].score) floors[key] = { r, score };
    }
    const floorPlans = Object.values(floors).map((f) => f.r);
    const garageRooms = floorPlans.flatMap((r) => (r.miestnosti || []).filter((m) => /gar[aá][žz]/i.test(m.nazov || "") && num(m.plochaM2)));
    const garageM2 = first(ordered.map((r) => num(P(r).garazM2))) || (garageRooms.length ? garageRooms.reduce((a, m) => a + num(m.plochaM2), 0) : undefined);

    const floorList = floorPlans.map((r) => {
      const rooms = (r.miestnosti || []).filter((m) => num(m.plochaM2));
      const roomSum = rooms.filter((m) => !EXTERIOR_ROOM.test(m.nazov || "")).reduce((a, m) => a + num(m.plochaM2), 0);
      const declared = first((P(r).uzitkovaPodlazia || []).map((x) => num(x && x.m2)));
      return { key: floorKey(r.podlazie), name: r.podlazie || `str. ${r.__page}`, usableAreaM2: roomSum ? Math.round(roomSum * 100) / 100 : declared, rooms: rooms.length };
    });

    // usable area: whole house value > sum of per-floor values from the report > sum of rooms from plans
    let usable = first(ordered.map((r) => num(P(r).uzitkovaCelkomM2)));
    if (usable) { conf.usableAreaM2 = "high"; evidence.usableAreaM2 = src(ordered.find((r) => num(P(r).uzitkovaCelkomM2) === usable)); }
    if (!usable) {
      const perFloor = {};
      for (const r of ordered) for (const x of P(r).uzitkovaPodlazia || []) {
        const k = floorKey(x && x.podlazie) || "?"; const v = num(x && x.m2);
        if (v && perFloor[k] === undefined) perFloor[k] = v;
      }
      const vals = Object.values(perFloor);
      if (vals.length) { usable = Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100; conf.usableAreaM2 = "high"; evidence.usableAreaM2 = `súčet podlaží (${Object.entries(perFloor).map(([k, v]) => `${k} ${v}`).join(" + ")})`; }
    }
    if (!usable) {
      const s = floorList.reduce((a, f) => a + (f.usableAreaM2 || 0), 0);
      if (s) { usable = Math.round(s * 100) / 100; conf.usableAreaM2 = "medium"; evidence.usableAreaM2 = "súčet plôch miestností z pôdorysov"; }
    }
    // garage inside the usable area → take it out (priced separately)
    if (usable && garageM2) {
      const allRooms = floorPlans.flatMap((r) => (r.miestnosti || []).filter((m) => num(m.plochaM2) && !/teras|balk|prístre|pristre|státi|stati/i.test(m.nazov || "")));
      const withGarage = allRooms.reduce((a, m) => a + num(m.plochaM2), 0);
      if (withGarage && Math.abs(withGarage - usable) / usable < 0.02) { usable = Math.round((usable - garageM2) * 100) / 100; evidence.usableAreaM2 = `${evidence.usableAreaM2 || ""} – bez garáže ${garageM2} m²`.trim(); }
    }
    let built = first(ordered.map((r) => num(P(r).zastavanaM2)));
    if (built) { conf.builtAreaM2 = "high"; evidence.builtAreaM2 = src(ordered.find((r) => num(P(r).zastavanaM2) === built)); }
    const dimsPage = [...floorPlans.filter((r) => floorKey(r.podlazie) === "1.NP"), ...ordered].find((r) => r.vonkajsieRozmery && num(r.vonkajsieRozmery.sirkaM) && num(r.vonkajsieRozmery.dlzkaM));
    const widthM = dimsPage ? num(dimsPage.vonkajsieRozmery.sirkaM) : undefined;
    const lengthM = dimsPage ? num(dimsPage.vonkajsieRozmery.dlzkaM) : undefined;
    if (dimsPage) { conf.widthM = conf.lengthM = "medium"; evidence.widthM = evidence.lengthM = src(dimsPage); }
    if (!built && widthM && lengthM) { built = Math.round(widthM * lengthM * 100) / 100; conf.builtAreaM2 = "low"; evidence.builtAreaM2 = "vonkajšie rozmery (obdĺžnik)"; }

    // openings: exterior from schedule if present, otherwise from plans; interior doors from schedule or plans
    let estimated = false;
    const normOp = (o, floor) => {
      const t = String(o.typ || "").toLowerCase();
      const type = OPENING_TYPES.includes(t) ? t : /hs|posuv/.test(t) ? "hs" : /balk|teras/.test(t) ? "balkonove" : /vchod/.test(t) ? "vchodove" : /gar/.test(t) ? "garazova" : /vn[uú]t|interi/.test(t) ? "vnutorne" : /stre/.test(t) ? "stresne" : "okno";
      let w = num(o.sirkaM), h = num(o.vyskaM);
      if (w && w > 20) w = w / 1000; if (h && h > 20) h = h / 1000; // mm → m
      if (o.odhad) estimated = true;
      return clean({ type, widthM: w, heightM: h, count: Math.max(1, Math.round(num(o.pocet) || 1)), floor, label: o.oznacenie || undefined });
    };
    const fromSchedule = schedules.flatMap((r) => (r.otvory || []).map((o) => normOp(o, r.podlazie || "výpis")));
    const fromPlans = floorPlans.flatMap((r) => (r.otvory || []).map((o) => normOp(o, r.podlazie || `str. ${r.__page}`)));
    const isExt = (o) => o.type !== "vnutorne";
    let openings;
    if (fromSchedule.some(isExt)) {
      openings = [...fromSchedule.filter(isExt), ...(fromSchedule.some((o) => !isExt(o)) ? fromSchedule.filter((o) => !isExt(o)) : fromPlans.filter((o) => !isExt(o)))];
      conf.openings = "high"; evidence.openings = "výpis otvorov";
    } else {
      openings = fromPlans;
      conf.openings = fromPlans.length ? (estimated ? "low" : "medium") : "low"; evidence.openings = fromPlans.length ? (estimated ? "pôdorysy – rozmery odhadnuté podľa mierky" : "pôdorysy") : "otvory sa nenašli";
    }
    const merged = [];
    for (const o of openings) {
      const m = merged.find((x) => x.type === o.type && x.floor === o.floor && x.widthM === o.widthM && x.heightM === o.heightM);
      if (m) m.count += o.count; else merged.push({ ...o });
    }

    // bathrooms – plans first, technical report as fallback
    const toBath = (b, floor) => clean({
      name: `${b.nazov || (b.samostatneWC ? "WC" : "Kúpeľňa")}${floor ? " (" + floor + ")" : ""}`, areaM2: num(b.plochaM2),
      bathtub: num(b.vana) || 0, cornerTub: num(b.rohovaVana) || 0, freestandingTub: num(b.volneStojacaVana) || 0,
      shower: num(b.sprcha) || 0, showerDrain: num(b.sprchaZlab) || 0, washbasins: num(b.umyvadla) || 0,
      wc: num(b.wc) || 0, wcWallHung: num(b.wcZavesne) || 0, bidet: num(b.bidet) || 0, isWc: !!b.samostatneWC,
    });
    let baths = floorPlans.flatMap((r) => (r.kupelne || []).map((b) => toBath(b, r.podlazie)));
    let bathSrc = "pôdorysy – zariaďovacie predmety";
    if (!baths.length) { const t = tech.find((r) => (r.kupelne || []).length); if (t) { baths = t.kupelne.map((b) => toBath(b, "")); bathSrc = "technická správa – popis kúpeľní"; } }
    const wet = (b) => b.bathtub || b.cornerTub || b.freestandingTub || b.shower || b.showerDrain;
    const bathrooms = baths.filter((b) => !b.isWc && wet(b)).length;
    const wcs = baths.filter((b) => b.isWc || (!wet(b) && (b.wc || b.wcWallHung))).length;
    if (baths.length) { conf.bathrooms = bathSrc.startsWith("pôd") ? "high" : "medium"; evidence.bathrooms = bathSrc; }

    // section & foundation
    const rz = Object.assign({}, ...sections.map((r) => clean(r.rez || {})).reverse());
    const rzAny = Object.assign({}, ...R.map((r) => clean(r.rez || {})).reverse(), rz);
    const dtMin = num(rz.dtRadyMin) ?? num(rzAny.dtRadyMin), dtMax = num(rz.dtRadyMax) ?? num(rzAny.dtRadyMax);
    // rozpätie radov DT (svah, napr. „2 až 8 radov“): počíta sa priemer, nie maximum (overené na rozpočte ES)
    const dtRows = dtMin != null && dtMax != null ? Math.round((dtMin + dtMax) / 2) : dtMax ?? dtMin;
    const dtTh = first([...tech, ...sections, ...R].map((r) => num(r.rez && r.rez.dtHrubkaMm)));
    const hasDt = !!(dtRows || dtTh || /dt|debn/i.test(String(rzAny.typZalozenia || "")));
    const fType = hasDt ? "pasy_dt" : ["pasy", "doska"].includes(rzAny.typZalozenia) ? rzAny.typZalozenia : /dosk/i.test(String(rzAny.typZalozenia || "")) ? "doska" : rzAny.typZalozenia ? "pasy" : undefined;
    const foundation = fType ? clean({
      type: fType,
      dtRows, dtThicknessMm: dtTh, dtRowHeightMm: num(rzAny.dtVyskaRaduMm),
      stripWidthM: num(rzAny.patkaSirkaM), stripDepthM: num(rzAny.patkaVyskaM), slabThicknessM: num(rzAny.doskaHrubkaM), gravelThicknessM: num(rzAny.strkHrubkaM),
    }) : undefined;
    if (foundation) {
      conf.foundation = dtMin != null && dtMax != null && dtMin !== dtMax ? "low" : sections.length ? "high" : "medium";
      evidence.foundation = dtMin != null && dtMax != null && dtMin !== dtMax ? `projekt uvádza ${dtMin}–${dtMax} radov DT, počíta sa s priemerom ${dtRows}` : sections.length ? src(sections[0]) : "technická správa";
    }
    const typDomu = first(ordered.map((r) => normFloors(r.typDomu)));
    const nFloors = first(ordered.map((r) => num(r.pocetPodlazi))) || (floorList.length > 1 ? floorList.length : undefined);
    const knee = num(rzAny.nadmurovkaM);
    const floorsType = typDomu || (nFloors === 1 ? "bungalov" : floorList.length >= 2 || nFloors >= 2 ? (knee ? "podkrovie" : "poschodovy") : floorList.length === 1 ? "bungalov" : undefined);
    if (floorsType) conf.floorsType = typDomu ? "high" : "medium";
    const wallH = num(rzAny.vyskaStenyM), floorH = num(rzAny.konstrukcnaVyskaM);
    const storey = floorsType === "bungalov" ? wallH ?? floorH : floorH ?? wallH;
    const roofType = first(ordered.map((r) => normRoof(r.strecha && r.strecha.typ)));
    const pitch = first(tech.map((r) => num(r.strecha && r.strecha.sklon) || num(r.rez && r.rez.sklonStrechy))) || num(rz.sklonStrechy) || num(rzAny.sklonStrechy) || first(ordered.map((r) => num(r.strecha && r.strecha.sklon)));
    if (storey) { conf.storeyHeightM = sections.length ? "high" : "medium"; evidence.storeyHeightM = sections[0] ? src(sections[0]) : "technická správa"; }
    if (pitch) conf.roofPitchDeg = "high";
    if (roofType) conf.roofType = "high";
    if (knee) conf.kneeWallM = "high";

    const planRooms = floorPlans.map((r) => num(r.pocetIzieb)).filter((v) => v != null);
    let rooms = planRooms.length ? planRooms.reduce((a, b) => a + b, 0) : first(tech.map((r) => num(r.pocetIzieb)));
    if (!rooms) { const n = floorPlans.flatMap((r) => r.miestnosti || []).filter((m) => LIVING_ROOM.test(m.nazov || "")).length; if (n) rooms = n; }

    const mats = {};
    for (const k of ["obvodoveMurivo", "vnutorneNosneMurivo", "pricky", "zateplenieFasady", "zateplenieStrechy", "izolaciaPodlahy", "krytina", "okna"]) {
      mats[k] = first(ordered.map((r) => r.materialy && r.materialy[k]));
    }
    const roofTh = first(ordered.map((r) => num(r.materialy && r.materialy.zateplenieStrechyHrubkaMm)));
    if (roofTh) mats.zateplenieStrechy = `${(mats.zateplenieStrechy || "minerálna vlna").replace(/\d{1,3}(?:[.,]\d)?\s*(mm|cm)/gi, "").replace(/[+,;]\s*$/, "").trim()} ${roofTh} mm`;
    const tk = {};
    for (const k of ["zdrojTepla", "rozvodTepla", "rekuperacia", "komin", "krb"]) tk[k] = first(ordered.map((r) => r.technika && r.technika[k]));
    const bool = (v) => (v === true || v === "true" || v === "áno" ? true : v === false || v === "false" || v === "nie" ? false : undefined);

    const extras = {};
    for (const r of R) for (const e of r.nadstandardy || []) {
      if (!e || !e.kluc) continue;
      const def = (catalog || []).find((d) => d.key === e.kluc);
      const perUnit = def && def.unit !== "ks";
      const given = num(e.mnozstvo);
      const q = perUnit ? (given && given > 1 ? given : 0) : given || 1;
      const prev = extras[e.kluc];
      if (!prev || q > prev.qty) extras[e.kluc] = clean({ key: e.kluc, qty: q, note: e.popis || "", qtyMissing: perUnit && !q ? true : undefined });
    }
    // Prípojky: situácia a správa majú prednosť, inak najväčšia nájdená hodnota
    const pr = {};
    const prSrc = [...R.filter((r) => r.typStrany === "situacia"), ...tech, ...R];
    for (const k of ["vodaM", "kanalizaciaM", "dazdovaM", "plynM", "elektroM", "revizneSachty", "terasaM2", "spevnenePlochyM2", "okapovyChodnikM2"]) pr[k] = first(prSrc.map((r) => num(r.pripojky && r.pripojky[k])));
    pr.odkanalizovanie = first(prSrc.map((r) => { const v = r.pripojky && String(r.pripojky.odkanalizovanie || "").toLowerCase(); return /žump|zump/.test(v) ? "zumpa" : /čov|cov|čistič/.test(v) ? "cov" : /verej|ulič|obec/.test(v) ? "verejna" : undefined; }));
    pr.vodomernaSachta = first(prSrc.map((r) => bool(r.pripojky && r.pripojky.vodomernaSachta)));
    pr.cerpaciaSachta = first(prSrc.map((r) => bool(r.pripojky && r.pripojky.cerpaciaSachta)));
    const sit = R.find((r) => r.typStrany === "situacia" && r.pripojky && Object.values(r.pripojky).some((v) => v != null && v !== ""));
    const houseName = first(ordered.map((r) => r.nazovDomu));
    const notesList = [...new Set(R.map((r) => (r.poznamky || "").trim()).filter(Boolean))].slice(0, 16);
    const notes = notesList.join(" ");
    return {
      houseName, notes, notesList, garageM2, pripojky: clean(pr), pripojkySrc: sit ? `situácia – ${sit.__file} str. ${sit.__page}` : Object.values(clean(pr)).length ? "technická správa" : "",
      pages: R.map((r) => ({ file: r.__file, page: r.__pages || r.__page, type: r.typStrany, floor: r.podlazie })),
      study: clean({
        usableAreaM2: usable, builtAreaM2: built, widthM, lengthM, floorsType, roofType, roofPitchDeg: pitch, storeyHeightM: storey, kneeWallM: knee,
        rooms, bathrooms: baths.length ? bathrooms : undefined, wcs: baths.length ? wcs : undefined,
        storeys: floorsType === "poschodovy" && nFloors > 2 ? nFloors : undefined,
        garages: merged.some((o) => o.type === "garazova") ? merged.filter((o) => o.type === "garazova").reduce((a, o) => a + o.count, 0) : garageM2 ? Math.max(1, Math.round(garageM2 / 18)) : undefined,
        heatingSource: tk.zdrojTepla, heatingDistribution: tk.rozvodTepla,
        centralRecuperation: tk.rekuperacia ? tk.rekuperacia === "centralna" : undefined,
        chimney: bool(tk.komin), fireplace: bool(tk.krb),
        openings: merged.length ? merged : undefined,
        bathroomsDetail: baths.length ? baths.map(({ isWc, ...b }) => b) : undefined,
        foundation, floors: floorList.length ? floorList.map(({ key, ...f }) => f) : undefined,
        extras: Object.values(extras).length ? Object.values(extras) : undefined,
      }),
      materialTexts: mats, confidence: conf, evidence,
    };
  }

  /**
   * Vonkajšie zariadenie pre prepočet: štandard ES (žumpa, vodomerná šachta, pilierik elektromera, plyn pri plynovom kúrení)
   * + čo sa našlo v situácii / správe + položky skupiny „Pozemok“ z nadštandardov. Dĺžky bez údaja ostávajú prázdne – doplní obchodník.
   */
  function initOutdoor(study, settings, pr = {}, prSrc = "") {
    const so = settings.standardOutdoor, ex = [...(study.extras || [])];
    const take = (key) => { const i = ex.findIndex((x) => x.key === key); return i < 0 ? undefined : ex.splice(i, 1)[0]; };
    const qty = (key) => { const x = take(key); return x && x.qty > 1 ? x.qty : undefined; };
    const fromExtras = { waterM: qty("pripojkaVoda"), sewerM: qty("pripojkaKanal"), gasM: qty("pripojkaPlyn"), elecM: qty("pripojkaElektro"), pavedM2: qty("zamkovaDlazba") };
    const zumpa = take("zumpa"), cov = take("cov");
    const outdoorKeys = new Set(settings.extrasCatalog.filter((d) => d.group === settings.outdoorRules.extrasGroup).map((d) => d.key));
    const yard = ex.filter((x) => outdoorKeys.has(x.key));
    const gas = (study.heatingSource || "plyn") === "plyn" ? so.gasWhenGasHeating : !!(pr.plynM || fromExtras.gasM);
    const o = clean({
      waterM: pr.vodaM ?? fromExtras.waterM, sewerM: pr.kanalizaciaM ?? fromExtras.sewerM, rainM: pr.dazdovaM,
      gas, gasM: gas ? pr.plynM ?? fromExtras.gasM : undefined, elecM: pr.elektroM ?? fromExtras.elecM,
      waterMeterPit: pr.vodomernaSachta === false ? "" : so.waterMeterPit,
      sewage: pr.odkanalizovanie || (cov ? "cov" : zumpa ? "zumpa" : so.sewage),
      revisionPits: pr.revizneSachty ?? so.revisionPits, pumpStation: pr.cerpaciaSachta ? settings.outdoorItems.pumpStation : undefined, elecPost: so.elecPost, gasPost: so.gasPost,
      terraceM2: pr.terasaM2, pavedM2: pr.spevnenePlochyM2 ?? fromExtras.pavedM2, dripPathM2: pr.okapovyChodnikM2,
      extras: yard.length ? yard : undefined,
    });
    const conf = {}, evidence = {};
    for (const [k, src] of [["waterM", "vodaM"], ["sewerM", "kanalizaciaM"], ["gasM", "plynM"], ["elecM", "elektroM"]]) {
      if (pr[src] != null) { conf[k] = "medium"; evidence[k] = prSrc || "podklady"; }
    }
    o.confidence = conf; o.evidence = evidence;
    return o;
  }
  /** Study extras without the yard items (those are priced in the outdoor section). */
  const houseExtras = (study, settings) => (study.extras || []).filter((x) => !E.isOutdoorExtra(settings, x.key));

  /** Converts the merged AI result into study params (materials mapped onto the price list). */
  function aiToStudy(merged, prices) {
    const study = { ...merged.study, materials: {}, materialTexts: {}, confidence: { ...merged.confidence }, evidence: { ...merged.evidence } };
    if (study.widthM && study.lengthM && study.builtAreaM2 && study.widthM * study.lengthM < study.builtAreaM2 * 0.8) { study.confidence.widthM = "low"; study.confidence.lengthM = "low"; }
    if (study.usableAreaM2 && study.builtAreaM2 && study.floorsType === "bungalov" && study.usableAreaM2 > study.builtAreaM2) study.confidence.usableAreaM2 = "low";
    for (const [src, role] of Object.entries(MAT_FIELDS)) {
      const text = merged.materialTexts[src];
      if (!text) continue;
      study.materialTexts[role] = text;
      const r = role === "roofing" && study.roofType === "plocha" ? "flatRoofing" : role;
      const th = thicknessFromText(text);
      if (r === "roofInsulation" && th && th > 220) {
        // hrubá izolácia sa kladie v 2 vrstvách: 200 mm + zvyšok
        const bare = text.replace(/\d{1,3}(?:[.,]\d)?\s*(mm|cm)/gi, "").trim();
        const m1 = mapMaterial(prices, r, `${bare} 200 mm`), m2 = mapMaterial(prices, r, `${bare} ${th - 200} mm`);
        if (m1 && m1.path) { study.materials.roofInsulation = m1.path; study.materials.roofInsulation2 = m2 && m2.path ? m2.path : ""; study.confidence.mat_roofInsulation = m1.confidence; }
        else study.confidence.mat_roofInsulation = "low";
        continue;
      }
      const m = mapMaterial(prices, r, text);
      if (m && m.path) { study.materials[r] = m.path; study.confidence["mat_" + r] = m.confidence; } else study.confidence["mat_" + r] = "low";
      if (role === "floorInsulation" && m && m.thickness) study.materials.floorInsulationThicknessM = m.thickness / 1000;
    }
    const lows = Object.entries(study.confidence).filter(([k, c]) => k.startsWith("mat_") && c === "low").length;
    study.confidence.materials = lows > 2 ? "low" : lows > 0 ? "medium" : "high";
    return study;
  }

  const MAT_FIELDS = {
    obvodoveMurivo: "wall", vnutorneNosneMurivo: "interiorWall", pricky: "partition", zateplenieFasady: "facade",
    zateplenieStrechy: "roofInsulation", izolaciaPodlahy: "floorInsulation", krytina: "roofing", okna: "window",
  };

  /** Reads the study: text pages of each file in one text call, drawings page by page (overview + high-res tiles), 2 in parallel; then merges. */
  async function readStudyWithAI(sample, pages, prices, extrasCatalog, onProgress) {
    const limits = await sample.limits().catch(() => null);
    const maxCount = Math.min(limits?.images?.maxCount || 0, 16);
    const maxBytes = limits?.maxPromptBytes || 200000;
    const jobs = [];
    const byFile = {};
    for (const p of pages) (byFile[p.file] = byFile[p.file] || []).push(p);
    for (const [file, ps] of Object.entries(byFile)) {
      const textPages = ps.filter((p) => p.isText);
      let chunk = [], size = 0;
      const flush = () => { if (chunk.length) jobs.push({ kind: "text", file, pages: chunk }); chunk = []; size = 0; };
      for (const p of textPages) {
        const t = `--- strana ${p.page} ---\n${p.text}\n`;
        if (size + t.length > Math.min(60000, maxBytes - 15000)) flush();
        chunk.push(p); size += t.length;
      }
      flush();
      for (const p of ps.filter((p) => !p.isText)) jobs.push({ kind: "page", file, page: p });
    }
    const results = new Array(jobs.length);
    const errors = [];
    let done = 0, next = 0;
    async function worker() {
      while (next < jobs.length) {
        const i = next++;
        const j = jobs[i];
        try {
          if (j.kind === "text") {
            const label = j.pages.length > 1 ? `${j.pages[0].page}–${j.pages[j.pages.length - 1].page}` : String(j.pages[0].page);
            const text = j.pages.map((p) => `--- strana ${p.page} ---\n${p.text}`).join("\n");
            const r = await sample.json(textPrompt(j.file, label, text, extrasCatalog), { modelTier: "complex", cache: false });
            results[i] = { ...r, typStrany: "technicka_sprava", otvory: [], __file: j.file, __page: j.pages[0].page, __pages: label };
          } else {
            const p = j.page;
            const imgs = maxCount ? await pageImages(p, maxCount) : [];
            const opts = { modelTier: "complex", cache: false };
            if (imgs.length) opts.images = imgs.map((x) => x.blob);
            const r = await sample.json(pagePrompt(p, imgs.map((x) => x.label), extrasCatalog), opts);
            results[i] = { ...r, __file: p.file, __page: p.page };
          }
        } catch (e) {
          const where = j.kind === "text" ? `${j.file}, text správy` : `${j.file}, str. ${j.page.page}`;
          errors.push(`${where}: ${(e && (e.message || e.code)) || e}`);
          if (e && (e.code === "not_granted" || e.code === "rate_limited")) throw e;
        }
        done++;
        onProgress && onProgress(done, jobs.length, j.kind === "text" ? { file: j.file, page: `${j.pages.length} str. textu` } : j.page);
      }
    }
    await Promise.all([worker(), worker()]);
    if (!results.some(Boolean)) throw new Error(errors[0] || "Žiadna strana sa nedala prečítať.");
    const merged = mergePages(results, extrasCatalog);
    return { merged, raw: results.filter(Boolean), study: aiToStudy(merged, prices), errors, jobs: jobs.length };
  }

  /** Short AI explanation of the result, strictly from computed numbers (optional). */
  async function explainWithAI(sample, result, houseName) {
    const drivers = result.topDrivers.map((d) => `${d.label}: ${fmtSigned(d.deltaInclVat)} (${d.explanation})`).join("\n");
    const opts = result.optimizations.map((o) => `${o.title}: úspora ${fmtEur(o.savingInclVat)}`).join("\n");
    const prompt = `Napíš pre obchodníka stavebnej firmy 2–3 krátke vety po slovensky (bez odrážok, prirodzene, bez fráz), prečo sa cena štúdie líši od východiskového domu ${houseName}. Použi IBA tieto čísla, nič nevymýšľaj.
Cena východiskového domu: ${fmtEur(result.basePriceInclVat)}
Odborný odhad: ${fmtEur(result.estimateInclVat)} (${fmtPct(result.changePct)})
Hlavné vplyvy:
${drivers}
${opts ? "Možné úspory:\n" + opts : ""}`;
    const r = await sample(prompt, { modelTier: "quick" });
    return r.text.trim();
  }

  // ---------- study summary (UI + PDF) ----------
  const OPENING_LABEL = { okno: "Okná", balkonove: "Balkónové / terasové dvere", hs: "HS portál (posuvný)", vchodove: "Vchodové dvere", vedlajsie: "Vedľajšie vonkajšie dvere", garazova: "Garážová brána", vnutorne: "Vnútorné dvere", stresne: "Strešné okná" };
  const FIXTURE_LABEL = { bathtub: "vaňa", cornerTub: "rohová vaňa", freestandingTub: "voľne stojaca vaňa", shower: "sprchový kút", showerDrain: "sprcha so žľabom", washbasins: "umývadlo", wc: "WC", wcWallHung: "závesné WC", bidet: "bidet" };
  const FOUNDATION_LABEL = { pasy_dt: "Pásy z betónu + debniace tvárnice (DT)", pasy: "Betónové pásy", doska: "Základová doska" };
  function bathroomText(b) {
    const parts = Object.entries(FIXTURE_LABEL).filter(([k]) => b[k]).map(([k, l]) => (b[k] > 1 ? `${b[k]}× ${l}` : l));
    return parts.length ? parts.join(", ") : "bez zariaďovacích predmetov";
  }
  function dtPieces(p, settings) {
    const f = p.foundation;
    if (!f || f.type !== "pasy_dt" || !f.dtRows) return null;
    const g = E.computeGeometry(p, settings);
    const len = f.lengthM || g.foundationLengthM;
    const perRow = Math.ceil(len / 0.5);
    return { lengthM: len, lengthEstimated: !f.lengthM, perRow, rows: f.dtRows, pieces: perRow * f.dtRows, thicknessMm: f.dtThicknessMm, rowHeightMm: f.dtRowHeightMm || 250 };
  }
  /** Splits the reader's free-text page notes into sentences and sorts them into topics (array order = matching priority). */
  const NOTE_TOPICS = [
    { key: "otvory", label: "Okná a dvere", re: /okn|okien|okno|oken|otvor|dver|\bHS\b|portál|výpis otvor|parapet|preklad|svetlík|strešné okn/i },
    { key: "kupelne", label: "Kúpeľne a vybavenie", re: /kúpeľ|kupel|\bWC\b|van[aiu]|sprch|umyvad|obklad|dlažb|podlah|schod|kuchyn/i },
    { key: "technika", label: "Technika a inštalácie", re: /kúren|kuren|tepeln[ée] čerpad|kotol|plyn|rekuper|komín|komin|krb|elektr|FVE|fotovolt|kanaliz|vodovod|TÚV|ohrev|klimat/i },
    { key: "pripojky", label: "Pozemok a prípojky", re: /prípoj|pripoj|situáci|pozem|parcel|žump|ČOV|studň|vsak|oplot|spevnen|terén/i },
    { key: "strecha", label: "Strecha", re: /strech|krov|krytin|sklon|väzník|nadmurov|podkrov|odkvap|štít/i },
    { key: "konstrukcie", label: "Založenie a konštrukcie", re: /založ|základ|\bDT\b|debniac|murivo|murov|tehl|strop|veniec|venc|Ytong|Porotherm|Heluz|zatepl|izolác|EPS|minerál|fasád/i },
    { key: "plochy", label: "Plochy a dispozícia", re: /ploch|m²|m2|izb|miestnost|dispoz|podlaž|\bNP\b|garáž|teras|balkón|rozmer/i },
  ];
  const WARN_RE = /chýb|chyba|nie je (uveden|zakresl|čitateľ)|neuveden|nečitateľ|odhad|overiť|nejasn|nepresn|predpoklad|nezodpoved|rozpor|nesedí/i;
  function groupNotes(src) {
    const list = Array.isArray(src) ? src : src ? [src] : [];
    const seen = new Set(), groups = {};
    for (const n of list) {
      const parts = String(n).replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-ZÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ])/);
      for (let s of parts) {
        s = s.trim().replace(/^[-–•\s]+/, "");
        if (s.length < 4) continue;
        const k = s.toLowerCase().replace(/[^a-záäčďéíĺľňóôŕšťúýž0-9]+/g, " ").trim();
        if (seen.has(k)) continue;
        seen.add(k);
        const t = NOTE_TOPICS.find((x) => x.re.test(s));
        const key = t ? t.key : "ostatne";
        (groups[key] = groups[key] || []).push({ text: s, warn: WARN_RE.test(s) });
      }
    }
    const order = ["plochy", "konstrukcie", "strecha", "otvory", "kupelne", "technika", "pripojky", "ostatne"];
    return order.map((k) => NOTE_TOPICS.find((t) => t.key === k) || { key: "ostatne", label: "Ostatné" }).filter((t) => groups[t.key]).map((t) => ({ key: t.key, label: t.label, items: groups[t.key] }));
  }
  function studySummary(p, settings) {
    const ops = p.openings || [];
    const byType = Object.keys(OPENING_LABEL).map((t) => {
      const list = ops.filter((o) => o.type === t);
      return { type: t, label: OPENING_LABEL[t], count: list.reduce((a, o) => a + (o.count || 0), 0), area: list.reduce((a, o) => a + E.openingArea(o), 0) };
    }).filter((x) => x.count);
    const ext = byType.filter((x) => x.type !== "vnutorne" && x.type !== "stresne");
    const baths = E.bathroomsOf(p, settings);
    const extras = (p.extras || []).map((x) => {
      const d = settings.extrasCatalog.find((c) => c.key === x.key);
      return { ...x, label: d ? d.label : x.key, unit: d ? d.unit : "ks", priced: d ? d.pricing.type !== "none" : false };
    });
    return {
      byType, extCount: ext.reduce((a, x) => a + x.count, 0), extArea: ext.reduce((a, x) => a + x.area, 0),
      baths: baths.map((b, i) => ({ name: b.name || (i === 0 ? "Kúpeľňa" : "Kúpeľňa / WC"), areaM2: b.areaM2, text: bathroomText(b) })),
      fromDetail: !!(p.bathroomsDetail && p.bathroomsDetail.length),
      foundation: p.foundation ? { ...p.foundation, label: FOUNDATION_LABEL[p.foundation.type] || p.foundation.type } : null,
      dt: dtPieces(p, settings), extras,
    };
  }

  // ---------- PDF ----------
  async function blobToDataUrl(blob) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
  }
  function buildPdfDoc({ est, result, house, company, rep, logoDataUrl, studyParams, baseParams, settings, variants, outdoor }) {
    const green = "#074d8a", grey = "#4a5b6e", line = "#e1e8f0"; // modrá ES (premenná ostáva „green“ kvôli zvyšku kódu)
    const today = fmtDate(Date.now());
    const pct = result.changePct;
    const kv = (k, v) => [{ text: k, color: grey }, { text: v, alignment: "right" }];
    const sumB = studySummary(baseParams, settings), sumS = studySummary(studyParams, settings);
    const tblLayout = { hLineColor: () => line, vLineWidth: () => 0, hLineWidth: (i) => (i === 0 ? 0 : 0.5), paddingTop: () => 4, paddingBottom: () => 4 };
    const paramRows = [
      ["Úžitková plocha", fmtNum(baseParams.usableAreaM2, 1) + " m²", fmtNum(studyParams.usableAreaM2, 1) + " m²"],
      ["Zastavaná plocha", fmtNum(baseParams.builtAreaM2, 1) + " m²", fmtNum(studyParams.builtAreaM2, 1) + " m²"],
      ["Typ domu", FLOORS_LABEL[baseParams.floorsType], FLOORS_LABEL[studyParams.floorsType]],
      ["Strecha", ROOF_LABEL[baseParams.roofType], ROOF_LABEL[studyParams.roofType]],
      ["Počet izieb", house.rooms ? String(house.rooms) : "–", studyParams.rooms ? String(studyParams.rooms) : "–"],
      ["Okná a vonkajšie dvere", sumB.extCount ? `${sumB.extCount} ks · ${fmtNum(sumB.extArea, 1)} m²` : "–", sumS.extCount ? `${sumS.extCount} ks · ${fmtNum(sumS.extArea, 1)} m²` : "–"],
      ["Kúpeľne / samostatné WC", `${baseParams.bathrooms ?? "–"} / ${baseParams.wcs ?? "–"}`, `${studyParams.bathrooms ?? "–"} / ${studyParams.wcs ?? "–"}`],
      ["Zdroj tepla", HEAT_LABEL[baseParams.heatingSource], HEAT_LABEL[studyParams.heatingSource]],
    ];
    const content = [
      {
        columns: [
          logoDataUrl ? { image: logoDataUrl, fit: [140, 46] } : { text: (company.name || "Ekonomické stavby").toUpperCase(), bold: true, color: green, fontSize: 13 },
          { stack: [{ text: company.name || "Ekonomické stavby s.r.o.", bold: true }, { text: [company.address, company.web].filter(Boolean).join(" · "), color: grey, fontSize: 8 }], alignment: "right" },
        ],
      },
      { canvas: [{ type: "line", x1: 0, y1: 8, x2: 515, y2: 8, lineWidth: 0.6, lineColor: line }] },
      { text: "Odborný cenový odhad", fontSize: 20, bold: true, margin: [0, 18, 0, 2] },
      { text: `Prepočet štúdie rodinného domu z východiskového domu ${house.name}`, color: grey, margin: [0, 0, 0, 14] },
      {
        columns: [
          { width: "*", table: { widths: ["auto", "*"], body: [kv("Klient", est.clientName || "–"), kv("Dátum", today), kv("Číslo prepočtu", (est.id || "").toUpperCase())] }, layout: "noBorders" },
          { width: 20, text: "" },
          { width: "*", table: { widths: ["auto", "*"], body: [kv("Vypracoval", rep.name || "–"), kv("Telefón", rep.phone || "–"), kv("E-mail", rep.email || "–")] }, layout: "noBorders" },
        ],
        margin: [0, 0, 0, 16],
      },
      {
        table: {
          widths: ["*", "*", "*"],
          body: [[
            { stack: [{ text: "VÝCHODISKOVÝ DOM", fontSize: 8, color: grey, bold: true }, { text: fmtEur(result.basePriceInclVat), fontSize: 16, bold: true, margin: [0, 4, 0, 0] }, { text: `${house.name} · ${est.finish === "holodom" ? "holodom" : "štandard"} · s DPH`, fontSize: 8, color: grey }], margin: [10, 10, 10, 10] },
            { stack: [{ text: "ODBORNÝ ODHAD", fontSize: 8, color: "#ffffff", bold: true }, { text: fmtEur(result.estimateInclVat), fontSize: 18, bold: true, color: "#ffffff", margin: [0, 4, 0, 0] }, { text: `rozpätie ${fmtEur(result.range.lowInclVat)} – ${fmtEur(result.range.highInclVat)}`, fontSize: 8, color: "#d9e7f6" }], fillColor: green, margin: [10, 10, 10, 10] },
            { stack: [{ text: "ZMENA", fontSize: 8, color: grey, bold: true }, { text: `${fmtSigned(result.changeInclVat)}`, fontSize: 16, bold: true, color: pct > 0 ? "#b5481f" : "#1d7a48", margin: [0, 4, 0, 0] }, { text: `${fmtPct(pct)} oproti východiskovému domu`, fontSize: 8, color: grey }], margin: [10, 10, 10, 10] },
          ]],
        },
        layout: { hLineColor: () => line, vLineColor: () => line },
        margin: [0, 0, 0, 6],
      },
      { text: `Cena bez DPH: ${fmtEur(result.estimateExclVat)} · DPH 23 %`, fontSize: 8, color: grey, margin: [0, 0, 0, 16] },
      { text: "Porovnanie parametrov", fontSize: 12, bold: true, margin: [0, 0, 0, 6] },
      {
        table: {
          headerRows: 1, widths: ["*", "*", "*"],
          body: [[{ text: "", bold: true }, { text: `${house.name} – štandard ES`, bold: true, color: grey }, { text: "Štúdia klienta", bold: true, color: grey }], ...paramRows],
        },
        layout: { hLineColor: () => line, vLineWidth: () => 0, hLineWidth: (i) => (i === 0 ? 0 : 0.5), paddingTop: () => 4, paddingBottom: () => 4 },
        margin: [0, 0, 0, 16],
      },
      ...studyPdfBlocks(sumS, studyParams, grey, tblLayout),
      { text: "Položky, ktoré cenu ovplyvnili najviac", fontSize: 12, bold: true, margin: [0, 0, 0, 6] },
      {
        table: {
          headerRows: 1, widths: ["*", "*", 80],
          body: [
            [{ text: "Položka", bold: true, color: grey }, { text: "Čo sa zmenilo", bold: true, color: grey }, { text: "Vplyv s DPH", bold: true, color: grey, alignment: "right" }],
            ...result.topDrivers.map((d) => [{ text: d.label, bold: true }, { text: d.explanation, color: grey, fontSize: 8 }, { text: fmtSigned(d.deltaInclVat), alignment: "right", bold: true, color: d.deltaInclVat > 0 ? "#b5481f" : "#1d7a48" }]),
            ...(Math.abs(result.otherDeltaInclVat) >= 1 ? [[{ text: "Ostatné drobné zmeny", color: grey }, "", { text: fmtSigned(result.otherDeltaInclVat), alignment: "right" }]] : []),
          ],
        },
        layout: { hLineColor: () => line, vLineWidth: () => 0, hLineWidth: (i) => (i === 0 ? 0 : 0.5), paddingTop: () => 5, paddingBottom: () => 5 },
        margin: [0, 0, 0, 16],
      },
    ];
    if (est.aiSummary) content.splice(4, 0, { text: est.aiSummary, margin: [0, 0, 0, 14], lineHeight: 1.3 });
    if (result.optimizationNeeded && result.optimizations && result.optimizations.length) {
      content.push({ text: "Návrhy na optimalizáciu ceny", fontSize: 12, bold: true, margin: [0, 0, 0, 2] });
      content.push({ text: `Zmena ceny prekračuje ${fmtNum(result.thresholdPct ?? 10)} %. Tieto úpravy by cenu znížili (každá samostatne):`, color: grey, fontSize: 8, margin: [0, 0, 0, 6] });
      content.push({
        table: {
          widths: ["*", 80, 70],
          body: [
            [{ text: "Návrh", bold: true, color: grey }, { text: "Úspora s DPH", bold: true, color: grey, alignment: "right" }, { text: "Nová zmena", bold: true, color: grey, alignment: "right" }],
            ...result.optimizations.map((o) => [{ stack: [{ text: o.title, bold: true }, { text: o.detail, color: grey, fontSize: 8 }] }, { text: "−" + fmtEur(o.savingInclVat), alignment: "right", color: "#1d7a48", bold: true }, { text: fmtPct(o.newChangePct), alignment: "right" }]),
          ],
        },
        layout: { hLineColor: () => line, vLineWidth: () => 0, hLineWidth: (i) => (i === 0 ? 0 : 0.5), paddingTop: () => 5, paddingBottom: () => 5 },
        margin: [0, 0, 0, 16],
      });
    }
    if (variants && variants.length > 1) {
      content.push({ text: "Porovnanie variantov", fontSize: 12, bold: true, margin: [0, 0, 0, 6], pageBreak: undefined });
      content.push({
        table: {
          headerRows: 1, widths: ["*", 90, 70],
          body: [
            [{ text: "Variant", bold: true, color: grey }, { text: "Odhad s DPH", bold: true, color: grey, alignment: "right" }, { text: "Zmena", bold: true, color: grey, alignment: "right" }],
            ...variants.map((v) => [{ stack: [{ text: v.name, bold: true }, { text: v.note || "", color: grey, fontSize: 8 }] }, { text: fmtEur(v.estimate), alignment: "right", bold: true }, { text: fmtPct(v.changePct), alignment: "right" }]),
          ],
        },
        layout: tblLayout, margin: [0, 0, 0, 16],
      });
    }
    if (outdoor && (outdoor.lines.length || outdoor.missing.length)) {
      const OG = { pripojky: "Prípojky na pozemku", objekty: "Šachty, žumpa a meranie", plochy: "Spevnené plochy", ine: "Ďalšie položky na pozemku" };
      const e2 = (n) => fmtNum(n, 2) + " €";
      const body = [[{ text: "Položka", bold: true, color: grey }, { text: "Množstvo", bold: true, color: grey, alignment: "right" }, { text: "J. cena", bold: true, color: grey, alignment: "right" }, { text: "Spolu bez DPH", bold: true, color: grey, alignment: "right" }]];
      for (const g of Object.keys(OG)) {
        const ls = outdoor.lines.filter((l) => l.group === g);
        if (!ls.length) continue;
        body.push([{ text: OG[g], bold: true, colSpan: 4, fillColor: "#f3f6fa" }, "", "", ""]);
        for (const l of ls) body.push([
          { text: l.label + (l.warning ? ` (${l.warning})` : "") },
          { text: `${fmtNum(l.quantity, l.quantity % 1 ? 2 : 0)} ${l.unit}`, alignment: "right" },
          { text: l.inclVat != null ? "cenník firmy" : l.unitCost ? e2(l.unitCost) : "–", alignment: "right" },
          { text: l.inclVat != null ? fmtEur(l.inclVat) + " s DPH" : l.cost ? e2(l.cost) : "–", alignment: "right" },
        ]);
      }
      const sumRow = (k, v, b) => [{ text: k, colSpan: 3, bold: !!b, color: b ? undefined : grey }, "", "", { text: v, alignment: "right", bold: !!b }];
      body.push(sumRow("Presun hmôt 2 %, GZS 3,5 %, zisk a réžia 4 %", e2(outdoor.presunHmot + outdoor.gzs + outdoor.ziskRezia)));
      body.push(sumRow("Spolu bez DPH", e2(outdoor.exclVat), true));
      body.push(sumRow("Spolu s DPH 23 %", fmtEur(outdoor.inclVat), true));
      content.push({ text: "Vonkajšie zariadenie a prípojky – samostatný odhad", fontSize: 12, bold: true, margin: [0, 0, 0, 2], pageBreak: "before" });
      content.push({ text: "Nie je súčasťou ceny domu. Nezahŕňa napojenie (odbočenie) prípojok na verejné siete a zemné práce mimo pozemku stavby.", color: grey, fontSize: 8, margin: [0, 0, 0, 6] });
      if (outdoor.missing.length) content.push({ text: `Neúplné – chýba: ${outdoor.missing.join(", ")}.`, color: "#a66a00", fontSize: 9, margin: [0, 0, 0, 6] });
      content.push({ table: { headerRows: 1, widths: ["*", 70, 70, 85], body }, layout: tblLayout, margin: [0, 0, 0, 10] });
      content.push({
        table: { widths: ["*", "*"], body: [[
          { stack: [{ text: "DOM – ODBORNÝ ODHAD", fontSize: 8, color: grey, bold: true }, { text: fmtEur(result.estimateInclVat), fontSize: 14, bold: true }], margin: [8, 8, 8, 8] },
          { stack: [{ text: "DOM + VONKAJŠIE ZARIADENIE", fontSize: 8, color: "#ffffff", bold: true }, { text: fmtEur(result.estimateInclVat + outdoor.inclVat), fontSize: 14, bold: true, color: "#ffffff" }], fillColor: green, margin: [8, 8, 8, 8] },
        ]] },
        layout: { hLineColor: () => line, vLineColor: () => line }, margin: [0, 0, 0, 16],
      });
    }
    content.push({ text: company.disclaimer || "Odborný cenový odhad je orientačný a vychádza z predloženej štúdie, katalógového domu a cenníka platného ku dňu vyhotovenia. Nejde o záväznú cenovú ponuku.", fontSize: 8, color: grey, margin: [0, 6, 0, 0] });
    return {
      pageSize: "A4", pageMargins: [40, 40, 40, 50],
      defaultStyle: { font: "Roboto", fontSize: 9.5, color: "#151c18" },
      footer: (cur, total) => ({ columns: [{ text: `${company.name || "Ekonomické stavby s.r.o."} · ${[company.phone, company.email].filter(Boolean).join(" · ")}`, fontSize: 7, color: grey }, { text: `${cur} / ${total}`, alignment: "right", fontSize: 7, color: grey }], margin: [40, 16, 40, 0] }),
      content,
      info: { title: `Odborný cenový odhad – ${est.clientName || house.name}`, author: rep.name || company.name },
    };
  }
  function studyPdfBlocks(sum, p, grey, layout) {
    const out = [];
    const rows = [];
    if (p.floors && p.floors.length) rows.push(["Podlažia", p.floors.map((f) => `${f.name}${f.usableAreaM2 ? " " + fmtNum(f.usableAreaM2, 1) + " m²" : ""}`).join(" · ")]);
    if (sum.byType.length) rows.push(["Otvory", sum.byType.map((x) => `${x.label.toLowerCase()} ${x.count} ks`).join(" · ")]);
    if (sum.fromDetail) sum.baths.forEach((b) => rows.push([b.name + (b.areaM2 ? ` (${fmtNum(b.areaM2, 1)} m²)` : ""), b.text]));
    if (sum.foundation) rows.push(["Založenie", sum.foundation.label + (sum.dt ? ` · ${sum.dt.rows} ${sum.dt.rows === 1 ? "rad" : sum.dt.rows < 5 ? "rady" : "radov"} DT ${sum.dt.thicknessMm || ""} mm · cca ${fmtNum(sum.dt.pieces)} ks tvárnic` : "")]);
    if (sum.extras.length) rows.push(["Nadštandardy zo štúdie", sum.extras.map((x) => `${x.label}${x.qty > 1 || x.unit !== "ks" ? ` (${fmtNum(x.qty, 1)} ${x.unit})` : ""}`).join(" · ")]);
    if (!rows.length) return out;
    out.push({ text: "Čo obsahuje štúdia", fontSize: 12, bold: true, margin: [0, 0, 0, 6] });
    out.push({ table: { widths: [130, "*"], body: rows.map(([k, v]) => [{ text: k, color: grey }, { text: v }]) }, layout, margin: [0, 0, 0, 16] });
    return out;
  }
  /** Roboto in pdfmake has no arrow glyphs – replace them everywhere in the document. */
  function pdfSafe(v) {
    if (typeof v === "string") return v.replace(/→/g, "»").replace(/[−]/g, "−");
    if (Array.isArray(v)) return v.map(pdfSafe);
    if (v && typeof v === "object" && !(v instanceof Blob)) { const o = {}; for (const k of Object.keys(v)) o[k] = typeof v[k] === "function" ? v[k] : k === "image" ? v[k] : pdfSafe(v[k]); return o; }
    return v;
  }
  function pdfBlob(docDef) {
    return new Promise((res, rej) => {
      try { window.pdfMake.createPdf(pdfSafe(docDef)).getBlob((b) => res(b)); } catch (e) { rej(e); }
    });
  }

  window.ESL = {
    fmtNum, fmtEur, fmtSigned, fmtPct, fmtDate, parseNum, norm, uid, clone, clean,
    KIND, ROOF, FLOORS_LABEL, ROOF_LABEL, HEAT_LABEL, DIST_LABEL, houseUrl, houseParams, effectiveBase, findClosestHouses,
    buildPrices, parsePriceListXlsx, diffPriceLists, mergeSettings, extrasFrom,
    ROLES, ROLE, roleItems, mapMaterial, processFile, readStudyWithAI, aiToStudy, mergePages, explainWithAI,
    layoutText, isTextPage, pagePrompt, textPrompt, OPENING_LABEL, OPENING_TYPES, FIXTURE_LABEL, FOUNDATION_LABEL, bathroomText, dtPieces, studySummary, groupNotes, initOutdoor, houseExtras,
    blobToDataUrl, buildPdfDoc, pdfBlob,
  };
})();
