/** A recipient marked as an account of yours (own), a credit account (credit) or neither: the preference finances.ownAccounts as it becomes — the flow keeps it (a lambda only reads). event: { key, kind }. */
export async function handler(event, context) {
  const key = String(event?.key ?? "").trim();
  if (!key) throw new Error("No recipient.");
  const all = { ...((await context.zeff.call("pref.get", { key: "finances.ownAccounts" })).value ?? {}) };
  if (event?.kind === "own" || event?.kind === "credit") all[key] = event.kind;
  else delete all[key];
  return { value: all };
}
