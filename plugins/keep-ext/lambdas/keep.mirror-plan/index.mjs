import { COLORS, KEEP_COLORS } from "./lib.mjs";

/** Every row of a store (pages of 500). */
async function all(zeff, store) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const { rows, total } = await zeff.call("store.query", { store, limit: 500, offset });
    out.push(...rows);
    if (!rows.length || out.length >= total) return out;
  }
}

const WS_COLOR = { teal: "green", cerulean: "blue" };
const wsColor = (c) => WS_COLOR[c] ?? (COLORS.includes(c) ? c : "gray");
const firstLine = (text) => text.split(/\r?\n/)[0].replace(/^- \[[ xX]\] /, "").slice(0, 120);
const labelsOf = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
};

/** The built-in's syncGoogleKeepDatabase as records for the kernel's db.mirror. */
export async function handler(_event, context) {
  // (a note synced with one of your boards is shown there — as your note —, not here a second time)
  let linked = new Set();
  try {
    linked = new Set((await all(context.zeff, "keep-ext.linked")).map((r) => r.google_id).filter(Boolean));
  } catch {
    // (no boards synced with Google Keep)
  }
  const notes = (await all(context.zeff, "keep-ext.notes"))
    .filter((n) => !linked.has(n.id) && !n.archived)
    .sort((a, b) => String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")));
  const setup = {
    title: "Google Keep",
    titleName: "Title",
    properties: [
      { id: "color", name: "Color", type: "select", options: Object.keys(KEEP_COLORS).map((c) => ({ name: c, color: wsColor(c) })) },
      { id: "pinned", name: "Pinned", type: "checkbox" },
      { id: "labels", name: "Labels", type: "multi_select", options: [] },
      { id: "noteref", name: "Note", type: "text" },
      { id: "keepedited", name: "Edited in Keep", type: "text" },
    ],
    views: [
      { name: "Notes", type: "gallery", sorts: [{ prop: "pinned", dir: "desc" }], hidden: ["noteref", "pinned", "keepedited"] },
      { name: "Table", type: "table" },
    ],
    fullWidth: true,
    locked: true,
    source: "google-keep",
    briefing: true,
    knowledge: true,
  };
  const records = notes.map((n) => {
    const labels = labelsOf(n.labels);
    return { key: "keep:" + n.id, title: n.title || firstLine(n.text), cells: { color: n.color, pinned: !!n.pinned, labels, keepedited: n.updated_at ?? "" }, markdown: n.text, createdAt: n.created_at, updatedAt: n.updated_at };
  });
  return { setup, records };
}
