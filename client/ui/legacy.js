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
        const proj = { ...(r.merged.project || {}), ...Object.fromEntries(Object.entries(draft.project || {}).filter(([, v]) => v)) };
        upd({ project: proj, ai: { pages: r.merged.pages, notes: r.merged.notes, notesList: r.merged.notesList, unreadable: r.merged.unreadable, checks: r.merged.checks, drawings: r.merged.drawings, houseName: r.merged.houseName, raw: r.raw }, study: filled, matches: matches.map((m) => ({ id: m.house.id, score: m.score, reasons: m.reasons })), baseHouseId: base, baseConfirmed: false, step: 2, aiMeta: { pagesRead: r.raw.length, pagesTotal: pages.length, errors: r.errors } });
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
          <details open=${!!(draft.project && Object.values(draft.project).some(Boolean))}><summary class="small" style="cursor:pointer;font-weight:600">Údaje projektu <span class="muted">(vyplní sa aj z razítok štúdie)</span></summary><div style="margin-top:10px"><${ProjectFields} draft=${draft} upd=${upd} /></div></details>
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
      ["centralRecuperation", "Centrálna rekuperácia", "", "bool"], ["chimney", "Komín", "", "bool"], ["fireplace", "Krb", "", "bool"], ["windowsColored", "Prefarbené okná", "", "bool"],
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
        ${study.roofType !== "plocha" ? geo("roofPitchDeg", "Sklon strechy", "°", "num", b.roofPitchDeg ?? (E.defaultRoofPitch ? E.defaultRoofPitch(study.floorsType, ctx.settings.defaults, study.roofType) : study.floorsType === "podkrovie" ? ctx.settings.defaults.roofPitchAtticDeg : ctx.settings.defaults.roofPitchDeg), 0) : null}
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
        ${note(!!study.windowsColored, "Okná", "biele", "prefarbené")}
        <${CRow} label="Zdroj tepla" std=${T.kurenie} changed=${study.heatingSource && study.heatingSource !== "plyn"} c=${conf.heatingSource}><${FieldInput} id="s-heat" type="heat" value=${study.heatingSource} onChange=${(v) => setS("heatingSource", v)} /><//>
        <${CRow} label="Rozvod tepla" std="Podlahové kúrenie v celom dome" changed=${study.heatingDistribution && study.heatingDistribution !== "podlahove"} c=${conf.heatingDistribution}><${FieldInput} id="s-dist" type="dist" value=${study.heatingDistribution} onChange=${(v) => setS("heatingDistribution", v)} /><//>
        <${CRow} label="Centrálna rekuperácia" std=${T.rekuperacia} changed=${!!study.centralRecuperation} c=${conf.centralRecuperation}><${FieldInput} id="s-reku" type="bool" value=${study.centralRecuperation} onChange=${(v) => setS("centralRecuperation", v)} /><//>
        <${CRow} label="Komín" std="Nie je v štandarde" changed=${!!study.chimney} c=${conf.chimney}><${FieldInput} id="s-kom" type="bool" value=${study.chimney} onChange=${(v) => setS("chimney", v)} /><//>
        <${CRow} label="Krb" std="Nie je v štandarde" changed=${!!study.fireplace} c=${conf.fireplace}><${FieldInput} id="s-krb" type="bool" value=${study.fireplace} onChange=${(v) => setS("fireplace", v)} /><//>
        <${CRow} label="Prefarbené okná" std="Biele okná (prefarbenie +23 % k cene okien)" changed=${!!study.windowsColored} c=${conf.windowsColored}><${FieldInput} id="s-okfarba" type="bool" value=${study.windowsColored} onChange=${(v) => setS("windowsColored", v)} /><//>
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
      <div class="card"><div class="card-head"><div><h2>Údaje projektu</h2><div class="sub">Z rohových razítok a správy – skontrolujte a doplňte. Zobrazia sa v zozname prepočtov a v PDF.</div></div></div><div class="card-pad"><${ProjectFields} draft=${draft} upd=${upd} /></div></div>
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

  const CONF_LABEL = { usableAreaM2: "Úžitková plocha", builtAreaM2: "Zastavaná plocha", widthM: "Šírka domu", lengthM: "Dĺžka domu", floorsType: "Typ domu", storeyHeightM: "Konštrukčná výška podlažia", kneeWallM: "Nadmurovka", roofType: "Typ strechy", roofPitchDeg: "Sklon strechy", rooms: "Počet izieb", garages: "Garáž", bathrooms: "Počet kúpeľní", wcs: "Počet WC", heatingSource: "Zdroj tepla", heatingDistribution: "Rozvod tepla", centralRecuperation: "Rekuperácia", chimney: "Komín", fireplace: "Krb", windowsColored: "Farba okien", openings: "Okná a dvere (rozmery)", foundation: "Založenie", bathroomsDetail: "Vybavenie kúpeľní", materials: "Materiály" };
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
        ${(ai.unreadable || []).length || (ai.checks || []).length ? html`<section id="drawing-checks"><h3>${++n}. Kontrola výkresov</h3>
          ${(ai.unreadable || []).length ? html`<div class="notice alert small"><div><b>Nečitateľné – Claude ich nehádal, doplňte z výkresu:</b><ul>${ai.unreadable.slice(0, 12).map((u) => html`<li>${u.text} <span class="muted">(${u.src})</span></li>`)}</ul></div></div>` : null}
          ${(ai.checks || []).some((c) => !c.ok) ? html`<div class="notice small" style="margin-top:8px"><div><b>Kóty alebo plochy nesedia:</b><ul>${ai.checks.filter((c) => !c.ok).slice(0, 12).map((c) => html`<li>${c.text}${c.detail ? ` – ${c.detail}` : ""} <span class="muted">(${c.src})</span></li>`)}</ul></div></div>` : null}
          ${(ai.checks || []).some((c) => c.ok) ? html`<details class="small" style="margin-top:8px"><summary>Krížová kontrola kót a plôch: ${pluralSk(ai.checks.filter((c) => c.ok).length, "kontrola sedí", "kontroly sedia", "kontrol sedí")}</summary><ul>${ai.checks.filter((c) => c.ok).map((c) => html`<li>${c.text}${c.detail ? ` – ${c.detail}` : ""} <span class="muted">(${c.src})</span></li>`)}</ul></details>` : null}
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


  /** Údaje projektu (zákazka, manažér, projektant, pozemok, dátum štúdie) – vyplní ich AI z razítok a správy, obchodník ich môže prepísať. */
  const PROJECT_FIELDS = [["zakazka", "Číslo zákazky", "napr. 154/26"], ["manazer", "Manažér projektu", ""], ["projektant", "Projektant", ""], ["katastralne", "Katastrálne územie", "napr. Sládkovičovo"], ["parcela", "Číslo parcely", "napr. 263"], ["datumStudie", "Dátum štúdie", "napr. 11/2026"]];
  function ProjectFields({ draft, upd }) {
    const pr = draft.project || {};
    const set = (k, v) => upd({ project: { ...pr, [k]: v } });
    return html`<div class="mini-grid" style="padding:0" id="project-fields">${PROJECT_FIELDS.map(([k, label, ph]) => html`<div class="field"><label for=${"pr-" + k}>${label}</label><input id=${"pr-" + k} class="input" value=${pr[k] || ""} placeholder=${ph} onInput=${(e) => set(k, e.target.value)} /></div>`)}</div>`;
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
    // Kontrola: ten istý prepočet z 5 najpodobnejších katalógových domov. Ceny katalógových domov rovnakej veľkosti sa líšia
    // aj o 10 %, preto medián z viacerých domov je spoľahlivejší (test na katalógu: do 3 % pri 40 % domov oproti 34 % z jedného domu).
    const peers = L.findClosestHouses(study, ctx.houses, "", 5).map((m) => m.house);
    if (!peers.some((h) => h.id === house.id)) peers.unshift(house);
    const cross = peers.map((h) => {
      const pb = L.effectiveBase(h, ctx.settings);
      const price = draft.finish === "holodom" ? h.hol : h.price;
      if (!price) return null;
      const v = E.computeEstimate({ basePriceInclVat: price, finish: draft.finish, base: pb.params, study, prices: ctx.prices, settings: ctx.settings, extras: ctx.extras });
      return { id: h.id, name: h.name, estimate: v.estimateInclVat };
    }).filter(Boolean);
    const sorted = cross.map((x) => x.estimate).sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : r.estimateInclVat;
    const check = { peers: cross, median, low: sorted[0], high: sorted[sorted.length - 1], devPct: (r.estimateInclVat / median - 1) * 100 };
    return { result: r, house, baseParams: eb.params, studyParams: study, variants, outdoor, outdoorParams, check };
  }

  function StepResult({ ctx, draft, upd }) {
    const { result: r, house, baseParams, studyParams, variants, outdoor, check } = useMemo(() => computeFor(ctx, draft), [draft.study, draft.baseOverrides, draft.baseHouseId, draft.finish, draft.variantSel, ctx.prices, ctx.settings]);
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
          id: draft.id, ownerId: caps.uid, ownerName: ctx.profile?.name || caps.me?.name || "", clientName: draft.clientName || "", clientNote: draft.clientNote || "", project: L.clean(draft.project || {}),
          finish: draft.finish, baseHouseId: draft.baseHouseId, baseHouseName: house.name, files, aiSummary: summary || "",
          ai: draft.ai ? { pages: draft.ai.pages || [], notes: draft.ai.notes || "", notesList: draft.ai.notesList || [], unreadable: draft.ai.unreadable || [], checks: draft.ai.checks || [], drawings: draft.ai.drawings || [], houseName: draft.ai.houseName || "" } : null, variantSel: draft.variantSel || [],
          study: L.clone(draft.study), baseOverrides: L.clone(draft.baseOverrides || {}), matches: draft.matches || [],
          summary: {
            basePrice: r.basePriceInclVat, estimate: r.estimateInclVat, estimateExclVat: r.estimateExclVat, change: r.changeInclVat, changePct: r.changePct, range: r.range,
            topDrivers: r.topDrivers.map((d) => ({ key: d.key, label: d.label, delta: Math.round(d.deltaInclVat), explanation: d.explanation })),
            optimizations: r.optimizations.map(({ patch, ...o }) => o),
            variants: variants.map(({ id, name, estimate, changePct }) => ({ id, name, estimate: Math.round(estimate), changePct })),
            outdoor: { inclVat: Math.round(outdoor.inclVat), exclVat: Math.round(outdoor.exclVat), missing: outdoor.missing },
            check: check ? { median: Math.round(check.median), low: Math.round(check.low), high: Math.round(check.high), devPct: Math.round(check.devPct * 10) / 10, peers: check.peers.map((p) => ({ name: p.name, estimate: Math.round(p.estimate) })) } : null,
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
      ${check && check.peers.length > 1 ? html`<div class=${"notice " + (Math.abs(check.devPct) > 3 ? "alert" : "info")} id="cross-check"><div>
        <b>Kontrola z ${check.peers.length} podobných domov: medián ${fmtEur(check.median)}</b> (${fmtEur(check.low)} – ${fmtEur(check.high)}).
        ${Math.abs(check.devPct) > 3
          ? html` Odhad z domu ${house.name} sa od mediánu líši o ${fmtNum(check.devPct, 1)} %. Ak klient nevychádza práve z tohto domu, použite medián alebo vyberte bližší dom.`
          : html` Odhad z domu ${house.name} sedí s ostatnými domami (${fmtNum(check.devPct, 1)} %).`}
        <div class="small muted" style="margin-top:4px">${check.peers.map((p) => `${p.name} ${fmtEur(p.estimate)}`).join(" · ")}</div>
      </div></div>` : null}
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
            <td><b>${e.clientName || "Bez mena"}</b>${e.project?.zakazka ? html` <span class="badge">${e.project.zakazka}</span>` : null}${e.project?.katastralne || e.project?.parcela ? html`<div class="faint small">${[e.project.katastralne, e.project.parcela && "p. č. " + e.project.parcela].filter(Boolean).join(", ")}</div>` : null}${e.clientNote ? html`<div class="faint small">${e.clientNote.slice(0, 60)}</div>` : null}</td>
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
        <div class="brand-mark" style="width:64px;height:64px;font-size:18px;border-radius:14px">${c.logoAssetId ? html`<img src=${"/_blob/" + c.logoAssetId} alt="Logo" />` : html`<svg viewBox="30 74 440 194" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><use href="#es-logo" /></svg>`}</div>
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
      <div class="group">${N("vatRate", "Sadzba DPH", "0,23 = 23 %")}${N("markupShell", "Prirážka – hrubá uzatvorená stavba", "násobok nákladov z číselníka (základy, murivo, strecha, okná, vchodové dvere), napr. 1,6")}${N("markup", "Prirážka – ostatné položky", "presun hmôt 2 % × GZS 3,5 % × zisk 4 % = 1,098")}${N("optimizationThresholdPct", "Prah pre optimalizáciu (%)")}${N("accuracyBandPct", "Základné rozpätie odhadu (± %)")}</div>
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
