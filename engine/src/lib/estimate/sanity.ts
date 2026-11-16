// Kontrola vnútornej konzistencie prepočtu (sanity check) pred odoslaním ponuky.
// Podľa promptu „Unit rate sanity check“ © 2026 Constructelligence, CC BY 4.0 – upravené pre ES.
// Zámerne NEhodnotí, či sú ceny trhovo správne: porovnáva len riadky medzi sebou, s geometriou domu a s podkladmi.
import type { EstimateResult, HouseParams, OutdoorParams, ElementDelta, EstimateSettings } from "./types";
import { defaultRoofPitch } from "./engine";

export type SanitySeverity = "chyba" | "upozornenie" | "info";
export type SanityOwner = "obchodník" | "rozpočtár";

export interface SanityFinding {
  id: string;
  severity: SanitySeverity;
  /** Riadok / prvok rozpočtu, ktorého sa zistenie týka. */
  line: string;
  /** Čo nesedí. */
  what: string;
  /** Prečo je to podozrivé. */
  why: string;
  /** Čo overiť. */
  check: string;
  /** Kto to overí. */
  owner: SanityOwner;
  /** Odhad, koľko peňazí zistenie môže pohnúť (s DPH), ak sa dá odhadnúť. */
  impactInclVat?: number;
  /** Detail s výrobnými cenami – zobrazovať len administrátorovi. */
  adminDetail?: string;
}

export interface SanityVerify { line: string; value: string; why: string; owner: SanityOwner; impactInclVat: number }

export interface SanityReport {
  findings: SanityFinding[];
  /** Tri čísla, ktoré treba pred odoslaním overiť proti vlastným dátam. */
  verify: SanityVerify[];
  counts: Record<SanitySeverity, number>;
}

export interface SanityInput {
  result: EstimateResult;
  base: HouseParams;
  study: HouseParams;
  outdoor?: OutdoorParams;
  /** Nastavenia výpočtu – pre štandardný sklon strechy, ak ho štúdia neuvádza. */
  settings?: EstimateSettings;
}

