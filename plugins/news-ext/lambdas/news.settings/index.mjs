import { ALL_FEEDS, DEFAULT_PREFS, STARTER_NAMES, categoriesOf, formatInterests, parseInterests, parseMutes } from "./lib.mjs";

/**
 * What the settings page shows (the plugin's view views/settings.html reads it as data.s.*), and the change of one setting: the sources (with how many items each has, when it
 * was fetched, what went wrong), what you are interested in and what you don't want, how it personalises, your taste, the feeds found by itself, and the catalog.
 * The built-in's settings page and savePrefsFormAction (src/app/settings/news/page.tsx, server-actions.ts). event: { mode: "data" } or { key, value } — a setting changed:
 * returns { prefs } (the whole new value of the preference news:prefs, for the flow to keep) or { error }.
 */
const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
const BOOLS = ["topicSearch", "useWork", "useProfile", "diversity", "digest", "autoDiscover", "aiTags", "images", "prefetch", "funnel"];
const truthy = (v) => v === true || v === "true" || v === "on" || v === "1" || v === 1;

export async function handler(event, context) {
  const zeff = context.zeff;
  const had = { ...DEFAULT_PREFS, ...((await zeff.call("pref.get", { key: "news:prefs" })).value ?? {}) };
  if (event?.key !== undefined) {
    const key = String(event.key);
    const v = event.value;
    const next = { ...had };
    if (BOOLS.includes(key)) next[key] = truthy(v);
    else if (key === "interests") next.interests = parseInterests(String(v ?? ""));
    else if (key === "mutes") next.mutes = parseMutes(String(v ?? ""));
    else if (key === "language") next.language = v === "en" || v === "any" ? v : "de";
    else if (key === "maxAgeDays") next.maxAgeDays = clamp(Number(v), 1, 30, 7);
    else if (key === "perSource") next.perSource = clamp(Number(v), 5, 100, 25);
    else if (key === "perRun") next.perRun = clamp(Number(v), 10, 1000, 150);
    else if (key === "keepDays") next.keepDays = clamp(Number(v), 3, 365, 30);
    else if (key === "funnelBatch") next.funnelBatch = clamp(Number(v), 10, 150, 60);
    else if (key === "keepLatest") next.keepLatest = clamp(Number(v), 50, 5000, 300);
    else return { error: `Unknown setting “${key}”.` };
    return { prefs: next, switchedOnFunnel: key === "funnel" && next.funnel && !had.funnel };
  }

  // --- the page's data
  const q = async (sql, params = [], limit = 2000) => (await zeff.call("sql.query", { sql, params, limit })).rows;
  const sources = (await q("select s.id, s.name, s.url, s.enabled, s.weight, s.votes, s.last_at, s.last_error, s.category, (select count(*) from news_items i where i.source_id = s.id) as items from news_sources s order by s.name collate nocase", [], 2000)).map((s) => ({ id: s.id, name: s.name, url: s.url, enabled: !!s.enabled, weight: s.weight, votes: s.votes, lastAt: s.last_at ?? "", lastError: s.last_error ?? "", items: s.items, category: s.category || "Your own" }));
  const have = new Set(sources.map((s) => s.url));
  const taste = (await zeff.call("pref.get", { key: "news:taste" })).value ?? {};
  const discoveries = ((await zeff.call("pref.get", { key: "news:discoveries" })).value ?? []).slice(0, 12);
  const cats = categoriesOf().map((c) => ({ category: c.category, count: c.count, left: ALL_FEEDS.filter((f) => f.category === c.category && !have.has(f.url)).length }));
  const flag = (key, label, what) => ({ key, label, what, on: !!had[key], word: had[key] ? "✓" : "○" });
  return {
    prefs: { ...had, interestsText: formatInterests(had.interests), mutesText: (had.mutes ?? []).join(", ") },
    flags: [
      flag("topicSearch", "A search per interest", "One Google News search per interest besides your sources"),
      flag("useWork", "What you work on", "Boost what your open todos and tickets are about"),
      flag("useProfile", "What Zeff knows about you", "Facts, tickets and todos: a headline about a thing you love or work on comes up without being an interest"),
      flag("diversity", "Mix", "No run of one source, no near-duplicates, now and then something from outside your usual"),
      flag("digest", "AI overview", "An overview of the best items (needs an AI)"),
      flag("autoDiscover", "Find feeds by itself", "Once a day, and when fresh news run low"),
      flag("aiTags", "AI tags", "The AI tags the best headlines: better chips and threads — the headlines go to your AI"),
      flag("images", "Pictures", "Show each item's picture (loaded from their sites by your browser)"),
      flag("prefetch", "Read ahead", "After each fetch, read the whole text of the best unread items"),
      flag("funnel", "The agent's filter", "An agent reads the news first and lets only what interests you through"),
    ],
    sources,
    sourceCount: sources.length,
    categories: cats,
    starter: STARTER_NAMES.length,
    taste: { text: taste.text ?? "", pending: (taste.pending ?? []).length, edited: !!taste.edited },
    discoveries: discoveries.map((d) => ({ at: String(d.at ?? "").slice(0, 10), topic: d.topic, name: d.name, url: d.url, why: d.why })),
  };
}
