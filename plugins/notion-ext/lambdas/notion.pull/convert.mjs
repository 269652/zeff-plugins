// Notion's blocks ↔ the text of a Zeff page, and what keeps the two in step without losing what one side can't show.
// (Copied into each lambda as convert.mjs: scripts/copy-lib.mjs.)
//
// A page's text is seen as a flat row of elements: each top-level node of the Zeff page, a list split into its items (each item with its
// list's kind). One Notion block (top level) is one *unit*: usually one element, more when Notion nests what Zeff can't (a paragraph with
// indented children). A unit's *key* is the fingerprint of its elements as Zeff keeps them — so both sides are compared in Zeff's terms:
//   pushing: the units of the Zeff page against the blocks Notion has (each kept with its key) → only what differs is written;
//   pulling: Notion's units, the Zeff page and how it was at the last sync → a three-way merge: what only Zeff has (a widget, a mention of
//            a todo) stays, what Notion changed comes in.
import { hash } from "./hash.mjs";
import { notionId, notionUrl, plain } from "./notion.mjs";

const COLORS = new Set(["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]);
const LISTS = new Set(["bulletList", "orderedList", "taskList"]);
/** Notion blocks that are pages of their own: never deleted from a page's text (that would move the page to Notion's trash). */
export const ANCHORS = new Set(["child_page", "child_database"]);
/** Zeff's code languages Notion knows by another name. */
const LANG_TO_NOTION = { "": "plain text", text: "plain text", plaintext: "plain text", js: "javascript", ts: "typescript", py: "python", sh: "shell", bash: "bash", yml: "yaml", md: "markdown", "c#": "c#", cs: "c#", cpp: "c++", golang: "go", rb: "ruby" };
const NOTION_LANGS = new Set(["abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript", "c++", "c#", "css", "dart", "diff", "docker", "elixir", "elm", "erlang", "flow", "fortran", "f#", "gherkin", "glsl", "go", "graphql", "groovy", "haskell", "html", "java", "javascript", "json", "julia", "kotlin", "latex", "less", "lisp", "livescript", "lua", "makefile", "markdown", "markup", "matlab", "mermaid", "nix", "objective-c", "ocaml", "pascal", "perl", "php", "plain text", "powershell", "prolog", "protobuf", "python", "r", "reason", "ruby", "rust", "sass", "scala", "scheme", "scss", "shell", "sql", "swift", "typescript", "vb.net", "verilog", "vhdl", "visual basic", "webassembly", "xml", "yaml", "java/c/c++/c#"]);

// ---------------------------------------------------------------------------------------------------------------------------------
// Inline: Notion's rich text ↔ Zeff's text with marks
// ---------------------------------------------------------------------------------------------------------------------------------

const isNotionLink = (u) => /^https?:\/\/([a-z0-9-]+\.)?notion\.(so|site)\//i.test(u) || /^\/[0-9a-f]{32}/i.test(u);

/** A link as a Zeff page shows it: one to a synced Notion page leads to its Zeff page. */
function linkIn(url, ctx) {
  const u = String(url ?? "");
  if (isNotionLink(u)) {
    const id = notionId(u);
    const z = id ? ctx.zeffOf(id) : null;
    if (z) return `/workspace/${z}`;
    if (u.startsWith("/")) return `https://www.notion.so${u}`;
  }
  return u;
}

/** Notion's rich text as Zeff's inline nodes (text with marks, line breaks). */
export function inlineFromNotion(rich, ctx) {
  const out = [];
  for (const r of rich ?? []) {
    const a = r.annotations ?? {};
    let text = r.plain_text ?? r.text?.content ?? "";
    const marks = [];
    if (a.bold) marks.push({ type: "bold" });
    if (a.italic) marks.push({ type: "italic" });
    if (a.strikethrough) marks.push({ type: "strike" });
    if (a.underline) marks.push({ type: "underline" });
    if (a.code) marks.push({ type: "code" });
    if (typeof a.color === "string" && a.color.endsWith("_background") && COLORS.has(a.color.slice(0, -11))) marks.push({ type: "highlight", attrs: { color: a.color.slice(0, -11) } });
    let href = "";
    if (r.type === "text" && r.text?.link?.url) href = linkIn(r.text.link.url, ctx);
    else if (r.type === "mention") {
      const m = r.mention ?? {};
      if (m.type === "page" || m.type === "database") {
        const id = plain(m[m.type]?.id);
        const z = ctx.zeffOf(id);
        href = z ? `/workspace/${z}` : notionUrl(id);
        if (!z) ctx.unresolved = true;
      } else if (m.type === "link_preview") href = m.link_preview?.url ?? "";
      else if (m.type === "link_mention") href = m.link_mention?.href ?? "";
      else if (r.href) href = linkIn(r.href, ctx);
    } else if (r.type === "equation") {
      text = `$${r.equation?.expression ?? ""}$`;
      if (!a.code) marks.push({ type: "code" });
    }
    if (href && /^(https?:\/\/|mailto:|tel:|\/workspace\/)/i.test(href)) marks.push({ type: "link", attrs: { href } });
    text.split("\n").forEach((part, i) => {
      if (i) out.push({ type: "hardBreak" });
      if (part) out.push(marks.length ? { type: "text", text: part, marks } : { type: "text", text: part });
    });
  }
  return out;
}

const chunks = (s, n = 2000) => {
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out.length ? out : [""];
};

/** Zeff's inline nodes as Notion's rich text. */
export function richFromInline(nodes, ctx) {
  const out = [];
  const push = (item) => {
    // (A line break goes into the text before it.)
    out.push(item);
  };
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") {
      const last = out[out.length - 1];
      if (last?.type === "text") last.text.content += "\n";
      else push({ type: "text", text: { content: "\n" } });
      continue;
    }
    let text = "";
    let marks = [];
    if (n.type === "text") {
      text = n.text ?? "";
      marks = n.marks ?? [];
    } else if (n.type === "zeffRef") {
      text = String(n.attrs?.label ?? n.attrs?.ref ?? "");
      if (n.attrs?.href) marks = [{ type: "link", attrs: { href: n.attrs.href } }];
    } else if (n.type === "inlineFormula") text = `=${n.attrs?.src ?? ""}`;
    else continue;
    if (!text) continue;
    const has = (t) => marks.find((m) => m.type === t);
    const color = has("highlight")?.attrs?.color;
    const annotations = {
      ...(has("bold") ? { bold: true } : {}),
      ...(has("italic") ? { italic: true } : {}),
      ...(has("strike") ? { strikethrough: true } : {}),
      ...(has("underline") ? { underline: true } : {}),
      ...(has("code") ? { code: true } : {}),
      ...(color && COLORS.has(color) ? { color: `${color}_background` } : {}),
    };
    const ann = Object.keys(annotations).length ? { annotations } : {};
    const href = has("link")?.attrs?.href ?? "";
    if (has("code") && /^\$[^$\n]+\$$/.test(text)) {
      const { code, ...rest } = annotations;
      push({ type: "equation", equation: { expression: text.slice(1, -1) }, ...(Object.keys(rest).length ? { annotations: rest } : {}) });
      continue;
    }
    const z = /^\/workspace\/(\d+)/.exec(href);
    const target = z ? ctx.notionOf(Number(z[1])) : null;
    if (target) {
      push({ type: "mention", mention: { type: "page", page: { id: target } }, ...ann });
      continue;
    }
    const url = /^(https?:\/\/|mailto:|tel:)/i.test(href) ? href : "";
    for (const part of chunks(text)) push({ type: "text", text: { content: part, ...(url ? { link: { url } } : {}) }, ...ann });
  }
  return out;
}

