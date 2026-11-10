import { ELEMENTS, type ElementDef, type MaterialRole, type SideComputation } from "./elements";
import { computeGeometry } from "./geometry";
import { itemLabel, parseThicknessMm, priceLine } from "./pricing";
import type {
  ElementDelta, ElementSide, EstimateInput, EstimateResult, Geometry, HouseParams, MaterialChoices,
  OptimizationSuggestion, StudyPatch, EstimateSettings, Opening,
} from "./types";

const round = (n: number) => Math.round(n);
export const fmtEur = (n: number) =>
  `${n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("sk-SK").replace(/ /g, " ")} €`;
const fmtNum = (n: number, d = 0) => n.toLocaleString("sk-SK", { maximumFractionDigits: d, minimumFractionDigits: d }).replace(/ /g, " ");

function resolveMaterials(p: HouseParams, input: EstimateInput): Required<MaterialChoices> {
  const std = input.settings.standardSpec;
  const m = p.materials ?? {};
  return {
    wall: m.wall || std.wall,
    interiorWall: m.interiorWall || std.interiorWall,
    partition: m.partition || std.partition,
    facade: m.facade || std.facade,
    roofInsulation: m.roofInsulation || std.roofInsulation,
    roofInsulation2: m.roofInsulation ? m.roofInsulation2 || "" : m.roofInsulation2 ?? std.roofInsulation2 ?? "",
    floorInsulation: m.floorInsulation || std.floorInsulation,
    floorInsulationThicknessM: m.floorInsulationThicknessM || std.floorInsulationThicknessM,
    roofing: m.roofing || std.roofing,
    flatRoofing: m.flatRoofing || std.flatRoofing,
    window: m.window || std.window,
  };
}

interface Side {
  p: HouseParams;
  g: Geometry;
  m: Required<MaterialChoices>;
}

/** Missing values mean "as in the ES standard". */
export function withStandard(p: HouseParams, s: EstimateSettings): HouseParams {
  const f = p.foundation;
  if (!f || !f.type) return { ...p, foundation: s.standardFoundation };
  // chýbajúce údaje rovnakého typu založenia = štandard (napr. počet radov DT)
  const std = s.standardFoundation;
  return { ...p, foundation: f.type === std.type ? { ...std, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== null)) } : f };
}

function buildSide(p0: HouseParams, input: EstimateInput): Side {
  const p = withStandard(p0, input.settings);
  return { p, g: computeGeometry(p, input.settings), m: resolveMaterials(p, input) };
}

/** Standard openings of a catalog house: window share of usable area, balcony doors, one entrance door, garage doors, interior doors. */
export function standardOpenings(p: HouseParams, s: EstimateSettings): Opening[] {
  const so = s.standardOpenings;
  const balc = Math.max(1, Math.round(p.usableAreaM2 / so.balconyPerM2));
  const total = (p.usableAreaM2 * so.windowSharePct) / 100;
  const winArea = Math.max(0, total - balc * 0.9 * 2.2);
  const wins = Math.max(1, Math.round(winArea / (so.windowWidthM * so.windowHeightM)));
  const out: Opening[] = [
    { type: "okno", widthM: so.windowWidthM, heightM: so.windowHeightM, count: wins, label: "štandard" },
    { type: "balkonove", widthM: 0.9, heightM: 2.2, count: balc, label: "štandard" },
    { type: "vchodove", widthM: 1.1, heightM: 2.2, count: 1, label: "štandard" },
  ];
  if (p.garages) out.push({ type: "garazova", widthM: 2.5 * p.garages, heightM: 2.25, count: 1, label: "štandard" });
  out.push({ type: "vnutorne", widthM: 0.8, heightM: 1.97, count: Math.max(1, Math.round(p.usableAreaM2 / so.interiorDoorPerM2)), label: "štandard" });
  return out;
}

