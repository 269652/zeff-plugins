/** What the entry's "add a source" search shows (the context dialog reads it as data.src.*): the kernel's `time.source-search`. event: { q }. */
export async function handler(event, context) {
  return await context.zeff.call("time.source-search", { q: String(event?.q ?? "") });
}
