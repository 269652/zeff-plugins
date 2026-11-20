/**
 * What the report's week view shows (the plugin's view reads it as data.w.*): the kernel's `time.week` — the weekly report's figures and words,
 * worked out from the bookings, the schedule and the report rules, the built-in's own functions — with the reporter choices on top. event: { week, by }.
 */
export async function handler(event, context) {
  const w = await context.zeff.call("time.week", { week: String(event?.week ?? ""), by: String(event?.by ?? "") });
  return { ...w, reporterOptions: [["", w.everyone], ...w.reporters.map((r) => [r, r])] };
}
