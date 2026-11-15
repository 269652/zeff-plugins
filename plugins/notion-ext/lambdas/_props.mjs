// A Notion database's properties ↔ a Zeff database's fields, and a row's values both ways. What Notion works out itself (formulas,
// rollups, who made or changed a row, its number) comes into Zeff as text and is never written back.
// (Copied into each lambda as props.mjs: scripts/copy-lib.mjs.)
import { plain } from "./notion.mjs";

const COLORS = new Set(["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]);
const color = (c) => (COLORS.has(c) ? c : "gray");
/** Notion's kinds Zeff keeps as text, read only (Notion works them out). */
export const READ_ONLY = new Set(["people", "files", "formula", "rollup", "created_by", "last_edited_by", "created_time", "last_edited_time", "unique_id", "verification"]);
const NUMBER_FORMATS = { percent: "percent", euro: "euro", dollar: "dollar" };

/** The field a Notion property becomes (title: the title column; null: none — a button). `relation`: the related database's Zeff id. */
export function fieldOf(name, p, zeffOf) {
  switch (p.type) {
    case "title":
    case "button":
      return null;
    case "rich_text":
      return { name, type: "text" };
    case "number":
      return { name, type: "number", ...(NUMBER_FORMATS[p.number?.format] ? { format: NUMBER_FORMATS[p.number.format] } : {}) };
    case "select":
    case "multi_select":
      return { name, type: p.type, options: (p[p.type]?.options ?? []).map((o) => ({ name: o.name, color: color(o.color) })) };
    case "status": {
      const groupOf = new Map();
      for (const g of p.status?.groups ?? []) {
        const kind = /complete|done|erledigt/i.test(g.name) ? "done" : /progress|doing|arbeit/i.test(g.name) ? "doing" : "todo";
        for (const id of g.option_ids ?? []) groupOf.set(id, kind);
      }
      return { name, type: "status", options: (p.status?.options ?? []).map((o) => ({ name: o.name, color: color(o.color), group: groupOf.get(o.id) ?? "todo" })) };
    }
    case "date":
      return { name, type: "date" };
    case "checkbox":
    case "url":
    case "email":
      return { name, type: p.type };
    case "phone_number":
      return { name, type: "phone" };
    case "relation": {
      const db = zeffOf(plain(p.relation?.database_id));
      return db ? { name, type: "relation", relation: { database: db } } : null;
    }
    default:
      return READ_ONLY.has(p.type) ? { name, type: "text" } : null;
  }
}

/** A Notion property for a Zeff field (a database made in Zeff, or a field added there). null: Notion has no such kind of its own. */
export function propertyOf(f, notionOf) {
  switch (f.type) {
    case "text":
    case "markdown":
      return { rich_text: {} };
    case "number":
      return { number: { format: ({ percent: "percent", euro: "euro", dollar: "dollar" })[f.format] ?? "number" } };
    case "select":
    case "multi_select":
      return { [f.type]: { options: (f.choices ?? []).map((o) => ({ name: o.name, color: color(o.color) })) } };
    case "status":
      // (Notion makes a status's options itself; a select keeps the names.)
      return { select: { options: (f.choices ?? []).map((o) => ({ name: o.name, color: color(o.color) })) } };
    case "date":
    case "created_time":
    case "updated_time":
      return f.type === "date" ? { date: {} } : null;
    case "checkbox":
    case "url":
    case "email":
      return { [f.type]: {} };
    case "phone":
      return { phone_number: {} };
    case "relation": {
      const db = f.relationDb ? notionOf(f.relationDb) : null;
      return db ? { relation: { database_id: db, single_property: {} } } : null;
    }
    default:
      return null;
  }
}

const pad = (n) => String(n).padStart(2, "0");
/** A Notion date ("2026-11-15" or with a time and zone) as Zeff keeps it ("2026-11-15", "2026-11-15T10:30" in this computer's time). */
export function dateIn(s) {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s).slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** A Zeff date as Notion takes it: a day as it is, a time with this computer's zone. */
export function dateOut(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const off = -d.getTimezoneOffset();
  return `${s.slice(0, 16)}:00${off >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

const plainOf = (rich) => (rich ?? []).map((r) => r.plain_text ?? r.text?.content ?? "").join("");
const nameOf = (u) => u?.name ?? u?.person?.email ?? "";

/** A row's value of a Notion property as Zeff's db.add / db.update take it (undefined: none to set). */
export function valueIn(p, zeffOf, unresolved) {
  switch (p.type) {
    case "rich_text":
      return plainOf(p.rich_text);
    case "number":
      return p.number;
    case "select":
      return p.select?.name ?? null;
    case "status":
      return p.status?.name ?? null;
    case "multi_select":
      return (p.multi_select ?? []).map((o) => o.name);
    case "date":
      return p.date ? (p.date.end ? { start: dateIn(p.date.start), end: dateIn(p.date.end) } : dateIn(p.date.start)) : null;
    case "checkbox":
      return !!p.checkbox;
    case "url":
    case "email":
      return p[p.type] ?? "";
    case "phone_number":
      return p.phone_number ?? "";
    case "relation": {
      const ids = (p.relation ?? []).map((r) => zeffOf(plain(r.id)));
      if (ids.some((x) => !x)) unresolved.value = true;
      return ids.filter(Boolean);
    }
    case "people":
      return (p.people ?? []).map(nameOf).filter(Boolean).join(", ");
    case "created_by":
    case "last_edited_by":
      return nameOf(p[p.type]);
    case "files":
      return (p.files ?? []).map((f) => f.name || f.external?.url || "").filter(Boolean).join(", ");
    case "created_time":
    case "last_edited_time":
      return dateIn(p[p.type]).replace("T", " ");
    case "unique_id":
      return p.unique_id ? `${p.unique_id.prefix ? `${p.unique_id.prefix}-` : ""}${p.unique_id.number}` : "";
    case "formula": {
      const f = p.formula ?? {};
      if (f.type === "date") return f.date ? dateIn(f.date.start).replace("T", " ") : "";
      if (f.type === "boolean") return f.boolean ? "✓" : "";
      return f[f.type] == null ? "" : String(f[f.type]);
    }
    case "rollup": {
      const r = p.rollup ?? {};
      if (r.type === "number") return r.number == null ? "" : String(r.number);
      if (r.type === "date") return r.date ? dateIn(r.date.start).replace("T", " ") : "";
      if (r.type === "array") return (r.array ?? []).map((x) => valueIn(x, zeffOf, { value: false })).map((v) => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v))).filter(Boolean).join(", ");
      return "";
    }
    case "verification":
      return p.verification?.state ?? "";
    default:
      return undefined;
  }
}

/**
 * A Zeff row's value as a Notion property's value (type: the Notion property's). `raw`: the cell as Zeff keeps it; `field`: the field
 * (with its choices, ids → names). undefined: nothing to write (read only, or Notion can't take it).
 */
export function valueOut(type, raw, field, notionOf) {
  const choice = (id) => (field?.choices ?? []).find((o) => o.id === id)?.name ?? null;
  switch (type) {
    case "rich_text": {
      const s = raw == null ? "" : String(raw);
      const parts = [];
      for (let i = 0; i < s.length; i += 2000) parts.push({ type: "text", text: { content: s.slice(i, i + 2000) } });
      return { rich_text: parts };
    }
    case "number": {
      const n = raw === null || raw === undefined || raw === "" ? null : Number(raw);
      return { number: Number.isFinite(n) ? n : null };
    }
    case "select": {
      const name = choice(raw);
      return { select: name ? { name } : null };
    }
    case "status": {
      const name = choice(raw);
      return name ? { status: { name } } : undefined;
    }
    case "multi_select":
      return { multi_select: (Array.isArray(raw) ? raw : raw ? [raw] : []).map(choice).filter(Boolean).map((name) => ({ name })) };
    case "date": {
      const r = raw && typeof raw === "object" ? raw : raw ? { start: String(raw) } : null;
      const start = r ? dateOut(r.start) : null;
      return { date: start ? { start, ...(r.end ? { end: dateOut(r.end) } : {}) } : null };
    }
    case "checkbox":
      return { checkbox: !!raw };
    case "url":
    case "email":
    case "phone_number":
      return { [type]: raw ? String(raw) : null };
    case "relation": {
      const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((z) => notionOf(Number(z))).filter(Boolean);
      return { relation: ids.map((id) => ({ id })) };
    }
    default:
      return undefined;
  }
}
