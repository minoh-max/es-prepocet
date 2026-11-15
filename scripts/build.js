"use strict";
// Zostaví hotové súbory do public/ z client/ (aplikácia) a engine/ (výpočet).
//   node scripts/build.js            → webová aplikácia (public/)
//   node scripts/build.js --artifact → verzia pre Claude (dist-artifact/)
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const artifact = process.argv.includes("--artifact");
const OUT = path.join(ROOT, artifact ? "dist-artifact" : "public");
const C = (p) => path.join(ROOT, "client", p);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 1. výpočtové jadro (TypeScript → jeden súbor s globálnou premennou ESEngine)
require("esbuild").buildSync({ entryPoints: [path.join(ROOT, "engine/src/lib/estimate/index.ts")], bundle: true, minify: true, format: "iife", globalName: "ESEngine", outfile: path.join(OUT, "engine.js"), logLevel: "warning" });

// 2. aplikácia: logika (logic.js + ďalšie moduly) a obrazovky (ui/*.js v jednej spoločnej funkcii; core prvý, zz-mount posledný)
const read = (p) => fs.readFileSync(C(p), "utf8");
const modules = ["logic.js", "checks.js", "vector.js", "reference.js"].filter((f) => fs.existsSync(C(f)));
const uiFiles = fs.readdirSync(C("ui")).filter((f) => f.endsWith(".js")).sort((a, b) => (a === "core.js" ? -1 : b === "core.js" ? 1 : a.localeCompare(b)));
fs.writeFileSync(path.join(OUT, "app.js"), modules.map(read).join("\n") + "\n(function () {\n" + uiFiles.map((f) => read("ui/" + f)).join("\n") + "})();\n");

// 3. stránka
let html = fs.readFileSync(C("index.html"), "utf8");
if (!html.includes("<!--STYLES-->")) throw new Error("index.html: chýba značka <!--STYLES-->");
html = html.replace("<!--STYLES-->", "<style>\n" + read("styles.css") + "</style>");
if (!artifact) {
  html = html.replace('<script src="engine.js"></script>\n<script src="app.js"></script>', '<script src="shim.js"></script>');
  if (!html.includes('src="shim.js"')) throw new Error("index.html: nenašiel som skripty engine.js/app.js na nahradenie");
  html = `<!doctype html>
<html lang="sk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<style>:root{box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;padding:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${html}
</body>
</html>
`;
  fs.copyFileSync(C("shim.js"), path.join(OUT, "shim.js"));
  fs.copyFileSync(C("favicon.svg"), path.join(OUT, "favicon.svg"));
}
fs.writeFileSync(path.join(OUT, "index.html"), html);

// 4. dáta (katalóg domov, číselník, obrázky domov)
fs.cpSync(C("data"), path.join(OUT, "data"), { recursive: true });
console.log("Hotovo: " + path.relative(ROOT, OUT));
