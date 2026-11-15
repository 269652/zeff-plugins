import "./driver.mjs";

/**
 * Gmail's scraper (a driver: it runs with the account's automation Chrome). event: { tool, args } — one of the scraper's own tools
 * (context.mcp.tools), answered as the scraper does.
 */
export async function handler(event, context) {
  return context.mcp.call(String(event?.tool ?? ""), event?.args ?? {});
}
