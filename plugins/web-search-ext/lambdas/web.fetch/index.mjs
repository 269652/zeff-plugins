import { DATA } from "./lib.mjs";

/**
 * The web_fetch tool: a page read as text through Zeff's `web.read` (the kernel's: http(s) only, every redirect checked, no private
 * address, PDFs read) — the same text the built-in tool gave.
 * @param {{ url: string, maxChars?: number }} event
 */
export async function handler(event, context) {
  const maxChars = Math.min(40000, Math.max(1000, Math.round(Number(event.maxChars) || 20000)));
  const page = await context.zeff.call("web.read", { url: String(event.url ?? ""), maxChars });
  return `${page.title ? `${page.title}\n` : ""}${page.url}${page.truncated ? " (cut off)" : ""}\n(${DATA})\n\n${page.text}`;
}
