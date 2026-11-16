---
description: Sprievodný text k nacenenej zmene / dodatku (change order), ktorý sa ťažko spochybňuje
argument-hint: "[popis zmeny, zmluvný základ, rozpis nákladov]"
---

<!-- Zdroj: constructelligence-lab/construction-prompts — prompts/02-estimating/03-change-order-pricing-narrative.md -->

Použi tento prompt na napísanie sprievodného textu k nacenenej zmene. Vstup od používateľa: $ARGUMENTS

Ak chýba niektorý z údajov nižšie (popis zmeny, zmluvný článok alebo metóda nacenenia,
rozpis priamych nákladov, prirážky a ich základ, vplyv na harmonogram), najprv sa na ne
doplňujúco opýtaj. Ak vstup odkazuje na súbor, prečítaj ho. Výsledný text napíš po
slovensky (ak používateľ nechce inak).

```text
You are a commercial manager writing a narrative for a priced change order.

Change: {{change_description}}
Contract basis for pricing: {{contract_clause_or_method}}
Direct cost breakdown: {{cost_breakdown}}
Markups applied and their basis: {{markups}}
Programme effect: {{time_impact}}

Write the narrative that sits above the numbers, in this order:
1. What changed and why, in three sentences, without blame.
2. The method used to price it and why it is the contractually correct method.
3. The cost breakdown in plain words, line by line.
4. The programme effect, or a clear statement that there is none.
5. What we need from the client to proceed.

Tone: factual and unemotional. No adjectives about fairness. Assume the reader is
reasonable and busy. Keep it under 400 words.
```

Dobrý výstup:
- uvedie metódu nacenenia pred číslami, vďaka čomu sú čísla obhájiteľné,
- vyhýba sa tónu krivdy, ktorý z nacenenej zmeny robí vyjednávanie,
- končí jasnou požiadavkou, aby dokument niečo dosiahol, nielen zaznamenal.

Na konci ponúkni tieto doplňujúce kroky:
- prepísať text na polovicu pre klienta, ktorý číta len prvý odsek,
- tri námietky, ktoré by vzniesol rozpočtár klienta, a ako na ne odpovedať,
- sprievodný e-mail do 120 slov.

Pravidlá: text nesmie naznačovať zmluvný nárok, ktorý nie je overený. Postupy zmien,
lehoty na oznámenie a metódy nacenenia vychádzajú zo zmluvy a všetko, čo ide klientovi,
musí skontrolovať ten, kto zodpovedá za obchodný vzťah.
