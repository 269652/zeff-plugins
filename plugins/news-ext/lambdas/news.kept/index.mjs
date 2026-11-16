/**
 * The news you kept (saved or liked) as a source of the Workspace's pipelines — a database an agent can read and summarise (the built-in's workspace-source.ts
 * newsRecords): with their text, their picture, their tags. The feed stays in News; a check taken from Saved or Liked in such a database is not taken back (a plugin's
 * sources are read-only). Returns the records.
 */
const F = { image: "newsimage", source: "newssource", published: "newspublished", score: "newsscore", saved: "newssaved", liked: "newsliked", link: "newslink", tags: "newstags", story: "newsstory" };
const tagsOf = (raw) => {
  try {
    const t = JSON.parse(raw ?? "[]");
    return Array.isArray(t) ? t.filter((x) => typeof x === "string").slice(0, 4) : [];
  } catch {
    return [];
  }
};

export async function handler(_event, context) {
  const rows = (
    await context.zeff.call("sql.query", {
      sql: "select id, title, url, summary, source_name, published_at, state, vote, score, image, tags, story, case when length(content) > 1 then substr(content, 1, 6000) else '' end as article from news_items where (state = 'saved' or (vote = 1 and state != 'hidden')) order by published_at desc, id desc limit 500",
      params: [],
      limit: 500,
    })
  ).rows;
  return rows.map((i) => ({
    ref: `news:${i.id}`,
    title: i.title,
    fields: {},
    url: i.url,
    text: [i.summary, i.article && i.article !== i.summary ? i.article : ""].filter(Boolean).join("\n\n"),
    updatedAt: `${i.state}:${i.vote > 0 ? 1 : i.vote < 0 ? -1 : 0}`,
    dataType: "news",
    typed: [
      { id: F.source, name: "Publisher", type: "text", value: i.source_name },
      { id: F.published, name: "Published", type: "date", value: String(i.published_at).slice(0, 10) },
      { id: F.score, name: "Score", type: "number", value: Math.round(i.score * 10) / 10 },
      { id: F.saved, name: "Saved", type: "checkbox", value: i.state === "saved" || null },
      { id: F.liked, name: "Liked", type: "checkbox", value: i.vote > 0 || null },
      { id: F.link, name: "Link", type: "url", value: i.url },
      { id: F.image, name: "Image", type: "url", value: /^https?:\/\//.test(i.image) ? i.image : null },
      { id: F.tags, name: "Tags", type: "text", value: tagsOf(i.tags).join(", ") },
      { id: F.story, name: "Story", type: "text", value: i.story ?? "" },
    ],
  }));
}
