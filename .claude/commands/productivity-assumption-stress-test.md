---
description: Záťažový test predpokladov produktivity práce – koľko marže visí na odhadnutých výkonoch
argument-hint: "[profesia, predpokladané výkony a výmery, história, zloženie čaty]"
---

<!-- Zdroj: constructelligence-lab/construction-prompts — prompts/02-estimating/04-productivity-assumption-stress-test.md -->

Použi tento prompt na záťažový test predpokladov produktivity. Vstup od používateľa: $ARGUMENTS

Ak chýba niektorý z údajov nižšie (profesia, predpokladané výkony a výmery, z čoho
vychádzajú, vlastná história na podobných prácach, plánované zloženie čaty), najprv sa
na ne doplňujúco opýtaj. Ak vstup odkazuje na súbor, prečítaj ho. Odpovedaj po slovensky.

```text
You are a labour planner for {{trade_scope}} work.

Our estimate assumes:
{{assumed_rates_and_quantities}}

Basis for those assumptions: {{basis}}
Our own history on similar work: {{historical_rates}}
Crew composition planned: {{crew_plan}}

Stress test the assumptions:
1. Which assumption does the most damage if it is wrong by 15 percent?
2. Which are most likely to be wrong on this job given the conditions I described?
3. For each, what is the early indicator that would tell me within four weeks?
4. What would the labour cost be at 85 percent, 100 percent and 115 percent of the
   assumed productivity, all else equal?

Give me the sensitivity as a table, then the two assumptions worth measuring on site
rather than arguing about.
```

Dobrý výstup:
- určí, ktorý predpoklad rozhoduje o výsledku, namiesto rovnakého rizika pre všetky,
- navrhne merateľné včasné indikátory, vďaka ktorým sa riziko dá riadiť,
- ukáže výpočet, aby sa dal skontrolovať, a netvári sa, že pozná naše sadzby.

Na konci ponúkni tieto doplňujúce kroky:
- týždenný sledovací hárok pre dva vybrané indikátory,
- aká zmena čaty by zachránila prípad 85 % a koľko by stála,
- prepísať tabuľku citlivosti tak, aby sa dala ukázať klientovi bez odhalenia marže.

Pravidlá: sadzby práce a maržu nedávať do bezplatných/spotrebiteľských AI nástrojov.
Citlivosť je len taká dobrá ako zadaný rozsah a po štyroch týždňoch na stavbe ju treba
prepočítať s vlastnými nameranými výkonmi.