/** The catalog house in fixed ES standard – every value the catalog does not give is a fixed standard value. */
export function standardHouse(catalog: HouseParams, s: EstimateSettings): HouseParams {
  const d = s.defaults;
  const attic = catalog.floorsType === "podkrovie";
  const b: HouseParams = {
    ...catalog,
    storeyHeightM: d.storeyHeightM,
    kneeWallM: attic ? d.kneeWallM : undefined,
    roofPitchDeg: catalog.roofType === "plocha" ? undefined : attic ? d.roofPitchAtticDeg ?? d.roofPitchDeg : d.roofPitchDeg,
    roofOverhangM: d.roofOverhangM,
    heatingSource: "plyn", heatingDistribution: "podlahove", centralRecuperation: false, chimney: false, fireplace: false,
    wcs: catalog.wcs ?? 1,
    materials: {}, extras: [], bathroomsDetail: undefined,
    foundation: { ...s.standardFoundation },
  };
  b.openings = standardOpenings(b, s);
  return b;
}

function runElement(def: ElementDef, side: Side, input: EstimateInput): SideComputation & { cost: number } {
  const res = def.compute({ ...side, s: input.settings, prices: input.prices, extras: input.extras });
  const k = input.calibration?.[def.key] ?? 1;
  if (k !== 1) {
    res.lines = res.lines.map((l) => ({ ...l, quantity: l.quantity * k, cost: l.cost * k }));
    res.quantity *= k;
  }
  const cost = res.companyCostInclVat ?? res.lines.reduce((a, l) => a + l.cost, 0);
  return { ...res, cost };
}

function toSide(r: SideComputation & { cost: number }): ElementSide {
  return { quantity: r.quantity, unit: r.unit, materialLabel: r.materialLabel, cost: r.cost, lines: r.lines };
}

function explain(def: ElementDef, b: ElementSide, s: ElementSide): string {
  const parts: string[] = [];
  const dq = s.quantity - b.quantity;
  if (Math.abs(dq) >= 0.5 && def.pricedBy !== "firma") {
    parts.push(`${dq > 0 ? "+" : "−"}${fmtNum(Math.abs(dq), Math.abs(dq) < 10 ? 1 : 0)} ${s.unit} (${fmtNum(b.quantity, 0)} → ${fmtNum(s.quantity, 0)})`);
  }
  if (b.materialLabel && s.materialLabel && b.materialLabel !== s.materialLabel) {
    parts.push(`${b.materialLabel} → ${s.materialLabel}`);
  }
  if (def.pricedBy === "firma" && b.quantity !== s.quantity && def.key !== "zdroj_tepla") {
    parts.push(`${fmtNum(b.quantity)} → ${fmtNum(s.quantity)} ${s.unit}`);
  }
  return parts.join(", ") || "bez podstatnej zmeny";
}

interface Core {
  elements: ElementDelta[];
  deltaInclVat: number;
  estimateInclVat: number;
  warnings: string[];
  base: Side;
  study: Side;
}

