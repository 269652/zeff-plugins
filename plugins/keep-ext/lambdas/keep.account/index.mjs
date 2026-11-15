import { tFor } from "./lib.mjs";

export async function handler(_event, context) {
  const t = tFor(context.language);
  return { account: String(context.secrets.ACCOUNT ?? "").trim() || "0", notRunning: t("The automation Chrome isn't running. Not synced.") };
}
