import type { EstimateSettings } from "./types";

/**
 * Default engine settings. Path codes refer to the číselník imported with the
 * "leaf can never be a parent" hierarchy rule. Everything here is editable by an
 * admin (Nastavenia > Firma a výpočet / Štandard ES) and is stored in app_settings.engine.
 *
 * standardSpec = materials of the "štandardné prevedenie" podľa dokumentu ES „Podrobný sprievodca – štandard domu“ (VOTP_SK.03_26);
 * hrúbky zateplenia doplnil Milan (fasáda EPS 200, strop/strecha MV 300, podlaha EPS 150S 150 mm).
 * rates = sadzby pre položky bez ceny v číselníku – PREDBEŽNÉ, kalibrovať podľa rozpočtov.
 */
export const DEFAULT_ENGINE_SETTINGS: EstimateSettings = {
  vatRate: 0.23,
  // z rozpočtov RP3 25/130 a RP1 25/135: HUS ≈ 1,45–1,5 × náklad, ostatné položky za cenu číselníka; na všetko presun hmôt 2 %, GZS 3,5 %, zisk 4 %
  // položky mimo HUS: 1,02 × 1,035 × 1,04 = 1,098 (overené na rekapitulácii 6 klientskych rozpočtov)
  markup: 1.098,
  markupShell: 1.6,
  optimizationThresholdPct: 10,
  accuracyBandPct: 5,
  fireplaceByClient: true,
  // Firemné ceny s DPH podľa skutočných klientskych rozpočtov (prednosť pred konfigurátorom na webe):
  // TČ ESTIA HWT601 + rozšírenie OKC 250 = 11 221 – 11 638 € bez DPH (25/112, 25/115, 25/130) mínus plynový kotol
  // so zásobníkom, dymovodom a rozvodom plynu 2 881 € (25/120) → 8 525 × 1,098 × 1,23 ≈ 11 500 € s DPH
  heatPumpInclVat: 11500,
  // komín Schiedel Absolut 6,3 m + nadstrešná časť 1,45 m = 3 863 € bez DPH (25/120) × 1,098 × 1,23 ≈ 5 200 € s DPH
  chimneyInclVat: 5200,
  // prefarbené okná (farba zvonku, vnútri biele): +23,2 % k cene bieleho okna (25/120 vs. 25/112, 25/115, 25/130)
  windowColorSurcharge: 0.232,
  defaults: { storeyHeightM: 2.95, kneeWallM: 1.0, roofOverhangM: 0.5, roofPitchDeg: 35, roofPitchBungalowDeg: 22, roofPitchAtticDeg: 40 },
  standardFoundation: {
    type: "pasy_dt", dtRows: 1, dtThicknessMm: 300, dtRowHeightMm: 250,
    stripWidthM: 0.5, stripDepthM: 0.65, slabThicknessM: 0.15, gravelThicknessM: 0.125,
  },
  standardOpenings: { windowSharePct: 16, windowWidthM: 1.0, windowHeightM: 1.25, balconyPerM2: 60, interiorDoorPerM2: 13 },
  standardText: {
    zalozenie: "Základové pásy š. 0,3 m – 1 rad debniacich tvárnic DT 300 na pätke š. 0,5 m (betón C16/20), hĺbka založenia 0,9 m. Základová doska 0,15 m C16/20, sieť 150/150/6 mm, 10–15 cm štrku.",
    murivo: "Presné murivo Ytong (pórobetón) 250 mm na tenkovrstvovú maltu.",
    priecky: "Priečky Ytong 100 mm.",
    strop_bungalov: "Ľahký zavesený strop so sadrokartónovým podhľadom.",
    strop_poschodovy: "Strop z keramických vložiek MIAKO.",
    strop_podkrovie: "Strop medzi prízemím a podkrovím podľa projektu.",
    krov_bungalov: "Priehradové zbíjané drevené väzníky, impregnácia Bochemit QB.",
    krov: "Klasický trámový (tesársky) krov, impregnácia Bochemit QB.",
    krytina: "Betónová škridla Bramac štandard (4 farby), poistná fólia, parozábrana Bramac Pro, podbitie smrekové palubovky 16 mm.",
    zateplenie: "Kategória A0. Fasáda EPS 70F 200 mm so silikátovou omietkou, strop/strecha minerálna vlna 300 mm, podlaha EPS 150S 150 mm.",
    okna: "Plastové 6-komorové okná, biele, mikroventilácia, izolačné trojsklo Ug 0,5. Plocha okien 16 % úžitkovej plochy.",
    dvere_vchodove: "Vchodové dvere s bezpečnostným vybavením a trojbodovým zámkom.",
    dvere_vnutorne: "Fóliované/laminované dvere s obložkovými zárubňami (cca 1 ks na 13 m²).",
    garaz: "Oceľová garážová brána v štandardnej veľkosti výrobcu.",
    kurenie: "Plynový kondenzačný kotol Bosch GC2300iW 20/25 s prietokovým ohrevom TÚV, podlahové teplovodné kúrenie v celom dome, v kúpeľni radiátor Korado Linear.",
    rekuperacia: "Decentrálna rekuperácia.",
    elektro: "Jednofázová inštalácia, Legrand Valena, 2 vypínače a 3 zásuvky na izbu, príprava na anténu, bez svietidiel.",
    zti: "Plastové rozvody vody a kanalizácie s izoláciou, bez cirkulácie TÚV.",
    podlahy: "Plávajúca laminátová podlaha – obývačka trieda 32, ostatné izby trieda 23; dlažba v mokrých priestoroch.",
    kupelne: "Kúpeľne Amora/Aveiro: obklady a dlažby s PVC lištami, umývadlo, akrylátová vaňa, sprchový kút 90 cm s odtokom 60 cm, WC kombi.",
    schodisko: "Pri poschodových domoch samonosné otvorené drevené schodisko š. 900 mm.",
    hromozvod: "Hromozvod po fasáde, uzemnenie v základoch.",
    mimo: "Nie je v štandarde: komín, krb, kuchynská linka, tepelné čerpadlo, inteligentný dom, terasy, spevnené plochy, oplotenie, prípojky a ostatné vonkajšie zariadenie (počíta sa samostatne).",
  },
  standardSpec: {
    wall: "A2/01/001/001/Klasik 250",
    interiorWall: "A2/01/001/001/Klasik 250",
    partition: "A2/01/001/001/Klasik 100",
    facade: "B1/008/Baumit/EPS 070 F/xxx/silikátová K1,5 200",
    roofInsulation: "B1/009/002/xxx/Orsik 200",
    roofInsulation2: "B1/009/002/xxx/Orsik 100",
    floorInsulation: "B1/005/EPS 150S",
    floorInsulationThicknessM: 0.15,
    roofing: "B4/003/003/Bramac/krytiny/CL",
    flatRoofing: "B1/004/xxx/004-006",
    window: "B5/002/P1",
  },
  rates: {
    // z 7 rozpočtov ES (cenové úrovne 260323–260504): paušály v súpise stavby podľa podlahovej plochy
    electroBase: 2600, // elektroinštalácia ≈ 2 600 + 27 €/m² (5 167 – 6 818 € pri 96 – 143 m²)
    electroPerM2: 27,
    plumbingBase: 2280, // rozvod vody 1 098 + kanalizácie 1 246 – 1 310 € takmer nezávisle od počtu kúpeľní
    plumbingPerBathroom: 32,
    plumbingPerWc: 32,
    heatingDistributionBase: 1110, // rozvod ÚK ≈ 1 110 + 13,2 €/m²
    heatingDistributionPerM2: 13.2,
    floorHeatingAreaFactor: 1, // podlahové kúrenie 23,52 €/m² × podlahová plocha (RP3 115,87 m², RP8 96,06 m²)
    scaffoldingFactor: 0.55, // lešenie 6,25 €/m² × ≈ 0,55 × hrubá plocha fasády (419 – 789 € v rozpočtoch)
    recuperationUnit: 392.71, // DALAP Twin Fresh – decentrálna rekuperácia: 4 ks bungalov, 6 ks dvojpodlažný dom

    radiatorsPerM2: 22,
    centralRecuperationPerM2: 55,
    electricHeatingSaving: 2500,
    hsPortalPerM2: 650,
    slidingFactor: 2,
    // krov z priehradových väzníkov – paušál dodávateľa v rozpočtoch 7 550 – 11 550 € = 41,9 – 49,4 €/m² plochy krytiny
    // (25/112 44,9; 25/115 49,4; 25/120 41,9; 25/130 43,2; 23/107 48,9) – priemer 45,7 €/m²
    roofTrussPerM2: 45.7,
    // ornica: odstránenie 0,2 m a rozprestretie na ploche ≈ 1,6 × zastavaná plocha (25/115 194 m² pri 121,7 m²)
    topsoilAreaFactor: 1.6,
    // svah: ťažba zeminy ≈ zastavaná plocha × 0,24 m × (rady DT − 2); 25/115 (2–8 radov DT): 88 m³ pri 121,7 m²
    slopeExcavationPerRowM: 0.24,
    slopeHaulShare: 0.3, // podiel odvezenej zeminy z ťažby (25/115: 52 / 88 m³ odviezli, 25/130: 75 m³ ostalo na pozemku)
    haulExtraKm: 10, // odvoz zeminy na skládku do 10 km
    kitchenStandard: 2340.43, // kuchynská linka – štandardné prevedenie (náklad z rozpočtov RP1/RP3)
    blindsPerM2: 160,
  },
  items: {
    excavation: "A1/01/003",
    soilRemoval: "A1/01/007",
    backfill: "A1/01/009",
    foundationConcrete: "A1/02/018/025 C2025",
    foundationRebar: "A1/02/017",
    gravel: "A1/02/014",
    slabConcrete: "A1/02/018/025 C2025",
    waterproofing: "B1/001/v Hydrobit V60S35",
    ringBeamConcrete: "A2/02/025/025 C2025",
    ringBeamRebar: "A2/02/027",
    ceilingConcrete: "A2/02/021/025 C2025",
    ceilingRebar: "A2/02/023",
    lintel: "A2/01/010/010/KP 11,5/150",
    roofTimber: "B4/001/001",
    battens: "B4/003/001a",
    roofMembrane: "B4/003/002/Bramac PRO PLUS",
    gutters: "B4/002/pozink plech",
    plinthInsulation: "B1/011/ISOVER EPS PERIMETER - 100mm",
    interiorPlaster: "A4/004",
    ceilingPlaster: "A4/003",
    ceilingBoard: "A4/005/999/1RF150", // sadrokartónový podhľad pod strechou (v každom rozpočte ≈ úžitková plocha)
    topsoilRemoval: "A1/01/002",
    topsoilSpread: "A1/01/011",
    soilDig: "A1/01/005",
    soilHandling: "A1/01/006",
    soilHaulKm: "A1/01/008",
    screed: "A4/007/010",
    painting: "B8/004",
    scaffolding: "C2/001",
    floorHeating: "B2/008/002/001",
    garageDoor: "B5/008",
    tiles: "B6/001",
    tilesLaying: "B6/004/001",
    wallTiles: "B6/005",
    wallTilesLaying: "B6/006",
    windowDouble: "B5/002/P2",
    balconyDoor: "B5/003/P1",
    balconyDoorDouble: "B5/003/P2",
    entranceDoor: "B5/006",
    sideDoor: "B5/007",
    entranceDoorMount: "B5/015",
    interiorDoor: "B5/005/fóliované/060-090 197 pln",
    interiorFrame: "B5/011/002/fóliované/060-090-197-06-17",
    interiorDoorMount: "B5/014",
    interiorFrameMount: "B5/013",
    roofWindow: "B5/004/01/GGL/3066 MK08",
    dtRebar: "A1/02/016/000",
  },
  fixtures: {
    bathtub: "B3/007/001",
    cornerTub: "B3/006/001",
    freestandingTub: "B3/007/999/001",
    bathtubTap: "B3/013/001",
    floorTubTap: "B3/013/999/001",
    shower: "B3/010/001",
    showerDrain: "B3/010/999/017",
    showerTap: "B3/014/001",
    washbasin: "B3/004/001",
    smallBasin: "B3/005/001",
    basinTap: "B3/012/001",
    wc: "B3/002/001",
    wcWallHung: "B3/002/999/002",
    bidet: "B3/003/001",
    bidetTap: "B3/015/001",
    mountWc: "B3/016",
    mountBasin: "B3/017",
    mountTub: "B3/018",
    mountTap: "B3/019",
  },
  dtBlocks: {
    "150": "A1/02/016/999/001 KB 150",
    "200": "A1/02/016/999/BS BD200",
    "250": "A1/02/016/999/BS BD250",
    "300": "A1/02/016/001 KB Z 30",
    "400": "A1/02/016/999/BS BD400",
  },
  standardBathroom: {
    first: { name: "Kúpeľňa", bathtub: 1, showerDrain: 1, washbasins: 1, wc: 1 },
    other: { name: "Kúpeľňa", bathtub: 1, showerDrain: 1, washbasins: 1, wc: 1 },
    wc: { name: "WC", washbasins: 1, wc: 1 },
  },
  // Vonkajšie zariadenie – podľa súpisov „vonkajšie zariadenie“ v rozpočtoch RP1 25/135 a RP3 25/130
  outdoorItems: {
    water: "A3/001", sewer: "A3/002", rain: "A3/003", gas: "A3/004", elec: "A3/005", controlCable: "A3/006",
    cesspool: "A3/008/B/standard 01", treatment: "A3/010/XXX/DČOV ASIO", revisionPit: "A3/009/RŠ/standard 01", pumpStation: "A3/009/XXX/CS/čerpacia šachta Ekocis ČS4-EK",
    roofTrap: "A3/011", gasPost: "A3/012", elecPost: "A3/013",
    paving: "A5/002/Haka 060 sivá", curb: "A5/001/001", gravel: "A5/003", dripGravel: "A5/004", dripPaved: "A5/005", lawn: "A5/006",
  },
  outdoorRates: { presunHmot: 0.02, gzs: 0.035, ziskRezia: 0.04 },
  // test na verziách katalógových domov (Kristína 27/27 B/…): bez tejto zložky medián 3,0 %, s ňou 2,5 %
  sizeOverhead: { weight: 0.75, usableShare: 0.5 },
  // obrubník ≈ 3 strany štvorca rovnakej plochy (RP3 18 m² → 12,4 m; RP1 21,15 m² → 13,45 m), štrk 0,28 m³/m² (5,04 / 18; 5,92 / 21,15)
  outdoorRules: { extrasGroup: "Pozemok", curbFactor: 3, gravelM3PerM2: 0.28 },
  standardOutdoor: { waterMeterPit: "A3/007/xxx/atyp 01", sewage: "zumpa", revisionPits: 1, elecPost: true, gasWhenGasHeating: true, gasPost: true },
  extrasCatalog: [
    { key: "fve25", label: "Fotovoltika 2,5 kWp", unit: "ks", group: "Energie", pricing: { type: "company", accessoryId: "1" } },
    { key: "fve5", label: "Fotovoltika 5 kWp + 5 kWh batéria", unit: "ks", group: "Energie", pricing: { type: "company", accessoryId: "2" } },
    { key: "fve8", label: "Fotovoltika 8 kWp + 11,6 kWh batéria", unit: "ks", group: "Energie", pricing: { type: "company", accessoryId: "3" } },
    { key: "fvePristresok", label: "Prístrešok pre FVE", unit: "ks", group: "Energie", pricing: { type: "company", accessoryId: "4" } },
    { key: "wallbox", label: "Wallbox", unit: "ks", group: "Energie", pricing: { type: "company", accessoryId: "9" } },
    { key: "kuchyna", label: "Kuchynská linka (štandardné prevedenie)", unit: "ks", group: "Interiér", pricing: { type: "rate", rateKey: "kitchenStandard" } },
    { key: "inteligentnaElektro", label: "Inteligentná elektroinštalácia", unit: "ks", group: "Energie", pricing: { type: "item", paths: ["B2/003/100"] } },
    { key: "zaluzie", label: "Vonkajšie žalúzie", unit: "m²", group: "Okná a tienenie", pricing: { type: "rate", rateKey: "blindsPerM2" } },
    { key: "svetlovod", label: "Svetlovod", unit: "ks", group: "Okná a tienenie", pricing: { type: "item", paths: ["B5/004/01/xxx/TWR TCR TCF ZTB/TWR TLR OK14"] } },
    { key: "obkladDrevo", label: "Drevený obklad fasády", unit: "m²", group: "Fasáda", pricing: { type: "item", paths: ["A4/001/999/026"] } },
    { key: "obkladKamen", label: "Kamenný obklad fasády", unit: "m²", group: "Fasáda", pricing: { type: "item", paths: ["A4/001/999/025"] } },
    { key: "obkladPasiky", label: "Tehlové obkladové pásiky", unit: "m²", group: "Fasáda", pricing: { type: "item", paths: ["A4/001/999/022"] } },
    { key: "podlahaDrevo", label: "Drevená podlaha namiesto laminátu", unit: "m²", group: "Interiér", pricing: { type: "item", paths: ["B7/999/999-001b"], minusPaths: ["B7/002/00A"] } },
    { key: "podlahaVinyl", label: "Vinylová podlaha namiesto laminátu", unit: "m²", group: "Interiér", pricing: { type: "item", paths: ["B7/999/999-002", "B7/999/999-002a"], minusPaths: ["B7/002/00A"] } },
    { key: "schodiskoDrevo", label: "Celodrevené schodisko", unit: "ks", group: "Interiér", pricing: { type: "item", paths: ["B5/016/C"], minusPaths: ["B5/016/B"] } },
    { key: "zabradlieSklo", label: "Celosklenené zábradlie", unit: "m", group: "Interiér", pricing: { type: "item", paths: ["B5/999/018a"] } },
    { key: "zabradlieBalkon", label: "Zábradlie balkóna / terasy", unit: "m", group: "Interiér", pricing: { type: "item", paths: ["B5/018"] } },
    { key: "terasaWpc", label: "Terasa z WPC dosiek", unit: "m²", group: "Pozemok", pricing: { type: "item", paths: ["A5/999/004"] } },
    { key: "terasaDlazba", label: "Terasa z betónovej dlažby na terčoch", unit: "m²", group: "Pozemok", pricing: { type: "item", paths: ["B6/007", "B6/008"] } },
    { key: "zamkovaDlazba", label: "Zámková dlažba (spevnené plochy)", unit: "m²", group: "Pozemok", pricing: { type: "item", paths: ["A5/002/Haka 060 sivá"] } },
    { key: "dazdovka", label: "Dažďovka 5 m³ na zalievanie", unit: "ks", group: "Pozemok", pricing: { type: "company", accessoryId: "10" } },
    { key: "zumpa", label: "Žumpa", unit: "ks", group: "Pozemok", pricing: { type: "item", paths: ["A3/008/B/standard 01"] } },
    { key: "cov", label: "Domáca čistička odpadových vôd", unit: "ks", group: "Pozemok", pricing: { type: "item", paths: ["A3/010/XXX/DČOV ASIO"] } },
    { key: "vsakovanie", label: "Vsakovacie bloky / iglu", unit: "ks", group: "Pozemok", pricing: { type: "item", paths: ["A3/999/vsakovací/003/vsakovacie iglu PROFI"] } },
    { key: "pripojkaVoda", label: "Vodovodná prípojka", unit: "m", group: "Pozemok", pricing: { type: "item", paths: ["A3/001"] } },
    { key: "pripojkaKanal", label: "Kanalizačná prípojka", unit: "m", group: "Pozemok", pricing: { type: "item", paths: ["A3/002"] } },
    { key: "pripojkaPlyn", label: "Plynová prípojka", unit: "m", group: "Pozemok", pricing: { type: "item", paths: ["A3/004"] } },
    { key: "pripojkaElektro", label: "Elektrická prípojka", unit: "m", group: "Pozemok", pricing: { type: "item", paths: ["A3/005"] } },
    { key: "studna", label: "Studňa", unit: "ks", group: "Pozemok", pricing: { type: "none" } },
    { key: "pristresok", label: "Prístrešok pre auto", unit: "ks", group: "Pozemok", pricing: { type: "none" } },
    { key: "sauna", label: "Sauna", unit: "ks", group: "Interiér", pricing: { type: "none" } },
    { key: "klimatizacia", label: "Klimatizácia", unit: "ks", group: "Energie", pricing: { type: "none" } },
    { key: "pivnica", label: "Pivnica / suterén", unit: "m²", group: "Hrubá stavba", pricing: { type: "none" } },
  ],
};
