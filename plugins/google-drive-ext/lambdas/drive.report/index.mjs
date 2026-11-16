import { tFor } from "./lib.mjs";

const summary = (parts) => parts.filter(([n]) => n > 0).map(([, text]) => text).join(" · ");
const errorOf = (r) => (r && typeof r === "object" && typeof r.error === "string" && r.error ? r.error : "");

/** What a sync says when it is done, as the built-in said it ({ ok, message } — the Sync menu shows it). */
export async function handler(event, context) {
  const t = tFor(context.language);
  const plan = event?.plan ?? {};
  const ups = Array.isArray(event?.ups) ? event.ups : [];
  const names = (plan.uploads ?? []).map((u) => u.name);

  if (event?.kind === "backups") {
    // (the first upload that failed ends the sync, as the built-in's did)
    const at = ups.findIndex((r) => errorOf(r));
    const uploaded = at < 0 ? ups.filter((r) => r).length : ups.slice(0, at).filter((r) => r).length;
    if (at >= 0) return { ok: false, message: `${names[at]}: ${errorOf(ups[at])}${uploaded ? ` (${t("{n} uploaded before", { n: uploaded })})` : ""}` };
    const removed = Array.isArray(event?.removed) ? event.removed.length : 0;
    const withheld = Number(plan.withheld) || 0;
    const text = summary([
      [uploaded, t("{n} uploaded", { n: uploaded })],
      [removed, t("{n} removed (the retention)", { n: removed })],
      [withheld, t("{n} not uploaded: no password set", { n: withheld })],
    ]);
    return { ok: true, message: text || t("Everything is in Drive already.") };
  }

  const pulls = Array.isArray(event?.pulls) ? event.pulls : [];
  const planned = plan.pulls ?? [];
  const upFailed = ups.map((r, i) => (errorOf(r) ? `${names[i]}: ${errorOf(r)}` : "")).filter(Boolean);
  const pullFailed = pulls.map((r, i) => (errorOf(r) ? `${planned[i]?.name}: ${errorOf(r)}` : "")).filter(Boolean);
  const uploaded = ups.filter((r) => r && !errorOf(r)).length;
  const pulled = pulls.filter((r) => r && !errorOf(r)).length;
  const failed = (Number(plan.failed) || 0) + upFailed.length + pullFailed.length;
  const text = summary([
    [uploaded, t("{n} uploaded", { n: uploaded })],
    [pulled, t("{n} came in from Drive", { n: pulled })],
    [failed, t("{n} failed", { n: failed })],
  ]);
  const note = upFailed[0] || plan.note || pullFailed[0] || "";
  return { ok: failed === 0, message: [text || t("Everything is in sync."), note].filter(Boolean).join(" — ") };
}
