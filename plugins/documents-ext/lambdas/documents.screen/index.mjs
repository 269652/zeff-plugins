import { DOC_KINDS_NAV, docNav, inScope, matchWhere, tFor, wordsOf } from "./lib.mjs";

/**
 * The Documents screen's data: the documents of the scope asked for (the Inbox: those you have not seen, all, the last seven days, from mail, being read, one
 * type), searched (by name, sender and concepts, and in their whole text) and sorted, the scopes as tab options with their counts, and the document picked written
 * out. What the built-in's view-data.ts (documentsAppData) worked out for its view, over the plugin's adopted tables (documents, document_seen) and the kernel's
 * documents.origins (the mail a document came from). event: { scope, q, sort, limit, selected, checked }. Returns { scope, scopeOptions, count, items, hasMore, nextLimit,
 * unreadIds, markAll, emptyIcon, emptyText, picked }.
 */
const PAGE = 48;
const tab = (id) => id.replace(/^kind:/, "kind-");
const scopeOf = (s) => (s || "inbox").replace(/^kind-/, "kind:");
const label = (s) => String(s).replace(/[,:]/g, " ").trim();
const EXT = (name) => (/\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1] ?? "").toUpperCase();

export async function handler(event, context) {
  const z = context.zeff;
  const t = tFor(context.language);
  const now = Date.now();
  const scope = scopeOf(event?.scope);
  const sort = ["newest", "oldest", "name", "size", "unread"].includes(event?.sort) ? event.sort : "newest";
  const q = String(event?.q ?? "").trim().slice(0, 300);
  const limit = Math.min(1000, Math.max(PAGE, Number(event?.limit) || PAGE));
  const { rows } = await z.call("sql.query", {
    sql: "select d.id, d.name, d.file, substr(d.text, 1, 300) as head, d.mime, d.size, d.kind, d.status, d.error, d.compiled, d.concepts, d.summary, d.created_at, (s.doc_id is null) as unread from documents d left join document_seen s on s.doc_id = d.id order by d.created_at desc",
    limit: 5000,
  });
  // What waits for your confirmation, where a document of a local folder lies, what is being read.
  const held = new Set((await z.call("sql.query", { sql: "select doc_id from doc_gate where state = 'pending'", limit: 5000 })).rows.map((r) => r.doc_id));
  const folders = (await z.call("pref.get", { key: "documents:folders" })).value;
  const folderPath = new Map((Array.isArray(folders) ? folders : []).map((f) => [f.id, f.path]));
  const local = new Map();
  for (const r of (await z.call("sql.query", { sql: "select doc_id, rel, folder_id, missing_at from doc_local_files where doc_id is not null", limit: 5000 })).rows) {
    const folder = folderPath.get(r.folder_id) ?? "";
    local.set(r.doc_id, { shown: [String(folder).split(/[\\/]/).filter(Boolean).pop() ?? folder, ...String(r.rel).split(/[\\/]/)].filter(Boolean).join(" › "), missing: !!r.missing_at });
  }
  const busy = (await z.call("sql.query", { sql: "select status, count(*) as n from documents where status in ('queued', 'extracting') group by status", limit: 5 })).rows;
  const reading = { now: busy.find((r) => r.status === "extracting")?.n ?? 0, waiting: busy.find((r) => r.status === "queued")?.n ?? 0 };
  let origins = {};
  try {
    origins = (await z.call("documents.origins", { ids: rows.map((r) => r.id) })).origins ?? {};
  } catch {
    origins = {}; // (no mail attachments here)
  }
  const docs = rows.map((r) => {
    const o = origins[r.id];
    const from = o ? `${o.from}${o.subject ? ` — ${o.subject}` : ""}`.trim() : "";
    return { ...r, unread: !!r.unread, compiled: !!r.compiled, from, held: held.has(r.id) };
  });
  const facts = (d) => ({ unread: d.unread, kind: d.kind, status: d.status, added: d.created_at, from: d.from });
  const nav = docNav(docs.map(facts), t, now);
  const inbox = nav.find((e) => e.id === "inbox")?.n ?? 0;

  const words = wordsOf(q);
  let matches = null;
  if (words.length) matches = new Set((await z.call("sql.query", { sql: `select id from documents where ${matchWhere(words)}`, params: words, limit: 2000 })).rows.map((r) => r.id));
  const w = q.toLowerCase();
  const hay = (d) => [d.name, d.from, d.concepts].join(" ").toLowerCase();
  const cmp = {
    newest: (a, b) => b.created_at.localeCompare(a.created_at),
    oldest: (a, b) => a.created_at.localeCompare(b.created_at),
    name: (a, b) => a.name.localeCompare(b.name),
    size: (a, b) => b.size - a.size,
    unread: (a, b) => Number(b.unread) - Number(a.unread) || b.created_at.localeCompare(a.created_at),
  }[sort];
  const shown = docs.filter((d) => inScope(facts(d), scope, now) && (!w || hay(d).includes(w) || (matches && matches.has(d.id)))).sort(cmp);

  const checked = new Set((String(event?.checked ?? "").match(/\d+/g) ?? []).map(Number));
  const today = new Date(now).toISOString().slice(0, 10);
  const lang = context.language || "en";
  const kb = (bytes) => Math.max(1, Math.round(bytes / 1024));
  const sizeText = (bytes) => (kb(bytes) >= 1024 ? `${Math.round((kb(bytes) / 1024) * 10) / 10} MB` : `${kb(bytes)} KB`);
  const kindInfo = (k) => DOC_KINDS_NAV[k] ?? DOC_KINDS_NAV.other;
  const item = (d) => {
    const day = d.created_at.slice(0, 10) === today ? d.created_at.slice(11, 16) : new Date(d.created_at).toLocaleDateString(lang);
    return {
      id: d.id,
      fileUrl: `/api/files/kept?dir=documents&file=${encodeURIComponent(d.file)}&name=${encodeURIComponent(d.name)}`,
      title: d.name,
      icon: kindInfo(d.kind).icon,
      kind: d.kind,
      kindLabel: t(kindInfo(d.kind).label),
      ending: EXT(d.name),
      tip: String(d.summary || d.head || "").replace(/\s+/g, " ").trim().slice(0, 300),
      held: d.held,
      localShown: local.get(d.id)?.shown ?? "",
      localMissing: !!local.get(d.id)?.missing,
      isImage: d.kind === "image",
      isPdf: d.kind === "pdf",
      isAudio: d.kind === "audio",
      status: d.status,
      statusLabel: d.status === "failed" ? t("failed") : d.status === "queued" || d.status === "extracting" ? t("reading …") : d.status === "unsupported" ? t("not readable") : d.compiled ? t("compiled") : "",
      unread: d.unread,
      compiled: d.compiled,
      from: d.from.length > 40 ? `${d.from.slice(0, 39)}…` : d.from,
      fromFull: d.from,
      sizeText: sizeText(d.size),
      day,
    };
  };
  const pickedDoc = shown.find((d) => String(d.id) === String(event?.selected ?? ""));
  const picked = pickedDoc
    ? {
        ...item(pickedDoc),
        added: Number.isNaN(Date.parse(pickedDoc.created_at)) ? "" : new Date(pickedDoc.created_at).toLocaleString(lang),
        stateText: pickedDoc.status === "ready" ? (pickedDoc.compiled ? t("Read and compiled") : t("Read")) : t(pickedDoc.status),
        error: pickedDoc.error,
        concepts: pickedDoc.concepts.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12),
      }
    : null;
  return {
    scope,
    scopeOptions: nav.map((e) => `${tab(e.id)}:${label(`${e.icon} ${e.label}${e.n > 0 ? ` ${e.n}` : ""}`)}`).join(", "),
    count: shown.length,
    items: shown.slice(0, limit).map(item),
    hasMore: shown.length > limit,
    nextLimit: limit + PAGE,
    unreadIds: shown.filter((d) => d.unread).map((d) => d.id),
    // (only the ticks of what is shown count: those of another scope neither show nor act)
    checkedCount: shown.filter((d) => checked.has(d.id)).length,
    checkedIds: shown.filter((d) => checked.has(d.id)).map((d) => d.id),
    markAll: scope === "inbox" && inbox > 0,
    emptyIcon: scope === "inbox" ? "🎉" : "🗂️",
    emptyText: scope === "inbox" ? t("Nothing new — everything is read.") : w ? t("Nothing matches.") : t("No documents here yet."),
    picked,
    reading,
    heldCount: docs.filter((d) => d.held).length,
    heldIds: docs.filter((d) => d.held).map((d) => d.id),
  };
}
