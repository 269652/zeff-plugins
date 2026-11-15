import { keepNotes, keepStatus, keepWrite, useChrome } from "./keep.mjs";

/**
 * Google Keep's scraper (a driver: it runs with the account's automation Chrome). event.tool:
 *   notes  { account, launch } -> { notes, full, pages } — read-only: Keep opened in a fresh tab, what its app loads kept, the tab closed
 *   status                     -> { chrome, open, signedIn }
 *   write  { op, … }           -> a note written in Keep's own editor (create / update / trash) — the only one that changes Keep
 */
export async function handler(event0, context) {
  useChrome(context.chrome);
  // (the shared call shape of the drivers — { tool: "keep_notes", args } — or the plain one: { tool: "notes", account, launch })
  const shared = /^keep_/.test(String(event0?.tool ?? ""));
  const event = shared ? { ...(event0.args ?? {}), tool: String(event0.tool).replace(/^keep_/, "") } : event0;
  const tool = String(event?.tool ?? "notes");
  const run = tool === "status" ? () => keepStatus() : tool === "write" ? () => keepWrite(event) : tool === "notes" ? () => keepNotes({ account: event?.account ?? 0, launch: event?.launch === true || event?.launch === "true" }) : null;
  if (!run) throw new Error(`Unknown tool "${tool}" (notes, status, write).`);
  const out = tool === "status" ? await run() : await context.chrome.withTabLock("Keep", `keep_${tool}`, run);
  return typeof out === "string" ? JSON.parse(out) : out;
}
