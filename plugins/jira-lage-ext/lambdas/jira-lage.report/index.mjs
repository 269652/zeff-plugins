/**
 * What the Board-Lage step says in the Sync menu and whether it went: the review's counts (reviewed, unchanged, failed), the note of what went wrong reading
 * Jira, in the language you use — the built-in's own words (core.ts boardLageMessage, bundled).
 */
import { boardLageMessage, tFor } from "./lib.mjs";

const yes = (v) => v === true || v === "true";
const num = (v) => Number(v) || 0;

export async function handler(event, context) {
  const t = tFor(context.language);
  const note = String(event?.note ?? "").trim();
  const reviewed = num(event?.reviewed);
  const unchanged = num(event?.unchanged);
  const failed = num(event?.failed);
  const error = note || String(event?.error ?? "").trim();
  const result = {
    ok: failed === 0 || reviewed > 0,
    all: yes(event?.all),
    relevant: reviewed + unchanged + failed,
    analyzed: reviewed,
    unchanged,
    failed,
    ...(error ? { error: error.slice(0, 300) } : {}),
  };
  return boardLageMessage(result, t);
}
