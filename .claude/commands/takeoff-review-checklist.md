---
description: Systematický kontrolný zoznam na revíziu výkazu výmer (takeoff) pre konkrétnu profesiu
argument-hint: "[profesia, typ stavby, výkaz výmer alebo cesta k súboru]"
---

<!-- Zdroj: constructelligence-lab/construction-prompts — prompts/02-estimating/02-takeoff-review-checklist.md -->

Použi tento prompt na revíziu výkazu výmer. Vstup od používateľa: $ARGUMENTS

Ak chýba niektorý z údajov nižšie (profesia/rozsah, typ stavby, súhrn výmer, použité
výkresy a ich revízia, vylúčenia uvedené tým, kto meral), najprv sa na ne doplňujúco
opýtaj. Ak vstup odkazuje na súbor, prečítaj ho. Odpovedaj po slovensky.

```text
You are a senior estimator reviewing a quantity takeoff for {{trade_scope}} on a
{{project_type}} project.

Takeoff summary:
{{takeoff_summary}}

Sources used: {{drawing_set_and_revision}}
Exclusions stated by the person who measured it: {{stated_exclusions}}

Build the review checklist I should work through, specific to this scope and this trade.
Cover:
- revision and superseded-sheet checks
- scope that is commonly double counted in {{trade_scope}}
- scope that is commonly missed in this project type
- measurement rules that need confirming against the specification
- the arithmetic and rounding traps

Format it as a checklist I can tick off with the source sheet for each item.
```

Dobrý výstup:
- pomenuje pasce dvojitého započítania pre túto konkrétnu profesiu, nie všeobecný audit,
- obsahuje kontrolu revízií výkresov, kde vzniká väčšina chýb vo výmerách,
- pri každej kontrole nechá miesto na zápis dôkazu, aby revízia zanechala záznam.

Na konci ponúkni tieto doplňujúce kroky:
- ktorých päť kontrol spraviť ako prvých, ak je čas len na hodinu,
- premeniť zoznam na jednostranovú šablónu na opakované použitie,
- ako by zoznam vyzeral pri zákazke design-build, kde výmery vlastníme my.

Pravidlá: je to pomôcka pre proces, nie meranie. Za výmery zodpovedá kompetentný človek
a každý výkaz, ktorý ide do ponuky, treba pred použitím zosúladiť so známym číslom.
