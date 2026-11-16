/**
 * The Jira tickets the Board-Lage reads fresh from Jira: the open ones of the enabled boards that moved lately (or are in progress), less those the last board
 * run just assessed; of them the ones you're in (yours, followed) — or all (event.all). The built-in's own rule (core.ts relevantKeysOf, bundled).
 * Reads the tickets from the plugin's adopted stores (the tables the Jira reader keeps) and what the kernel knows of the run and what you follow.
 */
import { relevantKeysOf } from "./lib.mjs";

export async function handler(event, context) {
  const zeff = context.zeff;
  const all = event?.all === true || event?.all === "true";
  const q = async (sql, params = [], limit = 2000) => (await zeff.call("sql.query", { sql, params, limit })).rows;
  // (the newest first: at most 150 are taken, and the built-in sorted them the same way)
  const open = await q('select "key", updated_at, status_category from jira_tickets where board_id in (select id from jira_boards where enabled = 1) and resolved_at is null and status_category != ? order by updated_at desc', ["done"]);
  if (!open.length) return { keys: [], all };
  const tickets = open.map((r) => ({ key: String(r.key), updatedAt: r.updated_at ?? null, category: r.status_category ?? null }));
  const analyzed = (await zeff.call("runs.analyzed-tickets", {})).keys ?? [];
  let involved = null;
  if (!all) {
    const followed = (await zeff.call("todos.followed", {})).keys ?? [];
    const mine = (await q('select "key" from jira_tickets where mine = 1', [], 2000)).map((r) => String(r.key));
    involved = [...followed, ...mine];
  }
  return { keys: relevantKeysOf({ tickets, analyzed, involved, now: Date.now() }), all };
}