const plainOf = (rich) => (rich ?? []).map((r) => r.plain_text ?? r.text?.content ?? "").join("");
const para = (inline) => (inline.length ? { type: "paragraph", content: inline } : { type: "paragraph" });

// ---------------------------------------------------------------------------------------------------------------------------------
// Blocks: Notion → Zeff
// ---------------------------------------------------------------------------------------------------------------------------------

/** A placeholder for what Zeff can't show: a line linking to it in Notion (it stays in Notion as long as this line is unchanged). */
function placeholder(b, label, url) {
  const href = url && /^https?:\/\//i.test(url) ? url : notionUrl(b.id);
  return [{ l: null, node: { type: "paragraph", content: [{ type: "text", text: `↗ ${label}`, marks: [{ type: "link", attrs: { href } }] }] } }];
}

const fileUrl = (f) => (f?.type === "external" ? f.external?.url : f?.type === "file" ? f.file?.url : f?.type === "file_upload" ? "" : "") ?? "";

/** The flat elements a Notion block becomes ([] for what is shown elsewhere — a sub-page not synced yet). */
function elementsOf(b, ctx) {
  const d = b[b.type] ?? {};
  const inline = () => inlineFromNotion(d.rich_text, ctx);
  const kids = () => nodesFromBlocks(b.children ?? [], ctx);
  switch (b.type) {
    case "paragraph": {
      // (Indented children: Zeff can't nest under a paragraph — they follow it, one unit with it.)
      return [{ l: null, node: para(inline()) }, ...flatFromBlocks(b.children ?? [], ctx)];
    }
    case "heading_1":
    case "heading_2":
    case "heading_3": {
      const level = Number(b.type.slice(-1));
      if (d.is_toggleable) return [{ l: null, node: { type: "details", attrs: { open: false }, content: [{ type: "detailsSummary", content: inline() }, { type: "detailsContent", content: kidsOrEmpty(kids()) }] } }];
      return [{ l: null, node: { type: "heading", attrs: { level }, content: inline() } }];
    }
    case "bulleted_list_item":
      return [{ l: "bulletList", node: { type: "listItem", content: [para(inline()), ...kids()] } }];
    case "numbered_list_item":
      return [{ l: "orderedList", node: { type: "listItem", content: [para(inline()), ...kids()] } }];
    case "to_do":
      return [{ l: "taskList", node: { type: "taskItem", attrs: { checked: !!d.checked }, content: [para(inline()), ...kids()] } }];
    case "toggle":
      return [{ l: null, node: { type: "details", attrs: { open: false }, content: [{ type: "detailsSummary", content: inline() }, { type: "detailsContent", content: kidsOrEmpty(kids()) }] } }];
    case "quote":
      return [{ l: null, node: { type: "blockquote", content: [para(inline()), ...kids()] } }];
    case "callout": {
      const icon = d.icon?.type === "emoji" ? d.icon.emoji : "💡";
      const tone = typeof d.color === "string" ? d.color.replace(/_background$/, "") : "gray";
      return [{ l: null, node: { type: "callout", attrs: { icon, tone: COLORS.has(tone) ? tone : "gray" }, content: [para(inline()), ...kids()] } }];
    }
    case "code": {
      const text = plainOf(d.rich_text);
      const language = d.language === "plain text" ? "" : String(d.language ?? "");
      return [{ l: null, node: { type: "codeBlock", attrs: { language }, ...(text ? { content: [{ type: "text", text }] } : {}) } }];
    }
    case "equation": {
      const text = String(d.expression ?? "");
      return [{ l: null, node: { type: "codeBlock", attrs: { language: "latex" }, ...(text ? { content: [{ type: "text", text }] } : {}) } }];
    }
    case "divider":
      return [{ l: null, node: { type: "horizontalRule" } }];
    case "image": {
      const src = fileUrl(d);
      if (!src) return placeholder(b, "Picture in Notion");
      if (d.type === "file") ctx.pictures = true;
      const alt = plainOf(d.caption);
      // (title notion:<block>: the same picture whatever address it is kept at — a kept copy is no change.)
      return [{ l: null, node: { type: "image", attrs: { src, ...(alt ? { alt } : {}), title: `notion:${plain(b.id)}` } } }];
    }
    case "table": {
      const rows = (b.children ?? []).filter((r) => r.type === "table_row");
      const content = rows.map((r, i) => ({
        type: "tableRow",
        content: (r.table_row?.cells ?? []).map((cell, j) => ({ type: (i === 0 && d.has_column_header) || (j === 0 && d.has_row_header) ? "tableHeader" : "tableCell", content: [para(inlineFromNotion(cell, ctx))] })),
      }));
      return content.length ? [{ l: null, node: { type: "table", content } }] : [];
    }
    case "column_list": {
      const cols = (b.children ?? []).filter((c) => c.type === "column").map((c) => ({ type: "flexBox", attrs: { dir: "col" }, content: kidsOrEmpty(nodesFromBlocks(c.children ?? [], ctx)) }));
      return cols.length ? [{ l: null, node: { type: "flexBox", attrs: { dir: "row" }, content: cols } }] : [];
    }
    case "child_page": {
      const z = ctx.zeffOf(plain(b.id));
      if (!z) {
        ctx.unresolved = true;
        return [];
      }
      return [{ l: null, node: { type: "pageEmbed", attrs: { pageId: z, title: d.title ?? "" } } }];
    }
    case "child_database": {
      const z = ctx.zeffOf(plain(b.id));
      if (!z) {
        ctx.unresolved = true;
        return [];
      }
      return [{ l: null, node: { type: "databaseView", attrs: { dbId: z, title: d.title ?? "" } } }];
    }
    case "link_to_page": {
      const id = plain(d.page_id ?? d.database_id);
      const z = ctx.zeffOf(id);
      if (!z) ctx.unresolved = true;
      return [{ l: null, node: { type: "paragraph", content: [{ type: "text", text: "↗ Linked page", marks: [{ type: "link", attrs: { href: z ? `/workspace/${z}` : notionUrl(id) } }] }] } }];
    }
    case "bookmark":
    case "embed":
    case "link_preview":
      return placeholder(b, plainOf(d.caption) || d.url || b.type, d.url);
    case "video":
    case "audio":
    case "file":
    case "pdf":
      return placeholder(b, plainOf(d.caption) || d.name || ({ video: "Video", audio: "Audio", file: "File", pdf: "PDF" })[b.type], d.type === "external" ? fileUrl(d) : "");
    case "synced_block":
      // (Its content shown as Zeff's own; it stays a synced block in Notion while unchanged.)
      return flatFromBlocks(b.children ?? [], ctx);
    default:
      return placeholder(b, `${b.type.replace(/_/g, " ")} (Notion)`);
  }
}

