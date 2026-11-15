// The plugin's two tables, read through Zeff (a lambda reads its plugin's stores; the flows write them):
//   notion-ext.links — what is synced: a Notion page, database or row and its Zeff page, with how both looked at the last sync;
//   notion-ext.state — the sync's own state (the newest edit read, whether more is left …), by name.
// (Copied into each lambda as store.mjs: scripts/copy-lib.mjs.)

export const LINKS = "notion-ext.links";
export const STATE = "notion-ext.state";

export async function rowsOf(zeff, store, where) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const { rows, total } = await zeff.call("store.query", { store, ...(where ? { where } : {}), limit: 500, offset });
    out.push(...(rows ?? []));
    if (!rows?.length || out.length >= (total ?? 0)) return out;
  }
}

export const json = (s, fallback) => {
  if (s && typeof s === "object") return s;
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

/** The sync's state: name → value (texts). */
export async function stateOf(zeff) {
  return Object.fromEntries((await rowsOf(zeff, STATE)).map((r) => [r.name, r.value ?? ""]));
}

/** The links, and lookups both ways (Notion id → Zeff id, Zeff id → Notion id). */
export async function linksOf(zeff) {
  const links = await rowsOf(zeff, LINKS);
  const byNotion = new Map(links.map((l) => [l.notion_id, l]));
  const byZeff = new Map(links.map((l) => [Number(l.zeff_id), l]));
  return {
    links,
    byNotion,
    byZeff,
    zeffOf: (id) => (byNotion.get(id)?.zeff_id ? Number(byNotion.get(id).zeff_id) : null),
    notionOf: (z) => byZeff.get(Number(z))?.notion_id ?? null,
  };
}
