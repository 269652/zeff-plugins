import { ALL_FEEDS, BIG_STORY, DEFAULT_PREFS, STARTER_NAMES, tokens } from "./lib.mjs";

/**
 * What you do to the news, as statements for the flow to write (a lambda only reads): an item read, saved, hidden or back to new; liked (+1), disliked (−1) or
 * taken back (0) — the item's vote, its source's votes and the words of its headline learn from it; items seen; a source added, changed or removed; the learning
 * forgotten; and the clearing away (read items past their days out, then only the newest and the best stay — what goes is remembered for a while so a feed that
 * still carries it doesn't bring it back). The built-in's setState, vote, markSeen, addSource, updateSource, removeSource, forgetLearning, prune and trim
 * (src/plugins/news/store.ts). event: { op: state | vote | seen | source-add | source-update | source-remove | forget | clean, … }. Returns { ok, statements, error? }.
 */
const STATES = ["new", "read", "saved", "hidden"];
const KEEP = `select id from news_items where state = 'saved' or vote = 1 or gate = 'top'
  union select id from news_items where (gate = 'pass' or state = 'hidden') and published_at > ?
  union select id from news_items where gate = 'drop' and gate_at > ?
  union select sm.item_id from news_similar sm join news_items x on x.id = sm.item_id where sm.at > ? or x.published_at > ?
  union select id from (select id from news_items where state != 'hidden' and gate != 'drop' order by published_at desc limit ?)
  union select id from (select id from news_items where state != 'hidden' and gate != 'drop' and score > -50 and published_at > ? order by score desc limit ?)
  union select id from (select id, row_number() over (partition by story order by score desc) rn from news_items
    where story in (select story from news_items where story != '' and published_at > ? group by story having count(distinct source_name) >= ${BIG_STORY})) where rn = 1`;

const EMPTY_TASTE = { text: "", likes: [], avoids: [], queries: [], updatedAt: null, pending: [], edited: false };
const tagsOf = (raw) => {
  try {
    const t = JSON.parse(raw ?? "[]");
    return Array.isArray(t) ? t.filter((x) => typeof x === "string").slice(0, 4) : [];
  } catch {
    return [];
  }
};

