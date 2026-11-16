import { describe, expect, it } from "vitest";
import { computeEstimate, DEFAULT_ENGINE_SETTINGS, sanityCheck } from "./index";
import type { EstimateInput, HouseParams, PriceIndex } from "./types";

const s = DEFAULT_ENGINE_SETTINGS;
function prices(): PriceIndex {
  const p: PriceIndex = {};
  const add = (code: string, unit: string, mat: number, lab: number) => (p[code] = { path_code: code, name: code, unit, price_material: mat, price_labor: lab, price_machinery: 0, fixed_rate: null });
  for (const code of Object.values(s.items)) add(code, "m2", 10, 5);
  for (const code of Object.values(s.fixtures)) add(code, "ks", 100, 20);
  for (const code of Object.values(s.dtBlocks)) add(code, "m2", 40, 14);
  for (const code of Object.values(s.standardSpec)) if (typeof code === "string") add(code, "m2", 30, 10);
  return p;
}
const base: HouseParams = {
  usableAreaM2: 122.56, builtAreaM2: 147.17, widthM: 11.15, lengthM: 17.55, floorsType: "bungalov",
  roofType: "sedlova", bathrooms: 2, wcs: 1, garages: 0, heatingSource: "plyn", heatingDistribution: "podlahove",
};
const run = (study: HouseParams, pr = prices()) => {
  const input: EstimateInput = { basePriceInclVat: 287000, finish: "standard", base, study, prices: pr, settings: s,
    extras: { heatPump: 8940, chimney: 2897, fireplace: 4967, bathroomPackage: 4357, accessories: {} } };
  const result = computeEstimate(input);
  return sanityCheck({ result, base, study, settings: s });
};

describe("sanity check (kontrola rozpočtu)", () => {
  it("dom zhodný s východiskovým nemá chyby", () => {
    const r = run({ ...base });
    expect(r.counts.chyba).toBe(0);
    expect(r.verify).toHaveLength(0);
  });
  it("obvod menší ako pri štvorci je chyba", () => {
    const r = run({ ...base, perimeterM: 30 });
    expect(r.findings.some((f) => f.id === "geo-obvod-maly" && f.severity === "chyba")).toBe(true);
  });
  it("nereálny pomer plôch pri bungalove je upozornenie", () => {
    const r = run({ ...base, usableAreaM2: 250 });
    expect(r.findings.some((f) => f.id === "geo-pomer-ploch")).toBe(true);
  });
  it("bungalov so sklonom 22° nehlási chybu plochy strechy", () => {
    const r = run({ ...base, roofPitchDeg: 22 });
    expect(r.findings.some((f) => f.id === "geo-strecha")).toBe(false);
  });
  it("položka bez ceny v číselníku je chyba pre rozpočtára", () => {
    const pr = prices();
    pr[s.standardSpec.wall] = { ...pr[s.standardSpec.wall], price_material: 0, price_labor: 0 };
    const r = run({ ...base, usableAreaM2: 130, builtAreaM2: 155 }, pr);
    const f = r.findings.find((x) => x.id.startsWith("riadok-bezceny-"));
    expect(f?.owner).toBe("rozpočtár");
  });
  it("kotol na tuhé palivo bez komína a krb bez komína", () => {
    const r = run({ ...base, heatingSource: "tuhe", fireplace: true });
    expect(r.findings.some((f) => f.id === "chyba-komin-tuhe")).toBe(true);
    expect(r.findings.some((f) => f.id === "chyba-komin-krb")).toBe(true);
  });
  it("tri čísla na overenie = najväčšie vplyvy, chyby sú zoradené prvé", () => {
    const r = run({ ...base, usableAreaM2: 140, builtAreaM2: 165, chimney: true, perimeterM: 30 });
    expect(r.verify.length).toBe(3);
    expect(Math.abs(r.verify[0].impactInclVat)).toBeGreaterThanOrEqual(Math.abs(r.verify[2].impactInclVat));
    expect(r.findings[0].severity).toBe("chyba");
  });
  it("chýbajúce prípojky sa hlásia ako info, studňa nahrádza vodu", () => {
    const result = computeEstimate({ basePriceInclVat: 287000, finish: "standard", base, study: { ...base }, prices: prices(), settings: s, extras: { heatPump: 0, chimney: 0, fireplace: 0, bathroomPackage: 0, accessories: {} } });
    const a = sanityCheck({ result, base, study: base, outdoor: { sewerM: 10, elecM: 20 } });
    expect(a.findings.find((f) => f.id === "chyba-voda")?.severity).toBe("info");
    const b = sanityCheck({ result, base, study: base, outdoor: { sewerM: 10, elecM: 20, extras: [{ key: "studna", qty: 1 }] } });
    expect(b.findings.some((f) => f.id === "chyba-voda")).toBe(false);
  });
});
