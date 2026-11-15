// Notion's API: requests with the integration's token, at most about three a second (Notion's limit), what it refuses for a moment (429,
// 5xx) tried again after the wait it asks for, lists read to their end. (Copied into each lambda as notion.mjs: scripts/copy-lib.mjs.)

const API = "https://api.notion.com/v1";
export const NOTION_VERSION = "2022-06-28";
/** The hosts Notion keeps its files on (pictures, covers) — their links expire after an hour. */
export const FILE_HOSTS = ["prod-files-secure.s3.us-west-2.amazonaws.com", "s3.us-west-2.amazonaws.com", "file.notion.so"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** An id without dashes, lower case — how ids are kept and compared. */
export const plain = (id) => String(id ?? "").replace(/-/g, "").toLowerCase();
/** The id in a Notion link or an id written with dashes ("https://www.notion.so/Plan-1a2b…", "1a2b…-…"); "" when there is none. */
export function notionId(s) {
  const m = /([0-9a-f]{32})(?=$|[?#/])/i.exec(String(s ?? "").replace(/-/g, "").trim());
  return m ? m[1].toLowerCase() : "";
}
/** A page's (or block's) address in Notion. */
export const notionUrl = (id) => `https://www.notion.so/${plain(id)}`;

/** Thrown when the lambda's time runs out: what was done so far is kept, the rest the next time. */
export class OutOfTime extends Error {
  constructor() {
    super("out of time");
    this.outOfTime = true;
  }
}

/**
 * A client: `req(method, path, body)` and helpers. `remainingMs` is the lambda's (context.remainingMs): a request isn't started with
 * less than `reserve` ms left — OutOfTime instead.
 */
export function notion(token, { remainingMs = () => 60_000, reserve = 6_000, log = () => {} } = {}) {
  if (!token) throw new Error("Notion: no token yet — add your integration's secret in the Notion plugin's settings (Menu → Plugins → Notion).");
  let next = 0;
  let calls = 0;
  async function req(method, path, body, attempt = 0) {
    if (remainingMs() < reserve) throw new OutOfTime();
    const wait = next - Date.now();
    if (wait > 0) await sleep(wait);
    next = Date.now() + 340;
    calls++;
    let r;
    try {
      r = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      if (attempt < 3) {
        await sleep(800 * (attempt + 1));
        return req(method, path, body, attempt + 1);
      }
      throw new Error("Notion: not reachable");
    }
    if ((r.status === 429 || r.status >= 500) && attempt < 4) {
      const after = Number(r.headers.get("retry-after"));
      const ms = Math.min(20_000, (Number.isFinite(after) && after > 0 ? after : attempt + 1) * 1000);
      log(`Notion asks to wait ${Math.round(ms / 1000)} s (${r.status})`);
      if (remainingMs() - ms < reserve) throw new OutOfTime();
      await sleep(ms);
      return req(method, path, body, attempt + 1);
    }
    let data = null;
    try {
      data = await r.json();
    } catch {
      data = null;
    }
    if (!r.ok) {
      const err = new Error(`Notion: ${data?.message ?? `${r.status} ${r.statusText}`}`);
      err.status = r.status;
      err.code = data?.code;
      throw err;
    }
    return data;
  }

  /** Every result of a list (GET: ?start_cursor=…; POST: { start_cursor }). */
  async function all(method, path, body = {}) {
    const out = [];
    let cursor = null;
    do {
      const sep = path.includes("?") ? "&" : "?";
      const d =
        method === "GET"
          ? await req("GET", `${path}${sep}page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`)
          : await req(method, path, { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      out.push(...(d?.results ?? []));
      cursor = d?.has_more ? d.next_cursor : null;
    } while (cursor);
    return out;
  }

  /** A block's children, theirs below them (not into sub-pages and databases: those are pages of their own). */
  async function tree(id, depth = 0) {
    const kids = await all("GET", `/blocks/${id}/children`);
    if (depth < 12) {
      for (const b of kids) if (b.has_children && b.type !== "child_page" && b.type !== "child_database") b.children = await tree(b.id, depth + 1);
    }
    return kids;
  }

  return {
    req,
    all,
    tree,
    get calls() {
      return calls;
    },
  };
}

/** The title of a page or database as plain text. */
export function titleOf(o) {
  if (o?.object === "database") return (o.title ?? []).map((r) => r.plain_text ?? "").join("");
  for (const p of Object.values(o?.properties ?? {})) if (p?.type === "title") return (p.title ?? []).map((r) => r.plain_text ?? "").join("");
  return "";
}

/** An icon as Zeff keeps one (an emoji); a picture or a Notion icon: none. */
export const iconOf = (icon) => (icon?.type === "emoji" ? String(icon.emoji ?? "").slice(0, 16) : "");

/** A cover's address (a Notion-kept one expires: the flow keeps a copy). */
export const coverOf = (cover) => (cover?.type === "external" ? (cover.external?.url ?? "") : cover?.type === "file" ? (cover.file?.url ?? "") : "");

/** Where a page or database is: its parent's id and kind ("page" | "database" | "block" | "workspace"). */
export function parentOf(o) {
  const p = o?.parent ?? {};
  if (p.type === "page_id") return { kind: "page", id: plain(p.page_id) };
  if (p.type === "database_id") return { kind: "database", id: plain(p.database_id) };
  if (p.type === "data_source_id") return { kind: "database", id: plain(p.database_id ?? p.data_source_id) };
  if (p.type === "block_id") return { kind: "block", id: plain(p.block_id) };
  return { kind: "workspace", id: "" };
}
