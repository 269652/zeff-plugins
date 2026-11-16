import { DEFAULT_PREFS, PLAN_INSTRUCTIONS, PLAN_SCHEMA } from "./lib.mjs";
import { findFeeds, hostOf, keepItems, searchWeb } from "./_news.mjs";

/**
 * Discover, from the written description of your taste: the AI plans searches from it (varied, with a few neighbouring topics, none you had last time), the internet
 * is searched (Google News, Bing News) and the answers kept as items, the feed finder looks for new sources around the best searches and the best few are added.
 * Handed back as statements for the flow to write (a lambda only reads); the flow then matches everything unread against the description (`news.match`). The built-in's
 * Discover job (src/plugins/news/discover-job.ts, steps 2 to 4). Returns { batches, sets, web, sourcesAdded, ok, message }.
 */
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));
const clean = (q) => String(q).trim();

export async function handler(event, context) {
  const zeff = context.zeff;
  const nowIso = new Date().toISOString();
  const prefs = { ...DEFAULT_PREFS, ...((await zeff.call("pref.get", { key: "news:prefs" })).value ?? {}) };
  const taste = { text: "", likes: [], avoids: [], queries: [], ...((await zeff.call("pref.get", { key: "news:taste" })).value ?? {}) };
  const interests = prefs.interests.map((i) => i.term);
  if (!(taste.text || taste.likes.length || interests.length)) return { batches: [], sets: [], web: 0, sourcesAdded: 0, ok: false, message: "Like or save a few articles first (or name interests in the settings) — Discover works from what you like." };

  // The searches.
  const recent = (await zeff.call("pref.get", { key: "news:discover-queries" })).value ?? [];
  let queries = [];
  try {
    const text = (await zeff.call("prompts.fill", { key: "news-plan", template: PLAN_INSTRUCTIONS, vars: {} })).text;
    const prompt = [text, "", `Beschreibung: ${taste.text || "(noch keine)"}`, `Mag: ${taste.likes.join(", ") || "-"}; ausdrückliche Interessen: ${interests.join(", ") || "-"}`, `Meidet: ${taste.avoids.join(", ") || "-"}`, `Letzte Suchen (nicht wiederholen): ${recent.join(" | ") || "-"}`].join("\n");
    queries = ((await zeff.call("ai.json", { prompt, schema: PLAN_SCHEMA, task: "news-ext.discover", budget: 0.2 })).queries ?? []).map(clean).filter((q) => q.length >= 3 && q.length <= 80);
  } catch {
    queries = [];
  }
  if (!queries.length) queries = [...new Set([...taste.queries, ...taste.likes.slice(0, 5), ...interests])].filter((q) => !recent.includes(q)).slice(0, 12);
  queries = [...new Set(queries)].slice(0, 12);

  // The web: every search, the answers kept as items.
  const langs = [...new Set(["en", prefs.language === "any" ? "de" : prefs.language])];
  const cutoff = Date.now() - prefs.maxAgeDays * 3 * 864e5;
  const groups = [];
  await Promise.all(
    queries.map(async (q) => {
      const items = (await searchWeb(q, langs, prefs.maxAgeDays)).filter((it) => Date.parse(it.publishedAt) >= cutoff);
      groups.push({ job: { id: null, name: `Discover: ${q}` }, items });
    }),
  );
  const kept = await keepItems(zeff, groups, nowIso);

  // New sources around the best searches (the feed finder), the best few of each added.
  const sourceStatements = [];
  const have = new Set((await zeff.call("sql.query", { sql: "select url from news_sources", limit: 2000 })).rows.map((r) => hostOf(r.url)));
  let sourcesAdded = 0;
  try {
    for (const q of queries.slice(0, 6)) {
      const found = await findFeeds(zeff, q, { have, profile: taste.likes.slice(0, 6), language: prefs.language, limit: 4 }).catch(() => []);
      for (const s of found.slice(0, 3)) {
        if (have.has(s.domain)) continue;
        have.add(s.domain);
        sourceStatements.push({ sql: "insert or ignore into news_sources (name, url, created_at, category, lang) values (?, ?, ?, 'Discovered', ?)", params: [s.feed.title.slice(0, 80), s.feed.url, nowIso, prefs.language === "any" ? "" : prefs.language] });
        sourcesAdded++;
      }
    }
  } catch {
    // finding sources is a bonus
  }
  return {
    batches: chunks([...kept.statements, ...sourceStatements], 400),
    sets: [{ key: "news:discover-queries", value: [...queries, ...recent].slice(0, 30) }],
    web: kept.added,
    sourcesAdded,
    ok: true,
    message: `${kept.added ? `${kept.added} found on the web` : "nothing new on the web"}${sourcesAdded ? `, ${sourcesAdded} new sources` : ""}`,
  };
}
