import { DEFAULT_PREFS, scoreItem, termsOf, tokens } from "./lib.mjs";

/**
 * Everything recent scored again for you — after a sync, or when your interests, votes or sources changed: each item's score and the reasons why, worked out with the
 * built-in's own scoring (what you like and dislike, your interests and mutes, what your open todos and Zeff's profile of you are about, the sources you trust),
 * handed back as update statements for the flow to write (a lambda only reads). The built-in's rescoreAll (src/plugins/news/sync.ts, store.ts).
 * Returns { batches: [[{ sql, params }]], scored }.
 */
const BATCH = 400;
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));

export async function handler(event, context) {
  const zeff = context.zeff;
  const nowMs = Date.now();
  const prefs = { ...DEFAULT_PREFS, ...((await zeff.call("pref.get", { key: "news:prefs" })).value ?? {}) };
  const todos = prefs.useWork || prefs.useProfile ? (await zeff.call("todos.open", {})).todos : [];
  let work = [];
  if (prefs.useWork) {
    const count = new Map();
    for (const t of todos) for (const w of tokens(t.text)) if (w.length >= 5) count.set(w, (count.get(w) ?? 0) + 1);
    work = [...count].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([w]) => w);
  }
  let profile = [];
  if (prefs.useProfile) {
    const facts = (await zeff.call("facts.list", { limit: 200 })).facts.map((f) => ({ subject: f.subject, text: f.text }));
    const tickets = (await zeff.call("jira.tickets-open", { limit: 60 })).tickets;
    profile = termsOf({ facts, todos: todos.map((t) => ({ ref: `T-${t.id}`, text: t.text })), tickets });
  }
  const learned = new Map((await zeff.call("sql.query", { sql: "select term, score from news_terms", limit: 2000 })).rows.map((r) => [r.term, r.score]));
  const bySource = new Map((await zeff.call("sql.query", { sql: "select id, weight, votes from news_sources", limit: 2000 })).rows.map((s) => [s.id, s]));
  const rows = [];
  for (let offset = 0; ; offset += 2000) {
    const page = (await zeff.call("sql.query", { sql: "select id, source_id, title, summary, published_at from news_items where published_at > ? order by id limit 2000 offset ?", params: [new Date(nowMs - 40 * 864e5).toISOString(), offset], limit: 2000 })).rows;
    rows.push(...page);
    if (page.length < 2000) break;
  }
  const statements = rows.map((r) => {
    const s = r.source_id ? bySource.get(r.source_id) : undefined;
    const sc = scoreItem({ title: r.title, summary: r.summary, publishedAt: r.published_at }, { prefs, work, profile, sourceWeight: s?.weight ?? 1, sourceVotes: s?.votes ?? 0, learned, now: nowMs });
    return { sql: "update news_items set score = ?, reasons = ? where id = ?", params: [sc.score, JSON.stringify(sc.reasons), r.id] };
  });
  return { batches: chunks(statements, BATCH), scored: rows.length };
}
