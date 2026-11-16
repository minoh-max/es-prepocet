// Testy čítania štúdie a výberu východiskového domu (client/logic.js) na skutočných domoch ES.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), vm = require("vm"), path = require("path");
const R = path.join(__dirname, "..");
const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
require("esbuild").buildSync({ entryPoints: [path.join(R, "engine/src/lib/estimate/index.ts")], bundle: true, format: "iife", globalName: "ESEngine", outfile: path.join(__dirname, ".engine.test.js"), logLevel: "warning" });
vm.runInContext(fs.readFileSync(path.join(__dirname, ".engine.test.js"), "utf8") + ";window.ESEngine=ESEngine;", ctx);
vm.runInContext(fs.readFileSync(path.join(R, "client/logic.js"), "utf8"), ctx);
const L = ctx.ESL;
const houses = JSON.parse(fs.readFileSync(path.join(R, "client/data/houses.json"), "utf8")).houses;
const top = (params, n = 3) => L.findClosestHouses(params, houses, "", n).map((x) => x.house.name);

test("výber domu: zákazka 107/23 (bungalov s garážou 13,4 × 13,7 m) – rodina Lucie, nie Katka 17", () => {
  const t = top({ usableAreaM2: 101.55, builtAreaM2: 173.83, widthM: 13.4, lengthM: 13.7, floorsType: "bungalov", roofType: "valbova", garages: 1 });
  assert.ok(/^Lucie (69|7|14)$/.test(t[0]), "prvý návrh: " + t.join(", "));
  assert.ok(!t.includes("Katka 17"), "Katka 17 nemá byť medzi prvými tromi: " + t.join(", "));
});

test("výber domu: zákazka 226/21 (8,4 × 14,4 m, 120,91 m²) – Kristína 12", () => {
  const t = top({ usableAreaM2: 96.04, builtAreaM2: 120.91, widthM: 8.4, lengthM: 14.4, floorsType: "bungalov", roofType: "valbova" });
  assert.strictEqual(t[0], "Kristína 12");
});

test("výber domu: zákazka 115/25 (8,81 × 13,9 m) – rodina Kristína", () => {
  const t = top({ usableAreaM2: 97.16, builtAreaM2: 121.68, widthM: 8.81, lengthM: 13.9, floorsType: "bungalov", roofType: "valbova" });
  assert.ok(/^Kristína/.test(t[0]), t.join(", "));
});

test("DT na svahu: rozpätie „2 až 8 radov“ → počíta sa priemer (5), nie maximum", () => {
  const m = L.mergePages([{ __file: "s.pdf", __page: 5, __pages: "5", typStrany: "technicka_sprava", plochy: { uzitkovaCelkomM2: 97.16 }, rez: { typZalozenia: "pasy_dt", dtRadyMin: 2, dtRadyMax: 8, dtHrubkaMm: 300 }, otvory: [] }], []);
  assert.strictEqual(m.study.foundation.dtRows, 5);
  assert.match(m.evidence.foundation, /2–8 radov DT, počíta sa s priemerom 5/);
  assert.strictEqual(m.confidence.foundation, "low");
});

test("materiál bez hrúbky („YTONG KLASIK“): obvodové murivo nesmie skončiť ako 50 mm stena", () => {
  const cis = JSON.parse(fs.readFileSync(path.join(R, "client/data/ciselnik.json"), "utf8"));
  const prices = L.buildPrices(cis, {});
  const m = L.mapMaterial(prices, "wall", "YTONG KLASIK");
  const th = ctx.ESEngine.parseThicknessMm(prices[m.path]);
  assert.ok(th >= 200, "hrúbka " + th + " mm (" + m.path + ")");
  assert.notStrictEqual(m.confidence, "high");
  const m2 = L.mapMaterial(prices, "wall", "YTONG KLASIK P2-500 hr. 250 mm");
  assert.strictEqual(ctx.ESEngine.parseThicknessMm(prices[m2.path]), 250);
});

test("výber domu podľa názvu: „Blanka 3B“ v správe = katalógový „Blanka 3 B“, nie „Blanka 3“", () => {
  const H = houses;
  const m = L.findClosestHouses({ usableAreaM2: 86, builtAreaM2: 59.4, floorsType: "podkrovie", roofType: "sedlova" }, H, "typové riešenie Ekonomické stavby s.r.o. (dom Blanka 3B)", 3);
  assert.equal(m[0].house.name, "Blanka 3 B");
  const m2 = L.findClosestHouses({ usableAreaM2: 86, builtAreaM2: 59.4, floorsType: "podkrovie", roofType: "sedlova" }, H, "dom Blanka 35", 3);
  assert.equal(m2[0].house.name, "Blanka 35");
});

test("čítanie výkresov: nečitateľné kóty a krížové kontroly sa zbierajú so zdrojom strany, prompt zakazuje hádanie", () => {
  const m = L.mergePages([
    { __file: "s.pdf", __page: 2, typStrany: "podorys", razitko: { vykres: "Pôdorys 1.NP", mierka: "1:50" }, necitatelne: [{ co: "šírka okna O3", kde: "severná stena" }], kontroly: [{ co: "súčet kót južnej steny", vysledok: "nesedí", detail: "8 950 vs 9 000 mm" }, { co: "plochy 1.NP", vysledok: "sedí" }] },
  ], []);
  assert.equal(m.unreadable.length, 1);
  assert.match(m.unreadable[0].src, /s\.pdf, str\. 2/);
  assert.equal(m.checks.filter((c) => !c.ok).length, 1);
  assert.equal(m.drawings[0].mierka, "1:50");
  const prompt = L.pagePrompt ? L.pagePrompt({ file: "s.pdf", page: 1 }, ["celá strana"], []) : "";
  if (prompt) { assert.match(prompt, /NEHÁDAJ/); assert.match(prompt, /necitatelne/); assert.match(prompt, /razitko/); }
});

test("údaje projektu: číslo zákazky, manažér, projektant, k. ú., parcela a dátum sa zoberú z razítok (správa má prednosť)", () => {
  const m = L.mergePages([
    { __file: "s.pdf", __page: 2, typStrany: "podorys", razitko: { zakazka: "154/26", projektant: "Ing. A", parcela: "263", datum: "11/2026" } },
    { __file: "sprava.pdf", __page: 1, typStrany: "technicka_sprava", razitko: { manazerProjektu: "Mgr. B", katastralneUzemie: "Sládkovičovo", projektant: "Ing. C" } },
  ], []);
  assert.deepEqual(m.project, { zakazka: "154/26", manazer: "Mgr. B", projektant: "Ing. C", katastralne: "Sládkovičovo", parcela: "263", datumStudie: "11/2026" });
});