export async function handler(event, context) {
  const zeff = context.zeff;
  const op = String(event?.op ?? "");
  const nowIso = new Date().toISOString();
  const one = async (sql, params) => (await zeff.call("sql.query", { sql, params, limit: 1 })).rows[0];
  const id = Number(event?.id);
  switch (op) {
    case "state": {
      const state = String(event?.state ?? "");
      if (!STATES.includes(state) || !Number.isInteger(id)) return { ok: false, error: "Unknown state." };
      // Saving is a signal for the taste description (taking it back withdraws it).
      const item = await one("select id, title, summary, tags, state from news_items where id = ?", [id]);
      let taste = null;
      if (item && (state === "saved" || item.state === "saved")) {
        const cur = { ...EMPTY_TASTE, ...((await zeff.call("pref.get", { key: "news:taste" })).value ?? {}) };
        const rest = cur.pending.filter((p) => !(p.id === id && p.kind === "save"));
        taste = { ...cur, pending: state === "saved" ? [...rest, { id, kind: "save", title: item.title, summary: String(item.summary).slice(0, 300), tags: tagsOf(item.tags), at: nowIso }].slice(-60) : rest };
      }
      return { ok: true, statements: [{ sql: "update news_items set state = ? where id = ?", params: [state, id] }], taste };
    }
    case "vote": {
      const v = Number(event?.value) > 0 ? 1 : Number(event?.value) < 0 ? -1 : 0;
      const item = await one("select title, source_id, vote from news_items where id = ?", [id]);
      if (!item) return { ok: false, error: "No such item." };
      // A 👍 or 👎 is a signal for the taste description (taking it back withdraws it).
      const cur = { ...EMPTY_TASTE, ...((await zeff.call("pref.get", { key: "news:taste" })).value ?? {}) };
      const rest = cur.pending.filter((p) => !(p.id === id && (p.kind === "like" || p.kind === "dislike")));
      const full = (await one("select summary, tags from news_items where id = ?", [id])) ?? {};
      const taste = { ...cur, pending: v !== 0 ? [...rest, { id, kind: v > 0 ? "like" : "dislike", title: item.title, summary: String(full.summary ?? "").slice(0, 300), tags: tagsOf(full.tags), at: nowIso }].slice(-60) : rest };
      const delta = v - item.vote;
      const statements = [{ sql: "update news_items set vote = ? where id = ?", params: [v, id] }];
      if (delta) {
        if (item.source_id) statements.push({ sql: "update news_sources set votes = votes + ? where id = ?", params: [delta, item.source_id] });
        for (const w of tokens(item.title)) statements.push({ sql: "insert into news_terms (term, score) values (?, ?) on conflict (term) do update set score = max(-3, min(3, score + excluded.score))", params: [w, delta * 0.5] });
      }
      return { ok: true, statements, taste };
    }
    case "seen": {
      const ids = (Array.isArray(event?.ids) ? event.ids : []).map(Number).filter(Number.isInteger).slice(0, 300);
      if (!ids.length) return { ok: true, statements: [] };
      return { ok: true, statements: [{ sql: `update news_items set seen_at = ? where id in (${ids.map(() => "?").join(",")}) and seen_at is null`, params: [nowIso, ...ids] }] };
    }
    case "source-add": {
      const url = String(event?.url ?? "").trim();
      if (!/^https?:\/\/\S+$/i.test(url)) return { ok: false, error: "The address must start with http:// or https://." };
      const name = String(event?.name ?? "").trim() || new URL(url).hostname.replace(/^www\./, "");
      return { ok: true, statements: [{ sql: "insert or ignore into news_sources (name, url, created_at, category, lang) values (?, ?, ?, ?, ?)", params: [name, url, nowIso, String(event?.category ?? ""), String(event?.lang ?? "")] }] };
    }
    case "source-update": {
      const statements = [];
      if (String(event?.name ?? "").trim()) statements.push({ sql: "update news_sources set name = ? where id = ?", params: [String(event.name).trim(), id] });
      if (event?.enabled !== undefined && event?.enabled !== "") statements.push({ sql: "update news_sources set enabled = ? where id = ?", params: [event.enabled === true || event.enabled === "true" || event.enabled === 1 ? 1 : 0, id] });
      if (event?.weight !== undefined && event?.weight !== "" && Number.isFinite(Number(event.weight))) statements.push({ sql: "update news_sources set weight = ? where id = ?", params: [Math.max(0.5, Math.min(2, Number(event.weight))), id] });
      return { ok: true, statements };
    }
    case "source-remove":
      // Saved items stay (without a source); the rest goes with it.
      return { ok: true, statements: [{ sql: "delete from news_items where source_id = ? and state != 'saved'", params: [id] }, { sql: "delete from news_sources where id = ?", params: [id] }] };
    case "starter":
    case "category": {
      const feeds = op === "starter" ? ALL_FEEDS.filter((f) => STARTER_NAMES.includes(f.name)) : ALL_FEEDS.filter((f) => f.category === String(event?.name ?? ""));
      return { ok: true, statements: feeds.map((f) => ({ sql: "insert or ignore into news_sources (name, url, created_at, category, lang) values (?, ?, ?, ?, ?)", params: [f.name, f.url, nowIso, f.category ?? "", f.lang ?? ""] })), added: feeds.length };
    }
    case "taste-edit": {
      const cur = { ...EMPTY_TASTE, ...((await zeff.call("pref.get", { key: "news:taste" })).value ?? {}) };
      return { ok: true, statements: [], taste: { ...cur, text: String(event?.text ?? "").trim().slice(0, 1200), edited: true } };
    }
    case "taste-forget":
      return { ok: true, statements: [], taste: { ...EMPTY_TASTE } };
    case "forget":
      return { ok: true, statements: [{ sql: "delete from news_terms", params: [] }, { sql: "update news_sources set votes = 0", params: [] }] };
    case "clean": {
      const prefs = { ...DEFAULT_PREFS, ...((await zeff.call("pref.get", { key: "news:prefs" })).value ?? {}) };
      const nowMs = Date.now();
      const since = new Date(nowMs - prefs.maxAgeDays * 864e5).toISOString();
      const day = new Date(nowMs - 864e5).toISOString();
      const n = Math.max(20, Math.floor(prefs.keepLatest));
      // (the keep query's values, in the order its ? stand: since, day, day, since, n, since, n, since)
      const keepParams = [since, day, day, since, n, since, n, since];
      return {
        ok: true,
        statements: [
          { sql: "delete from news_items where state != 'saved' and vote != 1 and published_at < ?", params: [new Date(nowMs - prefs.keepDays * 864e5).toISOString()] },
          // Only what a feed could still bring is remembered (older than the days fetched can't come back anyway).
          { sql: `insert or replace into news_gone (url_key, title_key, at) select url_key, case when length(title_key) > 12 then title_key else '' end, ? from news_items where id not in (${KEEP}) and published_at > ?`, params: [nowIso, ...keepParams, since] },
          { sql: `delete from news_items where id not in (${KEEP})`, params: keepParams },
          { sql: "delete from news_similar where item_id not in (select id from news_items)", params: [] },
          { sql: "delete from news_gone where at < ?", params: [new Date(nowMs - (prefs.maxAgeDays + 2) * 864e5).toISOString()] },
        ],
      };
    }
    default:
      return { ok: false, error: `Unknown op “${op}”.` };
  }
}
