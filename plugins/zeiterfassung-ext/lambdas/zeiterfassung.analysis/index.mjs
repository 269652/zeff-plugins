/**
 * What the Analysis tab shows (the plugin's view reads it as data.a.*): the kernel's `time.analysis` — the analysis page's figures and words from the
 * built-in's own `getAnalysis`. event: { weeks, tickets, split }.
 */
export async function handler(event, context) {
  return await context.zeff.call("time.analysis", { weeks: String(event?.weeks ?? ""), tickets: String(event?.tickets ?? ""), split: String(event?.split ?? "") });
}
