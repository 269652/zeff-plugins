/** What an entry's context dialog shows (the report reads it as data.ctx.*): the kernel's `time.entry-detail` — its context items and what its todos bring. event: { id }. */
export async function handler(event, context) {
  if (!event?.id) return { found: false };
  return await context.zeff.call("time.entry-detail", { id: Number(event.id) });
}
