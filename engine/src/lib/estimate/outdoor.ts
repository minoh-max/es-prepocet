import { priceLine } from "./pricing";
import type { ElementLine, EstimateSettings, ExtraSel, OutdoorParams, OutdoorResult, OutdoorLine, PriceIndex } from "./types";

/**
 * Vonkajšie zariadenie (prípojky + spevnené plochy) – samostatný súpis mimo ceny domu.
 * Rozpočty ES (RP1, RP3): položky za ceny z číselníka, rekapitulácia presun hmôt 2 % → GZS 3,5 % → zisk a réžia 4 %, DPH 23 %, bez zľavy.
 */
export function computeOutdoor(
  o: OutdoorParams,
  prices: PriceIndex,
  s: EstimateSettings,
  accessories: Record<string, number> = {},
): OutdoorResult {
  const it = s.outdoorItems;
  const lines: OutdoorLine[] = [];
  const missing: string[] = [];
  const add = (group: OutdoorLine["group"], label: string, path: string | undefined, qty: number | undefined, opts: { required?: boolean; note?: string } = {}) => {
    if (qty == null || Number.isNaN(qty)) {
      if (opts.required) missing.push(label);
      return;
    }
    if (qty <= 0) return;
    const l: ElementLine = priceLine(prices, path, qty);
    lines.push({ group, label, pathCode: l.pathCode, name: l.name, unit: l.unit, quantity: qty, unitCost: l.unitCost, cost: l.cost, warning: l.warning, note: opts.note });
  };

  // Prípojky – dĺžky od domu po miesto napojenia / merania na pozemku
  add("pripojky", "Vodovodná prípojka", it.water, o.waterM, { required: true });
  if (o.sewage !== "zumpa" && o.sewage !== "cov") add("pripojky", "Kanalizačná prípojka", it.sewer, o.sewerM, { required: true });
  else add("pripojky", "Kanalizačné potrubie k žumpe / ČOV", it.sewer, o.sewerM, { required: true });
  add("pripojky", "Dažďová kanalizácia", it.rain, o.rainM);
  if (o.gas) add("pripojky", "Plynová prípojka", it.gas, o.gasM, { required: true });
  add("pripojky", "Elektrická prípojka (kábel do elektromerového rozvádzača)", it.elec, o.elecM, { required: true });
  add("pripojky", "Ovládací kábel k elektrickej prípojke", it.controlCable, o.controlCableM ?? o.elecM);

  // Šachty, žumpa, meranie
  if (o.waterMeterPit) add("objekty", "Vodomerná šachta", o.waterMeterPit, 1);
  if (o.sewage === "zumpa") add("objekty", "Žumpa", o.sewagePath || it.cesspool, 1);
  if (o.sewage === "cov") add("objekty", "Domáca čistička odpadových vôd", o.sewagePath || it.treatment, 1);
  add("objekty", "Revízna kanalizačná šachtica", it.revisionPit, o.revisionPits);
  if (o.pumpStation) add("objekty", "Čerpacia šachta", o.pumpStation, 1);
  add("objekty", "Lapač strešných splavenín", it.roofTrap, o.roofTraps);
  if (o.gas && o.gasPost !== false) add("objekty", "Pilierik merania plynu (HUP)", it.gasPost, 1);
  if (o.elecPost !== false) add("objekty", "Pilierik merania elektriny (RE)", it.elecPost, 1);

  // Spevnené plochy – zámková dlažba do piesku, obrubník, štrkové lôžko (ako v rozpočtoch)
  const paved = (label: string, m2: number | undefined, curbM: number | undefined) => {
    if (!m2) return;
    add("plochy", `${label} – zámková dlažba`, it.paving, m2);
    add("plochy", `${label} – obrubník`, it.curb, curbM ?? Math.round(s.outdoorRules.curbFactor * Math.sqrt(m2) * 100) / 100, { note: curbM == null ? "odhad podľa plochy" : undefined });
    add("plochy", `${label} – štrkové lôžko`, it.gravel, Math.round(m2 * s.outdoorRules.gravelM3PerM2 * 100) / 100);
  };
  paved("Terasa", o.terraceM2, o.terraceCurbM);
  paved("Spevnené plochy", o.pavedM2, o.pavedCurbM);
  add("plochy", "Okapový chodník", o.dripPathType === "dlazba" ? it.dripPaved : it.dripGravel, o.dripPathM2);
  add("plochy", "Parkový trávnik", it.lawn, o.lawnM2);

  // Ďalšie položky na pozemku zo štúdie (skupina „Pozemok“ v nadštandardoch)
  let companyInclVat = 0;
  for (const x of o.extras || []) {
    const def = s.extrasCatalog.find((d) => d.key === x.key);
    const label = def ? def.label : x.key;
    const q = Number(x.qty) || 0;
    if (!q) { missing.push(label + " – množstvo"); continue; }
    if (!def || def.pricing.type === "none") {
      lines.push({ group: "ine", label, pathCode: "", name: label, unit: def?.unit ?? "ks", quantity: q, unitCost: 0, cost: 0, warning: "cena individuálne", note: x.note });
    } else if (def.pricing.type === "company") {
      const pr = accessories[def.pricing.accessoryId];
      companyInclVat += q * (pr ?? 0);
      lines.push({ group: "ine", label, pathCode: "", name: label, unit: def.unit, quantity: q, unitCost: 0, cost: 0, inclVat: q * (pr ?? 0), warning: pr == null ? "chýba cena z konfigurátora" : undefined, note: x.note });
    } else if (def.pricing.type === "item") {
      const pl = def.pricing.paths.map((p) => priceLine(prices, p, 1));
      const uc = pl.reduce((a, l) => a + l.cost, 0);
      lines.push({ group: "ine", label, pathCode: def.pricing.paths[0], name: label, unit: def.unit, quantity: q, unitCost: uc, cost: uc * q, warning: pl.find((l) => l.warning)?.warning, note: x.note });
    } else {
      const uc = s.rates[def.pricing.rateKey] ?? 0;
      lines.push({ group: "ine", label, pathCode: "", name: label, unit: def.unit, quantity: q, unitCost: uc, cost: uc * q, note: x.note });
    }
  }

  const r = s.outdoorRates;
  const direct = lines.reduce((a, l) => a + l.cost, 0);
  const presun = direct * r.presunHmot;
  const gzs = (direct + presun) * r.gzs;
  const zisk = (direct + presun + gzs) * r.ziskRezia;
  const exclVat = direct + presun + gzs + zisk;
  const vat = exclVat * s.vatRate;
  return {
    lines, missing, directCost: direct, presunHmot: presun, gzs, ziskRezia: zisk,
    exclVat, vat, inclVat: exclVat + vat + companyInclVat, companyInclVat,
  };
}

export const isOutdoorExtra = (s: EstimateSettings, key: string) =>
  (s.extrasCatalog.find((d) => d.key === key)?.group ?? "") === s.outdoorRules.extrasGroup;

export const splitExtras = (s: EstimateSettings, extras: ExtraSel[] = []) => ({
  house: extras.filter((x) => !isOutdoorExtra(s, x.key)),
  outdoor: extras.filter((x) => isOutdoorExtra(s, x.key)),
});
