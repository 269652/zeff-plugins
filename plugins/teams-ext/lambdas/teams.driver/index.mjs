import "./driver.mjs";

const PM_DAYS = 90;
const CHAT_DAYS = 3;

/** Where you were mentioned and what colleagues wrote you (1:1), and every chat's last days — Teams opened in a tab when it isn't. */
async function read(event, context) {
  const r = await context.mcp.call("teams_messages", { pmDays: PM_DAYS, chatDays: CHAT_DAYS, openIfMissing: true, launch: event.launch === true || event.launch === "true" });
  if (!r || !Array.isArray(r.messages)) throw new Error(String(typeof r === "string" ? r : "Teams returned nothing readable.").slice(0, 300));
  return r;
}

/**
 * Teams's scraper (a driver: it runs with the account's automation Chrome / the app on this computer). event.tool: read (what the sync
 * keeps: { known, launch }) — or one of the scraper's own tools with event.args (context.mcp.tools: status, selftest, messages, chats,
 * history, send …).
 */
export async function handler(event, context) {
  const tool = String(event?.tool ?? "read");
  if (tool === "read") return read(event ?? {}, context);
  return context.mcp.call(tool, event?.args ?? {});
}
