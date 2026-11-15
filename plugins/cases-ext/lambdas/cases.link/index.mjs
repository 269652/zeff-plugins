/** The plan's new sources as rows of the sources store: each with its case's id (from the cases as written — store.put's rows). */
export async function handler(event) {
  const ids = new Map((event.cases ?? []).map((c) => [c.key, c.id]));
  return { rows: (event.sources ?? []).filter((s) => ids.has(s.key)).map((s) => ({ case_id: ids.get(s.key), ref: s.ref, kind: s.kind, at: s.at, title: s.title })) };
}
