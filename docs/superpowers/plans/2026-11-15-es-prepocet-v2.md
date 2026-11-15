# ES Prepočet 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nová aplikácia ES Prepočet (vzhľad ES × Apple, postup v 4 krokoch, presnejšie čítanie PDF so zdrojom ku každému údaju) postavená na existujúcom výpočtovom jadre, katalógu, číselníku a serveri.

**Architecture:** Prehliadačová aplikácia (Preact + htm, bez bundlera pre UI) v `client/`, ktorú `scripts/build.js` skladá do `public/`. PDF sa číta v prehliadači cez pdf.js; AI (Anthropic, cez server a úlohy na pozadí) vracia len fakty so zdrojom; cenu počíta deterministické jadro `engine/` (TypeScript → `engine.js`). Server (`server/`, Netlify funkcie, Neon) sa nemení okrem drobností.

**Tech Stack:** Node ≥ 20, Preact/htm 3.1.1, pdf.js 3.11.174, pdfmake 0.2.10, esbuild, vitest (engine), `node --test` (server, client), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-11-15-es-prepocet-v2-design.md`

## Global Constraints

- Cenu nikdy nepočíta AI; rovnaký vstup = rovnaká cena.
- Cieľová presnosť: odchýlka najviac **3 %** od skutočnej ceny z rozpočtu.
- Existujúce testy `engine/` (`npm run test:engine`) a servera (`npm run test:server`) ostávajú zelené po každej úlohe.
- Vstup len PDF (a obrázky ako dnes); žiadne DWG/DXF; žiadne prémiové účty.
- Rozhranie po slovensky.
- Identita ES: logo `logo.pos.sk.svg` (cesty sú už v `client/index.html` ako `#es-logo`), sivá `#60707a`, text `#212111`, teplá biela `#fcfbf9` / `#f4f0ea`, akcent `#ba1b02`, písmo Noto Sans (nadpisy 300, verzálky, `letter-spacing: .12em`).
- Uložené prepočty starej verzie sa musia dať otvoriť.
- Po každej zmene v `client/` alebo `engine/`: `npm run build` a `public/` do commitu.
- Po každej úlohe: snímky obrazovky / výstup testov ukázať používateľovi; pokračovať až po overení.

## Review Focus

1. **Naskenované PDF bez textovej vrstvy** – plošné údaje musia byť „overiť“, nie „isté“ (test v Úlohe 3).
2. **PDF, kde sa nenájde žiadna plocha** – krok 2 sa musí dať dokončiť ručným zadaním, výsledok sa nesmie zobraziť s nulou (test v Úlohe 6).
3. **Štúdia s viacerými súbormi, kde sa údaje líšia** (správa 131,5 m², pôdorys 128 m²) – konflikt sa ukáže, nevyberie sa potichu (test v Úlohe 3).
4. **Starý uložený prepočet bez `sources` a `mode`** – otvorí sa a prepočíta bez chyby (test v Úlohe 6).
5. **Individuálny projekt mimo rozsahu katalógu** (napr. 320 m², 3 podlažia) – referenčný dom sa nájde, ale výsledok nesie upozornenie na nízku spoľahlivosť (test v Úlohe 5).

---

## Štruktúra súborov

