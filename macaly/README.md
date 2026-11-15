# ES Prepočet v Macaly (macaly.com)

Súbory, ktoré sa pridávajú do projektu Macaly (TanStack Start + Convex) navyše k šablóne:

- `convex/schema.ts`, `convex/es.ts`, `convex/esNode.ts` – server: používatelia (zakladá administrátor), relácie,
  oprávnenia admin/obchodník, dokumenty (prepočty, profily, nastavenia), čítanie štúdie cez Claude (Macaly `llm-usage`).
- `src/legacy/boot.ts` – prepojenie overenej aplikácie (obrazovky + výpočet) s Convexom.
- `src/routes/index.tsx`, `src/legacy/logo.ts`, `src/metadata.json`.
- Do `public/` sa kopíruje výstup `npm run build`: `public/app.js` a `public/engine.js` → `public/legacy/`,
  `client/styles.css` (+ štýly prihlásenia) → `public/legacy/styles.css`, `public/data/` → `public/data/`.

Prvý administrátor: premenné `ES_ADMIN_EMAIL`, `ES_ADMIN_PASSWORD` (dočasné heslo, pri prvom prihlásení sa mení).
