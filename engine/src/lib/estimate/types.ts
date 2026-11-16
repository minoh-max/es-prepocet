// ES Prepočet – calculation engine types (pure, no I/O)

export type FloorsType = "bungalov" | "podkrovie" | "poschodovy";
export type RoofType = "sedlova" | "valbova" | "pultova" | "plocha" | "kombinovana";
export type HeatingSource = "plyn" | "tc" | "elektro" | "tuhe";
export type HeatingDistribution = "podlahove" | "radiatory";
export type Confidence = "high" | "medium" | "low";

/** Material choices – each value is a price_items.path_code of the active číselník. */
export interface MaterialChoices {
  wall?: string; // obvodové murivo
  interiorWall?: string; // vnútorné nosné murivo
  partition?: string; // priečky
  facade?: string; // KZS (zateplenie fasády)
  roofInsulation?: string; // zateplenie strechy / stropu
  roofInsulation2?: string; // 2. vrstva zateplenia strechy / stropu ("" = bez 2. vrstvy)
  floorInsulation?: string; // izolácia podláh (m3 položka)
  floorInsulationThicknessM?: number;
  roofing?: string; // krytina šikmej strechy
  flatRoofing?: string; // hydroizolácia plochej strechy
  window?: string; // okno (ks položka, cena za ekvivalent 1,8 m²)
}

export type OpeningType = "okno" | "balkonove" | "hs" | "vchodove" | "vedlajsie" | "vnutorne" | "garazova" | "stresne";
export const EXTERIOR_OPENINGS: OpeningType[] = ["okno", "balkonove", "hs", "vchodove", "vedlajsie", "garazova"];

/** One line of the opening schedule (výpis otvorov). */
export interface Opening {
  type: OpeningType;
  widthM?: number;
  heightM?: number;
  count: number;
  floor?: string;
  label?: string;
  material?: "plast" | "drevo" | "hlinik";
}

/** Sanitary equipment of one bathroom (counts). */
export interface BathroomDetail {
  name?: string;
  areaM2?: number;
  bathtub?: number;
  cornerTub?: number;
  freestandingTub?: number;
  shower?: number;
  showerDrain?: number; // sprcha s odtokovým žľabom (walk-in)
  washbasins?: number;
  wc?: number;
  wcWallHung?: number;
  bidet?: number;
}

export interface Foundation {
  type: "pasy_dt" | "pasy" | "doska";
  dtRows?: number;
  dtThicknessMm?: number;
  dtRowHeightMm?: number;
  lengthM?: number; // dĺžka základov (ak je známa)
  stripWidthM?: number;
  stripDepthM?: number;
  slabThicknessM?: number;
  gravelThicknessM?: number;
}

/** A non-standard item detected in the study. */
export interface ExtraSel {
  key: string;
  qty: number;
  note?: string;
}

/** Vonkajšie zariadenie – prípojky a spevnené plochy (samostatný súpis mimo ceny domu). */
export type SewageType = "zumpa" | "cov" | "verejna";
export interface OutdoorParams {
  waterM?: number; // vodovodná prípojka, m
  sewerM?: number; // kanalizácia (k žumpe / ČOV / verejnej sieti), m
  rainM?: number; // dažďová kanalizácia, m
  gas?: boolean; // plynová prípojka áno/nie
  gasM?: number;
  elecM?: number; // elektrický kábel do elektromerového rozvádzača, m
  controlCableM?: number; // ovládací kábel – predvolene dĺžka elektro prípojky
  waterMeterPit?: string; // cesta položky vodomernej šachty, "" = bez šachty
  sewage?: SewageType;
  sewagePath?: string; // konkrétna žumpa / ČOV z číselníka
  revisionPits?: number;
  pumpStation?: string; // čerpacia / prečerpávacia šachta (cesta položky), "" = bez
  roofTraps?: number;
  gasPost?: boolean;
  elecPost?: boolean;
  terraceM2?: number; terraceCurbM?: number;
  pavedM2?: number; pavedCurbM?: number;
  dripPathM2?: number; dripPathType?: "kamenivo" | "dlazba";
  lawnM2?: number;
  extras?: ExtraSel[]; // položky skupiny „Pozemok“ zo štúdie
  confidence?: Record<string, Confidence | undefined>;
  evidence?: Record<string, string>;
}
export interface OutdoorLine {
  group: "pripojky" | "objekty" | "plochy" | "ine";
  label: string; pathCode: string; name: string; unit: string;
  quantity: number; unitCost: number; cost: number; // náklad bez DPH a bez rekapitulácie
  inclVat?: number; // pevná cena s DPH (cenník firmy)
  warning?: string; note?: string;
}
export interface OutdoorResult {
  lines: OutdoorLine[]; missing: string[];
  directCost: number; presunHmot: number; gzs: number; ziskRezia: number;
  exclVat: number; vat: number; inclVat: number; companyInclVat: number;
}
export type OutdoorItemKey = "water" | "sewer" | "rain" | "gas" | "elec" | "controlCable" | "cesspool" | "treatment" | "revisionPit" | "pumpStation" | "roofTrap" | "gasPost" | "elecPost" | "paving" | "curb" | "gravel" | "dripGravel" | "dripPaved" | "lawn";

