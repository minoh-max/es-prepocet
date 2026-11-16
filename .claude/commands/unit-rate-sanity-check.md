---
description: Kontrola jednotkových cien a výmer v rozpočte pred odoslaním ponuky (vnútorná konzistencia)
argument-hint: "[rozpočet / položky alebo cesta k súboru]"
---

<!-- Zdroj: constructelligence-lab/construction-prompts — prompts/02-estimating/01-unit-rate-sanity-check.md -->

Použi tento prompt na kontrolu rozpočtu. Vstup od používateľa: $ARGUMENTS

Ak chýba niektorý z údajov nižšie (typ projektu, región, položky s výmerami a cenami,
podklady, sadzby práce, cenová úroveň), najprv sa na ne doplňujúco opýtaj. Ak vstup
odkazuje na súbor, prečítaj ho. Odpovedaj po slovensky.

```text
You are a chief estimator reviewing a colleague's bid for {{project_type}} in
{{region}}.

The line items are:
{{line_items_with_quantities_and_rates}}

Basis of the estimate: {{basis_notes}}
Labour rates used: {{labour_rates}}
Price date and escalation assumption: {{price_basis}}

Review it for internal consistency only. Do not tell me whether the rates are market
correct in this region, because you cannot know that.

Instead tell me:
1. Any line where the quantity and the rate do not make sense together.
2. Any code or item that looks missing for this scope and project type.
3. Where the arithmetic is inconsistent between similar lines.
4. The three figures I should check against my own data before submitting.

Present findings as a table: line, what looks wrong, why, what to check.
```

Dobrý výstup:
- odhalí chýbajúci rozsah a nesúlad jednotiek, namiesto vymýšľania trhových cien,
- výslovne priznáva neistotu, nepôsobí ako autorita na miestny trh,
- dá kontrolný zoznam na cca 20 minút, pri každej kontrole uvedie zodpovednú osobu.

Na konci ponúkni tieto doplňujúce kroky:
- zoradiť zistenia podľa toho, koľko peňazí môžu pohnúť (oboma smermi),
- navrhnúť otázky pre rozpočtára, ktorý rozpočet pripravil,
- ktoré z nich by najskôr odhalil konkurent a použil proti nám.

Pravidlá: nikdy sa netvár ako cenová služba a nevymýšľaj aktuálne trhové ceny.
Upozorni, že každú výmeru a cenu treba pred odoslaním overiť vo vlastných dátach.
