import { OVERDUE_DAYS, WA_SYSTEM, addressedTo, flatSlice, isOverdue, isQuestion, isRequest } from "./lib.mjs";

/**
 * The open loops worked out: what the rules read in the messages (the built-in's detect.ts), the promises read by the AI (its commitment claims),
 * and what became of each (the plugin's store `state`, the built-in's table loops_state). Shared by the plugin's lambdas — the kernel's reads only
 * (messages.recent, people.resolve, people.claims, messages.of-ref, store.query); a lambda changes nothing.
 */
export const WINDOW_DAYS = 21;
export const CLOSED_DAYS = 14;
const PER_THREAD = 3;

// --- the state of each loop (the store) ---------------------------------------------------------------------------------------------------
export const STATE_STORE = "loops-ext.state";

export const toState = (r) => ({
  ref: r.ref,
  state: r.state === "closed" || r.state === "dismissed" ? r.state : "open",
  closedBy: r.closed_by === "rule" || r.closed_by === "ai" || r.closed_by === "you" ? r.closed_by : null,
  closeRef: r.close_ref ?? "",
  closeQuote: r.close_quote ?? "",
  closedAt: r.closed_at ?? null,
  proposal: r.proposal_ref ? { ref: r.proposal_ref, quote: r.proposal_quote ?? "", href: r.proposal_href ?? "", at: r.proposal_at ?? "", by: r.proposal_by === "rule" ? "rule" : "ai" } : null,
  rejected: Array.isArray(r.rejected) ? r.rejected : [],
  snoozeUntil: r.snooze_until ?? null,
  snapshot: r.snapshot && typeof r.snapshot === "object" ? r.snapshot : {},
  updatedAt: r.updated_at ?? "",
});

export const toRow = (s) => ({
  ref: s.ref,
  state: s.state,
  closed_by: s.closedBy,
  close_ref: String(s.closeRef ?? "").slice(0, 300),
  close_quote: String(s.closeQuote ?? "").slice(0, 400),
  closed_at: s.closedAt,
  proposal_ref: s.proposal?.ref ?? null,
  proposal_quote: s.proposal ? String(s.proposal.quote ?? "").slice(0, 400) : null,
  proposal_href: s.proposal?.href ?? null,
  proposal_at: s.proposal?.at ?? null,
  proposal_by: s.proposal?.by ?? null,
  rejected: (s.rejected ?? []).slice(-50),
  snooze_until: s.snoozeUntil,
  snapshot: s.snapshot ?? {},
  updated_at: s.updatedAt,
});

/** A state with a change put on it (the built-in's putState): only the fields given. */
export const merged = (ref, had, patch, now = new Date()) => ({ ref, state: "open", closedBy: null, closeRef: "", closeQuote: "", closedAt: null, proposal: null, rejected: [], snoozeUntil: null, snapshot: {}, ...(had ?? {}), ...patch, updatedAt: now.toISOString() });

export async function loadStates(zeff) {
  const out = new Map();
  for (let offset = 0; ; offset += 500) {
    const { rows, total } = await zeff.call("store.query", { store: STATE_STORE, limit: 500, offset });
    for (const r of rows) out.set(r.ref, toState(r));
    if (!rows.length || out.size >= total) return out;
  }
}

/** The loop as it was when decided (a rule's loop is gone from the source once answered). */
export const snapshotOf = (l) => ({ ref: l.ref, kind: l.kind, direction: l.direction, origin: l.origin, personId: l.personId, who: l.who, text: l.text, quote: l.quote, at: l.at, due: l.due, sourceRef: l.sourceRef, source: l.source, href: l.href });

// --- the loops the rules read ---------------------------------------------------------------------------------------------------------------
const kindOf = (text, fallback) => (isRequest(text) ? "request" : isQuestion(text) ? "question" : fallback);

function finish(d, now) {
  const l = { ...d, origin: "rule", confirmed: true, confidence: 1, due: "", overdue: false, state: "open", closedBy: null, closedAt: null, closeQuote: "", closeRef: "", proposal: null, snoozedUntil: null };
  l.overdue = isOverdue(l, now);
  return l;
}