const kidsOrEmpty = (nodes) => (nodes.length ? nodes : [{ type: "paragraph" }]);

/** Notion's blocks as units: each with its block's id and type, its elements and key. */
export function unitsFromBlocks(blocks, ctx) {
  return (blocks ?? []).map((b) => {
    const flat = elementsOf(b, ctx);
    return { id: plain(b.id), type: b.type, flat, n: flat.length, key: keyOf(flat) };
  });
}

/** Notion's blocks as flat elements. */
export const flatFromBlocks = (blocks, ctx) => unitsFromBlocks(blocks, ctx).flatMap((u) => u.flat);

/** Flat elements as Zeff's nodes: consecutive items of a kind of list together in one list (its own attributes kept from its first item). */
export function nodesFromFlat(flat) {
  const out = [];
  for (const e of flat) {
    const last = out[out.length - 1];
    if (e.l && last && last.type === e.l && !last.__closed) last.content.push(e.node);
    else if (e.l) out.push({ type: e.l, ...(e.wrap && Object.keys(e.wrap).length ? { attrs: e.wrap } : {}), content: [e.node] });
    else out.push(e.node);
  }
  return out;
}

export const nodesFromBlocks = (blocks, ctx) => nodesFromFlat(flatFromBlocks(blocks, ctx));
export const docFromFlat = (flat) => {
  const content = nodesFromFlat(flat);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
};

