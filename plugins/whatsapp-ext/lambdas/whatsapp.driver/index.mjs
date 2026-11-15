import "./driver.mjs";

const DAYS = 3;
const FULL_DAYS = 60;

/** The messages of the active chats (the first time: two months) — WhatsApp Web's insides changed: its chat list instead, said. */
async function read(event, context) {
  const days = event.known === true || event.known === "true" ? DAYS : FULL_DAYS;
  const launch = event.launch === true || event.launch === "true";
  let r = null;
  try {
    r = await context.mcp.call("whatsapp_messages", { days, maxLoads: days > DAYS ? 8 : 3, openIfMissing: true, launch });
  } catch (e) {
    console.warn(`WhatsApp: ${e?.message ?? e} — reading the chat list instead.`);
  }
  if (r && Array.isArray(r.messages)) return r;
  if (r?.error === "no-internals") console.warn(`WhatsApp: ${r.hint ?? "WhatsApp Web changed"}${r.missing?.length ? ` (missing: ${r.missing.join(", ")})` : ""} — reading the chat list instead.`);
  const c = await context.mcp.call("whatsapp_chats", { days, maxChats: days > DAYS ? 300 : 100, openIfMissing: true, launch });
  if (!c || !Array.isArray(c.messages)) throw new Error(String(typeof c === "string" ? c : "WhatsApp returned nothing readable.").slice(0, 300));
  return c;
}

/**
 * WhatsApp's scraper (a driver: it runs with the account's automation Chrome / the app on this computer). event.tool: read (what the sync
 * keeps: { known, launch }) — or one of the scraper's own tools with event.args (context.mcp.tools: status, selftest, messages, chats,
 * history, send …).
 */
export async function handler(event, context) {
  const tool = String(event?.tool ?? "read");
  if (tool === "read") return read(event ?? {}, context);
  return context.mcp.call(tool, event?.args ?? {});
}