| Súbor | Zodpovednosť |
|---|---|
| `client/styles.css` (nový) | Celý vzhľad: tokeny ES × Apple, komponenty. `build.js` ho vloží do `index.html`. |
| `client/index.html` (prepis) | Kostra stránky, logo, skripty. Bez štýlov. |
| `client/logic.js` (úprava) | Čítanie PDF, prompt, zlúčenie strán. Pribudne `sources`. |
| `client/checks.js` (nový) | Kontroly súladu údajov → zoznam upozornení. |
| `client/vector.js` (nový) | Meranie obrysu z vektorovej kresby PDF. |
| `client/reference.js` (nový) | Výber referenčného domu pre individuálny projekt, zoznam „navyše oproti štandardu“. |
| `client/ui/*.js` (nové, nahrádzajú `client/ui.js`) | `core.js` (pomôcky, ikony, App, navigácia), `wizard.js` (4 kroky), `review.js` (krok 2 a editory), `result.js` (kroky 3–4), `lists.js` (Prepočty, Katalóg, Číselník), `settings.js`. |
| `client/shim.js` (úprava) | Len vzhľad prihlásenia. |
| `scripts/build.js` (úprava) | Skladá `logic.js + checks.js + vector.js + reference.js + ui/*.js` → `app.js`; vkladá CSS. |
| `test/client.test.js` (nový) | Testy `logic.js`, `checks.js`, `vector.js`, `reference.js` v Node (`vm` s náhradou `window`). |
| `test/accuracy.cjs`, `test/reference/` (nové) | Referenčná sada štúdií a meranie odchýlky. |

Všetky klientske moduly zapisujú do `window.ESL` (ako dnes `logic.js`).

---

### Task 1: Vzhľad a kostra aplikácie

**Files:**
- Create: `client/styles.css`, `client/ui/core.js`
- Modify: `client/index.html`, `scripts/build.js`, `client/shim.js` (iba triedy/štýly prihlásenia)
- Test: `test/e2e.cjs` (snímky), ručná kontrola snímok

**Interfaces:**
- Produces: CSS triedy `.shell`, `.topbar`, `.nav`, `.page`, `.hero`, `.hero-price`, `.card`, `.row`, `.btn` (`.primary`, `.quiet`), `.badge` (`.high`, `.medium`, `.low`), `.steps`, `.sheet`, `.input`; v `core.js` komponenty `Icon`, `NumInput`, `Seg`, `Sheet`, `Conf`, `App` a `window.ESUI = { html, register(name, component) }` – ďalšie súbory `ui/*.js` registrujú obrazovky cez `ESUI.register`.
- `build.js`: `app.js` = `logic.js`, `checks.js`, `vector.js`, `reference.js`, potom `ui/core.js` a ostatné `ui/*.js` abecedne, `ui/zz-mount.js` posledný (volá `render`).

- [ ] **Step 1:** Do `test/e2e.cjs` pridať na začiatok toku kontrolu: po prihlásení existuje `.topbar svg use[href="#es-logo"]`, `getComputedStyle(document.body).fontFamily` obsahuje `Noto Sans`, a farba `.topbar .brand` je `rgb(96, 112, 122)`. Spustiť `npm run build && npm run test:e2e` → FAIL.
- [ ] **Step 2:** Napísať `client/styles.css`. Tokeny: `--bg:#fcfbf9; --surface:#ffffff; --surface-2:#f4f0ea; --fg:#212111; --fg-2:#60707a; --fg-3:#9aa4ab; --line:rgba(33,33,17,.10); --accent:#60707a; --accent-fg:#fff; --alert:#ba1b02; --ok:#1d7a48; --warn:#9a6a12; --radius:18px;`. Pravidlá: horná lišta priesvitná (`rgba(250,250,250,.9)`, `backdrop-filter: blur(20px)`), obsah v stĺpci max 1080 px, nadpisy `font-weight:300; text-transform:uppercase; letter-spacing:.12em`, `.hero-price` `font-size:clamp(44px,7vw,84px); font-weight:300; font-variant-numeric:tabular-nums`, karty bez rámika s jemným tieňom, tlačidlá tvaru pilulky (`border-radius:980px`), panely `.tag` so zaoblením len vpravo (motív z webu ES). Mobil: pod 760 px navigácia dole ako lišta s ikonami.
- [ ] **Step 3:** `client/index.html`: odstrániť `<style>`, ponechať `<svg><defs><g id="es-logo">` a skripty; `build.js` vloží `<style>` z `styles.css` a zloží `app.js` podľa Interfaces.
- [ ] **Step 4:** `client/ui/core.js`: presunúť z `ui.js` pomôcky (`Icon`, `NumInput`, `Seg`, `Sheet`, `Conf`, `Pill`, `HouseImg`, `PlanSvg`, `App`) a prerobiť rozloženie `App` na hornú lištu (logo, „Nový prepočet“, „Prepočty“, „Katalóg“, „Číselník“, „Nastavenia“, používateľ). Ostatné obrazovky zatiaľ dočasne z pôvodného `ui.js` premenovaného na `client/ui/legacy.js`.
- [ ] **Step 5:** `npm run build && npm test` → PASS. Snímky `test/shots/*.png` (prihlásenie, prázdny nový prepočet, zoznam) na šírke 1400 a 390 px ukázať používateľovi.
- [ ] **Step 6:** Commit `Vzhľad ES × Apple: tokeny, kostra, horná lišta`.

