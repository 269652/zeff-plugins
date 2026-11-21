import { DOC_KINDS_NAV, tFor } from "./lib.mjs";

/**
 * The documents to attach to a todo by hand (the built-in's attach panel, src/plugins/documents/AttachPanel.tsx): newest first, searched by name and abstract, each
 * with its abstract (or what became of reading it). event: { q }. Returns { items: [{ id, ref, title, icon, sizeText, text, ready }], count }.
 */
export async function handler(event, context) {
  const t = tFor(context.language);
  const { rows } = await context.zeff.call("sql.query", { sql: "select id, name, kind, size, status, error, summary, substr(text, 1, 420) as head from documents order by created_at desc", limit: 2000 });
  const words = String(event?.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const size = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`);
  const all = rows.map((d) => ({
    id: d.id,
    ref: `doc:${d.id}`,
    title: d.name,
    icon: (DOC_KINDS_NAV[d.kind] ?? DOC_KINDS_NAV.other).icon,
    sizeText: size(d.size),
    ready: d.status === "ready",
    text: d.status === "ready" ? String(d.summary || d.head || "").replace(/\s+/g, " ").trim().slice(0, 180) : d.error || t("being read …"),
    hay: `${d.name} ${d.summary || ""}`.toLowerCase(),
  }));
  const items = all.filter((d) => words.every((w) => d.hay.includes(w))).slice(0, 30).map(({ hay, ...d }) => d);
  return { items, count: all.length };
}
