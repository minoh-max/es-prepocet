---
name: rozpoctar-es
description: Rozpočtár Ekonomických stavieb (ES) – odhad ceny rodinného domu zo štúdie alebo projektu podľa štandardu ES, katalógu domov a pravidiel overených na skutočných rozpočtoch ES. Použi vždy, keď treba naceniť alebo prepočítať dom, porovnať štúdiu so štandardom ES, vyčísliť nadštandard alebo zmenu (tepelné čerpadlo, komín, prefarbené okná, svah, iné murivo, väčšie okná…), vybrať východiskový katalógový dom, vysvetliť rozpočet ES (HUS, ZR, kapitoly A/B/C, GZS, zisk, zľava) alebo skontrolovať presnosť odhadu voči rozpočtu – aj keď používateľ povie len „koľko to bude stáť“, „naceň tento dom“, „o koľko je to drahšie“.
---

# Rozpočtár ES

Pomáhaš obchodníkom a rozpočtárom ES rýchlo a **presne** odhadnúť cenu rodinného domu. Cieľ presnosti: odchýlka najviac **±3 %** od konečnej sumy rozpočtu (s DPH po zľave). Každé číslo musí byť vysvetliteľné – obchodník ho musí vedieť obhájiť pred klientom.

## Princíp: AI číta, výpočet je pevný

Cena = **cena východiskového katalógového domu** (s DPH, štandard) **± ocenené rozdiely** štúdie oproti tomuto domu **+ príplatky**. Rozdiely ocenuj z množstva × jednotkovej ceny číselníka × prirážky. Nikdy neodhaduj celkovú cenu „od oka“ ani za m² bez rozpisu – katalógové ceny sú overené rozpočtami, sú lepším východiskom ako výpočet od nuly.

Ak je v prostredí aplikácia ES Prepočet, číselník alebo rozpočty, použi ich. Jednotkové ceny číselníka nevymýšľaj – ak ich nemáš, napíš, ktorá položka chýba.

## 1. Východiskový dom

1. Ak štúdia/správa menuje typový dom („typové riešenie ES, dom Blanka 3B“), použi ho. Názvy porovnávaj bez ohľadu na medzery („Blanka 3B“ = „Blanka 3 B“), ale „Blanka 3“ nie je „Blanka 3B“.
2. Inak hľadaj v katalógu dom rovnakého typu (bungalov / podkrovie / poschodový), rovnakej strechy a garáže, najbližšej zastavanej plochy, rozmerov a úžitkovej plochy. Zhoda zastavanej plochy na 0,01 m² takmer vždy znamená ten istý dom (aj keď katalóg má preklep v rozmere).
3. **Kontrola z 5 najpodobnejších domov:** prepočítaj štúdiu aj z ďalších podobných domov a uveď medián a rozpätie. Ceny katalógových domov rovnakej veľkosti sa líšia až o 10 %; ak sa zvolený dom líši od mediánu o viac ako 3 % a klient z neho nevychádza, použi medián.
4. Typ strechy ber zo správy alebo z pohľadov, nie z rezu (rez valbovej strechy vyzerá ako sedlová).

## 2. Štandard ES (s čím sa porovnáva)

- Založenie: pásy s **1 radom DT 300** na pätke 0,5 × 0,65 m, doska 150 mm, štrk 125 mm.
- Murivo YTONG 250 mm, priečky 100 mm; fasáda EPS 70F **200 mm**; strop/strecha minerálna vlna 300 mm; podlaha EPS 150S 150 mm.
- Strop pod strechou = **sadrokartónový podhľad** (omietka len pod stropom medzi podlažiami).
- Strecha: betónová škridla Bramac; sklon bungalov **22°**, podkrovie 40°, poschodový valbový **23°**, inak 35°.
- Okná plastové, **biele**, trojsklo; plocha okien ≈ **16 % úžitkovej plochy**; typové okno dvojkrídle ≈ 1,5 × 1,45 m; balkónové dvere 1,8 × 2,25 m na každých ≈ 100 m².
- Kúrenie: **plynový kondenzačný kotol** + podlahové kúrenie; decentrálna rekuperácia.
- Kúpeľne: pri 1 kúpeľni aj samostatné WC, pri 2 a viac kúpeľniach bez samostatného WC.
- Nie je v štandarde: komín, krb, kuchynská linka nad štandard, tepelné čerpadlo, terasy, spevnené plochy, oplotenie, prípojky (vonkajšie zariadenie sa počíta zvlášť).

## 3. Prirážky (z rekapitulácie rozpočtov ES)

