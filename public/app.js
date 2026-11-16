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

(function () {
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
        <button class="brand" onClick=${() => go("new")} aria-label="ES Prepočet – nový prepočet">${logoUrl ? html`<img src=${logoUrl} alt="" />` : html`<svg viewBox="70 80 380 190" aria-hidden="true"><use href="#es-logo" /></svg>`}<span class="brand-name">Prepočet</span></button>
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


/* ES Prepočet – UI: obrazovky (pôvodné, postupne nahrádzané) */
  // ---------- Wizard ----------
  function Wizard({ ctx, draft, setDraft }) {
    const upd = (patch) => setDraft((d) => ({ ...(d || draft), ...patch }));
    const step = draft.step || 1;
    const house = draft.baseHouseId ? ctx.housesById[draft.baseHouseId] : null;
    const canResult = !!(house && draft.study && draft.study.usableAreaM2 && draft.baseConfirmed !== false);
    const steps = [[1, "Podklady"], [2, "Kontrola údajov"], [3, "Výsledok"]];
    return html`
      <div class="page-head">
        <div><h1>${draft.clientName ? draft.clientName : "Nový prepočet"}</h1><p>Nahrajte štúdiu klienta, skontrolujte rozpoznané údaje a získajte odborný cenový odhad z východiskového domu.</p></div>
        <div class="steps">${steps.map(([n, l]) => html`<button class=${"step" + (step === n ? " on" : step > n ? " done" : "")} disabled=${(n === 2 && !draft.study) || (n === 3 && !canResult)} onClick=${() => upd({ step: n })}><i>${step > n ? "✓" : n}</i>${l}</button>`)}</div>
      </div>
      ${step === 1 ? html`<${StepFiles} ctx=${ctx} draft=${draft} upd=${upd} />` : null}
      ${step === 2 ? html`<${StepReview} ctx=${ctx} draft=${draft} upd=${upd} />` : null}
      ${step === 3 && canResult ? html`<${StepResult} ctx=${ctx} draft=${draft} upd=${upd} />` : null}`;
  }

  function StepFiles({ ctx, draft, upd }) {
    const [over, setOver] = useState(false);
    const [busy, setBusy] = useState(null);
    const [err, setErr] = useState(null);
    const [aiText, setAiText] = useState("");
    const inp = useRef();
    const sample = ctx.caps.sample;
    const pages = draft.pages || [];

    async function addFiles(list) {
      setErr(null);
      const files = [...list];
      const all = [...pages];
      for (const f of files) {
        try {
          setBusy(`Spracúvam ${f.name}…`);
          const ps = await L.processFile(f, 4200, (i, n) => setBusy(`Spracúvam ${f.name} – strana ${i} z ${n}`));
          all.push(...ps);
        } catch (e) { setErr(e.message || String(e)); }
      }
      setBusy(null);
      upd({ pages: all, localFiles: [...(draft.localFiles || []), ...files] });
    }
    async function recognize() {
      setErr(null); setAiText("");
      setBusy(`Claude číta podklady strana po strane… 0 z ${pages.length}`);
      try {
        const names = [...new Set(pages.map((p) => p.file))];
        const r = await L.readStudyWithAI(sample, pages, ctx.prices, ctx.settings.extrasCatalog, (done, total, p) => {
          setBusy(`Claude číta podklady strana po strane… ${done} z ${total}`);
          setAiText(`Hotové: ${p.file}, strana ${p.page}`);
        });
        const study = r.study;
        const text = [r.merged.houseName || "", ...names].join(" ");
        const matches = L.findClosestHouses(study, ctx.houses, text, 5);
        const base = draft.baseHouseId || (matches[0] && matches[0].house.id) || null;
        const filled = fillDefaults(study, base ? ctx.housesById[base] : null);
        filled.outdoor = L.initOutdoor(filled, ctx.settings, r.merged.pripojky, r.merged.pripojkySrc);
        filled.extras = L.houseExtras(filled, ctx.settings);
        upd({ ai: { pages: r.merged.pages, notes: r.merged.notes, notesList: r.merged.notesList, houseName: r.merged.houseName, raw: r.raw }, study: filled, matches: matches.map((m) => ({ id: m.house.id, score: m.score, reasons: m.reasons })), baseHouseId: base, baseConfirmed: false, step: 2, aiMeta: { pagesRead: r.raw.length, pagesTotal: pages.length, errors: r.errors } });
        ctx.say(r.errors.length ? `Rozpoznané, ${r.errors.length} strán sa nepodarilo prečítať` : "Podklady sú rozpoznané – skontrolujte údaje");
      } catch (e) {
        const code = e && e.code;
        setErr(code === "not_granted" ? "Rozpoznávanie nie je povolené. Povoľte aplikácii prístup ku Claude a skúste znova."
          : code === "rate_limited" ? "Dosiahli ste limit používania Claude. Skúste to o chvíľu znova."
          : code === "invalid_json" ? "Claude nevrátil čitateľný výsledok. Skúste rozpoznanie spustiť znova."
          : `Rozpoznanie zlyhalo: ${e.message || code || e}`);
      }
      setBusy(null);
    }
    function manual() {
      const h = draft.baseHouseId ? ctx.housesById[draft.baseHouseId] : null;
      upd({ study: fillDefaults(h ? { ...L.houseParams(h) } : { floorsType: "bungalov", roofType: "sedlova", bathrooms: 1, wcs: 1, garages: 0, heatingSource: "plyn", heatingDistribution: "podlahove" }, h), step: 2 });
    }

    return html`
      <div class="grid-2">
        <div class="card card-pad" style="display:flex;flex-direction:column;gap:14px">
          <h2 style="font-size:16px">Klient</h2>
          <div class="field"><label for="cn">Meno klienta alebo názov projektu</label><input id="cn" class="input" value=${draft.clientName} placeholder="napr. Novák – Žilina" onInput=${(e) => upd({ clientName: e.target.value })} /></div>
          <div class="field"><label for="cnote">Poznámka</label><textarea id="cnote" class="input" placeholder="Lokalita, požiadavky klienta…" onInput=${(e) => upd({ clientNote: e.target.value })}>${draft.clientNote}</textarea></div>
          <div class="field"><label>Cenová úroveň východiskového domu</label><${Seg} value=${draft.finish} options=${[["standard", "Štandard (na kľúč)"], ["holodom", "Holodom"]]} onChange=${(v) => upd({ finish: v })} /></div>
        </div>
        <div class=${"drop" + (over ? " over" : "")} onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)} onDrop=${(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}>
          <div style="display:flex;flex-direction:column;gap:10px;align-items:center">
            <div class="avatar" style="width:44px;height:44px"><${Icon} name="upload" /></div>
            <h3>Nahrajte štúdiu klienta</h3>
            <p class="muted" style="margin:0">Pôdorysy, rez, pohľady a technická správa. PDF z CAD programu, skenované PDF alebo obrázky JPG/PNG.</p>
            <input ref=${inp} type="file" multiple accept="application/pdf,image/*" hidden onChange=${(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <button class="btn tinted" onClick=${() => inp.current.click()}>Vybrať súbory</button>
          </div>
        </div>
      </div>
      ${busy ? html`<div class="card card-pad row"><div class="spinner"></div><div class="grow"><b>${busy}</b>${aiText ? html`<div class="faint small" style="margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${aiText}</div>` : null}</div></div>` : null}
      ${err ? html`<div class="notice bad">${err}</div>` : null}
      ${pages.length ? html`<div class="card">
        <div class="card-head"><div><h2>Nahraté strany</h2><div class="sub">${pages.length} strán z ${new Set(pages.map((p) => p.file)).size} súborov</div></div>
          <button class="btn plain sm" onClick=${() => upd({ pages: [], localFiles: [] })}><${Icon} name="trash" />Odstrániť všetko</button></div>
        <div class="card-pad"><div class="thumbs">${pages.map((p) => html`<div class="thumb"><img src=${p.url} alt=${`${p.file}, strana ${p.page}`} /><div class="cap">${p.file} · ${p.page}</div></div>`)}</div></div>
      </div>` : (draft.files && draft.files.length ? html`<div class="card card-pad"><b>Uložené podklady</b><ul>${draft.files.map((f) => html`<li><a href=${"/_blob/" + f.assetId} target="_blank" rel="noopener">${f.name}</a></li>`)}</ul></div>` : null)}
      <div class="row" style="justify-content:flex-end">
        <button class="btn" onClick=${manual}>Zadať údaje ručne</button>
        <button class="btn primary lg" disabled=${!pages.length || !!busy || !sample} onClick=${recognize}><${Icon} name="spark" />Rozpoznať podklady</button>
      </div>
      ${!sample ? html`<p class="faint small" style="text-align:right">Rozpoznávanie cez Claude je dostupné po otvorení aplikácie v Claude s povoleným prístupom.</p>` : null}`;
  }

  /** Fills reasonable defaults where the study is silent (so both sides use the same assumptions). */
  function fillDefaults(study, house) {
    const s = { materials: {}, materialTexts: {}, confidence: {}, evidence: {}, ...study };
    const hp = house ? L.houseParams(house) : {};
    for (const k of ["floorsType", "roofType", "heatingSource", "heatingDistribution"]) if (!s[k]) { s[k] = hp[k] || { floorsType: "bungalov", roofType: "sedlova", heatingSource: "plyn", heatingDistribution: "podlahove" }[k]; s.confidence[k] = s.confidence[k] || "low"; }
    if (s.bathrooms == null) { s.bathrooms = hp.bathrooms || 1; s.confidence.bathrooms = "low"; }
    if (s.garages == null) s.garages = hp.garages || 0;
    if (s.wcs == null) s.wcs = 1;
    if (!s.usableAreaM2 && hp.usableAreaM2) { s.usableAreaM2 = hp.usableAreaM2; s.confidence.usableAreaM2 = "low"; }
    if (!s.builtAreaM2 && s.usableAreaM2) { s.builtAreaM2 = Math.round(s.usableAreaM2 * (s.floorsType === "bungalov" ? 1.22 : 0.72) * 10) / 10; s.confidence.builtAreaM2 = "low"; }
    return s;
  }

  // ---------- Step 2: review ----------
  const FIELDS = [
    ["Geometria", [
      ["usableAreaM2", "Úžitková plocha", "m²", "num"], ["builtAreaM2", "Zastavaná plocha", "m²", "num"],
      ["widthM", "Šírka (vonkajší rozmer)", "m", "num"], ["lengthM", "Dĺžka (vonkajší rozmer)", "m", "num"],
      ["floorsType", "Typ domu", "", "floors"], ["storeyHeightM", "Konštrukčná výška podlažia", "m", "num"], ["kneeWallM", "Nadmurovka", "m", "num"],
    ]],
    ["Strecha a otvory", [
      ["roofType", "Typ strechy", "", "roof"], ["roofPitchDeg", "Sklon strechy", "°", "num"],
      ["windowsCount", "Počet okien a dverí", "ks", "num", "noOpenings"], ["windowsAreaM2", "Plocha okien", "m²", "num", "noOpenings"],
    ]],
    ["Dispozícia a technika", [
      ["rooms", "Počet izieb", "ks", "num"], ["bathrooms", "Kúpeľne", "ks", "num", "noBathDetail"], ["wcs", "Samostatné WC", "ks", "num", "noBathDetail"], ["garages", "Garážové státia", "ks", "num"],
      ["heatingSource", "Zdroj tepla", "", "heat"], ["heatingDistribution", "Rozvod tepla", "", "dist"],
      ["centralRecuperation", "Centrálna rekuperácia", "", "bool"], ["chimney", "Komín", "", "bool"], ["fireplace", "Krb", "", "bool"],
    ]],
  ];

  function FieldInput({ type, value, onChange, inherited, id }) {
    if (type === "num") return html`<${NumInput} id=${id} value=${value} onChange=${onChange} inherited=${inherited} />`;
    if (type === "bool") return html`<label class="check"><input id=${id} type="checkbox" checked=${!!value} onChange=${(e) => onChange(e.target.checked)} />${value ? "áno" : "nie"}</label>`;
    const opts = { floors: L.FLOORS_LABEL, roof: L.ROOF_LABEL, heat: L.HEAT_LABEL, dist: L.DIST_LABEL }[type];
    return html`<select id=${id} class=${"input" + (inherited ? " inherited" : "")} value=${value || ""} onChange=${(e) => onChange(e.target.value)}>${Object.entries(opts).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>`;
  }

  function MaterialSelect({ ctx, role, value, onChange, id }) {
    const items = useMemo(() => L.roleItems(ctx.prices, role).sort((a, b) => a.path_code.localeCompare(b.path_code)), [ctx.prices, role]);
    const std = ctx.prices[ctx.settings.standardSpec[role]];
    return html`<select id=${id} class="input" value=${value || ""} onChange=${(e) => onChange(e.target.value || undefined)}>
      <option value="">${std ? `Štandard ES: ${E.itemLabel(std)}` : "— štandard ES —"}</option>
      ${items.map((it) => html`<option value=${it.path_code}>${E.itemLabel(it)}${it.check_level === "CHYBA" ? " ⚠" : ""} · ${fmtNum((it.price_material || 0) + (it.price_labor || 0) + (it.price_machinery || 0), 2)} €/${it.unit}</option>`)}
    </select>`;
  }

  function Layer2Select({ ctx, materials, onChange, id }) {
    const items = useMemo(() => L.roleItems(ctx.prices, "roofInsulation").sort((a, b) => a.path_code.localeCompare(b.path_code)), [ctx.prices]);
    const stdPath = ctx.settings.standardSpec.roofInsulation2;
    const std = stdPath ? ctx.prices[stdPath] : null;
    const m = materials || {};
    const val = m.roofInsulation2 !== undefined ? m.roofInsulation2 : m.roofInsulation ? "" : "__std";
    return html`<select id=${id} class="input" value=${val} onChange=${(e) => onChange(e.target.value === "__std" ? undefined : e.target.value)}>
      ${!m.roofInsulation ? html`<option value="__std">${std ? `Štandard ES: ${E.itemLabel(std)}` : "— štandard ES —"}</option>` : null}
      <option value="">bez 2. vrstvy</option>
      ${items.map((it) => html`<option value=${it.path_code}>${E.itemLabel(it)} · ${fmtNum((it.price_material || 0) + (it.price_labor || 0), 2)} €/${it.unit}</option>`)}
    </select>`;
  }

  /** One comparison row: label | fixed ES standard | client study (editable) | change + confidence. */
  function CRow({ label, unit, std, changed, c, ev, note, children }) {
    return html`
      <div class=${"lbl" + (changed ? " chg" : "")} style="flex-direction:column;align-items:flex-start;gap:2px"><span>${label}${unit ? html` <span class="faint">(${unit})</span>` : null}</span>${note ? html`<span class="evidence">${note}</span>` : null}</div>
      <div class="std">${std}</div>
      <div class=${changed ? "chg" : ""}>${children}</div>
      <div class="conf">${changed ? html`<span class="badge warn">zmena</span>` : null}${c ? html`<${Conf} c=${c} ev=${ev} />` : null}</div>`;
  }

  function StepReview({ ctx, draft, upd }) {
    const [pick, setPick] = useState(false);
    const house = draft.baseHouseId ? ctx.housesById[draft.baseHouseId] : null;
    const study = draft.study || {};
    const conf = study.confidence || {};
    const ev = study.evidence || {};
    const eb = house ? L.effectiveBase(house, ctx.settings) : null;
    const setS = (k, v) => upd({ study: { ...study, [k]: v, confidence: { ...conf, [k]: undefined } } });
    const setSM = (k, v) => upd({ study: { ...study, materials: L.clean({ ...(study.materials || {}), [k]: v }), confidence: { ...conf, ["mat_" + k]: undefined } } });
    const setSM2 = (v) => { const m = { ...(study.materials || {}) }; if (v === undefined) delete m.roofInsulation2; else m.roofInsulation2 = v; upd({ study: { ...study, materials: m } }); };
    const lowCount = Object.values(conf).filter((c) => c === "low").length;
    const matches = draft.matches || [];
    const T = ctx.settings.standardText || {};
    const spec = ctx.settings.standardSpec;
    const itemL = (path) => (path && ctx.prices[path] ? E.itemLabel(ctx.prices[path]) : "–");

    // Differences against the ES standard, collected while the comparison table renders (same rules as the "zmena" badges).
    let D = [], curSec = "";
    const plain = (x) => (x == null ? "" : typeof x === "string" || typeof x === "number" ? String(x) : "");
    const S = (name) => { curSec = name; return html`<div class="sect">${name}</div>`; };
    const note = (changed, label, std, val) => { if (changed) D.push({ part: curSec, label, std: plain(std), val: plain(val) }); return null; };
    const cmp = () => {
      D = [];
      const b = eb.params;
      const sumB = L.studySummary(b, ctx.settings), sumS = L.studySummary(study, ctx.settings);
      const diffNum = (x, y) => x != null && y != null && Math.abs(x - y) > Math.max(0.01, Math.abs(y) * 0.005);
      const fv = (v, unit, d = 1) => (v == null ? "–" : `${fmtNum(v, d)}${unit ? " " + unit : ""}`);
      const geo = (k, label, unit, type, stdVal, d = 1) => {
        const sv = study[k];
        const bv = stdVal !== undefined ? stdVal : b[k];
        const changed = type === "num" ? diffNum(sv, bv) : sv != null && sv !== "" && sv !== bv;
        const stdText = type === "num" ? fv(bv, unit, d) : type === "floors" ? L.FLOORS_LABEL[bv] : type === "roof" ? L.ROOF_LABEL[bv] : String(bv ?? "–");
        note(changed, label, stdText, type === "num" ? fv(sv, unit, d) : type === "floors" ? L.FLOORS_LABEL[sv] : type === "roof" ? L.ROOF_LABEL[sv] : String(sv));
        return html`<${CRow} label=${label} unit=${type === "num" ? unit : ""} std=${stdText} changed=${changed} c=${conf[k]} ev=${ev[k]}>
          <${FieldInput} id=${"s-" + k} type=${type} value=${sv} onChange=${(v) => setS(k, v)} /><//>`;
      };
      const mat = (role, label, extra) => {
        const r = role === "roofing" && study.roofType === "plocha" ? "flatRoofing" : role;
        const sv = (study.materials || {})[r];
        const txt = study.materialTexts && study.materialTexts[role === "flatRoofing" ? "roofing" : role];
        note(!!sv && sv !== spec[r], label || L.ROLE[r].label, itemL(spec[r]), itemL(sv));
        return html`<${CRow} label=${label || L.ROLE[r].label} std=${html`${itemL(spec[r])}${extra ? html`<div class="faint small">${extra}</div>` : null}`} changed=${!!sv && sv !== spec[r]} c=${conf["mat_" + r]} note=${txt ? `štúdia: „${txt}“` : ""}>
          <${MaterialSelect} id=${"sm-" + r} ctx=${ctx} role=${r} value=${sv} onChange=${(v) => setSM(r, v)} /><//>`;
      };
      const txt = (label, std, right, changed, stdShort) => (note(changed && !["Nadštandardy", "Podlahy", "Schodisko"].includes(label), label, stdShort ?? std, right), html`<${CRow} label=${label} std=${std} changed=${changed}><span class=${changed ? "" : "muted"}>${right}</span><//>`);
      const stropT = (ft) => (ft === "poschodovy" ? T.strop_poschodovy : ft === "podkrovie" ? T.strop_podkrovie : T.strop_bungalov);
      const krovT = (ft) => (ft === "bungalov" ? T.krov_bungalov : T.krov);
      const f = study.foundation, sf = ctx.settings.standardFoundation;
      const fDiff = !!(f && f.type && (f.type !== sf.type || (f.type === "pasy_dt" && ((f.dtRows && f.dtRows !== sf.dtRows) || (f.dtThicknessMm && f.dtThicknessMm !== sf.dtThicknessMm)))));
      const fTxt = f && f.type ? `${L.FOUNDATION_LABEL[f.type]}${f.type === "pasy_dt" && f.dtRows ? ` · ${rowsTxt(f.dtRows)} DT ${f.dtThicknessMm || ""} mm` : ""}` : "ako štandard";
      const cnt = (sum, types) => sum.byType.filter((x) => types.includes(x.type)).reduce((a, x) => ({ n: a.n + x.count, a: a.a + x.area }), { n: 0, a: 0 });
      const wB = cnt(sumB, ["okno", "balkonove", "hs"]), wS = study.openings && study.openings.length ? cnt(sumS, ["okno", "balkonove", "hs"]) : null;
      const opTxt = (o) => `${o.n} ks · ${fmtNum(o.a, 1)} m²`;
      const nB = (t) => cnt(sumB, [t]).n, nS = (t) => (study.openings && study.openings.length ? cnt(sumS, [t]).n : null);
      const bathB = sumB.baths.map((x) => x.text).join(" | "), bathS = study.bathroomsDetail && study.bathroomsDetail.length ? sumS.baths.map((x) => x.text).join(" | ") : null;
      const hsS = nS("hs");
      const extrasN = (study.extras || []).length;
      const sm = study.materials || {};
      const l2 = sm.roofInsulation2 !== undefined ? sm.roofInsulation2 : sm.roofInsulation ? "" : spec.roofInsulation2;
      const l2ch = (l2 || "") !== (spec.roofInsulation2 || "");
      return html`
        <div class="h"></div><div class="h">${house.name} – štandard ES</div><div class="h">Štúdia klienta</div><div class="h conf">Stav</div>
        ${S("Geometria a dispozícia")}
        ${geo("usableAreaM2", "Úžitková plocha", "m²", "num")}
        ${geo("builtAreaM2", "Zastavaná plocha", "m²", "num")}
        ${geo("widthM", "Šírka (vonkajší rozmer)", "m", "num", b.widthM && b.lengthM ? Math.min(b.widthM, b.lengthM) : b.widthM, 2)}
        ${geo("lengthM", "Dĺžka (vonkajší rozmer)", "m", "num", b.widthM && b.lengthM ? Math.max(b.widthM, b.lengthM) : b.lengthM, 2)}
        ${geo("floorsType", "Typ domu", "", "floors")}
        ${geo("storeyHeightM", "Konštrukčná výška podlažia", "m", "num", b.storeyHeightM, 2)}
        ${study.floorsType === "podkrovie" || b.floorsType === "podkrovie" ? geo("kneeWallM", "Nadmurovka", "m", "num", b.kneeWallM, 2) : null}
        ${geo("roofType", "Typ strechy", "", "roof")}
        ${study.roofType !== "plocha" ? geo("roofPitchDeg", "Sklon strechy", "°", "num", b.roofPitchDeg ?? (E.defaultRoofPitch ? E.defaultRoofPitch(study.floorsType, ctx.settings.defaults) : study.floorsType === "podkrovie" ? ctx.settings.defaults.roofPitchAtticDeg : ctx.settings.defaults.roofPitchDeg), 0) : null}
        ${note(!!(study.rooms && house.rooms && study.rooms !== house.rooms), "Počet izieb", house.rooms, study.rooms)}
        ${html`<${CRow} label="Počet izieb" std=${house.rooms || "–"} changed=${!!(study.rooms && house.rooms && study.rooms !== house.rooms)} c=${conf.rooms}><${NumInput} value=${study.rooms} onChange=${(v) => setS("rooms", v)} /><//>`}
        ${geo("garages", "Garážové státia", "ks", "num", b.garages || 0, 0)}
        ${!(study.bathroomsDetail && study.bathroomsDetail.length) ? html`${geo("bathrooms", "Kúpeľne", "ks", "num", b.bathrooms, 0)}${geo("wcs", "Samostatné WC", "ks", "num", b.wcs, 0)}` : null}

        ${S("Hrubá stavba")}
        ${txt("Založenie", T.zalozenie, fTxt, fDiff, `${L.FOUNDATION_LABEL[sf.type]}${sf.type === "pasy_dt" ? ` · ${rowsTxt(sf.dtRows)} DT ${sf.dtThicknessMm} mm` : ""}`)}
        ${mat("wall", "Obvodové murivo", T.murivo)}
        ${mat("interiorWall")}
        ${mat("partition", "Priečky", T.priecky)}
        ${txt("Strop", stropT(b.floorsType), stropT(study.floorsType || b.floorsType), (study.floorsType || b.floorsType) !== b.floorsType)}
        ${txt("Krov", krovT(b.floorsType), study.roofType === "plocha" ? "plochá strecha – bez krovu" : krovT(study.floorsType || b.floorsType), study.roofType === "plocha" || (study.floorsType || b.floorsType) !== b.floorsType)}
        ${mat("roofing", "Strešná krytina", T.krytina)}

        ${S("Zateplenie")}
        ${mat("facade", "Zateplenie fasády")}
        ${mat("roofInsulation", "Zateplenie strechy / stropu – 1. vrstva", T.zateplenie)}
        ${note(l2ch, "Zateplenie strechy / stropu – 2. vrstva", itemL(spec.roofInsulation2), l2 ? itemL(l2) : "bez 2. vrstvy")}
        <${CRow} label="Zateplenie strechy / stropu – 2. vrstva" std=${itemL(spec.roofInsulation2)} changed=${l2ch}>
          <${Layer2Select} id="sm-ri2" ctx=${ctx} materials=${study.materials} onChange=${setSM2} /><//>
        ${mat("floorInsulation", "Izolácia podlahy")}
        ${note(diffNum(sm.floorInsulationThicknessM, spec.floorInsulationThicknessM), "Hrúbka izolácie podlahy", fmtNum(spec.floorInsulationThicknessM, 2) + " m", fmtNum(sm.floorInsulationThicknessM, 2) + " m")}
        <${CRow} label="Hrúbka izolácie podlahy" unit="m" std=${fmtNum(spec.floorInsulationThicknessM, 2) + " m"} changed=${diffNum((study.materials || {}).floorInsulationThicknessM, spec.floorInsulationThicknessM)}>
          <${NumInput} id="s-fit" value=${(study.materials || {}).floorInsulationThicknessM} placeholder=${String(spec.floorInsulationThicknessM).replace(".", ",")} onChange=${(v) => setSM("floorInsulationThicknessM", v)} /><//>

        ${S("Okná a dvere")}
        ${mat("window", "Okná – typ", T.okna)}
        ${txt("Okná a balkónové dvere – rozsah", `${opTxt(wB)} (16 % úžitkovej plochy)`, wS ? opTxt(wS) + (hsS ? ` · z toho ${hsS}× HS portál` : "") : "ako štandard", !!(wS && (Math.abs(wS.a - wB.a) > 0.5 || hsS)))}
        ${txt("Vchodové a vedľajšie dvere", `${nB("vchodove")} ks · ${T.dvere_vchodove}`, nS("vchodove") == null ? "ako štandard" : `${nS("vchodove")} vchodové${nS("vedlajsie") ? ` + ${nS("vedlajsie")} vedľajšie` : ""}`, nS("vchodove") != null && (nS("vchodove") !== nB("vchodove") || nS("vedlajsie") > 0))}
        ${txt("Vnútorné dvere", `${nB("vnutorne")} ks · ${T.dvere_vnutorne}`, nS("vnutorne") ? `${nS("vnutorne")} ks` : "ako štandard", !!(nS("vnutorne") && nS("vnutorne") !== nB("vnutorne")))}
        ${b.garages || nS("garazova") ? txt("Garážová brána", b.garages ? T.garaz : "bez garáže", nS("garazova") ? `${nS("garazova")} ks` : "ako štandard", !!nS("garazova") !== !!b.garages) : null}

        ${S("Technika")}
        ${note(!!(study.heatingSource && study.heatingSource !== "plyn"), "Zdroj tepla", L.HEAT_LABEL.plyn, L.HEAT_LABEL[study.heatingSource])}
        ${note(!!(study.heatingDistribution && study.heatingDistribution !== "podlahove"), "Rozvod tepla", L.DIST_LABEL.podlahove, L.DIST_LABEL[study.heatingDistribution])}
        ${note(!!study.centralRecuperation, "Centrálna rekuperácia", "decentrálna rekuperácia", "centrálna rekuperácia")}
        ${note(!!study.chimney, "Komín", "nie je v štandarde", "áno")}
        ${note(!!study.fireplace, "Krb", "nie je v štandarde", "áno")}
        <${CRow} label="Zdroj tepla" std=${T.kurenie} changed=${study.heatingSource && study.heatingSource !== "plyn"} c=${conf.heatingSource}><${FieldInput} id="s-heat" type="heat" value=${study.heatingSource} onChange=${(v) => setS("heatingSource", v)} /><//>
        <${CRow} label="Rozvod tepla" std="Podlahové kúrenie v celom dome" changed=${study.heatingDistribution && study.heatingDistribution !== "podlahove"} c=${conf.heatingDistribution}><${FieldInput} id="s-dist" type="dist" value=${study.heatingDistribution} onChange=${(v) => setS("heatingDistribution", v)} /><//>
        <${CRow} label="Centrálna rekuperácia" std=${T.rekuperacia} changed=${!!study.centralRecuperation} c=${conf.centralRecuperation}><${FieldInput} id="s-reku" type="bool" value=${study.centralRecuperation} onChange=${(v) => setS("centralRecuperation", v)} /><//>
        <${CRow} label="Komín" std="Nie je v štandarde" changed=${!!study.chimney} c=${conf.chimney}><${FieldInput} id="s-kom" type="bool" value=${study.chimney} onChange=${(v) => setS("chimney", v)} /><//>
        <${CRow} label="Krb" std="Nie je v štandarde" changed=${!!study.fireplace} c=${conf.fireplace}><${FieldInput} id="s-krb" type="bool" value=${study.fireplace} onChange=${(v) => setS("fireplace", v)} /><//>
        ${txt("Elektroinštalácia", T.elektro, "ako štandard", false)}
        ${txt("Voda a kanalizácia", T.zti, "ako štandard", false)}
        ${txt("Hromozvod", T.hromozvod, "ako štandard", false)}

        ${S("Vybavenie")}
        ${txt("Kúpeľne a WC", html`${T.kupelne}<div class="faint small">${bathB}</div>`, bathS || "ako štandard", !!(bathS && bathS !== bathB), bathB)}
        ${txt("Podlahy", T.podlahy, (study.extras || []).some((x) => /^podlaha/.test(x.key)) ? "zmena – pozri nadštandardy" : "ako štandard", (study.extras || []).some((x) => /^podlaha/.test(x.key)))}
        ${(study.floorsType || b.floorsType) !== "bungalov" ? txt("Schodisko", T.schodisko, (study.extras || []).some((x) => x.key === "schodiskoDrevo") ? "celodrevené – nadštandard" : "ako štandard", (study.extras || []).some((x) => x.key === "schodiskoDrevo")) : null}
        ${txt("Nadštandardy", T.mimo, extrasN ? `${extrasN} ${extrasN === 1 ? "položka" : extrasN < 5 ? "položky" : "položiek"} zo štúdie – pozri nižšie` : "žiadne", extrasN > 0)}`;
    };

    const cmpHtml = house ? cmp() : null;
    const extraDiffs = L.houseExtras(study, ctx.settings).map((x) => {
      const d = ctx.settings.extrasCatalog.find((c) => c.key === x.key);
      const q = x.qty ? `${fmtNum(x.qty, x.qty % 1 ? 2 : 0)} ${d ? d.unit : "ks"}` : "množstvo doplniť";
      return { part: "Nadštandardy", label: d ? d.label : x.key, std: "nie je v štandarde", val: q + (x.note ? ` – ${x.note}` : "") };
    });
    const diffs = house ? [...D, ...extraDiffs] : [];
    return html`
      ${draft.ai || house ? html`<${SourceNote} draft=${draft} conf=${conf} diffs=${diffs} hasHouse=${!!house} />` : null}
      <div class="card">
        <div class="card-head"><div><h2>Východiskový dom</h2><div class="sub">${draft.ai && draft.ai.houseName ? `V podkladoch: „${draft.ai.houseName}“` : "Vyberte katalógový dom, z ktorého sa robí prepočet"}</div></div>
          <button class="btn tinted sm" onClick=${() => setPick(true)}>Zmeniť dom</button></div>
        ${house ? html`<div class="card-pad row" style="gap:20px">
          <div class="plan house-thumb" style="width:200px;height:134px"><${HouseImg} h=${house} /></div>
          <div class="grow"><h3 style="font-size:20px">${house.name}</h3>
            <div class="muted">${house.disp} · ${fmtNum(house.pu, 1)} m² úžitková · ${fmtNum(house.pz, 1)} m² zastavaná · ${L.FLOORS_LABEL[L.KIND[house.kind]]} · ${L.ROOF_LABEL[L.ROOF[house.roof]].toLowerCase()} strecha</div>
            <div class="row" style="margin-top:8px"><span class="badge accent">${fmtEur(draft.finish === "holodom" ? house.hol : house.price)} ${draft.finish === "holodom" ? "holodom" : "štandard"} s DPH</span><a href=${L.houseUrl(house)} target="_blank" rel="noopener" class="small">Otvoriť na webe ↗</a></div>
            ${draft.baseConfirmed === false ? html`<div class="notice" style="margin-top:12px"><div><b>Potvrďte východiskový dom.</b> Aplikácia ho navrhla podľa rozmerov a plôch zo štúdie. Presnosť odhadu závisí najmä od správneho domu – ak klient vychádza z iného katalógového domu, vyberte ho vpravo alebo cez „Zmeniť dom“.<div style="margin-top:8px"><button class="btn primary sm" onClick=${() => upd({ baseConfirmed: true })}>Potvrdiť dom</button></div></div></div>` : null}
          </div>
          ${matches.length ? html`<div style="min-width:220px"><div class="small muted" style="margin-bottom:6px">Najbližšie katalógové domy</div>${matches.slice(0, 4).map((m) => { const h = ctx.housesById[m.id]; return html`<button class="btn sm" style="width:100%;justify-content:space-between;margin-bottom:4px;background:${m.id === house.id ? "var(--accent-soft)" : ""}" onClick=${() => upd({ baseHouseId: m.id, baseConfirmed: true })} title=${(m.reasons || []).join(", ")}><span>${h.name}</span><span class="faint">${m.score} %</span></button>`; })}</div>` : null}
        </div>` : html`<div class="card-pad"><button class="btn primary" onClick=${() => setPick(true)}>Vybrať východiskový dom</button></div>`}
      </div>

      ${house ? html`<div class="card">
        <div class="card-head"><div><h2>Štandard ES a štúdia klienta</h2><div class="sub">Vľavo je pevný štandard ES (sprievodca VOTP 03/26), ten sa nemení. Vpravo je štúdia klienta – cenu menia len zvýraznené riadky.</div></div></div>
        <div class="cmp">${cmpHtml}</div>
      </div>` : null}
      ${house ? html`<${StudyDetails} ctx=${ctx} study=${study} base=${eb.params} upd=${upd} />` : null}
      ${house ? html`<${OutdoorEditor} ctx=${ctx} study=${study} upd=${upd} />` : null}
      <div class="row" style="justify-content:space-between">
        <button class="btn" onClick=${() => upd({ step: 1 })}><${Icon} name="back" />Podklady</button>
        <button class="btn primary lg" disabled=${!house || !study.usableAreaM2 || draft.baseConfirmed === false} title=${draft.baseConfirmed === false ? "Najprv potvrďte východiskový dom" : ""} onClick=${() => upd({ step: 3 })}>Vypočítať odhad</button>
      </div>
      ${pick ? html`<${Sheet} wide onClose=${() => setPick(false)}><${HousePicker} ctx=${ctx} study=${study} onPick=${(h) => { upd({ baseHouseId: h.id, baseOverrides: {}, baseConfirmed: true }); setPick(false); }} /><//>` : null}`;
  }

  const OUT_GROUPS = { pripojky: "Prípojky na pozemku", objekty: "Šachty, žumpa a meranie", plochy: "Spevnené plochy", ine: "Ďalšie položky na pozemku" };

  /** Krok 2: vonkajšie zariadenie a prípojky – samostatný súpis mimo ceny domu. */
  function OutdoorEditor({ ctx, study, upd }) {
    const s = ctx.settings, it = s.outdoorItems;
    const o = study.outdoor || L.initOutdoor(study, s);
    const conf = o.confidence || {}, ev = o.evidence || {};
    const set = (patch) => {
      const c = { ...conf };
      for (const k of Object.keys(patch)) delete c[k];
      const next = L.clean({ ...o, ...patch, confidence: c });
      if (patch.gas === false) { delete next.gasM; }
      upd({ study: { ...study, outdoor: next, extras: L.houseExtras(study, s) } });
    };
    const r = useMemo(() => E.computeOutdoor(o, ctx.prices, s, ctx.extras.accessories || {}), [o, ctx.prices, s]);
    const pick = (prefix) => Object.values(ctx.prices).filter((x) => x.path_code.startsWith(prefix) && !x.is_hidden && E.unitCost(x) > 0).sort((a, b) => E.unitCost(a) - E.unitCost(b));
    const pits = useMemo(() => pick("A3/007/"), [ctx.prices]);
    const tanks = useMemo(() => pick("A3/008/"), [ctx.prices]);
    const plants = useMemo(() => pick("A3/010/"), [ctx.prices]);
    const pumps = useMemo(() => pick("A3/009/XXX/CS/"), [ctx.prices]);
    const opt = (x) => html`<option value=${x.path_code}>${E.itemLabel(x)}${ctx.caps.admin ? " · " + fmtEur(E.unitCost(x)) + " bez DPH" : ""}</option>`; // výrobná cena len pre administrátora
    const yardDefs = s.extrasCatalog.filter((d) => d.group === s.outdoorRules.extrasGroup && !["pripojkaVoda", "pripojkaKanal", "pripojkaPlyn", "pripojkaElektro", "zumpa", "cov", "zamkovaDlazba"].includes(d.key));
    const ex = o.extras || [];
    const len = (k, label, hint) => html`<div class="field"><label for=${"o-" + k}>${label}${conf[k] ? html` <${Conf} c=${conf[k]} ev=${ev[k]} />` : null}</label>
      <${NumInput} id=${"o-" + k} value=${o[k]} placeholder="doplniť" onChange=${(v) => set({ [k]: v })} />${hint ? html`<span class="hint">${hint}</span>` : null}</div>`;
    const curbHint = (m2) => (m2 ? `predvolene ${fmtNum(s.outdoorRules.curbFactor * Math.sqrt(m2), 1)} m` : "");
    return html`<div class="card">
      <div class="card-head"><div><h2>Vonkajšie zariadenie a prípojky</h2><div class="sub">Samostatná časť odhadu – nie je v cene domu. Dĺžky sa berú zo situácie, chýbajúce doplňte. Nezahŕňa napojenie na verejné siete a práce mimo pozemku.</div></div>
        <div class="badge accent num" style="font-size:13px;padding:5px 10px">${fmtEur(r.inclVat)} s DPH</div></div>
      <div class="section-title" style="margin:14px 20px 0">Prípojky na pozemku (m)</div>
      <div class="mini-grid">
        ${len("waterM", "Vodovod")}
        ${len("sewerM", o.sewage === "verejna" ? "Kanalizácia" : "Kanalizácia k žumpe / ČOV")}
        ${len("elecM", "Elektrina")}
        ${len("rainM", "Dažďová kanalizácia", "ak ju projekt rieši")}
        <div class="field"><label>Plyn</label><label class="check"><input type="checkbox" checked=${!!o.gas} onChange=${(e) => set({ gas: e.target.checked })} />plynová prípojka</label></div>
        ${o.gas ? len("gasM", "Plyn – dĺžka") : null}
        <div class="field"><label for="o-cc">Ovládací kábel</label><${NumInput} id="o-cc" value=${o.controlCableM} placeholder=${o.elecM ? String(o.elecM).replace(".", ",") : "ako elektrina"} onChange=${(v) => set({ controlCableM: v })} /><span class="hint">predvolene dĺžka elektro prípojky</span></div>
      </div>
      <div class="section-title" style="margin:4px 20px 0">Šachty, žumpa a meranie</div>
      <div class="mini-grid">
        <div class="field"><label for="o-sew">Odkanalizovanie</label><select id="o-sew" class="input" value=${o.sewage || "zumpa"} onChange=${(e) => set({ sewage: e.target.value, sewagePath: undefined })}><option value="zumpa">Žumpa</option><option value="cov">Domáca ČOV</option><option value="verejna">Verejná kanalizácia</option></select></div>
        ${o.sewage === "zumpa" || o.sewage === "cov" ? html`<div class="field"><label for="o-sp">${o.sewage === "cov" ? "Typ ČOV" : "Typ žumpy"}</label><select id="o-sp" class="input" value=${o.sewagePath || (o.sewage === "cov" ? it.treatment : it.cesspool)} onChange=${(e) => set({ sewagePath: e.target.value })}>${(o.sewage === "cov" ? plants : tanks).map(opt)}</select></div>` : null}
        <div class="field"><label for="o-wm">Vodomerná šachta</label><select id="o-wm" class="input" value=${o.waterMeterPit ?? ""} onChange=${(e) => set({ waterMeterPit: e.target.value })}><option value="">bez šachty</option>${pits.map(opt)}</select></div>
        <div class="field"><label for="o-ps">Čerpacia šachta</label><select id="o-ps" class="input" value=${o.pumpStation || ""} onChange=${(e) => set({ pumpStation: e.target.value })}><option value="">bez čerpacej šachty</option>${pumps.map(opt)}</select></div>
        <div class="field"><label for="o-rp">Revízne šachty (ks)</label><${NumInput} id="o-rp" value=${o.revisionPits} onChange=${(v) => set({ revisionPits: v })} /></div>
        <div class="field"><label for="o-rt">Lapače strešných splavenín (ks)</label><${NumInput} id="o-rt" value=${o.roofTraps} placeholder="0" onChange=${(v) => set({ roofTraps: v })} /></div>
        <div class="field"><label>Pilieriky merania</label><label class="check"><input type="checkbox" checked=${o.elecPost !== false} onChange=${(e) => set({ elecPost: e.target.checked })} />elektromer (RE)</label>${o.gas ? html`<label class="check"><input type="checkbox" checked=${o.gasPost !== false} onChange=${(e) => set({ gasPost: e.target.checked })} />plyn (HUP)</label>` : null}</div>
      </div>
      <div class="section-title" style="margin:4px 20px 0">Spevnené plochy</div>
      <div class="mini-grid">
        ${len("terraceM2", "Terasa – zámková dlažba (m²)")}
        <div class="field"><label for="o-tc">Obrubník terasy (m)</label><${NumInput} id="o-tc" value=${o.terraceCurbM} placeholder=${curbHint(o.terraceM2) ? "auto" : ""} onChange=${(v) => set({ terraceCurbM: v })} /><span class="hint">${curbHint(o.terraceM2)}</span></div>
        ${len("pavedM2", "Chodníky, parkovanie (m²)")}
        ${o.pavedM2 ? html`<div class="field"><label for="o-pc">Obrubník chodníkov (m)</label><${NumInput} id="o-pc" value=${o.pavedCurbM} placeholder="auto" onChange=${(v) => set({ pavedCurbM: v })} /><span class="hint">${curbHint(o.pavedM2)}</span></div>` : null}
        <div class="field"><label for="o-dp">Okapový chodník (m²)</label><${NumInput} id="o-dp" value=${o.dripPathM2} placeholder="0" onChange=${(v) => set({ dripPathM2: v })} />
          <select class="input" value=${o.dripPathType || "kamenivo"} onChange=${(e) => set({ dripPathType: e.target.value })}><option value="kamenivo">prané kamenivo</option><option value="dlazba">betónová dlažba</option></select></div>
        ${len("lawnM2", "Parkový trávnik (m²)")}
      </div>
      <div class="section-title" style="margin:4px 20px 0">Ďalšie položky na pozemku</div>
      <div class="card-pad" style="padding-top:10px">
        ${ex.length ? html`<div class="table-wrap"><table class="t dense ed"><tbody>${ex.map((x, i) => { const d = s.extrasCatalog.find((c) => c.key === x.key); return html`<tr>
          <td><b>${d ? d.label : x.key}</b>${x.note ? html`<div class="faint small">${x.note}</div>` : null}</td>
          <td class="w-s"><${NumInput} value=${x.qty} onChange=${(v) => set({ extras: ex.map((y, j) => (j === i ? { ...y, qty: v || 0 } : y)) })} /></td><td>${d ? d.unit : ""}</td>
          <td>${!d || d.pricing.type === "none" ? html`<span class="badge low">cena individuálne</span>` : null}</td>
          <td class="w-x"><button class="btn plain sm" title="Odstrániť" onClick=${() => set({ extras: ex.filter((_, j) => j !== i) })}><${Icon} name="x" /></button></td></tr>`; })}</tbody></table></div>` : null}
        <select class="input" style="max-width:340px;margin-top:8px" value="" onChange=${(e) => { if (e.target.value) set({ extras: [...ex, { key: e.target.value, qty: 1 }] }); }}>
          <option value="">+ Pridať položku (studňa, vsakovanie, dažďovka…)</option>${yardDefs.filter((d) => !ex.some((x) => x.key === d.key)).map((d) => html`<option value=${d.key}>${d.label}</option>`)}</select>
      </div>
      ${r.missing.length ? html`<div class="notice" style="margin:0 20px 20px"><div><b>Doplňte:</b> ${r.missing.join(", ")}. Bez nich je suma vonkajšieho zariadenia neúplná.</div></div>` : null}
    </div>`;
  }

  /** Krok 3: samostatný odhad vonkajšieho zariadenia v štruktúre súpisu ES (položky za ceny číselníka + rekapitulácia). */
  function OutdoorResultCard({ outdoor: o, house, onEdit }) {
    const groups = Object.keys(OUT_GROUPS).map((g) => ({ g, lines: o.lines.filter((l) => l.group === g) })).filter((x) => x.lines.length);
    return html`<div class="card">
      <div class="card-head"><div><h2>Vonkajšie zariadenie a prípojky</h2><div class="sub">Samostatný odhad mimo ceny domu – položky za ceny číselníka, rekapitulácia ako v súpise ES. Nezahŕňa napojenie na verejné siete a práce mimo pozemku.</div></div>
        <button class="btn plain sm" onClick=${onEdit}>Upraviť</button></div>
      ${o.missing.length ? html`<div class="notice" style="margin:0 20px 12px"><div><b>Neúplné – chýba:</b> ${o.missing.join(", ")}. Doplňte v kroku Kontrola údajov.</div></div>` : null}
      ${groups.length ? html`<div class="table-wrap"><table class="t dense">
        <thead><tr><th>Položka</th><th class="num">Množstvo</th><th class="num">J. cena</th><th class="num">Spolu bez DPH</th></tr></thead>
        <tbody>
          ${groups.map(({ g, lines }) => html`<tr class="grp"><td colspan="4"><b>${OUT_GROUPS[g]}</b></td></tr>${lines.map((l) => html`<tr>
            <td>${l.label}${l.note || l.warning ? html`<div class="faint small">${[l.note, l.warning].filter(Boolean).join(" · ")}</div>` : null}</td>
            <td class="num">${fmtNum(l.quantity, l.quantity % 1 ? 2 : 0)} ${l.unit}</td>
            <td class="num">${l.inclVat != null ? "cenník firmy" : l.unitCost ? fmtEur2(l.unitCost) : "–"}</td>
            <td class="num">${l.inclVat != null ? fmtEur(l.inclVat) + " s DPH" : l.cost ? fmtEur2(l.cost) : "–"}</td></tr>`)}`)}
          <tr><td colspan="3" class="muted">Položky spolu</td><td class="num">${fmtEur2(o.directCost)}</td></tr>
          <tr><td colspan="3" class="muted">Presun hmôt 2 %, GZS 3,5 %, zisk a réžia 4 %</td><td class="num">${fmtEur2(o.presunHmot + o.gzs + o.ziskRezia)}</td></tr>
          <tr><td colspan="3"><b>Spolu bez DPH</b></td><td class="num"><b>${fmtEur2(o.exclVat)}</b></td></tr>
          <tr><td colspan="3" class="muted">DPH 23 %</td><td class="num">${fmtEur2(o.vat)}</td></tr>
        </tbody></table></div>` : html`<div class="card-pad muted">Zatiaľ bez položiek – doplňte dĺžky prípojok v kroku Kontrola údajov.</div>`}
      <div class="out-total">
        <div><div class="kpi-label">Vonkajšie zariadenie s DPH</div><div class="kpi-value num">${fmtEur(o.inclVat)}</div></div>
        <div><div class="kpi-label">Dom + vonkajšie zariadenie s DPH</div><div class="kpi-value num">${fmtEur(house + o.inclVat)}</div></div>
      </div>
    </div>`;
  }

  const rowsTxt = (n) => `${n} ${n === 1 ? "rad" : n < 5 ? "rady" : "radov"}`;
  const PAGE_TYPE = { podorys: "pôdorys", rez: "rez", pohlad: "pohľad", vypis_otvorov: "výpis otvorov", technicka_sprava: "technická správa", situacia: "situácia", ine: "iné" };

  const CONF_LABEL = { usableAreaM2: "Úžitková plocha", builtAreaM2: "Zastavaná plocha", widthM: "Šírka domu", lengthM: "Dĺžka domu", floorsType: "Typ domu", storeyHeightM: "Konštrukčná výška podlažia", kneeWallM: "Nadmurovka", roofType: "Typ strechy", roofPitchDeg: "Sklon strechy", rooms: "Počet izieb", garages: "Garáž", bathrooms: "Počet kúpeľní", wcs: "Počet WC", heatingSource: "Zdroj tepla", heatingDistribution: "Rozvod tepla", centralRecuperation: "Rekuperácia", chimney: "Komín", fireplace: "Krb", openings: "Okná a dvere (rozmery)", foundation: "Založenie", bathroomsDetail: "Vybavenie kúpeľní", materials: "Materiály" };
  const pluralSk = (n, one, few, many) => `${n} ${n === 1 ? one : n > 1 && n < 5 ? few : many}`;

  /** "Poznámka k podkladom": what was read, findings by topic, what to verify, differences from the ES standard, summary. */
  function SourceNote({ draft, conf, diffs, hasHouse }) {
    const ai = draft.ai || {};
    const files = [];
    for (const p of ai.pages || []) {
      let f = files.find((x) => x.name === p.file);
      if (!f) files.push((f = { name: p.file, pages: [] }));
      f.pages.push(`${Array.isArray(p.page) ? p.page.join("–") : p.page || ""} ${PAGE_TYPE[p.type] || p.type || ""}${p.floor ? " " + p.floor : ""}`.trim());
    }
    const errors = (draft.aiMeta && draft.aiMeta.errors) || [];
    const topics = L.groupNotes(ai.notesList && ai.notesList.length ? ai.notesList : ai.notes);
    const lows = Object.entries(conf || {}).filter(([k, c]) => c === "low" && k !== "materials").map(([k]) => (k.startsWith("mat_") ? (L.ROLE[k.slice(4)] || {}).label : CONF_LABEL[k]) || k);
    const parts = [];
    for (const d of diffs) { let g = parts.find((x) => x.part === d.part); if (!g) parts.push((g = { part: d.part, items: [] })); g.items.push(d); }
    let n = 0;
    return html`<div class="card srcnote">
      <div class="card-head"><div><h2>Poznámka k podkladom</h2><div class="sub">Čo sa z podkladov prečítalo, čo treba overiť a v čom sa štúdia líši od štandardu ES.</div></div></div>
      <div class="card-pad">
        ${files.length || errors.length ? html`<section><h3>${++n}. Prečítané podklady</h3>
          <ul>${files.map((f) => html`<li><b>${f.name}</b> <span class="muted">– ${pluralSk(f.pages.length, "strana", "strany", "strán")}: ${f.pages.join(" · ")}</span></li>`)}</ul>
          ${errors.length ? html`<div class="notice bad small"><div><b>${pluralSk(errors.length, "strana sa nepodarila", "strany sa nepodarili", "strán sa nepodarilo")} prečítať:</b><ul>${errors.slice(0, 6).map((e) => html`<li>${e}</li>`)}</ul></div></div>` : null}
        </section>` : null}
        ${topics.length ? html`<section><h3>${++n}. Zistenia z podkladov</h3>
          <div class="topics">${topics.map((t) => html`<div class="topic"><h4>${t.label}</h4><ul>${t.items.map((i) => html`<li class=${i.warn ? "warn" : ""}>${i.text}</li>`)}</ul></div>`)}</div>
        </section>` : null}
        ${lows.length ? html`<section><h3>${++n}. Údaje na overenie</h3>
          <p class="muted small">Tieto údaje nie sú v podkladoch priamo uvedené alebo boli odhadnuté. V tabuľke nižšie sú označené „overiť“.</p>
          <div class="chips">${lows.map((x) => html`<span class="badge warn">${x}</span>`)}</div>
        </section>` : null}
        <section><h3>${++n}. Odlišnosti oproti štandardu ES</h3>
          ${!hasHouse ? html`<p class="muted">Vyberte východiskový dom – porovnanie so štandardom sa zobrazí potom.</p>`
            : !diffs.length ? html`<p class="muted">Štúdia sa v sledovaných položkách nelíši od štandardu ES.</p>`
            : html`<div class="table-wrap"><table class="t dense diffs">
              <thead><tr><th>Položka</th><th>Štandard ES</th><th>Štúdia klienta</th></tr></thead>
              <tbody>${parts.map((g) => html`<tr class="grp"><td colspan="3">${g.part}</td></tr>${g.items.map((d) => html`<tr><td><b>${d.label}</b></td><td class="muted">${d.std || "–"}</td><td>${d.val || "–"}</td></tr>`)}`)}</tbody>
            </table></div>`}
        </section>
        ${hasHouse ? html`<section class="sum"><h3>${++n}. Zhrnutie</h3>
          ${diffs.length ? html`<p>Štúdia sa od štandardu ES líši v <b>${pluralSk(diffs.length, "položke", "položkách", "položkách")}</b> v <b>${pluralSk(parts.length, "časti", "častiach", "častiach")}</b>:</p>
            <ul>${parts.map((g) => html`<li><b>${g.part}:</b> ${g.items.map((d) => (/^\p{Lu}\p{Ll}/u.test(d.label) ? d.label[0].toLowerCase() + d.label.slice(1) : d.label)).join(", ")}</li>`)}</ul>`
            : html`<p>Štúdia zodpovedá štandardu ES – odhad sa rovná cene katalógového domu.</p>`}
          ${lows.length ? html`<p class="muted small" style="margin-top:10px">Pred odovzdaním klientovi overte ${pluralSk(lows.length, "údaj", "údaje", "údajov")} označené „overiť“.</p>` : null}
        </section>` : null}
      </div>
    </div>`;
  }

  /** Detailed study data: floors, openings, bathrooms, foundation, extras – all editable except adding extras. */
  function StudyDetails({ ctx, study, base, upd }) {
    const conf = study.confidence || {};
    const ev = study.evidence || {};
    const setMany = (patch, confKeys = []) => {
      const c = { ...conf };
      for (const k of confKeys) delete c[k];
      upd({ study: { ...study, ...patch, confidence: c } });
    };
    const sumS = L.studySummary(study, ctx.settings);
    const sumB = L.studySummary(base, ctx.settings);
    return html`
      ${study.floors && study.floors.length ? html`<div class="card">
        <div class="card-head"><div><h2>Podlažia a miestnosti</h2><div class="sub">Úžitková plocha je súčet miestností bez garáže, terás a balkónov, ak ju podklady neuvádzajú priamo.</div></div><${Conf} c=${conf.usableAreaM2} ev=${ev.usableAreaM2} /></div>
        <div class="mini-grid">
          ${study.floors.map((f) => html`<div class="stat"><b>${f.usableAreaM2 ? fmtNum(f.usableAreaM2, 1) + " m²" : "–"}</b><span>${f.name}${f.rooms ? ` · ${f.rooms} miestností` : ""}</span></div>`)}
          <div class="stat"><b>${study.usableAreaM2 ? fmtNum(study.usableAreaM2, 1) + " m²" : "–"}</b><span>úžitková spolu</span></div>
          <div class="stat"><b>${study.builtAreaM2 ? fmtNum(study.builtAreaM2, 1) + " m²" : "–"}</b><span>zastavaná plocha</span></div>
          <div class="stat"><b>${study.rooms || "–"}</b><span>počet izieb</span></div>
        </div>
      </div>` : null}
      <${OpeningsEditor} ops=${study.openings || []} c=${conf.openings} ev=${ev.openings} sumS=${sumS} sumB=${sumB}
        onChange=${(ops) => setMany({ openings: ops }, ["openings"])} />
      <${BathroomsEditor} ctx=${ctx} study=${study} c=${conf.bathrooms} ev=${ev.bathrooms} sumB=${sumB}
        onChange=${(list) => {
          const isBath = (b) => b.bathtub || b.cornerTub || b.freestandingTub || b.shower || b.showerDrain;
          setMany({ bathroomsDetail: list, bathrooms: list.filter(isBath).length, wcs: list.filter((b) => !isBath(b) && (b.wc || b.wcWallHung)).length }, ["bathrooms", "wcs"]);
        }} />
      <${FoundationEditor} ctx=${ctx} study=${study} c=${conf.foundation} ev=${ev.foundation} onChange=${(f) => setMany({ foundation: f }, ["foundation"])} />
      <${ExtrasList} ctx=${ctx} extras=${L.houseExtras(study, ctx.settings)} onChange=${(x) => setMany({ extras: [...x, ...(study.outdoor ? [] : (study.extras || []).filter((e) => E.isOutdoorExtra(ctx.settings, e.key)))] })} />`;
  }

  function OpeningsEditor({ ops, c, ev, sumS, sumB, onChange }) {
    const set = (i, patch) => onChange(ops.map((o, j) => (j === i ? L.clean({ ...o, ...patch }) : o)));
    const del = (i) => onChange(ops.filter((_, j) => j !== i));
    const add = () => onChange([...ops, { type: "okno", widthM: 1.2, heightM: 1.25, count: 1 }]);
    const area = (o) => E.openingArea(o);
    return html`<div class="card">
      <div class="card-head"><div><h2>Okná a dvere</h2><div class="sub">${ops.length ? `Štúdia: ${sumS.extCount} ks v obvodovom plášti, ${fmtNum(sumS.extArea, 1)} m². Štandard ES: ${sumB.extCount} ks, ${fmtNum(sumB.extArea, 1)} m².` : "Otvory sa v podkladoch nenašli – počíta sa s plochou okien z porovnania vyššie, alebo ich doplňte."}</div></div>
        <div class="row"><${Conf} c=${c} ev=${ev} /><button class="btn tinted sm" onClick=${add}><${Icon} name="plus" />Pridať riadok</button></div></div>
      ${ops.length ? html`<div class="table-wrap"><table class="t dense ed">
        <thead><tr><th>Typ</th><th>Ozn.</th><th class="num">Šírka m</th><th class="num">Výška m</th><th class="num">Ks</th><th>Podlažie</th><th class="num">Plocha m²</th><th></th></tr></thead>
        <tbody>${ops.map((o, i) => html`<tr>
          <td><select class="input" value=${o.type} onChange=${(e) => set(i, { type: e.target.value })}>${L.OPENING_TYPES.map((t) => html`<option value=${t}>${L.OPENING_LABEL[t]}</option>`)}</select></td>
          <td class="w-s"><input class="input" value=${o.label || ""} onInput=${(e) => set(i, { label: e.target.value })} /></td>
          <td class="w-s"><${NumInput} value=${o.widthM} onChange=${(v) => set(i, { widthM: v })} /></td>
          <td class="w-s"><${NumInput} value=${o.heightM} onChange=${(v) => set(i, { heightM: v })} /></td>
          <td class="w-s"><${NumInput} value=${o.count} onChange=${(v) => set(i, { count: Math.max(0, Math.round(v || 0)) })} /></td>
          <td class="w-m"><input class="input" value=${o.floor || ""} onInput=${(e) => set(i, { floor: e.target.value })} /></td>
          <td class="num">${fmtNum(area(o), 2)}</td>
          <td class="w-x"><button class="btn plain sm" title="Odstrániť" onClick=${() => del(i)}><${Icon} name="x" /></button></td>
        </tr>`)}</tbody>
      </table></div>
      <div class="card-pad small muted">${sumS.byType.map((x) => `${x.label}: ${x.count} ks (${fmtNum(x.area, 1)} m²)`).join(" · ")}</div>` : null}
    </div>`;
  }

  const FIXTURES = [["bathtub", "Vaňa"], ["cornerTub", "Rohová vaňa"], ["freestandingTub", "Voľne stojaca vaňa"], ["shower", "Sprchový kút"], ["showerDrain", "Sprcha so žľabom"], ["washbasins", "Umývadlá"], ["wc", "WC kombi"], ["wcWallHung", "Závesné WC"], ["bidet", "Bidet"]];
  function BathroomsEditor({ ctx, study, c, ev, sumB, onChange }) {
    const list = study.bathroomsDetail || [];
    const set = (i, patch) => onChange(list.map((b, j) => (j === i ? { ...b, ...patch } : b)));
    const del = (i) => onChange(list.filter((_, j) => j !== i));
    const add = (wc) => onChange([...list, wc ? { name: "WC", wc: 1, washbasins: 1 } : { name: "Kúpeľňa", shower: 1, washbasins: 1, wc: 1 }]);
    return html`<div class="card">
      <div class="card-head"><div><h2>Kúpeľne a WC</h2><div class="sub">${list.length ? `${study.bathrooms} kúpeľne, ${study.wcs} samostatné WC. Štandard ES: ${sumB.baths.map((b) => b.text).join(" | ")}.` : "Vybavenie kúpeľní sa v podkladoch nenašlo – počíta sa so štandardnou výbavou podľa počtu kúpeľní."}</div></div>
        <div class="row"><${Conf} c=${c} ev=${ev} /><button class="btn tinted sm" onClick=${() => add(false)}><${Icon} name="plus" />Kúpeľňa</button><button class="btn tinted sm" onClick=${() => add(true)}><${Icon} name="plus" />WC</button></div></div>
      ${list.length ? html`<div class="baths">${list.map((b, i) => html`<div class="bath">
        <div class="row" style="gap:6px;flex-wrap:nowrap"><input class="input grow" style="min-width:0" value=${b.name || ""} onInput=${(e) => set(i, { name: e.target.value })} /><div style="width:70px"><${NumInput} value=${b.areaM2} placeholder="m²" onChange=${(v) => set(i, { areaM2: v })} /></div><button class="btn plain sm" title="Odstrániť" onClick=${() => del(i)}><${Icon} name="x" /></button></div>
        <div class="fx">${FIXTURES.map(([k, l]) => html`<span>${l}</span><${NumInput} value=${b[k] || 0} onChange=${(v) => set(i, { [k]: Math.max(0, Math.round(v || 0)) })} />`)}</div>
        <div class="small faint">${L.bathroomText(b)}</div>
      </div>`)}</div>` : null}
    </div>`;
  }

  function FoundationEditor({ ctx, study, c, ev, onChange }) {
    const f = study.foundation || null;
    const dt = L.dtPieces(study, ctx.settings);
    const set = (patch) => onChange(L.clean({ ...(f || { type: "pasy_dt", dtRows: 3, dtThicknessMm: 300, dtRowHeightMm: 250 }), ...patch }));
    const thick = Object.keys(ctx.settings.dtBlocks).map(Number).sort((a, b) => a - b);
    return html`<div class="card">
      <div class="card-head"><div><h2>Založenie stavby</h2><div class="sub">${f ? "Z rezu: " + L.FOUNDATION_LABEL[f.type] : `Rez neuvádza založenie – počíta sa so štandardom ES (${L.FOUNDATION_LABEL[ctx.settings.standardFoundation.type]}, ${rowsTxt(ctx.settings.standardFoundation.dtRows)} DT ${ctx.settings.standardFoundation.dtThicknessMm} mm).`}</div></div>
        <div class="row"><${Conf} c=${c} ev=${ev} />${f ? html`<button class="btn plain sm" onClick=${() => onChange(undefined)}>Zrušiť</button>` : html`<button class="btn tinted sm" onClick=${() => set({})}><${Icon} name="plus" />Zadať</button>`}</div></div>
      ${f ? html`<div class="card-pad" style="display:flex;flex-direction:column;gap:12px">
        <${Seg} value=${f.type} options=${Object.entries(L.FOUNDATION_LABEL)} onChange=${(v) => set({ type: v })} />
        ${f.type === "pasy_dt" ? html`<div class="mini-grid" style="padding:0">
          <div class="field"><label>Počet radov DT</label><${NumInput} value=${f.dtRows} onChange=${(v) => set({ dtRows: v ? Math.round(v) : undefined })} /></div>
          <div class="field"><label>Hrúbka DT (mm)</label><select class="input" value=${f.dtThicknessMm || ""} onChange=${(e) => set({ dtThicknessMm: Number(e.target.value) || undefined })}><option value="">—</option>${thick.map((t) => html`<option value=${t}>${t}</option>`)}</select></div>
          <div class="field"><label>Výška radu (mm)</label><${NumInput} value=${f.dtRowHeightMm} placeholder="250" onChange=${(v) => set({ dtRowHeightMm: v })} /></div>
          <div class="field"><label>Dĺžka základov (m)</label><${NumInput} value=${f.lengthM} placeholder=${dt ? fmtNum(dt.lengthM, 1) : ""} onChange=${(v) => set({ lengthM: v })} /></div>
        </div>
        ${dt ? html`<div class="notice info"><div><b>Cca ${fmtNum(dt.pieces)} ks DT tvárnic</b> – ${dt.rows} ${dt.rows === 1 ? "rad" : dt.rows < 5 ? "rady" : "radov"} × ${fmtNum(dt.perRow)} ks (tvárnica 500 mm, dĺžka základov ${fmtNum(dt.lengthM, 1)} m${dt.lengthEstimated ? ", odhad z obvodu a nosných stien" : ""}).</div></div>` : null}` : null}
        ${f.type !== "doska" ? html`<div class="mini-grid" style="padding:0">
          <div class="field"><label>Šírka pásu (m)</label><${NumInput} value=${f.stripWidthM} placeholder="0,5" onChange=${(v) => set({ stripWidthM: v })} /></div>
          <div class="field"><label>Hĺbka pásu (m)</label><${NumInput} value=${f.stripDepthM} placeholder="0,8" onChange=${(v) => set({ stripDepthM: v })} /></div>
        </div>` : html`<div class="mini-grid" style="padding:0">
          <div class="field"><label>Hrúbka dosky (m)</label><${NumInput} value=${f.slabThicknessM} placeholder="0,25" onChange=${(v) => set({ slabThicknessM: v })} /></div>
          <div class="field"><label>Štrkový vankúš (m)</label><${NumInput} value=${f.gravelThicknessM} placeholder="0,3" onChange=${(v) => set({ gravelThicknessM: v })} /></div>
        </div>`}
      </div>` : null}
    </div>`;
  }

  function ExtrasList({ ctx, extras, onChange }) {
    const cat = ctx.settings.extrasCatalog;
    const set = (i, patch) => onChange(extras.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    return html`<div class="card">
      <div class="card-head"><div><h2>Nadštandardy zo štúdie</h2><div class="sub">Preberajú sa len tie, ktoré sú v podkladoch. Množstvo sa dá upraviť, položku je možné odstrániť.</div></div></div>
      ${extras.length ? html`<div class="table-wrap"><table class="t dense ed">
        <thead><tr><th>Nadštandard</th><th>V podkladoch</th><th class="num">Množstvo</th><th>Jedn.</th><th>Cena</th><th></th></tr></thead>
        <tbody>${extras.map((x, i) => { const d = cat.find((c) => c.key === x.key); return html`<tr>
          <td><b>${d ? d.label : x.key}</b><div class="faint small">${d ? d.group : ""}</div></td>
          <td class="small muted">${x.note || "–"}</td>
          <td class="w-s"><${NumInput} value=${x.qty} onChange=${(v) => set(i, { qty: v || 0 })} /></td>
          <td>${d ? d.unit : ""}</td>
          <td>${x.qtyMissing && !x.qty ? html`<span class="badge warn">doplniť množstvo</span> ` : null}${!d || d.pricing.type === "none" ? html`<span class="badge low">bez ceny</span>` : d.pricing.type === "company" ? html`<span class="badge accent">cenník firmy</span>` : html`<span class="badge">číselník</span>`}</td>
          <td class="w-x"><button class="btn plain sm" title="Odstrániť" onClick=${() => onChange(extras.filter((_, j) => j !== i))}><${Icon} name="x" /></button></td>
        </tr>`; })}</tbody>
      </table></div>` : html`<div class="card-pad muted">V podkladoch sa nenašli žiadne nadštandardy.</div>`}
    </div>`;
  }

  function HousePicker({ ctx, study, onPick }) {
    const [q, setQ] = useState("");
    const ranked = useMemo(() => L.findClosestHouses(study, ctx.houses, "", 8), [study]);
    const list = q ? ctx.houses.filter((h) => L.norm(h.name).includes(L.norm(q))).slice(0, 40) : ranked.map((r) => r.house);
    return html`<div class="card-head"><h2>Vyberte východiskový dom</h2></div>
      <div class="card-pad" style="display:flex;flex-direction:column;gap:12px">
        <input class="input" placeholder="Hľadať podľa názvu, napr. Lucie 89" value=${q} onInput=${(e) => setQ(e.target.value)} autofocus />
        ${!q ? html`<div class="small muted">Najpodobnejšie domy podľa údajov zo štúdie:</div>` : null}
        <div class="table-wrap"><table class="t">
          <thead><tr><th class="w-img"><span class="sr-only">Obrázok</span></th><th>Dom</th><th>Dispozícia</th><th class="num">Úžitková</th><th class="num">Zastavaná</th><th>Typ</th><th class="num">Cena</th>${!q ? html`<th class="num">Zhoda</th>` : null}</tr></thead>
          <tbody>${list.map((h) => html`<tr class="click" onClick=${() => onPick(h)}><td class="w-img"><div class="house-mini"><${HouseImg} h=${h} plan=${false} /></div></td><td><b>${h.name}</b></td><td>${h.disp}</td><td class="num">${fmtNum(h.pu, 1)} m²</td><td class="num">${fmtNum(h.pz, 1)} m²</td><td>${L.FLOORS_LABEL[L.KIND[h.kind]]}</td><td class="num">${fmtEur(h.price)}</td>${!q ? html`<td class="num">${(ranked.find((r) => r.house.id === h.id) || {}).score} %</td>` : null}</tr>`)}</tbody>
        </table></div>
      </div>`;
  }

  // ---------- Step 3: result ----------
  function computeFor(ctx, draft) {
    const house = ctx.housesById[draft.baseHouseId];
    const eb = L.effectiveBase(house, ctx.settings);
    const study = L.clean({ ...draft.study });
    delete study.materialTexts; delete study.evidence;
    study.materials = L.clean(draft.study.materials || {});
    const outdoorParams = draft.study.outdoor || L.initOutdoor(draft.study, ctx.settings);
    delete study.outdoor;
    study.extras = L.houseExtras(study, ctx.settings);
    if (!study.extras.length) delete study.extras;
    const outdoor = E.computeOutdoor(outdoorParams, ctx.prices, ctx.settings, ctx.extras.accessories || {});
    const r = E.computeEstimate({
      basePriceInclVat: draft.finish === "holodom" ? house.hol : house.price,
      finish: draft.finish, base: eb.params, study, prices: ctx.prices, settings: ctx.settings, extras: ctx.extras,
    });
    r.thresholdPct = ctx.settings.optimizationThresholdPct;
    for (const x of study.extras || []) if (!x.qty) { const d = ctx.settings.extrasCatalog.find((c) => c.key === x.key); r.warnings.push(`Nadštandard „${d ? d.label : x.key}“ nemá v štúdii množstvo – doplňte ho v kroku Kontrola údajov.`); }
    const basePrice = draft.finish === "holodom" ? house.hol : house.price;
    const run = (st) => E.computeEstimate({ basePriceInclVat: basePrice, finish: draft.finish, base: eb.params, study: st, prices: ctx.prices, settings: ctx.settings, extras: ctx.extras });
    const variants = [{ id: "studia", name: "Štúdia klienta", note: "podľa predložených podkladov", estimate: r.estimateInclVat, changePct: r.changePct, main: true }];
    const mk = (id, name, note, patches) => {
      if (!patches.length) return;
      let st = study;
      for (const pt of patches) st = E.applyPatch(st, pt);
      const v = run(st);
      if (Math.abs(v.estimateInclVat - r.estimateInclVat) < 1) return;
      variants.push({ id, name, note, estimate: v.estimateInclVat, changePct: v.changePct });
    };
    const opts = r.optimizations || [];
    if (study.extras && study.extras.length) mk("bez-nadstandardov", "Bez nadštandardov", "štúdia bez nadštandardov zistených v podkladoch", [{ dropExtras: study.extras.map((x) => x.key) }]);
    const eco = opts.filter((o) => ["material", "technologia", "nadstandard"].includes(o.kind));
    mk("usporny", "Úsporný variant", eco.length ? eco.map((o) => o.title).join("; ") : "", eco.map((o) => o.patch));
    const sel = opts.filter((o) => (draft.variantSel || []).includes(o.id));
    mk("vlastny", "Vlastný variant", sel.map((o) => o.title).join("; "), sel.map((o) => o.patch));
    return { result: r, house, baseParams: eb.params, studyParams: study, variants, outdoor, outdoorParams };
  }

  function StepResult({ ctx, draft, upd }) {
    const { result: r, house, baseParams, studyParams, variants, outdoor } = useMemo(() => computeFor(ctx, draft), [draft.study, draft.baseOverrides, draft.baseHouseId, draft.finish, draft.variantSel, ctx.prices, ctx.settings]);
    const toggleSel = (id) => { const cur = draft.variantSel || []; upd({ variantSel: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }); };
    const [detail, setDetail] = useState(false);
    const [saving, setSaving] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [summary, setSummary] = useState(draft.aiSummary || "");
    const [sumBusy, setSumBusy] = useState(false);
    const maxAbs = Math.max(1, ...r.topDrivers.map((d) => Math.abs(d.deltaInclVat)));
    const caps = ctx.caps;

    async function save() {
      if (!caps.db || !caps.uid) { ctx.say("Ukladanie nie je dostupné – otvorte aplikáciu prihlásený v Claude."); return; }
      setSaving(true);
      try {
        let files = draft.files || [];
        if (caps.assets && draft.localFiles && draft.localFiles.length) {
          const up = [];
          for (const f of draft.localFiles) {
            try { const a = await caps.assets.upload(f); up.push({ assetId: a.id, name: f.name, type: f.type }); } catch (e) { /* skip */ }
          }
          files = [...files, ...up];
        }
        const doc = {
          id: draft.id, ownerId: caps.uid, ownerName: ctx.profile?.name || caps.me?.name || "", clientName: draft.clientName || "", clientNote: draft.clientNote || "",
          finish: draft.finish, baseHouseId: draft.baseHouseId, baseHouseName: house.name, files, aiSummary: summary || "",
          ai: draft.ai ? { pages: draft.ai.pages || [], notes: draft.ai.notes || "", notesList: draft.ai.notesList || [], houseName: draft.ai.houseName || "" } : null, variantSel: draft.variantSel || [],
          study: L.clone(draft.study), baseOverrides: L.clone(draft.baseOverrides || {}), matches: draft.matches || [],
          summary: {
            basePrice: r.basePriceInclVat, estimate: r.estimateInclVat, estimateExclVat: r.estimateExclVat, change: r.changeInclVat, changePct: r.changePct, range: r.range,
            topDrivers: r.topDrivers.map((d) => ({ key: d.key, label: d.label, delta: Math.round(d.deltaInclVat), explanation: d.explanation })),
            optimizations: r.optimizations.map(({ patch, ...o }) => o),
            variants: variants.map(({ id, name, estimate, changePct }) => ({ id, name, estimate: Math.round(estimate), changePct })),
            outdoor: { inclVat: Math.round(outdoor.inclVat), exclVat: Math.round(outdoor.exclVat), missing: outdoor.missing },
          },
          priceListVersion: ctx.priceList.version || "", status: "hotový", createdAt: draft.createdAt || Date.now(), updatedAt: Date.now(),
        };
        await caps.db.doc(`estimates/${caps.uid}/list/${draft.id}`).set(L.clean(doc));
        upd({ files, localFiles: [], status: "hotový", aiSummary: summary });
        ctx.say("Prepočet je uložený");
      } catch (e) {
        ctx.say(e && e.code === "quota_exceeded" ? "Úložisko je plné – odstráňte staré prepočty." : "Prepočet sa nepodarilo uložiť. Skúste znova.");
      }
      setSaving(false);
    }
    async function exportPdf() {
      if (!caps.downloads) { ctx.say("Export do PDF je dostupný len v aplikácii otvorenej v Claude."); return; }
      setExporting(true);
      try {
        let logoDataUrl = null;
        if (ctx.company.logoAssetId) {
          try { const b = await (await fetch("/_blob/" + ctx.company.logoAssetId)).blob(); logoDataUrl = await L.blobToDataUrl(b); } catch (e) { /* no logo */ }
        }
        const rep = { name: ctx.profile?.name || caps.me?.name || "", phone: ctx.profile?.phone || "", email: ctx.profile?.email || caps.me?.email || "" };
        const docDef = L.buildPdfDoc({ est: { ...draft, aiSummary: summary }, result: r, house, company: ctx.company, rep, logoDataUrl, studyParams, baseParams, settings: ctx.settings, variants, outdoor });
        const blob = await L.pdfBlob(docDef);
        const safe = (draft.clientName || house.name).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_");
        await caps.downloads.save({ filename: `Odhad_${safe}_${fmtDate(Date.now()).replace(/\./g, "-")}.pdf`, data: blob });
        ctx.say("PDF je pripravené");
      } catch (e) {
        if (!(e && e.code === "declined")) ctx.say("PDF sa nepodarilo vytvoriť.");
      }
      setExporting(false);
    }
    async function makeSummary() {
      if (!caps.sample) return;
      setSumBusy(true);
      try { setSummary(await L.explainWithAI(caps.sample, r, house.name)); } catch (e) { ctx.say("Zhrnutie sa nepodarilo vytvoriť."); }
      setSumBusy(false);
    }

    return html`
      <div class="kpis">
        <div class="card kpi kpi-house"><div class="grow"><div class="kpi-label">Východiskový dom</div><div class="kpi-value num">${fmtEur(r.basePriceInclVat)}</div><div class="kpi-sub">${house.name} · ${draft.finish === "holodom" ? "holodom" : "štandard"} · s DPH</div></div><div class="house-mini lg"><${HouseImg} h=${house} plan=${false} /></div></div>
        <div class="card kpi hero"><div class="kpi-label">Odborný cenový odhad</div><div class="kpi-value num">${fmtEur(r.estimateInclVat)}</div><div class="kpi-sub">rozpätie ${fmtEur(r.range.lowInclVat)} – ${fmtEur(r.range.highInclVat)} (±${fmtNum(r.range.bandPct, 1)} %)</div></div>
        <div class="card kpi"><div class="kpi-label">Zmena oproti východiskovému</div><div class="kpi-value num ${r.changeInclVat > 0 ? "delta-up" : "delta-down"}">${fmtSigned(r.changeInclVat)}</div><div class="kpi-sub"><${Pill} pct=${r.changePct} /> <span style="margin-left:6px">bez DPH ${fmtEur(r.estimateExclVat)}</span></div></div>
      </div>
      ${r.warnings.length ? html`<div class="notice"><div><b>Na overenie</b><ul>${r.warnings.slice(0, 6).map((w) => html`<li>${w}</li>`)}</ul></div></div>` : null}
      <div class="card">
        <div class="card-head"><div><h2>Čo cenu ovplyvnilo najviac</h2><div class="sub">Rozdiel voči domu ${house.name}, s DPH</div></div>
          <button class="btn plain sm" onClick=${() => setDetail(!detail)}>${detail ? "Skryť rozpis" : "Celý rozpis"}</button></div>
        ${summary || caps.sample ? html`<div class="card-pad" style="border-bottom:1px solid var(--line)">${summary ? html`<p style="margin:0;max-width:80ch">${summary}</p>` : html`<button class="btn tinted sm" disabled=${sumBusy} onClick=${makeSummary}>${sumBusy ? html`<span class="spinner"></span>` : html`<${Icon} name="spark" />`}Napísať zhrnutie pre klienta</button>`}</div>` : null}
        <div class="drivers">
          ${r.topDrivers.length ? r.topDrivers.map((d) => html`<div class="driver">
            <div><div class="name">${d.label}</div><div class="why">${d.explanation}</div></div>
            <div class="bar"><span class=${d.deltaInclVat > 0 ? "up" : "down"} style=${`width:${(Math.abs(d.deltaInclVat) / maxAbs) * 50}%`}></span></div>
            <div class=${"val " + (d.deltaInclVat > 0 ? "delta-up" : "delta-down")}>${fmtSigned(d.deltaInclVat)}</div>
          </div>`) : html`<div class="empty"><h3>Bez zmien</h3><p>Štúdia sa zhoduje s východiskovým domom.</p></div>`}
          ${Math.abs(r.otherDeltaInclVat) >= 1 ? html`<div class="driver"><div><div class="name muted">Ostatné drobné zmeny</div></div><div></div><div class="val">${fmtSigned(r.otherDeltaInclVat)}</div></div>` : null}
        </div>
        ${detail ? html`<div class="table-wrap" style="border-top:1px solid var(--line)"><table class="t dense">
          <thead><tr><th>Prvok</th><th class="num">Východiskový</th><th class="num">Štúdia</th>${ctx.caps.admin ? html`<th class="num">Náklad východ.</th><th class="num">Náklad štúdia</th>` : null}<th class="num">Vplyv s DPH</th></tr></thead>
          <tbody>${r.elements.map((e) => html`<tr><td><b>${e.label}</b><div class="faint small">${e.explanation}</div></td><td class="num">${fmtNum(e.base.quantity, 1)} ${e.base.unit}</td><td class="num">${fmtNum(e.study.quantity, 1)} ${e.study.unit}</td>${ctx.caps.admin ? html`<td class="num">${e.pricedBy === "firma" ? "cenník firmy" : fmtEur(e.base.cost)}</td><td class="num">${e.pricedBy === "firma" ? "" : fmtEur(e.study.cost)}</td>` : null}<td class=${"num " + (e.deltaInclVat > 0 ? "delta-up" : e.deltaInclVat < 0 ? "delta-down" : "")}>${fmtSigned(e.deltaInclVat)}</td></tr>`)}</tbody>
        </table></div>` : null}
      </div>
      ${!r.optimizationNeeded ? html`<div class="notice info"><div>Zmena ceny je v rámci ${fmtNum(ctx.settings.optimizationThresholdPct)} % – optimalizácia nie je potrebná.${r.optimizations.length ? " Možné úspory nižšie slúžia na prípravu variantov." : ""}</div></div>` : null}
      ${r.optimizationNeeded || r.optimizations.length ? html`<div class="card">
        <div class="card-head"><div><h2>${r.optimizationNeeded ? "Návrhy na optimalizáciu" : "Možné úspory"}</h2><div class="sub">${r.optimizationNeeded ? `Zmena ${fmtPct(r.changePct)} prekračuje ${fmtNum(ctx.settings.optimizationThresholdPct)} %. ` : ""}Každý návrh je vyčíslený samostatne; zaškrtnuté sa spoja do vlastného variantu.</div></div></div>
        ${r.optimizations.length ? html`<div class="opts">${r.optimizations.map((o) => html`<div class="opt">
          <div class="row" style="justify-content:space-between"><span class="badge">${{ material: "materiál", tvar: "tvar", plocha: "plocha", technologia: "technológia", nadstandard: "nadštandard" }[o.kind]}</span><span class="save">−${fmtEur(o.savingInclVat)}</span></div>
          <h4>${o.title}</h4><p>${o.detail}</p><p class="small">Nová zmena: <b>${fmtPct(o.newChangePct)}</b></p>
          <label class="check pick"><input type="checkbox" checked=${(draft.variantSel || []).includes(o.id)} onChange=${() => toggleSel(o.id)} />Do vlastného variantu</label>
        </div>`)}</div>` : html`<div class="card-pad muted">Z číselníka sa nenašli lacnejšie porovnateľné alternatívy.</div>`}
      </div>` : null}
      ${variants.length > 1 ? html`<div class="card">
        <div class="card-head"><div><h2>Porovnanie variantov</h2><div class="sub">Vlastný variant poskladáte zaškrtnutím návrhov vyššie. Varianty idú aj do PDF.</div></div></div>
        <div class="variants">${variants.map((v) => html`<div class=${"variant" + (v.main ? " main" : "")}>
          <div class="small muted" style="font-weight:600">${v.name}</div>
          <div class="price">${fmtEur(v.estimate)}</div>
          <div class="row" style="gap:6px"><${Pill} pct=${v.changePct} />${!v.main ? html`<span class="small delta-down">${fmtSigned(v.estimate - r.estimateInclVat)} oproti štúdii</span>` : null}</div>
          <p title=${v.note}>${v.note}</p>
        </div>`)}</div>
      </div>` : null}
      <${OutdoorResultCard} outdoor=${outdoor} house=${r.estimateInclVat} onEdit=${() => upd({ step: 2 })} />
      <div class="row" style="justify-content:space-between">
        <button class="btn" onClick=${() => upd({ step: 2 })}><${Icon} name="back" />Upraviť údaje</button>
        <div class="row">
          <button class="btn" disabled=${saving} onClick=${save}>${saving ? html`<span class="spinner"></span>` : html`<${Icon} name="check" />`}Uložiť prepočet</button>
          <button class="btn primary lg" disabled=${exporting} onClick=${exportPdf}>${exporting ? html`<span class="spinner"></span>` : html`<${Icon} name="download" />`}Exportovať PDF</button>
        </div>
      </div>`;
  }

  // ---------- Estimates list ----------
  function EstimatesList({ ctx, onOpen, onNew }) {
    const caps = ctx.caps;
    const [mine, setMine] = useState(null);
    const [scope, setScope] = useState("mine");
    const [others, setOthers] = useState(null);
    const [profiles, setProfiles] = useState([]);
    useEffect(() => {
      if (!caps.db || !caps.uid) { setMine([]); return; }
      const un = caps.db.collection(`estimates/${caps.uid}/list`).orderBy("updatedAt", "desc").limit(300).onSnapshot((s) => setMine(s.docs.map((d) => d.data())), () => setMine([]));
      return un;
    }, []);
    useEffect(() => {
      if (scope !== "all" || !caps.db) return;
      (async () => {
        const ps = await caps.db.collection("profiles").get();
        const pl = ps.docs.map((d) => ({ id: d.id, ...d.data() }));
        setProfiles(pl);
        const lists = await Promise.all(pl.map((p) => caps.db.collection(`estimates/${p.id}/list`).orderBy("updatedAt", "desc").limit(200).get().then((s) => s.docs.map((d) => d.data())).catch(() => [])));
        setOthers(lists.flat().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
      })();
    }, [scope]);
    const rows = scope === "all" ? others : mine;
    const [rep, setRep] = useState("");
    const shown = (rows || []).filter((e) => !rep || e.ownerId === rep);
    const canEditRow = (e) => e.ownerId === caps.uid || caps.admin;
    async function setActual(e, v) {
      const val = v == null || v === "" ? null : Number(v);
      if ((e.actualPrice ?? null) === val) return;
      try {
        await caps.db.doc(`estimates/${e.ownerId}/list/${e.id}`).update({ actualPrice: val == null ? { __delete__: true } : val, actualAt: Date.now() });
        const upd = (rows) => rows && rows.map((x) => (x.id === e.id ? { ...x, actualPrice: val ?? undefined } : x));
        setMine(upd); setOthers(upd);
        ctx.say(val == null ? "Skutočná cena je odstránená" : "Skutočná cena je uložená");
      } catch (x) { ctx.say("Skutočnú cenu sa nepodarilo uložiť."); }
    }
    const dev = (e) => (e.actualPrice && e.summary?.estimate ? ((e.summary.estimate - e.actualPrice) / e.actualPrice) * 100 : null);
    const acc = (() => {
      const d = shown.map(dev).filter((x) => x != null);
      if (!d.length) return null;
      const a = d.map(Math.abs).sort((x, y) => x - y);
      return { n: d.length, median: a[Math.floor(a.length / 2)], within3: a.filter((x) => x <= 3).length / a.length * 100, within5: a.filter((x) => x <= 5).length / a.length * 100, bias: d.reduce((x, y) => x + y, 0) / d.length };
    })();
    async function remove(e) {
      if (e.ownerId !== caps.uid) return;
      try { await caps.db.doc(`estimates/${caps.uid}/list/${e.id}`).delete(); ctx.say("Prepočet je odstránený"); } catch (x) { ctx.say("Prepočet sa nepodarilo odstrániť."); }
    }
    return html`
      <div class="page-head"><div><h1>Prepočty</h1><p>Uložené odborné cenové odhady. Kliknutím prepočet otvoríte, upravíte alebo exportujete do PDF.</p></div>
        <div class="row">${caps.admin ? html`<${Seg} value=${scope} options=${[["mine", "Moje"], ["all", "Všetci obchodníci"]]} onChange=${setScope} />` : null}<button class="btn primary" onClick=${onNew}><${Icon} name="plus" />Nový prepočet</button></div></div>
      ${scope === "all" && profiles.length ? html`<div class="row"><select class="input" style="max-width:280px" value=${rep} onChange=${(e) => setRep(e.target.value)}><option value="">Všetci obchodníci</option>${profiles.map((p) => html`<option value=${p.id}>${p.name || p.email || "Bez mena"}</option>`)}</select></div>` : null}
      <div class="card accuracy"><div class="card-head"><div><h2>Presnosť odhadov</h2><div class="sub">Porovnanie odhadu domu (s DPH, bez prípojok) so skutočnou cenou z rozpočtu. Skutočnú cenu zapíšte k prepočtu, keď je rozpočet hotový.</div></div></div>
        ${acc ? html`<div class="mini-grid">
          <div class="stat"><b>${acc.n}</b><span>prepočtov so skutočnou cenou</span></div>
          <div class="stat"><b>${fmtNum(acc.median, 1)} %</b><span>typická odchýlka (medián)</span></div>
          <div class="stat"><b>${fmtNum(acc.within3, 0)} %</b><span>odhadov do ±3 %</span></div>
          <div class="stat"><b>${fmtNum(acc.within5, 0)} %</b><span>odhadov do ±5 %</span></div>
          <div class="stat"><b>${acc.bias > 0 ? "+" : ""}${fmtNum(acc.bias, 1)} %</b><span>${acc.bias > 0 ? "odhady sú v priemere vyššie" : "odhady sú v priemere nižšie"}</span></div>
        </div>` : html`<div class="card-pad muted">Zatiaľ žiadny prepočet so skutočnou cenou. Zapíšte ju do stĺpca „Skutočná cena“ v tabuľke nižšie.</div>`}
      </div>
      <div class="card">
        ${rows === null ? html`<div class="empty"><div class="spinner"></div></div>` : shown.length === 0 ? html`<div class="empty"><h3>Zatiaľ žiadne prepočty</h3><p>Začnite nahratím štúdie klienta.</p><button class="btn primary" onClick=${onNew}>Nový prepočet</button></div>` : html`<div class="table-wrap"><table class="t">
          <thead><tr><th>Klient</th><th>Východiskový dom</th><th class="num">Cena domu</th><th class="num">Odhad</th><th class="num">Zmena</th><th class="num">Skutočná cena</th><th class="num">Odchýlka</th><th>Obchodník</th><th>Dátum</th><th></th></tr></thead>
          <tbody>${shown.map((e) => html`<tr class="click" onClick=${() => onOpen(e)}>
            <td><b>${e.clientName || "Bez mena"}</b>${e.clientNote ? html`<div class="faint small">${e.clientNote.slice(0, 60)}</div>` : null}</td>
            <td>${e.baseHouseName || "–"}</td>
            <td class="num">${fmtEur(e.summary?.basePrice)}</td>
            <td class="num"><b>${fmtEur(e.summary?.estimate)}</b></td>
            <td class="num">${e.summary ? html`<${Pill} pct=${e.summary.changePct} />` : "–"}</td>
            <td class="num" onClick=${(x) => x.stopPropagation()}>${canEditRow(e) ? html`<div style="width:120px;margin-left:auto"><${NumInput} cls="actual" value=${e.actualPrice} placeholder="z rozpočtu" onCommit=${(v) => setActual(e, v)} /></div>` : e.actualPrice ? fmtEur(e.actualPrice) : "–"}</td>
            <td class="num">${dev(e) == null ? "–" : html`<span class=${"pill " + (Math.abs(dev(e)) <= 3 ? "down" : Math.abs(dev(e)) <= 5 ? "flat" : "up")}>${dev(e) > 0 ? "+" : ""}${fmtNum(dev(e), 1)} %</span>`}</td>
            <td>${e.ownerName || "–"}</td>
            <td>${fmtDate(e.updatedAt)}</td>
            <td class="num">${e.ownerId === caps.uid ? html`<button class="btn plain sm" title="Odstrániť" onClick=${(x) => { x.stopPropagation(); remove(e); }}><${Icon} name="trash" /></button>` : null}</td>
          </tr>`)}</tbody></table></div>`}
      </div>`;
  }

  // ---------- Catalog ----------
  function Catalog({ ctx, onUse }) {
    const [q, setQ] = useState("");
    const [kind, setKind] = useState("");
    const [roof, setRoof] = useState("");
    const [pu, setPu] = useState([null, null]);
    const [sort, setSort] = useState("name");
    const [sel, setSel] = useState(null);
    const [limit, setLimit] = useState(60);
    const list = useMemo(() => {
      let l = ctx.houses.filter((h) => (!q || L.norm(h.name).includes(L.norm(q))) && (!kind || String(h.kind) === kind) && (!roof || String(h.roof) === roof) && (pu[0] == null || h.pu >= pu[0]) && (pu[1] == null || h.pu <= pu[1]));
      const cmp = { name: (a, b) => a.name.localeCompare(b.name, "sk", { numeric: true }), price: (a, b) => a.price - b.price, area: (a, b) => a.pu - b.pu }[sort];
      return l.sort(cmp);
    }, [q, kind, roof, pu, sort]);
    return html`
      <div class="page-head"><div><h1>Katalóg domov</h1><p>${ctx.houses.length} domov z ekonomicke-stavby.sk s cenami v štandarde a holodome (s DPH). Aktualizované 22.10.2026.</p></div></div>
      <div class="card card-pad row" style="gap:12px">
        <input class="input" style="max-width:240px" placeholder="Hľadať dom…" value=${q} onInput=${(e) => { setQ(e.target.value); setLimit(60); }} />
        <select class="input" style="max-width:180px" value=${kind} onChange=${(e) => setKind(e.target.value)}><option value="">Všetky typy</option><option value="2">Bungalov</option><option value="1">S podkrovím</option><option value="3">Poschodový</option></select>
        <select class="input" style="max-width:160px" value=${roof} onChange=${(e) => setRoof(e.target.value)}><option value="">Každá strecha</option><option value="2">Sedlová</option><option value="1">Valbová</option><option value="3">Plochá</option></select>
        <div class="row" style="gap:6px"><span class="muted small">Plocha</span><div style="width:80px"><${NumInput} value=${pu[0]} placeholder="od" onChange=${(v) => setPu([v ?? null, pu[1]])} /></div><div style="width:80px"><${NumInput} value=${pu[1]} placeholder="do" onChange=${(v) => setPu([pu[0], v ?? null])} /></div><span class="muted small">m²</span></div>
        <div class="grow"></div>
        <${Seg} value=${sort} options=${[["name", "Názov"], ["price", "Cena"], ["area", "Plocha"]]} onChange=${setSort} />
      </div>
      <div class="muted small">${list.length} domov</div>
      <div class="cat-grid">${list.slice(0, limit).map((h) => html`<button class="house" onClick=${() => setSel(h)}>
        <div class="plan"><${HouseImg} h=${h} /></div>
        <div><h3>${h.name}</h3><div class="muted small">${h.disp} · ${fmtNum(h.pu, 1)} m²</div></div>
        <div class="meta"><span class="badge">${L.FLOORS_LABEL[L.KIND[h.kind]]}</span><span class="badge">${L.ROOF_LABEL[L.ROOF[h.roof]]}</span></div>
        <div class="price">${fmtEur(h.price)} <span class="faint small" style="font-weight:500">· holodom ${fmtEur(h.hol)}</span></div>
      </button>`)}</div>
      ${list.length > limit ? html`<div class="row" style="justify-content:center"><button class="btn" onClick=${() => setLimit(limit + 60)}>Zobraziť ďalšie</button></div>` : null}
      ${sel ? html`<${Sheet} onClose=${() => setSel(null)}>
        <div class="card-head"><div><h2 style="font-size:20px">${sel.name}</h2><div class="sub">${sel.disp}</div></div><button class="btn plain sm" onClick=${() => setSel(null)}><${Icon} name="x" /></button></div>
        <div class="card-pad" style="display:flex;flex-direction:column;gap:16px">
          <div class="plan house-thumb" style="height:260px"><${HouseImg} h=${sel} /></div>
          <div class="group">
            ${[["Cena štandard (s DPH)", fmtEur(sel.price)], ["Cena holodom (s DPH)", fmtEur(sel.hol)], ["Úžitková plocha", fmtNum(sel.pu, 2) + " m²"], ["Zastavaná plocha", fmtNum(sel.pz, 2) + " m²"], ["Rozmery", sel.w ? `${fmtNum(sel.w, 2)} × ${fmtNum(sel.l, 2)} m` : "–"], ["Typ domu", L.FLOORS_LABEL[L.KIND[sel.kind]]], ["Strecha", L.ROOF_LABEL[L.ROOF[sel.roof]]], ["Izby / kúpeľne / garáž", `${sel.rooms ?? "–"} / ${sel.bath} / ${sel.gar}`]].map(([k, v]) => html`<div class="group-row"><div class="lbl">${k}</div><div class="num">${v}</div></div>`)}
          </div>
          <div><div class="section-title" style="margin-bottom:8px">Príplatky z konfigurátora (s DPH)</div><div class="group">${ctx.houseCfg.accessories.map((a) => html`<div class="group-row"><div class="lbl">${a.title}</div><div class="num">${fmtEur(a.price)}</div></div>`)}</div></div>
          <div class="row" style="justify-content:space-between"><a class="btn" href=${L.houseUrl(sel)} target="_blank" rel="noopener"><${Icon} name="ext" />Otvoriť na webe</a><button class="btn primary" onClick=${() => { onUse(sel); setSel(null); }}>Použiť ako východiskový dom</button></div>
        </div>
      <//>` : null}`;
  }

  // ---------- Price list ----------
  function PriceList({ ctx }) {
    const admin = ctx.caps.admin;
    const cats = ctx.priceList.categories || {};
    const [cat, setCat] = useState("A2");
    const [q, setQ] = useState("");
    const [onlyFlag, setOnlyFlag] = useState(false);
    const [edit, setEdit] = useState(null);
    const [imp, setImp] = useState(null);
    const fileRef = useRef();
    const items = useMemo(() => Object.values(ctx.prices).filter((it) => (q ? L.norm(it.name + " " + (it.specification || "") + " " + it.path_code).includes(L.norm(q)) : it.cat === cat) && (!onlyFlag || it.check_level === "CHYBA" || it.check_level === "OVERIŤ")).sort((a, b) => a.row - b.row), [ctx.prices, cat, q, onlyFlag]);
    const flagged = useMemo(() => Object.values(ctx.prices).filter((i) => i.check_level === "CHYBA").length, [ctx.prices]);

    async function saveEdit() {
      const o = { ...(ctx.config.priceOverrides || {}) };
      o[edit.path] = L.clean({ mat: parseNum(edit.mat) ?? null, lab: parseNum(edit.lab) ?? null, mech: parseNum(edit.mech) ?? null, fix: parseNum(edit.fix) ?? null, hidden: edit.hidden || undefined, by: ctx.profile?.name || "", at: Date.now() });
      try { await setConfig(ctx, { priceOverrides: o }); ctx.say("Cena je upravená"); setEdit(null); } catch (e) { ctx.say("Úpravu sa nepodarilo uložiť."); }
    }
    async function resetEdit() {
      const o = { ...(ctx.config.priceOverrides || {}) };
      delete o[edit.path];
      try { await setConfig(ctx, { priceOverrides: o }, true); ctx.say("Pôvodná cena je obnovená"); setEdit(null); } catch (e) { ctx.say("Nepodarilo sa obnoviť."); }
    }
    async function onFile(f) {
      try {
        const parsed = L.parsePriceListXlsx(await f.arrayBuffer(), f.name);
        setImp({ parsed, diff: L.diffPriceLists(ctx.priceList, parsed), name: f.name });
      } catch (e) { ctx.say(e.message || "Súbor sa nepodarilo načítať."); }
    }
    async function confirmImport() {
      if (!ctx.caps.assets) { ctx.say("Nahrávanie súborov nie je dostupné."); return; }
      try {
        const blob = new Blob([JSON.stringify(imp.parsed)], { type: "application/json" });
        const a = await ctx.caps.assets.upload(blob);
        await setConfig(ctx, { priceList: { assetId: a.id, name: imp.name, importedAt: Date.now(), count: imp.parsed.items.length, by: ctx.profile?.name || "" } });
        setImp(null); ctx.say("Nový číselník je aktívny");
      } catch (e) { ctx.say("Import sa nepodarilo dokončiť."); }
    }
    const val = (it) => (it.price_material || 0) + (it.price_labor || 0) + (it.price_machinery || 0);
    return html`
      <div class="page-head"><div><h1>Číselník</h1><p>Aktívna verzia: <b>${ctx.config.priceList?.name || ctx.priceList.version}</b> · ${Object.keys(ctx.prices).length} položiek · ${flagged} položiek s chybou z kontroly. Ceny sú náklady bez DPH.</p></div>
        ${admin ? html`<div class="row"><input ref=${fileRef} type="file" accept=".xlsx,.xls" hidden onChange=${(e) => { e.target.files[0] && onFile(e.target.files[0]); e.target.value = ""; }} /><button class="btn tinted" onClick=${() => fileRef.current.click()}><${Icon} name="upload" />Nahrať nový číselník (.xlsx)</button></div>` : null}</div>
      <div class="card card-pad row" style="gap:12px">
        <select class="input" style="max-width:340px" value=${cat} onChange=${(e) => { setCat(e.target.value); setQ(""); }}>${Object.entries(cats).map(([k, v]) => html`<option value=${k}>${k} – ${v}</option>`)}</select>
        <input class="input" style="max-width:280px" placeholder="Hľadať v celom číselníku…" value=${q} onInput=${(e) => setQ(e.target.value)} />
        <label class="check"><input type="checkbox" checked=${onlyFlag} onChange=${(e) => setOnlyFlag(e.target.checked)} />Len položky s chybou alebo na overenie</label>
      </div>
      <div class="card"><div class="table-wrap" style="max-height:70vh;overflow:auto"><table class="t dense">
        <thead><tr><th>Kód</th><th>Názov</th><th>Jedn.</th><th class="num">Materiál</th><th class="num">Práca</th><th class="num">Mech.</th><th class="num">Spolu/j</th><th>Stav</th></tr></thead>
        <tbody>${items.slice(0, 600).map((it) => html`<tr class=${admin ? "click" : ""} onClick=${() => admin && setEdit({ path: it.path_code, name: it.name, mat: it.price_material, lab: it.price_labor, mech: it.price_machinery, fix: it.fixed_rate, hidden: it.is_hidden, note: it.note })}>
          <td class="small faint" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title=${it.path_code}>${it.path_code}</td>
          <td>${it.name}${it.specification ? html`<div class="faint small">${it.specification}</div>` : null}</td>
          <td>${it.unit}</td>
          <td class="num">${it.price_material == null ? "–" : fmtNum(it.price_material, 2)}</td>
          <td class="num">${it.price_labor == null ? "–" : fmtNum(it.price_labor, 2)}</td>
          <td class="num">${it.price_machinery == null ? "–" : fmtNum(it.price_machinery, 2)}</td>
          <td class="num"><b>${fmtNum(val(it), 2)}</b></td>
          <td><div class="row" style="gap:4px">${it.premium ? html`<span class="badge">nadštandard</span>` : null}${it.check_level ? html`<span class=${"badge " + it.check_level} title=${it.note || ""}>${it.check_level}</span>` : null}${it.edited ? html`<span class="badge accent">upravené</span>` : null}${it.is_hidden ? html`<span class="badge">skryté</span>` : null}</div></td>
        </tr>`)}</tbody></table></div>
        ${items.length > 600 ? html`<div class="card-pad faint small">Zobrazených prvých 600 z ${items.length} – spresnite vyhľadávanie.</div>` : null}
      </div>
      ${edit ? html`<${Sheet} onClose=${() => setEdit(null)}>
        <div class="card-head"><div><h2>${edit.name}</h2><div class="sub">${edit.path}</div></div></div>
        <div class="card-pad" style="display:flex;flex-direction:column;gap:14px">
          ${edit.note ? html`<div class="notice"><div>${edit.note}</div></div>` : null}
          <div class="grid-2">
            <div class="field"><label>Materiál €/j</label><${NumInput} value=${edit.mat} onChange=${(v) => setEdit({ ...edit, mat: v })} /></div>
            <div class="field"><label>Práca €/j</label><${NumInput} value=${edit.lab} onChange=${(v) => setEdit({ ...edit, lab: v })} /></div>
            <div class="field"><label>Mechanizmy €/j</label><${NumInput} value=${edit.mech} onChange=${(v) => setEdit({ ...edit, mech: v })} /></div>
            <div class="field"><label>Pevná sadzba € (raz za položku)</label><${NumInput} value=${edit.fix} onChange=${(v) => setEdit({ ...edit, fix: v })} /></div>
          </div>
          <label class="check"><input type="checkbox" checked=${!!edit.hidden} onChange=${(e) => setEdit({ ...edit, hidden: e.target.checked })} />Nepoužívať v prepočtoch (skryť)</label>
          <div class="row" style="justify-content:space-between"><button class="btn plain" onClick=${resetEdit}>Obnoviť pôvodnú cenu</button><div class="row"><button class="btn" onClick=${() => setEdit(null)}>Zrušiť</button><button class="btn primary" onClick=${saveEdit}>Uložiť</button></div></div>
        </div>
      <//>` : null}
      ${imp ? html`<${Sheet} onClose=${() => setImp(null)}>
        <div class="card-head"><h2>Nový číselník: ${imp.name}</h2></div>
        <div class="card-pad" style="display:flex;flex-direction:column;gap:14px">
          <div class="group">${[["Položiek spolu", imp.diff.total], ["Nové položky", imp.diff.added], ["Zmenené ceny", imp.diff.changed], ["Bez zmeny", imp.diff.same], ["Odstránené", imp.diff.removed]].map(([k, v]) => html`<div class="group-row"><div class="lbl">${k}</div><div class="num">${fmtNum(v)}</div></div>`)}</div>
          <p class="muted" style="margin:0">Po potvrdení sa nový číselník stane aktívnym pre všetkých obchodníkov. Ručné úpravy cien zostanú zachované.</p>
          <div class="row" style="justify-content:flex-end"><button class="btn" onClick=${() => setImp(null)}>Zrušiť</button><button class="btn primary" onClick=${confirmImport}>Aktivovať číselník</button></div>
        </div>
      <//>` : null}`;
  }

  async function setConfig(ctx, patch, replaceKeys) {
    const db = ctx.caps.db;
    if (!db) throw new Error("no db");
    const ref = db.doc("config/app");
    const snap = await ref.get();
    const cur = snap.exists ? snap.data() : {};
    const next = { ...L.clone(cur), ...patch };
    await ref.set(next);
  }

  // ---------- Settings ----------
  function Settings({ ctx }) {
    const admin = ctx.caps.admin;
    const [tab, setTab] = useState("profile");
    const tabs = [["profile", "Profil"], ...(admin ? [["company", "Firma"], ["calc", "Výpočet"], ["users", "Používatelia"]] : [])];
    return html`
      <div class="page-head"><div><h1>Nastavenia</h1><p>${admin ? "Ako administrátor upravujete aj údaje firmy, výpočtové sadzby a štandard." : "Vaše údaje sa zobrazujú v PDF odhadoch ako kontakt obchodníka."}</p></div><${Seg} value=${tab} options=${tabs} onChange=${setTab} /></div>
      ${tab === "profile" ? html`<${ProfileTab} ctx=${ctx} />` : null}
      ${tab === "company" ? html`<${CompanyTab} ctx=${ctx} />` : null}
      ${tab === "calc" ? html`<${CalcTab} ctx=${ctx} />` : null}
      ${tab === "users" ? html`<${UsersTab} ctx=${ctx} />` : null}`;
  }

  function ProfileTab({ ctx }) {
    const caps = ctx.caps;
    const [p, setP] = useState(() => ({ name: "", username: "", email: "", phone: "", title: "obchodník", ...(ctx.profile || {}) }));
    useEffect(() => { if (ctx.profile) setP((x) => ({ ...x, ...ctx.profile })); }, [ctx.profile && ctx.profile.updatedAt, ctx.profile && ctx.profile.createdAt]);
    async function save() {
      if (!caps.db || !caps.uid) { ctx.say("Profil sa dá uložiť len v aplikácii otvorenej v Claude."); return; }
      try { await caps.db.doc("profiles/" + caps.uid).set({ ...L.clean(p), updatedAt: Date.now() }); ctx.say("Profil je uložený"); } catch (e) { ctx.say("Profil sa nepodarilo uložiť."); }
    }
    const F = (k, label, ph, type = "text") => html`<div class="group-row"><label class="lbl" for=${"p-" + k}>${label}</label><input id=${"p-" + k} type=${type} class="input" value=${p[k] || ""} placeholder=${ph} onInput=${(e) => setP({ ...p, [k]: e.target.value })} /></div>`;
    return html`
      <div class="card card-pad row" style="gap:16px"><div class="avatar" style="width:56px;height:56px;font-size:18px">${(p.name || "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()}</div>
        <div class="grow"><b style="font-size:17px">${p.name || "Vaše meno"}</b><div class="muted">${p.username ? "@" + p.username + " · " : ""}${caps.me?.email || p.email || ""}</div></div></div>
      <div class="group">
        ${F("name", "Meno a priezvisko", "Ján Novák")}
        ${F("username", "Používateľské meno", "jnovak")}
        ${F("email", "E-mail do PDF", "jan.novak@ekonomicke-stavby.sk", "email")}
        ${F("phone", "Telefón do PDF", "+421 900 000 000", "tel")}
        ${F("title", "Funkcia", "obchodník")}
      </div>
      ${window.ESServer ? null : html`<p class="faint small" style="margin:0 4px">Prihlasujete sa svojím Claude účtom (${caps.me?.email || "e-mail účtu"}). Heslo a prihlásenie spravuje Claude – v aplikácii sa samostatné heslo nenastavuje.</p>`}
      <div class="row" style="justify-content:flex-end"><button class="btn primary" onClick=${save}>Uložiť profil</button></div>
      ${window.ESServer ? html`<${PasswordCard} ctx=${ctx} />` : null}`;
  }

  function CompanyTab({ ctx }) {
    const [c, setC] = useState(() => ({ name: "Ekonomické stavby s.r.o.", address: "", phone: "", email: "", web: "www.ekonomicke-stavby.sk", disclaimer: "", ...(ctx.config.company || {}) }));
    const [busy, setBusy] = useState(false);
    const fileRef = useRef();
    async function save(next) {
      try { await setConfig(ctx, { company: L.clean(next || c) }); ctx.say("Údaje firmy sú uložené"); } catch (e) { ctx.say("Nepodarilo sa uložiť."); }
    }
    async function uploadLogo(f) {
      if (!/image\/(png|jpeg)/.test(f.type)) { ctx.say("Logo nahrajte ako PNG alebo JPG."); return; }
      if (!ctx.caps.assets) { ctx.say("Nahrávanie súborov nie je dostupné."); return; }
      setBusy(true);
      try { const a = await ctx.caps.assets.upload(f); const next = { ...c, logoAssetId: a.id }; setC(next); await save(next); } catch (e) { ctx.say("Logo sa nepodarilo nahrať."); }
      setBusy(false);
    }
    const F = (k, label, ph) => html`<div class="group-row"><label class="lbl" for=${"c-" + k}>${label}</label><input id=${"c-" + k} class="input" value=${c[k] || ""} placeholder=${ph} onInput=${(e) => setC({ ...c, [k]: e.target.value })} /></div>`;
    return html`
      <div class="card card-pad row" style="gap:16px">
        <div class="brand-mark" style="width:64px;height:64px;font-size:18px;border-radius:14px">${c.logoAssetId ? html`<img src=${"/_blob/" + c.logoAssetId} alt="Logo" />` : html`<svg viewBox="70 80 380 190" aria-hidden="true"><use href="#es-logo" /></svg>`}</div>
        <div class="grow"><b>Logo do PDF a aplikácie</b><div class="muted small">PNG alebo JPG, ideálne na bielom pozadí, šírka aspoň 600 px.</div></div>
        <input ref=${fileRef} type="file" accept="image/png,image/jpeg" hidden onChange=${(e) => { e.target.files[0] && uploadLogo(e.target.files[0]); e.target.value = ""; }} />
        <button class="btn tinted" disabled=${busy} onClick=${() => fileRef.current.click()}>${busy ? html`<span class="spinner"></span>` : null}Nahrať logo</button>
      </div>
      <div class="group">${F("name", "Názov firmy", "Ekonomické stavby s.r.o.")}${F("address", "Adresa", "Pohraničná …, Štitáre")}${F("phone", "Telefón", "+421 …")}${F("email", "E-mail", "info@…")}${F("web", "Web", "www.ekonomicke-stavby.sk")}
        <div class="group-row"><label class="lbl" for="c-disc">Upozornenie v PDF</label><textarea id="c-disc" class="input" placeholder="Odborný cenový odhad je orientačný…" onInput=${(e) => setC({ ...c, disclaimer: e.target.value })}>${c.disclaimer || ""}</textarea></div>
      </div>
      <div class="row" style="justify-content:flex-end"><button class="btn primary" onClick=${() => save()}>Uložiť údaje firmy</button></div>`;
  }

  function CalcTab({ ctx }) {
    const s = ctx.settings;
    const [e, setE] = useState(() => L.clone({ vatRate: s.vatRate, markup: s.markup, markupShell: s.markupShell, optimizationThresholdPct: s.optimizationThresholdPct, accuracyBandPct: s.accuracyBandPct, defaults: s.defaults, rates: s.rates, standardSpec: s.standardSpec, standardFoundation: s.standardFoundation, standardOpenings: s.standardOpenings, standardText: s.standardText, sizeOverhead: s.sizeOverhead || { weight: 0, usableShare: 0.5 }, outdoorRates: s.outdoorRates, outdoorRules: s.outdoorRules }));
    const TEXT_LABELS = [["zalozenie", "Založenie"], ["murivo", "Murivo"], ["priecky", "Priečky"], ["strop_bungalov", "Strop – bungalov"], ["strop_poschodovy", "Strop – poschodový"], ["strop_podkrovie", "Strop – s podkrovím"], ["krov_bungalov", "Krov – bungalov"], ["krov", "Krov – podkrovie/poschodový"], ["krytina", "Strecha a krytina"], ["zateplenie", "Zateplenie"], ["okna", "Okná"], ["dvere_vchodove", "Vchodové dvere"], ["dvere_vnutorne", "Vnútorné dvere"], ["garaz", "Garážová brána"], ["kurenie", "Kúrenie"], ["rekuperacia", "Rekuperácia"], ["elektro", "Elektroinštalácia"], ["zti", "Voda a kanalizácia"], ["podlahy", "Podlahy"], ["kupelne", "Kúpeľne"], ["schodisko", "Schodisko"], ["hromozvod", "Hromozvod"], ["mimo", "Nie je v štandarde"]];
    async function save() { try { await setConfig(ctx, { engine: { ...(ctx.config.engine || {}), ...e } }); ctx.say("Nastavenia výpočtu sú uložené"); } catch (x) { ctx.say("Nepodarilo sa uložiť."); } }
    async function restore() {
      try { await setConfig(ctx, { engine: {} }, ["engine"]); setE(L.clone({ ...E.DEFAULT_ENGINE_SETTINGS, sizeOverhead: E.DEFAULT_ENGINE_SETTINGS.sizeOverhead })); ctx.say("Obnovené predvolené nastavenia výpočtu"); } catch (x) { ctx.say("Nepodarilo sa obnoviť."); }
    }
    const N = (path, label, hint) => {
      const [a, b] = path.split(".");
      const v = b ? e[a][b] : e[a];
      return html`<div class="group-row"><div class="lbl">${label}${hint ? html`<div class="faint small" style="font-weight:400">${hint}</div>` : null}</div><div style="max-width:160px"><${NumInput} value=${v} onChange=${(x) => setE(b ? { ...e, [a]: { ...e[a], [b]: x } } : { ...e, [a]: x })} /></div></div>`;
    };
    const roles = ["wall", "interiorWall", "partition", "facade", "roofInsulation", "floorInsulation", "roofing", "flatRoofing", "window"];
    return html`
      <div class="notice info"><div><b>Tu sa ladí presnosť výpočtu.</b> Každá zmena platí pre nové prepočty hneď po uložení; uložené prepočty sa prepočítajú, keď ich otvoríte. Štandard ES je podľa sprievodcu VOTP_SK.03_26, prirážky a sadzby podľa 7 rozpočtov ES (RP1–RP8, cenové úrovne 260323–260504). Presnosť sledujte v Prepočty → Skutočná cena z rozpočtu.</div></div>
      <div class="section-title">Ceny a prirážky</div>
      <div class="group">${N("vatRate", "Sadzba DPH", "0,23 = 23 %")}${N("markupShell", "Prirážka – hrubá uzatvorená stavba", "násobok nákladov z číselníka (základy, murivo, strecha, okná, vchodové dvere), napr. 1,6")}${N("markup", "Prirážka – ostatné položky", "presun hmôt + GZS + zisk a réžia, napr. 1,08")}${N("optimizationThresholdPct", "Prah pre optimalizáciu (%)")}${N("accuracyBandPct", "Základné rozpätie odhadu (± %)")}</div>
      <div class="section-title">Predvolené rozmery</div>
      <div class="group">${N("defaults.storeyHeightM", "Konštrukčná výška podlažia (m)")}${N("defaults.kneeWallM", "Nadmurovka (m)")}${N("defaults.roofPitchBungalowDeg", "Sklon strechy – bungalov (°)")}${N("defaults.roofPitchDeg", "Sklon strechy – poschodový (°)")}${N("defaults.roofPitchAtticDeg", "Sklon strechy – s podkrovím (°)")}${N("defaults.roofOverhangM", "Presah strechy (m)")}
        ${N("standardOpenings.windowSharePct", "Plocha okien a balk. dverí (% úžitkovej plochy)")}${N("standardOpenings.interiorDoorPerM2", "Vnútorné dvere – 1 ks na m² úžitkovej plochy")}${N("standardOpenings.balconyPerM2", "Balkónové dvere – 1 ks na m² úžitkovej plochy")}</div>
      <div class="section-title">Štandardné založenie</div>
      <div class="group">${N("standardFoundation.dtRows", "Počet radov DT tvárnic")}${N("standardFoundation.dtThicknessMm", "Hrúbka DT (mm)")}${N("standardFoundation.dtRowHeightMm", "Výška radu DT (mm)")}${N("standardFoundation.stripWidthM", "Šírka pätky (m)")}${N("standardFoundation.stripDepthM", "Výška pätky (m)")}${N("standardFoundation.slabThicknessM", "Hrúbka dosky (m)")}${N("standardFoundation.gravelThicknessM", "Štrkový podsyp (m)")}</div>
      <div class="section-title">Sadzby pre položky bez ceny v číselníku (náklad bez DPH)</div>
      <div class="group">
        ${N("rates.electroBase", "Elektroinštalácia – základ €", "paušál na dom")}${N("rates.electroPerM2", "Elektroinštalácia €/m² úžitkovej plochy")}
        ${N("rates.plumbingBase", "Rozvody vody a kanalizácie – základ €")}${N("rates.plumbingPerBathroom", "Rozvody € navyše na kúpeľňu")}${N("rates.plumbingPerWc", "Rozvody € navyše na samostatné WC")}
        ${N("rates.heatingDistributionBase", "Rozvod ÚK – základ €")}${N("rates.heatingDistributionPerM2", "Rozvod ÚK €/m²")}${N("rates.floorHeatingAreaFactor", "Podlahové kúrenie – podiel podlahovej plochy", "1 = celá úžitková plocha")}${N("rates.radiatorsPerM2", "Radiátory €/m²")}
        ${N("rates.recuperationUnit", "Decentrálna rekuperačná jednotka € / ks", "4 ks bungalov, 6 ks dvojpodlažný dom")}${N("rates.centralRecuperationPerM2", "Príplatok za centrálnu rekuperáciu €/m²")}${N("rates.electricHeatingSaving", "Úspora elektrokúrenia oproti plynu €")}
        ${N("rates.scaffoldingFactor", "Lešenie – podiel plochy fasády", "napr. 0,55")}${N("rates.slidingFactor", "Posuvné dvere HS – násobok ceny okna za m²")}${N("rates.hsPortalPerM2", "HS portál €/m²")}${N("rates.blindsPerM2", "Vonkajšie žalúzie €/m²")}${N("rates.kitchenStandard", "Kuchynská linka – štandard € (náklad)")}
      </div>
      <div class="section-title">Réžia, doprava a zisk pri zmene veľkosti domu</div>
      <div class="group">${N("sizeOverhead.weight", "Koľko z nemodelovanej časti ceny sa mení s veľkosťou", "0 = nemení sa, 1 = úplne; nastavené 0,75 podľa verzií katalógových domov")}${N("sizeOverhead.usableShare", "Váha úžitkovej plochy oproti zastavanej", "0,5 = rovnako")}</div>
      <div class="section-title">Vonkajšie zariadenie a prípojky – rekapitulácia</div>
      <div class="group">${N("outdoorRates.presunHmot", "Presun hmôt", "0,02 = 2 %")}${N("outdoorRates.gzs", "GZS", "0,035 = 3,5 %")}${N("outdoorRates.ziskRezia", "Zisk a réžia", "0,04 = 4 %")}${N("outdoorRules.curbFactor", "Obrubník – násobok √plochy", "3 = tri strany štvorca")}${N("outdoorRules.gravelM3PerM2", "Štrkové lôžko m³ na m² dlažby")}</div>
      <div class="section-title">Štandard ES – materiály východiskových domov</div>
      <div class="group">${roles.map((r) => html`<div class="group-row"><div class="lbl">${L.ROLE[r].label}</div><${MaterialSelect} ctx=${ctx} role=${r} value=${e.standardSpec[r]} onChange=${(v) => v && setE({ ...e, standardSpec: { ...e.standardSpec, [r]: v } })} /></div>`)}
        <div class="group-row"><div class="lbl">Zateplenie strechy – 2. vrstva</div><select class="input" value=${e.standardSpec.roofInsulation2 || ""} onChange=${(x) => setE({ ...e, standardSpec: { ...e.standardSpec, roofInsulation2: x.target.value } })}><option value="">bez 2. vrstvy</option>${L.roleItems(ctx.prices, "roofInsulation").map((it) => html`<option value=${it.path_code}>${E.itemLabel(it)}</option>`)}</select></div>
        <div class="group-row"><div class="lbl">Hrúbka izolácie podlahy (m)</div><div style="max-width:160px"><${NumInput} value=${e.standardSpec.floorInsulationThicknessM} onChange=${(x) => setE({ ...e, standardSpec: { ...e.standardSpec, floorInsulationThicknessM: x } })} /></div></div></div>
      <div class="section-title">Popis štandardu (ľavý stĺpec pri prepočte)</div>
      <div class="group">${TEXT_LABELS.map(([k, l]) => html`<div class="group-row"><label class="lbl" for=${"st-" + k}>${l}</label><textarea id=${"st-" + k} class="input" rows="2" onInput=${(x) => setE({ ...e, standardText: { ...e.standardText, [k]: x.target.value } })}>${e.standardText[k] || ""}</textarea></div>`)}</div>
      <div class="row" style="justify-content:space-between"><button class="btn" onClick=${restore}>Obnoviť predvolené</button><button class="btn primary" onClick=${save}>Uložiť nastavenia výpočtu</button></div>`;
  }

  /** Zmena hesla (len samostatná webová aplikácia). */
  function PasswordCard({ ctx }) {
    const [f, setF] = useState({ cur: "", next: "", again: "" });
    const [busy, setBusy] = useState(false);
    async function go() {
      if (f.next.length < 8) { ctx.say("Nové heslo musí mať aspoň 8 znakov."); return; }
      if (f.next !== f.again) { ctx.say("Nové heslá sa nezhodujú."); return; }
      setBusy(true);
      try { await window.ESServer.changePassword(f.cur, f.next); setF({ cur: "", next: "", again: "" }); ctx.say("Heslo je zmenené"); } catch (e) { ctx.say(e.message || "Heslo sa nepodarilo zmeniť."); }
      setBusy(false);
    }
    const P = (k, id, label, ac) => html`<div class="group-row"><label class="lbl" for=${id}>${label}</label><input id=${id} type="password" autocomplete=${ac} class="input" value=${f[k]} onInput=${(e) => setF({ ...f, [k]: e.target.value })} /></div>`;
    return html`<div class="section-title">Zmena hesla</div>
      <div class="group">${P("cur", "pw-cur", "Súčasné heslo", "current-password")}${P("next", "pw-next", "Nové heslo (aspoň 8 znakov)", "new-password")}${P("again", "pw-again", "Nové heslo ešte raz", "new-password")}</div>
      <div class="row" style="justify-content:flex-end"><button class="btn" disabled=${busy} onClick=${go}>Zmeniť heslo</button></div>`;
  }

  const tempPassword = () => { const a = "abcdefghjkmnpqrstuvwxyz23456789"; let s = ""; const r = crypto.getRandomValues(new Uint32Array(10)); r.forEach((x) => (s += a[x % a.length])); return s; };

  /** Správa používateľov v samostatnej webovej aplikácii: účty, roly, heslá, spotreba AI. */
  function ServerUsersTab({ ctx }) {
    const [list, setList] = useState(null);
    const [nu, setNu] = useState({ name: "", email: "", role: "sales", password: tempPassword() });
    const [shown, setShown] = useState(null); // { email, password } po vytvorení / resete
    const load = () => window.ESServer.users.list().then(setList).catch((e) => { ctx.say(e.message); setList([]); });
    useEffect(() => { load(); }, []);
    async function add() {
      try {
        await window.ESServer.users.create(nu);
        setShown({ email: nu.email, password: nu.password });
        setNu({ name: "", email: "", role: "sales", password: tempPassword() });
        load();
      } catch (e) { ctx.say(e.message); }
    }
    async function patch(u, p, msg) { try { await window.ESServer.users.update(u.id, p); if (msg) ctx.say(msg); load(); } catch (e) { ctx.say(e.message); } }
    async function reset(u) { const pw = tempPassword(); await patch(u, { password: pw }); setShown({ email: u.email, password: pw }); }
    const me = window.ESServer.me;
    const tok = (n) => (n >= 1e6 ? fmtNum(n / 1e6, 1) + " mil." : fmtNum(n / 1e3, 0) + " tis.");
    return html`
      <div class="notice info"><div><b>Obchodník</b> robí a ukladá prepočty a vidí katalóg. <b>Administrátor</b> navyše spravuje používateľov, údaje firmy, číselník a nastavenia výpočtu. Nový používateľ si pri prvom prihlásení zmení heslo.</div></div>
      ${shown ? html`<div class="notice"><div><b>Prihlasovacie údaje pre ${shown.email}</b><div style="margin-top:4px">Dočasné heslo: <code style="font-size:15px;user-select:all">${shown.password}</code></div><div class="small" style="margin-top:4px">Pošlite ich používateľovi. Heslo sa už nebude dať zobraziť znova; pri prvom prihlásení si ho zmení.</div></div><button class="btn plain sm" onClick=${() => setShown(null)}>Zavrieť</button></div>` : null}
      <div class="section-title">Pridať používateľa</div>
      <div class="card card-pad"><div class="mini-grid" style="padding:0">
        <div class="field"><label for="nu-name">Meno a priezvisko</label><input id="nu-name" class="input" value=${nu.name} onInput=${(e) => setNu({ ...nu, name: e.target.value })} /></div>
        <div class="field"><label for="nu-email">E-mail (prihlasovacie meno)</label><input id="nu-email" type="email" class="input" value=${nu.email} onInput=${(e) => setNu({ ...nu, email: e.target.value })} /></div>
        <div class="field"><label for="nu-role">Rola</label><select id="nu-role" class="input" value=${nu.role} onChange=${(e) => setNu({ ...nu, role: e.target.value })}><option value="sales">Obchodník</option><option value="admin">Administrátor</option></select></div>
        <div class="field"><label for="nu-pass">Dočasné heslo</label><input id="nu-pass" class="input" value=${nu.password} onInput=${(e) => setNu({ ...nu, password: e.target.value })} /></div>
      </div><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" onClick=${add}><${Icon} name="plus" />Pridať používateľa</button></div></div>
      <div class="section-title">Používatelia</div>
      <div class="card">${list === null ? html`<div class="empty"><div class="spinner"></div></div>` : html`<div class="table-wrap"><table class="t">
        <thead><tr><th>Meno</th><th>E-mail</th><th>Rola</th><th>Stav</th><th class="num">AI tento mesiac</th><th>Od</th><th></th></tr></thead>
        <tbody>${list.map((u) => html`<tr>
          <td><b>${u.name || "–"}</b>${u.id === me.id ? html` <span class="badge accent">vy</span>` : null}</td>
          <td>${u.email}</td>
          <td><select class="input" style="min-width:140px" value=${u.role} disabled=${u.id === me.id} onChange=${(e) => patch(u, { role: e.target.value }, "Rola je zmenená")}><option value="sales">Obchodník</option><option value="admin">Administrátor</option></select></td>
          <td>${u.active ? html`<span class="badge ok">aktívny</span>` : html`<span class="badge bad">vypnutý</span>`}${u.mustChange ? html` <span class="badge warn">čaká na zmenu hesla</span>` : null}</td>
          <td class="num">${u.aiThisMonth.calls ? html`${u.aiThisMonth.calls} volaní<div class="faint small">${tok(u.aiThisMonth.inputTokens)} / ${tok(u.aiThisMonth.outputTokens)} tokenov</div>` : "–"}</td>
          <td>${fmtDate(u.createdAt)}</td>
          <td class="num"><div class="row" style="justify-content:flex-end;gap:4px;flex-wrap:nowrap">
            <button class="btn plain sm" onClick=${() => reset(u)}>Nové heslo</button>
            ${u.id !== me.id ? html`<button class="btn plain sm" onClick=${() => patch(u, { active: !u.active }, u.active ? "Účet je vypnutý" : "Účet je zapnutý")}>${u.active ? "Vypnúť" : "Zapnúť"}</button>` : null}
          </div></td></tr>`)}</tbody></table></div>`}</div>`;
  }

  function UsersTab({ ctx }) {
    if (window.ESServer) return html`<${ServerUsersTab} ctx=${ctx} />`;
    const [list, setList] = useState(null);
    useEffect(() => { ctx.caps.db && ctx.caps.db.collection("profiles").get().then((s) => setList(s.docs.map((d) => ({ id: d.id, ...d.data() })))).catch(() => setList([])); }, []);
    return html`
      <div class="notice info"><div>Obchodníka pridáte tak, že mu aplikáciu nazdieľate v Claude s úrovňou <b>Contributor</b> (môže robiť a ukladať prepočty). Úroveň <b>Editor</b> dáva administrátorské práva (číselník, sadzby, údaje firmy).</div></div>
      <div class="card">${list === null ? html`<div class="empty"><div class="spinner"></div></div>` : html`<div class="table-wrap"><table class="t"><thead><tr><th>Meno</th><th>Používateľské meno</th><th>E-mail</th><th>Telefón</th><th>Funkcia</th><th>Od</th></tr></thead>
        <tbody>${list.map((p) => html`<tr><td><b>${p.name || "–"}</b></td><td>${p.username ? "@" + p.username : "–"}</td><td>${p.email || "–"}</td><td>${p.phone || "–"}</td><td>${p.title || "–"}</td><td>${fmtDate(p.createdAt)}</td></tr>`)}</tbody></table></div>`}</div>`;
  }

/* ES Prepočet – UI: spustenie (musí byť posledný súbor) */
  render(html`<${App} />`, document.getElementById("root"));
})();
