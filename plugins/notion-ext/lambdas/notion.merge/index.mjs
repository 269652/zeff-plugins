import { docFromFlat, flatOfDoc, merge3, unitsOfFlat } from "./convert.mjs";

/**
 * A Zeff page's text and Notion's new version of it, merged against how it was at the last sync: what Notion changed comes in, what
 * only Zeff has (a widget, a code cell, a mention of a todo — Notion never had them) stays where it is. Pure: no Notion, no Zeff.
 * @param {{ current: object, base: { key: string, n: number }[], theirs: { key: string, n: number, flat: object[] }[] }} event
 * @returns {{ doc: object, base: { key: string, n: number }[], same: boolean }}
 */
export async function handler(event) {
  const base = Array.isArray(event.base) ? event.base : [];
  const theirs = (Array.isArray(event.theirs) ? event.theirs : []).filter((u) => u && u.n > 0 && Array.isArray(u.flat));
  const flat = flatOfDoc(event.current ?? { content: [] });
  const mine = unitsOfFlat(flat, [...base, ...theirs.map((u) => ({ key: u.key, n: u.n }))]);
  const merged = merge3(base, mine, theirs);
  const same = merged.length === mine.length && merged.every((u, i) => u.key === mine[i].key);
  return { doc: same ? event.current : docFromFlat(merged.flatMap((u) => u.flat)), base: merged.map((u) => ({ key: u.key, n: u.n })), same };
}