export interface ExtraDef {
  key: string;
  label: string;
  unit: string;
  /** company = configurator price incl. VAT per unit; item = číselník path; rate = settings rate (náklad) per unit */
  pricing: { type: "company"; accessoryId: string } | { type: "item"; paths: string[]; minusPaths?: string[] } | { type: "rate"; rateKey: string } | { type: "none" };
  group: string;
}

export interface HouseParams {
  usableAreaM2: number; // úžitková plocha
  builtAreaM2: number; // zastavaná plocha
  widthM?: number;
  lengthM?: number;
  perimeterM?: number; // obvod obvodových stien; ak chýba, odhadne sa
  floorsType: FloorsType;
  storeys?: number; // počet plných podlaží pri poschodovom dome (predvolene 2)
  storeyHeightM?: number; // konštrukčná výška podlažia
  kneeWallM?: number; // nadmurovka (podkrovie)
  roofType: RoofType;
  roofPitchDeg?: number;
  roofOverhangM?: number;
  windowsCount?: number;
  windowsAreaM2?: number;
  interiorBearingLengthM?: number;
  partitionAreaM2?: number;
  bathrooms: number;
  wcs?: number;
  garages?: number;
  heatingSource: HeatingSource;
  heatingDistribution: HeatingDistribution;
  centralRecuperation?: boolean; // štandard = decentrálna
  chimney?: boolean;
  fireplace?: boolean;
  materials?: MaterialChoices; // nevyplnené = štandard ES
  rooms?: number;
  openings?: Opening[];
  bathroomsDetail?: BathroomDetail[];
  foundation?: Foundation;
  extras?: ExtraSel[];
  confidence?: Partial<Record<keyof HouseParams | string, Confidence>>;
}

export interface PriceItem {
  path_code: string;
  name: string;
  specification?: string | null;
  unit: string;
  price_material: number | null;
  price_labor: number | null;
  price_machinery: number | null;
  fixed_rate: number | null;
  check_level?: "CHYBA" | "OVERIŤ" | "TEXT" | null;
  is_hidden?: boolean;
}

export type PriceIndex = Record<string, PriceItem>;

/** Company prices from the website configurator – amounts INCLUDE VAT. */
export interface CompanyExtras {
  heatPump?: number; // Tepelné čerpadlo (príplatok k štandardu)
  chimney?: number;
  fireplace?: number;
  bathroomPackage?: number; // najlacnejšia kúpeľňa z konfigurátora
  accessories?: Record<string, number>; // id → cena s DPH
}

