import { DATA } from "./lib.mjs";

/**
 * The web_search tool: Zeff's web.search (this plugin's service), as the AI reads it — the same text the built-in tool gave.
 * @param {{ query: string, count?: number, site?: string, language?: string }} event
 */
export async function handler(event, context) {
  const query = String(event.query ?? "");
  const { hits } = await context.zeff.call("web.search", { query, ...(event.count ? { count: event.count } : {}), ...(event.site ? { site: event.site } : {}), ...(event.language ? { language: event.language } : {}) });
  if (!hits.length) return `No results for “${query}”.`;
  return `${hits.length} results for “${query}” (${DATA})\n\n${hits.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`).join("\n\n")}`;
}
