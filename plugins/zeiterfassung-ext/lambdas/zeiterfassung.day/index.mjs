/** What the End-of-day tab shows (the plugin's view reads it as data.f.*): the kernel's `time.day` — the day or the week drafted for booking, each line with the names of the view states its edits live in. event: { date, week }. */
export async function handler(event, context) {
  return await context.zeff.call("time.day", { date: String(event?.date ?? ""), week: String(event?.week ?? ""), state: String(event?.state ?? "") });
}