/** Unit rates that the číselník does not price (bez DPH, náklad) – admin settings, calibrated by budgets. */
export interface UnitRates {
  electroPerM2: number; // elektroinštalácia na m² úžitkovej plochy
  plumbingPerBathroom: number; // ZTI rozvody na kúpeľňu
  plumbingPerWc: number;
  heatingDistributionPerM2: number; // rozvod ÚK na m² (bez podlahového kúrenia)
  radiatorsPerM2: number; // radiátory na m²
  centralRecuperationPerM2: number; // príplatok za centrálnu rekuperáciu
  electricHeatingSaving: number; // úspora pri elektrokúrení oproti plynu (kladné číslo, bez DPH)
  hsPortalPerM2: number; // HS portál – náklad na m² (namiesto bežných balkónových dverí)
  blindsPerM2: number; // vonkajšie žalúzie – náklad na m² okien
  [key: string]: number;
}

export interface EstimateSettings {
  vatRate: number; // 0.23
  fireplaceByClient?: boolean; // krb si dodáva klient (predvolene áno) – účtuje sa len komín
  markup: number; // prirážka na položky mimo hrubej stavby (presun hmôt, GZS, zisk a réžia)
  markupShell?: number; // prirážka na hrubú uzatvorenú stavbu (paušál HUS)
  optimizationThresholdPct: number; // 10
  accuracyBandPct: number; // 5
  defaults: {
    storeyHeightM: number;
    kneeWallM: number;
    roofOverhangM: number;
    roofPitchDeg: number;
    roofPitchAtticDeg?: number; // sklon pri dome s podkrovím
    roofPitchBungalowDeg?: number; // sklon pri bungalove (štandard ES 22°)
  };
  /** Pevné štandardné založenie (VOTP: pásy z DT na pätke + doska). */
  standardFoundation: Foundation;
  /** Pevné štandardné otvory východiskového domu (katalóg ich neuvádza). */
  standardOpenings: { windowSharePct: number; windowWidthM: number; windowHeightM: number; balconyPerM2: number; interiorDoorPerM2: number };
  /** Popis štandardu po prvkoch (ľavý stĺpec) – upravuje admin. */
  standardText: Record<string, string>;
  standardSpec: Required<Omit<MaterialChoices, "floorInsulationThicknessM" | "roofInsulation2">> & { floorInsulationThicknessM: number; roofInsulation2?: string };
  rates: UnitRates;
  /** Fixed číselník items used by elements (path codes). */
  items: Record<FixedItemKey, string>;
  /** Sanitary items (path codes) used for bathrooms. */
  fixtures: Record<FixtureKey, string>;
  /** DT blocks by wall thickness in mm → path code. */
  dtBlocks: Record<string, string>;
  /** Default equipment of a standard bathroom / WC. */
  standardBathroom: { first: BathroomDetail; other: BathroomDetail; wc: BathroomDetail };
  /** Catalog of non-standard items that may be detected in a study. */
  extrasCatalog: ExtraDef[];
  /** Vonkajšie zariadenie: položky číselníka, rekapitulácia a predvolené prvky. */
  outdoorItems: Record<OutdoorItemKey, string>;
  outdoorRates: { presunHmot: number; gzs: number; ziskRezia: number };
  /** Podiel nemodelovanej časti katalógovej ceny, ktorý sa mení s veľkosťou domu (weight) a váha úžitkovej vs. zastavanej plochy. */
  sizeOverhead?: { weight: number; usableShare: number };
  outdoorRules: { extrasGroup: string; curbFactor: number; gravelM3PerM2: number };
  standardOutdoor: { waterMeterPit: string; sewage: SewageType; revisionPits: number; elecPost: boolean; gasWhenGasHeating: boolean; gasPost: boolean };
  /** Optional explicit lists of allowed alternatives per material role (path codes). */
  alternatives?: Partial<Record<string, string[]>>;
}

export type FixtureKey =
  | "bathtub" | "cornerTub" | "freestandingTub" | "bathtubTap" | "floorTubTap" | "shower" | "showerDrain" | "showerTap"
  | "washbasin" | "smallBasin" | "basinTap" | "wc" | "wcWallHung" | "bidet" | "bidetTap"
  | "mountWc" | "mountBasin" | "mountTub" | "mountTap";

