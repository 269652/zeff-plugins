import { DEFAULT_PREFS, DIGEST_INSTRUCTIONS, DIGEST_SCHEMA, diversify } from "./lib.mjs";

/**
 * The AI briefing (optional) — like a notebook over your news: from the best unread items it writes what matters today in a few sentences, groups the items
 * into themes with a short synthesis each (every claim cites its items by number, which become links), and picks the few to read first with a reason that
 * fits you. Titles, short texts and your interests go to the AI; it can only use what is in front of it. Handed back for the flow to keep (the preference
 * news:digest). The built-in's buildDigest (src/plugins/news/digest.ts). Returns { digest } — null: nothing to say.
 */
export async function handler(event, context) {
  const zeff = context.zeff;
  const prefs = { ...DEFAULT_PREFS, ...((await zeff.call("pref.get", { key: "news:prefs" })).value ?? {}) };
  if (event?.auto === true && !prefs.digest) return { digest: null };
  const since = new Date(Date.now() - Math.min(prefs.maxAgeDays, 2) * 864e5).toISOString();
  // The For you list as the built-in's listItems makes it: the best 600 (unseen first, what the agent found important first), mixed, the first 40 of them that are new.
  const rows = (
    await zeff.call("sql.query", {
      sql: `select i.id, i.source_name, i.title, i.summary, i.state, i.score, i.gate, i.seen_at is not null as seen, coalesce(s.category, '') as category, case when length(i.content) > 1 then substr(i.content, 1, 300) else '' end as opening
        from news_items i left join news_sources s on s.id = i.source_id
        where i.state != 'hidden' and i.score > -50 and i.published_at > ? and (i.source_id is null or s.enabled = 1)${prefs.funnel ? " and i.gate in ('pass', 'top')" : ""}
        order by i.seen_at is not null, ${prefs.funnel ? "i.gate = 'top' desc, " : ""}i.score desc, i.published_at desc, i.id desc limit 600`,
      params: [since],
      limit: 600,
    })
  ).rows.map((r) => ({ id: r.id, sourceName: r.source_name, title: r.title, summary: r.summary, state: r.state, score: r.score, gate: r.gate, seen: !!r.seen, category: r.category, opening: r.opening }));
  const fresh = rows.filter((i) => !i.seen);
  const mixed = prefs.diversity ? [...fresh.filter((i) => i.gate === "top"), ...diversify(fresh.filter((i) => i.gate !== "top")), ...diversify(rows.filter((i) => i.seen))] : rows;
  const items = mixed.slice(0, 40).filter((i) => i.state === "new");
  if (!items.length) return { digest: null };
  // The opening of the article, where it has been read, is better to go on than a one-line summary.
  const numbered = items.map((it, i) => ({ n: i + 1, source: it.sourceName, title: it.title, summary: it.opening || it.summary }));
  const interests = prefs.interests.map((i) => i.term);
  const instructions = (await zeff.call("prompts.fill", { key: "news-digest", template: DIGEST_INSTRUCTIONS, vars: {} })).text;
  const prompt = [instructions, `Interessen: ${interests.length ? interests.join(", ") : "(keine angegeben)"}`, "", "Meldungen:", ...numbered.map((i) => `${i.n}. [${i.source}] ${i.title}${i.summary ? ` — ${i.summary.slice(0, 260)}` : ""}`)].join("\n");
  const a = await zeff.call("ai.json", { prompt, schema: DIGEST_SCHEMA, task: "news-ext.digest", budget: 0.4 });
  const at = (n) => items[(n ?? 0) - 1];
  const picks = (a.picks ?? []).flatMap((p) => {
    const it = at(p.n);
    return it && p.why ? [{ id: it.id, why: String(p.why).slice(0, 240) }] : [];
  });
  const themes = (a.themes ?? []).flatMap((th) => {
    const ids = [...new Set((th.items ?? []).flatMap((n) => (at(n) ? [at(n).id] : [])))];
    return th.title && th.summary && ids.length ? [{ title: String(th.title).slice(0, 80), summary: String(th.summary).slice(0, 500), ids }] : [];
  });
  return { digest: { at: new Date().toISOString(), overview: String(a.overview ?? "").slice(0, 900), picks: picks.slice(0, 5), themes: themes.slice(0, 6) } };
}