### Task 2: Zdroj ku každému údaju

**Files:**
- Modify: `client/logic.js` (`JSON_SHAPE`, `rulesText`, `mergePages`, `aiToStudy`), `server/ai.js` (`mockReply`)
- Create: `test/client.test.js`

**Interfaces:**
- Produces: `ESL.mergePages(results, catalog)` vracia navyše `sources: Record<fieldKey, Source[]>`, kde `Source = { file: string, page: number, quote?: string, pageType: string }` a `fieldKey` sú kľúče `HouseParams` (`usableAreaM2`, `builtAreaM2`, `widthM`, `lengthM`, `floorsType`, `roofType`, `heatingSource`, `fireplace`, `chimney`, `openings`, `bathrooms`, `foundation`, …) a `extra:<kluc>` pre nadštandardy. `aiToStudy` kopíruje `sources` do `study.sources`. Existujúce `confidence` a `evidence` ostávajú.
- AI odpoveď (jedna strana) dostáva nové pole `"citaty": {"uzitkovaCelkomM2": "Úžitková plocha spolu 131,5 m2", "krb": "krbová vložka v obývacej izbe", ...}` – kľúče = názvy polí v odpovedi, hodnota = doslovný úryvok najviac 120 znakov, alebo `null`, ak je údaj z kresby.

- [ ] **Step 1:** `test/client.test.js`: načítať `client/logic.js` cez `vm.runInNewContext` s `window = { ESEngine: require(build engine) }` (engine zostaviť cez esbuild do pamäte). Test `mergePages keeps a source for every value`:

```js
const r = [
  { __file: "sprava.pdf", __page: 3, typStrany: "technicka_sprava", plochy: { uzitkovaCelkomM2: 131.5 }, technika: { krb: true }, citaty: { uzitkovaCelkomM2: "Úžitková plocha spolu 131,5 m2", krb: "krbová vložka" } },
  { __file: "vykresy.pdf", __page: 1, typStrany: "podorys", podlazie: "1.NP", plochy: { zastavanaM2: 158 }, citaty: {} },
];
const m = ESL.mergePages(r, []);
assert.deepEqual(m.sources.usableAreaM2, [{ file: "sprava.pdf", page: 3, quote: "Úžitková plocha spolu 131,5 m2", pageType: "technicka_sprava" }]);
assert.equal(m.sources.fireplace[0].quote, "krbová vložka");
assert.deepEqual(m.sources.builtAreaM2, [{ file: "vykresy.pdf", page: 1, pageType: "podorys" }]);
```

