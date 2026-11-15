# ES Prepočet 2 – návrh

Dátum: 2026-11-15 · Stav: návrh na schválenie

## Prečo a pre koho

Interný nástroj obchodníkov Ekonomických stavieb (ES). Obchodník dostane od klienta **štúdiu v PDF**
(textová časť + výkresy) a potrebuje rýchlo a **presne odhadnúť cenu domu**: koľko stojí oproti
**štandardu ES** a **čo všetko je navyše**. Výsledok a zoznam navýšení obchodník sám komunikuje s klientom –
aplikácia nie je klientsky dokument.

Dnešná aplikácia (tento repozitár) funguje, ale chceme **novú aplikáciu**: nový vzhľad podľa
www.ekonomicke-stavby.sk a www.apple.com, jednoduchší postup pre obchodníka a presnejšie čítanie štúdie.
Hlavné kritérium úspechu: **presný prepočet**.

## Ciele

1. Nahrať jedno alebo viac PDF štúdie (text aj výkresy) a dostať odhad ceny.
2. Dva typy projektov:
   - **Úprava katalógového domu** – štúdia vychádza z domu z katalógu ES (716 domov). Cena = katalógová cena
     ± ocenené rozdiely oproti štandardu ES + príplatky.
   - **Individuálny projekt** – žiadny katalógový dom; údaje sa čerpajú len z výkresov a textovej časti.
3. Pri každom zistenom údaji a rozdiele ukázať **odkiaľ ho AI vzala** (súbor, strana, citát/výrez)
   a **ako bol ocenený** (položka číselníka, množstvo, jednotková cena), aby ho obchodník vedel overiť a opraviť.
4. Výsledok: cena domu (s DPH), rozpis „katalógová cena → rozdiely → príplatky“, zvlášť vonkajšie úpravy a prípojky,
   a **zoznam toho, čo je navyše oproti štandardu**.
5. Ukladanie prepočtov: obchodník vidí svoje, administrátor všetky.
6. Interný PDF výstup („Uložiť ako PDF“) ako podklad obchodníka na stretnutie.

## Mimo rozsahu (non-goals)

- Prémiové účty / rozdielne funkcie pre používateľov – **nie** (všetci obchodníci majú to isté).
- DWG/DXF a iné CAD súbory – zatiaľ **nie**, len PDF.
- Klientsky portál, verejná kalkulačka, platby.
- Položkový rozpočet na úrovni realizačného rozpočtu.

## Anti-ciele (zlyhanie, aj keby to „fungovalo“)

- Číslo, ktoré sa nedá vystopovať (obchodník nevie povedať, prečo je cena taká).
- Rovnaká štúdia dá pri opakovanom spustení inú cenu (cena nesmie počítať AI).
- Nová aplikácia je **menej presná** ako dnešná.
- Tichá chyba čítania (prehliadnutý krb, zlá plocha) bez upozornenia.

## Obmedzenia

- Beží na **Netlify + Neon (PostgreSQL) + Anthropic API kľúč** – ako dnes (schválené používateľom).
- Bezplatné limity Netlify (6 MB na požiadavku, funkcia na pozadí max. 15 min), viď README.
- Jazyk rozhrania: slovenčina.
- Web ekonomicke-stavby.sk nebol z vývojového prostredia dostupný; identita ES sa preberá z dnešnej aplikácie
  (písmo Noto Sans, modrá ES `#074d8a`, logo „es“) – viď otvorené otázky.

## Zvažované cesty

| Cesta | Čo znamená | Prínos / cena |
|---|---|---|
| **1. Nová aplikácia na overenom jadre** ✅ zvolená | Nové obrazovky a postup, lepšie čítanie PDF; výpočtové jadro `engine/`, katalóg, číselník, štandard ES a server ostávajú | Presnosť sa nezhorší, zlepší sa čítanie; stredný rozsah |
| 2. Všetko od nuly vrátane výpočtu | Nový výpočet podľa štandardu a číselníka | Najdlhšie, kým sa neodladí na rozpočtoch, menej presné |
| 3. Len stránka v Claude bez servera | Ukladanie a AI cez Claude | Keďže Netlify a kľúč smú zostať, nič neprináša; slabšia správa používateľov |

Zvažovaný bol aj externý nástroj `construction-drawing-analyzer` (skill pre Claude Code + Python). Priamo nepoužiteľný
(vyžaduje Claude Code a Python u obchodníka, je archivovaný), prevzaté sú dva nápady: **najprv text, až potom obrázky**
a **meranie plôch z vektorových čiar PDF**.

Princíp výpočtu (zvolený, „cesta A“): **AI číta, aplikácia počíta.** AI z PDF vytiahne fakty s odkazom na zdroj;
cenu počíta deterministické jadro `engine/` z katalógovej ceny a číselníka.

## Čo zostáva z dnešnej aplikácie

- `engine/` – výpočtové jadro (prvky domu, geometria, ceny z číselníka, prípojky, štandard ES v `defaults.ts`) a jeho testy.
  Mení sa len tam, kde to vyžaduje individuálny projekt alebo nové údaje (viď nižšie).
- `client/data/` – katalóg domov (`houses.json`), číselník (`ciselnik.json`), obrázky domov.
- `server/` – prihlásenie, používatelia, databáza, AI úlohy na pozadí, Netlify funkcie. Rozširuje sa, nevymieňa.
- Nastavenia výpočtu (prirážky, sadzby, štandard), import číselníka, evidencia skutočnej ceny a karta „Presnosť odhadov“.

## Čo je nové

