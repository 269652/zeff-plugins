import { hash } from "./hash.mjs";
import { notion, NOTION_VERSION, notionId, plain } from "./notion.mjs";
import { ANCHORS, blockOf, bodyOf, flatOfDoc, lcs, richFromInline, unitsOfFlat } from "./convert.mjs";
import { propertyOf, READ_ONLY, valueOut } from "./props.mjs";
import { linksOf, json } from "./store.mjs";

/**
 * A Zeff page changed (made, its text, title, icon, cover or a row's field changed, moved to the trash) — Notion follows: the flow
 * notion.push hands the page as Zeff has it (page.read) and, for a database or a row, the database's fields (schema). What only Zeff can
 * show (a widget, a code cell) stays in Zeff; only blocks that differ are written, a changed one in place where it can be (its comments
 * stay). Gives the link to keep (the flow writes it).
 * @param {{ page: object, schema?: object, root?: number, event?: string, field?: string }} event
 * @param {LambdaContext} context
 */
export async function handler(event, context) {
  const token = context.secrets.NOTION_TOKEN ?? "";
  if (!token) return { put: [], remove: [], message: "Notion: no token yet." };
  const p = event.page;
  if (!p || !p.id) return { put: [], remove: [], message: "No page." };
  const api = notion(token, { remainingMs: () => context.remainingMs(), reserve: 5_000, log: context.log });
  const L = await linksOf(context.zeff);
  const link = L.byZeff.get(Number(p.id));

  // Moved to Zeff's trash: to Notion's.
  if (p.archived || event.event === "page.removed") {
    if (!link) return { put: [], remove: [], message: "Not synced with Notion." };
    try {
      await api.req("PATCH", link.kind === "database" ? `/databases/${link.notion_id}` : `/pages/${link.notion_id}`, { archived: true });
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    return { put: [], remove: [link.notion_id], message: "Moved to Notion's trash." };
  }

  const ctx = { zeffOf: L.zeffOf, notionOf: L.notionOf, childOf: (id) => !!link && L.byNotion.get(id)?.parent === link.notion_id };
  const up = { api, token, zeff: context.zeff };
  const now = () => new Date().toISOString();

  // Not synced yet: made in Notion when where it is is synced (a page under a synced page, a row of a synced database, a page at the top
  // of the Notion page in Zeff when you named a page in Notion for those).
  if (!link) {
    const isRow = !!p.database;
    let parent = null;
    if (isRow) parent = L.notionOf(p.database);
    else if (event.root && Number(p.parent) === Number(event.root)) parent = notionId(context.secrets.NOTION_PARENT ?? "") || null;
    else parent = L.notionOf(p.parent);
    if (!parent) return { put: [], remove: [], message: isRow ? "Its database isn't synced with Notion." : "Not under a page synced with Notion." };
    if (isRow && L.byNotion.get(parent)?.kind !== "database") return { put: [], remove: [], message: "Its database isn't synced with Notion." };
    if (!isRow && L.byNotion.get(parent)?.kind === "database") return { put: [], remove: [], message: "A page inside a database's page isn't synced." };

    if (p.kind === "database") {
      const s = event.schema ?? { titleName: "Name", properties: [] };
      const map = { [s.titleName || "Name"]: "title" };
      const properties = { [s.titleName || "Name"]: { title: {} } };
      for (const f of s.properties ?? []) {
        const def = propertyOf(f, L.notionOf);
        if (!def) continue;
        properties[f.name] = def;
        map[f.name] = Object.keys(def)[0];
      }
      const d = await api.req("POST", "/databases", { parent: { type: "page_id", page_id: parent }, title: [{ type: "text", text: { content: p.title || "Untitled" } }], ...(p.icon ? { icon: { type: "emoji", emoji: p.icon } } : {}), properties });
      return { put: [{ notion_id: plain(d.id), kind: "database", zeff_id: p.id, parent, props: JSON.stringify(map), title: p.title, icon: p.icon ?? "", edited: d.last_edited_time, nhash: "", pending: 0, synced_at: now() }], remove: [], message: "Made in Notion." };
    }
    if (p.kind !== "page") return { put: [], remove: [], message: `A ${p.kind} isn't synced with Notion.` };
    const dbLink = isRow ? L.byNotion.get(parent) : null;
    const props = isRow ? rowProperties(p, event.schema, json(dbLink.props, {}), L.notionOf) : { title: { title: richFromInline(text(p.title), ctx) } };
    const made = await api.req("POST", "/pages", {
      parent: isRow ? { database_id: parent } : { page_id: parent },
      properties: props,
      ...(p.icon ? { icon: { type: "emoji", emoji: p.icon } } : {}),
      ...(/^https?:\/\//.test(p.cover ?? "") ? { cover: { type: "external", external: { url: p.cover } } } : {}),
    });
    const id = plain(made.id);
    const content = await applyContent(up, id, p.doc, { snap: "[]", base: "[]" }, { ...ctx, childOf: (x) => L.byNotion.get(x)?.parent === id });
    const after = await api.req("GET", `/pages/${id}`);
    return {
      put: [{ notion_id: id, kind: isRow ? "row" : "page", zeff_id: p.id, parent, snap: JSON.stringify(content.snap), base: JSON.stringify(content.base), title: p.title, icon: p.icon ?? "", cover: p.cover ?? "", vhash: isRow ? hash(props) : "", edited: after.last_edited_time, nhash: "", pending: 0, synced_at: now() }],
      remove: [],
      message: "Made in Notion.",
    };
  }

  // Synced: what changed follows.
  const set = { synced_at: now() };
  if (link.kind === "database") {
    const s = event.schema ?? { properties: [] };
    const had = json(link.props, {});
    const patch = {};
    if ((p.title ?? "") !== (link.title ?? "")) patch.title = [{ type: "text", text: { content: p.title || "Untitled" } }];
    if ((p.icon ?? "") !== (link.icon ?? "")) patch.icon = p.icon ? { type: "emoji", emoji: p.icon } : null;
    const add = {};
    for (const f of s.properties ?? []) {
      if (f.name in had) continue;
      const def = propertyOf(f, L.notionOf);
      if (!def) continue;
      add[f.name] = def;
      had[f.name] = Object.keys(def)[0];
    }
    if (Object.keys(add).length) patch.properties = add;
    if (!Object.keys(patch).length) return { put: [], remove: [], message: "Nothing to change in Notion." };
    const d = await api.req("PATCH", `/databases/${link.notion_id}`, patch);
    return { put: [{ notion_id: link.notion_id, ...set, title: p.title, icon: p.icon ?? "", props: JSON.stringify(had), edited: d.last_edited_time }], remove: [], message: "Changed in Notion." };
  }

  const isRow = link.kind === "row";
  const patch = {};
  if (isRow) {
    const dbLink = L.byNotion.get(link.parent);
    const props = rowProperties(p, event.schema, json(dbLink?.props, {}), L.notionOf);
    const vhash = hash(props);
    if (vhash !== link.vhash) {
      patch.properties = props;
      set.vhash = vhash;
    }
  } else if ((p.title ?? "") !== (link.title ?? "")) patch.properties = { title: { title: richFromInline(text(p.title), ctx) } };
  if ((p.icon ?? "") !== (link.icon ?? "")) patch.icon = p.icon ? { type: "emoji", emoji: p.icon } : null;
  if ((p.cover ?? "") !== (link.cover ?? "") && (/^https?:\/\//.test(p.cover ?? "") || !p.cover)) patch.cover = p.cover ? { type: "external", external: { url: p.cover } } : null;
  if (Object.keys(patch).length) await api.req("PATCH", `/pages/${link.notion_id}`, patch);
  set.title = p.title;
  set.icon = p.icon ?? "";
  set.cover = p.cover ?? "";
  // (A field or the title changed: the text is as it was.)
  const textToo = !event.field || event.field === "content" || event.event === "page.added";
  if (textToo) {
    const content = await applyContent(up, link.notion_id, p.doc, link, ctx);
    set.snap = JSON.stringify(content.snap);
    set.base = JSON.stringify(content.base);
    if (!content.wrote && !Object.keys(patch).length) return { put: [{ notion_id: link.notion_id, ...set }], remove: [], message: "Nothing to change in Notion." };
  } else if (!Object.keys(patch).length) return { put: [], remove: [], message: "Nothing to change in Notion." };
  const after = await api.req("GET", `/pages/${link.notion_id}`);
  return { put: [{ notion_id: link.notion_id, ...set, edited: after.last_edited_time, nhash: "" }], remove: [], message: "Changed in Notion." };
}

const text = (s) => (s ? [{ type: "text", text: s }] : []);

/** A row's values as Notion's properties: its title, and each field Notion has and may be written (not formulas, rollups …). */
function rowProperties(p, schema, map, notionOf) {
  const titleName = Object.entries(map).find(([, t]) => t === "title")?.[0] ?? "Name";
  const out = { [titleName]: { title: p.title ? [{ type: "text", text: { content: String(p.title).slice(0, 2000) } }] : [] } };
  for (const f of schema?.properties ?? []) {
    const type = map[f.name];
    if (!type || type === "title" || READ_ONLY.has(type)) continue;
    const v = valueOut(type, p.values?.[f.id], f, notionOf);
    if (v !== undefined) out[f.name] = v;
  }
  return out;
}

const isAnchor = (e) => ANCHORS.has(e.type) || !(e.n > 0);
const hasKids = (b) => !!b?.[b.type]?.children?.length;
const emptyPara = (b) => b?.type === "paragraph" && !b.paragraph.rich_text.length;

/**
 * The page's text in Notion brought to what Zeff has: its blocks (kept with their keys at the last sync) against the Zeff page's units —
 * the same stay, a changed one of the same kind is updated in place, the rest added and removed. Sub-pages are never removed (that
 * would move them to Notion's trash). Gives the blocks Notion has now (snap) and the Zeff page's units (base).
 */
async function applyContent(up, pageId, doc, link, ctx) {
  const { api } = up;
  const snap = json(link.snap, []);
  const hints = [...snap.filter((e) => e.n > 1), ...json(link.base, [])];
  const units = unitsOfFlat(flatOfDoc(doc ?? { content: [] }), hints);
  const S = snap.filter((e) => !isAnchor(e));
  const sKeys = new Set(S.map((e) => e.key));
  const anchorIds = new Set(snap.filter(isAnchor).map((e) => e.id));
  const D = [];
  // (What Notion has after this — the base of the next merge: not what only Zeff shows, which Notion never had.)
  const base = [];
  for (const u of units) {
    const node = u.n === 1 ? u.flat[0].node : null;
    // A sub-page shown on its page: Notion keeps it where it is — a place to add after, nothing to write.
    if (node && (node.type === "pageEmbed" || node.type === "databaseView")) {
      const target = ctx.notionOf(Number(node.attrs?.pageId ?? node.attrs?.dbId));
      if (target && anchorIds.has(target)) {
        D.push({ key: u.key, n: u.n, anchor: target });
        base.push({ key: u.key, n: u.n });
        continue;
      }
    }
    const block = u.n === 1 ? blockOf(u.flat[0], ctx) : null;
    if (block || sKeys.has(u.key)) {
      D.push({ key: u.key, n: u.n, block });
      base.push({ key: u.key, n: u.n });
    }
  }
  // (The editor's empty last line isn't written to Notion.)
  while (D.length && emptyPara(D[D.length - 1].block) && !sKeys.has(D[D.length - 1].key)) (D.pop(), base.pop());

  const mS = new Map();
  const mD = new Map();
  const dIdx = D.map((d, j) => j).filter((j) => !D[j].anchor);
  for (const [i, k] of lcs(S.map((e) => e.key), dIdx.map((j) => D[j].key))) (mS.set(i, dIdx[k]), mD.set(dIdx[k], i));
  const del = new Set(S.filter((_, i) => !mS.has(i)).map((e) => e.id));
  const known = new Set(snap.map((e) => e.id));
  let prev = null;
  let wrote = false;
  // Something new before everything: Notion adds only after a block — after the first one, which then goes and comes again after it.
  const moved = new Set();
  if (D.length && !mD.has(0) && !D[0].anchor && snap.length) {
    let lead = 0;
    while (lead < snap.length && isAnchor(snap[lead])) lead++;
    if (lead > 0) prev = snap[lead - 1].id;
    else {
      const i0 = S.indexOf(snap[0]);
      if (mS.has(i0)) {
        mD.delete(mS.get(i0));
        mS.delete(i0);
        del.add(S[i0].id);
      }
      moved.add(S[i0].id);
      prev = S[i0].id;
    }
  }
  const out = [];
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const ids = await appendTree(up, pageId, batch.map((b) => b.block), prev, known);
    batch.forEach((b, k) => out.push({ id: ids[k], key: b.key, n: b.n, type: b.block.type, ...(hasKids(b.block) ? { c: 1 } : {}) }));
    prev = ids[ids.length - 1] ?? prev;
    batch = [];
    wrote = true;
  };
  let lastI = -1;
  let gap = null;
  let gapPos = 0;
  for (let j = 0; j < D.length; j++) {
    const d = D[j];
    if (d.anchor) {
      await flush();
      prev = d.anchor;
      continue;
    }
    if (mD.has(j)) {
      await flush();
      const i = mD.get(j);
      out.push(S[i]);
      prev = S[i].id;
      lastI = i;
      gap = null;
      continue;
    }
    if (!d.block) continue;
    if (!gap) {
      const next = [...mS.keys()].filter((i) => i > lastI).sort((a, b) => a - b)[0] ?? S.length;
      gap = S.slice(lastI + 1, next).filter((e) => del.has(e.id));
      gapPos = 0;
    }
    // (A block that went in this gap and is of the same kind — changed in place: its id and comments stay.)
    const k = d.block.upload || hasKids(d.block) ? -1 : gap.findIndex((x, n) => n >= gapPos && !moved.has(x.id) && del.has(x.id) && x.type === d.block.type && !x.c);
    const s = k >= 0 ? gap[k] : null;
    if (s) gapPos = k + 1;
    if (s) {
      await flush();
      await api.req("PATCH", `/blocks/${s.id}`, { [d.block.type]: bodyOf(d.block) });
      del.delete(s.id);
      out.push({ id: s.id, key: d.key, n: d.n, type: s.type });
      prev = s.id;
      wrote = true;
      continue;
    }
    batch.push(d);
  }
  await flush();
  for (const id of del) {
    try {
      await api.req("DELETE", `/blocks/${id}`);
      wrote = true;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }
  // The sub-pages where they were: after the block before them that is still there.
  const result = [...out];
  snap.forEach((e, i) => {
    if (!isAnchor(e)) return;
    let at = 0;
    for (let k = i - 1; k >= 0; k--) {
      const pos = result.findIndex((x) => x.id === snap[k].id);
      if (pos >= 0) {
        at = pos + 1;
        break;
      }
    }
    result.splice(at, 0, e);
  });
  return { snap: result, base, wrote };
}

/** Blocks with what Notion takes in one request (two levels); what is deeper is added below them afterwards. */
function cut(block, level = 0, path = [], deferred = []) {
  const kids = block[block.type]?.children;
  if (!kids?.length) return block;
  if (level >= 2) {
    deferred.push({ path, blocks: kids });
    const { children, ...rest } = block[block.type];
    return { ...block, [block.type]: rest };
  }
  return { ...block, [block.type]: { ...block[block.type], children: kids.map((c, i) => cut(c, level + 1, [...path, i], deferred)) } };
}

/** Blocks added to a parent after a block (null: at its end) — pictures uploaded first, deeper levels after; the new blocks' ids. */
async function appendTree(up, parentId, blocks, after, known) {
  const { api } = up;
  const ids = [];
  for (let i = 0; i < blocks.length; i += 100) {
    const batch = blocks.slice(i, i + 100);
    for (const b of batch) await uploads(up, b);
    const deferred = batch.map(() => []);
    const ready = batch.map((b, k) => cut(b, 1, [], deferred[k]));
    const r = await api.req("PATCH", `/blocks/${parentId}/children`, { children: ready, ...(after ? { after } : {}) });
    const fresh = (r.results ?? []).map((x) => plain(x.id)).filter((x) => !known.has(x));
    fresh.forEach((x) => known.add(x));
    const made = fresh.slice(0, batch.length);
    ids.push(...made);
    for (let k = 0; k < batch.length; k++) {
      for (const d of deferred[k]) {
        // (The block at that place below the new one: found by its position.)
        let at = made[k];
        for (const idx of d.path) {
          const kids = await api.all("GET", `/blocks/${at}/children`);
          at = kids[idx] ? plain(kids[idx].id) : null;
          if (!at) break;
        }
        if (at) await appendTree(up, at, d.blocks, null, known);
      }
    }
    after = ids[ids.length - 1] ?? after;
  }
  return ids;
}

/** Pictures uploaded to Zeff, uploaded to Notion (its file uploads), the block pointing at them — in the block and below it. */
async function uploads(up, b) {
  if (b.upload) {
    const src = b.upload;
    delete b.upload;
    const id = await uploadPicture(up, src);
    b.image = { type: "file_upload", file_upload: { id }, caption: b.image?.caption ?? [] };
  }
  for (const c of b[b.type]?.children ?? []) await uploads(up, c);
}

async function uploadPicture({ api, token, zeff }, src) {
  const f = await zeff.call("files.read", { src });
  const u = await api.req("POST", "/file_uploads", { filename: f.name, content_type: f.mime });
  const form = new FormData();
  form.append("file", new Blob([Buffer.from(f.base64, "base64")], { type: f.mime }), f.name);
  const r = await fetch(u.upload_url ?? `https://api.notion.com/v1/file_uploads/${u.id}/send`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION }, body: form });
  if (!r.ok) throw new Error(`Notion: the picture couldn't be uploaded (${r.status}).`);
  return u.id;
}
