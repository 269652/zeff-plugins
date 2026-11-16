/** One item to read here: its title, address, source, picture and the whole article where it was read (the page's reading dialog). event: { id }. */
const UNREADABLE = "\u0001";
export async function handler(event, context) {
  const id = Number(event?.id);
  if (!Number.isInteger(id)) return { found: false };
  const r = (await context.zeff.call("sql.query", { sql: "select title, url, source_name, summary, image, content, published_at from news_items where id = ?", params: [id], limit: 1 })).rows[0];
  if (!r) return { found: false };
  const text = r.content && r.content !== UNREADABLE && r.content.length > 1 ? r.content : "";
  return { found: true, title: r.title, url: r.url, source: r.source_name, image: r.image && r.image !== "-" ? r.image : "", text, summary: r.summary, paragraphs: (text || r.summary || "").split(/\n{2,}/).filter(Boolean).map((p) => ({ t: p })), at: r.published_at };
}