- [ ] **Step 2:** `node --test test/client.test.js` → FAIL (`sources` undefined). Pridať skript `"test:client": "node --test test/client.test.js"` a zaradiť ho do `npm test`.
- [ ] **Step 3:** Doplniť `citaty` do `JSON_SHAPE` a pravidlo do `rulesText` („CITÁTY: ku každému údaju, ktorý si prečítal z textu, uveď doslovný úryvok…“). V `mergePages` pri každom mieste, kde sa dnes plní `evidence[k]`, naplniť aj `sources[k]` zo strany, z ktorej hodnota pochádza. V `mockReply` pridať `citaty`.
- [ ] **Step 4:** `npm run test:client` → PASS; `npm test` → PASS.
- [ ] **Step 5:** Commit `Čítanie štúdie: zdroj (súbor, strana, citát) ku každému údaju`.

### Task 3: Kontroly súladu a skeny

**Files:**
- Create: `client/checks.js`
- Modify: `client/logic.js` (`processFile` – príznak `scanned`; `mergePages` – `conflicts`)
- Test: `test/client.test.js`

**Interfaces:**
- Consumes: `mergePages` výsledok z Úlohy 2.
- Produces:
  - stránka z `processFile` má `scanned: boolean` (true, ak textová vrstva má < 20 slov a strana nie je prázdna);
  - `mergePages(...).conflicts: { field: string, values: { value: number|string, source: Source }[] }[]` – keď dve strany uvádzajú rôznu hodnotu toho istého poľa (čísla s rozdielom > 1 %);
  - `ESL.runChecks(study, merged, pages) -> Check[]`, `Check = { field: string, level: "error"|"warn", code: string, message: string }`. Kódy: `rooms_sum` (súčet miestností vs. úžitková > 3 %), `dims_area` (šírka × dĺžka < 0,8 × zastavaná), `bungalow_usable` (bungalov a úžitková > zastavaná), `conflict` (z `conflicts`), `scanned` (všetky plošné polia pri skene), `missing_area` (chýba úžitková plocha – `error`), `vector_mismatch` (Úloha 4);
  - `ESL.applyChecks(study, checks) -> study` – polia s `warn`/`error` dostanú `confidence[field] = "low"`.

- [ ] **Step 1:** Testy (presné vstupy):
  - `scanned pages make area fields low`: `pages=[{scanned:true}]`, study s `usableAreaM2:120`, `confidence.usableAreaM2:"high"` → po `applyChecks` je `"low"` a existuje check `code:"scanned"`.
  - `conflicting values are reported, not silently merged`: dve strany s `uzitkovaCelkomM2` 131.5 a 128 → `merged.conflicts[0].field === "usableAreaM2"`, 2 hodnoty, check `conflict`.
  - `rooms sum mismatch`: miestnosti spolu 100, úžitková 131.5 → check `rooms_sum`.
  - `missing area is an error`: study bez `usableAreaM2` → check `missing_area`, `level:"error"`.
- [ ] **Step 2:** `npm run test:client` → FAIL.
- [ ] **Step 3:** Implementovať podľa Interfaces. Existujúce dve kontroly v `aiToStudy` (riadky s `widthM * lengthM < builtAreaM2 * 0.8` a `bungalov`) presunúť do `checks.js`.
- [ ] **Step 4:** `npm test` → PASS. Commit `Kontroly súladu údajov, konflikty medzi stranami, skeny na overenie`.

### Task 4: Meranie obrysu z vektorovej kresby

**Files:**
- Create: `client/vector.js`
- Modify: `client/logic.js` (`processFile` uloží pri strane `ops` – zjednodušené úsečky; volanie merania po AI čítaní)
- Test: `test/client.test.js`, `test/fixtures/plan-vector.pdf` (vygenerovať pdfmake-om v teste: obdĺžnik 95,5 × 134 mm, text „M 1:100“)