### 1. Vzhľad (ES × Apple)

- Svetlé, vzdušné plochy, veľká typografia nadpisov a čísel (Apple), farby a logo ES.
- Jedna hlavná vec na obrazovku; výsledná cena ako veľké „hero“ číslo, pod ním rozpis.
- Jemné karty so zaoblením, bez rámikov navyše, plynulé prechody medzi krokmi.
- Funguje na notebooku aj iPade/iPhone (obchodník u klienta).

### 2. Postup obchodníka (4 kroky)

```
1 Podklady        2 Čo som našiel           3 Rozdiely a cena          4 Výsledok
[ pretiahni PDF ] [ dom: Lucie 89 (92 %) ] [ +38 m² úžitkovej  +9 800 ] [  248 600 € s DPH ]
 typ projektu:    [ plocha 131,5 m² ✓ s.3 ] [ krb               +4 200 ] [ navyše: krb, TČ, … ]
 ○ z katalógu     [ krb ⚠ overiť     s.7 ] [ TČ namiesto plynu +6 100 ] [ Uložiť · PDF       ]
 ○ individuálny   [ …                     ] [ vonk. úpravy zvlášť      ]
```

1. **Podklady** – nahratie PDF, voľba typu projektu (AI navrhne podľa obsahu, obchodník potvrdí).
2. **Čo som našiel** – rozpoznané údaje s mierou istoty (isté / odvodené / overiť) a odkazom na stranu;
   klik ukáže výrez strany alebo citát. Všetko sa dá opraviť. Polia „overiť“ sú zvýraznené a pred výsledkom
   ich treba potvrdiť alebo opraviť.
3. **Rozdiely a cena** – zoznam rozdielov oproti štandardu ES / katalógovému domu, každý s cenou a položkou číselníka;
   dá sa vypnúť alebo upraviť množstvo. Vonkajšie úpravy a prípojky zvlášť.
4. **Výsledok** – cena, rozpis, zoznam „navyše oproti štandardu“, uloženie, PDF pre obchodníka.

### 3. Presnejšie čítanie štúdie

- **Text najprv:** z každej strany sa vytiahne textová vrstva (tabuľky miestností, legendy, technická správa);
  strany s dostatkom textu idú na AI ako text. Obrázky (s výrezmi vo vysokom rozlíšení) len pre výkresy.
  (Dnešná aplikácia to robí čiastočne – zachovať a zlepšiť.)
- **Plochy z čiar:** pri vektorových PDF aplikácia v prehliadači zistí z kresby obrys domu a mierku a
  odmeria zastavanú plochu / rozmery. Pri nezhode so štúdiou alebo s AI (> 5 %) upozorní.
- **Kontroly súladu:** súčet plôch miestností vs. uvedená úžitková plocha, rozmery vs. zastavaná plocha,
  bungalov s úžitkovou > zastavaná atď. (časť existuje v `logic.js`).
- **Zdroj ku každému údaju:** AI vracia pri každom údaji stranu a krátky citát; ukladá sa k prepočtu.
- **Skeny:** PDF bez textovej vrstvy sa číta len obrazom; všetky plošné údaje sa automaticky označia „overiť“.

### 4. Individuálny projekt

Navrhované riešenie (rozhodnutie autora návrhu, môže sa zmeniť): jadro počíta cenu ako rozdiel oproti
východiskovému domu, preto sa pre individuálny projekt **automaticky zvolí najbližší katalógový dom ako referencia**
(typ domu, podlažnosť, strecha, plocha) a všetko ostatné sa zoberie zo štúdie. Obchodník referenciu vidí a môže ju
zmeniť; vo výsledku je projekt jasne označený ako individuálny a referenčný dom sa klientovi neuvádza.
Dôvod: katalógové ceny sú overené skutočnými rozpočtami, takže sú presnejším východiskom ako cena „od nuly“.

## Overovanie presnosti

- Existujúce testy `engine/` musia ostať zelené; nové pravidlá dostanú testy.
- **Referenčná sada štúdií** so skutočnou cenou z rozpočtu: automatický test „štúdia → odhad“ a porovnanie s cenou.
  Cieľová presnosť a súbor štúdií – viď otvorené otázky.
- Po nasadení: evidencia skutočnej ceny a karta „Presnosť odhadov“ (existuje).
- Postup práce: každý krok sa overí (testy + ukážka používateľovi) a až potom sa pokračuje.

## Necháva sa na staviteľa

- Technické členenie kódu, knižnice (v rámci dnešného stacku: Preact/htm, pdf.js, pdfmake, esbuild).
- Presné prahy istoty a kontrol, rozloženie obrazoviek v rámci opísaného postupu.
- Migrácia uložených prepočtov zo starej verzie (zachovať čitateľné).

## Otvorené otázky (pre používateľa)

- Cieľová presnosť (napr. ±3 % od rozpočtu) a dostupnosť niekoľkých štúdií so skutočnou cenou na overenie.
- Logo a farby ES – potvrdiť alebo dodať (web nebol dostupný).

## Rozhodnutia autora návrhu (na kontrolu)

- Nová aplikácia **nahradí** dnešnú v tomto repozitári a na tej istej adrese (nie druhá aplikácia vedľa).
- Uložené prepočty zo starej verzie ostanú čitateľné.
- Individuálny projekt sa počíta cez automaticky zvolený referenčný katalógový dom (viď vyššie).
- Pred výsledkom treba potvrdiť alebo opraviť všetky polia označené „overiť“.
- Interný PDF výstup pre obchodníka ostáva; klientsky dokument nie.
