import { ALL_FEEDS, DEFAULT_PREFS, STARTER_NAMES, pickFromCatalog, termsOf, tokens } from "./lib.mjs";
import { findFeeds, hostOf } from "./_news.mjs";

/**
 * Finding feeds by itself, three ways: daily (once a day, for two of the things you care about, different ones each day), when fresh news run low (fewer than a third of
 * what is kept unseen: a search goes out for three things you care about, at most every two hours and at most 12 feeds a day) and — the fast way to volume — more sources
 * from the catalog, when the ones there are don't give enough (every half hour at most). "Things you care about": your interests, the words of what you liked, what Zeff
 * knows about you. The best feeds the finder checks are added (category "Discovered"); what it added is logged. Handed back as statements and preference values for the
 * flow to write (a lambda only reads). The built-in's autoDiscover, discoverWhenLow and expandWhenLow (src/plugins/news/auto-discover.ts, expand.ts). event: { force }.
 * Returns { statements, sets: [{ key, value }], added }.
 */
const DAY = 864e5;
const LOW_COOLDOWN = 2 * 3600e3;
const LOW_DAILY_CAP = 12;

export async function handler(event, context) {
  const zeff = context.zeff;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const prefs = { ...DEFAULT_PREFS, ...((await zeff.call("pref.get", { key: "news:prefs" })).value ?? {}) };
  const pref = async (key, d) => (await zeff.call("pref.get", { key })).value ?? d;
  const q = async (sql, params = [], limit = 2000) => (await zeff.call("sql.query", { sql, params, limit })).rows;
  const statements = [];
  const sets = [];
  let added = 0;
  const force = event?.force === true;

  // What to look for: interests, the words of what you liked, and what Zeff knows about you — strongest first.
  const wanted = async () => {
    const own = new Set(prefs.interests.map((i) => i.term.toLowerCase()));
    const out = prefs.interests.map((i) => ({ term: i.term, weight: i.weight }));
    for (const l of await q("select term, score from news_terms where score >= 1 order by score desc, term limit 8", [], 8)) if (!own.has(l.term)) out.push({ term: l.term, weight: Math.min(3, l.score / 2) });
    if (prefs.useProfile) {
      try {
        const facts = (await zeff.call("facts.list", { limit: 200 })).facts.map((f) => ({ subject: f.subject, text: f.text }));
        const todos = (await zeff.call("todos.open", {})).todos.map((t) => ({ ref: `T-${t.id}`, text: t.text }));
        const tickets = (await zeff.call("jira.tickets-open", { limit: 60 })).tickets;
        for (const p of termsOf({ facts, todos, tickets }).slice(0, 12)) if (!own.has(p.term.toLowerCase()) && !out.some((o) => o.term.toLowerCase() === p.term.toLowerCase())) out.push({ term: p.term, weight: p.weight * 0.8 });
      } catch {
        // no profile: the rest
      }
    }
    return out.sort((a, b) => b.weight - a.weight);
  };
  const have = new Set((await q("select url from news_sources")).map((r) => hostOf(r.url)));
  const discoveries = await pref("news:discoveries", []);
  const log = [];
  const round = async (topics, reason, perTopic) => {
    let n = 0;
    for (const topic of topics) {
      const found = await findFeeds(zeff, topic.term, { have, language: prefs.language, limit: 6 }).catch(() => []);
      for (const s of found.slice(0, perTopic)) {
        if (have.has(s.domain)) continue;
        have.add(s.domain);
        statements.push({ sql: "insert or ignore into news_sources (name, url, created_at, category, lang) values (?, ?, ?, 'Discovered', ?)", params: [s.feed.title.slice(0, 80), s.feed.url, nowIso, prefs.language === "any" ? "" : prefs.language] });
        log.push({ at: nowIso, topic: topic.term, name: s.feed.title.slice(0, 80), url: s.feed.url, why: s.why, reason });
        n++;
      }
    }
    return n;
  };

  const topics = prefs.autoDiscover ? await wanted() : [];
  const day = Math.floor(nowMs / DAY);
  // Daily.
  if (topics.length && (force || nowMs - Number(await pref("news:autodiscover-at", 0)) >= DAY * 0.9)) {
    sets.push({ key: "news:autodiscover-at", value: nowMs }); // (also when it finds nothing: tomorrow again, not at every sync)
    added += await round(Array.from({ length: Math.min(2, topics.length) }, (_, i) => topics[(day * 2 + i) % topics.length]), "daily", 2);
  }
  // Fresh news running low.
  const lowAt = prefs.funnel ? 0 : Math.min(200, Math.floor(prefs.keepLatest / 3));
  const unseen = (await q("select count(*) n from news_items i left join news_sources s on s.id = i.source_id where i.seen_at is null and i.state = 'new' and i.score > -50 and i.published_at > ? and (i.source_id is null or s.enabled = 1)" + (prefs.funnel ? " and i.gate in ('pass', 'top')" : ""), [new Date(nowMs - prefs.maxAgeDays * DAY).toISOString()], 1))[0]?.n ?? 0;
  const lowToday = [...discoveries].filter((d) => d.reason === "low" && nowMs - Date.parse(d.at) < DAY).length;
  if (topics.length && (force || (unseen < lowAt && nowMs - Number(await pref("news:lowdiscover-at", 0)) >= LOW_COOLDOWN)) && lowToday < (force ? 40 : LOW_DAILY_CAP)) {
    sets.push({ key: "news:lowdiscover-at", value: nowMs });
    const turn = Number(await pref("news:low-turn", 0));
    sets.push({ key: "news:low-turn", value: turn + 1 });
    added += await round(Array.from({ length: Math.min(3, topics.length) }, (_, i) => topics[(turn * 3 + i) % topics.length]), "low", 3);
    // The catalog first (checked feeds, at once): at most every half hour.
    if (force || nowMs - Number(await pref("news:expand-at", 0)) >= 30 * 60_000) {
      const haveUrls = new Set((await q("select url from news_sources")).map((r) => r.url));
      const liked = (await q("select term from news_terms where score >= 1 order by score desc, term limit 8", [], 8)).map((r) => r.term);
      const picks = pickFromCatalog(haveUrls, prefs, liked, 30, ALL_FEEDS);
      for (const f of picks) statements.push({ sql: "insert or ignore into news_sources (name, url, created_at, category, lang) values (?, ?, ?, ?, ?)", params: [f.name, f.url, nowIso, f.category ?? "", f.lang ?? ""] });
      if (picks.length) {
        sets.push({ key: "news:expand-at", value: nowMs });
        added += picks.length;
      }
    }
  }
  if (log.length) sets.push({ key: "news:discoveries", value: [...log, ...discoveries].slice(0, 60) });
  void STARTER_NAMES;
  void tokens;
  return { batches: [statements], sets, added };
}
