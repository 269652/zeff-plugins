/**
 * What the report's month view shows (the plugin's view reads it as data.m.*): the kernel's `time.month` — the monthly report's figures and words,
 * worked out from the bookings, the schedule and the report rules, the built-in's own functions — with what the drawing needs on top: the reporter
 * choices and the width of the job table. event: { month, by }.
 */
export async function handler(event, context) {
  const m = await context.zeff.call("time.month", { month: String(event?.month ?? ""), by: String(event?.by ?? "") });
  return {
    ...m,
    reporterOptions: [["", m.everyone], ...m.reporters.map((r) => [r, r])],
    jobCols: m.weekHeads.length + 3,
  };
}
