import { accountOf, parseStatement } from "./lib.mjs";

/**
 * The kernel's service bank.statement: a statement's bookings and its account (the built-in's own core, lib.mjs). Throws when it is
 * none (no date or amount column) — the kernel says so.
 * @param {{ csv: string, name?: string }} event
 */
export async function handler(event) {
  const csv = String(event?.csv ?? "");
  const name = String(event?.name ?? "");
  return { account: accountOf(name, csv), bookings: parseStatement(csv) };
}
