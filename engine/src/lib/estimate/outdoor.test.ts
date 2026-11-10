import { describe, expect, it } from "vitest";
import { computeOutdoor, DEFAULT_ENGINE_SETTINGS } from "./index";
import type { PriceIndex } from "./types";

const s = DEFAULT_ENGINE_SETTINGS;
// Ceny z číselníka (cenová úroveň 260504) – materiál, práca, mechanizmy, pevná sadzba
const P: PriceIndex = {};
const add = (code: string, unit: string, mat: number, lab: number, mech = 0, fix = 0) =>
  (P[code] = { path_code: code, name: code, unit, price_material: mat, price_labor: lab, price_machinery: mech, fixed_rate: fix || null });
add("A3/001", "m", 19.22, 6.47);
add("A3/002", "m", 28.39, 9.78);
add("A3/003", "m", 23.43, 5.78);
add("A3/004", "m", 28.38, 6.47);
add("A3/005", "m", 8.65, 4.45);
add("A3/006", "m", 3.6, 0);
add("A3/007/standard 01", "ks", 171.22, 157.4);
add("A3/007/xxx/atyp 01", "ks", 1121.6, 157.4);
add("A3/008/B/standard 01", "sb", 1379.1, 1041.03, 0, 100);
add("A3/009/RŠ/standard 01", "ks", 171.22, 157.4);
add("A3/011", "ks", 24.21, 5.15);
add("A3/009/XXX/CS/čerpacia šachta Ekocis ČS4-EK", "sb", 1927.7, 347.8, 106.38);
add("A3/012", "ks", 431.52, 0);
add("A3/013", "ks", 431.52, 0);
add("A5/001/001", "m", 13.8, 3.7, 3);
add("A5/002/Haka 060 sivá", "m2", 11, 11, 3);
add("A5/003", "m3", 18.7, 17.6, 16);

describe("vonkajšie zariadenie podľa rozpočtov", () => {
  it("RP3 25/130 Bacsa (Vinica) – 13 936 € s DPH", () => {
    const r = computeOutdoor({
      waterM: 50.5, sewerM: 47, elecM: 62.5, gas: false, waterMeterPit: "A3/007/xxx/atyp 01", sewage: "zumpa",
      revisionPits: 3, elecPost: true, terraceM2: 18, terraceCurbM: 12.4,
    }, P, s);
    expect(r.missing).toEqual([]);
    expect(r.exclVat).toBeCloseTo(11329.95, 0);
    expect(Math.round(r.inclVat)).toBe(13936);
  });
  it("RP1 25/135 Belajová (Sielnica) – 7 337 € s DPH", () => {
    const r = computeOutdoor({
      waterM: 20.5, sewerM: 7.5, elecM: 13.5, gas: false, waterMeterPit: "", sewage: "zumpa",
      revisionPits: 1, elecPost: true, terraceM2: 21.15, terraceCurbM: 13.45,
    }, P, s);
    expect(r.exclVat).toBeCloseTo(5964.75, 0);
    expect(Math.round(r.inclVat)).toBe(7337);
  });
  it("RP8 21/226 Chriašteľ (Trnové) – verejná kanalizácia s čerpacou šachtou, 8 819 € s DPH", () => {
    const r = computeOutdoor({
      waterM: 20, sewerM: 18, elecM: 36, controlCableM: 30, gas: false, waterMeterPit: "A3/007/xxx/atyp 01", sewage: "verejna",
      revisionPits: 2, pumpStation: "A3/009/XXX/CS/čerpacia šachta Ekocis ČS4-EK", elecPost: true,
    }, P, s);
    expect(r.exclVat).toBeCloseTo(7169.57, 0);
    expect(Math.round(r.inclVat)).toBe(8819);
  });
  it("RP2 26/106 Holka (Vlkas) – 5 969 € s DPH", () => {
    const r = computeOutdoor({ waterM: 28, sewerM: 14, elecM: 19, gas: false, waterMeterPit: "", sewage: "zumpa", revisionPits: 1, elecPost: false }, P, s);
    expect(Math.round(r.inclVat)).toBe(5969);
  });
  it("RP2 25/115 Matúška (Chyžné) – 8 822 € s DPH", () => {
    const r = computeOutdoor({ waterM: 9.5, sewerM: 11, elecM: 14.5, gas: false, waterMeterPit: "A3/007/xxx/atyp 01", sewage: "zumpa", revisionPits: 1, elecPost: true, terraceM2: 20, terraceCurbM: 13.4 }, P, s);
    expect(Math.round(r.inclVat)).toBe(8822);
  });
  it("RP4 25/106 Mičúnek (Lipovec) – 3 620 € s DPH", () => {
    const r = computeOutdoor({ waterM: 7, sewerM: 13.5, elecM: 34, gas: false, waterMeterPit: "A3/007/standard 01", sewage: "verejna", revisionPits: 2, elecPost: true }, P, s);
    expect(Math.round(r.inclVat)).toBe(3620);
  });
  it("chýbajúce dĺžky prípojok sa hlásia, plyn len ak je zvolený", () => {
    const r = computeOutdoor({ sewage: "zumpa", gas: true, elecPost: true }, P, s);
    expect(r.missing).toEqual(["Vodovodná prípojka", "Kanalizačné potrubie k žumpe / ČOV", "Plynová prípojka", "Elektrická prípojka (kábel do elektromerového rozvádzača)"]);
    expect(r.lines.map((l) => l.label)).toContain("Pilierik merania plynu (HUP)");
  });
});
