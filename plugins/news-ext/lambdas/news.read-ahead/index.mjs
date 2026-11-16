import { DEFAULT_PREFS, NEWS_BROWSER_UA, decodeBody, fetchArticle, snippetOf } from "./lib.mjs";

/**
 * Reading ahead: after each fetch, the whole text of the best unread items so they open at once (a page that can't be read is marked, not retried), and a
 * picture found on the page. Handed back as statements for the flow to write (a lambda only reads). The built-in's prefetch part of syncNews and setContent
 * (src/plugins/news/sync.ts, reader.ts, store.ts). event: { limit } (30). Returns { statements, read, unreadable }.
 */
const UNREADABLE = "\u0001";

const fetchText = async (url, init = {}) => {
  const res = await fetch(url, { method: init.method ?? "GET", body: init.body, headers: { "user-agent": NEWS_BROWSER_UA, "accept-language": "de,en;q=0.8", ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { text: await decodeBody(res, 3_000_000), url: res.url || url, type: res.headers.get("content-type") ?? "" };
};

export async function handler(event, context) {
  const zeff = context.zeff;
  const prefs = { ...DEFAULT_PREFS, ...((await zeff.call("pref.get", { key: "news:prefs" })).value ?? {}) };
  if (!prefs.prefetch) return { statements: [], read: 0, unreadable: 0 };
  const limit = Math.max(1, Math.min(60, Number(event?.limit) || 30));
  const items = (
    await zeff.call("sql.query", {
      sql: `select i.id, i.url from news_items i where i.content = '' and i.state = 'new' and i.score > -50 and i.published_at > ?${prefs.funnel ? " and i.gate in ('pass', 'top')" : ""} order by i.score desc limit ?`,
      params: [new Date(Date.now() - prefs.maxAgeDays * 864e5).toISOString(), limit],
      limit,
    })
  ).rows;
  const statements = [];
  let read = 0;
  let unreadable = 0;
  let i = 0;
  const set = (id, content, image) => {
    statements.push({ sql: "update news_items set content = ? where id = ?", params: [content, id] });
    // A card with no summary of its own gets the opening of the article.
    if (content.length > 1) statements.push({ sql: "update news_items set summary = ? where id = ? and summary = ''", params: [snippetOf(content), id] });
    // The page was looked at: a picture found is kept; none found is remembered (not looked for again).
    if (image) statements.push({ sql: "update news_items set image = ? where id = ? and image in ('', '-')", params: [image, id] });
    else statements.push({ sql: "update news_items set image = '-' where id = ? and image = ''", params: [id] });
  };
  await Promise.all(
    Array.from({ length: Math.min(3, items.length) }, async () => {
      while (i < items.length) {
        const it = items[i++];
        try {
          const a = await fetchArticle(it.url, { fetchText });
          set(it.id, a.text, a.image);
          read++;
        } catch {
          set(it.id, UNREADABLE);
          unreadable++;
        }
      }
    }),
  );
  return { statements, read, unreadable };
}
