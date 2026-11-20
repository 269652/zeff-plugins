import { fileStatusText, tFor } from "./lib.mjs";

/**
 * A session's Changes and Preview panes (views/work.html reads it as data.panes): the files it changed since it began with their diffs (each patch as lines
 * marked added / removed / context), and its dev servers. The kernel's read work.session-changes does the git; this shapes it.
 * event: { run }
 */
const TONE = { added: "good", untracked: "good", modified: "warn", deleted: "bad", renamed: "info" };

export async function handler(event, context) {
  const t = tFor(context.language);
  const run = Number(event?.run) || 0;
  if (!run) return { found: false };
  const c = await context.zeff.call("work.session-changes", { run });
  if (!c.found) return { found: false, error: c.error };
  const added = c.files.reduce((n, f) => n + f.added, 0);
  const removed = c.files.reduce((n, f) => n + f.removed, 0);
  return {
    found: true,
    error: c.error,
    summary: `${t("{n} file(s)", { n: c.files.length })} · +${added} −${removed}${c.base ? ` · ${t("since {base}", { base: c.base.slice(0, 8) })}` : ""}`,
    empty: !c.files.length,
    // (a few files: each shown open, as the built-in did up to eight)
    few: c.files.length <= 8,
    emptyText: t("No changes yet."),
    truncated: c.truncated ? t("Some diffs are too big to show — see git.") : "",
    files: c.files.map((f) => ({
      path: f.path,
      status: fileStatusText(t, f.status),
      tone: TONE[f.status] ?? "",
      added: f.added,
      removed: f.removed,
      binary: f.binary,
      binaryText: t("Binary file"),
      noPatch: !f.binary && !f.patch ? t("Too big to show here.") : "",
      patch: f.patch ?? "",
    })),
    noProcs: !c.procs.length ? t("No dev servers configured. Add them to .claude/launch.json in the repo (name, runtimeExecutable, runtimeArgs, port) — the same file Claude Code uses.") : "",
    procs: c.procs.map((p) => ({ name: p.name, running: p.running, url: p.url ?? "", showUrl: !!(p.running && p.url), log: p.log ?? "", dot: p.running ? "🟢" : "⚪" })),
  };
}
