import { tFor } from "./lib.mjs";

/** Every row of a store (pages of 500). */
async function all(zeff, store) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const { rows, total } = await zeff.call("store.query", { store, limit: 500, offset });
    out.push(...rows);
    if (!rows.length || out.length >= total) return out;
  }
}

/** The built-in's saveKeepNotes, rule for rule: new and changed counted, every note written, the gone ones (a full read) removed. */
export async function handler(event, context) {
  const t = tFor(context.language);
  const notes = Array.isArray(event?.notes) ? event.notes : [];
  const full = event?.full === true;
  const known = new Map((await all(context.zeff, "keep-ext.notes")).map((r) => [r.id, r]));
  const now = new Date().toISOString();
  let added = 0;
  let changed = 0;
  const rows = notes.map((n) => {
    const labels = JSON.stringify(n.labels ?? []);
    const k = known.get(n.id);
    if (!k) added++;
    else if (k.updated_at !== n.updatedAt || k.title !== n.title || k.text !== n.text || k.labels !== labels || !!k.pinned !== n.pinned || !!k.archived !== n.archived) changed++;
    return { id: n.id, kind: n.kind, title: n.title, text: n.text, labels, color: n.color ?? null, pinned: n.pinned ? 1 : 0, archived: n.archived ? 1 : 0, created_at: n.createdAt ?? null, updated_at: n.updatedAt ?? null, url: n.url, synced_at: now };
  });
  const seen = new Set(notes.map((n) => n.id));
  const remove = full ? [...known.keys()].filter((id) => !seen.has(id)) : [];
  const total = new Set([...known.keys(), ...seen]).size - remove.length;
  const message = [t("{n} new", { n: added }), t("{n} changed", { n: changed }), ...(remove.length ? [t("{n} removed", { n: remove.length })] : []), t("{n} in all", { n: total })].join(" · ");
  return { rows, remove, added, changed, removed: remove.length, total, message };
}
