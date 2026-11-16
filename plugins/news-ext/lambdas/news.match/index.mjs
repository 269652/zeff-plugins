import { DEFAULT_PREFS, matchTaste } from "./lib.mjs";

/**
 * Everything unread that is kept matched against the description of your taste: the closest become the Discover view (news_similar with like_of −1). The built-in's
 * match step of the Discover job (src/plugins/news/discover-job.ts, taste.ts matchTaste). Handed back as statements for the flow to write. Returns { batches, matched }.
 */
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));
const tagsOf = (raw) => {
  try {
    const t = JSON.parse(raw ?? "[]");
    return Array.isArray(t) ? t.filter((x) => typeof x === "string").slice(0, 4) : [];
  } catch {
    return [];
  }
};

export async function handler(event, context) {
  const zeff = context.zeff;
  const nowIso = new Date().toISOString();
  const prefs = { ...DEFAULT_PREFS, ...((await zeff.call("pref.get", { key: "news:prefs" })).value ?? {}) };
  const taste = { text: "", likes: [], avoids: [], ...((await zeff.call("pref.get", { key: "news:taste" })).value ?? {}) };
  const days = Math.max(prefs.keepDays, prefs.maxAgeDays, 7);
  const limit = Math.min(20000, Number(event?.limit) || 20000);
  const items = [];
  for (let offset = 0; items.length < limit; offset += 2000) {
    const page = (
      await zeff.call("sql.query", {
        sql: "select i.id, i.title, i.summary, i.tags from news_items i left join news_sources s on s.id = i.source_id where i.seen_at is null and i.state = 'new' and i.score > -50 and i.published_at > ? and (i.source_id is null or s.enabled = 1) order by i.published_at desc, i.id limit 2000 offset ?",
        params: [new Date(Date.now() - days * 864e5).toISOString(), offset],
        limit: 2000,
      })
    ).rows;
    items.push(...page.map((r) => ({ id: r.id, title: r.title, summary: r.summary, terms: tagsOf(r.tags) })));
    if (page.length < 2000) break;
  }
  const scored = matchTaste(taste, items);
  // Everything with something in common with the taste, the closest first (a long description is only ever a little "close" to a short headline, so the floor is a fraction of the best).
  const top = scored[0]?.score ?? 0;
  const floor = Math.max(0.005, top * 0.06);
  const keep = scored.filter((x, i) => x.score > 0 && (x.score >= floor || i < 200)).slice(0, 8000);
  const statements = [{ sql: "delete from news_similar where like_of = -1", params: [] }, ...keep.map((s) => ({ sql: "insert or replace into news_similar (item_id, like_of, score, why, at) values (?, -1, ?, '', ?)", params: [s.id, Math.max(0.001, s.score), nowIso] }))];
  return { batches: chunks(statements, 400), matched: keep.length };
}
