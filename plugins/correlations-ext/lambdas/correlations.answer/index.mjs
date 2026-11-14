import { period, readRange, seriesFromWire, tFor, toolAnswer } from "./lib.mjs";

/**
 * The correlations tool: the kernel's daily series (series.read — only those the caller may see) for the period, then the built-in's own
 * core (lib.mjs, generated from it) says what holds — the same sentences, in the user's language.
 * @param {{ database?: string, field: string, days?: number, from?: string, to?: string, other?: string, limit?: number }} event
 */
export async function handler(event, context) {
  const t = tFor(context.language);
  const p = period({ days: event.days, from: event.from, to: event.to }, new Date().toLocaleDateString("sv-SE"));
  const { series } = await context.zeff.call("series.read", readRange(p));
  const r = toolAnswer(seriesFromWire(series), { database: event.database, field: String(event.field ?? ""), other: event.other, limit: event.limit }, p, t);
  if ("fail" in r) throw new Error(r.fail);
  return r.ok;
}
