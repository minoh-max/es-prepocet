// Celý tok v prehliadači: prihlásenie, zmena hesla, nový prepočet so štúdiou, uloženie, správa používateľov.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright-core");
const ROOT = path.join(__dirname, "..");
const NM = path.join(ROOT, "node_modules") + "/";
const SHOTS = process.env.SHOTS || path.join(ROOT, "test", "shots");
const MAP = { "htm@3.1.1/preact/standalone.umd.js": NM + "htm/preact/standalone.umd.js", "pdf.js/3.11.174/pdf.min.js": NM + "pdfjs-dist/build/pdf.min.js", "pdf.js/3.11.174/pdf.worker.min.js": NM + "pdfjs-dist/build/pdf.worker.min.js", "xlsx/0.18.5/xlsx.full.min.js": NM + "xlsx/dist/xlsx.full.min.js", "pdfmake@0.2.10/build/pdfmake.min.js": NM + "pdfmake/build/pdfmake.min.js", "pdfmake@0.2.10/build/vfs_fonts.js": NM + "pdfmake/build/vfs_fonts.js" };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  // E2E_URL=http://localhost:8888/ → test proti už bežiacej aplikácii (napr. netlify dev) s prázdnou databázou
  const EXT = process.env.E2E_URL;
  const srv = EXT ? { kill() {}, stdout: { on() {} }, stderr: { on() {} } } : spawn(process.execPath, ["server/index.js"], { cwd: ROOT, env: { ...process.env, PORT: "3917", DATABASE_URL: "memory", AI_MOCK: "1", ADMIN_EMAIL: "admin@test.sk", ADMIN_PASSWORD: "heslo12345" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 50 && !EXT && !/beží/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined) });
  const errs = [];
  const fail = (m) => { throw new Error(m); };
  try {
    const page = await b.newPage({ viewport: { width: 1400, height: 950 } });
    page.on("pageerror", (e) => errs.push("PAGEERR " + e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errs.push("CONSOLE " + m.text()); });
    await page.route("**/*", (route) => { const u = route.request().url(); for (const k in MAP) if (u.includes(k)) return route.fulfill({ path: MAP[k], contentType: "application/javascript" }); if (/fonts\.(googleapis|gstatic)/.test(u)) return route.fulfill({ body: "", contentType: "text/css" }); return route.continue(); });
    const U = EXT || "http://localhost:3917/";
    await page.goto(U); await page.waitForSelector("#email");
    await page.screenshot({ path: SHOTS + "/01_login.png" });
    await page.fill("#email", "admin@test.sk"); await page.fill("#password", "zle-heslo"); await page.click("button[type=submit]");
    await page.waitForSelector(".err:not([hidden])"); console.log("zlé heslo:", await page.textContent(".err"));
    await page.fill("#password", "heslo12345"); await page.click("button[type=submit]");
    await page.waitForSelector(".topbar", { timeout: 15000 }); await page.waitForTimeout(800);
    // vzhľad ES: logo, písmo, sivá ES v hornej lište
    const look = await page.evaluate(() => ({ logo: !!document.querySelector('.topbar svg use[href="#es-logo"]'), font: getComputedStyle(document.body).fontFamily, brand: getComputedStyle(document.querySelector(".topbar .brand")).color, bg: getComputedStyle(document.body).backgroundColor }));
    if (!look.logo) fail("v hornej lište chýba logo ES");
    if (!/Noto Sans/.test(look.font)) fail("písmo nie je Noto Sans: " + look.font);
    if (look.brand !== "rgb(96, 112, 122)") fail("logo nie je v sivej ES: " + look.brand);
    if (look.bg !== "rgb(252, 251, 249)") fail("pozadie nie je teplá biela ES: " + look.bg);
    console.log("prihlásený admin, menu:", (await page.$$eval(".nav-btn", (x) => x.map((n) => n.textContent.trim()))).join(" | "));
    // nový obchodník
    await page.click(".topbar >> text=Nastavenia"); await page.waitForTimeout(300);
    await page.click(".seg >> text=Používatelia"); await page.waitForTimeout(500);
    await page.fill("#nu-name", "Ján Obchodník"); await page.fill("#nu-email", "jan@test.sk"); await page.fill("#nu-pass", "docasne123");
    await page.click("button:has-text(\"Pridať používateľa\")"); await page.waitForTimeout(800);
    await page.screenshot({ path: SHOTS + "/02_users.png", fullPage: true });
    console.log("používatelia:", (await page.$$eval("table.t tbody tr", (r) => r.map((x) => x.textContent.replace(/\s+/g, " ").trim().slice(0, 60)))).join(" || "));
    // výpočet – nastavenia
    await page.click(".seg >> text=Výpočet"); await page.waitForTimeout(400);
    await page.screenshot({ path: SHOTS + "/03_calc.png", fullPage: true });
    // nový prepočet so štúdiou
    await page.click(".topbar >> text=Nový prepočet"); await page.waitForTimeout(400);
    await page.setInputFiles("input[type=file]", [path.join(ROOT, "test", "fixtures", "plan.png")]); await page.waitForTimeout(800);
    await page.click("text=Rozpoznať podklady"); await page.waitForSelector("text=Poznámka k podkladom", { timeout: 30000 }); await page.waitForTimeout(800);
    // východiskový dom musí obchodník potvrdiť – dovtedy sa odhad nedá vypočítať
    if (!(await page.isDisabled("button:has-text('Vypočítať odhad')"))) fail("odhad sa dá vypočítať bez potvrdenia východiskového domu");
    await page.click("button:has-text('Potvrdiť dom')"); await page.waitForTimeout(300);
    if (await page.isDisabled("button:has-text('Vypočítať odhad')")) fail("po potvrdení domu sa odhad stále nedá vypočítať");
    await page.click("text=Vypočítať odhad"); await page.waitForTimeout(1200);
    await page.screenshot({ path: SHOTS + "/04_result.png" });
    const est = await page.textContent(".kpi.hero .kpi-value"); console.log("odhad:", est);
    const cc = await page.textContent("#cross-check").catch(() => null); console.log("kontrola:", (cc || "").replace(/\s+/g, " ").slice(0, 140)); if (!cc || !/Kontrola z \d+ podobných domov/.test(cc)) errors.push("chýba kontrola z podobných domov");
    await page.fill("#client-name", "Test klient").catch(() => {});
    await page.click("text=Uložiť prepočet"); await page.waitForTimeout(1000);
    const dl = page.waitForEvent("download", { timeout: 15000 });
    await page.click("text=Exportovať PDF"); const d = await dl; console.log("PDF:", d.suggestedFilename());
    await page.click(".topbar >> text=Prepočty"); await page.waitForTimeout(1200);
    console.log("prepočty:", await page.$$eval("table.t tbody tr", (r) => r.length));
    const inp = await page.$("input.actual"); if (!inp) fail("chýba pole skutočná cena");
    await inp.fill("300000"); await inp.press("Enter"); await page.waitForTimeout(1200);
    await page.screenshot({ path: SHOTS + "/05_estimates.png", fullPage: true });
    console.log("presnosť:", (await page.textContent(".accuracy").catch(() => "–")).replace(/\s+/g, " ").trim());
    // odhlásenie a prihlásenie obchodníka (povinná zmena hesla)
    await page.click("text=Odhlásiť sa"); await page.waitForSelector("#email");
    await page.fill("#email", "jan@test.sk"); await page.fill("#password", "docasne123"); await page.click("button[type=submit]");
    await page.waitForSelector("#next"); await page.fill("#current", "docasne123"); await page.fill("#next", "noveheslo1"); await page.fill("#again", "noveheslo1"); await page.click("button[type=submit]");
    await page.waitForSelector(".topbar", { timeout: 15000 }); await page.waitForTimeout(600);
    const salesMenu = await page.$$eval(".nav-btn", (x) => x.map((n) => n.textContent.trim()));
    console.log("obchodník menu:", salesMenu.join(" | "));
    if (salesMenu.some((t) => /Číselník/.test(t))) fail("obchodník nesmie vidieť číselník (výrobné ceny)");
    const r = await page.evaluate(async () => (await fetch("/api/doc", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "config/app", data: { x: 1 } }) })).status);
    console.log("obchodník zápis do nastavení (čakám 403):", r);
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(U); await page.waitForSelector(".topbar"); await page.waitForTimeout(500);
    await page.screenshot({ path: SHOTS + "/06_mobile.png" });
    const navTop = await page.evaluate(() => document.querySelector(".nav").getBoundingClientRect().top);
    if (navTop < 700) fail("na mobile nie je navigácia dole (top " + navTop + ")");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    console.log("mobil pretečenie:", overflow);
    if (overflow) fail("na mobile stránka preteká do šírky");
    if (errs.length) fail("chyby v konzole: " + errs.join(" | "));
  } finally {
    console.log("CHYBY:", errs.slice(0, 10));
    await b.close(); srv.kill();
  }
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
