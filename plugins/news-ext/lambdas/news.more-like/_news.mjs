import { AGGREGATORS, OUTLET_INSTRUCTIONS, OUTLET_SCHEMA, decodeBody, discoverFeeds, isPublicUrl, normalizeUrl, parseFeed, publishersOf, titleKey, tokens, topicFeedUrl } from "./lib.mjs";

/**
 * What the Discover lambdas share: fetching a page, searching the web for news (Google News and Bing News as RSS), the feed finder (publishers a search names, an AI's
 * outlets, their feeds), keeping new items against what is kept (what `news.round` does with a fetched feed) and the lines about the person the AI steps go on.
 * The built-in's defaultSearch, findFeeds and addItems (src/plugins/news/similar.ts, finder.ts, store.ts).
 */
const UA = "Mozilla/5.0 (compatible; Zeff/1.0)";
const CHUNK = 400;
const marks = (n) => Array.from({ length: n }, () => "?").join(",");
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));

/** A page as text, public addresses only. */
export const get = async (url) => {
  if (!isPublicUrl(url)) throw new Error("Not a public web address.");
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html, application/rss+xml, application/atom+xml, application/xml, */*" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (res.url && !isPublicUrl(res.url)) throw new Error("Redirected to a non-public address.");
  return { text: await decodeBody(res, 2_000_000), url: res.url || url };
};

/** Google News and Bing News as feeds for a query. */
export async function searchWeb(query, langs, maxAgeDays) {
  const urls = langs.flatMap((l) => [topicFeedUrl(query, l, Math.max(3, maxAgeDays)), `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&mkt=${l === "en" ? "en-US" : "de-DE"}`]);
  const out = [];
  await Promise.all(
    urls.map(async (u) => {
      try {
        const res = await fetch(u, { headers: { "user-agent": UA } });
        if (res.ok) out.push(...parseFeed(await decodeBody(res)).slice(0, 25));
      } catch {
        // that search didn't answer
      }
    }),
  );
  return out;
}

const pool = async (list, n, fn) => {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) await fn(list[i++]); }));
};

