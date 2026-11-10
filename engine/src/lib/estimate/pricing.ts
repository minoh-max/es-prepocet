import type { ElementLine, PriceIndex, PriceItem } from "./types";

export function unitCost(item: PriceItem): number {
  // pevná sadzba sa pripočítava (rozpočet: žumpa 1 379,10 + 1 041,03 + 100 = 2 520,13)
  return (item.price_material ?? 0) + (item.price_labor ?? 0) + (item.price_machinery ?? 0) + (item.fixed_rate ?? 0);
}

/** Prices one číselník line. Missing / hidden / flagged items produce a warning instead of failing. */
export function priceLine(prices: PriceIndex, pathCode: string | undefined, quantity: number): ElementLine {
  const q = Math.max(0, quantity);
  if (!pathCode) {
    return { pathCode: "", name: "—", unit: "", quantity: q, unitCost: 0, cost: 0, warning: "Položka nie je nastavená" };
  }
  const item = prices[pathCode];
  if (!item) {
    return {
      pathCode, name: pathCode, unit: "", quantity: q, unitCost: 0, cost: 0,
      warning: `Položka ${pathCode} sa v aktívnom číselníku nenašla`,
    };
  }
  const uc = unitCost(item);
  const line: ElementLine = {
    pathCode,
    name: item.name,
    unit: item.unit,
    quantity: q,
    unitCost: uc,
    cost: q * uc, // pevná sadzba je už v jednotkovej cene (rozpočet: obrubník 13,80 + 3,70 + 3 = 20,50 €/m)
  };
  if (item.is_hidden) line.warning = `Položka ${item.name} je v číselníku skrytá`;
  else if (uc === 0 && !(item.fixed_rate ?? 0)) line.warning = `Položka ${item.name} nemá v číselníku cenu`;
  else if (item.check_level === "CHYBA") line.warning = `Položka ${item.name} má v číselníku označenú chybu – overiť cenu`;
  return line;
}

/** Parses a thickness in mm from item name/specification, e.g. "hr. 300 mm", "hr. iz. 150mm", "Orsik 200". */
export function parseThicknessMm(item: Pick<PriceItem, "name" | "specification" | "path_code">): number | undefined {
  const text = `${item.name} ${item.specification ?? ""}`;
  const m = text.match(/hr\.\s*(?:iz\.\s*)?(\d{2,3})(?:[,.]\d)?\s*mm/i) ?? text.match(/hr\.\s*(\d{2,3})\s*mm/i);
  if (m) return Number(m[1]);
  const code = item.path_code.split("/").pop() ?? "";
  const c = code.match(/(\d{3})(?!\d)/);
  return c ? Number(c[1]) : undefined;
}

/** Human label of an item: specification when it names the product, otherwise the item name. */
export function itemLabel(item: Pick<PriceItem, "name" | "specification"> | undefined): string | undefined {
  if (!item) return undefined;
  const spec = (item.specification ?? "").trim();
  return spec && !/^(hr\.|v\.|\(|podľa|vr\.)/i.test(spec) && spec.length > 3 ? spec : item.name;
}
