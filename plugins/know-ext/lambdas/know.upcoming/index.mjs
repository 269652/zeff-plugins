/** The meetings to prepare a summary for before they start (the next three hours, at most six) — none while the summaries are switched off (the preference know.autoSummary; on until you switch it off). */
export async function handler(event, context) {
  const zeff = context.zeff;
  const on = (await zeff.call("pref.get", { key: "know.autoSummary" })).value;
  if (on === false) return { meetings: [] };
  return zeff.call("meetings.upcoming", { withinMinutes: 180, limit: 6 });
}
