import { describe, expect, it } from "vitest";
import { applyPatch, standardHouse, computeEstimate, computeGeometry, DEFAULT_ENGINE_SETTINGS, parseThicknessMm } from "./index";
import type { EstimateInput, HouseParams, PriceIndex } from "./types";

const s = DEFAULT_ENGINE_SETTINGS;

// Minimal synthetic price index: every code used by defaults gets a simple price.
function buildPrices(): PriceIndex {
  const p: PriceIndex = {};
  const add = (code: string, unit: string, mat: number, lab: number, name = code) =>
    (p[code] = { path_code: code, name, unit, price_material: mat, price_labor: lab, price_machinery: 0, fixed_rate: null });
  for (const code of Object.values(s.items)) add(code, "m2", 10, 5);
  for (const code of Object.values(s.fixtures)) add(code, "ks", 100, 20);
  for (const code of Object.values(s.dtBlocks)) add(code, "m2", 40, 14);
  for (const d of s.extrasCatalog) if (d.pricing.type === "item") for (const pth of [...d.pricing.paths, ...(d.pricing.minusPaths || [])]) if (!p[pth]) add(pth, d.unit, 50, 10);
  add(s.standardSpec.wall, "m2", 60, 8, "stena z muriva hr. 300 mm");
  add("A2/01/001/999/011/FAMILY 44", "m2", 100, 15, "murivo Heluz FAMILY 44 hr. 440 mm");
  add("A2/01/001/999/011/UNI 30", "m2", 50, 10, "murivo Heluz UNI 30 hr. 300 mm");
  add(s.standardSpec.interiorWall, "m2", 34, 7, "stena hr. 250 mm");
  add(s.standardSpec.partition, "m2", 27, 5, "stena hr. 115 mm");
  add(s.standardSpec.facade, "m2", 33, 21, "KZS s omietkou hr. iz. 150mm");
  add(s.standardSpec.roofInsulation, "m2", 16, 2, "tepelná izolácia hr. 200 mm");
  add(s.standardSpec.roofInsulation2!, "m2", 8, 2, "tepelná izolácia hr. 100 mm");
  add(s.standardSpec.floorInsulation, "m3", 131, 28, "EPS 150S");
  add(s.standardSpec.roofing, "m2", 26, 10, "zastrešenie krytinou");
  add(s.standardSpec.flatRoofing, "m2", 14, 16, "hydroizolácia strešného plášťa");
  add(s.standardSpec.window, "ks", 263.8, 0, "okno");
  add(s.items.windowDouble, "ks", 291.55, 0, "okno dvojkrídle");
  add(s.items.balconyDoor, "ks", 288.64, 0, "balkónové dvere");
  add(s.items.balconyDoorDouble, "ks", 316.34, 0, "balkónové dvere dvojkrídle");
  return p;
}

const base0 = (): HouseParams => ({ ...base });
const base: HouseParams = {
  usableAreaM2: 122.56, builtAreaM2: 147.17, widthM: 11.15, lengthM: 17.55, floorsType: "bungalov",
  roofType: "sedlova", bathrooms: 2, wcs: 1, garages: 0, heatingSource: "plyn", heatingDistribution: "podlahove",
};

const input = (study: HouseParams, extra: Partial<EstimateInput> = {}): EstimateInput => ({
  basePriceInclVat: 287000, finish: "standard", base, study, prices: buildPrices(), settings: s,
  extras: { heatPump: 8940, chimney: 2897, fireplace: 4967, bathroomPackage: 4357, accessories: { "1": 5091, "2": 10182, "9": 1325 } }, ...extra,
});