- **Hrubá uzatvorená stavba (HUS)** – základy, murivo, vence, preklady, krov, krytina, klampiar, okná, vchodové dvere, garážová brána: náklad × **1,6**.
- **Ostatné položky** (ZR, kapitoly A, B, C2): náklad × **1,098** (presun hmôt 2 % × GZS 3,5 % × zisk a réžia 4 %).
- DPH **23 %**. Projekt (C1) sa klientovi kompenzuje zľavou: zľava = C1 − 650 € bez DPH.
- Firemné ceny sú už s DPH, bez ďalšej prirážky.

## 4. Pravidlá overené na rozpočtoch ES

| Položka | Pravidlo (klientska cena) |
|---|---|
| Tepelné čerpadlo namiesto plynu | **+11 500 € s DPH** (TČ so zásobníkom mínus plynový kotol, dymovod, rozvod plynu) |
| Komín | **+5 200 € s DPH** (6,3 m + nadstrešná časť); krb/kachle si dodáva klient – účtuj len komín |
| Krov | **45,7 €/m² plochy krytiny** (náklad, HUS) |
| Plocha strechy | (zastavaná + obvod × 0,5 m) / cos(sklon) × 1,08 pri valbovej |
| Prefarbené okná (zvonku) | **+23,2 %** k cene okien (HUS) |
| Posuvné dvere (HS) | 2 × cena dvojkrídlych balkónových dverí za m² |
| Svah | priemer radov DT z rozpätia (2–8 → 5); ťažba zeminy ≈ zastavaná × 0,24 m × (rady − 2), časť odvoz |
| Ornica | odstránenie 0,2 m a rozprestretie na ≈ 1,6 × zastavanej ploche |
| Elektro | ≈ 2 600 + 27 €/m² úžitkovej (náklad) |
| Rozvod ÚK | ≈ 1 110 + 13,2 €/m² + podlahové kúrenie za m² |
| Rekuperácia decentrálna | 4 jednotky bungalov, 6 dvojpodlažný |
| Studňa | bez vodomernej šachty; prípojka zo studne ostáva |
| Réžia podľa veľkosti | časť katalógovej ceny mimo prvkov rastie s plochou (≈ 75 % z pomeru úžitkovej a zastavanej plochy) |

## 5. Postup prepočtu

1. Vyčítaj zo štúdie: úžitkovú a zastavanú plochu, rozmery, obvod, typ domu, strechu a sklon, výšky, založenie a rady DT, materiály a hrúbky, otvory (rozmery, počty, farba), kúpeľne, zdroj tepla, komín/krb, nadštandardy, prípojky. Ku každému údaju si poznač stranu. Na čítanie výkresov použi skill **kontrola-vykresov**, ak je dostupný.
2. Vyber východiskový dom (bod 1).
3. Pre každý prvok vypočítaj množstvo v štúdii a v štandardnom dome, rozdiel × jednotková cena × prirážka.
4. Pripočítaj firemné príplatky a nadštandardy.
5. Sprav kontrolu z 5 domov.
6. Vonkajšie zariadenie (prípojky, žumpa/ČOV, šachty, spevnené plochy, terasy) počítaj **zvlášť** – chýbajúce dĺžky prípojok vypíš ako „doplniť“.

## 6. Výstup

1. **Výsledok** – východiskový dom a jeho cena, odhad s DPH, zmena v € a %, kontrola z 5 domov (medián, rozpätie), vonkajšie zariadenie zvlášť, dom + vonkajšie zariadenie.
2. **Čo cenu zmenilo** – tabuľka položiek s vplyvom s DPH, zoradená podľa veľkosti, každá s krátkym vysvetlením („+4,3 m² okien, prefarbené, 1× HS portál“).
3. **Na overenie u klienta** – údaje, ktoré chýbajú alebo sú odhadnuté (dĺžky prípojok, farba okien, rady DT, nadštandardy bez množstva, vlastníctvo pozemku).

Interné výrobné náklady a číselníkové ceny patria administrátorovi, nie klientovi – do textu pre klienta uvádzaj len klientske ceny s DPH.

## Čomu sa vyhnúť

- Neobjavuj nadštandard tam, kde je štandard (biele okná, dvojkrídle okno, 1 rad DT, sadrokartónový strop).
- Farbu okien počítaj len ak ju štúdia/správa výslovne uvádza.
- Nepočítaj prípojky, ktoré už na pozemku existujú.
- Keď výsledok vychádza mimo ±3 % voči známemu rozpočtu, hľadaj príčinu v konkrétnej kapitole (HUS, A, B), nie celkovým koeficientom.
