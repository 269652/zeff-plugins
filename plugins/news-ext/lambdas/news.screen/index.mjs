import { DEFAULT_PREFS, aliasesOf, diversify, storyGroups, tFor } from "./lib.mjs";

/**
 * What News' page shows (the plugin's app view views/news.html reads it as data.news.*): the views with their counts, the categories, the funnel strip, your
 * taste, the overview with its themes and picks, and the cards of the view, source and category asked — the built-in's newsScreenAction, listItems and counts
 * (src/plugins/news/view-actions.ts, store.ts) over the plugin's stores. event: { view, source, category, limit }.
 */
const VIEWS = ["foryou", "discover", "latest", "saved", "filtered", "hidden"];
const FUNNEL_DAYS = 2;
const STEP = 24;
const PASSED = "i.gate in ('pass', 'top')";

const ago = (iso, lang) => {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const min = Math.round(ms / 60000);
  if (min < 60) return rtf.format(-Math.max(1, min), "minute");
  if (min < 1440) return rtf.format(-Math.round(min / 60), "hour");
  return rtf.format(-Math.round(min / 1440), "day");
};

export async function handler(event, context) {
  const zeff = context.zeff;
  const t = tFor(context.language);
  const lang = context.language === "de" || context.language === "es" ? context.language : "en";
  const q = async (sql, params = [], limit = 2000) => (await zeff.call("sql.query", { sql, params, limit })).rows;
  const n = async (sql, params = []) => (await q(sql, params, 1))[0]?.n ?? 0;
  const prefs = { ...DEFAULT_PREFS, ...((await zeff.call("pref.get", { key: "news:prefs" })).value ?? {}) };
  const view = VIEWS.includes(event?.view) ? event.view : "foryou";
  const sourceId = Number(event?.source) || 0;
  const likeOf = Number(event?.like) || 0;
  const category = String(event?.category ?? "");
  // A topic followed from a card's chip ("story:<label>" a story's thread): its news, whatever the view.
  const topic = String(event?.topic ?? "").trim().slice(0, 120);
  const limit = Math.max(STEP, Math.min(480, Number(event?.limit) || STEP));
  const funnelOn = !!prefs.funnel;

  // --- the counts of the views
  const since = new Date(Date.now() - prefs.maxAgeDays * 864e5).toISOString();
  const kept = await n("select count(*) n from news_items");
  const c = {
    saved: await n("select count(*) n from news_items where state = 'saved'"),
    hidden: await n("select count(*) n from news_items where state = 'hidden'"),
    discover: await n("select count(*) n from news_similar sm join news_items i on i.id = sm.item_id where sm.like_of = -1 and i.seen_at is null and i.state = 'new'"),
    unread: await n(`select count(*) n from news_items i where i.state = 'new' and i.score > -50 and i.published_at > ?${funnelOn ? ` and ${PASSED} and i.seen_at is null` : ""}`, [since]),
    filtered: await n("select count(*) n from news_items where gate = 'drop' and state != 'hidden'"),
    waiting: await n("select count(*) n from news_items where gate = '' and state = 'new' and seen_at is null and score > -50 and published_at > ?", [new Date(Date.now() - FUNNEL_DAYS * 864e5).toISOString()]),
  };
  const labels = { foryou: t("For you"), discover: `✨ ${t("Discover")}`, latest: funnelOn ? t("Everything (unfiltered)") : t("Latest"), saved: t("Saved"), filtered: t("Filtered out"), hidden: t("Hidden") };
  const count = { foryou: c.unread, discover: c.discover, latest: null, saved: c.saved, filtered: c.filtered, hidden: c.hidden };
  const views = VIEWS.filter((v) => v !== "filtered" || funnelOn || c.filtered > 0).map((v) => ({ id: v, label: labels[v], n: count[v] ?? 0, on: v === view && !sourceId && !category }));
  const sources = await q("select id, enabled, category from news_sources", [], 2000);
  const byCategory = new Map();
  for (const s of sources.filter((x) => x.enabled)) byCategory.set(s.category || "Your own", (byCategory.get(s.category || "Your own") ?? 0) + 1);
  const categories = [...byCategory].map(([name, k]) => ({ name, value: name === "Your own" ? "" : name, n: k, on: name === category }));

  // --- the cards (the built-in's listItems)
  const where = [];
  const args = [];
  const qview = topic ? "latest" : view;
  const gated = qview === "foryou" && funnelOn;
  let from = "news_items i left join news_sources s on s.id = i.source_id";
  if (likeOf) {
    from += " join news_similar sm on sm.item_id = i.id";
    where.push("sm.like_of = ?", "i.state != 'hidden'");
    args.push(likeOf);
  } else if (qview === "discover") {
    from += " join news_similar sm on sm.item_id = i.id";
    where.push("sm.like_of = -1", "i.state != 'hidden'");
  } else if (qview === "saved") where.push("i.state = 'saved'");
  else if (qview === "hidden") where.push("i.state = 'hidden'");
  else if (qview === "filtered") where.push("i.gate = 'drop'", "i.state != 'hidden'");
  else {
    where.push("i.state != 'hidden'", "i.score > -50", "i.published_at > ?", "(i.source_id is null or s.enabled = 1)");
    args.push(since);
    if (gated) where.push(PASSED);
  }
  if (topic) {
    // (the built-in's listItems: items tagged with it, or naming it — or a spelling the gazetteer knows — in the headline or summary; short spellings only through the tags)
    if (topic.startsWith("story:")) {
      where.push("i.story = ?");
      args.push(topic.slice(6));
    } else {
      const spellings = aliasesOf(topic).filter((a) => a.length >= 5);
      if (!spellings.length) spellings.push(topic.toLowerCase());
      where.push(`(i.tags like ? or ${spellings.map(() => "lower(i.title) like ? or lower(i.summary) like ?").join(" or ")})`);
      args.push(`%${JSON.stringify(topic).slice(1, -1)}%`, ...spellings.flatMap((a) => [`%${a}%`, `%${a}%`]));
    }
  }
  if (sourceId) {
    where.push("i.source_id = ?");
    args.push(sourceId);
  }
  if (category) {
    where.push("s.category = ?");
    args.push(category);
  }
  const unseenFirst = qview === "foryou" || qview === "latest" ? "i.seen_at is not null, " : "";
  const order = likeOf || qview === "discover" ? "(i.seen_at is not null), sm.score desc, i.published_at desc" : qview === "foryou" ? `${unseenFirst}${gated ? "i.gate = 'top' desc, " : ""}i.score desc, i.published_at desc` : qview === "filtered" ? "i.gate_at desc, i.score desc" : `${unseenFirst}i.published_at desc`;
  const cols = "i.id, i.gate, (select count(distinct x.source_name) from news_items x where i.story != '' and x.story = i.story) as story_n, i.gate_why, i.tags, i.story, i.seen_at is not null as seen, coalesce(s.category, '') as category, i.source_id, i.source_name, i.url, i.title, i.summary, i.image, length(i.content) > 1 as has_content, i.published_at, i.state, i.vote, i.score, i.reasons";
  const rows = await q(`select ${cols} from ${from} where ${where.map((w) => `(${w})`).join(" and ")} order by ${order}, i.id desc limit ?`, [...args, qview === "foryou" && prefs.diversity ? 600 : limit + 1], 601);
  const toItem = (r) => ({
    id: r.id,
    sourceName: r.source_name,
    url: r.url,
    title: r.title,
    summary: r.summary,
    image: prefs.images && r.image && r.image !== "-" ? r.image : "",
    hasContent: !!r.has_content,
    ago: ago(r.published_at, lang),
    publishedAt: r.published_at,
    state: r.state,
    vote: r.vote > 0 ? 1 : r.vote < 0 ? -1 : 0,
    saved: r.state === "saved",
    liked: r.vote > 0,
    disliked: r.vote < 0,
    seen: !!r.seen,
    score: r.score,
    gate: ["pass", "top", "drop"].includes(r.gate) ? r.gate : "",
    gateWhy: r.gate_why ?? "",
    top: r.gate === "top",
    category: r.category,
    story: r.story ?? "",
    storySources: r.story_n ?? 0,
    caught: false,
    thread: r.story ? `story:${r.story}` : "",
    outlets: (r.story_n ?? 0) >= 2 ? t("{n} outlets", { n: r.story_n }) : "",
    tagList: (() => {
      try {
        const x = JSON.parse(r.tags ?? "[]");
        return Array.isArray(x) ? x.filter((y) => typeof y === "string").slice(0, 4).map((tag) => ({ tag })) : [];
      } catch {
        return [];
      }
    })(),
    why: (() => {
      try {
        const x = JSON.parse(r.reasons ?? "[]");
        return Array.isArray(x) ? x.slice(0, 3).join(" · ") : "";
      } catch {
        return "";
      }
    })(),
  });
  let all = rows.map((r) => ({ ...toItem(r), sourceNameKey: r.source_name }));
  if (qview === "foryou" && prefs.diversity) {
    const fresh = all.filter((i) => !i.seen);
    all = [...fresh.filter((i) => i.gate === "top"), ...diversify(fresh.filter((i) => i.gate !== "top").map((i) => ({ ...i, sourceName: i.sourceName }))), ...diversify(all.filter((i) => i.seen))];
  }
  const followed = !!topic;
  const hasMore = all.length > limit;
  const items = all.slice(0, limit);
  // "You're all caught up": what you have seen comes after the unseen (For you, Latest) — a line says where that begins.
  if (!followed && (view === "foryou" || view === "latest")) {
    const at = items.findIndex((i) => i.seen);
    if (at > 0) items[at].caught = true;
  }

  // --- the funnel strip, the taste, the overview
  const top = view === "foryou" && !sourceId && !category && !topic;
  const P = (kind, text = "", tip = "") => ({ kind, text, tip });
  let funnel = null;
  if (top) {
    const day = new Date().toLocaleDateString("sv-SE");
    const had = (await zeff.call("pref.get", { key: "news:funnel-stats" })).value ?? {};
    const stats = had.day === day ? { fetched: 0, judged: 0, passed: 0, top: 0, dropped: 0, cleared: 0, ...had } : { fetched: 0, judged: 0, passed: 0, top: 0, dropped: 0, cleared: 0 };
    const important = await n("select count(*) n from news_items i where i.gate = 'top' and i.state = 'new' and i.seen_at is null and i.score > -50 and i.published_at > ?", [since]);
    const now = { kept, forYou: c.unread, important, waiting: c.waiting, filtered: c.filtered, rest: kept - c.unread - c.waiting - c.filtered };
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const last = (await q("select max(id) id from news_items where fetched_at < ?", [start.toISOString()], 1))[0]?.id ?? null;
    const ever = (await q("select seq from sqlite_sequence where name = 'news_items'", [], 1).catch(() => []))[0]?.seq ?? 0;
    const came = last === null || !ever ? null : ever - last;
    const today = [P("head", t("Today")), P("plain", `📥 ${t("{n} in", { n: came ?? stats.fetched })}`, t("Headlines fetched from your sources today"))];
    const keptPart = P("plain", `🧹 ${t("{n} kept", { n: now.kept })}`, t("Only the newest and the best are kept, besides what you saved or liked"));
    const parts = funnelOn
      ? [
          ...today,
          P("sep", "·"),
          P("plain", `🔎 ${t("{n} read by the agent", { n: stats.judged })}`, t("The best by score that the agent read")),
          P("sep", "·"),
          P("plain", `🧹 ${t("{n} cleared away", { n: stats.cleared })}`, t("Removed by the clearing, read or not: only the newest and the best are kept, besides what you saved or liked")),
          P("br"),
          P("head", t("Now")),
          keptPart,
          P("sep", "="),
          P("good", `✓ ${t("{n} for you", { n: now.forYou })}`, t("Let through to For you")),
          ...(now.important > 0 ? [P("warn", t("({n} important)", { n: now.important }))] : []),
          P("sep", "+"),
          P("plain", t("{n} waiting for the agent", { n: now.waiting })),
          P("sep", "+"),
          P("link", `⊘ ${t("{n} filtered out", { n: now.filtered })}`),
          P("sep", "+"),
          P("plain", t("{n} seen", { n: now.rest }), t("What you have seen already, or what the agent didn't read before you saw it")),
        ]
      : [...today, P("sep", "→"), P("plain", t("scored for you")), P("sep", "·"), keptPart];
    funnel = { on: funnelOn, parts, text: parts.map((p) => (p.kind === "br" ? "\n" : p.text)).join(" ").replace(/ ?\n ?/g, "\n").trim(), agent: t("Filter with an agent …"), agentTip: t("An agent reads the news first and lets only what interests you through") };
  }
  // The stories on top of For you: what is important and the stories running through what is for you (the built-in's storyGroups over the best 150 of the last days).
  let stories = [];
  if (top) {
    const sinceS = new Date(Date.now() - Math.min(prefs.maxAgeDays, 3) * 864e5).toISOString();
    const pool = await q(`select ${cols} from news_items i left join news_sources s on s.id = i.source_id where (i.state != 'hidden') and (i.score > -50) and (i.published_at > ?) and (i.source_id is null or s.enabled = 1)${gated ? ` and (${PASSED})` : ""} order by i.seen_at is not null, ${gated ? "i.gate = 'top' desc, " : ""}i.score desc, i.published_at desc limit 150`, [sinceS], 150);
    const groups = storyGroups(pool.map((r) => ({ id: r.id, gate: ["pass", "top", "drop"].includes(r.gate) ? r.gate : "", state: r.state, story: r.story ?? "", storySources: r.story_n ?? 0, seen: !!r.seen, score: r.score, publishedAt: r.published_at, title: r.title, summary: r.summary, image: prefs.images && r.image && r.image !== "-" ? r.image : "", sourceName: r.source_name, url: r.url, gateWhy: r.gate_why ?? "" })));
    stories = groups.map((g) => ({
      key: g.key,
      kind: g.kind,
      label: g.kind === "story" ? g.label : t(g.label),
      items: g.items.map((i) => ({ id: i.id, title: i.title, text: i.summary, image: i.image, meta: `${i.sourceName} · ${ago(i.publishedAt, lang)}${i.storySources >= 2 ? ` · ${t("{n} outlets", { n: i.storySources })}` : ""}`, url: i.url, why: i.gateWhy && i.gate !== "drop" ? `${i.gate === "top" ? "★" : "✓"} ${i.gateWhy}` : "", seen: i.seen })),
    }));
  }
  const tasteRaw = view === "discover" ? ((await zeff.call("pref.get", { key: "news:taste" })).value ?? {}) : null;
  const taste = tasteRaw ? { text: tasteRaw.text ?? "", none: t("Nothing written yet — like or save a few articles, then press Discover."), by: t("Written by Zeff from what you like and save."), edit: t("Read and edit it"), pending: (tasteRaw.pending ?? []).length ? ` · ${t("{n} signals waiting to be taken in", { n: tasteRaw.pending.length })}` : "" } : null;
  let overview = null;
  if (view === "foryou" && !sourceId && !topic) {
    const d = (await zeff.call("pref.get", { key: "news:digest" })).value;
    if (d && d.at) {
      const ids = [...new Set([...(d.picks ?? []).map((p) => p.id), ...(d.themes ?? []).flatMap((th) => th.ids)])];
      const got = ids.length ? await q(`select id, title, url, source_name from news_items where id in (${ids.map(() => "?").join(",")})`, ids) : [];
      const byId = new Map(got.map((r) => [r.id, r]));
      overview = {
        ago: ago(d.at, lang),
        text: d.overview,
        themes: (d.themes ?? []).map((th) => ({ title: th.title, summary: th.summary, links: th.ids.flatMap((id, k) => { const it = byId.get(id); return it ? [{ n: k + 1, url: it.url, label: it.source_name, tip: `${it.source_name}: ${it.title}` }] : []; }) })),
        picks: (d.picks ?? []).flatMap((p) => { const it = byId.get(p.id); return it ? [{ url: it.url, title: it.title, why: p.why }] : []; }),
        spoken: [d.overview, ...(d.themes ?? []).map((th) => `${th.title}. ${th.summary}`), ...(d.picks ?? []).flatMap((p) => { const it = byId.get(p.id); return it ? [`${it.title}. ${p.why}`] : []; })].join("\n\n"),
      };
    }
  }
  const empty = items.length > 0 || view === "discover" ? "" : topic ? "none" : sources.length === 0 && prefs.interests.length === 0 ? "starter" : view === "foryou" && funnelOn ? "funnel" : view === "foryou" || view === "latest" ? "old" : "none";
  const emptyText = {
    "": "",
    starter: t("Nothing here yet. Pick some sources and say what interests you under"),
    funnel: c.waiting > 0 ? t("The agent hasn't let anything through yet — {n} headlines are waiting for it.", { n: c.waiting }) : t("Nothing new for you right now — the agent looks again after the next fetch."),
    old: t("No news in the last {n} days — click Refresh.", { n: prefs.maxAgeDays }),
    none: t("Nothing here."),
  }[empty];
  const llm = true;
  const topicLabel = topic.startsWith("story:") ? topic.slice(6) : topic;
  const loadedAt = (await q("select max(fetched_at) at from news_items", [], 1))[0]?.at ?? "";
  return { view, like: likeOf, topic, topicLabel, topicIsStory: topic.startsWith("story:"), topicAsk: topic ? `Was ist der Stand zu „${topicLabel.slice(0, 80)}“? Fasse die Entwicklung chronologisch zusammen.` : "", stories, voice: lang === "de" ? "de-DE" : lang === "es" ? "es-ES" : "en-US", loadedAt, source: sourceId, category, views, categories, filtered: !!(category || sourceId || topic), funnel, taste, overview, llm, images: !!prefs.images, items, hasMore, nextLimit: limit + STEP, empty, emptyText, waiting: c.waiting, maxAgeDays: prefs.maxAgeDays, funnelOn, digestOn: !!prefs.digest };
}