function core(input: EstimateInput, studyOverride?: HouseParams): Core {
  const { settings: s } = input;
  const base = buildSide(input.base, input);
  const study = buildSide(studyOverride ?? input.study, input);
  const factor = s.markup * (1 + s.vatRate);
  const warnings = new Set<string>();
  const elements: ElementDelta[] = [];
  let modeledBase = 0; // modelovaná cena východiskového domu s DPH (materiál + práca × prirážky)

  for (const def of ELEMENTS) {
    if (input.finish === "holodom" && !def.inHolodom) continue;
    const rb = runElement(def, base, input);
    const rs = runElement(def, study, input);
    const f = def.shell ? (s.markupShell ?? s.markup) * (1 + s.vatRate) : factor;
    const delta = def.pricedBy === "firma" ? rs.cost - rb.cost : (rs.cost - rb.cost) * f;
    modeledBase += def.pricedBy === "firma" ? rb.cost : rb.cost * f;
    const w = [
      ...(rs.warnings ?? []),
      ...rs.lines.filter((l) => l.warning).map((l) => l.warning as string),
    ];
    // warnings from base side only matter when the element actually changes
    if (Math.abs(delta) >= 1) {
      rb.lines.filter((l) => l.warning).forEach((l) => w.push(l.warning as string));
    }
    const uniq = [...new Set(w)];
    uniq.forEach((x) => warnings.add(x));
    const b = toSide(rb);
    const st = toSide(rs);
    elements.push({
      key: def.key, label: def.label, group: def.group, base: b, study: st,
      deltaInclVat: delta, explanation: explain(def, b, st), pricedBy: def.pricedBy, warnings: uniq,
    });
  }
  // Réžia, doprava, zariadenie staveniska a zisk: časť katalógovej ceny, ktorú nevysvetľujú prvky (≈ 24 %),
  // rastie a klesá s veľkosťou domu. Kalibrované na 234 dvojiciach verzií toho istého katalógového domu.
  const so = s.sizeOverhead;
  const ab = base.p.usableAreaM2, as = study.p.usableAreaM2, zb = base.p.builtAreaM2, zs = study.p.builtAreaM2;
  if (so && so.weight && ab && as && zb && zs) {
    const rest = input.basePriceInclVat - modeledBase;
    const ratio = so.weight * (so.usableShare * (as / ab - 1) + (1 - so.usableShare) * (zs / zb - 1));
    const delta = rest > 0 ? rest * ratio : 0;
    elements.push({
      key: "rezia_velkost", label: "Réžia, doprava a zisk podľa veľkosti domu", group: "Ostatné",
      base: { quantity: ab, unit: "m²", cost: rest > 0 ? rest : 0, lines: [] },
      study: { quantity: as, unit: "m²", cost: rest > 0 ? rest * (1 + ratio) : 0, lines: [] },
      deltaInclVat: Math.abs(delta) >= 1 ? delta : 0,
      explanation: `úžitková ${fmtNum(ab, 1)} → ${fmtNum(as, 1)} m², zastavaná ${fmtNum(zb, 1)} → ${fmtNum(zs, 1)} m²`,
      pricedBy: "sadzba", warnings: [],
    });
  }
  // Nadštandardy zo štúdie (východiskový dom ich nemá, ak nie sú zadané aj pri ňom)
  const qtyOf = (p: HouseParams, key: string) => (p.extras || []).filter((e) => e.key === key).reduce((a, e) => a + (Number(e.qty) || 0), 0);
  const keys = [...new Set([...(base.p.extras || []), ...(study.p.extras || [])].map((e) => e.key))];
  for (const key of keys) {
    const def = (s.extrasCatalog || []).find((d) => d.key === key);
    if (def && s.outdoorRules && def.group === s.outdoorRules.extrasGroup) continue; // počíta sa vo vonkajšom zariadení
    const qb = qtyOf(base.p, key), qs = qtyOf(study.p, key);
    const label = def ? def.label : key;
    const w: string[] = [];
    let unitInclVat = 0;
    let pricedBy: ElementDelta["pricedBy"] = "ciselnik";
    if (!def || def.pricing.type === "none") {
      w.push(`Nadštandard „${label}“ nemá v cenníku cenu – doplniť ručne`);
    } else if (def.pricing.type === "company") {
      pricedBy = "firma";
      const pr = input.extras.accessories?.[def.pricing.accessoryId];
      if (pr == null) w.push(`Chýba cena „${label}“ z konfigurátora`);
      unitInclVat = pr ?? 0;
    } else if (def.pricing.type === "rate") {
      pricedBy = "sadzba";
      unitInclVat = (s.rates[def.pricing.rateKey] ?? 0) * factor;
    } else {
      const lineSum = (paths: string[] = []) => paths.reduce((a, pth) => {
        const l = priceLine(input.prices, pth, 1);
        if (l.warning) w.push(l.warning);
        return a + l.cost;
      }, 0);
      unitInclVat = (lineSum(def.pricing.paths) - lineSum(def.pricing.minusPaths)) * factor;
    }
    const unit = def?.unit ?? "ks";
    const side = (q: number): ElementSide => ({ quantity: q, unit, cost: q * unitInclVat, lines: [] });
    const note = (study.p.extras || []).find((e) => e.key === key)?.note;
    w.forEach((x) => warnings.add(x));
    elements.push({
      key: "extra_" + key, label, group: "Nadštandardy", base: side(qb), study: side(qs),
      deltaInclVat: (qs - qb) * unitInclVat,
      explanation: `${qb ? `${fmtNum(qb, 1)} → ` : ""}${fmtNum(qs, unit === "ks" ? 0 : 1)} ${unit}${note ? ` – ${note}` : ""}`,
      pricedBy, warnings: [...new Set(w)],
    });
  }
  const deltaInclVat = elements.reduce((a, e) => a + e.deltaInclVat, 0);
  return {
    elements, deltaInclVat, estimateInclVat: input.basePriceInclVat + deltaInclVat,
    warnings: [...warnings], base, study,
  };
}

