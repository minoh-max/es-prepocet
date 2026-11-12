# ES Prepočet

Interná webová aplikácia Ekonomických stavieb na **odborný cenový odhad domu** podľa štúdie klienta.
Obchodník nahrá PDF štúdie, aplikácia ju prečíta (AI), porovná so štandardom ES a s katalógovým domom
a vypočíta odhad domu aj vonkajšieho zariadenia a prípojok. Výsledok sa dá uložiť a exportovať do PDF.

## Čo je v projekte

| Priečinok | Obsah |
|---|---|
| `engine/` | Výpočtové jadro (TypeScript): prvky domu, geometria, ceny z číselníka, prípojky, testy |
| `client/` | Aplikácia v prehliadači: obrazovky (`ui.js`), čítanie štúdií a PDF (`logic.js`), prepojenie so serverom (`shim.js`), dáta (katalóg domov, číselník, obrázky domov) |
| `server/` | Server: prihlásenie, používatelia, databáza, súbory, AI (Anthropic); `netlify.js` = prepojenie s Netlify |
| `netlify/functions/` | Netlify funkcie: `api` (celé rozhranie) a `ai-worker-background` (čítanie štúdie na pozadí) |
| `public/` | Hotová aplikácia, ktorú server posiela do prehliadača. Vzniká príkazom `npm run build`, **neupravovať ručne** |
| `test/` | Testy servera a celého toku v prehliadači |

## Nasadenie na Netlify (bezplatne) – prvýkrát

Aplikácia beží na Netlify (obrazovky a serverové funkcie) a údaje sú v databáze Neon. Obe služby sú v bezplatnom pláne.

