import { openingArea, sumOpenings } from "./geometry";
import { itemLabel, priceLine } from "./pricing";
import type {
  BathroomDetail, CompanyExtras, ElementLine, EstimateSettings, Geometry, HouseParams, MaterialChoices, Opening, PriceIndex,
} from "./types";

export type MaterialRole = keyof Omit<MaterialChoices, "floorInsulationThicknessM">;

export interface SideContext {
  p: HouseParams;
  g: Geometry;
  m: Required<MaterialChoices>;
  s: EstimateSettings;
  prices: PriceIndex;
  extras: CompanyExtras;
}

export interface SideComputation {
  quantity: number;
  unit: string;
  materialLabel?: string;
  lines: ElementLine[];
  /** Cost already including VAT (company prices) – not multiplied by markup/VAT. */
  companyCostInclVat?: number;
  warnings?: string[];
}

export interface ElementDef {
  key: string;
  label: string;
  group: "Hrubá stavba" | "Strecha" | "Zateplenie" | "Výplne otvorov" | "Úpravy povrchov" | "Inštalácie" | "Vybavenie" | "Ostatné";
  pricedBy: "ciselnik" | "firma" | "sadzba";
  /** Is the element part of the holodom price? */
  inHolodom: boolean;
  /** Part of the shell (hrubá uzatvorená stavba) – priced with the shell markup. */
  shell?: boolean;
  role?: MaterialRole;
  compute(c: SideContext): SideComputation;
}

const item = (c: SideContext, key: keyof EstimateSettings["items"]) => c.s.items[key];
const label = (c: SideContext, path?: string) => (path ? itemLabel(c.prices[path]) : undefined);
const isFlat = (p: HouseParams) => p.roofType === "plocha";

/** Synthetic line priced by an admin unit rate (not from číselník). */
function rateLine(name: string, unit: string, quantity: number, rate: number): ElementLine {
  return { pathCode: "", name, unit, quantity, unitCost: rate, cost: quantity * rate };
}

