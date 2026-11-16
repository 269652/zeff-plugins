/**
 * How many items came in since an open page loaded ("↑ 5 new — show"): with the funnel what the agent let through since, else what was fetched since — the built-in's
 * countNewSince (src/plugins/news/store.ts). event: { since } (an ISO time). Returns { count }.
 */
export async function handler(event, context) {
  const zeff = context.zeff;
  const since = String(event?.since ?? "");
  if (!Number.isFinite(Date.parse(since))) return { count: 0 };
  const prefs = (await zeff.call("pref.get", { key: "news:prefs" })).value ?? {};
  const sql = prefs.funnel
    ? "select count(*) n from news_items i where i.gate in ('pass', 'top') and i.gate_at > ? and i.state = 'new' and i.seen_at is null"
    : "select count(*) n from news_items i left join news_sources s on s.id = i.source_id where i.fetched_at > ? and i.state = 'new' and i.score > -50 and (i.source_id is null or s.enabled = 1)";
  return { count: (await zeff.call("sql.query", { sql, params: [since], limit: 1 })).rows[0]?.n ?? 0 };
}
