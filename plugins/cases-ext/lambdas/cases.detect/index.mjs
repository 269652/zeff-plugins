import { findCases } from "./lib.mjs";

/** Every row of a store (pages of 500). */
async function all(zeff, store) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const { rows, total } = await zeff.call("store.query", { store, limit: 500, offset });
    out.push(...rows);
    if (!rows.length || out.length >= total) return out;
  }
}

/** The plan (the built-in's own core: findCases) out of what the kernel reads and the cases there are — nothing written here. */
export async function handler(_event, context) {
  const zeff = context.zeff;
  const optional = (p, empty) => p.catch(() => empty);
  const [{ messages }, { docs }, { todos }, people, cases, sources] = await Promise.all([
    zeff.call("mail.messages", { contains: "/" }),
    optional(zeff.call("documents.texts", {}), { docs: [] }),
    zeff.call("todos.texts", {}),
    optional(zeff.call("people.emails", {}).then((r) => r.people), null),
    all(zeff, "cases-ext.cases"),
    all(zeff, "cases-ext.sources"),
  ]);
  return findCases({
    mails: messages,
    docs,
    todos,
    people,
    cases: cases.map((c) => ({ id: c.id, key: c.key, label: c.label, status: c.status, personId: c.person_id, lastAt: c.last_at, updatedAt: c.updated_at })),
    sources: sources.map((s) => ({ caseId: s.case_id, ref: s.ref })),
    now: new Date().toISOString(),
  });
}