export const ELEMENTS: ElementDef[] = [
  {
    key: "zemne", label: "Zemné práce", group: "Hrubá stavba", pricedBy: "ciselnik", inHolodom: true, shell: true,
    compute: (c) => {
      const trench = c.g.foundationLengthM * 0.6 * 1.0;
      return {
        quantity: trench, unit: "m³",
        lines: [
          priceLine(c.prices, item(c, "excavation"), trench),
          priceLine(c.prices, item(c, "soilRemoval"), trench * 0.5),
          priceLine(c.prices, item(c, "backfill"), trench * 0.3),
        ],
      };
    },
  },
  {
    key: "zaklady", label: "Základy a základová doska", group: "Hrubá stavba", pricedBy: "ciselnik", inHolodom: true, shell: true,
    compute: (c) => {
      const f = c.p.foundation;
      const type = f?.type ?? "pasy";
      const L = c.g.foundationLengthM;
      const stripDepth = f?.stripDepthM ?? (type === "pasy_dt" ? 0.4 : 0.8);
      const stripW = f?.stripWidthM ?? 0.5;
      const strips = type === "doska" ? 0 : L * stripW * stripDepth;
      const slab = c.p.builtAreaM2 * (f?.slabThicknessM ?? (type === "doska" ? 0.25 : 0.15));
      const gravel = c.p.builtAreaM2 * (f?.gravelThicknessM ?? 0.15);
      const label = type === "doska" ? "základová doska" : type === "pasy_dt" ? "pásy + DT tvárnice + doska" : "pásy + doska";
      return {
        quantity: c.p.builtAreaM2, unit: "m² zastavanej plochy", materialLabel: label,
        lines: [
          priceLine(c.prices, item(c, "foundationConcrete"), strips),
          priceLine(c.prices, item(c, "slabConcrete"), slab),
          priceLine(c.prices, item(c, "foundationRebar"), slab * 0.08 + strips * 0.02),
          priceLine(c.prices, item(c, "gravel"), gravel),
        ],
      };
    },
  },
  {
    key: "zaklady_dt", label: "Základové murivo z DT tvárnic", group: "Hrubá stavba", pricedBy: "ciselnik", inHolodom: true, shell: true,
    compute: (c) => {
      const f = c.p.foundation;
      if (!f || f.type !== "pasy_dt" || !f.dtRows) return { quantity: 0, unit: "ks", materialLabel: "bez DT tvárnic", lines: [] };
      const rowH = (f.dtRowHeightMm ?? 250) / 1000;
      const area = c.g.foundationLengthM * f.dtRows * rowH;
      const th = f.dtThicknessMm ?? 300;
      const keys = Object.keys(c.s.dtBlocks).map(Number).sort((a, b) => Math.abs(a - th) - Math.abs(b - th));
      const path = c.s.dtBlocks[String(keys[0])];
      const pieces = Math.ceil(area / (0.5 * rowH));
      return {
        quantity: pieces, unit: "ks DT", materialLabel: `${f.dtRows} rady × ${th} mm`,
        lines: [priceLine(c.prices, path, area), priceLine(c.prices, item(c, "dtRebar"), area * 0.004)],
      };
    },
  },
  {
    key: "hydroizolacia", label: "Hydroizolácia spodnej stavby", group: "Hrubá stavba", pricedBy: "ciselnik", inHolodom: true, shell: true,
    compute: (c) => ({
      quantity: c.p.builtAreaM2 * 1.15, unit: "m²",
      lines: [priceLine(c.prices, item(c, "waterproofing"), c.p.builtAreaM2 * 1.15)],
    }),
  },
  {
    key: "murivo_obvodove", label: "Obvodové murivo", group: "Hrubá stavba", pricedBy: "ciselnik", inHolodom: true, shell: true, role: "wall",
    compute: (c) => ({
      quantity: c.g.facadeNetM2, unit: "m²", materialLabel: label(c, c.m.wall),
      lines: [priceLine(c.prices, c.m.wall, c.g.facadeNetM2)],
    }),
  },
  {
    key: "murivo_vnutorne", label: "Vnútorné nosné murivo", group: "Hrubá stavba", pricedBy: "ciselnik", inHolodom: true, shell: true, role: "interiorWall",
    compute: (c) => ({
      quantity: c.g.interiorBearingM2, unit: "m²", materialLabel: label(c, c.m.interiorWall),
      lines: [priceLine(c.prices, c.m.interiorWall, c.g.interiorBearingM2)],
    }),
  },
  {
    key: "pricky", label: "Priečky", group: "Hrubá stavba", pricedBy: "ciselnik", inHolodom: true, role: "partition",
    compute: (c) => ({
      quantity: c.g.partitionM2, unit: "m²", materialLabel: label(c, c.m.partition),
      lines: [priceLine(c.prices, c.m.partition, c.g.partitionM2)],
    }),
  },
  {
    key: "stropy", label: "Stropy", group: "Hrubá stavba", pricedBy: "ciselnik", inHolodom: true, shell: true,
    compute: (c) => {
      const conc = c.g.ceilingM2 * 0.2;
      return {
        quantity: c.g.ceilingM2, unit: "m²",
        lines: [
          priceLine(c.prices, item(c, "ceilingConcrete"), conc),
          priceLine(c.prices, item(c, "ceilingRebar"), conc * 0.09),
        ],
      };
    },
  },
  {
    key: "vence", label: "Vence a stužujúce pásy", group: "Hrubá stavba", pricedBy: "ciselnik", inHolodom: true, shell: true,
    compute: (c) => ({
      quantity: c.g.ringBeamM3, unit: "m³",
      lines: [
        priceLine(c.prices, item(c, "ringBeamConcrete"), c.g.ringBeamM3),
        priceLine(c.prices, item(c, "ringBeamRebar"), c.g.ringBeamM3 * 0.1),
      ],
    }),
  },
  {
    key: "preklady", label: "Preklady", group: "Hrubá stavba", pricedBy: "ciselnik", inHolodom: true, shell: true,
    compute: (c) => ({
      quantity: c.g.windowsCount, unit: "otvorov",
      lines: [priceLine(c.prices, item(c, "lintel"), c.g.windowsCount * 3)],
    }),
  },
  {
    key: "krov", label: "Krov", group: "Strecha", pricedBy: "ciselnik", inHolodom: true, shell: true,
    compute: (c) => {
      const v = isFlat(c.p) ? 0 : c.g.roofAreaM2 * 0.03;
      return { quantity: v, unit: "m³", lines: [priceLine(c.prices, item(c, "roofTimber"), v)] };
    },
  },
  {
    key: "krytina", label: "Strešná krytina", group: "Strecha", pricedBy: "ciselnik", inHolodom: true, shell: true, role: "roofing",
    compute: (c) => {
      const a = c.g.roofAreaM2;
      if (isFlat(c.p)) {
        return {
          quantity: a, unit: "m²", materialLabel: label(c, c.m.flatRoofing),
          lines: [priceLine(c.prices, c.m.flatRoofing, a)],
        };
      }
      return {
        quantity: a, unit: "m²", materialLabel: label(c, c.m.roofing),
        lines: [
          priceLine(c.prices, c.m.roofing, a),
          priceLine(c.prices, item(c, "battens"), a),
          priceLine(c.prices, item(c, "roofMembrane"), a),
        ],
      };
    },
  },
  {
    key: "klampiarske", label: "Žľaby a zvody", group: "Strecha", pricedBy: "ciselnik", inHolodom: true, shell: true,
    compute: (c) => ({ quantity: c.g.gutterM, unit: "m", lines: [priceLine(c.prices, item(c, "gutters"), c.g.gutterM)] }),
  },
  {
    key: "zateplenie_fasady", label: "Zateplenie fasády", group: "Zateplenie", pricedBy: "ciselnik", inHolodom: true, role: "facade",
    compute: (c) => ({
      quantity: c.g.facadeNetM2, unit: "m²", materialLabel: label(c, c.m.facade),
      lines: [
        priceLine(c.prices, c.m.facade, c.g.facadeNetM2),
        priceLine(c.prices, item(c, "plinthInsulation"), c.g.perimeterM * 0.6),
      ],
    }),
  },
  {
    key: "zateplenie_strechy", label: "Zateplenie strechy / stropu", group: "Zateplenie", pricedBy: "ciselnik", inHolodom: true, role: "roofInsulation",
    compute: (c) => ({
      quantity: c.g.roofInsulationM2, unit: "m²",
      materialLabel: [label(c, c.m.roofInsulation), c.m.roofInsulation2 ? label(c, c.m.roofInsulation2) : ""].filter(Boolean).join(" + "),
      lines: [priceLine(c.prices, c.m.roofInsulation, c.g.roofInsulationM2), ...(c.m.roofInsulation2 ? [priceLine(c.prices, c.m.roofInsulation2, c.g.roofInsulationM2)] : [])],
    }),
  },
  {
    key: "izolacia_podlah", label: "Izolácia podláh", group: "Zateplenie", pricedBy: "ciselnik", inHolodom: true, role: "floorInsulation",
    compute: (c) => {
      const v = c.g.groundFloorM2 * c.m.floorInsulationThicknessM;
      return {
        quantity: c.g.groundFloorM2, unit: "m²", materialLabel: `${label(c, c.m.floorInsulation) ?? ""} ${Math.round(c.m.floorInsulationThicknessM * 1000)} mm`.trim(),
        lines: [priceLine(c.prices, c.m.floorInsulation, v)],
      };
    },
  },
  {
    key: "okna", label: "Okná a balkónové dvere", group: "Výplne otvorov", pricedBy: "ciselnik", inHolodom: true, shell: true, role: "window",
    compute: (c) => {
      const ops = c.p.openings;
      if (!ops || !ops.length) {
        // bez výpisu otvorov: plocha okien × cena za m² (číselník)
        return { quantity: c.g.windowsAreaM2, unit: "m² okien", materialLabel: label(c, c.m.window), lines: [priceLine(c.prices, c.m.window, c.g.windowsAreaM2)] };
      }
      // ceny okien a balkónových dverí v číselníku sú za m² (rozpočet: plocha × cena), posuvné = 2× cena dvojkrídlových
      const lines: ElementLine[] = [];
      const areaOf = (list: Opening[]) => list.reduce((a, o) => a + openingArea(o), 0);
      const pair = (single: string, fallback: string) => {
        const twin = single.replace(/1$/, "2");
        return twin !== single && c.prices[twin] ? twin : fallback;
      };
      const win = ops.filter((o) => o.type === "okno");
      const single = win.filter((o) => !(o.widthM && o.widthM > 1.25));
      const double = win.filter((o) => o.widthM && o.widthM > 1.25);
      if (single.length) lines.push(priceLine(c.prices, c.m.window, areaOf(single)));
      if (double.length) lines.push(priceLine(c.prices, pair(c.m.window, item(c, "windowDouble")), areaOf(double)));
      const balc = ops.filter((o) => o.type === "balkonove");
      if (balc.length) {
        lines.push(priceLine(c.prices, item(c, "balconyDoor"), areaOf(balc.filter((o) => !(o.widthM && o.widthM >= 1.4)))));
        lines.push(priceLine(c.prices, item(c, "balconyDoorDouble"), areaOf(balc.filter((o) => o.widthM && o.widthM >= 1.4))));
      }
      const hs = sumOpenings(ops, ["hs"]);
      if (hs.count) {
        const l = priceLine(c.prices, item(c, "balconyDoorDouble"), hs.area * (c.s.rates.slidingFactor ?? 2));
        lines.push({ ...l, name: `${l.name} – posuvné (HS) ×${c.s.rates.slidingFactor ?? 2}` });
      }
      const area = sumOpenings(ops, ["okno", "balkonove", "hs"]);
      return {
        quantity: area.area, unit: "m² okien", materialLabel: `${label(c, c.m.window)}${hs.count ? `, ${hs.count}× HS portál` : ""}`,
        lines: lines.filter((l) => l.quantity > 0),
      };
    },
  },
  {
    key: "dvere_vchodove", label: "Vchodové dvere", group: "Výplne otvorov", pricedBy: "ciselnik", inHolodom: true, shell: true,
    compute: (c) => {
      const ops = c.p.openings;
      const main = ops && ops.length ? sumOpenings(ops, ["vchodove"]).count : 1;
      const side = ops && ops.length ? sumOpenings(ops, ["vedlajsie"]).count : 0;
      return {
        quantity: main + side, unit: "ks",
        lines: [
          priceLine(c.prices, item(c, "entranceDoor"), main),
          priceLine(c.prices, item(c, "sideDoor"), side),
          priceLine(c.prices, item(c, "entranceDoorMount"), main + side),
        ].filter((l) => l.quantity > 0),
      };
    },
  },
  {
    key: "dvere_vnutorne", label: "Vnútorné dvere a zárubne", group: "Výplne otvorov", pricedBy: "ciselnik", inHolodom: false,
    compute: (c) => {
      const ops = c.p.openings;
      const n = ops && ops.some((o) => o.type === "vnutorne") ? sumOpenings(ops, ["vnutorne"]).count : Math.round(c.p.usableAreaM2 / 13);
      return {
        quantity: n, unit: "ks",
        lines: [
          priceLine(c.prices, item(c, "interiorDoor"), n),
          priceLine(c.prices, item(c, "interiorFrame"), n),
          priceLine(c.prices, item(c, "interiorDoorMount"), n),
          priceLine(c.prices, item(c, "interiorFrameMount"), n),
        ],
      };
    },
  },
  {
    key: "stresne_okna", label: "Strešné okná", group: "Výplne otvorov", pricedBy: "ciselnik", inHolodom: true, shell: true,
    compute: (c) => {
      const n = sumOpenings(c.p.openings, ["stresne"]).count;
      return { quantity: n, unit: "ks", lines: n ? [priceLine(c.prices, item(c, "roofWindow"), n)] : [] };
    },
  },
  {
    key: "omietky", label: "Vnútorné omietky a maľby", group: "Úpravy povrchov", pricedBy: "ciselnik", inHolodom: true,
    compute: (c) => {
      const walls = c.g.partitionM2 * 2 + c.g.perimeterM * c.g.exteriorWallHeightM + c.g.interiorBearingM2 * 2;
      const ceil = c.p.usableAreaM2;
      return {
        quantity: walls + ceil, unit: "m²",
        lines: [
          priceLine(c.prices, item(c, "interiorPlaster"), walls),
          priceLine(c.prices, item(c, "ceilingPlaster"), ceil),
          priceLine(c.prices, item(c, "painting"), walls + ceil),
        ],
      };
    },
  },
  {
    key: "podlahy", label: "Podlahy (mazanina)", group: "Úpravy povrchov", pricedBy: "ciselnik", inHolodom: true,
    compute: (c) => ({ quantity: c.p.usableAreaM2, unit: "m²", lines: [priceLine(c.prices, item(c, "screed"), c.p.usableAreaM2)] }),
  },
  {
    key: "obklady", label: "Obklady a dlažby", group: "Úpravy povrchov", pricedBy: "ciselnik", inHolodom: false,
    compute: (c) => {
      const wc = c.p.wcs ?? 1;
      const floor = c.p.bathrooms * 6 + wc * 2 + c.p.usableAreaM2 * 0.15;
      const wall = c.p.bathrooms * 22 + wc * 8;
      return {
        quantity: floor + wall, unit: "m²",
        lines: [
          priceLine(c.prices, item(c, "tiles"), floor),
          priceLine(c.prices, item(c, "tilesLaying"), floor),
          priceLine(c.prices, item(c, "wallTiles"), wall),
          priceLine(c.prices, item(c, "wallTilesLaying"), wall),
        ],
      };
    },
  },
  {
    key: "lesenie", label: "Lešenie", group: "Ostatné", pricedBy: "ciselnik", inHolodom: true,
    compute: (c) => {
      const q = c.g.scaffoldingM2 * (c.s.rates.scaffoldingFactor ?? 1);
      return { quantity: q, unit: "m²", lines: [priceLine(c.prices, item(c, "scaffolding"), q)] };
    },
  },
  {
    key: "elektro", label: "Elektroinštalácia", group: "Inštalácie", pricedBy: "sadzba", inHolodom: true,
    compute: (c) => ({
      quantity: c.p.usableAreaM2, unit: "m²",
      lines: [
        rateLine("Elektroinštalácia – základ", "sb", 1, c.s.rates.electroBase ?? 0),
        rateLine("Elektroinštalácia (sadzba na m²)", "m²", c.p.usableAreaM2, c.s.rates.electroPerM2),
      ],
    }),
  },
  {
    key: "zti", label: "Voda a kanalizácia", group: "Inštalácie", pricedBy: "sadzba", inHolodom: true,
    compute: (c) => ({
      quantity: c.p.bathrooms, unit: "kúpeľní",
      lines: [
        rateLine("Rozvody vody a kanalizácie – základ", "sb", 1, c.s.rates.plumbingBase ?? 0),
        rateLine("Rozvody ZTI na kúpeľňu", "ks", c.p.bathrooms, c.s.rates.plumbingPerBathroom),
        rateLine("Rozvody ZTI na WC", "ks", c.p.wcs ?? 1, c.s.rates.plumbingPerWc),
      ],
    }),
  },
  {
    key: "vykurovanie_rozvod", label: "Rozvod vykurovania", group: "Inštalácie", pricedBy: "ciselnik", inHolodom: true,
    compute: (c) => {
      const a = c.p.usableAreaM2;
      const lines =
        c.p.heatingDistribution === "podlahove"
          ? [priceLine(c.prices, item(c, "floorHeating"), a * (c.s.rates.floorHeatingAreaFactor ?? 0.85)), rateLine("Rozvod ÚK (sadzba)", "m²", a, c.s.rates.heatingDistributionPerM2)]
          : [rateLine("Radiátory (sadzba)", "m²", a, c.s.rates.radiatorsPerM2), rateLine("Rozvod ÚK (sadzba)", "m²", a, c.s.rates.heatingDistributionPerM2)];
      lines.push(rateLine("Rozvod ÚK – základ", "sb", 1, c.s.rates.heatingDistributionBase ?? 0));
      return { quantity: a, unit: "m²", materialLabel: c.p.heatingDistribution === "podlahove" ? "podlahové kúrenie" : "radiátory", lines };
    },
  },
  {
    key: "zdroj_tepla", label: "Zdroj tepla", group: "Inštalácie", pricedBy: "firma", inHolodom: false,
    compute: (c) => {
      const src = c.p.heatingSource;
      const names = { plyn: "plynový kondenzačný kotol (štandard)", tc: "tepelné čerpadlo", elektro: "elektrokúrenie", tuhe: "kotol na tuhé palivo" } as const;
      const warnings: string[] = [];
      let incl = 0;
      if (src === "tc") {
        if (c.extras.heatPump == null) warnings.push("Chýba cena tepelného čerpadla z konfigurátora");
        incl = c.extras.heatPump ?? 0;
      } else if (src === "elektro") {
        incl = -c.s.rates.electricHeatingSaving * c.s.markup * (1 + c.s.vatRate);
      } else if (src === "tuhe") {
        warnings.push("Kotol na tuhé palivo nie je v cenníku firmy – doplniť ručne");
      }
      return { quantity: 1, unit: "ks", materialLabel: names[src], lines: [], companyCostInclVat: incl, warnings };
    },
  },
  {
    key: "rekuperacia", label: "Rekuperácia", group: "Inštalácie", pricedBy: "sadzba", inHolodom: false,
    compute: (c) => ({
      quantity: c.p.usableAreaM2, unit: "m²", materialLabel: c.p.centralRecuperation ? "centrálna" : "decentrálna (štandard)",
      lines: c.p.centralRecuperation
        ? [rateLine("Príplatok za centrálnu rekuperáciu", "m²", c.p.usableAreaM2, c.s.rates.centralRecuperationPerM2)]
        : [rateLine("Decentrálne rekuperačné jednotky", "ks", c.p.floorsType === "bungalov" ? 4 : 6, c.s.rates.recuperationUnit ?? 0)],
    }),
  },
  {
    key: "kupelne", label: "Zariaďovacie predmety v kúpeľniach", group: "Vybavenie", pricedBy: "ciselnik", inHolodom: false,
    compute: (c) => {
      const list = bathroomsOf(c.p, c.s);
      const sum = (k: keyof BathroomDetail) => list.reduce((a, b) => a + (Number(b[k]) || 0), 0);
      const fx = c.s.fixtures;
      const tubs = sum("bathtub"), corner = sum("cornerTub"), free = sum("freestandingTub"), shower = sum("shower"), drain = sum("showerDrain");
      const basins = sum("washbasins"), wc = sum("wc"), wcH = sum("wcWallHung"), bidet = sum("bidet");
      const lines = [
        priceLine(c.prices, fx.bathtub, tubs), priceLine(c.prices, fx.cornerTub, corner), priceLine(c.prices, fx.freestandingTub, free),
        priceLine(c.prices, fx.bathtubTap, tubs + corner), priceLine(c.prices, fx.floorTubTap, free),
        priceLine(c.prices, fx.shower, shower), priceLine(c.prices, fx.showerDrain, drain), priceLine(c.prices, fx.showerTap, shower + drain),
        priceLine(c.prices, fx.washbasin, basins), priceLine(c.prices, fx.basinTap, basins),
        priceLine(c.prices, fx.wc, wc), priceLine(c.prices, fx.wcWallHung, wcH), priceLine(c.prices, fx.bidet, bidet), priceLine(c.prices, fx.bidetTap, bidet),
        priceLine(c.prices, fx.mountWc, wc + wcH + bidet), priceLine(c.prices, fx.mountBasin, basins), priceLine(c.prices, fx.mountTub, tubs + corner + free + shower + drain),
        priceLine(c.prices, fx.mountTap, tubs + corner + free + shower + drain + basins + bidet),
      ].filter((l) => l.quantity > 0);
      const parts = [
        tubs + corner ? `${tubs + corner}× vaňa` : "", free ? `${free}× voľne stojaca vaňa` : "", shower ? `${shower}× sprch. kút` : "",
        drain ? `${drain}× sprcha so žľabom` : "", wcH ? `${wcH}× závesné WC` : "", bidet ? `${bidet}× bidet` : "",
      ].filter(Boolean).join(", ");
      return { quantity: list.length, unit: "miestností", materialLabel: parts || "štandard", lines };
    },
  },
  {
    key: "komin_krb", label: "Komín a krb", group: "Vybavenie", pricedBy: "firma", inHolodom: true,
    compute: (c) => ({
      quantity: (c.p.chimney ? 1 : 0) + (c.p.fireplace ? 1 : 0), unit: "ks",
      materialLabel: [c.p.chimney ? "komín" : "", c.p.fireplace ? (c.s.fireplaceByClient !== false ? "krb – dodáva klient" : "krb") : ""].filter(Boolean).join(" + ") || "bez komína",
      lines: [],
      // krb (kachle, vložku) si podľa praxe ES dodáva klient sám – účtuje sa len komín (nastaviteľné: fireplaceByClient)
      companyCostInclVat: (c.p.chimney ? c.extras.chimney ?? 0 : 0) + (c.p.fireplace && c.s.fireplaceByClient === false ? c.extras.fireplace ?? 0 : 0),
    }),
  },
  {
    key: "garaz", label: "Garážová brána", group: "Výplne otvorov", pricedBy: "ciselnik", inHolodom: true, shell: true,
    compute: (c) => {
      const n = c.p.openings && c.p.openings.length ? sumOpenings(c.p.openings, ["garazova"]).count : c.p.garages ?? 0;
      return { quantity: n, unit: "ks", lines: [priceLine(c.prices, item(c, "garageDoor"), n)] };
    },
  },
];

/** Bathrooms of a house: detailed list if known, otherwise the standard composition from settings. */
export function bathroomsOf(p: HouseParams, s: EstimateSettings): BathroomDetail[] {
  if (p.bathroomsDetail && p.bathroomsDetail.length) return p.bathroomsDetail;
  const out: BathroomDetail[] = [];
  for (let i = 0; i < (p.bathrooms || 0); i++) out.push(i === 0 ? s.standardBathroom.first : s.standardBathroom.other);
  for (let i = 0; i < (p.wcs ?? 1); i++) out.push(s.standardBathroom.wc);
  return out;
}
