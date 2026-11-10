# ES Prepočet

Interná webová aplikácia Ekonomických stavieb na **odborný cenový odhad domu** podľa štúdie klienta.
Obchodník nahrá PDF štúdie, aplikácia ju prečíta (AI), porovná so štandardom ES a s katalógovým domom
a vypočíta odhad domu aj vonkajšieho zariadenia a prípojok. Výsledok sa dá uložiť a exportovať do PDF.

## Čo je v projekte

| Priečinok | Obsah |
|---|---|
| `engine/` | Výpočtové jadro (TypeScript): prvky domu, geometria, ceny z číselníka, prípojky, testy |
| `client/` | Aplikácia v prehliadači: obrazovky (`ui.js`), čítanie štúdií a PDF (`logic.js`), prepojenie so serverom (`shim.js`), dáta (katalóg domov, číselník, obrázky domov) |
| `server/` | Server: prihlásenie, používatelia, databáza, súbory, AI (Anthropic) |
| `public/` | Hotová aplikácia, ktorú server posiela do prehliadača. Vzniká príkazom `npm run build`, **neupravovať ručne** |
| `test/` | Testy servera a celého toku v prehliadači |

## Nasadenie na Render (prvýkrát)

1. Vytvorte účet na [render.com](https://render.com) a prepojte ho s GitHubom.
2. V Rendri: **New → Blueprint**, vyberte tento repozitár. Render podľa `render.yaml` založí databázu a webovú službu (Frankfurt).
3. Vyplňte tri hodnoty:
   - `ANTHROPIC_API_KEY` – kľúč z [console.anthropic.com](https://console.anthropic.com) (čítanie štúdií),
   - `ADMIN_EMAIL` – e-mail prvého administrátora,
   - `ADMIN_PASSWORD` – jeho heslo (aspoň 8 znakov).
4. Po nasadení otvorte adresu služby (napr. `https://es-prepocet.onrender.com`) a prihláste sa ako administrátor.
5. **Nastavenia → Používatelia**: pridajte obchodníkov. Každý dostane dočasné heslo, ktoré si pri prvom prihlásení zmení.

Vlastná adresa (napr. `prepocet.ekonomicke-stavby.sk`): v Rendri **Settings → Custom Domains → Add**,
potom u správcu domény pridajte záznam **CNAME** `prepocet` → adresa služby na `onrender.com`. HTTPS certifikát Render vystaví sám.

Mesačné náklady: webová služba Starter a databáza Basic na Rendri + spotreba AI podľa počtu prečítaných štúdií
(prehľad v Nastavenia → Používatelia → „AI tento mesiac“).

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
(Render pri nasadení nič nezostavuje, len inštaluje závislosti a spúšťa server).

`npm run build:artifact` zostaví rovnakú aplikáciu aj ako stránku pre Claude (`dist-artifact/`).

### Premenné prostredia

| Premenná | Význam |
|---|---|
| `DATABASE_URL` | PostgreSQL; `memory` = skúšobná databáza v pamäti |
| `ANTHROPIC_API_KEY` | kľúč pre čítanie štúdií cez AI |
| `AI_MODEL`, `AI_MODEL_QUICK` | model na čítanie štúdií a na krátke zhrnutia |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | prvý administrátor (len pri prázdnej databáze) |
| `AI_MOCK=1` | testovacie odpovede AI bez kľúča |
| `PORT` | port servera (Render nastavuje sám) |

### Oprávnenia

Prihlásiť sa môže len používateľ, ktorého založí administrátor. Obchodník vidí katalóg, číselník a prepočty
a mení len svoj profil a svoje prepočty. Administrátor mení aj nastavenia firmy, výpočtu, číselník a používateľov.
Heslá sú uložené ako bcrypt hash, prihlásenie je cez httpOnly cookie (30 dní), po 5 zlých pokusoch sa účet na 15 minút zamkne.
