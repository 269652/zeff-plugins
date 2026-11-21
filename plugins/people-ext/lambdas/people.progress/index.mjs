import { tFor } from "./lib.mjs";

/**
 * What runs in the background for People (the overview reads it every few seconds): the search for everyone's dates and the compiling of the summaries, as the
 * built-in's overview words them (the kernel's read `people.progress`).
 */
export async function handler(event, context) {
  const t = tFor(context.language);
  const p = await context.zeff.call("people.progress", {});
  const datesProgress = p.dates ? t("Searching dates… {done} of {total} · {found} found", p.dates) : "";
  const compileProgress = p.compile ? `${t("Compiling … {done} of {total}", { done: p.compile.done, total: p.compile.total })}${p.compile.current ? ` · ${p.compile.current}` : ""}` : "";
  return { datesProgress, compileProgress, running: !!p.dates || !!p.compile };
}