/** R: { person(text) → contact id | null, name(id, fallback) }. */
export function derive({ mails, teams, jira }, R, me, now) {
  const set = new Set([...me.names, ...me.handles]);
  const nameOf = (id, fallback) => (id ? R.name(id, fallback) : fallback);
  const out = [];

  // Chats and mail threads: what was asked of you since your last word, and your question nobody answered.
  const byConv = new Map();
  for (const m of mails) {
    if (m.conv_id.startsWith("wa:") && WA_SYSTEM.test(m.preview.trim())) continue;
    const list = byConv.get(m.conv_id);
    if (list) list.push(m);
    else byConv.set(m.conv_id, [m]);
  }
  for (const [conv, msgs] of byConv) {
    const chat = conv.startsWith("wa:") || conv.startsWith("sg:");
    const gmail = conv.startsWith("gmail:");
    const keepsSent = gmail || conv.startsWith("imap:");
    const source = conv.startsWith("wa:") ? "whatsapp" : conv.startsWith("sg:") ? "signal" : gmail ? "gmail" : conv.startsWith("imap:") ? "imap" : "mail";
    const chatName = chat ? conv.slice(3) : "";
    const mine = (m) => m.from_name === "Ich";
    if (chat && msgs.every((m) => !mine(m)) && msgs[msgs.length - 1].subject === msgs[msgs.length - 1].folder) continue;
    const group = msgs.some((m) => !!m.is_group);
    const spoke = msgs.some(mine);
    const href = (m) => (chat ? `/mail?${new URLSearchParams({ channel: conv.startsWith("wa:") ? "whatsapp" : "signal", open: conv })}` : `/mail?q=${encodeURIComponent(m.subject)}`);
    let lastMine = -1;
    msgs.forEach((m, i) => mine(m) && (lastMine = i));
    const asked = [];
    for (const m of msgs.slice(lastMine + 1)) {
      if (mine(m) || m.resolved_at) continue;
      if (chat && group && !m.to_me) continue;
      const sender = R.person(m.from_email) ?? R.person(m.from_name);
      const owner = chat ? R.person(chatName) : null;
      const personId = chat && !group ? (owner ?? sender) : sender;
      if (!chat && !personId && !(keepsSent && spoke)) continue;
      const text = chat ? m.preview : `${m.subject} — ${m.preview}`;
      const kind = kindOf(text, null);
      if (!kind) continue;
      asked.push(finish({ ref: `q:mail:${m.key}`, kind, direction: "mine", personId, who: nameOf(personId, (chat && !group ? chatName : m.from_name) || chatName || "?"), text: flatSlice(text, 300), quote: flatSlice(m.preview, 300), at: m.at, sourceRef: `mail:${m.key}`, source, href: href(m) }, now));
    }
    out.push(...asked.slice(-PER_THREAD));
    const last = msgs[msgs.length - 1];
    if (last && mine(last) && !group && (isQuestion(last.preview) || isRequest(last.preview))) {
      const other = [...msgs].reverse().find((m) => !mine(m));
      const personId = chat ? R.person(chatName) : other ? (R.person(other.from_email) ?? R.person(other.from_name)) : null;
      if (chat || personId || other) {
        const kind = kindOf(last.preview, "question");
        out.push(finish({ ref: `q:mail:${last.key}`, kind, direction: "theirs", personId, who: nameOf(personId, chatName || other?.from_name || last.subject), text: flatSlice(chat ? last.preview : `${last.subject} — ${last.preview}`, 300), quote: flatSlice(last.preview, 300), at: last.at, sourceRef: `mail:${last.key}`, source, href: href(last) }, now));
      }
    }
  }

  // Teams: chats to you and mentions of you asking something since your last word there; your question as a chat's last word.
  const byThread = new Map();
  for (const m of teams) {
    const k = m.kind === "mention" && m.reply_chain_id ? `${m.conversation_id}|${m.reply_chain_id}` : m.conversation_id;
    const list = byThread.get(k);
    if (list) list.push(m);
    else byThread.set(k, [m]);
  }
  for (const msgs of byThread.values()) {
    const theirIds = new Set(msgs.filter((m) => m.kind === "pm" && m.sender_id).map((m) => m.sender_id));
    const mine = (m) => (set.size ? set.has((m.sender_name ?? "").trim().toLowerCase()) : m.kind !== "pm" && m.kind !== "mention" && !!m.sender_id && !theirIds.has(m.sender_id));
    let lastMine = -1;
    msgs.forEach((m, i) => mine(m) && (lastMine = i));
    const asked = [];
    for (const m of msgs.slice(lastMine + 1)) {
      if (mine(m) || m.resolved_at) continue;
      if (m.kind !== "pm" && !(m.kind === "mention" && (m.mention_type === "person" || !m.mention_type))) continue;
      const kind = kindOf(m.text, null);
      if (!kind) continue;
      const personId = R.person(m.sender_name);
      asked.push(finish({ ref: `q:teams:${m.key}`, kind, direction: "mine", personId, who: nameOf(personId, m.sender_name ?? "Teams"), text: flatSlice(m.text, 300), quote: flatSlice(m.text, 300), at: m.at, sourceRef: `teams:${m.key}`, source: "teams", href: m.link }, now));
    }
    out.push(...asked.slice(-PER_THREAD));
    const last = msgs[msgs.length - 1];
    if (last && mine(last) && (isQuestion(last.text) || isRequest(last.text)) && msgs.some((m) => m.kind === "pm")) {
      const other = [...msgs].reverse().find((m) => !mine(m));
      const personId = R.person(other?.sender_name);
      out.push(finish({ ref: `q:teams:${last.key}`, kind: kindOf(last.text, "question"), direction: "theirs", personId, who: nameOf(personId, other?.sender_name ?? (last.place ?? "Teams").replace(/^Chat with /, "")), text: flatSlice(last.text, 300), quote: flatSlice(last.text, 300), at: last.at, sourceRef: `teams:${last.key}`, source: "teams", href: last.link }, now));
    }
  }

  // Jira: comments addressed to you (or asking on your tickets) since your last comment on the ticket; your question nobody answered.
  const isMe = (a) => set.has(String(a ?? "").trim().toLowerCase());
  const byTicket = new Map();
  for (const c of jira) {
    const list = byTicket.get(c.ticket);
    if (list) list.push(c);
    else byTicket.set(c.ticket, [c]);
  }
  for (const [ticket, cs] of byTicket) {
    if (cs[0].category === "done") continue;
    let lastMine = -1;
    cs.forEach((c, i) => isMe(c.author) && (lastMine = i));
    const href = cs[0].url ?? "";
    const asked = [];
    for (const c of cs.slice(lastMine + 1)) {
      if (isMe(c.author)) continue;
      const to = addressedTo(c.body, me.names, me.handles);
      const kind = kindOf(c.body, to ? "mention" : null);
      if (!kind || !(to || c.mine)) continue;
      const personId = R.person(c.author);
      asked.push(finish({ ref: `q:jira:${c.id}`, kind, direction: "mine", personId, who: nameOf(personId, c.author), text: flatSlice(`${ticket}: ${c.body}`, 300), quote: flatSlice(c.body, 300), at: c.at, sourceRef: `jira-comment:${c.id}`, source: "jira", href }, now));
    }
    out.push(...asked.slice(-PER_THREAD));
    const last = cs[cs.length - 1];
    if (last && isMe(last.author) && isQuestion(last.body)) {
      const other = [...cs].reverse().find((c) => !isMe(c.author));
      const personId = other ? R.person(other.author) : null;
      out.push(finish({ ref: `q:jira:${last.id}`, kind: kindOf(last.body, "question"), direction: "theirs", personId, who: nameOf(personId, other?.author ?? ticket), text: flatSlice(`${ticket}: ${last.body}`, 300), quote: flatSlice(last.body, 300), at: last.at, sourceRef: `jira-comment:${last.id}`, source: "jira", href }, now));
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** The loops the rules read now: the messages (the kernel's messages.recent), who is who (people.resolve — asked once for everything the rules look up). */
export async function derivedLoops(zeff, now) {
  const since = new Date(now.getTime() - WINDOW_DAYS * 864e5).toISOString();
  const data = await zeff.call("messages.recent", { since });
  const asked = new Set();
  const collect = { person: (x) => (x != null && String(x).trim() && asked.add(String(x)), null), name: (_id, fallback) => fallback };
  const first = await zeff.call("people.resolve", { queries: [] });
  derive(data, collect, first.me, now);
  const res = await zeff.call("people.resolve", { queries: [...asked] });
  const R = { person: (x) => (x == null ? null : (res.ids[String(x)] ?? null)), name: (id, fallback) => res.names[id] ?? fallback };
  return { loops: derive(data, R, res.me, now), me: res.me, allNames: res.allNames, names: res.names };
}

// --- the promises as loops ---------------------------------------------------------------------------------------------------------------
export function claimLoop(c, st, now, src) {
  const l = {
    ref: `claim:${c.id}`,
    kind: "commitment",
    direction: c.direction === "theirs" ? "theirs" : "mine",
    origin: "ai",
    personId: c.person_id,
    who: c.person_name ?? "?",
    text: c.text,
    quote: c.evidence,
    at: src?.at ?? c.created_at,
    due: c.due,
    sourceRef: c.source_ref,
    source: src?.source ?? "people",
    href: src?.href ?? "",
    confirmed: c.status === "confirmed",
    confidence: c.confidence,
    overdue: false,
    state: c.done_at ? "closed" : "open",
    closedBy: c.done_at ? (st?.closedBy ?? "you") : null,
    closedAt: c.done_at,
    closeQuote: c.done_at ? (st?.closeQuote ?? "") : "",
    closeRef: c.done_at ? (st?.closeRef ?? "") : "",
    proposal: c.done_at ? null : (st?.proposal ?? null),
    snoozedUntil: st?.snoozeUntil ?? null,
  };
  l.overdue = !c.done_at && isOverdue(l, now);
  return l;
}

/** A rule's loop closed or dismissed: what its snapshot says. */
export const fromSnapshot = (st) => {
  const s = st.snapshot;
  if (!s.ref || !s.kind || !s.direction) return null;
  return { ref: st.ref, kind: s.kind, direction: s.direction, origin: s.origin ?? "rule", personId: s.personId ?? null, who: s.who ?? "?", text: s.text ?? "", quote: s.quote ?? "", at: s.at ?? st.updatedAt, due: s.due ?? "", sourceRef: s.sourceRef ?? "", source: s.source ?? "people", href: s.href ?? "", confirmed: true, confidence: 1, overdue: false, state: st.state, closedBy: st.closedBy, closedAt: st.closedAt, closeQuote: st.closeQuote, closeRef: st.closeRef, proposal: null, snoozedUntil: st.snoozeUntil };
};

export const order = (a, b) => Number(b.overdue) - Number(a.overdue) || (a.due && b.due ? a.due.localeCompare(b.due) : Number(!!b.due) - Number(!!a.due)) || b.at.localeCompare(a.at);

/** Every loop there is: the open ones (overdue and soonest due first), the closed of the last two weeks, and the rest (dismissed, closed long ago) for finding one by its ref. */
export async function allLoops(zeff, now = new Date()) {
  const states = await loadStates(zeff);
  const since = new Date(now.getTime() - CLOSED_DAYS * 864e5).toISOString();
  const openClaims = (await zeff.call("people.claims", { done: false })).claims;
  const closedClaims = (await zeff.call("people.claims", { done: true, doneSince: since })).claims;
  const refs = [...new Set([...openClaims, ...closedClaims].map((c) => c.source_ref).filter(Boolean))];
  const sources = refs.length ? (await zeff.call("messages.of-ref", { refs })).sources : {};
  const claims = openClaims.map((c) => claimLoop(c, states.get(`claim:${c.id}`), now, sources[c.source_ref]));
  const derived = (await derivedLoops(zeff, now)).loops
    .filter((l) => {
      const st = states.get(l.ref);
      return !st || st.state === "open";
    })
    .map((l) => {
      const st = states.get(l.ref);
      return st ? { ...l, snoozedUntil: st.snoozeUntil, proposal: st.proposal } : l;
    });
  const open = [...claims, ...derived].sort(order);
  const closed = [
    ...closedClaims.map((c) => claimLoop(c, states.get(`claim:${c.id}`), now, sources[c.source_ref])),
    ...[...states.values()].filter((s) => s.ref.startsWith("q:") && s.state === "closed" && (s.closedAt ?? "") >= since).flatMap((s) => fromSnapshot(s) ?? []),
  ].sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
  const have = new Set([...open, ...closed].map((l) => l.ref));
  const settled = [...states.values()].filter((s) => !have.has(s.ref) && s.state !== "open").flatMap((s) => fromSnapshot(s) ?? []);
  return { open, closed, settled, states };
}
