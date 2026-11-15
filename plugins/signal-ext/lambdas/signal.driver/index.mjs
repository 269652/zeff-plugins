import "./driver.mjs";

const DAYS = 3;
const FULL_DAYS = 60;

/** The messages of the active chats (the first time: two months); Signal Desktop started (in the tray, with its port) when it isn't running. */
async function read(event, context) {
  const days = event.known === true || event.known === "true" ? DAYS : FULL_DAYS;
  const r = await context.mcp.call("signal_messages", { days, maxLoads: days > DAYS ? 8 : 3, launch: true });
  if (!r || !Array.isArray(r.messages)) throw new Error(String(typeof r === "string" ? r : "Signal returned nothing readable.").slice(0, 300));
  return r;
}

/**
 * Signal's scraper (a driver: it runs with the account's automation Chrome / the app on this computer). event.tool: read (what the sync
 * keeps: { known, launch }) — or one of the scraper's own tools with event.args (context.mcp.tools: status, selftest, messages, chats,
 * history, send …).
 */
export async function handler(event, context) {
  const tool = String(event?.tool ?? "read");
  if (tool === "read") return read(event ?? {}, context);
  return context.mcp.call(tool, event?.args ?? {});
}
