import "./driver.mjs";

const DAYS = 90;

/** Merge requests, comments and branches: all after a first sync, else what changed since (a day's overlap). */
async function read(event, context) {
  const r = await context.mcp.call("gitlab_items", { baseUrl: String(event.baseUrl ?? "").replace(/\/+$/, ""), sinceIso: event.sinceIso || undefined, days: DAYS, openIfMissing: true, launch: event.launch === true || event.launch === "true" });
  if (!r || !Array.isArray(r.items)) throw new Error(String(typeof r === "string" ? r : "GitLab returned nothing readable.").slice(0, 300));
  return r;
}

/**
 * GitLab's scraper (a driver: it runs with the account's automation Chrome / the app on this computer). event.tool: read (what the sync
 * keeps: { known, launch }) — or one of the scraper's own tools with event.args (context.mcp.tools: status, selftest, messages, chats,
 * history, send …).
 */
export async function handler(event, context) {
  const tool = String(event?.tool ?? "read");
  if (tool === "read") return read(event ?? {}, context);
  return context.mcp.call(tool, event?.args ?? {});
}
