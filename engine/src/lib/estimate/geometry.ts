import { EXTERIOR_OPENINGS } from "./types";
import type { EstimateSettings, Geometry, HouseParams, Opening, OpeningType } from "./types";

/** Default size of an opening when the schedule has no dimensions. */
export const DEFAULT_OPENING_AREA: Record<OpeningType, number> = {
  okno: 1.6, balkonove: 2.2, hs: 5.0, vchodove: 2.3, vedlajsie: 2.0, garazova: 4.8, vnutorne: 1.6, stresne: 1.1,
};
export const openingArea = (o: Opening) =>
  (o.widthM && o.heightM ? o.widthM * o.heightM : DEFAULT_OPENING_AREA[o.type] ?? 1.6) * (o.count || 0);
export const sumOpenings = (ops: Opening[] | undefined, types: OpeningType[]) =>
  (ops || []).filter((o) => types.includes(o.type)).reduce((a, o) => ({ area: a.area + openingArea(o), count: a.count + (o.count || 0) }), { area: 0, count: 0 });

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Derives construction quantities from house parameters. Same formulas are used for base and study. */
export function computeGeometry(p: HouseParams, s: EstimateSettings): Geometry {
  const h = p.storeyHeightM ?? s.defaults.storeyHeightM;
  const knee = p.kneeWallM ?? s.defaults.kneeWallM;
  const overhang = p.roofOverhangM ?? s.defaults.roofOverhangM;
  const flat = p.roofType === "plocha";
  const pitch = flat ? 0 : (p.roofPitchDeg ?? (p.floorsType === "podkrovie" ? s.defaults.roofPitchAtticDeg ?? s.defaults.roofPitchDeg : p.floorsType === "bungalov" ? s.defaults.roofPitchBungalowDeg ?? s.defaults.roofPitchDeg : s.defaults.roofPitchDeg));

  const w = p.widthM && p.lengthM ? Math.min(p.widthM, p.lengthM) : undefined;
  const l = p.widthM && p.lengthM ? Math.max(p.widthM, p.lengthM) : undefined;

  // Obvod: zadaný > z rozmerov (+5 % na členitosť) > zo zastavanej plochy
  const perimeterM =
    p.perimeterM ?? (w && l ? 2 * (w + l) * 1.05 : 4 * Math.sqrt(p.builtAreaM2) * 1.1);

  const storeys = p.floorsType === "poschodovy" ? Math.max(2, Math.round(p.storeys ?? 2)) : 1;
  const exteriorWallHeightM =
    p.floorsType === "poschodovy" ? storeys * h : p.floorsType === "podkrovie" ? h + knee : h;

  // Štíty (len sedlová / pultová / kombinovaná strecha)
  const span = w ?? Math.sqrt(p.builtAreaM2);
  let gableM2 = 0;
  if (p.roofType === "sedlova") gableM2 = 2 * (0.25 * span * span * Math.tan(rad(pitch)));
  else if (p.roofType === "kombinovana") gableM2 = 0.25 * span * span * Math.tan(rad(pitch));
  else if (p.roofType === "pultova") gableM2 = span * span * Math.tan(rad(pitch));
  else if (flat) gableM2 = perimeterM * 0.6; // atika

  const facadeGrossM2 = perimeterM * exteriorWallHeightM + gableM2;

  // Otvory v obvodovom plášti: výpis otvorov > zadaná plocha > z počtu (1,8 m²/ks) > 16 % úžitkovej plochy
  const ext = p.openings && p.openings.length ? sumOpenings(p.openings, EXTERIOR_OPENINGS) : null;
  const windowsAreaM2 = ext
    ? ext.area
    : p.windowsAreaM2 ?? (p.windowsCount ? p.windowsCount * 1.8 : p.usableAreaM2 * 0.16);
  const windowsCount = ext ? ext.count : p.windowsCount ?? Math.max(1, Math.round(windowsAreaM2 / 1.8));
  const facadeNetM2 = Math.max(0, facadeGrossM2 - windowsAreaM2);

  // pôdorys s presahom zo zastavanej plochy a obvodu (obdĺžnik okolo domu nadhodnocuje členité domy:
  // 25/120 by mal 205 m² strechy namiesto 180 m² z rozpočtu)
  const footprintWithOverhangM2 =
    p.builtAreaM2 ? p.builtAreaM2 + perimeterM * overhang : w && l ? (w + 2 * overhang) * (l + 2 * overhang) : 0;
  // valbová: plocha krytiny v rozpočtoch = 1,07 – 1,10 × (zastavaná + obvod × presah) / cos(sklon) (25/115, 25/120, 25/130, 23/107)
  const shapeFactor =
    p.roofType === "kombinovana" ? 1.12 : p.roofType === "valbova" ? 1.08 : 1.0;
  const roofAreaM2 = flat
    ? p.builtAreaM2 * 1.02
    : (footprintWithOverhangM2 / Math.cos(rad(pitch))) * shapeFactor;

  const interiorBearingLengthM = p.interiorBearingLengthM ?? perimeterM * 0.35;
  const foundationLengthM = p.foundation?.lengthM ?? perimeterM + interiorBearingLengthM;
  const interiorBearingM2 = interiorBearingLengthM * h * storeys;
  const partitionM2 = p.partitionAreaM2 ?? p.usableAreaM2 * 0.6;

  // Strop medzi podlažiami (monolit/strop.konštrukcia)
  const ceilingM2 =
    p.floorsType === "poschodovy" ? p.builtAreaM2 * 0.92 * (storeys - 1) : p.floorsType === "podkrovie" ? p.builtAreaM2 * 0.9 : 0;

  // Zateplenie strechy: podkrovie = šikminy, inak strop pod strechou / plochá strecha
  const roofInsulationM2 = p.floorsType === "podkrovie" && !flat ? roofAreaM2 * 0.85 : p.builtAreaM2 * 0.92;
  const groundFloorM2 = p.builtAreaM2 * 0.88;

  // Vence 0,3 × 0,25 m – pod každým stropom / pod krovom
  const ringBeams = p.floorsType === "poschodovy" ? storeys : 1;
  const ringBeamM3 = perimeterM * 0.3 * 0.25 * ringBeams;

  const scaffoldingM2 = facadeGrossM2;
  const gutterM =
    p.roofType === "sedlova" ? perimeterM * 0.55 : flat ? perimeterM * 0.25 : perimeterM;

  return {
    perimeterM,
    storeys,
    exteriorWallHeightM,
    facadeGrossM2,
    gableM2,
    windowsAreaM2,
    windowsCount,
    facadeNetM2,
    footprintWithOverhangM2,
    roofAreaM2,
    foundationLengthM,
    interiorBearingLengthM,
    interiorBearingM2,
    partitionM2,
    ceilingM2,
    roofInsulationM2,
    groundFloorM2,
    ringBeamM3,
    scaffoldingM2,
    gutterM,
  };
}
