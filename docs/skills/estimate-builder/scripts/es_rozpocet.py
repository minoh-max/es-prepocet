"""Položkový rozpočet rodinného domu v štruktúre rozpočtu Ekonomických stavieb (ES).

Upravené z „estimate-builder“ (DataDrivenConstruction, MIT) pre rekapituláciu ES.
Rekapitulácia overená na rozpočtoch ES 106/26 a 226/21 (zhoda na 0,01 € bez DPH, konečná suma presne):
  MO   = HUS + ZR + presun 2 % zo ZR
  HSV  = A + presun 2 % z A (bez dodávok)
  PSV  = B + presun 2 % z B bez dodávok (tepelné čerpadlo, rekuperácia …)
  GZS  = 3,5 % z (MO + HSV + PSV − dodávky)
  zisk = 4 % z (základ GZS + GZS + C2)
  bez DPH = MO + HSV + PSV + GZS + C2 + zisk + C1
  zľava = −(C1 − 650 €); s DPH = (bez DPH + zľava) × 1,23, zaokrúhlené na celé €.
HUS: položky sa zadávajú nákladovou cenou z číselníka; kapitola HUS = náklad × HUS_KOEF.
Celkový faktor HUS je 1,6 vrátane GZS a zisku (kalibrácia na rozpočtoch ES), preto HUS_KOEF = 1,6 / (1,035 × 1,04).
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import List, Dict, Any, Optional
import json, sys

KAPITOLY = {
    "HUS": "Hrubá uzatvorená stavba", "ZR": "Položky programu Šikovné ručičky",
    "A1": "Zemné práce a zakladanie stavieb", "A2": "Konštrukcie zvislé a vodorovné", "A3": "Vonkajšie vedenie sietí technického vybavenia",
    "A4": "Úpravy povrchov, podlahy", "A5": "Spevnené plochy, dlažby, komunikácie",
    "B1": "Izolácie proti vode, izolácie tepelné", "B2": "Vnútorné zdravotno-technické inštalácie", "B3": "Zriaďovacie predmety",
    "B4": "Konštrukcie tesárske, klampiarske, krytiny", "B5": "Konštrukcie stolárske", "B6": "Podlahy z dlaždíc a obklady keramické",
    "B7": "Podlahy vlysové, parketové a povlakové", "B8": "Dokončovacie práce a povrchové úpravy",
    "C1": "Projektovanie a inžinierska činnosť", "C2": "Lešenie a použitie ťažkej mechanizácie",
}
PRESUN, GZS, ZISK, DPH, ZLAVA_PONECHAT = 0.02, 0.035, 0.04, 0.23, 650.0
HUS_KOEF = 1.6 / ((1 + GZS) * (1 + ZISK))

r2 = lambda x: round(x + 1e-9, 2)


@dataclass
class Polozka:
    kapitola: str
    popis: str
    mj: str
    mnozstvo: float
    jcena: float          # € bez DPH; pri HUS nákladová cena z číselníka (ak hus_klient=False)
    dodavka: bool = False  # dodávka GD bez presunu a GZS (tepelné čerpadlo, rekuperácia)
    poznamka: str = ""

    @property
    def spolu(self) -> float:
        return r2(self.mnozstvo * self.jcena)


@dataclass
class RozpocetES:
    zakazka: str = ""
    nazov: str = "Rodinný dom"
    investor: str = ""
    umiestnenie: str = ""
    hus_klient: bool = False  # True = položky HUS sú už v klientskej cene
    polozky: List[Polozka] = field(default_factory=list)

    def pridaj(self, kapitola, popis, mj, mnozstvo, jcena, dodavka=False, poznamka="") -> Polozka:
        p = Polozka(kapitola.upper(), popis, mj, float(mnozstvo), float(jcena), dodavka, poznamka)
        self.polozky.append(p)
        return p

    def kapitola(self, k: str) -> float:
        s = sum(p.spolu for p in self.polozky if p.kapitola == k)
        return r2(s if k != "HUS" or self.hus_klient else s * HUS_KOEF)

    def rekapitulacia(self) -> Dict[str, Any]:
        k = {c: self.kapitola(c) for c in KAPITOLY}
        dod_a = sum(p.spolu for p in self.polozky if p.dodavka and p.kapitola.startswith("A"))
        dod_b = sum(p.spolu for p in self.polozky if p.dodavka and p.kapitola.startswith("B"))
        A = sum(k[c] for c in KAPITOLY if c.startswith("A")); B = sum(k[c] for c in KAPITOLY if c.startswith("B"))
        presun_zr, presun_a, presun_b = r2(k["ZR"] * PRESUN), r2((A - dod_a) * PRESUN), r2((B - dod_b) * PRESUN)
        mo, hsv, psv = r2(k["HUS"] + k["ZR"] + presun_zr), r2(A + presun_a), r2(B + presun_b)
        zaklad_gzs = r2(mo + hsv + psv - dod_a - dod_b)
        gzs = r2(zaklad_gzs * GZS)
        zaklad_zisk = r2(zaklad_gzs + gzs + k["C2"])
        zisk = r2(zaklad_zisk * ZISK)
        bez_dph = r2(mo + hsv + psv + gzs + k["C2"] + zisk + k["C1"])
        zlava = -max(0.0, r2(k["C1"] - ZLAVA_PONECHAT))
        celkom = round((bez_dph + zlava) * (1 + DPH))
        return dict(kapitoly=k, presun_zr=presun_zr, presun_hsv=presun_a, presun_psv=presun_b, MO=mo, HSV=hsv, PSV=psv,
                    zaklad_gzs=zaklad_gzs, GZS=gzs, zaklad_zisk=zaklad_zisk, zisk=zisk, bez_dph=bez_dph,
                    dph=r2(bez_dph * DPH), zlava=zlava, dph_zlavy=r2(zlava * DPH), celkom_s_dph=celkom)

    def kontrola(self) -> List[str]:
        out = []
        if not self.polozky: out.append("Rozpočet nemá žiadne položky")
        for i, p in enumerate(self.polozky, 1):
            if p.kapitola not in KAPITOLY: out.append(f"Riadok {i}: neznáma kapitola {p.kapitola}")
            if p.mnozstvo <= 0: out.append(f"Riadok {i} ({p.popis}): nulové alebo záporné množstvo")
            if p.jcena < 0: out.append(f"Riadok {i} ({p.popis}): záporná jednotková cena")
            if p.mnozstvo > 0 and p.jcena == 0: out.append(f"Riadok {i} ({p.popis}): chýba jednotková cena")
            if not p.popis: out.append(f"Riadok {i}: chýba popis")
            if p.dodavka and not p.kapitola.startswith(("A", "B")): out.append(f"Riadok {i}: dodávka GD môže byť len v kapitolách A/B")
        if not any(p.kapitola == "C1" for p in self.polozky): out.append("Chýba C1 – projekt (zľava = C1 − 650 €)")
        return out

    def export_excel(self, cesta: str) -> str:
        import pandas as pd
        r = self.rekapitulacia()
        dnes = date.today()
        hlav = pd.DataFrame([
            ["Identifikácia zákazky", self.zakazka], ["Názov stavby", self.nazov], ["Umiestnenie stavby", self.umiestnenie],
            ["Investor stavby", self.investor], ["Spracované dňa", dnes.strftime("%d.%m.%Y")],
            ["Ponukové ceny sú platné do", (dnes + timedelta(days=30)).strftime("%d.%m.%Y")], ["", ""],
            ["Celkové náklady bez DPH", r["bez_dph"]], ["DPH 23 %", r["dph"]], ["Zľava", r["zlava"]],
            ["DPH zľavy", r["dph_zlavy"]], ["Celkové náklady na stavbu vrátane DPH", r["celkom_s_dph"]],
        ], columns=["Údaj", "Hodnota"])
        rek = [[c, KAPITOLY[c], r["kapitoly"][c]] for c in KAPITOLY if r["kapitoly"][c]]
        rek += [["", "Presun hmôt ZR 2 %", r["presun_zr"]], ["", "Minimálny odber – celkom", r["MO"]],
                ["", "Presun hmôt HSV 2 %", r["presun_hsv"]], ["", "HSV – celkom", r["HSV"]],
                ["", "Presun hmôt PSV 2 %", r["presun_psv"]], ["", "PSV – celkom", r["PSV"]],
                ["", f"GZS 3,5 % z {r['zaklad_gzs']:.2f}", r["GZS"]], ["", f"Zisk a réžia 4 % z {r['zaklad_zisk']:.2f}", r["zisk"]],
                ["", "Celkové náklady bez DPH", r["bez_dph"]]]
        pol = pd.DataFrame([{"Kapitola": p.kapitola, "Popis": p.popis, "M.j.": p.mj, "Množstvo": p.mnozstvo, "J.cena": p.jcena,
                             "Celkom": p.spolu, "Dodávka GD": "áno" if p.dodavka else "", "Poznámka": p.poznamka} for p in self.polozky])
        with pd.ExcelWriter(cesta, engine="openpyxl") as w:
            hlav.to_excel(w, sheet_name="Krycí list", index=False)
            pd.DataFrame(rek, columns=["Kód", "Kapitola", "Suma bez DPH"]).to_excel(w, sheet_name="Rekapitulácia", index=False)
            pol.to_excel(w, sheet_name="Položky", index=False)
        return cesta


def zo_suboru(cesta: str) -> RozpocetES:
    d = json.load(open(cesta, encoding="utf-8"))
    r = RozpocetES(**{k: d.get(k, "") for k in ("zakazka", "nazov", "investor", "umiestnenie")}, hus_klient=bool(d.get("hus_klient")))
    for p in d.get("polozky", []):
        r.pridaj(p["kapitola"], p["popis"], p.get("mj", "sb"), p["mnozstvo"], p["jcena"], p.get("dodavka", False), p.get("poznamka", ""))
    return r


if __name__ == "__main__":
    # použitie: python3 es_rozpocet.py rozpocet.json [vystup.xlsx]
    r = zo_suboru(sys.argv[1])
    for x in r.kontrola(): print("Na overenie:", x)
    print(json.dumps(r.rekapitulacia(), ensure_ascii=False, indent=1))
    if len(sys.argv) > 2: print("Excel:", r.export_excel(sys.argv[2]))
