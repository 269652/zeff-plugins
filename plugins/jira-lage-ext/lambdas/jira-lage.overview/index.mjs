/** What the Board briefing page shows: your enabled Jira boards with their open tickets, and how many tickets the next run would read — with you, and all of them. */
import { relevantKeysOf } from "./lib.mjs";

export async function handler(event, context) {
  const zeff = context.zeff;
  const q = async (sql, params = [], limit = 2000) => (await zeff.call("sql.query", { sql, params, limit })).rows;
  const boards = await q('select b.id as id, b.name as name, b.project_key as project, b.type as type, b.synced_at as synced, (select count(*) from jira_tickets t where t.board_id = b.id and t.resolved_at is null) as open from jira_boards b where b.enabled = 1 order by b.name', [], 200);
  const open = await q('select "key", summary, status, assignee, updated_at, status_category from jira_tickets where board_id in (select id from jira_boards where enabled = 1) and resolved_at is null and status_category != ? order by updated_at desc', ["done"]);
  const tickets = open.map((r) => ({ key: String(r.key), updatedAt: r.updated_at ?? null, category: r.status_category ?? null }));
  const info = new Map(open.map((r) => [String(r.key).toUpperCase(), { key: String(r.key), summary: r.summary ?? "", status: r.status ?? "", assignee: r.assignee ?? "" }]));
  const analyzed = (await zeff.call("runs.analyzed-tickets", {})).keys ?? [];
  const followed = (await zeff.call("todos.followed", {})).keys ?? [];
  const mine = (await q('select "key" from jira_tickets where mine = 1', [], 2000)).map((r) => String(r.key));
  const now = Date.now();
  const withMe = relevantKeysOf({ tickets, analyzed, involved: [...followed, ...mine], now });
  const every = relevantKeysOf({ tickets, analyzed, involved: null, now });
  const list = (keys) => keys.slice(0, 15).map((k) => info.get(k.toUpperCase()) ?? { key: k, summary: "", status: "", assignee: "" });
  return {
    boards: boards.map((b) => ({ id: b.id, name: b.name ?? "", project: b.project ?? "", type: b.type ?? "", open: b.open ?? 0, synced: b.synced ?? "" })),
    withMe: { count: withMe.length, tickets: list(withMe) },
    all: { count: every.length },
  };
}
