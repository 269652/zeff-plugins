import { hash } from "./hash.mjs";
import { notion, plain, titleOf, iconOf, coverOf, parentOf } from "./notion.mjs";
import { unitsFromBlocks, docFromFlat } from "./convert.mjs";
import { fieldOf, valueIn } from "./props.mjs";
import { linksOf, stateOf, json } from "./store.mjs";

/**
 * What changed in Notion, as a plan the flow notion.pull carries out (it writes; this only reads): pages, databases and rows made or
 * changed in Notion since the last run — each converted into Zeff's terms, parents before their children —, and the ones moved to
 * Notion's trash. A run that runs out of time gives what it has (`more`): the next one goes on from there.
 *
 * Notion keeps when a page was edited to the minute: a page edited in the minute of the last sync is read again until that minute is
 * over (and compared by its content, so nothing is written twice).
 * @param {{}} event
 * @param {LambdaContext} context
 */
export async function handler(event, context) {
  const token = context.secrets.NOTION_TOKEN ?? "";
  if (!token) return { ops: [], cursor: "", more: false, message: "Notion: no token yet — set it in the Notion plugin's settings." };
  const api = notion(token, { remainingMs: () => context.remainingMs(), reserve: 12_000, log: context.log });
  const { byNotion, zeffOf } = await linksOf(context.zeff);
  const st = await stateOf(context.zeff);
  const now = Date.now();
  const since = st.cursor ? Date.parse(st.cursor) - 120_000 : 0;
  const ops = [];
  let more = false;
  let newest = st.cursor ?? "";

  // 1. What Notion has that was edited since the last run (newest first, read until older) — everything the first time.
  const found = new Map();
  try {
    let cursor = null;
    let done = false;
    do {
      const d = await api.req("POST", "/search", { sort: { direction: "descending", timestamp: "last_edited_time" }, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      for (const r of d.results ?? []) {
        if (since && Date.parse(r.last_edited_time) < since) {
          done = true;
          break;
        }
        if (r.archived || r.in_trash) continue;
        found.set(plain(r.id), r);
        if (r.last_edited_time > newest) newest = r.last_edited_time;
      }
      cursor = !done && d.has_more ? d.next_cursor : null;
    } while (cursor);
  } catch (e) {
    if (!e.outOfTime) throw e;
    return { ops: [], cursor: st.cursor ?? "", more: true, message: "Notion: the list of changes took too long — going on next time." };
  }

  // 2. What needs work: new, changed, edited in the minute of its last sync, or waiting for a page it points at.
  const needs = (r) => {
    const l = byNotion.get(plain(r.id));
    if (!l) return true;
    if (Number(l.pending)) return true;
    if (r.last_edited_time > (l.edited ?? "")) return true;
    return Date.parse(r.last_edited_time) + 60_000 > Date.parse(l.synced_at || 0);
  };
  const todo = [...found.values()].filter(needs);
  // (Links still waiting for others — read again even if Notion didn't change them.)
  for (const l of byNotion.values()) {
    if (!Number(l.pending) || found.has(l.notion_id)) continue;
    try {
      const r = await api.req("GET", l.kind === "database" ? `/databases/${l.notion_id}` : `/pages/${l.notion_id}`);
      if (!r.archived && !r.in_trash) todo.push(r);
    } catch (e) {
      if (e.outOfTime) break;
    }
  }

  // 3. Parents before children: a parent being made in this run comes first. A page inside a block (a column, a toggle) has that block's page.
  const blockPage = new Map();
  async function pageOfBlock(id, hops = 0) {
    if (blockPage.has(id)) return blockPage.get(id);
    let out = { kind: "workspace", id: "" };
    try {
      const b = await api.req("GET", `/blocks/${id}`);
      const p = parentOf(b);
      out = p.kind === "block" && hops < 10 ? await pageOfBlock(p.id, hops + 1) : p;
    } catch (e) {
      if (e.outOfTime) throw e;
    }
    blockPage.set(id, out);
    return out;
  }
  const items = [];
  try {
    for (const r of todo) {
      let p = parentOf(r);
      if (p.kind === "block") p = await pageOfBlock(p.id);
      items.push({ r, id: plain(r.id), parent: p });
    }
  } catch (e) {
    if (!e.outOfTime) throw e;
    more = true;
  }
  const inRun = new Set(items.map((x) => x.id));
  const depth = new Map();
  const depthOf = (x, seen = new Set()) => {
    if (depth.has(x.id)) return depth.get(x.id);
    if (seen.has(x.id)) return 0;
    seen.add(x.id);
    const parent = items.find((y) => y.id === x.parent.id);
    const d = parent && inRun.has(parent.id) ? depthOf(parent, seen) + 1 : 0;
    depth.set(x.id, d);
    return d;
  };
  items.sort((a, b) => depthOf(a) - depthOf(b) || (a.r.object === "database" ? -1 : 0) - (b.r.object === "database" ? -1 : 0));

  // 4. Each converted. A parent Zeff doesn't have and that isn't made in this run: the page goes at the top of the Notion page in Zeff.
  const known = (id) => byNotion.has(id) || inRun.has(id);
  for (const x of items) {
    try {
      const op = x.r.object === "database" ? database(x, byNotion, zeffOf, known) : await page(api, x, byNotion, zeffOf, known);
      if (op) ops.push(op);
    } catch (e) {
      if (e.outOfTime) {
        more = true;
        break;
      }
      context.log(`${x.id}: ${e.message}`);
      if (e.status === 404) continue;
      throw e;
    }
  }

  // 5. Now and then (every 10 minutes, a few each time): the synced ones Notion moved to its trash — into Zeff's trash with them.
  if (!more && now - Date.parse(st.checked_at || 0) > 10 * 60_000) {
    const old = [...byNotion.values()].filter((l) => !found.has(l.notion_id)).sort((a, b) => String(a.checked ?? "").localeCompare(String(b.checked ?? ""))).slice(0, 25);
    try {
      for (const l of old) {
        let gone = false;
        let unshared = false;
        try {
          const r = await api.req("GET", l.kind === "database" ? `/databases/${l.notion_id}` : `/pages/${l.notion_id}`);
          gone = !!(r.archived || r.in_trash);
        } catch (e) {
          if (e.outOfTime) throw e;
          unshared = e.status === 404;
        }
        if (gone) ops.push({ op: "archive", notion: l.notion_id, zeff: Number(l.zeff_id) });
        // (No longer shared with the integration: Zeff keeps its page, the sync lets it go.)
        else if (unshared) ops.push({ op: "unlink", notion: l.notion_id });
        else ops.push({ op: "link", notion: l.notion_id, rows: [{ notion_id: l.notion_id, checked: new Date().toISOString() }] });
      }
    } catch (e) {
      if (!e.outOfTime) throw e;
    }
  }
  const counts = ops.reduce((m, o) => ((m[o.op] = (m[o.op] ?? 0) + 1), m), {});
  const said = [
    counts["page.create"] && `${counts["page.create"]} new pages`,
    counts["row.create"] && `${counts["row.create"]} new rows`,
    counts["database.create"] && `${counts["database.create"]} new databases`,
    (counts["page.update"] ?? 0) + (counts["row.update"] ?? 0) + (counts["database.update"] ?? 0) && `${(counts["page.update"] ?? 0) + (counts["row.update"] ?? 0) + (counts["database.update"] ?? 0)} changed`,
    counts.archive && `${counts.archive} to the trash`,
  ].filter(Boolean);
  return {
    ops,
    cursor: more ? (st.cursor ?? "") : newest,
    more,
    checked: !more && now - Date.parse(st.checked_at || 0) > 10 * 60_000,
    message: `${said.length ? said.join(", ") : "Nothing new"}${more ? " — more next time" : ""}.`,
  };
}

/** Where its parent is in Zeff terms: a Notion id the flow looks up (made before in this run or earlier), or none (the top). */
const parentRef = (x, known) => (x.parent.kind !== "workspace" && known(x.parent.id) ? x.parent.id : null);

/** A database: made, or its new fields added and its title / icon followed. */
function database(x, byNotion, zeffOf, known) {
  const r = x.r;
  const title = titleOf(r) || "Untitled";
  const icon = iconOf(r.icon);
  const props = Object.entries(r.properties ?? {});
  const titleName = props.find(([, p]) => p.type === "title")?.[0] ?? "Name";
  let unresolved = false;
  const fields = [];
  const map = {};
  for (const [name, p] of props) {
    map[name] = p.type;
    if (p.type === "title") continue;
    const f = fieldOf(name, p, zeffOf);
    if (f) fields.push(f);
    else if (p.type === "relation") unresolved = true; // (its database isn't in Zeff yet: added once it is)
  }
  const l = byNotion.get(x.id);
  const nhash = hash({ title, icon, titleName, fields });
  const link = { kind: "database", parent: x.parent.id || "", edited: r.last_edited_time, nhash, props: JSON.stringify(map), pending: unresolved ? 1 : 0, title, synced_at: new Date().toISOString() };
  if (!l) return { op: "database.create", notion: x.id, parentNotion: parentRef(x, known), title, icon, titleName, properties: fields, rows: [{ notion_id: x.id, ...link }] };
  if (l.nhash === nhash) return { op: "link", notion: x.id, rows: [{ notion_id: x.id, edited: r.last_edited_time, synced_at: link.synced_at, pending: link.pending }] };
  const had = json(l.props, {});
  const add = fields.filter((f) => !(f.name in had) || (had[f.name] === "relation" && Number(l.pending))).map((f) => ({ op: "add_property", ...f }));
  return { op: "database.update", notion: x.id, zeff: Number(l.zeff_id), title, icon, alter: add, rows: [{ notion_id: x.id, ...link }] };
}

/** A page or a database's row: its text (and a row's values) converted; made, or merged with Zeff's by the flow. */
async function page(api, x, byNotion, zeffOf, known) {
  const r = x.r;
  const isRow = x.parent.kind === "database";
  if (isRow && !known(x.parent.id)) return null; // (a row of a database not shared with the integration)
  const blocks = await api.tree(r.id);
  const ctx = { zeffOf, unresolved: false, pictures: false };
  const units = unitsFromBlocks(blocks, ctx);
  const flat = units.flatMap((u) => u.flat);
  const title = titleOf(r) || (isRow ? "" : "Untitled");
  const icon = iconOf(r.icon);
  const cover = coverOf(r.cover);
  let values;
  if (isRow) {
    const un = { value: false };
    values = {};
    for (const [name, p] of Object.entries(r.properties ?? {})) {
      if (p.type === "title") continue;
      const v = valueIn(p, zeffOf, un);
      if (v !== undefined) values[name] = v;
    }
    if (un.value) ctx.unresolved = true;
  }
  const l = byNotion.get(x.id);
  // (A cover Notion keeps changes its address every hour: compared by Notion's id of it, not its address.)
  const coverKey = r.cover?.type === "file" ? "notion-file" : cover;
  const nhash = hash({ title, icon, cover: coverKey, values: values ?? null, keys: units.map((u) => u.key) });
  const snap = JSON.stringify(units.map((u) => ({ id: u.id, key: u.key, n: u.n, type: u.type, ...(blocks.find((b) => plain(b.id) === u.id)?.has_children ? { c: 1 } : {}) })));
  const base = units.filter((u) => u.n > 0).map((u) => ({ key: u.key, n: u.n }));
  const link = { kind: isRow ? "row" : "page", parent: x.parent.id || "", edited: r.last_edited_time, nhash, snap, base: JSON.stringify(base), pending: ctx.unresolved ? 1 : 0, title, icon, synced_at: new Date().toISOString() };
  if (l && l.nhash === nhash) return { op: "link", notion: x.id, rows: [{ notion_id: x.id, edited: r.last_edited_time, synced_at: link.synced_at, pending: link.pending }] };
  const common = { notion: x.id, title, icon, cover, pictures: ctx.pictures || r.cover?.type === "file", rows: [{ notion_id: x.id, ...link }] };
  if (!l) {
    const doc = docFromFlat(flat);
    return isRow ? { op: "row.create", ...common, database: x.parent.id, values, doc, empty: !flat.length } : { op: "page.create", ...common, parentNotion: parentRef(x, known), doc };
  }
  const theirs = units.filter((u) => u.n > 0).map((u) => ({ key: u.key, n: u.n, flat: u.flat }));
  return { op: isRow ? "row.update" : "page.update", ...common, zeff: Number(l.zeff_id), values, theirs, base: json(l.base, []), contentChanged: json(l.snap, []).map((e) => e.key).join() !== units.map((u) => u.key).join() };
}