const LOW_CONF_FIELDS = [
  "usableAreaM2", "builtAreaM2", "perimeterM", "widthM", "lengthM", "floorsType", "roofType",
  "roofPitchDeg", "windowsAreaM2", "windowsCount", "materials",
];

function accuracyBand(input: EstimateInput): number {
  let band = input.settings.accuracyBandPct;
  const conf = input.study.confidence ?? {};
  for (const f of LOW_CONF_FIELDS) {
    if (conf[f] === "low") band += 1.5;
    else if (conf[f] === "medium") band += 0.5;
  }
  // väčšia zmena veľkosti oproti východiskovému domu = širšie rozpätie (test na verziách katalógových domov:
  // zmena plochy do 15 % → medián odchýlky 1,7 %, nad 15 % → 3,4 %)
  const ab = input.base.usableAreaM2, as = input.study.usableAreaM2;
  if (ab && as) band += Math.min(5, Math.abs(as / ab - 1) * 10);
  return Math.min(15, band);
}

// ---------- Optimization ----------

const ROLE_LABEL: Record<MaterialRole, string> = {
  wall: "Obvodové murivo", interiorWall: "Vnútorné murivo", partition: "Priečky", facade: "Zateplenie fasády",
  roofInsulation: "Zateplenie strechy", floorInsulation: "Izolácia podláh", roofing: "Krytina",
  flatRoofing: "Hydroizolácia plochej strechy", window: "Okná",
};

/** Product families per role: where comparable alternatives live in the číselník. */
const ROLE_FAMILY: Record<MaterialRole, { prefix: string; include?: RegExp; exclude?: RegExp }> = {
  wall: { prefix: "A2/01/001/", exclude: /debniac|tehla plná|stĺp|stľp/i },
  interiorWall: { prefix: "A2/01/001/", exclude: /debniac|tehla plná|stĺp|stľp/i },
  partition: { prefix: "A2/01/001/", exclude: /debniac|tehla plná|stĺp|stľp/i },
  facade: { prefix: "B1/008/", include: /zatepľovací systém/i },
  roofInsulation: { prefix: "B1/009/", include: /tepelná izolácia/i, exclude: /parozábran|spádov/i },
  floorInsulation: { prefix: "B1/005/", exclude: /spádov/i },
  roofing: { prefix: "B4/003/003/", include: /zastrešenie krytinou/i, exclude: /polykarbon/i },
  flatRoofing: { prefix: "B1/004/", include: /hydroizolácia strešného plášťa/i },
  window: { prefix: "B5/002/" },
};

/** Candidates for a cheaper alternative: same unit, same product family, comparable thickness / function. */
export function materialAlternatives(input: EstimateInput, role: MaterialRole, current: string): string[] {
  const cur = input.prices[current];
  if (!cur) return [];
  const explicit = input.settings.alternatives?.[role];
  const fam = ROLE_FAMILY[role];
  const curT = parseThicknessMm(cur);
  const withPlaster = /s omietkou/i.test(cur.name);
  const pool = explicit ?? Object.keys(input.prices).filter((k) => k.startsWith(fam.prefix));
  return pool.filter((k) => {
    if (k === current) return false;
    const it = input.prices[k];
    if (!it || it.is_hidden || it.check_level === "CHYBA" || it.unit !== cur.unit) return false;
    if ((it.price_material ?? 0) + (it.price_labor ?? 0) <= 0) return false;
    if (!explicit) {
      const text = `${it.name} ${it.specification ?? ""}`;
      if (fam.include && !fam.include.test(text)) return false;
      if (fam.exclude && fam.exclude.test(text)) return false;
      if (role === "facade" && withPlaster !== /s omietkou/i.test(it.name)) return false;
    }
    const t = parseThicknessMm(it);
    if (role === "wall" || role === "interiorWall") return curT != null && t != null && Math.abs(t - curT) <= 60 && t >= 240;
    if (role === "partition") return curT != null && t != null && Math.abs(t - curT) <= 40 && t >= 100;
    if (role === "facade" || role === "roofInsulation") return curT != null && t != null && t >= curT - 20;
    return true;
  });
}

