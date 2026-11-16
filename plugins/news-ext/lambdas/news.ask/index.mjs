import { ASK_INSTRUCTIONS, ASK_SCHEMA } from "./lib.mjs";

/**
 * Ask your news (optional): a question answered from what Zeff has fetched — like asking a notebook. The question's words search the kept items (headlines,
 * summaries, the full articles where read), the best dozen go to the AI with their text, and it answers only from them, citing the numbers — which come back as
 * links. The built-in's askNews and searchItems (src/plugins/news/ask.ts, store.ts). event: { question, limit }. Returns { answer, sources: [{ n, id, title, url, sourceName }] }.
 */
const STOPWORDS = new Set("what which when where wann welche welcher welches warum wieso wurde wurden wird werden sind sein haben gibt aber auch oder nicht diese dieser dieses über nach neue neuen about with that this have from were was wie wer wo was neues neuer gibt".split(" "));
// The words, without an ending (Quantencomputern → Quantencompute, so it also finds Quantencomputer, Quantencomputers).
const stem = (w) => (w.length >= 6 ? w.replace(/(en|er|es|em|e|n|s)$/, "") : w);

export async function handler(event, context) {
  const zeff = context.zeff;
  const q = String(event?.question ?? "").trim();
  if (q.length < 3) return { answer: "", sources: [], error: "Ask a question." };
  const limit = Math.max(1, Math.min(30, Number(event?.limit) || 12));
  const words = [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter((w) => w.length >= 4 && !STOPWORDS.has(w)).map(stem))].slice(0, 6);
  const none = { answer: "Dazu habe ich in deinen gesammelten Nachrichten nichts gefunden.", sources: [] };
  if (!words.length) return none;
  const hits = `(${words.map(() => "(case when lower(i.title) like ? then 3 else 0 end + case when lower(i.summary) like ? then 1 else 0 end + case when lower(i.content) like ? then 1 else 0 end)").join(" + ")})`;
  const like = () => "(i.title like ? or i.summary like ? or i.content like ?)";
  const run = async (join) =>
    (
      await zeff.call("sql.query", {
        sql: `select i.id, i.title, i.summary, i.url, i.source_name, case when length(i.content) > 1 then substr(i.content, 1, 900) else '' end as opening, ${hits} as hits from news_items i where ${words.map(like).join(` ${join} `)} order by hits desc, i.published_at desc limit ?`,
        params: [...words.flatMap((w) => [`%${w}%`, `%${w}%`, `%${w}%`]), ...words.flatMap((w) => [`%${w}%`, `%${w}%`, `%${w}%`]), limit],
        limit,
      })
    ).rows;
  const all = await run("and");
  const items = all.length >= 3 || words.length === 1 ? all : [...all, ...(await run("or")).filter((r) => !all.some((a) => a.id === r.id))].slice(0, limit);
  if (!items.length) return none;
  const sources = items.map((it, i) => ({ n: i + 1, item: it, source: it.source_name, title: it.title, text: it.opening || it.summary }));
  const instructions = (await zeff.call("prompts.fill", { key: "news-ask", template: ASK_INSTRUCTIONS, vars: {} })).text;
  const prompt = [instructions, `Frage: ${q}`, "", "Quellen:", ...sources.map((s) => `[${s.n}] (${s.source}) ${s.title}\n${s.text}`)].join("\n");
  const raw = await zeff.call("ai.json", { prompt, schema: ASK_SCHEMA, task: "news-ext.ask", budget: 0.3 });
  const cited = new Set([...(raw.cites ?? []), ...[...String(raw.answer ?? "").matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]))]);
  return { answer: String(raw.answer ?? "").slice(0, 3000), sources: sources.filter((s) => cited.has(s.n)).map((s) => ({ n: s.n, id: s.item.id, title: s.title, url: s.item.url, sourceName: s.source })) };
}
