import { modeText, tFor } from "./lib.mjs";

/**
 * The Code settings as the screen draws them (views/work-settings.html reads it as data.s): the workers (how many, what they may do, where code work happens, model,
 * house rules), the live Claude sessions, the repos. The kernel's read work.settings does the looking; every choice comes as buttons with the current one marked.
 * event: {}
 */
export async function handler(_event, context) {
  const t = tFor(context.language);
  const d = await context.zeff.call("work.settings", {});
  const s = d.settings;
  const c = d.claude;
  const opt = (id, label, hint, now) => ({ id, label, hint, sel: id === now });
  const perm = [
    ["auto", t("Auto (recommended)"), t("Claude's classifier approves or refuses each action — risky ones (pushing, deleting, reaching out) are refused.")],
    ["acceptEdits", t("Edits only"), t("File edits yes; commands only those you already allowed in Claude Code — tests won't run otherwise.")],
    ["bypassPermissions", t("Allow everything"), t("No checks at all. Only if you fully trust the workers.")],
  ];
  const cop = [
    ["interactive", t("Interactive — asks you for permission")],
    ["autopilot", t("Autopilot — allows everything, runs through")],
    ["headless", t("No questions (as before) — refuses what isn't allowed")],
  ];
  const modes = ["default", "acceptEdits", "auto", "plan", "dontAsk", "bypassPermissions"].filter((m) => m !== "bypassPermissions" || c.allowBypass);
  const modeOpts = (now) => modes.map((m) => ({ ...opt(m, modeText(t, m).label, modeText(t, m).hint, now) }));
  const a = d.admin ? await context.zeff.call("work.admin", {}) : null;
  const boardName = new Map(d.choices.boards.map((b) => [b.id, b.name]));
  return {
    labels: {
      workers: t("Workers at once"),
      workersHint: t("1 to {max} — each is a session of its own (more at once: more of your usage).", { max: d.limits.maxParallel }),
    },
    parallel: s.parallel,
    parallelMore: Math.min(d.limits.maxParallel, s.parallel + 1),
    parallelLess: Math.max(1, s.parallel - 1),
    pools: d.pools.map((p) => {
      const n = s.reserved[p.source] ?? 0;
      return { source: p.source, label: t("Reserved for {name}", { name: p.label }), n, more: Math.min(d.limits.maxReserved, n + 1), less: Math.max(0, n - 1), hint: t("On top of the workers at once — only {name}'s runs take them, so they never wait for the others.", { name: p.label }) };
    }),
    permission: perm.map(([id, label, hint]) => opt(id, label, hint, s.permissionMode)),
    copilot: cop.map(([id, label]) => opt(id, label, "", s.copilotMode)),
    isolation: [
      opt("worktree", t("A worktree of its own (recommended)"), t("Each run gets a git worktree next to the repo on a new branch, from the ticket's branch or the default branch — your checkout and what's in progress there stay untouched."), s.isolation),
      opt("checkout", t("In the checkout"), t("On your current branch, with everything installed — one code run per repo at a time, no commits (changes stay for you to review)."), s.isolation),
    ],
    modelNow: s.model,
    models: [{ value: "", label: d.defaultModel ? t("{model} — as in Settings", { model: d.models.find((m) => m.value === d.defaultModel)?.label ?? d.defaultModel }) : t("The CLI's default — as in Settings"), sel: !s.model }, ...(s.model && !d.models.some((m) => m.value === s.model) ? [{ value: s.model, label: s.model, sel: true }] : []), ...d.models.filter((m) => m.value !== d.defaultModel).map((m) => ({ value: m.value, label: m.label, sel: m.value === s.model }))],
    agentCode: s.agentInstructions.code,
    agentOther: s.agentInstructions.other,
    instructions: s.instructions,
    claude: {
      live: c.live,
      mode: modeOpts(c.mode),
      autoMode: modeOpts(c.autoMode),
      effort: ["", "low", "medium", "high", "xhigh", "max"].map((e) => ({ id: e, label: e || t("The model's default"), sel: e === c.effort })),
      allowBypass: c.allowBypass,
      askTimeoutMin: c.askTimeoutMin,
      timeoutMore: Math.min(1440, c.askTimeoutMin + 5),
      timeoutLess: Math.max(0, c.askTimeoutMin - 5),
    },
    admin: d.admin,
    adminInfo: a && {
      windows: a.windows,
      elevated: a.elevated,
      task: a.task,
      how: a.mode === "task" && a.task ? t("Automatically — the scheduled task, no prompt") : t("Interactively — Windows asks you (UAC) each time"),
      taskText: a.task ? t("set up") : t("not set up"),
    },
    reposLine: d.repos.length ? d.repos.map((r) => `${r.name}${r.ok ? "" : ` ${t("(folder missing)")}`}`).join(", ") : t("none yet"),
    repos: d.repos.map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path,
      ok: r.ok,
      where: r.ok ? t("on {branch}", { branch: r.branch }) : t("folder missing"),
      gitlabProject: r.gitlabProject ?? "",
      boardsText: r.boards.join(", "),
      boards: r.boards.length ? r.boards.map((b) => boardName.get(b) ?? t("board {id}", { id: b })).join(", ") : t("no boards"),
      tickets: r.tickets.join(", "),
      instructions: r.instructions,
      systems: r.systems ?? "",
      systemsNote: r.systems ? "" : r.systemsRead ? t("The knowledge names no systems for this repo.") : t("Not read yet — the next Knowledge assignment does it, or read them now."),
      delivery: r.delivery,
      mr: r.delivery === "mr",
      direct: r.delivery === "direct",
    })),
    boardChoices: d.choices.boards.map((b) => ({ id: b.id, name: `${b.id} · ${b.name}` })),
    projects: d.choices.projects.map((p) => p.project).join(", "),
  };
}
