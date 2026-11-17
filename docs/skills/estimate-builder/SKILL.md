---
name: estimate-builder
description: Zostavenie položkového rozpočtu rodinného domu v štruktúre rozpočtu Ekonomických stavieb (ES) – kapitoly HUS, ZR, A1–A5, B1–B8, C1, C2, rekapitulácia s presunom hmôt, GZS, ziskom a réžiou, zľavou za projekt (C1 − 650 €) a DPH, export do Excelu (krycí list, rekapitulácia, položky). Použi, keď treba z výkazu výmer alebo zo štúdie poskladať položkový rozpočet ES, prepočítať rekapituláciu, overiť súčty rozpočtu ES, alebo pripraviť rozpočet do Excelu – aj keď používateľ povie len „sprav rozpočet po položkách“, „poskladaj to do rekapitulácie“, „koľko to vyjde s GZS a ziskom“.
license: MIT (upravené z DDC estimate-builder, © 2026 DataDrivenConstruction)
---

# Položkový rozpočet ES (estimate builder)

Skladá rozpočet presne podľa rekapitulácie rozpočtov ES. Výpočet je v `scripts/es_rozpocet.py` (Python, pandas + openpyxl na export).
**Overené:** z kapitol rozpočtov 106/26 a 226/21 vychádza bez DPH na 0,01 € a konečná suma s DPH presne (201 079 €, 207 285 €).

## Kedy ktorý nástroj
- **Rýchly odhad zo štúdie** (katalógový dom ± rozdiely, medián z 5 domov) → aplikácia ES Prepočet / skill `rozpoctar-es`.
- **Položkový rozpočet** (výmery × jednotkové ceny číselníka ES → rekapitulácia) → tento skill.
- **Kontrola hotového rozpočtu** → `kontrola-jednotkovych-cien`; **spresnenie podľa skutočných rozpočtov** → `kalibracia-rozpoctov`.

## Rekapitulácia ES (ako počíta skript)
| Riadok | Výpočet |
|---|---|
| HUS – hrubá uzatvorená stavba | položky v nákladových cenách × 1,486 (celkový faktor HUS 1,6 vrátane GZS a zisku) |
| ZR – Šikovné ručičky | položky + presun hmôt 2 % |
| A – HSV, B – PSV | položky + presun hmôt 2 % **bez dodávok GD** |
| Dodávky GD (tepelné čerpadlo, rozšírenie TČ, rekuperácia) | v kapitole B2, **bez presunu a bez GZS** (`dodavka: true`) |
| GZS | 3,5 % z (MO + HSV + PSV − dodávky) |
| Zisk a réžia | 4 % z (základ GZS + GZS + C2) |
| Celkom bez DPH | MO + HSV + PSV + GZS + C2 + zisk + C1 |
| Zľava | −(C1 − 650 €) – projekt sa klientovi kompenzuje |
| S DPH | (bez DPH + zľava) × 1,23, zaokrúhlené na celé € |

Ostatné položky (mimo HUS) majú tým celkový faktor ≈ 1,098 – rovnako ako v aplikácii.

## Postup
1. **Vstupy** – ak chýbajú, vypýtaj si ich; nič nevymýšľaj:
   - výmery z výkresov (kontrola-vykresov / rozpoctar-es) s odkazom na výkres a kótu,
   - jednotkové ceny z **číselníka ES** (nie trhové odhady; chýbajúcu cenu označ „doplniť“),
   - zákazka, investor, umiestnenie (k. ú., p. č.), projekt C1.
2. **Zaraď každú položku do kapitoly** podľa rozpočtu ES (napr. okná, krov, krytina, murivo → HUS; omietky, podlahy → ZR alebo A4; inštalácie → B2; obklady → B6). Tepelné čerpadlo a rekuperáciu označ ako dodávku GD.
3. **Zapíš JSON** a spusti skript:
   ```json
   {"zakazka": "106/26", "investor": "…", "umiestnenie": "k.ú. …, p.č. …",
    "polozky": [
      {"kapitola": "HUS", "popis": "stena z muriva Porobeton hr. 250 mm", "mj": "m2", "mnozstvo": 92.06, "jcena": 61.5},
      {"kapitola": "B2", "popis": "tepelné čerpadlo – základná zostava", "mj": "sb", "mnozstvo": 1, "jcena": 9218.20, "dodavka": true},
      {"kapitola": "C1", "popis": "projektová príprava a inžinierska činnosť", "mj": "sb", "mnozstvo": 1, "jcena": 23076}
    ]}
   ```
   `python3 scripts/es_rozpocet.py rozpocet.json rozpocet.xlsx` – vypíše „Na overenie“, rekapituláciu a uloží Excel (Krycí list, Rekapitulácia, Položky).
4. **Kontrola** – prejdi hlásenia skriptu (nulové množstvo, chýbajúca cena, chýbajúce C1, dodávka mimo A/B), potom kontrolu konzistencie (`kontrola-jednotkovych-cien`).
5. **Výstup** – rekapitulácia a konečná suma s DPH; zoznam položiek s odhadnutou výmerou a vecí na overenie u klienta.

## Zásady
- Klientovi ukazuj len klientske ceny s DPH; nákladové ceny číselníka sú interné (len administrátor).
- Rozhodnutia klienta po štúdii (farba okien, sprchový kút, schody, OSB obklady…) nedopĺňaj sám – uveď ich ako otázky.
- Rozpočty a údaje klientov nedávaj na GitHub ani na verejné adresy.
- HUS faktor 1,6 je kalibrovaný na rozpočtoch ES; ak máš k zákazke súpis „Stavba“ (výrobné náklady) aj „Klient“, over ho a prípadnú odchýlku zapíš do skillu `kalibracia-rozpoctov`.

---
Upravené z „estimate-builder“ (DDC Skills for AI Agents in Construction) – MIT License, © 2026 DataDrivenConstruction. Zmeny: štruktúra a rekapitulácia rozpočtu ES, slovenčina, export v podobe ES.