const n1 = (x: number, d = 1) => x.toLocaleString("sk-SK", { maximumFractionDigits: d, minimumFractionDigits: 0 }).replace(/ /g, " ");
const pct = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${n1(Math.abs(x), 0)} %`;
const eur = (x: number) => `${Math.round(x).toLocaleString("sk-SK").replace(/ /g, " ")} €`;

/** Prvky, ktorých množstvo by sa malo meniť približne s veľkosťou domu. */
const SIZE_SCALED = ["murivo_obvodove", "zateplenie_fasady", "omietky", "podlahy", "stropy", "lesenie", "elektro", "vykurovanie_rozvod", "izolacia_podlah", "zaklady"];
/** Prvky s jedným hlavným materiálom – rovnaký materiál = rovnaká cena za jednotku. */
const SINGLE_MATERIAL = ["murivo_obvodove", "murivo_vnutorne", "pricky", "zateplenie_fasady", "krytina", "lesenie", "podlahy", "izolacia_podlah"];

function hasOpening(p: HouseParams, type: string) {
  return (p.openings || []).some((o) => o.type === type && (o.count || 0) > 0);
}

/** Prvok má vo východiskovom dome náklad, v štúdii nulu – je to vysvetlené zadaním štúdie? */
function droppedExplained(key: string, p: HouseParams): boolean {
  switch (key) {
    case "garaz": return !p.garages && !hasOpening(p, "garazova");
    case "komin_krb": return !p.chimney && !p.fireplace;
    case "krov": case "krytina": return p.roofType === "plocha";
    case "zaklady_dt": return !!p.foundation && p.foundation.type !== "pasy_dt";
    case "stresne_okna": return !hasOpening(p, "stresne");
    case "rekuperacia": return true;
    case "murivo_vnutorne": return true; // niektoré domy nemajú vnútornú nosnú stenu
    default: return key.startsWith("extra_");
  }
}

export function sanityCheck({ result: r, base, study, outdoor, settings }: SanityInput): SanityReport {
  const out: SanityFinding[] = [];
  const add = (f: SanityFinding) => out.push(f);
  const g = r.geometry.study;
  const el = (k: string) => r.elements.find((e) => e.key === k);

  // ---------- 1) Geometria: množstvá musia k sebe sedieť ----------
  const A = study.builtAreaM2, U = study.usableAreaM2;
  if (A > 0 && g.perimeterM > 0) {
    const pMin = 4 * Math.sqrt(A);
    if (g.perimeterM < pMin * 0.9) add({ // pod 90 %: zastavaná plocha môže zahŕňať krytú terasu, preto rezerva
      id: "geo-obvod-maly", severity: "chyba", line: "Obvod domu",
      what: `Obvod ${n1(g.perimeterM)} m je menší ako pri štvorcovom pôdoryse so zastavanou plochou ${n1(A)} m² (min. ${n1(pMin)} m).`,
      why: "Taký obvod geometricky nemôže existovať – je zle obvod alebo zastavaná plocha.",
      check: "Obvod a zastavanú plochu v pôdoryse 1. NP (vonkajšie rozmery).", owner: "obchodník",
    });
    else if (g.perimeterM > pMin * 1.85) add({ // katalóg ES: najčlenitejšie domy (Filip, Lucie) do ≈ 1,8×
      id: "geo-obvod-velky", severity: "upozornenie", line: "Obvod domu",
      what: `Obvod ${n1(g.perimeterM)} m je o ${n1((g.perimeterM / pMin - 1) * 100, 0)} % väčší ako pri štvorcovom pôdoryse.`,
      why: "Veľmi členitý pôdorys výrazne zvyšuje murivo, zateplenie aj základy – alebo je obvod zle odčítaný.",
      check: "Obvod obvodových stien v pôdoryse 1. NP.", owner: "obchodník",
    });
  }
  if (A > 0 && U > 0) {
    const s = study.floorsType === "poschodovy" ? study.storeys || 2 : 1;
    // hranice ≈ 1. a 99. percentil katalógu ES (716 domov): bungalov 0,58–0,86, podkrovie 0,81–1,67, poschodový 0,81–1,71
    const [lo, hi] = study.floorsType === "bungalov" ? [0.55, 0.93] : study.floorsType === "podkrovie" ? [0.78, 1.78] : [0.4 * s, 0.95 * s];
    const ratio = U / A;
    if (ratio < lo || ratio > hi) add({
      id: "geo-pomer-ploch", severity: "upozornenie", line: "Úžitková / zastavaná plocha",
      what: `Pomer úžitkovej a zastavanej plochy je ${n1(ratio, 2)} (pri type „${study.floorsType}“ býva ${n1(lo, 2)} – ${n1(hi, 2)}).`,
      why: "Zle prečítaná plocha (napr. podlahová namiesto úžitkovej, alebo zastavaná s terasou) posunie celý odhad.",
      check: "Úžitkovú plochu v tabuľke miestností a zastavanú plochu v situácii / súhrnnej správe.", owner: "obchodník",
    });
  }
  if (U > 0 && g.windowsAreaM2 > 0) {
    const share = (g.windowsAreaM2 / U) * 100;
    if (share < 8 || share > 30) add({
      id: "geo-okna-podiel", severity: "upozornenie", line: "Okná a balkónové dvere",
      what: `Plocha okien a balkónových dverí ${n1(g.windowsAreaM2)} m² je ${n1(share, 0)} % úžitkovej plochy (bežne 12 – 22 %).`,
      why: share < 8 ? "Pravdepodobne chýbajú niektoré otvory vo výpise." : "Veľa presklení, alebo sú otvory započítané dvakrát.",
      check: "Výpis okien a dverí – počty a rozmery, či nie sú duplicitné riadky.", owner: "obchodník",
    });
  }
  if (g.facadeGrossM2 > 0 && g.windowsAreaM2 > g.facadeGrossM2 * 0.45) add({
    id: "geo-okna-fasada", severity: "chyba", line: "Okná / fasáda",
    what: `Okná (${n1(g.windowsAreaM2)} m²) tvoria ${n1((g.windowsAreaM2 / g.facadeGrossM2) * 100, 0)} % hrubej plochy fasády.`,
    why: "Pri rodinnom dome je to nereálne – zle rozmery otvorov (mm/cm) alebo počty.",
    check: "Jednotky rozmerov vo výpise otvorov (mm vs. cm) a počty kusov.", owner: "obchodník",
  });
  if (g.facadeNetM2 <= 0) add({
    id: "geo-fasada-nula", severity: "chyba", line: "Zateplenie fasády",
    what: "Čistá plocha fasády vyšla nulová alebo záporná.", why: "Otvory sú väčšie ako steny – nesedia rozmery.",
    check: "Obvod, výšku podlažia a výpis otvorov.", owner: "obchodník",
  });
  if (study.roofType !== "plocha" && g.footprintWithOverhangM2 > 0 && g.roofAreaM2 > 0) {
    // bez zadaného sklonu (a bez nastavení) sa kontrola nedá urobiť spoľahlivo
    const pitch = study.roofPitchDeg ?? (settings ? defaultRoofPitch(study.floorsType, settings.defaults, study.roofType) : undefined);
    if (pitch != null) {
    const minRoof = g.footprintWithOverhangM2 / Math.cos((pitch * Math.PI) / 180);
    if (g.roofAreaM2 < minRoof * 0.95) add({
      id: "geo-strecha", severity: "chyba", line: "Strešná krytina / krov",
      what: `Plocha strechy ${n1(g.roofAreaM2)} m² je menšia ako pôdorys s presahom v sklone ${n1(pitch, 0)}° (${n1(minRoof)} m²).`,
      why: "Šikmá strecha nemôže mať menšiu plochu ako jej priemet so sklonom.",
      check: "Sklon strechy v reze a presah strechy.", owner: "obchodník",
    });
    }
  }
  if (g.foundationLengthM > 0 && g.perimeterM > 0 && g.foundationLengthM < g.perimeterM * 0.98) add({
    id: "geo-zaklady", severity: "chyba", line: "Základy",
    what: `Dĺžka základov ${n1(g.foundationLengthM)} m je kratšia ako obvod domu ${n1(g.perimeterM)} m.`,
    why: "Základy musia byť aspoň pod celým obvodom (plus vnútorné nosné steny).",
    check: "Výkres základov – dĺžka pásov.", owner: "obchodník",
  });

  // ---------- 2) Riadky rozpočtu: množstvo × cena, chýbajúce ceny ----------
  const seenUnit = new Map<string, { cost: number; line: string }>();
  for (const e of r.elements) {
    for (const l of e.study.lines) {
      if (l.quantity < 0) add({
        id: `riadok-zaporne-${e.key}-${l.pathCode}`, severity: "chyba", line: `${e.label}: ${l.name}`,
        what: `Záporné množstvo ${n1(l.quantity)} ${l.unit}.`, why: "Množstvo položky nemôže byť záporné.",
        check: "Vstupné rozmery prvku.", owner: "obchodník",
      });
      if (l.quantity > 0 && l.unitCost <= 0 && e.pricedBy !== "firma") add({
        id: `riadok-bezceny-${e.key}-${l.pathCode}`, severity: "chyba", line: `${e.label}: ${l.name}`,
        what: `Položka ${l.pathCode} má množstvo ${n1(l.quantity)} ${l.unit}, ale nulovú jednotkovú cenu.`,
        why: "Položka sa započíta za 0 € – odhad bude podhodnotený.",
        check: "Cenu položky v číselníku (Nastavenia → Číselník).", owner: "rozpočtár",
      });
      const expect = l.quantity * l.unitCost;
      if (l.quantity > 0 && Math.abs(l.cost - expect) > Math.max(1, Math.abs(expect) * 0.005)) add({
        id: `riadok-aritm-${e.key}-${l.pathCode}`, severity: "chyba", line: `${e.label}: ${l.name}`,
        what: "Cena riadku nesedí s množstvom × jednotkovou cenou.", why: "Chyba v aritmetike riadku.",
        check: "Výpočet riadku.", owner: "rozpočtár", adminDetail: `${n1(l.quantity, 2)} × ${eur(l.unitCost)} = ${eur(expect)}, v riadku ${eur(l.cost)}`,
      });
      const key = `${l.pathCode}|${l.unit}`;
      const prev = seenUnit.get(key);
      if (l.pathCode && prev && l.unitCost > 0 && prev.cost > 0 && Math.abs(l.unitCost / prev.cost - 1) > 0.01) add({
        id: `riadok-dvecena-${l.pathCode}`, severity: "upozornenie", line: l.name,
        what: `Rovnaká položka ${l.pathCode} je v rozpočte s dvoma rôznymi jednotkovými cenami (${prev.line} a ${e.label}).`,
        why: "Rovnaký materiál by mal mať v celom rozpočte rovnakú cenu.",
        check: "Či ide naozaj o tú istú položku číselníka.", owner: "rozpočtár", adminDetail: `${eur(prev.cost)} vs. ${eur(l.unitCost)} za ${l.unit}`,
      });
      else if (l.pathCode && !prev && l.unitCost > 0) seenUnit.set(key, { cost: l.unitCost, line: e.label });
    }
  }

  // ---------- 3) Podobné riadky: množstvo a cena za jednotku voči východiskovému domu ----------
  const ra = base.usableAreaM2 > 0 && U > 0 ? U / base.usableAreaM2 : 1;
  const sameType = base.floorsType === study.floorsType;
  for (const e of r.elements) {
    if (e.pricedBy === "firma" || e.base.quantity <= 0 || e.study.quantity <= 0) continue;
    if (sameType && SIZE_SCALED.includes(e.key)) {
      const rel = e.study.quantity / e.base.quantity / ra;
      if ((rel < 0.6 || rel > 1.6) && Math.abs(e.deltaInclVat) >= 500) add({
        id: `podobne-mnozstvo-${e.key}`, severity: "upozornenie", line: e.label,
        what: `Množstvo sa zmenilo ${pct((e.study.quantity / e.base.quantity - 1) * 100)} (${n1(e.base.quantity, 0)} → ${n1(e.study.quantity, 0)} ${e.study.unit}), kým úžitková plocha ${pct((ra - 1) * 100)}.`,
        why: "Pri rovnakom type domu by sa toto množstvo malo meniť približne s veľkosťou domu.",
        check: `Rozmer, z ktorého sa „${e.label}“ počíta (obvod, výška podlažia, plocha).`, owner: "obchodník", impactInclVat: Math.round(e.deltaInclVat),
      });
    }
    if (SINGLE_MATERIAL.includes(e.key) && e.base.cost > 0 && e.study.cost > 0 && (e.base.materialLabel || "") === (e.study.materialLabel || "")) {
      const ub = e.base.cost / e.base.quantity, us = e.study.cost / e.study.quantity;
      if (Math.abs(us / ub - 1) > 0.3) add({
        id: `podobne-cena-${e.key}`, severity: "upozornenie", line: e.label,
        what: `Pri rovnakom materiáli vychádza cena za ${e.study.unit} o ${pct((us / ub - 1) * 100)} inak ako vo východiskovom dome.`,
        why: "Rovnaký materiál by mal mať podobnú cenu za jednotku – inak sa líši skladba alebo doplnkové položky.",
        check: "Skladbu prvku v celom rozpise (doplnkové položky, hrúbky).", owner: "rozpočtár",
        adminDetail: `${eur(ub)} → ${eur(us)} za ${e.study.unit} bez DPH a prirážky`,
      });
    }
  }

  // ---------- 4) Chýbajúce položky pre tento rozsah ----------
  for (const e of r.elements) {
    if (e.base.cost > 0 && e.study.cost === 0 && e.study.quantity === 0 && !droppedExplained(e.key, study)) add({
      id: `chyba-prvok-${e.key}`, severity: "upozornenie", line: e.label,
      what: "Prvok je vo východiskovom dome, v štúdii vyšiel nulový.", why: "Pravdepodobne chýba údaj zo štúdie, nie skutočná úspora.",
      check: `Či štúdia naozaj nemá „${e.label}“.`, owner: "obchodník", impactInclVat: Math.round(e.deltaInclVat),
    });
  }
  if (study.heatingSource === "tuhe" && !study.chimney) add({
    id: "chyba-komin-tuhe", severity: "chyba", line: "Komín",
    what: "Zdroj tepla na tuhé palivo bez komína.", why: "Kotol na tuhé palivo potrebuje komín.",
    check: "Či je v štúdii komín.", owner: "obchodník",
  });
  if (study.fireplace && !study.chimney) add({
    id: "chyba-komin-krb", severity: "upozornenie", line: "Komín a krb",
    what: "Štúdia má krb, ale nie komín.", why: "Krb bez komína (alebo bez dymovodu) nie je možný – komín sa účtuje zvlášť.",
    check: "Rez / pôdorys – komínové teleso.", owner: "obchodník",
  });
  if ((study.garages || 0) > 0 && (study.openings || []).length && !hasOpening(study, "garazova")) add({
    id: "chyba-garaz-brana", severity: "upozornenie", line: "Garážová brána",
    what: `Štúdia má garáž (${study.garages}), ale vo výpise otvorov chýba garážová brána.`, why: "Brána sa potom nezapočíta.",
    check: "Výpis otvorov – garážová brána.", owner: "obchodník",
  });
  if ((study.bathroomsDetail || []).length) {
    const wc = (study.bathroomsDetail || []).reduce((a, b) => a + (b.wc || 0) + (b.wcWallHung || 0), 0);
    if (wc === 0) add({
      id: "chyba-wc", severity: "upozornenie", line: "Zariaďovacie predmety",
      what: "V kúpeľniach nie je žiadne WC.", why: "Rodinný dom bez WC – chýba v rozpise zariaďovacích predmetov.",
      check: "Pôdorys kúpeľní a WC.", owner: "obchodník",
    });
  }
  if (outdoor) {
    const ex = outdoor.extras || [];
    if (!outdoor.waterM && !ex.some((x) => x.key === "studna")) add({
      id: "chyba-voda", severity: "info", line: "Prípojky",
      what: "Nie je zadaná vodovodná prípojka ani studňa.", why: "Dom potrebuje zdroj vody – ak je prípojka hotová, je to v poriadku.",
      check: "Situácia – dĺžka vodovodnej prípojky.", owner: "obchodník",
    });
    if (!outdoor.sewerM) add({
      id: "chyba-kanal", severity: "info", line: "Prípojky",
      what: "Nie je zadaná kanalizácia (k verejnej sieti, žumpe ani ČOV).", why: "Ak už nie je vybudovaná, chýba v ponuke.",
      check: "Situácia – kanalizačná prípojka.", owner: "obchodník",
    });
    if (!outdoor.elecM) add({
      id: "chyba-elektro", severity: "info", line: "Prípojky",
      what: "Nie je zadaná elektrická prípojka.", why: "Ak už nie je vybudovaná, chýba v ponuke.",
      check: "Situácia – NN prípojka.", owner: "obchodník",
    });
  }

  // ---------- 5) Celková cena za m² ----------
  if (base.usableAreaM2 > 0 && U > 0) {
    const pb = r.basePriceInclVat / base.usableAreaM2, ps = r.estimateInclVat / U;
    const d = (ps / pb - 1) * 100;
    if (Math.abs(d) > 15) add({ // katalóg ES: susedné domy sa v cene za m² líšia do 14 % (95. percentil)
      id: "celok-m2", severity: "upozornenie", line: "Cena za m² úžitkovej plochy",
      what: `Odhad ${eur(ps)}/m² sa líši od východiskového domu (${eur(pb)}/m²) o ${pct(d)}.`,
      why: "Takú veľkú zmenu ceny za m² zvyčajne spôsobí zle prečítaná plocha alebo veľký nadštandard.",
      check: "Hlavné vplyvy na cenu a úžitkovú plochu.", owner: "obchodník",
    });
  }

  // ---------- Tri čísla na overenie ----------
  const verify: SanityVerify[] = [...r.elements]
    .filter((e) => Math.abs(e.deltaInclVat) >= 1 && e.key !== "rezia_velkost") // réžia sa odvodzuje z plochy, nie je to samostatné číslo na overenie
    .sort((a, b) => Math.abs(b.deltaInclVat) - Math.abs(a.deltaInclVat))
    .slice(0, 3)
    .map((e: ElementDelta) => ({
      line: e.label,
      value: e.pricedBy === "firma" ? `${e.study.materialLabel || n1(e.study.quantity) + " " + e.study.unit}` : `${n1(e.base.quantity, 1)} → ${n1(e.study.quantity, 1)} ${e.study.unit}`,
      why: `vplyv na cenu ${e.deltaInclVat > 0 ? "+" : "−"}${eur(Math.abs(e.deltaInclVat))}`,
      owner: e.pricedBy === "firma" ? "rozpočtár" : "obchodník",
      impactInclVat: Math.round(e.deltaInclVat),
    }));

  const order: Record<SanitySeverity, number> = { chyba: 0, upozornenie: 1, info: 2 };
  out.sort((a, b) => order[a.severity] - order[b.severity] || Math.abs(b.impactInclVat ?? 0) - Math.abs(a.impactInclVat ?? 0));
  const counts = { chyba: 0, upozornenie: 0, info: 0 } as Record<SanitySeverity, number>;
  out.forEach((f) => counts[f.severity]++);
  return { findings: out, verify, counts };
}
