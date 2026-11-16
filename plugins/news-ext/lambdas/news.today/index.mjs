import { DEFAULT_PREFS, diversify } from "./lib.mjs";

/**
 * The news of the Today page: how many since yesterday, and the best few not seen yet (with the funnel: what the agent let through) — the built-in's heute-today
 * `news` (countNewSince and listItems). The kernel reads this lambda's last answer. event: { since }. Returns { count, top: [{ id, title, url, source }] }.
 */
export async function handler(event, context) {
  const zeff = context.zeff;
  const since = String(event?.since ?? new Date(Date.now() - 864e5).toISOString());
  const prefs = { ...DEFAULT_PREFS, ...((await zeff.call("pref.get", { key: "news:prefs" })).value ?? {}) };
  const q = async (sql, params = [], limit = 20) => (await zeff.call("sql.query", { sql, params, limit })).rows;
  const count =
    (
      await q(
        prefs.funnel
          ? "select count(*) n from news_items i where i.gate in ('pass', 'top') and i.gate_at > ? and i.state = 'new' and i.seen_at is null"
          : "select count(*) n from news_items i left join news_sources s on s.id = i.source_id where i.fetched_at > ? and i.state = 'new' and i.score > -50 and (i.source_id is null or s.enabled = 1)",
        [since],
        1,
      )
    )[0]?.n ?? 0;
  const day = new Date(Date.now() - Math.min(1, Number(prefs.maxAgeDays) > 0 ? Number(prefs.maxAgeDays) : 1) * 864e5).toISOString();
  const rows = await q(
    `select i.id, i.title, i.url, i.source_name, i.score, i.gate, coalesce(s.category, '') as category, i.seen_at is not null as seen from news_items i left join news_sources s on s.id = i.source_id where i.state != 'hidden' and i.score > -50 and i.published_at > ? and (i.source_id is null or s.enabled = 1)${prefs.funnel ? " and i.gate in ('pass', 'top')" : ""} order by i.seen_at is not null, ${prefs.funnel ? "i.gate = 'top' desc, " : ""}i.score desc, i.published_at desc, i.id desc limit 600`,
    [day],
    600,
  ).then((r) => r.map((x) => ({ ...x, sourceName: x.source_name, seen: !!x.seen })));
  // (For you is mixed, as the page does: the agent's important ones first, then the rest without runs of one source)
  const unseen = rows.filter((r) => !r.seen);
  const list = prefs.diversity ? [...unseen.filter((r) => r.gate === "top"), ...diversify(unseen.filter((r) => r.gate !== "top"))] : unseen;
  return { count, top: list.slice(0, 3).map((r) => ({ id: r.id, title: r.title, url: r.url, source: r.source_name })) };
}
