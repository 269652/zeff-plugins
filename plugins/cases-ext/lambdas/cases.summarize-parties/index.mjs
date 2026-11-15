import { aiPartyRows } from "./lib.mjs";

export async function handler(event) {
  const [creditor, collector, payee] = event.ids ?? [];
  return { rows: aiPartyRows(event.caseId, { creditor: creditor ?? null, collector: collector ?? null, payee: payee ?? null }, event.parties ?? []) };
}
