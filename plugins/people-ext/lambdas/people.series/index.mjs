import { filled, tFor } from "./lib.mjs";

/**
 * The days you were in touch with the people you are most in touch with, as daily series for the Correlations (1 on a day in touch, 0 on a day without, from their first
 * contact on) — the built-in's PEOPLE_SERIES, over the kernel's read \`people.contact-days\`. event: { from, to }.
 */
export async function handler(event, context) {
  const t = tFor(context.language);
  const range = { from: String(event?.from ?? ""), to: String(event?.to ?? "") };
  const r = await context.zeff.call("people.contact-days", range);
  return r.people.map((p) => ({
    id: `people:${p.id}:contact`,
    label: t("Contact with {name}", { name: p.name }),
    group: t("People"),
    kind: "binary",
    values: Object.fromEntries(filled(new Map(p.days.map((d) => [d, 1])), range, p.first || null)),
  }));
}