**Interfaces:**
- Produces:
  - `ESL.extractSegments(opList, viewportTransform) -> { x1,y1,x2,y2,w }[]` – úsečky z operátorov `constructPath` (moveTo/lineTo/rectangle), `w` = hrúbka čiary, súradnice v bodoch PDF;
  - `ESL.findScale(text) -> number|null` – z „M 1:100“, „MIERKA 1 : 50“ → 100, 50;
  - `ESL.measureOutline(segments, scale) -> { widthM, lengthM, areaM2, confidence: "medium"|"low" } | null` – ohraničenie najhrubších 20 % úsečiek dlhších ako 1 m v mierke, zhluk s najväčšou plochou; 1 bod = 0,3528 mm; `null` pri menej ako 4 úsečkách alebo bez mierky; `areaM2` = plocha konvexného obalu zhluku;
  - check `vector_mismatch` (v `runChecks`): ak sa `areaM2` líši od `study.builtAreaM2` o viac ako 5 %; správa uvádza obe hodnoty.
- Meranie je **len kontrola** – hodnotu štúdie neprepisuje. Ak štúdia zastavanú plochu neuvádza, ponúkne sa meranie ako návrh s istotou „overiť“.

- [ ] **Step 1:** Testy: `findScale("Pôdorys 1.NP M 1:100") === 100`; `findScale("bez mierky") === null`; `measureOutline` na 4 úsečkách obdĺžnika 270,7 × 379,8 bodu pri mierke 100 → `widthM ≈ 9.55`, `lengthM ≈ 13.4` (tolerancia 0,05), `areaM2 ≈ 128` (±1); menej ako 4 úsečky → `null`; check `vector_mismatch` pri `builtAreaM2: 158`.
- [ ] **Step 2:** FAIL → implementovať → PASS.
- [ ] **Step 3:** Test s `plan-vector.pdf` cez `pdfjs-dist` v Node: `extractSegments` + `findScale` + `measureOutline` dá 9,55 × 13,4 m.
- [ ] **Step 4:** `npm test` → PASS. Commit `Kontrola zastavanej plochy meraním z vektorovej kresby PDF`.

### Task 5: Individuálny projekt a zoznam „navyše oproti štandardu“

**Files:**
- Create: `client/reference.js`
- Test: `test/client.test.js`

**Interfaces:**
- Consumes: `ESL.findClosestHouses(params, houses, text, limit)`, `ESL.houseParams(h)`, `ESEngine.estimate(input)` (existujúce; výsledok má `deltas: ElementDelta[]` a príplatky – presné názvy polí prevziať z `engine/src/lib/estimate/types.ts`, `EstimateResult`).
- Produces:
  - `ESL.detectMode(merged, houses) -> { mode: "catalog"|"individual", houseId?: number, score: number }` – `catalog`, ak `merged.houseName` zodpovedá domu v katalógu (`nameKey`) alebo najbližší dom má úžitkovú plochu do ±8 % a rovnaký typ podlažnosti a strechy; inak `individual`;
  - `ESL.pickReference(study, houses) -> { house, score, outOfRange: boolean }` – najbližší dom rovnakého `floorsType`; `outOfRange = true`, ak sa úžitková plocha líši o viac ako 35 % od najbližšieho domu;
  - `ESL.extrasVsStandard(result, study, settings) -> { label: string, amountInclVat: number, kind: "navyse"|"menej"|"mimo_standardu", source?: Source[] }[]` – rozdiely s kladnou sumou, príplatky a položky „mimo štandardu“ (`standardText.mimo`), zoradené podľa sumy zostupne;
  - prepočet (draft) má `mode` a `referenceHouseId`; starý prepočet bez `mode` sa berie ako `catalog`.

- [ ] **Step 1:** Testy na skutočnom `client/data/houses.json`: `detectMode({houseName:"Lukáš 84", study:{usableAreaM2:85.5,...}})` → `catalog`, `houseId: 997`; štúdia 320 m², `poschodovy` → `individual`, `pickReference(...).outOfRange === true`; `extrasVsStandard` na výsledku odhadu so štúdiou s krbom a TČ obsahuje položky s `label` obsahujúcim „krb“ a „čerpadlo“, všetky `kind:"navyse"`, zoradené zostupne.
- [ ] **Step 2:** FAIL → implementovať → PASS. `npm test` → PASS.
- [ ] **Step 3:** Commit `Individuálny projekt: referenčný dom; zoznam navyše oproti štandardu`.

