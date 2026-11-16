import { DEFAULT_PREFS, decodeBody, normalizeUrl, parseFeed, titleKey, topicFeedUrl } from "./lib.mjs";

/**
 * One round of the News sync: the sources due fetched (the ones fetched longest ago first, `perRun` of them — never fetched first —, one Google News search per
 * interest besides), their items read, and what is new worked out against what is kept: a link or headline already there is skipped, one cleared away before
 * is not brought back. Handed back as statements for the flow to write (a lambda only reads) — the inserts, what a kept item learned (a picture, its text), how
 * each source went and what its server said (ETag, Last-Modified). The built-in's syncNews fetch part + addItems (src/plugins/news/sync.ts, store.ts).
 * event: { all, onlyIds }. Returns { batches: [[{ sql, params }]], message, ok, added }.
 */
const UA = "Mozilla/5.0 (compatible; Zeff/1.0)";
const BATCH = 400;
const CHUNK = 400;

const pool = async (list, n, fn) => {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) await fn(list[i++]); }));
};
const dueForFetch = (s, nowMs) => s.fails < 5 || !s.last_at || nowMs - Date.parse(s.last_at) > 864e5;
const marks = (n) => Array.from({ length: n }, () => "?").join(",");
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, (i + 1) * n));

export async function handler(event, context) {
  const zeff = context.zeff;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const prefs = { ...DEFAULT_PREFS, ...((await zeff.call("pref.get", { key: "news:prefs" })).value ?? {}) };
  const sources = (await zeff.call("sql.query", { sql: "select id, name, url, enabled, fails, last_at, etag, modified from news_sources where enabled = 1", limit: 2000 })).rows;
  const onlyIds = Array.isArray(event?.onlyIds) ? event.onlyIds.map(Number) : null;
  const due = sources.filter((s) => dueForFetch(s, nowMs));
  const wanted = onlyIds ? due.filter((s) => onlyIds.includes(s.id)) : due;
  const picked = event?.all === true || onlyIds ? wanted : [...wanted].sort((a, b) => (a.last_at ?? "").localeCompare(b.last_at ?? "")).slice(0, Math.max(10, prefs.perRun));
  const topics = prefs.topicSearch ? [...prefs.interests].sort((a, b) => b.weight - a.weight).slice(0, 8) : [];
  if (!picked.length && !topics.length) return { batches: [], ok: true, added: 0, message: "No sources and no interests yet — add some under Settings → News." };

  const since = nowMs - prefs.maxAgeDays * 864e5;
  const jobs = [
    ...picked.map((s) => ({ id: s.id, name: s.name, url: s.url, etag: s.etag, modified: s.modified })),
    ...topics.map((i) => ({ id: null, name: `Google News: ${i.term}`, url: topicFeedUrl(i.term, prefs.language, prefs.maxAgeDays), etag: null, modified: null })),
  ];
  const statements = [];
  const fetched = [];
  const failed = [];
  let unchanged = 0;
  await pool(jobs, 8, async (job) => {
    try {
      const res = await fetch(job.url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*", ...(job.etag ? { "if-none-match": job.etag } : {}), ...(job.modified ? { "if-modified-since": job.modified } : {}) } });
      if (res.status === 304) {
        unchanged++;
        if (job.id) statements.push({ sql: "update news_sources set last_at = ?, last_error = null, fails = 0 where id = ?", params: [nowIso, job.id] });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (job.id) statements.push({ sql: "update news_sources set etag = ?, modified = ? where id = ?", params: [res.headers.get("etag"), res.headers.get("last-modified"), job.id] });
      const items = parseFeed(await decodeBody(res), nowIso).filter((it) => Date.parse(it.publishedAt) >= since).slice(0, prefs.perSource);
      fetched.push({ job, items });
      if (job.id) statements.push({ sql: "update news_sources set last_at = ?, last_error = null, fails = 0 where id = ?", params: [nowIso, job.id] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push(`${job.name}: ${msg}`);
      if (job.id) statements.push({ sql: "update news_sources set last_at = ?, last_error = ?, fails = fails + 1 where id = ?", params: [nowIso, msg.slice(0, 300), job.id] });
    }
  });

  // What is new: against what is kept (a link, a headline of the last days) and what was cleared away before.
  const all = fetched.flatMap((f) => f.items.map((it) => ({ job: f.job, it, key: normalizeUrl(it.url), tkey: titleKey(it.title) })));
  const known = new Set();
  const stories = new Map();
  const goneUrl = new Set();
  const goneTitle = new Set();
  for (const part of chunks([...new Set(all.map((x) => x.key))], CHUNK)) {
    for (const r of (await zeff.call("sql.query", { sql: `select url_key from news_items where url_key in (${marks(part.length)})`, params: part, limit: 2000 })).rows) known.add(r.url_key);
    for (const r of (await zeff.call("sql.query", { sql: `select url_key from news_gone where url_key in (${marks(part.length)})`, params: part, limit: 2000 })).rows) goneUrl.add(r.url_key);
  }
  for (const part of chunks([...new Set(all.map((x) => x.tkey).filter((k) => k.length > 12))], CHUNK)) {
    for (const r of (await zeff.call("sql.query", { sql: `select title_key, published_at from news_items where title_key in (${marks(part.length)})`, params: part, limit: 2000 })).rows) stories.set(r.title_key, [...(stories.get(r.title_key) ?? []), r.published_at]);
    for (const r of (await zeff.call("sql.query", { sql: `select title_key from news_gone where title_key in (${marks(part.length)})`, params: part, limit: 2000 })).rows) goneTitle.add(r.title_key);
  }
  let added = 0;
  for (const { job, it, key, tkey } of all) {
    // Kept already (same link): only what is new about it — a picture, the text — is added.
    if (known.has(key)) {
      if (it.image || it.content) statements.push({ sql: "update news_items set image = case when image in ('', '-') then ? else image end, content = case when length(content) <= 1 then ? else content end where url_key = ?", params: [it.image ?? "", it.content ?? "", key] });
      continue;
    }
    const sinceStory = new Date(Date.parse(it.publishedAt) - 3 * 864e5).toISOString();
    if (tkey.length > 12 && (stories.get(tkey) ?? []).some((p) => p > sinceStory)) continue;
    if (goneUrl.has(key) || (tkey.length > 12 && goneTitle.has(tkey))) continue;
    known.add(key);
    if (tkey.length > 12) stories.set(tkey, [...(stories.get(tkey) ?? []), it.publishedAt]);
    statements.push({ sql: "insert or ignore into news_items (source_id, source_name, guid, url, url_key, title, title_key, summary, published_at, fetched_at, image, content) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [job.id, job.name, it.guid, it.url, key, it.title, tkey, it.summary, it.publishedAt, nowIso, it.image ?? "", it.content ?? ""] });
    added++;
  }
  const ok = failed.length < jobs.length;
  const failNote = failed.length ? ` — ${failed.length} failed: ${failed.slice(0, 3).join("; ").slice(0, 300)}${failed.length > 3 ? " …" : ""}` : "";
  return { batches: chunks(statements, BATCH), ok, added, message: `${added} new from ${jobs.length - failed.length} of ${jobs.length} sources${picked.length < due.length ? ` (this round; ${due.length - picked.length} more next)` : ""}${unchanged ? ` (${unchanged} unchanged)` : ""}${failNote}` };
}