describe("estimate engine", () => {
  it("returns the base price when the study equals the base house", () => {
    const r = computeEstimate(input({ ...base }));
    expect(r.estimateInclVat).toBe(287000);
    expect(r.changePct).toBeCloseTo(0, 6);
    expect(r.topDrivers).toHaveLength(0);
  });

  it("krb si dodáva klient: účtuje sa len komín, krb sa uvedie ako mimo dodávky ES", () => {
    const chimneyOnly = computeEstimate(input({ ...base, chimney: true }));
    const withFireplace = computeEstimate(input({ ...base, chimney: true, fireplace: true }));
    expect(chimneyOnly.estimateInclVat).toBe(287000 + 5200); // komín podľa rozpočtu 25/120
    expect(withFireplace.estimateInclVat).toBe(chimneyOnly.estimateInclVat);
    // komín Schiedel Stabil podľa rozpočtu 26/126 (6 662,60 € bez DPH → 9 000 € s DPH)
    const stabil = computeEstimate(input({ ...base, chimney: true, chimneyType: "stabil" }));
    expect(stabil.estimateInclVat).toBe(287000 + 9000);
    expect(stabil.elements.find((e) => e.key === "komin_krb")!.study.materialLabel).toBe("komín Schiedel Stabil");
    const el = withFireplace.elements.find((e) => e.key === "komin_krb")!;
    expect(el.study.materialLabel).toMatch(/krb – dodáva klient/);
    expect(withFireplace.optimizations.some((o) => o.id === "tech-krb")).toBe(false);
  });

  it("adds company prices (incl. VAT) without markup", () => {
    const r = computeEstimate(input({ ...base, heatingSource: "tc" }));
    expect(r.changeInclVat).toBe(11500); // TČ podľa rozpočtov (prednosť pred konfigurátorom 8 940)
    expect(r.topDrivers[0].key).toBe("zdroj_tepla");
    const cfg = computeEstimate({ ...input({ ...base, heatingSource: "tc" }), settings: { ...s, heatPumpInclVat: undefined } });
    expect(cfg.changeInclVat).toBe(8940);
  });

  it("prefarbené okná: +23,2 % k cene okien, HUS prirážka", () => {
    const plain = computeEstimate(input({ ...base }));
    const col = computeEstimate(input({ ...base, windowsColored: true }));
    const okna = plain.elements.find((e) => e.key === "okna")!;
    expect(col.changeInclVat).toBeCloseTo(okna.study.cost * 0.232 * (s.markupShell ?? s.markup) * (1 + s.vatRate), 0);
  });

  it("krov sa počíta sadzbou z rozpočtov za m² strechy", () => {
    const r = computeEstimate(input({ ...base }));
    const krov = r.elements.find((e) => e.key === "krov")!;
    const g = computeGeometry(base, s);
    expect(krov.study.cost).toBeCloseTo(g.roofAreaM2 * 45.7, 0);
  });

  it("svah: viac radov DT pridá ťažbu a odvoz zeminy", () => {
    const f = { ...s.standardFoundation };
    const flat = computeEstimate(input({ ...base, foundation: { ...f, dtRows: 2 } }));
    const slope = computeEstimate(input({ ...base, foundation: { ...f, dtRows: 5 } }));
    const z = (r: typeof flat) => r.elements.find((e) => e.key === "zemne")!.study.cost;
    expect(z(flat)).toBeLessThan(z(slope));
    // 3 rady nad 2 × 0,24 m × zastavaná plocha
    expect(slope.elements.find((e) => e.key === "zemne")!.study.lines.find((l) => l.pathCode === "A1/01/005")!.quantity).toBeCloseTo(base.builtAreaM2 * 0.24 * 3, 3);
  });

  it("applies markup and VAT to číselník deltas", () => {
    const study = { ...base, materials: { wall: "A2/01/001/999/011/FAMILY 44" } };
    const r = computeEstimate(input(study));
    const g = computeGeometry(base, s);
    const P = buildPrices()[s.standardSpec.wall];
    const expected = g.facadeNetM2 * (115 - (P.price_material! + P.price_labor!)) * (s.markupShell ?? s.markup) * (1 + s.vatRate);
    expect(r.changeInclVat).toBeCloseTo(expected, -1);
  });

  it("bigger house costs more and proposes optimizations above the threshold", () => {
    const r = computeEstimate(input({
      ...base, usableAreaM2: 150, builtAreaM2: 180, widthM: 12, lengthM: 20, roofType: "kombinovana",
      heatingSource: "tc", fireplace: true, materials: { wall: "A2/01/001/999/011/FAMILY 44" },
    }));
    expect(r.changePct).toBeGreaterThan(10);
    expect(r.optimizationNeeded).toBe(true);
    expect(r.optimizations.length).toBeGreaterThan(0);
    expect(r.optimizations.every((o) => o.savingInclVat > 0)).toBe(true);
    expect(r.optimizations.map((o) => o.id)).toContain("tech-heat");
  });

  it("holodom skips elements that are not part of the holodom price", () => {
    const r = computeEstimate(input({ ...base, heatingSource: "tc", bathrooms: 3 }, { finish: "holodom", basePriceInclVat: 245000 }));
    expect(r.elements.find((e) => e.key === "zdroj_tepla")).toBeUndefined();
    expect(r.elements.find((e) => e.key === "kupelne")).toBeUndefined();
  });

  it("widens the accuracy band for low-confidence fields", () => {
    const r = computeEstimate(input({ ...base, confidence: { usableAreaM2: "low", roofType: "low" } }));
    expect(r.range.bandPct).toBe(s.accuracyBandPct + 3);
  });

  it("warns about missing price list items", () => {
    const r = computeEstimate(input({ ...base, materials: { wall: "NEEXISTUJE" } }));
    expect(r.warnings.join(" ")).toContain("NEEXISTUJE");
  });

  it("parses thickness from item texts", () => {
    expect(parseThicknessMm({ name: "stena z muriva Porobeton hr. 300 mm", specification: "", path_code: "x" })).toBe(300);
    expect(parseThicknessMm({ name: "KZS", specification: "EPS 70 F hr. iz. 150mm; (K=1,5)", path_code: "x" })).toBe(150);
    expect(parseThicknessMm({ name: "murivo Heluz FAMILY 44", specification: "hr. 440 mm", path_code: "x" })).toBe(440);
  });

  it("prices openings from the schedule: bigger windows and an HS portal cost more", () => {
    const ops = [
      { type: "okno" as const, widthM: 1.0, heightM: 1.25, count: 6 },
      { type: "okno" as const, widthM: 1.5, heightM: 1.5, count: 3 },
      { type: "balkonove" as const, widthM: 0.9, heightM: 2.2, count: 2 },
      { type: "hs" as const, widthM: 3.5, heightM: 2.3, count: 1 },
      { type: "vchodove" as const, widthM: 1.1, heightM: 2.2, count: 1 },
      { type: "vnutorne" as const, count: 9 },
    ];
    const base = computeEstimate(input({ ...base0(), openings: ops.filter((o) => o.type !== "hs") }));
    const r = computeEstimate(input({ ...base0(), openings: ops }));
    expect(r.estimateInclVat).toBeGreaterThan(base.estimateInclVat);
    const okna = r.elements.find((e) => e.key === "okna")!;
    expect(okna.study.materialLabel).toContain("HS portál");
  });

  it("counts DT blocks from the section", () => {
    const study = { ...base0(), foundation: { type: "pasy_dt" as const, dtRows: 3, dtThicknessMm: 300 } };
    const r = computeEstimate(input(study));
    const dt = r.elements.find((e) => e.key === "zaklady_dt")!;
    const g = computeGeometry(base0(), s);
    expect(dt.study.quantity).toBe(Math.ceil((g.foundationLengthM * 3 * 0.25) / 0.125));
    expect(r.changeInclVat).toBeGreaterThan(0);
  });

  it("prices premium bathroom equipment", () => {
    const study = { ...base0(), bathroomsDetail: [{ freestandingTub: 1, washbasins: 2, wcWallHung: 1 }, { showerDrain: 1, washbasins: 1, wc: 1 }, { wc: 1, washbasins: 1 }] };
    const r = computeEstimate(input(study));
    const k = r.elements.find((e) => e.key === "kupelne")!;
    expect(k.study.materialLabel).toContain("voľne stojaca vaňa");
  });

  it("adds detected extras with company prices and offers to drop them", () => {
    const r = computeEstimate(input({ ...base0(), extras: [{ key: "fve5", qty: 1 }, { key: "wallbox", qty: 1 }, { key: "sauna", qty: 1 }] }, { basePriceInclVat: 60000 }));
    expect(r.changeInclVat).toBe(10182 + 1325);
    expect(r.warnings.join(" ")).toContain("Sauna");
    expect(r.optimizations.map((o) => o.id)).toContain("extra-fve5");
  });

  it("optimization patches combine into a cheaper variant", () => {
    const study = { ...base0(), heatingSource: "tc" as const, fireplace: true, extras: [{ key: "fve5", qty: 1 }],
      openings: [{ type: "okno" as const, widthM: 1.5, heightM: 1.5, count: 8 }, { type: "hs" as const, widthM: 4, heightM: 2.3, count: 1 }] };
    const r = computeEstimate(input(study, { basePriceInclVat: 60000 }));
    const okna = r.optimizations.find((o) => o.id === "okna-15");
    expect(okna).toBeDefined();
    let v = study as any;
    for (const o of r.optimizations.filter((o) => o.kind !== "material")) v = applyPatch(v, o.patch);
    const rv = computeEstimate(input(v, { basePriceInclVat: 60000 }));
    const single = Math.max(...r.optimizations.map((o) => o.savingInclVat));
    expect(r.estimateInclVat - rv.estimateInclVat).toBeGreaterThan(single);
    expect(v.extras).toHaveLength(0);
    expect(v.heatingSource).toBe("plyn");
  });

  it("uses the ES standard roof pitch by house type: bungalov 22°, poschodový valbová 23° (František 14), inak 35°, podkrovie 40°", () => {
    expect(standardHouse({ ...base0(), floorsType: "bungalov", roofType: "valbova" }, s).roofPitchDeg).toBe(22);
    expect(standardHouse({ ...base0(), floorsType: "poschodovy", roofType: "valbova" }, s).roofPitchDeg).toBe(23);
    expect(standardHouse({ ...base0(), floorsType: "poschodovy", roofType: "sedlova" }, s).roofPitchDeg).toBe(35);
    expect(standardHouse({ ...base0(), floorsType: "podkrovie", roofType: "sedlova" }, s).roofPitchDeg).toBe(40);
  });

  it("builds the catalog house in fixed ES standard", () => {
    const b = standardHouse(base0(), s);
    expect(b.roofPitchDeg).toBe(22);
    expect(b.foundation?.type).toBe("pasy_dt");
    expect(b.openings?.find((o) => o.type === "vchodove")?.count).toBe(1);
    const win = b.openings!.filter((o) => ["okno", "balkonove"].includes(o.type)).reduce((a, o) => a + o.widthM! * o.heightM! * o.count, 0);
    expect(Math.abs(win - base.usableAreaM2 * 0.16)).toBeLessThan(1.5);
    // a study identical to the standard house costs exactly the base price
    const r = computeEstimate(input({ ...b }, { base: b }));
    expect(r.estimateInclVat).toBe(287000);
    // a study without foundation counts as standard foundation
    const r2 = computeEstimate(input({ ...b, foundation: undefined }, { base: b }));
    expect(r2.changeInclVat).toBe(0);
    // single-layer 200 mm instead of standard 300 mm is cheaper
    const r3 = computeEstimate(input({ ...b, materials: { roofInsulation: s.standardSpec.roofInsulation } }, { base: b }));
    expect(r3.changeInclVat).toBeLessThan(0);
  });

  it("prices windows per m² like the budget (1,50 × 1,40 m dvojkrídle = 612,26 €)", () => {
    const one = computeEstimate(input({ ...base0(), openings: [{ type: "okno" as const, widthM: 1.5, heightM: 1.4, count: 1 }] }));
    const line = one.elements.find((e) => e.key === "okna")!.study.lines[0];
    expect(line.cost).toBeCloseTo(612.26, 1);
    const hs = computeEstimate(input({ ...base0(), openings: [{ type: "hs" as const, widthM: 3.0, heightM: 2.3, count: 1 }] }));
    expect(hs.elements.find((e) => e.key === "okna")!.study.lines[0].cost).toBeCloseTo(4365.49, 0);
  });

  it("štandardné otvory podľa typového projektu: dvojkrídle okná 1,5 × 1,45 m, jedny balkónové dvere 1,8 × 2,25 m na ≈ 100 m²", () => {
    const b = standardHouse({ ...base0(), usableAreaM2: 141.55, floorsType: "poschodovy", roofType: "valbova" }, s);
    const okna = b.openings!.find((o) => o.type === "okno")!, balk = b.openings!.find((o) => o.type === "balkonove")!;
    expect(okna.widthM).toBe(1.5);
    expect(balk.count).toBe(1);
    expect(balk.widthM).toBe(1.8);
  });
});
