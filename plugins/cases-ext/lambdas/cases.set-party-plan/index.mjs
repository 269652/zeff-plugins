export async function handler(event, context) {
  const z = context.zeff;
  const caseId = Number(event.case);
  const role = String(event.role ?? "");
  if (!caseId || !["creditor", "collector", "payee"].includes(role)) throw new Error("Unknown role.");
  const id = Number(event.made) || Number(event.personId) || null;
  const { rows } = await z.call("store.query", { store: "cases-ext.parties", where: { case_id: caseId, role } });
  const out = { put: [], del: [], cases: [] };
  if (id) out.put.push({ case_id: caseId, role, person_id: id, source: "manual" });
  else if (rows.length) out.del.push({ case_id: caseId, role });
  if (role === "creditor" && id) {
    const c = (await z.call("store.query", { store: "cases-ext.cases", where: { id: caseId }, limit: 1 })).rows[0];
    if (c && !c.person_id) out.cases.push({ id: caseId, person_id: id, updated_at: new Date().toISOString() });
  }
  return out;
}