/** Applies a combinable change to study params. */
export function applyPatch(study: HouseParams, patch: StudyPatch): HouseParams {
  let s: HouseParams = { ...study };
  if (patch.set) s = { ...s, ...patch.set };
  if (patch.materials) s.materials = { ...(s.materials ?? {}), ...patch.materials };
  if (patch.dropExtras && s.extras) s.extras = s.extras.filter((x) => !patch.dropExtras!.includes(x.key));
  if (patch.scaleArea && patch.scaleArea !== 1) {
    const f = patch.scaleArea, k = Math.sqrt(f);
    s.usableAreaM2 = s.usableAreaM2 * f;
    s.builtAreaM2 = s.builtAreaM2 * f;
    if (s.widthM) s.widthM *= k;
    if (s.lengthM) s.lengthM *= k;
    if (s.perimeterM) s.perimeterM *= k;
    if (s.partitionAreaM2) s.partitionAreaM2 *= f;
    if (s.foundation?.lengthM) s.foundation = { ...s.foundation, lengthM: s.foundation.lengthM * k };
  }
  if (patch.scaleOpenings && patch.scaleOpenings !== 1) {
    const f = patch.scaleOpenings, k = Math.sqrt(f);
    if (s.openings && s.openings.length) {
      s.openings = s.openings.map((o) => (["okno", "balkonove", "hs"].includes(o.type) && o.widthM && o.heightM ? { ...o, widthM: o.widthM * k, heightM: o.heightM * k } : o));
    } else {
      if (s.windowsAreaM2) s.windowsAreaM2 *= f;
      if (s.windowsCount) s.windowsCount = Math.max(1, Math.round(s.windowsCount * f));
    }
  }
  return s;
}

