import { groupSessions, modeText, priorityOf, stamp, tFor } from "./lib.mjs";

/**
 * What the Code screen shows (views/work.html reads it as data.x): the session list (grouped and sorted like the built-in's sidebar), and — by what is picked —
 * a session's conversation, a ticket's page or the new-session page. The kernel's reads work.session-list and work.session-open do the looking (the engine's own);
 * this shapes it for the view language: every line already a row of text, every ask already its buttons.
 * event: { sel ("run:12" | "ticket:ABC-1" | "ticket:-" | ""), q, sort, archived, tail, branches, all, msg, qpick, qo0..qo3, cprov, cmode, cmodel, ceffort, crepo, cws, cbrowse, cdir, cuse }
 */
/** How long, as the built-in's runs say it (src/lib/work/shared.ts duration). */
const duration = (ms) => {
  if (!ms || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")} h` : `${m}:${String(s % 60).padStart(2, "0")} min`;
};
const DOT = { running: "🔵", queued: "⚪", done: "🟢", failed: "🔴", cancelled: "⚪", interrupted: "🟠" };

/**
 * The log as a conversation (like the Code tab always showed it): the worker's words, its tool calls — and what came of them — grouped between them (more than four:
 * folded into one line), what you wrote meanwhile, what happened to the session.
 */
function blocksOf(lines, t) {
  const blocks = [];
  let n = 0;
  for (const l of lines) {
    const last = blocks[blocks.length - 1];
    const id = n++;
    if (l.k === "say") blocks.push({ id, t: "say", text: l.text ?? "" });
    else if (l.k === "tool" || l.k === "out" || l.k === "ask" || l.k === "deny") {
      const step = {
        kind: l.k,
        tool: l.k === "tool" ? l.tool : "",
        text: l.text ?? "",
        bad: (l.k === "out" && !!l.error) || l.k === "deny" || (l.k === "ask" && l.ok === false),
        answer: l.k === "ask" && l.answer ? l.answer : "",
        // (what unfolds under it: an edit's old and new text, a tool's whole input, a long output whole)
        diffs: Array.isArray(l.diff) ? l.diff.map((d) => ({ old: d.old ?? "", new: d.new ?? "" })) : [],
        detail: l.detail ?? "",
        plan: l.k === "tool" && l.tool === "ExitPlanMode",
        full: l.full ?? "",
      };
      step.more = step.diffs.length > 0 || !!step.detail;
      if (last?.t === "steps") last.steps.push(step);
      else blocks.push({ id, t: "steps", steps: [step] });
    } else if (l.k === "raw") {
      if (last?.t === "raw") last.text += `\n${l.text}`;
      else blocks.push({ id, t: "raw", text: l.text ?? "" });
    } else if (l.k === "you") blocks.push({ id, t: "you", text: l.text ?? "", note: l.images ? "🖼 " + t("{n} image(s)", { n: l.images }) : "" });
    else if (l.k === "shell") blocks.push({ id, t: "shell", cmd: "! " + (l.cmd ?? ""), text: l.text ?? "", bad: !l.ok });
    else if (l.k === "note") blocks.push({ id, t: "note", text: l.text ?? "" });
  }
  for (const b of blocks) {
    if (b.t !== "steps") continue;
    const calls = b.steps.filter((x) => x.kind === "tool");
    const names = [...new Set(calls.map((x) => x.tool))];
    b.fold = b.steps.length > 4;
    b.title = calls.length === 1 ? t("1 step") : t("{n} steps", { n: calls.length });
    b.names = names.length ? "· " + names.slice(0, 5).join(", ") + (names.length > 5 ? " …" : "") : "";
  }
  return blocks;
}

export async function handler(event, context) {
  const zeff = context.zeff;
  const t = tFor(context.language);
  const sel = String(event?.sel ?? "");
  const run = /^run:(\d+)$/.test(sel) ? Number(sel.slice(4)) : 0;
  const ticketArg = sel.startsWith("ticket:") ? (sel.slice(7) === "-" ? "" : sel.slice(7).toUpperCase()) : undefined;
  const sort = ["newest", "priority", "ticket", "alpha"].includes(String(event?.sort)) ? String(event.sort) : "newest";
  const showArchived = String(event?.archived) === "true" || event?.archived === true;
  const words = String(event?.q ?? "").trim().toLowerCase();

  const base = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() ?? String(p);
  const CLAUDE = ["default", "acceptEdits", "auto", "plan", "dontAsk", "bypassPermissions"];
  /** A mode's name and what it does — Claude's translated (mode-text.ts), another driver's as it gives them. */
  const modeName = (m) => (CLAUDE.includes(m.id) ? modeText(t, m.id) : { label: t(m.label), hint: t(m.hint) });
  /** A mode's tone as the quiet pick's colour: the riskier, the louder. */
  const TONE = { danger: "bad", warn: "warn", info: "info" };
  const statusText = (s) => ({ queued: t("queued"), running: t("working"), done: t("done"), failed: t("failed"), cancelled: t("stopped"), interrupted: t("interrupted") })[s] ?? s;
  const ago = (iso) => {
    const at = stamp(iso);
    if (!at) return "";
    const min = Math.max(0, Math.round((Date.now() - at) / 60000));
    return min < 1 ? t("now") : min < 60 ? `${min}m` : min < 1440 ? `${Math.floor(min / 60)}h` : min < 14 * 1440 ? `${Math.floor(min / 1440)}d` : `${Math.floor(min / (7 * 1440))}w`;
  };
  const when = (iso) => (iso ? new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).toLocaleString(context.language === "de" ? "de-DE" : context.language === "es" ? "es-ES" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");

  // ── the list
  const list = await zeff.call("work.session-list", { archived: showArchived });
  const found = list.tickets
    .map((tk) => ({ ...tk, sessions: tk.sessions.filter((s) => !words || `${tk.ticket} ${tk.summary ?? ""} ${s.title} ${s.branch ?? ""}`.toLowerCase().includes(words)) }))
    .filter((tk) => tk.sessions.length);
  const headings = { all: "", today: t("Today"), yesterday: t("Yesterday"), week: t("Previous 7 days"), older: t("Earlier"), waiting: t("Needs you"), working: t("Working"), attention: t("Failed or cut off"), other: t("Other"), ticket: "" };
  let left = event?.all === true || String(event?.all) === "true" ? Infinity : 60;
  const take = (rows) => {
    const r = rows.slice(0, Math.max(0, left));
    left -= r.length;
    return r;
  };
  const grouped = groupSessions(found, sort, Date.now());
  const groups = grouped.map((g) => ({
    key: g.key,
    heading: g.id === "ticket" ? "" : headings[g.id],
    ticket: g.id === "ticket" ? g.ticket || t("No ticket") : "",
    ticketKey: g.id === "ticket" ? g.ticket || "-" : "",
    summary: g.summary ?? "",
    n: g.rows.length,
    items: take(g.rows).map((s) => ({
      id: s.id,
      todoId: s.todoId,
      title: s.title,
      ticket: g.id !== "ticket" ? s.ticket : "",
      ago: ago(s.at),
      dot: s.waiting ? "🟡" : (DOT[s.status] ?? "⚪"),
      tone: s.waiting ? "warn" : ({ running: "run", queued: "queued", done: "done", failed: "bad", cancelled: "off", interrupted: "warn" })[s.status] ?? "off",
      tip: `${s.ref} · ${statusText(s.status)}${s.ticket ? ` · ${s.ticket}` : ""}${s.branch ? ` · ⎇ ${s.branch}` : ""}`,
      archived: s.archived,
      active: s.status === "running" || s.status === "queued",
      selected: s.id === run,
    })),
  }));
  const out = {
    mode: run ? "session" : ticketArg !== undefined ? "ticket" : "new",
    groups,
    total: groups.reduce((n, g) => n + g.items.length, 0),
    hidden: grouped.reduce((n, g) => n + g.rows.length, 0) - groups.reduce((n, g) => n + g.items.length, 0),
    gitMissing: list.gitMissing ?? "",
    settingsHref: list.settingsPage ? "/workspace/" + list.settingsPage : "/settings/time#work",
    tabs: list.tabs ?? [],
    archivedCount: list.archivedCount,
    running: list.running,
    labels: {
      nothing: t("Nothing found."),
      newTitle: t("What should we work on?"),
      newHint: list.running ? t("Ask a question or give a task — on a ticket, in its repo or one you pick. Sessions run side by side ({n} working now).", { n: list.running }) : t("Ask a question or give a task — on a ticket, in its repo or one you pick. Sessions run side by side."),
      showArchived: t("Show archived ({n})", { n: list.archivedCount }),
      showMore: t("Show more ({n})", { n: grouped.reduce((n, g) => n + g.rows.length, 0) - groups.reduce((n, g) => n + g.items.length, 0) }),
    },
  };

  // ── the message box's options (the new-session page, a ticket's page): provider, mode, model, effort, repo, where it works
  if (!run) {
    const c = await zeff.call("work.composer", { tickets: ticketArg ?? "" });
    const prov = c.providers.some((p) => p.id === event?.cprov) ? String(event.cprov) : c.defaultProvider;
    const ch = c.choices[prov];
    const pick = (list, want, def) => (list.some((x) => x.id === want) ? want : def);
    const mode = ch ? pick(ch.modes, event?.cmode, ch.defaultMode) : "";
    const model = ch && ch.models.some((m) => m.value === event?.cmodel) ? String(event.cmodel) : "";
    const efforts = ["", "low", "medium", "high", "xhigh", "max"].filter((e) => {
      const m = ch?.models.find((x) => x.value === model);
      return e === "" || !m?.efforts || m.efforts.includes(e);
    });
    const effort = event?.ceffort === "@none" ? "" : efforts.includes(String(event?.ceffort ?? "")) && event?.ceffort ? String(event.ceffort) : ch?.defaultEffort ?? "";
    const inferred = ticketArg ? (c.ticketRepos[ticketArg] ?? "") : "";
    const repo = event?.cuse ? String(event.cuse) : c.repos.some((r) => r.path === event?.crepo) ? String(event.crepo) : inferred;
    // The folder picker: any folder of this computer (the registered repos are the shortcuts), and the branches of the one chosen.
    const browsing = String(event?.cbrowse) === "1" || event?.crepo === "@browse";
    let folders = null;
    if (browsing) {
      const l = await zeff.call("work.folders", { path: String(event?.cdir ?? "") });
      folders = l.ok ? { ok: true, path: l.path, parent: l.parent, repo: l.repo, dirs: l.dirs.map((d) => ({ name: (d.repo ? "⎇ " : "") + d.name, path: d.path })) } : { ok: false, error: l.error, path: "", parent: "", dirs: [] };
    }
    const br = repo ? await zeff.call("work.branches", { path: repo }) : null;
    const branchOf = String(event?.cbranch ?? "");
    const ws = ["worktree", "branch", "checkout"].includes(String(event?.cws)) ? String(event.cws) : "";
    out.composer = {
      provider: prov,
      live: !!ch,
      providers: c.providers.map((p) => ({ id: p.id, label: p.label, sel: p.id === prov })),
      modes: (ch?.modes ?? []).map((m) => ({ id: m.id, label: t(m.label), hint: t(m.hint), sel: m.id === mode })),
      mode,
      models: (ch?.models ?? []).map((m) => ({ value: m.value, label: m.label || t("Default (the CLI's)"), sel: m.value === model })),
      model,
      showEffort: !!ch?.effort,
      efforts: efforts.map((e) => ({ value: e, label: e || t("The model's default"), sel: e === effort })),
      effort,
      admin: !!ch?.admin,
      repos: [{ path: "", name: inferred ? t("As Zeff infers it") : t("None"), sel: !repo }, ...c.repos.map((r) => ({ path: r.path, name: r.name, sel: r.path === repo }))],
      repo,
      repoNow: repo ? repo : t("As Zeff infers it"),
      browsing,
      folders,
      branches: br?.ok ? br.branches.filter((b) => !b.remote).slice(0, 40).map((b) => ({ name: b.name, label: (b.current ? "● " : "") + b.name, sel: b.name === branchOf })) : [],
      workspaces: [
        { id: "", label: t("As set in the Code settings"), sel: !ws },
        { id: "worktree", label: t("A worktree of its own"), sel: ws === "worktree" },
        { id: "branch", label: t("A branch"), sel: ws === "branch" },
        { id: "checkout", label: t("In the checkout"), sel: ws === "checkout" },
      ],
      workspace: ws,
      // The message box's row (the built-in's quiet picks): ticket, folder, branch, isolation, backend, mode, model, effort.
      ticketOptions: JSON.stringify([["", t("No ticket")], ...list.tickets.filter((x) => x.ticket).map((x) => [x.ticket, x.ticket + (x.summary ? " · " + String(x.summary).slice(0, 40) : "")])]),
      repoOptions: JSON.stringify([
        ["", "📁 " + (repo && !event?.crepo && !event?.cuse ? base(repo) : t("Repo: the ticket's"))],
        ...c.repos.map((r) => [r.path, "📁 " + r.name]),
        ...(event?.cuse && !c.repos.some((r) => r.path === event.cuse) ? [[String(event.cuse), "📁 " + base(String(event.cuse))]] : []),
        ["@browse", "📁 " + t("Choose another folder …")],
      ]),
      repoPick: event?.cuse ? String(event.cuse) : event?.crepo === "@browse" ? "@browse" : c.repos.some((r) => r.path === event?.crepo) ? String(event.crepo) : "",
      branchOptions: br?.ok ? JSON.stringify([["", "⎇ " + (br.current ? t("{b} (current)", { b: br.current }) : t("default branch"))], ...br.branches.map((b) => [b.name, b.name + (b.remote ? " (remote)" : "") + (b.worktree ? " - in a worktree" : b.current ? " - checked out" : "")])]) : "",
      branchError: br && !br.ok ? br.error : "",
      wsOptions: JSON.stringify([["", t("Default isolation")], ["worktree", t("New branch in a worktree")], ["branch", t("This branch in a worktree")], ["checkout", t("In the repo itself")]]),
      providerOptions: c.providers.length > 1 ? JSON.stringify([["", t("Default backend")], ...c.providers.map((p) => [p.id, p.label])]) : "",
      // (a pick's "" is its default — the state starts empty; "@none": the model's own effort where a default effort is set)
      modeOptions: ch ? JSON.stringify(ch.modes.map((m) => [m.id === ch.defaultMode ? "" : m.id, t("Mode: {m}", { m: modeName(m).label })])) : "",
      modeTip: ch ? modeName(ch.modes.find((m) => m.id === mode) ?? ch.modes[0] ?? { id: "", label: "", hint: "" }).hint : "",
      modeTone: ch ? TONE[ch.modes.find((m) => m.id === mode)?.tone] ?? "" : "",
      modelOptions: ch ? JSON.stringify(ch.models.map((m) => [m.value, m.value ? m.label : t("Model: default")])) : "",
      effortOptions: ch?.effort ? JSON.stringify(efforts.map((e) => [e === (ch.defaultEffort ?? "") ? "" : e || "@none", e ? t("Effort: {e}", { e }) : t("Effort: default")])) : "",
      files: ((await zeff.call("work.attachments", { scope: "new" })).files ?? []).map((x) => ({ ref: x.ref, name: x.name, size: `${Math.max(1, Math.round(x.size / 1024))} KB` })),
      labels: { browse: t("Choose another folder …"), up: t("Up"), use: t("Use this folder"), go: t("Go"), folder: t("Folder"), branches: t("Branches"), options: t("Options"), provider: t("Backend"), mode: t("Mode"), model: t("Model"), effort: t("Effort"), repo: t("Repo"), where: t("Where it works"), branch: t("Branch (optional)") },
    };
  }

  // ── sessions that hold a worker without working
  const dang = await zeff.call("work.dangling", {});
  out.dangling = {
    n: dang.dangling.length,
    text: dang.dangling.length ? t("{n} sessions count as running but aren't working:", { n: dang.dangling.length }) + " " + dang.dangling.map((d) => `${d.ref} (${d.why})`).join(", ") : "",
  };

  // ── a ticket's page
  if (!run && ticketArg !== undefined) {
    const tk = list.tickets.find((x) => x.ticket === ticketArg);
    out.ticketPage = {
      ticket: ticketArg,
      title: ticketArg || t("No ticket"),
      url: tk?.url ?? "",
      summary: tk?.summary ?? "",
      sessions: (tk?.sessions ?? []).map((s) => ({ id: s.id, ref: s.ref, title: s.title, status: s.waiting ? t("waiting for you") : statusText(s.status), tone: ({ running: "run", queued: "plain", done: "done", failed: "bad", cancelled: "off", interrupted: "warn" })[s.status] ?? "plain", at: when(s.at) })),
      facts: tk ? [tk.status, tk.assignee, tk.issueType].filter(Boolean).join(" · ") : "",
      openLabel: t("open ↗"),
      placeholder: ticketArg ? t("New session on {ticket} — what should we work on?", { ticket: ticketArg }) : t("New session — what should we work on?"),
      sessionsLabel: t("Sessions ({n})", { n: tk?.sessions.length ?? 0 }),
    };
  }

  // ── a session
  if (run) {
    const s = await zeff.call("work.session-open", { run, tail: Number(event?.tail) || 150 });
    if (!s.found) {
      out.session = { found: false, error: s.error };
    } else {
      const live = s.live;
      const status = s.last.status;
      const liveText = live?.kind === "session" ? (live.asks.length ? t("waits for your answer") : live.host === "starting" ? t("starting") : live.busy ? t("working") : t("waiting for you")) : live?.kind === "live" ? (live.permission ? t("asks for permission") : live.busy ? t("working") : t("waiting for you")) : statusText(status);
      const BACKEND = { claude: "Claude CLI", copilot: "Copilot CLI", codex: "ChatGPT", zeff: "Zeff", agent: "Agent (MCP)" };
      const turns = s.turns.map((turn, ti) => {
        const blocks = blocksOf(turn.lines, t);
        const active = turn.status === "queued" || turn.status === "running";
        const lastTurn = ti === s.turns.length - 1;
        // (the newest steps of the one at work stay in sight while it works)
        if (active && lastTurn && blocks.length && blocks[blocks.length - 1].t === "steps") blocks[blocks.length - 1].working = true;
        for (const b of blocks) if (b.t === "steps") b.shown = b.fold ? b.steps.filter((x, i) => x.kind === "ask" || (b.working && i >= b.steps.length - 3)) : b.steps;
        const lastSay = [...blocks].reverse().find((b) => b.t === "say");
        const summary = turn.summary ?? "";
        const asked = live?.kind === "session" ? live.asks.length > 0 : false;
        const waiting = live?.kind === "session" ? asked || !live.busy : live?.kind === "live" ? !live.busy : false;
        return {
          runId: turn.runId,
          ref: turn.ref,
          label: turn.label,
          ask: turn.ask ?? "",
          cut: turn.cut ? t("{n} earlier lines are cut.", { n: turn.cut }) : "",
          blocks,
          active,
          // What it is doing now (under the newest answer while it works) — with a spinner while it works.
          doing: active ? (turn.status === "queued" ? t("Waiting for a free worker …") : asked ? t("It asks you — below") : waiting && lastTurn ? t("Waiting for you") : t("Working …")) : "",
          spin: active && !(lastTurn && waiting),
          summary: !active && summary && !(lastSay && (lastSay.text.trim() === summary || lastSay.text.includes(summary))) ? summary : "",
          draft: !active && turn.draft && summary !== turn.draft ? turn.draft : "",
          draftLabel: t("Draft") + (turn.channel ? " · " + turn.channel : ""),
          error: !active ? (turn.error ?? "") : "",
          errors: !active && turn.error && turn.errors?.length && !turn.error.includes(turn.errors[turn.errors.length - 1]) ? turn.errors.join("\n") : "",
          gitSummary: !active ? (turn.gitSummary ?? "") : "",
          empty: !active && !blocks.length && !summary && !turn.error ? t("No answer.") : "",
          // Which backend and model answered, how long it took, what it cost.
          meta: active
            ? ""
            : [BACKEND[turn.provider] ?? turn.provider, turn.model ?? (["claude", "copilot", "codex"].includes(turn.provider) ? t("default model") : null), duration(turn.durationMs), turn.turnsTaken ? t("{n} turns", { n: turn.turnsTaken }) : null, turn.costUsd != null ? `$${turn.costUsd.toFixed(2)}` : null].filter(Boolean).join(" · ") + (turn.outcome && turn.outcome !== "done" ? ` · ${turn.outcome}` : ""),
          metaTip: turn.sessionId ? t("Session {id}", { id: turn.sessionId }) : "",
        };
      });
      const modes = live?.kind === "session" ? live.modes.map((m) => ({ id: m.id, label: t(m.label), hint: t(m.hint), sel: m.id === live.mode })) : [];
      // The questions of an ask: what is picked (qpick: { question: [labels] }) and your own words (qo0 … qo3), as the built-in's card keeps them.
      let picked = {};
      try {
        const v = JSON.parse(String(event?.qpick ?? "{}"));
        if (v && typeof v === "object" && !Array.isArray(v)) picked = v;
      } catch {
        picked = {};
      }
      const asks =
        live?.kind === "session"
          ? live.asks.map((a, ai) => {
              const qs = (a.input.questions ?? []).map((q, qi) => {
                const mine = Array.isArray(picked[q.question]) ? picked[q.question] : [];
                const other = String(event?.["qo" + qi] ?? "").trim();
                return {
                  question: q.question,
                  header: q.header ?? "",
                  idx: qi,
                  multi: !!q.multiSelect,
                  other,
                  ready: mine.length > 0 || !!other,
                  answer: [...mine, ...(other ? [other] : [])].join(", "),
                  options: (q.options ?? []).map((o) => {
                    const on = mine.includes(o.label);
                    const next = q.multiSelect ? (on ? mine.filter((x) => x !== o.label) : [...mine, o.label]) : [o.label];
                    return { label: o.label, description: o.description ?? "", on, mark: on ? "● " : "", next: JSON.stringify({ ...picked, [q.question]: next }) };
                  }),
                };
              });
              return {
                requestId: a.requestId,
                tool: a.tool,
                plan: a.tool === "ExitPlanMode",
                question: a.tool === "AskUserQuestion",
                title: a.tool === "ExitPlanMode" ? t("Its plan — go ahead?") : a.tool === "AskUserQuestion" ? t("It asks you") : t("It wants to use {tool}", { tool: a.tool }),
                description: a.description ?? "",
                detail: a.input.file_path ? a.input.file_path + (a.input.command ? "\n" + a.input.command : "") : a.input.command || a.input.url || a.input.pattern || "",
                diff: (a.diffs ?? []).map((d) => "- " + d.old + "\n+ " + d.new).join("\n\n"),
                // (as the built-in's card shows it: the file, the edit coloured — or the command on a dark ground, the address, the whole input)
                detailPath: a.input.file_path ?? "",
                diffs: a.diffs ?? [],
                command: !(a.diffs ?? []).length ? a.input.command || "" : "",
                url: !(a.diffs ?? []).length && !a.input.command ? a.input.url || a.input.pattern || "" : "",
                reason: a.reason && a.reason !== "This command requires approval" ? a.reason : "",
                planText: a.input.plan || t("(no plan text)"),
                always: !!a.alwaysLabel,
                alwaysLabel: a.alwaysLabel ? t("Always: {rule}", { rule: a.alwaysLabel }) : "",
                alwaysTip: a.alwaysLabel ? t("Allow, and from now on: {rule}", { rule: a.alwaysLabel }) : "",
                questions: qs,
                has0: qs.length > 0,
                has1: qs.length > 1,
                has2: qs.length > 2,
                has3: qs.length > 3,
                qt0: qs[0]?.question ?? "",
                qt1: qs[1]?.question ?? "",
                qt2: qs[2]?.question ?? "",
                qt3: qs[3]?.question ?? "",
                submit: JSON.stringify(Object.fromEntries(qs.map((q) => [q.question, q.answer]))),
                ready: qs.every((q) => q.ready),
                more: ai === 0 && live.asks.length > 1 ? t("(+{n} more)", { n: live.asks.length - 1 }) : "",
                first: ai === 0,
                bypass: !!live.allowBypass,
              };
            })
          : [];
      // Only the first ask is asked at a time, like the built-in's card.
      const askNow = asks.slice(0, 1);
      // The message box: /commands at the start, @files anywhere, !shell, the pictures waiting.
      const msg = String(event?.msg ?? "");
      let menu = [];
      let menuKind = "";
      if (live?.kind === "session" && status === "running") {
        const slash = /^\/([\w:.-]*)$/.exec(msg);
        const at = /(^|\s)@([^\s@]*)$/.exec(msg);
        if (slash && (live.features ?? []).includes("commands")) {
          const q = slash[1].toLowerCase();
          menu = live.commands
            .filter((x) => x.name.toLowerCase().includes(q))
            .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
            .slice(0, 12)
            .map((x) => ({ next: "/" + x.name + " ", label: "/" + x.name + (x.hint ? " " + x.hint : ""), hint: x.description }));
          menuKind = "/";
        } else if (at) {
          const r = await zeff.call("work.session-files", { run, q: at[2] });
          menu = (r.files ?? []).slice(0, 12).map((f) => ({ next: msg.slice(0, msg.length - at[2].length - 1) + "@" + f + " ", label: f, hint: "" }));
          menuKind = "@";
        }
      }
      const attachScope = "run:" + run;
      const files = ((await zeff.call("work.attachments", { scope: attachScope })).files ?? []).map((x) => ({ ref: x.ref, name: x.name, size: Math.max(1, Math.round(x.size / 1024)) + " KB" }));
      const hostText = live?.kind === "session" ? (live.host === "starting" ? (live.sessionElevated ? t("starting as administrator — confirm Windows' prompt (UAC)") : t("starting …")) : live.host === "down" ? t("restarting …") : live.asks.length ? t("waits for your answer") : live.busy ? t("working …") : t("waiting for you")) : "";
      const models = live?.kind === "session" ? [...(live.models.some((m) => m.value === live.model) ? [] : [{ value: live.model ?? "", label: live.model || t("Default model") }]), ...live.models].map((m) => ({ value: m.value, label: m.label, sel: m.value === (live.model ?? "") })) : [];
      const curMode = live?.kind === "session" ? live.modes.find((m) => m.id === live.mode) ?? live.modes[0] : null;
      const liveRow =
        live?.kind === "session"
          ? {
              mode: curMode?.id ?? live.mode,
              // (each pick's "" is what it is now — picking another switches it, and the pick goes back to "")
              modeOptions: JSON.stringify(live.modes.map((m) => [m.id === (curMode?.id ?? live.mode) ? "" : m.id, t("Mode: {m}", { m: modeName(m).label })])),
              modeTip: curMode ? modeName(curMode).hint : "",
              modeTone: TONE[curMode?.tone] ?? "",
              model: live.model ?? "",
              modelOptions: JSON.stringify([...(live.models.some((m) => m.value === live.model) ? [] : [[live.model ?? "", live.model || t("Default model")]]), ...live.models.map((m) => [m.value, m.label])].map(([v, l]) => [v === (live.model ?? "") ? "" : v || "@none", l])),
              effort: live.effort ?? "",
              effortOptions: (live.features ?? []).includes("effort") ? JSON.stringify(["", "low", "medium", "high", "xhigh", "max"].map((e) => [e === (live.effort ?? "") ? "" : e || "@none", e ? t("Effort: {e}", { e }) : t("Effort: default")])) : "",
              working: !!live.busy && !live.asks.length,
              dot: !!live.busy && !live.asks.length ? "run" : live.host !== "up" ? "run" : live.asks.length ? "warn" : "done",
              queued: live.queued ? t("{n} queued", { n: live.queued }) : "",
            }
          : null;
      const efforts = live?.kind === "session" && (live.features ?? []).includes("effort") ? ["", "low", "medium", "high", "xhigh", "max"].map((e) => ({ value: e, label: e ? t("Effort: {e}", { e }) : t("Effort: default"), sel: e === live.effort })) : [];
      out.session = {
        found: true,
        runId: s.last.id,
        title: s.todo?.text ?? s.last.summary ?? s.last.ref,
        statusText: liveText,
        pill: ({ running: "run", queued: "plain", done: "done", failed: "bad", cancelled: "off", interrupted: "warn" })[status] ?? "plain",
        active: s.active,
        status,
        tone: status === "failed" ? "bad" : status === "done" ? "good" : status === "interrupted" ? "warn" : "plain",
        elevated: s.last.elevated,
        elevatedLabel: t("Administrator"),
        ticket: s.ticket,
        noTicket: t("no ticket"),
        commitTitle: `${s.ticket ? `${s.ticket}: ` : ""}${s.todo?.text ?? ""}`.slice(0, 120),
        cardSummary: s.card?.summary ?? "",
        branch: s.last.branch ?? "",
        repoName: s.last.repo ? s.last.repo.split(/[\\/]/).filter(Boolean).pop() : "",
        worktree: !!s.last.cwd && !!s.last.repo && s.last.cwd !== s.last.repo,
        idle: !s.active,
        branchTip: s.active ? t("Working - switch the branch once it has answered") : t("Switch the branch of this session"),
        branchList: [],
        todoRef: s.todo?.ref ?? "",
        todoId: s.todo?.id ?? 0,
        cost: s.cost > 0 ? `$${s.cost.toFixed(2)}` : "",
        side: s.side,
        turns,
        kind: live?.kind ?? "",
        busy: !!live?.busy,
        host: live?.host ?? "",
        queued: live?.queued ?? 0,
        queuedLabel: live?.queued ? t("{n} message(s) wait their turn.", { n: live.queued }) : "",
        modes,
        asks: askNow,
        hasAsk: askNow.length > 0,
        models,
        efforts,
        hostText,
        live: liveRow,
        shellPendingLabel: live?.shellPending ? t("{n} command output(s) go along with your next message", { n: live.shellPending }) : "",
        features: live?.features ?? [],
        canShell: (live?.features ?? []).includes("shell"),
        isShell: msg.startsWith("!"),
        shellCmd: msg.startsWith("!") ? msg.slice(1).trim() : "",
        menu,
        menuKind,
        files,
        attachScope,
        panels: (list.panels ?? []).map((x, i) => ({ ...x, key: "x" + i })),
        paneOptions: (list.panels ?? []).map((x, i) => ",x" + i + ":" + String(x.title).replace(/[,:]/g, " ")).join(""),
        copilot: live?.kind === "live" ? { mode: live.mode, modes: (live.modes ?? []).map((m) => ({ id: m.id, name: m.name, sel: m.id === live.mode, hint: ({ agent: t("Asks you before it does anything that isn't allowed"), plan: t("Plans first, carries it out after your OK"), autopilot: t("Allows itself everything and runs through to the end") })[m.id.replace(/^.*#/, "")] ?? m.name })), waiting: live.waiting ?? "", idle: !live.busy, status: live.busy ? (live.permission ? t("waiting for your permission") : t("working…")) : t("waiting for you") } : null,
        permission: live?.kind === "live" && live.permission ? { title: live.permission.title, detail: live.permission.detail ?? "", options: live.permission.options } : null,
        lostLive: status === "running" && !live,
        canReplyLive: status === "running" && (live?.kind === "session" || live?.kind === "live"),
        error: status === "failed" ? (s.last.error ?? "") : "",
        // (a live session's box says what it takes, as Claude Code's does)
        placeholder: live?.kind === "session" && status === "running" ? (live.busy && !live.asks.length ? t("Message — it reads it after this step (Enter)") : t("Message (Enter) · / commands · @ files · ! shell · paste images")) : s.active ? (status === "queued" ? t("Waiting for a free worker … — your reply is sent after it") : t("Working … — your reply is sent as soon as it has answered")) : t("Reply …"),
        priority: priorityOf({ waiting: asks.length > 0, live: !!live, status }),
      };
    }
  }
  if (run && out.session?.found && (event?.branches === true || String(event?.branches) === "true")) {
    const b = await zeff.call("work.branches", { run });
    out.session.branchError = b.ok ? "" : b.error;
    out.session.branchList = (b.branches ?? []).map((x) => ({ name: x.name, remote: x.remote, current: x.current, worktree: x.worktree ?? "", disabled: x.current || !!x.worktree, tip: x.worktree ? t("Checked out in {path}", { path: x.worktree }) : "" }));
  }
  return out;
}