### Task 6: Postup v 4 krokoch

**Files:**
- Create: `client/ui/wizard.js`, `client/ui/review.js`, `client/ui/result.js`, `client/ui/zz-mount.js`
- Delete: zodpovedajúce časti `client/ui/legacy.js` (`Wizard`, `StepFiles`, `StepReview`, `StepResult` a ich editory presunúť)
- Test: `test/e2e.cjs`

**Interfaces:**
- Consumes: všetko z Úloh 1–5.
- Produces: kroky `1 Podklady`, `2 Čo som našiel`, `3 Rozdiely a cena`, `4 Výsledok`; `draft.step ∈ 1..4`, `draft.confirmed: Record<fieldKey, true>`.

Správanie (rozhoduje plán):
- Krok 1: plocha na pretiahnutie PDF, priebeh čítania po stranách s náhľadmi, typ projektu navrhnutý cez `detectMode` s prepínačom „Z katalógu / Individuálny“.
- Krok 2: skupiny údajov (Dom, Plochy, Konštrukcia, Otvory, Kúpeľne, Technika, Navyše). Každý riadok: hodnota, odznak istoty, odkaz „s. 3“; klik otvorí `Sheet` s náhľadom strany a citátom z `study.sources`. Hore zhrnutie „N údajov treba overiť“. Riadok s `confidence: "low"` má tlačidlo „Potvrdiť“ (nastaví `draft.confirmed[field]`) alebo sa potvrdí úpravou hodnoty. Tlačidlo „Pokračovať“ je neaktívne, kým existuje nepotvrdený údaj `low` alebo check `error`.
- Krok 3: zoznam rozdielov (z `result.deltas` + príplatky) – názov, zdroj, množstvo, položka číselníka, suma; prepínač vypnutia a úprava množstva; súčet sa prepočíta okamžite. Vonkajšie úpravy a prípojky v samostatnej karte.
- Krok 4: `.hero-price` s cenou s DPH, pod ňou riadky „Katalógová cena / Rozdiely oproti štandardu / Príplatky / Vonkajšie úpravy a prípojky (zvlášť)“, karta „Navyše oproti štandardu“ z `extrasVsStandard`, pri individuálnom projekte štítok „Individuálny projekt“ a pri `outOfRange` upozornenie „Projekt je mimo rozsahu katalógu – odhad overte rozpočtom“. Tlačidlá „Uložiť“ a „PDF“.

- [ ] **Step 1:** Rozšíriť `test/e2e.cjs`:
  - nahrať `test/fixtures/plan.png` → objaví sa krok 2 s textom „Čo som našiel“; existuje aspoň jeden `.badge.low`; tlačidlo `#next` je `disabled`;
  - potvrdiť všetky `.badge.low` (`button.confirm`) → `#next` aktívne; krok 3 obsahuje riadok s „čerpadlo“ (mock vracia `zdrojTepla: "tc"`);
  - krok 4: `.hero-price` zodpovedá `/^\d{2,3}\s\d{3}\s€$/`; karta „Navyše oproti štandardu“ má aspoň 1 riadok;
  - **Review Focus 2:** mock bez plôch (premenná `AI_MOCK_EMPTY=1` v `server/ai.js` → `mockReply` vráti odpoveď bez `plochy`) → krok 2 ukáže chybu „Chýba úžitková plocha“, po ručnom zadaní 120 sa dá pokračovať a cena nie je 0;
  - **Review Focus 4:** cez API vložiť prepočet v starom tvare (bez `mode`, `sources`, `confirmed`) → otvorí sa na kroku 4 bez chyby v konzole.
