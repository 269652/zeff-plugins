/**
 * A todo as a row of the screen, ready to draw — shared by the list (todos.screen) and the tickets (todos.lage): its words, ticket with the link, kind, when it is due and
 * how urgent that is, whether it repeats, whether it is flagged or set aside, what a worker or an agent says of it. `t`: the translator; `data`: todos.rows' answer
 * (its tickets' links).
 */
export function rowTools(t, lang) {
  const locale = { de: "de-DE", es: "es-ES", en: "en-GB" }[lang] ?? "en-GB";
  const day = (iso, year) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });
  const KINDS = { reply: t("Reply"), comment: t("Comment"), update: t("Update ticket"), implement: t("Implement"), fix: t("Fix"), test: t("Test"), review: t("Review"), clarify: t("Clarify"), document: t("Docs"), deploy: t("Deploy"), merge: t("Deliver"), other: t("Other") };
  const FREQ = { daily: t("every day"), weekly: t("every week"), monthly: t("every month"), yearly: t("every year") };
  const dueText = (d, due) => (d < 0 ? (d === -1 ? t("overdue (1 day)") : t("overdue ({n} days)", { n: -d })) : d === 0 ? t("due today") : d === 1 ? t("due tomorrow") : t("due {date}", { date: day(due) }));

  const minutes = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);
  const ORIGIN = { Calendar: t("From an appointment — no ticket"), Mail: t("From a mail — no ticket") };
  const view = (r, data) => {
    const links = (keys) => keys.map((k) => ({ key: k, url: data.tickets?.[k]?.url ?? "", title: data.tickets?.[k]?.summary ?? "" }));
    const closed = r.status !== "open";
    const asking = !closed && r.needsInput ? r.needsInput : "";
    const reported = !closed && !asking && r.workerDone && !r.workerDone.suggested ? r.workerDone : null;
    const suggested = !closed && !asking && r.workerDone && r.workerDone.suggested ? r.workerDone : null;
    const by = (w) => String(w.by).split(" · ")[0];
    const hasDue = !!r.due;
    const tone = !hasDue || closed ? "muted" : r.dueDays <= 0 ? "bad" : r.dueDays <= 3 ? "warn" : "muted";
    return {
      id: r.id,
      ref: r.ref,
      text: r.text,
      ticket: r.ticket,
      ticketUrl: data.tickets?.[r.ticket]?.url ?? "",
      ticketTitle: data.tickets?.[r.ticket]?.summary ?? "",
      ticketStatus: data.tickets?.[r.ticket]?.status ?? "",
      also: links(r.alsoTickets ?? []),
      kind: KINDS[r.kind] ?? KINDS.other,
      closed,
      done: r.status === "done",
      dismissed: r.status === "dismissed",
      waiting: r.owner === "other",
      flagged: !!r.flagged && !closed,
      deferred: !!r.deferred && !closed,
      backUp: !closed && r.bubbledUp ? t("back on top: {why}", { why: r.bubbledUp }) : "",
      asking,
      askingTip: asking ? t("The agent is waiting for you: {question}", { question: asking }) : "",
      due: r.due,
      dueLabel: hasDue ? dueText(r.dueDays, r.due) : t("due date"),
      dueTone: tone,
      repeat: r.repeats ? FREQ[r.repeats] : "",
      reported: reported ? t("{by}: reported done", { by: by(reported) }) : "",
      reportedTip: reported ? (reported.note ? t("{by} reports this done: {note} — tick it off to close it", { by: reported.by, note: reported.note }) : t("{by} reports this done — tick it off to close it", { by: reported.by })) : "",
      suggested: suggested ? t("{by}: suggests done", { by: by(suggested) }) : "",
      suggestedTip: suggested ? (suggested.note ? t("{by} suggests this is done: {note} — tick it to confirm", { by: suggested.by, note: suggested.note }) : t("{by} suggests this is done — tick it to confirm", { by: suggested.by })) : "",
      errorRun: !closed && r.lastError ? r.lastErrorRun || 0 : 0,
      lastError: !closed && r.lastError ? t("Last attempt failed: {error}", { error: r.lastError }) : "",
      note: r.note,
      source: !r.note && r.source ? t("Source: {source}", { source: r.source }) : "",
      state: r.status === "dismissed" ? t("Dismissed") : "",
      statusLabel: r.status === "dismissed" ? t("Dismissed") : "",
      doneAt: r.doneAt ? day(r.doneAt.slice(0, 10), true) : "",
      opsCount: r.opsCount,
      notesCount: r.notesCount,
      opsList: (r.opsTitles ?? []).map((text) => ({ text })),
      opsLabel: closed || !r.opsCount ? "" : t("Actions ({n})", { n: r.opsCount }),
      opsWhy: r.opsWhy ? t("Suggested: {why}", { why: r.opsWhy }) : "",
      opsHint: t("Click: review, adjust, run"),
      origin: r.origin ? (ORIGIN[r.origin] ?? "") : "",
      originShort: r.origin === "Calendar" ? t("from Calendar") : r.origin ? t("from Mail") : "",
      duePill: closed ? "off" : !hasDue ? "plain" : r.dueDays <= 0 ? "bad" : r.dueDays <= 3 ? "warn" : "plain",
      dueTip: hasDue ? t("Due: {date} — change", { date: day(r.due, true) }) : t("Set a due date"),
      repeatTip: r.repeats ? t("Comes back {when} — change", { when: FREQ[r.repeats] }) : t("Make it come back"),
      // (The quick panels under the row — one open at a time: the state "quick" says which, of which todo.)
      qNote: `note-${r.id}`,
      qTime: `time-${r.id}`,
      qAi: `ai-${r.id}`,
      qReply: `reply-${r.id}`,
      qPay: `pay-${r.id}`,
      qRepeat: `repeat-${r.id}`,
      qDue: `due-${r.id}`,
      canReply: !!r.canReply && !closed,
      canPay: !!r.canPay && !closed,
      flagTip: r.flagged ? t("Important — moves to the top, urgent for the briefing. Click: remove the flag") : t("Flag as important — moves to the top, urgent for the briefing"),
      flagLabel: r.flagged ? t("{ref}: remove the “important” flag", { ref: r.ref }) : t("Flag {ref} as important", { ref: r.ref }),
      deferTip: r.deferred ? t("Bring back to the top") : t("Move down — set aside for now (comes back up when something happens, in 3 days at the latest)"),
      deferLabel: r.deferred ? t("Move {ref} back up", { ref: r.ref }) : t("Move {ref} down", { ref: r.ref }),
      notePlaceholder: t("Note on {ref} — what you know, what applies, what's already settled… (@ tags people)", { ref: r.ref }),
      aiPlaceholder: t("What should Copilot do on {ref}? (e.g. “Check whether this is already done on the branch”)", { ref: r.ref }),
      workedLabel: t("Worked on {ref}", { ref: r.ref }),
      away: closed ? [] : (r.away ?? []).map((a) => ({ text: t("{name} is away until {date}", { name: a.name, date: new Date(a.until).toLocaleDateString(locale) }) })),
      workRun: r.workRun ? `/work?run=${r.workRun}` : "",
      workRef: r.workRun ? t("{ref} working ↗", { ref: `W-${r.workRun}` }) : "",
      time: r.timeMinutes ? `⏱ ${minutes(r.timeMinutes)}` : "",
      timeTip: r.timeMinutes ? t("{n} time record(s) — click for them", { n: "…" }) : "",
      mrs: (r.mrs ?? []).map((m) => ({ ...m, label: `MR ${m.ref} ↗`, tip: `${m.title}${m.state ? ` (${m.state})` : ""}`, tag: m.state && /merged/i.test(m.state) ? t("merged") : m.state && /closed/i.test(m.state) ? t("closed") : m.state && /approved/i.test(m.state) ? t("approved") : "" })),
      merged: !closed && r.merged ? t("⇄ merged") : "",
      mergedTip: t("A duplicate of this todo was merged into it — the Activity tab has the details"),
      isNew: !!r.isNew && !closed && !asking,
      copyTip: t("Copy “{text}” — for Copilot / Claude Code", { text: r.ref }),
      doneTip: closed ? t("{ref} open again", { ref: r.ref }) : t("{ref} done", { ref: r.ref }),
      dismissTip: t("Dismiss {ref}", { ref: r.ref }),
      recurring: !!r.repeats,
    };
  };
  return { view, day, locale, dueText };
}
