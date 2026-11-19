---
name: kalibracia-rozpoctov
description: Postup, ako spresniť cenový odhad aplikácie ES Prepočet podľa skutočných rozpočtov ES – porovnanie štúdie s rozpočtom (Klient, Stavba, Dodávky GD, Etapy, Klient_outdoor), rozbor odchýlky po kapitolách, zaradenie príčiny (čítanie / model / rozhodnutie klienta), oprava a overenie na všetkých zákazkách naraz. Použi vždy, keď používateľ pošle rozpočet ES (RP…_Klient.pdf a pod.) k zákazke, ku ktorej je štúdia, alebo chce „spresniť aplikáciu“, „naučiť sa z rozpočtov“, „prečo odhad nesedí s rozpočtom“, „kalibrovať“, „dosiahnuť presnú cenu“.
---

# Kalibrácia odhadu podľa rozpočtov ES

Cieľ: odhad zo štúdie (+ odpovedí klienta) do **±2 %** od rozpočtu. Odhad zo samotnej štúdie nikdy nezachytí rozhodnutia klienta po štúdii – tie patria do otázok na klienta, nie do koeficientov.

## 1. Správny cieľ porovnania
- Porovnávaj s **verziou 1 rozpočtu** (urobená zo štúdie). Konečná verzia obsahuje zmeny dohodnuté neskôr (226/21: verzia 8 od r. 2021 → −8 %, nedá sa vysvetliť štúdiou).
- Suma domu = „Celkové náklady na stavbu vrátane DPH“ v **Klient** (bez prípojok). Prípojky a pozemok sú v **Klient_outdoor**, v Etapách ako PR.
- Projekt C1 je v cene bez DPH a kompenzuje sa zľavou C1 − 650 € → konečnú cenu nemení.
- **Vždy najnovšia cenová úroveň** (pokyn ES): aplikácia počíta s najnovším číselníkom a najnovšími cenami katalógu. Pri porovnaní vždy zisti „Cenová úroveň“ na 1. strane rozpočtu. Rozpočty so staršou úrovňou (napr. 241210) majú jednotkové ceny nižšie (241210 → 260504: o 7–15 % na spárovaných položkách výroby) – pred porovnaním ich preveď na najnovšiu úroveň alebo ich vyhodnocuj zvlášť; koeficienty modelu nastavuj podľa rozpočtov najnovšej úrovne.

## 2. Rozbor odchýlky
1. Prečítaj štúdiu tak, ako ju číta aplikácia (alebo použi uložené odpovede AI), a spočítaj odhad: jeden dom aj medián z 5 domov.
2. Z rozpočtu vypíš položky s nenulovým množstvom: okná (rozmery, farba), dvere, komín, DT (m²), murivo, fasáda (hrúbka), strop, krytina (m²), kúpeľne, TČ, schodisko, nadštandardy.
3. Každý rozdiel zaraď:
   - **chyba čítania** (aplikácia prečítala inak, než je vo výkrese) → oprav pravidlo v `client/logic.js` (prompt `rulesText`, alebo deterministickú úpravu v `mergePages`/`aiToStudy`);
   - **chyba modelu** (vstup je správny, cena prvku nesedí) → oprav sadzbu/množstvo v `engine/src/lib/estimate` (defaults.ts, elements.ts) – vždy podľa viacerých rozpočtov, nikdy podľa jedného;
   - **rozhodnutie klienta** (v štúdii nie je: nadštandardný sprchový kút, OSB obklady, posuvné púzdro…) → zapíš do zoznamu otázok na klienta, nemeň koeficienty;
   - **východiskový dom** (zlá strecha/rozmery v katalógu) → typový projekt do `TYPE_PROJECTS` v `client/logic.js`.
4. Prepočítaj krok po kroku a ukáž tabuľku: krok → odhad → odchýlka.

## 3. Overenie na všetkých zákazkách
- Test presnosti (skript `calib.cjs` v scratchpade: štúdia → odhad → rozpočet) spusti pred a po zmene. Zmena ide do aplikácie len ak sa **priemerná odchýlka zníži a žiadna zákazka sa nezhorší o viac ako 1 bod**.
- Výsledky doteraz (bez 226/21): jeden dom 3,0 % → medián 1,8 % → medián + farba okien 1,4 %, 5 z 5 do ±3 %.

## 4. Nasadenie
- Lokálne testy (`npm test`) → commit → patch `public/legacy/app.js` na Macaly → testy na Macaly → publikovať → overiť naživo (dočasný účet, potom zmazať).

## Ochrana údajov
Rozpočty, štúdie a mená klientov nikdy na GitHub ani na verejné adresy. Do repozitára len čísla zákaziek a súhrnné percentá.