/** Feeds worth reading for a topic: who writes about it, who an AI would suggest, their feeds — each fetched and parsed. */
export async function findFeeds(zeff, topic, deps) {
  const q = String(topic).trim();
  if (q.length < 2) return [];
  const have = deps.have ?? new Set();
  const language = deps.language ?? "de";
  const candidates = new Map();
  const langs = language === "any" ? ["de", "en"] : [language];
  for (const lang of langs) {
    try {
      const xml = (await get(topicFeedUrl(q, lang, 30))).text;
      for (const p of publishersOf(xml)) if (!candidates.has(p.host)) candidates.set(p.host, { host: p.host, name: p.name, via: "news", why: "", weight: p.count });
    } catch {
      // that search didn't answer
    }
  }
  try {
    const text = (await zeff.call("prompts.fill", { key: "news-outlets", template: OUTLET_INSTRUCTIONS, vars: { topic: q } })).text;
    const profile = deps.profile ?? [];
    const prompt = [text, `Was über die Person bekannt ist: ${profile.length ? profile.slice(0, 25).join(", ") : "(nichts)"}`, `Diese Quellen hat sie schon: ${[...have].length ? [...have].slice(0, 40).join(", ") : "(keine)"}`].join("\n");
    const answer = await zeff.call("ai.json", { prompt, schema: OUTLET_SCHEMA, task: "news-ext.feeds", budget: 0.2 });
    for (const o of answer.outlets ?? []) {
      const host = String(o.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
      if (!host || !host.includes(".") || !isPublicUrl(`https://${host}`) || AGGREGATORS.test(host)) continue;
      const cur = candidates.get(host);
      candidates.set(host, { host, name: o.name?.trim() || cur?.name || host, via: "ai", why: String(o.why ?? "").slice(0, 200), weight: (cur?.weight ?? 0) + 3 });
    }
  } catch {
    // no AI: the news route alone
  }
  const hosts = [...candidates.values()].filter((c) => !have.has(c.host)).sort((a, b) => b.weight - a.weight).slice(0, deps.publishers ?? 14);
  const out = [];
  await pool(hosts, 4, async (c) => {
    const feeds = await discoverFeeds(`https://${c.host}`, { get });
    const best = feeds.find((f) => f.items >= 3 && Date.now() - Date.parse(f.newest) < 90 * 864e5);
    if (best) out.push({ feed: best, topic: q, domain: c.host, via: c.via, why: c.why || `Schreibt über „${q}“ (${c.name})` });
  });
  const rank = (s) => (s.via === "ai" ? 1000 : 0) + s.feed.items + Math.max(0, 30 - (Date.now() - Date.parse(s.feed.newest)) / 864e5);
  return out.sort((a, b) => rank(b) - rank(a)).slice(0, deps.limit ?? 20);
}

/** The hosts of the sources you have (they aren't suggested again). */
export const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** New items kept against what is there: a link or headline already there is skipped, one cleared away before is not brought back. Statements. */
export async function keepItems(zeff, groups, nowIso) {
  const all = groups.flatMap((g) => g.items.map((it) => ({ job: g.job, it, key: normalizeUrl(it.url), tkey: titleKey(it.title) })));
  const known = new Set();
  const stories = new Map();
  const goneUrl = new Set();
  const goneTitle = new Set();
  const q = async (sql, params) => (await zeff.call("sql.query", { sql, params, limit: 2000 })).rows;
  for (const part of chunks([...new Set(all.map((x) => x.key))], CHUNK)) {
    for (const r of await q(`select url_key from news_items where url_key in (${marks(part.length)})`, part)) known.add(r.url_key);
    for (const r of await q(`select url_key from news_gone where url_key in (${marks(part.length)})`, part)) goneUrl.add(r.url_key);
  }
  for (const part of chunks([...new Set(all.map((x) => x.tkey).filter((k) => k.length > 12))], CHUNK)) {
    for (const r of await q(`select title_key, published_at from news_items where title_key in (${marks(part.length)})`, part)) stories.set(r.title_key, [...(stories.get(r.title_key) ?? []), r.published_at]);
    for (const r of await q(`select title_key from news_gone where title_key in (${marks(part.length)})`, part)) goneTitle.add(r.title_key);
  }
  const statements = [];
  let added = 0;
  for (const { job, it, key, tkey } of all) {
    if (known.has(key)) continue;
    const sinceStory = new Date(Date.parse(it.publishedAt) - 3 * 864e5).toISOString();
    if (tkey.length > 12 && (stories.get(tkey) ?? []).some((p) => p > sinceStory)) continue;
    if (goneUrl.has(key) || (tkey.length > 12 && goneTitle.has(tkey))) continue;
    known.add(key);
    if (tkey.length > 12) stories.set(tkey, [...(stories.get(tkey) ?? []), it.publishedAt]);
    statements.push({ sql: "insert or ignore into news_items (source_id, source_name, guid, url, url_key, title, title_key, summary, published_at, fetched_at, image, content) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [job.id ?? null, job.name, it.guid, it.url, key, it.title, tkey, it.summary, it.publishedAt, nowIso, it.image ?? "", it.content ?? ""] });
    added++;
  }
  return { statements, added };
}

/** Lines about the person the AI steps go on (interests, what they liked, facts, who is close, what they work on). */
export async function profileLines(zeff, prefs, articleText = "") {
  const lines = [];
  if (prefs.interests.length) lines.push(`Interessen: ${prefs.interests.map((i) => (i.weight > 1 ? `${i.term} (wichtig)` : i.term)).join(", ")}`);
  const liked = (await zeff.call("sql.query", { sql: "select term from news_terms where score >= 1 order by score desc, term limit 10", limit: 10 })).rows.map((r) => r.term);
  if (liked.length) lines.push(`Wofür sie 👍 gegeben hat: ${liked.join(", ")}`);
  if (prefs.mutes.length) lines.push(`Nicht interessiert an: ${prefs.mutes.join(", ")}`);
  const facts = (await zeff.call("facts.list", { limit: 30 })).facts.slice(0, 12).map((f) => `${f.subject}: ${f.text}`.slice(0, 120));
  if (facts.length) lines.push(`Fakten über sie: ${facts.join(" | ")}`);
  const known = await zeff.call("people.known-in", { text: articleText });
  for (const p of known.named) lines.push(`Eine Person, die sie kennt und die im Artikel vorkommt: ${p.name}${p.note ? ` (${p.note})` : ""}${p.connection ? ` — ${p.connection}` : ""}`);
  if (known.close.length) lines.push(`Ihr wichtige Personen: ${known.close.join(", ")}`);
  const count = new Map();
  for (const t of (await zeff.call("todos.open", {})).todos) for (const w of tokens(t.text)) if (w.length >= 5) count.set(w, (count.get(w) ?? 0) + 1);
  const work = [...count].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
  if (work.length) lines.push(`Woran sie gerade arbeitet (aus offenen Todos): ${work.join(", ")}`);
  return lines;
}