- [ ] **Step 2:** `npm run build && npm run test:e2e` → FAIL.
- [ ] **Step 3:** Implementovať tri súbory podľa „Správanie“. Editory otvorov, kúpeľní, základov a vonkajších úprav preniesť z `legacy.js` do `review.js` bez zmeny logiky.
- [ ] **Step 4:** `npm test` → PASS. Snímky 4 krokov (1400 px a 390 px) ukázať používateľovi.
- [ ] **Step 5:** Commit `Nový postup: Podklady → Čo som našiel → Rozdiely a cena → Výsledok`.

### Task 7: Ostatné obrazovky a interné PDF

**Files:**
- Create: `client/ui/lists.js`, `client/ui/settings.js`
- Delete: `client/ui/legacy.js`
- Modify: `client/logic.js` (`buildPdfDoc`), `client/shim.js` (prihlásenie)
- Test: `test/e2e.cjs`, `test/client.test.js`

**Interfaces:**
- Consumes: `extrasVsStandard`.
- Produces: `buildPdfDoc` má novú sekciu „Navyše oproti štandardu ES“ (tabuľka názov / suma s DPH) hneď pod cenou; farby a logo podľa Global Constraints; hlavička „Interný podklad obchodníka“.

- [ ] **Step 1:** Test v `test/client.test.js`: `buildPdfDoc({...})` pre štúdiu s krbom → `JSON.stringify(doc.content)` obsahuje „Navyše oproti štandardu ES“ a „Interný podklad obchodníka“. FAIL.
- [ ] **Step 2:** Preniesť `EstimatesList`, `Catalog`, `PriceList` do `lists.js` a `Settings` s kartami do `settings.js`; upraviť značky na nové triedy z Úlohy 1 (logika bez zmeny). Upraviť `buildPdfDoc`. Prihlásenie v `shim.js`: logo ES, jedna karta v strede.
- [ ] **Step 3:** `npm test` → PASS (existujúce e2e kroky pre uloženie, zoznam, používateľov musia prejsť). Snímky všetkých obrazoviek ukázať používateľovi.
- [ ] **Step 4:** Commit `Prepočty, katalóg, číselník, nastavenia a interné PDF v novom vzhľade`.

### Task 8: Meranie presnosti na referenčných štúdiách

**Files:**
- Create: `test/accuracy.cjs`, `test/reference/README.md`, `test/reference/cases.json`
- Modify: `package.json` (skript `test:accuracy`), `README.md`

**Interfaces:**
- `cases.json`: `[{ "id": "novak-lucie-89", "files": ["novak.pdf"], "mode": "catalog", "houseId": 123, "actualInclVat": 248600, "note": "" }]`; PDF v `test/reference/pdf/` (v `.gitignore` – osobné údaje klientov sa do repozitára nedávajú).
- `npm run test:accuracy` (vyžaduje `ANTHROPIC_API_KEY`): pre každý prípad spustí v Playwrighte skutočné čítanie + odhad bez ručných úprav, vypíše tabuľku `id | odhad | skutočnosť | odchýlka %` a skončí s kódom 1, ak je medián absolútnej odchýlky > 3 % alebo niektorý prípad > 6 %. Uloží `test/reference/last-run.json` s prečítanými údajmi (na hľadanie príčin).

- [ ] **Step 1:** Napísať `accuracy.cjs` a overiť na jednom umelom prípade s `AI_MOCK=1` (očakávaná cena = cena z mocku → odchýlka 0 %, kód 0; zmenená `actualInclVat` o 10 % → kód 1).
- [ ] **Step 2:** Po dodaní štúdií používateľom: naplniť `cases.json`, spustiť, výsledky ukázať používateľovi. Každú odchýlku > 3 % rozobrať (chyba čítania vs. pravidlo výpočtu) a opraviť samostatným commitom s testom.
- [ ] **Step 3:** README: nový postup, vzhľad, `npm run test:accuracy`. Commit `Meranie presnosti na referenčných štúdiách`.