export type FixedItemKey =
  | "excavation"
  | "soilRemoval"
  | "backfill"
  | "foundationConcrete"
  | "foundationRebar"
  | "gravel"
  | "slabConcrete"
  | "waterproofing"
  | "ringBeamConcrete"
  | "ringBeamRebar"
  | "ceilingConcrete"
  | "ceilingRebar"
  | "lintel"
  | "roofTimber"
  | "battens"
  | "roofMembrane"
  | "gutters"
  | "plinthInsulation"
  | "interiorPlaster"
  | "ceilingPlaster"
  | "screed"
  | "painting"
  | "scaffolding"
  | "floorHeating"
  | "garageDoor"
  | "tiles"
  | "tilesLaying"
  | "wallTiles"
  | "wallTilesLaying"
  | "balconyDoor"
  | "balconyDoorDouble"
  | "windowDouble"
  | "entranceDoor"
  | "sideDoor"
  | "entranceDoorMount"
  | "interiorDoor"
  | "interiorFrame"
  | "interiorDoorMount"
  | "interiorFrameMount"
  | "roofWindow"
  | "dtRebar";

export type Finish = "standard" | "holodom";

export interface EstimateInput {
  basePriceInclVat: number; // cena z webu (štandard alebo holodom)
  finish: Finish;
  base: HouseParams;
  study: HouseParams;
  prices: PriceIndex;
  settings: EstimateSettings;
  extras: CompanyExtras;
  /** Kalibračné koeficienty množstiev z rozpočtov: elementKey → Q_rozpočet / Q_vzorec */
  calibration?: Record<string, number>;
}

export interface ElementLine {
  pathCode: string;
  name: string;
  unit: string;
  quantity: number;
  unitCost: number;
  cost: number;
  warning?: string;
}

export interface ElementSide {
  quantity: number; // hlavné množstvo prvku
  unit: string;
  materialLabel?: string;
  cost: number; // bez DPH, bez prirážky (náklad) – alebo s DPH pri company extras
  lines: ElementLine[];
}

export interface ElementDelta {
  key: string;
  label: string;
  group: string;
  base: ElementSide;
  study: ElementSide;
  /** Dopad na cenu s DPH (už prenásobený prirážkou a DPH, alebo priamo cena firmy s DPH). */
  deltaInclVat: number;
  explanation: string;
  pricedBy: "ciselnik" | "firma" | "sadzba";
  warnings: string[];
}

export interface OptimizationSuggestion {
  id: string;
  title: string;
  detail: string;
  savingInclVat: number;
  newEstimateInclVat: number;
  newChangePct: number;
  kind: "material" | "tvar" | "plocha" | "technologia" | "nadstandard";
  /** Change of the study that produces this saving – combinable with applyPatch(). */
  patch: StudyPatch;
}

/** A combinable change of the study (used by optimizations and variants). */
export interface StudyPatch {
  materials?: Partial<MaterialChoices>;
  set?: Partial<HouseParams>;
  dropExtras?: string[];
  scaleArea?: number; // násobok úžitkovej a zastavanej plochy
  scaleOpenings?: number; // násobok plochy otvorov v obvodovom plášti
}

export interface EstimateResult {
  basePriceInclVat: number;
  estimateInclVat: number;
  estimateExclVat: number;
  changeInclVat: number;
  changePct: number;
  range: { lowInclVat: number; highInclVat: number; bandPct: number };
  elements: ElementDelta[];
  topDrivers: ElementDelta[];
  otherDeltaInclVat: number;
  optimizationNeeded: boolean;
  optimizations: OptimizationSuggestion[];
  warnings: string[];
  geometry: { base: Geometry; study: Geometry };
}

export interface Geometry {
  perimeterM: number;
  storeys: number; // počet podlaží s plnou výškou
  exteriorWallHeightM: number;
  facadeGrossM2: number;
  gableM2: number;
  windowsAreaM2: number;
  windowsCount: number;
  facadeNetM2: number;
  footprintWithOverhangM2: number;
  roofAreaM2: number;
  foundationLengthM: number;
  interiorBearingLengthM: number;
  interiorBearingM2: number;
  partitionM2: number;
  ceilingM2: number; // stropy medzi podlažiami
  roofInsulationM2: number;
  groundFloorM2: number;
  ringBeamM3: number;
  scaffoldingM2: number;
  gutterM: number;
}
