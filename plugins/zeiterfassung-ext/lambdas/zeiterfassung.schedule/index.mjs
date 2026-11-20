/** What the Settings tab shows (the plugin's view reads it as data.s.*): the kernel's `time.schedule` — the weekly hours, the default break, the flex-time job and the absences, with their words. */
export async function handler(_event, context) {
  const s = await context.zeff.call("time.schedule", {});
  return { ...s, ...Object.fromEntries(s.days.map((d) => [`h_${d.key}`, d.hours])) };
}
