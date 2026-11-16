import { tFor } from "./lib.mjs";

/**
 * The widget "Debts in figures": what is open, the instalments a month, when you are debt-free and what is left of your income — or the same for what you are
 * owed. Its tiles are the Finances Kennzahlen by name (the kernel's metrics.stats gives them as the figure widgets show them: goal, tone, link).
 */
export async function handler(event, context) {
  const t = tFor(context.language);
  const config = event?.config ?? {};
  const picks =
    config.dir === "owed"
      ? [{ name: "Forderungen", detail: "Offene Forderungen" }, { name: "Rückzahlungen" }, { name: "Alles zurück in", detail: "Forderungen ohne Plan" }]
      : [
          { name: "Schuldenstand", detail: "Offene Schulden" },
          { name: "Tilgungsrate" },
          { name: "Schuldenfrei in", detail: "Schulden ohne Plan" },
          { name: "Frei im Monat", detail: "Fixkosten" },
        ];
  return context.zeff.call("metrics.stats", { names: String(config.names ?? ""), picks, empty: t("No metrics yet — Workspace → Metrics.") });
}