### 1. Databáza na Neon
1. Na [neon.com](https://neon.com) sa prihláste (napr. cez GitHub) a vytvorte projekt **es-prepocet**.
   Región: **AWS Europe Central 1 (Frankfurt)** – údaje ostanú v EÚ.
2. Na úvodnej stránke projektu kliknite na **Connect**, zapnite **Connection pooling** a skopírujte adresu
   (začína `postgresql://…-pooler…neon.tech/neondb?sslmode=require…`). Toto je hodnota `DATABASE_URL`.

### 2. Stránka na Netlify
1. Na [app.netlify.com](https://app.netlify.com): **Add new project → Import an existing project → GitHub** → vyberte `es-prepocet`.
2. Názov projektu (Project name): **es-prepocet** → adresa bude `https://es-prepocet.netlify.app`.
   Nastavenia zostavenia netreba meniť, sú v `netlify.toml`.
3. Pred prvým nasadením (alebo hneď potom) otvorte **Project configuration → Environment variables** a pridajte:

| Premenná | Hodnota |
|---|---|
| `DATABASE_URL` | adresa z Neonu (krok 1.2) |
| `ANTHROPIC_API_KEY` | kľúč z [console.anthropic.com](https://console.anthropic.com) (čítanie štúdií) |
| `ADMIN_EMAIL` | e-mail prvého administrátora |
| `ADMIN_PASSWORD` | jeho heslo (aspoň 8 znakov) |

   Pri kľúči a hesle zaškrtnite **Contains secret values**.
4. **Deploys → Trigger deploy → Deploy project**. Po nasadení otvorte `https://es-prepocet.netlify.app` a prihláste sa.
5. **Nastavenia → Používatelia**: pridajte obchodníkov. Každý dostane dočasné heslo a pri prvom prihlásení si ho zmení.

Ďalšie zmeny kódu nahraté na GitHub (vetva `main`) Netlify nasadí sám.

### Limity bezplatného plánu
- Netlify: 300 kreditov mesačne bez doplatku. Každé nasadenie = 15 kreditov (≈ 20 nasadení mesačne),
  prenos 20 kreditov/GB, výpočet funkcií 10 kreditov/GB-hod. Keď sa kredity minú, stránka sa do konca mesiaca vypne.
  Stav: **Team → Usage & billing**.
- Jedna požiadavka max. 6 MB: súbor nad 4,4 MB sa k prepočtu neuloží (prečíta sa však normálne),
  obrázky výkresov sa pred odoslaním na AI podľa potreby zmenšia.
- Čítanie výkresu cez AI beží ako úloha na pozadí (funkcia `ai-worker-background`, max. 15 minút),
  prehliadač sa každé 2 sekundy pýta na výsledok.
- Neon: 1 GB údajov, 100 hodín výpočtu mesačne; databáza po 5 minútach nečinnosti zaspí a pri ďalšej požiadavke sa zobudí.
- AI (Anthropic) sa platí podľa spotreby – v konzole Anthropic si nastavte mesačný limit.

Vlastná adresa (napr. `prepocet.ekonomicke-stavby.sk`): Netlify → **Domain management → Add a domain**,
potom u správcu domény záznam **CNAME** `prepocet` → `es-prepocet.netlify.app`. HTTPS vystaví Netlify sám.

### Iná možnosť: Render
Súbor `render.yaml` je pripravený pre Render (platený plán Starter + databáza Basic): **New → Blueprint**, vyberte repozitár
a vyplňte `ANTHROPIC_API_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.

## Ladenie presnosti (bez programovania)

- **Nastavenia → Výpočet**: prirážky, sadzby (elektro, rozvody, kúrenie, rekuperácia…), réžia pri zmene veľkosti domu,
  rekapitulácia prípojok, štandard ES a jeho popis. Zmena platí po uložení. Tlačidlo „Obnoviť predvolené“ vráti hodnoty z kódu.
- **Číselník**: import nového číselníka (Excel) – ceny položiek.
- **Prepočty → Skutočná cena**: keď je rozpočet hotový, zapíšte cenu domu z rozpočtu (s DPH, bez prípojok).
  Karta „Presnosť odhadov“ ukáže typickú odchýlku, podiel do ±3 % a či odhady vychádzajú v priemere vyššie alebo nižšie.

## Vývoj

```bash
npm install
npm run build        # zostaví public/ z client/ a engine/
npm run dev          # server na http://localhost:3000, databáza v pamäti, AI testovacie odpovede
                     # prihlásenie: admin@test.sk / heslo12345
npm test             # testy servera, výpočtu a celého toku v prehliadači
```

Po každej zmene v `client/` alebo `engine/` spustite `npm run build` a zmeny v `public/` pridajte do commitu
(Netlify síce `npm run build` spúšťa sám, Render však nie).

Testy proti skutočnému PostgreSQL: `TEST_DATABASE_URL=postgres://… npm run test:server` (tabuľky v tej databáze sa vymažú).
Test v prehliadači proti bežiacej aplikácii (napr. `netlify dev`): `E2E_URL=http://localhost:8888/ npm run test:e2e` (s prázdnou databázou).

`npm run build:artifact` zostaví rovnakú aplikáciu aj ako stránku pre Claude (`dist-artifact/`).

### Premenné prostredia

| Premenná | Význam |
|---|---|
| `DATABASE_URL` | PostgreSQL (na Netlify adresa z Neonu); `memory` = skúšobná databáza v pamäti |
| `ANTHROPIC_API_KEY` | kľúč pre čítanie štúdií cez AI |
| `AI_MODEL`, `AI_MODEL_QUICK` | model na čítanie štúdií a na krátke zhrnutia |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | prvý administrátor (len pri prázdnej databáze) |
| `AI_MOCK=1` | testovacie odpovede AI bez kľúča |
| `PORT` | port servera (Render nastavuje sám) |

### Oprávnenia

Prihlásiť sa môže len používateľ, ktorého založí administrátor. Obchodník vidí katalóg, číselník a prepočty
a mení len svoj profil a svoje prepočty. Administrátor mení aj nastavenia firmy, výpočtu, číselník a používateľov.
Heslá sú uložené ako bcrypt hash, prihlásenie je cez httpOnly cookie (30 dní), po 5 zlých pokusoch sa účet na 15 minút zamkne.