/** A Zeff page's text as flat elements (a list's items each with the list's attributes, to put them back the same). */
export function flatOfDoc(doc) {
  const out = [];
  for (const n of doc?.content ?? []) {
    if (LISTS.has(n.type)) for (const item of n.content ?? []) out.push({ l: n.type, node: item, wrap: n.attrs ?? {} });
    else out.push({ l: null, node: n });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Keys: what an element says, in Zeff's terms — not what only Zeff keeps for itself (ids, a toggle's being open)
// ---------------------------------------------------------------------------------------------------------------------------------

const KEEP_ATTRS = {
  heading: (a) => ({ level: Math.min(3, Math.max(1, Number(a.level) || 1)) }),
  codeBlock: (a) => ({ language: String(a.language ?? "").toLowerCase() }),
  taskItem: (a) => ({ checked: !!a.checked }),
  callout: (a) => ({ icon: String(a.icon ?? ""), tone: String(a.tone ?? "gray") }),
  image: (a) => (String(a.title ?? "").startsWith("notion:") ? { title: String(a.title) } : { src: String(a.src ?? "") }),
  flexBox: (a) => ({ dir: a.dir === "col" ? "col" : "row" }),
  pageEmbed: (a) => ({ pageId: Number(a.pageId) || 0 }),
  databaseView: (a) => ({ dbId: Number(a.dbId) || 0 }),
  zeffRef: (a) => ({ kind: String(a.kind ?? ""), ref: String(a.ref ?? ""), label: String(a.label ?? "") }),
};

function canonMarks(marks) {
  return (marks ?? [])
    .map((m) => (m.type === "link" ? { t: "link", h: String(m.attrs?.href ?? "") } : m.type === "highlight" ? { t: "highlight", c: String(m.attrs?.color ?? "") } : { t: m.type }))
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
}

/** A node as compared: its kind, the attributes that mean something, its text and marks — adjacent texts with the same marks as one. */
export function canon(n) {
  if (!n || typeof n !== "object") return null;
  if (n.type === "text") return { x: String(n.text ?? ""), m: canonMarks(n.marks) };
  const attrs = KEEP_ATTRS[n.type]?.(n.attrs ?? {});
  const kids = [];
  for (const c of n.content ?? []) {
    const k = canon(c);
    if (!k) continue;
    const last = kids[kids.length - 1];
    if (k.x !== undefined && last?.x !== undefined && JSON.stringify(last.m) === JSON.stringify(k.m)) last.x += k.x;
    else if (k.x === "") continue;
    else kids.push(k);
  }
  return { t: n.type, ...(attrs ? { a: attrs } : {}), ...(kids.length ? { c: kids } : {}) };
}

/** A unit's key: the fingerprint of its elements. */
export const keyOf = (flat) => hash(flat.map((e) => ({ l: e.l ?? null, n: canon(e.node) })));

/**
 * The flat elements cut into units: where a run of elements has the key of a unit known (a Notion block of several elements, kept with
 * how many), they are one unit; every other element is a unit of its own.
 */
export function unitsOfFlat(flat, known = []) {
  const keys = new Set(known.filter((k) => k.n > 1).map((k) => k.key));
  const sizes = [...new Set(known.filter((k) => k.n > 1).map((k) => k.n))].sort((a, b) => b - a);
  const out = [];
  for (let i = 0; i < flat.length; ) {
    let took = false;
    for (const n of sizes) {
      if (i + n > flat.length) continue;
      const k = keyOf(flat.slice(i, i + n));
      if (keys.has(k)) {
        out.push({ key: k, n, flat: flat.slice(i, i + n) });
        i += n;
        took = true;
        break;
      }
    }
    if (!took) {
      out.push({ key: keyOf([flat[i]]), n: 1, flat: [flat[i]] });
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Sequences: the longest common part, a three-way merge
// ---------------------------------------------------------------------------------------------------------------------------------

/** Pairs [i, j] of a's and b's elements that are the same (longest common subsequence of their keys, in order). */
export function lcs(a, b) {
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ha = a.length;
  let hb = b.length;
  while (ha > lo && hb > lo && a[ha - 1] === b[hb - 1]) (ha--, hb--);
  const pairs = [];
  for (let i = 0; i < lo; i++) pairs.push([i, i]);
  const n = ha - lo;
  const m = hb - lo;
  if (n && m) {
    const w = m + 1;
    const t = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i * w + j] = a[lo + i] === b[lo + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    for (let i = 0, j = 0; i < n && j < m; ) {
      if (a[lo + i] === b[lo + j]) (pairs.push([lo + i, lo + j]), i++, j++);
      else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++;
      else j++;
    }
  }
  for (let k = 0; k < a.length - ha; k++) pairs.push([ha + k, hb + k]);
  return pairs;
}

/**
 * Three ways into one: `base` (the units' keys at the last sync), `mine` (the Zeff page's units now), `theirs` (Notion's now). What one
 * side added stays where it was added; what one side removed is gone; what both kept stays (Zeff's copy). Gives the merged units.
 */
export function merge3(base, mine, theirs) {
  const bk = base.map((u) => u.key);
  const pm = new Map(lcs(bk, mine.map((u) => u.key)).map(([i, j]) => [j, i]));
  const pt = new Map(lcs(bk, theirs.map((u) => u.key)).map(([i, j]) => [j, i]));
  const keptM = new Set(pm.values());
  const keptT = new Set(pt.values());
  const gaps = (units, map) => {
    const g = Array.from({ length: bk.length + 1 }, () => []);
    let at = 0;
    units.forEach((u, j) => {
      if (map.has(j)) at = map.get(j) + 1;
      else g[at].push(u);
    });
    return g;
  };
  const gm = gaps(mine, pm);
  const gt = gaps(theirs, pt);
  const byBase = new Map([...pm.entries()].map(([j, i]) => [i, mine[j]]));
  const out = [];
  for (let g = 0; g <= bk.length; g++) {
    out.push(...gm[g], ...gt[g]);
    if (g < bk.length && keptM.has(g) && keptT.has(g)) out.push(byBase.get(g));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Blocks: Zeff → Notion
// ---------------------------------------------------------------------------------------------------------------------------------

const firstPara = (content) => (content?.[0]?.type === "paragraph" ? [content[0].content ?? [], content.slice(1)] : [[], content ?? []]);

/** Zeff nodes as Notion blocks (what Notion can't hold — a widget, a code cell — left out). */
export function blocksFromNodes(nodes, ctx) {
  return flatOfDoc({ content: nodes }).flatMap((e) => {
    const b = blockOf(e, ctx);
    return b ? [b] : [];
  });
}

/** One flat element as a Notion block, or null: Zeff's own (it stays in Zeff only), or a sub-page (Notion keeps those itself). */
export function blockOf(e, ctx) {
  const n = e.node;
  const rich = (inline) => richFromInline(inline, ctx);
  const withKids = (type, inline, rest, extra = {}) => {
    const children = blocksFromNodes(rest, ctx);
    return { type, [type]: { rich_text: rich(inline), ...extra, ...(children.length ? { children } : {}) } };
  };
  if (e.l === "bulletList" || e.l === "orderedList" || e.l === "taskList") {
    const [inline, rest] = firstPara(n.content);
    if (e.l === "taskList") return withKids("to_do", inline, rest, { checked: !!n.attrs?.checked });
    return withKids(e.l === "bulletList" ? "bulleted_list_item" : "numbered_list_item", inline, rest);
  }
  switch (n.type) {
    case "paragraph":
      return { type: "paragraph", paragraph: { rich_text: rich(n.content ?? []) } };
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(n.attrs?.level) || 1));
      return { type: `heading_${level}`, [`heading_${level}`]: { rich_text: rich(n.content ?? []) } };
    }
    case "blockquote": {
      const [inline, rest] = firstPara(n.content);
      return withKids("quote", inline, rest);
    }
    case "callout": {
      const [inline, rest] = firstPara(n.content);
      const tone = String(n.attrs?.tone ?? "gray");
      return withKids("callout", inline, rest, { icon: { type: "emoji", emoji: String(n.attrs?.icon || "💡") }, color: COLORS.has(tone) ? `${tone}_background` : "gray_background" });
    }
    case "details": {
      const summary = (n.content ?? []).find((c) => c.type === "detailsSummary");
      const body = (n.content ?? []).find((c) => c.type === "detailsContent");
      const children = blocksFromNodes(body?.content ?? [], ctx).filter((b) => !(b.type === "paragraph" && !b.paragraph.rich_text.length && (body?.content ?? []).length === 1));
      return { type: "toggle", toggle: { rich_text: rich(summary?.content ?? []), ...(children.length ? { children } : {}) } };
    }
    case "codeBlock": {
      const text = (n.content ?? []).map((c) => c.text ?? "").join("");
      const lang = String(n.attrs?.language ?? "").toLowerCase();
      if (lang === "latex") return { type: "equation", equation: { expression: text } };
      const language = LANG_TO_NOTION[lang] ?? (NOTION_LANGS.has(lang) ? lang : "plain text");
      return { type: "code", code: { rich_text: chunks(text).map((c) => ({ type: "text", text: { content: c } })), language } };
    }
    case "horizontalRule":
      return { type: "divider", divider: {} };
    case "image": {
      const src = String(n.attrs?.src ?? "");
      const caption = n.attrs?.alt ? [{ type: "text", text: { content: String(n.attrs.alt) } }] : [];
      if (/^https?:\/\//i.test(src)) return { type: "image", image: { type: "external", external: { url: src }, caption } };
      // (A picture uploaded to Zeff: the push uploads it to Notion first.)
      if (/^\/api\/workspace\/files\//.test(src)) return { type: "image", image: { caption }, upload: src };
      return null;
    }
    case "table": {
      const rows = n.content ?? [];
      const width = Math.max(1, ...rows.map((r) => (r.content ?? []).length));
      const headerRow = rows.length > 0 && (rows[0].content ?? []).every((c) => c.type === "tableHeader");
      const headerCol = rows.length > 0 && rows.every((r) => r.content?.[0]?.type === "tableHeader") && !(rows.length === 1 && headerRow);
      const children = rows.map((r) => {
        const cells = (r.content ?? []).map((c) => rich((c.content ?? []).flatMap((p, i) => (i ? [{ type: "hardBreak" }, ...(p.content ?? [])] : (p.content ?? [])))));
        while (cells.length < width) cells.push([]);
        return { type: "table_row", table_row: { cells } };
      });
      return { type: "table", table: { table_width: width, has_column_header: headerRow, has_row_header: headerCol, children } };
    }
    case "flexBox": {
      if (n.attrs?.dir === "col") return null;
      const cols = (n.content ?? []).map((c) => ({ type: "column", column: { children: (c.type === "flexBox" ? blocksFromNodes(c.content ?? [], ctx) : blocksFromNodes([c], ctx)) } })).filter((c) => c.column.children.length);
      if (cols.length < 2) return cols[0]?.column.children[0] ?? null;
      return { type: "column_list", column_list: { children: cols } };
    }
    case "pageEmbed":
    case "databaseView": {
      const target = ctx.notionOf(Number(n.attrs?.pageId ?? n.attrs?.dbId));
      // A sub-page of this page: Notion keeps it itself (left as it is). Another synced page: a link to it.
      if (!target || ctx.childOf?.(target)) return null;
      return { type: "link_to_page", link_to_page: n.type === "databaseView" ? { type: "database_id", database_id: target } : { type: "page_id", page_id: target } };
    }
    default:
      return null;
  }
}

/** A block's type and what it holds without its children — what a block is updated with in place. */
export function bodyOf(block) {
  const { children, ...rest } = block[block.type] ?? {};
  return rest;
}
