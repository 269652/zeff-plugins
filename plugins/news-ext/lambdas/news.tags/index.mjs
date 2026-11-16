import { DEFAULT_PREFS, TAGGING_INSTRUCTIONS, TAGGING_SCHEMA, analyze, clusterStories } from "./lib.mjs";

/**
 * Tags for the kept items, two layers: the corpus tagger (always, no AI — after each sync every recent item gets its names and topics, decided with all the
 * headlines in view, and the stories: reports grouped by content) and the AI (optional — a batch of the best unseen headlines tagged: canonical names, topics
 * as short nouns and a label for the concrete story, the same on every item about it). The AI's tags replace the corpus tagger's for those items. Handed back as
 * statements for the flow to write (a lambda only reads). The built-in's retagAll and aiTagBatch (src/plugins/news/retag.ts).
 * event: { batches } — AI batches of 40 (2 with the sync). Returns { batches: [[{ sql, params }]], tagged, aiTagged }.
 */
const BATCH = 400;
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));
const clean = (t) => [...new Set((Array.isArray(t) ? t : []).filter((x) => typeof x === "string").map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length >= 2 && x.length <= 40))].slice(0, 4);
const TAGS = "update news_items set tags = ?, tag_src = ?, story = case when ? != '' then ? else story end where id = ? and (tag_src != 'ai' or ? = 'ai')";

export async function handler(event, context) {
  const zeff = context.zeff;
  const nowMs = Date.now();
  const prefs = { ...DEFAULT_PREFS, ...((await zeff.call("pref.get", { key: "news:prefs" })).value ?? {}) };
  const q = async (sql, params = [], limit = 2000) => (await zeff.call("sql.query", { sql, params, limit })).rows;
  const statements = [];

  // The corpus tagger: every recent item (7 days, at most 6000 — the newest) tagged with all the headlines in view; the stories by content.
  const items = [];
  for (let offset = 0; items.length < 6000; offset += 2000) {
    const page = await q("select id, title, summary, tag_src, published_at from news_items where published_at > ? order by published_at desc, id limit 2000 offset ?", [new Date(nowMs - 7 * 864e5).toISOString(), offset]);
    items.push(...page.map((r) => ({ id: r.id, title: r.title, summary: r.summary, src: r.tag_src, at: r.published_at })));
    if (page.length < 2000) break;
  }
  let tagged = 0;
  if (items.length) {
    const a = analyze(items);
    for (const i of items.filter((x) => x.src !== "ai")) statements.push({ sql: TAGS, params: [JSON.stringify((a.tags.get(i.id) ?? []).map((t) => t.name).slice(0, 4)), "auto", "", "", i.id, "auto"] });
    // Stories: a label per cluster (made unique by the day when two share one); items in none lose their old label.
    const stories = clusterStories(items.map((i) => ({ id: i.id, at: i.at })), a.vectors, a.tags);
    const label = new Map();
    const used = new Map();
    for (const s of stories) {
      const n = (used.get(s.label) ?? 0) + 1;
      used.set(s.label, n);
      const name = n === 1 ? s.label : `${s.label} (${s.lastAt.slice(5, 10).replace("-", ".")}.)`;
      for (const id of s.items) label.set(id, name);
    }
    for (const i of items) {
      const story = label.get(i.id) ?? "";
      statements.push({ sql: "update news_items set story = ? where id = ? and (tag_src != 'ai' or ? != '' or story = '')", params: [story, i.id, story] });
    }
    tagged = items.length;
  }

  // The AI: a batch (or two) of the best unseen headlines it hasn't tagged yet.
  let aiTagged = 0;
  if (prefs.aiTags) {
    const instructions = (await zeff.call("prompts.fill", { key: "news-tags", template: TAGGING_INSTRUCTIONS, vars: {} })).text;
    const done = [];
    for (let b = 0; b < Math.max(1, Math.min(4, Number(event?.batches) || 2)); b++) {
      const batch = await q(
        `select i.id, i.title, i.summary from news_items i left join news_sources s on s.id = i.source_id where i.tag_src != 'ai' and i.state != 'hidden' and i.score > -50 and i.published_at > ? and (i.source_id is null or s.enabled = 1)${prefs.funnel ? " and i.gate in ('pass', 'top')" : ""} and i.id not in (select value from json_each(?)) order by (i.seen_at is not null), i.score desc, i.published_at desc limit 40`,
        [new Date(nowMs - Math.min(prefs.maxAgeDays, 3) * 864e5).toISOString(), JSON.stringify(done)],
      );
      if (!batch.length) break;
      const numbered = batch.map((it, i) => `${i + 1}. ${it.title}${it.summary ? ` — ${String(it.summary).slice(0, 160)}` : ""}`);
      let answer;
      try {
        answer = await zeff.call("ai.json", { prompt: [instructions, "", ...numbered].join("\n"), schema: TAGGING_SCHEMA, task: "news-ext.tags", budget: 0.25 });
      } catch {
        break;
      }
      let got = 0;
      for (const a of answer.items ?? []) {
        const it = batch[(Number(a.n) || 0) - 1];
        const tags = clean(a.tags);
        if (!it || !tags.length) continue;
        const story = typeof a.story === "string" ? a.story.replace(/\s+/g, " ").trim().slice(0, 60) : "";
        statements.push({ sql: TAGS, params: [JSON.stringify(tags), "ai", story, story, it.id, "ai"] });
        got++;
      }
      done.push(...batch.map((x) => x.id));
      aiTagged += got;
      if (!got) break;
    }
  }
  return { batches: chunks(statements, BATCH), tagged, aiTagged };
}
