import { notion } from "./notion.mjs";
import { stateOf } from "./store.mjs";

/**
 * Asked every few seconds by Zeff (the flow notion.pull's watch trigger): has anything changed in Notion since the last sync? One small
 * request — the newest edit Notion has. The flow runs only when this says so: something newer than what was read, an edit of the last
 * minute and a half (Notion keeps edit times to the minute), a run that had more left, or the check for pages moved to Notion's trash.
 * @param {{ since?: string }} event
 * @param {LambdaContext} context
 */
export async function handler(event, context) {
  const token = context.secrets.NOTION_TOKEN ?? "";
  // (No token yet: nothing to ask — quietly, it is asked again in a few seconds.)
  if (!token) return { changed: false };
  const st = await stateOf(context.zeff);
  if (st.more === "1") return { changed: true, token: event.since ?? null };
  if (Date.now() - Date.parse(st.checked_at || 0) > 10 * 60_000) return { changed: true, token: event.since ?? null };
  const api = notion(token, { remainingMs: () => context.remainingMs(), reserve: 1500 });
  const d = await api.req("POST", "/search", { sort: { direction: "descending", timestamp: "last_edited_time" }, page_size: 1 });
  const newest = d.results?.[0]?.last_edited_time ?? "";
  const recent = !!newest && Date.now() - Date.parse(newest) < 90_000;
  return { changed: !!newest && (!st.cursor || newest > st.cursor || recent), token: newest };
}
