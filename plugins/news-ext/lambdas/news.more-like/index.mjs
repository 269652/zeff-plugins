import { DEFAULT_PREFS, SIMILAR_INSTRUCTIONS, SIMILAR_SCHEMA, analyze, cosine, decodeBody, fetchArticle, NEWS_BROWSER_UA } from "./lib.mjs";
import { findFeeds, get, hostOf, keepItems, profileLines, searchWeb } from "./_news.mjs";

/**
 * "More like this": the article is read, set next to what you like and what Zeff knows about you, and the AI says why it matters to you and which searches would find
 * more of it. Those searches go out to the internet (Google News and Bing News), the answers are ranked by how close they are to the article and to you (TF-IDF
 * closeness, the words the AI expects, the words that say "not it", what you like), the best become the cards that open below the card, and the feed finder looks for new
 * sources around the topic. Without an AI the article's own key terms are searched. Two steps, because the items must be kept before they can be tied to the card:
 * mode "search" hands back the items and sources to write and the ranking; mode "write" (the ids found) hands back the statements that tie them to the card.
 * The built-in's moreLikeThis (src/plugins/news/similar.ts). event: { mode, id, top, title }.
 */
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));
const lower = (s) => String(s).toLowerCase();

export async function handler(event, context) {
  const zeff = context.zeff;
  const nowIso = new Date().toISOString();
  const itemId = Number(event?.id);
  if (event?.mode === "write") {
    const top = Array.isArray(event?.top) ? event.top : [];
    const { normalizeUrl } = await import("./lib.mjs");
    const keys = top.map((t) => normalizeUrl(t.url));
    const rows = keys.length ? (await zeff.call("sql.query", { sql: `select id, url_key from news_items where url_key in (${keys.map(() => "?").join(",")})`, params: keys, limit: 2000 })).rows : [];
    const byKey = new Map(rows.map((r) => [r.url_key, r.id]));
    const entries = top.flatMap((t) => (byKey.get(normalizeUrl(t.url)) ? [{ id: byKey.get(normalizeUrl(t.url)), score: Math.max(0.001, t.s), why: t.q === "kept" ? "" : t.q }] : []));
    const statements = [
      { sql: "delete from news_similar where like_of = ?", params: [itemId] },
      ...entries.map((e) => ({ sql: "insert or replace into news_similar (item_id, like_of, score, why, at) values (?, ?, ?, ?, ?)", params: [e.id, itemId, e.score, e.why, nowIso] })),
      ...entries.map((e) => ({ sql: "update news_items set reasons = ? where id = ? and reasons = '[]'", params: [JSON.stringify([`like: ${String(event?.title ?? "").slice(0, 40)}`]), e.id] })),
    ];
    return { batches: chunks(statements, 400), found: entries.length };
  }

  const prefs = { ...DEFAULT_PREFS, ...((await zeff.call("pref.get", { key: "news:prefs" })).value ?? {}) };
  const own = (await zeff.call("sql.query", { sql: "select id, title, summary, url, content from news_items where id = ?", params: [itemId], limit: 1 })).rows[0];
  if (!own) return { ok: false, error: "That item isn't there any more.", batches: [] };
  // The article as text: the kept text, else the page read now, else the summary.
  let text = own.content && own.content.length > 1 ? own.content : "";
  if (text.length < 2) {
    try {
      text = (await fetchArticle(own.url, { fetchText: async (url, init = {}) => { const r = await fetch(url, { method: init.method ?? "GET", body: init.body, headers: { "user-agent": NEWS_BROWSER_UA, "accept-language": "de,en;q=0.8", ...(init.headers ?? {}) } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return { text: await decodeBody(r, 3_000_000), url: r.url || url, type: r.headers.get("content-type") ?? "" }; } })).text;
    } catch {
      text = own.summary;
    }
  }
  const article = { title: own.title, text: text.length > 1 ? text : own.summary };
  const profile = await profileLines(zeff, prefs, `${article.title} ${article.text}`);

  // 1. The AI's reading (or the article's own terms).
  let plan = {};
  let usedAi = false;
  try {
    const instr = (await zeff.call("prompts.fill", { key: "news-similar", template: SIMILAR_INSTRUCTIONS, vars: {} })).text;
    const prompt = [instr, "", `Artikel: ${article.title}`, article.text.slice(0, 2500), "", "Was über die Person bekannt ist:", ...(profile.length ? profile.map((p) => `- ${p}`) : ["- (nichts bekannt)"])].join("\n");
    plan = await zeff.call("ai.json", { prompt, schema: SIMILAR_SCHEMA, task: "news-ext.similar", budget: 0.3 });
    usedAi = !!plan.queries?.length;
  } catch {
    plan = {};
  }
  let queries = (plan.queries ?? []).flatMap((x) => (x.q && String(x.q).trim().length >= 3 ? [{ q: String(x.q).trim().slice(0, 80), why: String(x.why ?? "").slice(0, 120) }] : [])).slice(0, 5);
  if (!queries.length) {
    const a = analyze([{ id: 1, title: article.title, summary: article.text.slice(0, 400) }, { id: 2, title: "", summary: "" }]);
    const tags = (a.tags.get(1) ?? []).map((t) => t.name);
    queries = [tags.slice(0, 2).join(" "), ...tags.slice(0, 3)].filter((q, i, all) => q && all.indexOf(q) === i).slice(0, 4).map((q) => ({ q, why: "Begriff aus dem Artikel" }));
  }
  if (!queries.length) return { ok: false, error: "Nothing to search for in that article.", batches: [] };

  // 2. The internet: every search, the answers kept as items; what is already kept joins in.
  const langs = [...new Set([prefs.language === "any" ? "de" : prefs.language, "en"])];
  const found = new Map();
  await Promise.all(queries.map(async ({ q }) => { for (const it of await searchWeb(q, langs, prefs.maxAgeDays)) if (!found.has(it.url)) found.set(it.url, { item: it, q }); }));
  const nowMs = Date.now();
  const fresh = [...found.values()].filter((f) => nowMs - Date.parse(f.item.publishedAt) < prefs.maxAgeDays * 2 * 864e5 && f.item.url !== own.url);
  const kept = await keepItems(zeff, [...new Set(fresh.map((f) => f.q))].map((q) => ({ job: { id: null, name: `More like this: ${q}` }, items: fresh.filter((f) => f.q === q).map((f) => f.item) })), nowIso);

  // What is already kept and reads like the article (TF-IDF closeness over the last weeks).
  const corpus = [];
  for (let offset = 0; corpus.length < 6000; offset += 2000) {
    const page = (await zeff.call("sql.query", { sql: "select id, title, summary, url from news_items where published_at > ? and id != ? order by published_at desc, id limit 2000 offset ?", params: [new Date(nowMs - 14 * 864e5).toISOString(), itemId, offset], limit: 2000 })).rows;
    corpus.push(...page);
    if (page.length < 2000) break;
  }
  const local = [];
  if (corpus.length) {
    const a = analyze([{ id: -1, title: article.title, summary: article.text.slice(0, 700) }, ...corpus.map((c) => ({ id: c.id, title: c.title, summary: c.summary }))]);
    const target = a.vectors.get(-1) ?? new Map();
    local.push(...corpus.map((c) => ({ c, s: cosine(a.vectors.get(c.id) ?? new Map(), target) })).filter((x) => x.s >= 0.12).sort((x, y) => y.s - x.s).slice(0, 120).map((x) => x.c));
  }

  // 3. Ranking: closeness to the article, words the AI expects, words that say "not it", and what you like.
  const candidates = new Map();
  for (const f of fresh) candidates.set(f.item.url, { title: f.item.title, summary: f.item.summary, url: f.item.url, q: f.q });
  for (const l of local) if (!candidates.has(l.url)) candidates.set(l.url, { title: l.title, summary: l.summary, url: l.url, q: "kept" });
  const list = [...candidates.values()];
  const a = analyze([{ id: -1, title: article.title, summary: article.text.slice(0, 700) }, ...list.map((c, i) => ({ id: i, title: c.title, summary: c.summary }))]);
  const target = a.vectors.get(-1) ?? new Map();
  const liked = new Set((await zeff.call("sql.query", { sql: "select term from news_terms where score >= 1 order by score desc, term limit 12", limit: 12 })).rows.map((r) => lower(r.term)));
  const interests = prefs.interests.map((i) => lower(i.term));
  const ranked = list
    .map((c, i) => {
      const t = lower(`${c.title} ${c.summary}`);
      let s = cosine(a.vectors.get(i) ?? new Map(), target);
      for (const k of plan.keep ?? []) if (k.length >= 3 && t.includes(lower(k))) s += 0.06;
      for (const k of plan.avoid ?? []) if (k.length >= 3 && t.includes(lower(k))) s -= 0.12;
      for (const w of liked) if (t.includes(w)) s += 0.03;
      for (const w of interests) if (w.length >= 3 && t.includes(w)) s += 0.05;
      return { ...c, s };
    })
    .sort((x, y) => y.s - x.s);
  const best = ranked.filter((r) => r.s > 0.04).slice(0, 80);
  const top = (best.length >= 6 ? best : ranked.slice(0, 20)).map((t) => ({ url: t.url, s: t.s, q: t.q }));

  // 4. New sources around the topic (the feed finder), the best few added.
  const sourceStatements = [];
  let sourcesAdded = 0;
  try {
    const have = new Set((await zeff.call("sql.query", { sql: "select url from news_sources", limit: 2000 })).rows.map((r) => hostOf(r.url)));
    for (const s of (await findFeeds(zeff, queries[0].q, { have, profile: profile.slice(0, 6), language: prefs.language, limit: 4 })).slice(0, 3)) {
      sourceStatements.push({ sql: "insert or ignore into news_sources (name, url, created_at, category, lang) values (?, ?, ?, 'Discovered', ?)", params: [s.feed.title.slice(0, 80), s.feed.url, nowIso, prefs.language === "any" ? "" : prefs.language] });
      sourcesAdded++;
    }
  } catch {
    // finding sources is a bonus
  }
  return { ok: true, batches: chunks([...kept.statements, ...sourceStatements], 400), top, title: article.title, angle: String(plan.angle ?? "").slice(0, 400), queries, added: kept.added, sourcesAdded, usedAi };
}
