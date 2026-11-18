"use strict";
// Výpočet odhadu na serveri – rovnaký kód ako v prehliadači (public/engine.js + client/logic.js).
// Používateľ bez práv administrátora tak nedostane číselník s výrobnými cenami, len výsledky.
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
let cached = null;
function load() {
  if (cached) return cached;
  const ctx = { console, Math, Date, JSON }; ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "public", "engine.js"), "utf8") + ";window.ESEngine=ESEngine;", ctx, { filename: "engine.js" });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "client", "logic.js"), "utf8"), ctx, { filename: "logic.js" });
  const dataFile = (n) => [path.join(ROOT, "client", "data", n), path.join(ROOT, "public", "data", n)].find((p) => fs.existsSync(p));
  cached = {
    L: ctx.ESL,
    houses: JSON.parse(fs.readFileSync(dataFile("houses.json"), "utf8")),
    ciselnik: JSON.parse(fs.readFileSync(dataFile("ciselnik.json"), "utf8")),
  };
  return cached;
}
/** Výpočet pre prepočet. `priceList` = importovaný číselník (ak je), inak predvolený. */
function calculate({ draft, config, priceList, costs, itemized }) {
  const { L, houses, ciselnik } = load();
  const ctx = L.calcContext({ houses, priceList: priceList || ciselnik, config: config || {} });
  if (!ctx.housesById[draft.baseHouseId]) { const e = new Error("Východiskový dom neexistuje."); e.status = 400; e.code = "bad_house"; throw e; }
  const out = L.computeAll(ctx, draft, { itemized: !!itemized });
  const { house, ...rest } = L.sanitizeCalc(out, { costs: !!costs, itemized: !!itemized });
  // výstup prechádza cez JSON (vm objekty → obyčajné objekty)
  return JSON.parse(JSON.stringify({ ...rest, houseId: house.id }));
}
const stripPriceList = (list) => load().L.stripPriceList(list);
const stripConfig = (cfg) => load().L.stripConfig(cfg);
module.exports = { calculate, stripPriceList, stripConfig, load };