function optimize(input: EstimateInput, current: Core): OptimizationSuggestion[] {
  const out: OptimizationSuggestion[] = [];
  const baseEst = current.estimateInclVat;
  const changePct = (e: number) => ((e - input.basePriceInclVat) / input.basePriceInclVat) * 100;
  const push = (id: string, kind: OptimizationSuggestion["kind"], title: string, detail: string, patch: StudyPatch) => {
    const newEst = core(input, applyPatch(input.study, patch)).estimateInclVat;
    const saving = baseEst - newEst;
    if (saving >= 300) out.push({ id, kind, title, detail, patch, savingInclVat: round(saving), newEstimateInclVat: round(newEst), newChangePct: changePct(newEst) });
  };
  const mats = current.study.m;

  // 1) Lacnejší materiál v rovnakej skupine
  const roleToElement: Partial<Record<MaterialRole, string>> = {
    wall: "murivo_obvodove", facade: "zateplenie_fasady", roofing: "krytina", roofInsulation: "zateplenie_strechy",
    floorInsulation: "izolacia_podlah", window: "okna", partition: "pricky", interiorWall: "murivo_vnutorne",
  };
  for (const role of Object.keys(roleToElement) as MaterialRole[]) {
    if (role === "roofing" && input.study.roofType === "plocha") continue;
    const cur = mats[role] as string;
    const el = current.elements.find((e) => e.key === roleToElement[role]);
    if (!el) continue;
    let best: { code: string; est: number } | undefined;
    for (const alt of materialAlternatives(input, role, cur)) {
      const est = core(input, applyPatch(input.study, { materials: { [role]: alt } })).estimateInclVat;
      if (!best || est < best.est) best = { code: alt, est };
    }
    if (best) {
      const a = input.prices[best.code];
      const c = input.prices[cur];
      push(`mat-${role}`, "material", `${ROLE_LABEL[role]}: ${itemLabel(a)}`,
        `Namiesto „${itemLabel(c)}“ použiť „${itemLabel(a)}“ (porovnateľná hrúbka a funkcia).`, { materials: { [role]: best.code } });
    }
  }

  // 2) Technológie
  if (input.study.heatingSource === "tc") {
    push("tech-heat", "technologia", "Plynový kondenzačný kotol namiesto tepelného čerpadla",
      "Štandardný zdroj tepla firmy; tepelné čerpadlo je možné doplniť neskôr.", { set: { heatingSource: "plyn" } });
  }
  if (input.study.centralRecuperation) {
    push("tech-reku", "technologia", "Decentrálna rekuperácia namiesto centrálnej",
      "Štandardné riešenie bez rozvodov vzduchotechniky.", { set: { centralRecuperation: false } });
  }
  if (input.study.fireplace) {
    push("tech-krb", "technologia", "Bez krbu (príprava na neskoršiu montáž)", "Krb je možné doplniť po kolaudácii.", { set: { fireplace: false } });
  }

  // 2b) Nadštandardy zo štúdie – vyčíslenie, ak by sa vynechali
  for (const e of current.elements.filter((x) => x.key.startsWith("extra_") && x.deltaInclVat > 0)) {
    const key = e.key.slice(6);
    push(`extra-${key}`, "nadstandard", `Bez nadštandardu: ${e.label}`, `Dá sa doplniť neskôr alebo nahradiť štandardným riešením.`, { dropExtras: [key] });
  }

  // 3) Tvar strechy
  if (input.study.roofType === "kombinovana" || input.study.roofType === "valbova") {
    push("tvar-strecha", "tvar", "Jednoduchšia sedlová strecha",
      "Sedlová strecha má menšiu plochu, menej úžľabí a klampiarskych prvkov.", { set: { roofType: "sedlova" } });
  }

  // 4) Plocha domu −7 %
  push("plocha-7", "plocha", "Zmenšiť úžitkovú plochu o 7 %",
    `Napr. z ${fmtNum(input.study.usableAreaM2)} m² na ${fmtNum(input.study.usableAreaM2 * 0.93)} m² (kompaktnejšie chodby, menšia technická miestnosť).`,
    { scaleArea: 0.93 });

  // 5) Okná −15 % plochy
  const g = current.study.g;
  push("okna-15", "tvar", "Znížiť plochu okien o 15 %",
    `Z ${fmtNum(g.windowsAreaM2)} m² na ${fmtNum(g.windowsAreaM2 * 0.85)} m² – menšie alebo menej presklených plôch.`,
    { scaleOpenings: 0.85 });

  return out.sort((a, b) => b.savingInclVat - a.savingInclVat).slice(0, 8);
}

// ---------- Public API ----------

export function computeEstimate(input: EstimateInput, topN = 7): EstimateResult {
  const c = core(input);
  const vat = 1 + input.settings.vatRate;
  const changeInclVat = c.estimateInclVat - input.basePriceInclVat;
  const changePct = (changeInclVat / input.basePriceInclVat) * 100;
  const sorted = [...c.elements].filter((e) => Math.abs(e.deltaInclVat) >= 1).sort((a, b) => Math.abs(b.deltaInclVat) - Math.abs(a.deltaInclVat));
  const topDrivers = sorted.slice(0, topN);
  const otherDeltaInclVat = sorted.slice(topN).reduce((a, e) => a + e.deltaInclVat, 0);
  const bandPct = accuracyBand(input);
  const optimizationNeeded = changePct > input.settings.optimizationThresholdPct;
  const warnings = [...c.warnings];
  if (changePct < -input.settings.optimizationThresholdPct) {
    warnings.push("Odhad je výrazne nižší ako cena východiskového domu – skontrolujte rozpoznané plochy a rozmery štúdie.");
  }
  return {
    basePriceInclVat: input.basePriceInclVat,
    estimateInclVat: round(c.estimateInclVat),
    estimateExclVat: round(c.estimateInclVat / vat),
    changeInclVat: round(changeInclVat),
    changePct,
    range: {
      lowInclVat: round((c.estimateInclVat * (1 - bandPct / 100)) / 100) * 100,
      highInclVat: round((c.estimateInclVat * (1 + bandPct / 100)) / 100) * 100,
      bandPct,
    },
    elements: c.elements,
    topDrivers,
    otherDeltaInclVat: round(otherDeltaInclVat),
    optimizationNeeded,
    optimizations: optimize(input, c),
    warnings,
    geometry: { base: c.base.g, study: c.study.g },
  };
}

export { priceLine };
