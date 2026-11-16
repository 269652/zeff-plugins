import { flatSlice, isDeferral, isQuestion, isSendPromise, sharesTopic } from "./lib.mjs";
import { loadStates, merged, toRow } from "./_loops.mjs";

/**
 * Closing open loops by rule, no AI — only where the sources leave no doubt: a promise made in a Jira comment when its ticket is done since; a promise to send
 * something when the right side sent an attachment in the same chat or thread after it. A reply about it (words of substance they share) or an answer to its
 * question (in a chat of the two of you; not a "later", an "ok" or a question back) is a proposal you confirm. A closing you took back is not made or proposed
 * again. The built-in's closeByRule (src/plugins/loops/close.ts), worked out for the flow `loops.close-by-rule` to write (a lambda only reads):
 * { closes: [{ id, closeRef, quote, href }], stateRows }.
 */
function verdictOf(m, c, personMatch, names, many) {
  const right = c.direction === "mine" ? m.mine : !m.mine && personMatch(m.from);
  if (!right) return null;
  const promise = `${c.text} ${c.evidence}`;
  if (m.attachment && isSendPromise(promise)) return "close";
  if (isDeferral(m.text) || isQuestion(m.text) || !String(m.text ?? "").trim()) return null;
  if (!many && isQuestion(c.evidence)) return "propose";
  return sharesTopic(promise, m.text, names) ? "propose" : null;
}

export async function handler(event, context) {
  const zeff = context.zeff;
  const now = new Date();
  const claims = (await zeff.call("people.claims", { done: false })).claims;
  if (!claims.length) return { closes: [], stateRows: [] };
  const states = await loadStates(zeff);
  const me = (await zeff.call("people.resolve", { queries: [] })).me;
  const meSet = [...me.names, ...me.handles];
  const sources = (await zeff.call("messages.of-ref", { refs: [...new Set(claims.map((c) => c.source_ref).filter(Boolean))] })).sources;
  const todo = [];
  for (const c of claims) {
    const src = sources[c.source_ref];
    if (!src || src.kind === "other") continue;
    const at = src.at ?? c.created_at;
    const got = await zeff.call("messages.later", { ref: c.source_ref, at, me: meSet });
    todo.push({ c, src, at, got });
  }
  const froms = [...new Set(todo.flatMap((x) => x.got.later.map((m) => m.from)).filter(Boolean))];
  const res = await zeff.call("people.resolve", { queries: froms });
  // Names say nothing about what was promised: everyone's (yours too) left out of the topic words.
  const names = [...res.allNames, ...me.names];
  const closes = [];
  const stateRows = [];
  for (const { c, src, at, got } of todo) {
    const ref = `claim:${c.id}`;
    const st = states.get(ref);
    const rejected = new Set(st?.rejected ?? []);
    const many = src.group || src.kind === "jira" || got.senders.length > 1;
    const personMatch = (from) => {
      const id = res.ids[from] ?? null;
      if (id) return id === c.person_id;
      return !many;
    };
    const close = (closeRef, quote) => {
      closes.push({ id: c.id, closeRef, quote, href: src.href });
      stateRows.push(toRow(merged(ref, st, { state: "closed", closedBy: "rule", closeRef, closeQuote: flatSlice(quote, 400), closedAt: now.toISOString(), proposal: null }, now)));
    };
    if (src.kind === "jira" && got.doneStatus && !rejected.has(`ticket:${src.thread}`)) {
      close(`ticket:${src.thread}`, `${src.thread} → ${got.doneStatus}`);
      continue;
    }
    const later = got.later.filter((m) => !rejected.has(m.ref));
    const verdicts = later.map((m) => ({ m, v: verdictOf(m, c, personMatch, names, many) }));
    const done = verdicts.find((x) => x.v === "close");
    if (done) {
      close(done.m.ref, `${done.m.attachment ? "📎 " : ""}${done.m.text}`);
      continue;
    }
    const maybe = verdicts.find((x) => x.v === "propose");
    if (maybe && !st?.proposal) stateRows.push(toRow(merged(ref, st, { proposal: { ref: maybe.m.ref, quote: flatSlice(maybe.m.text, 400), href: src.href, at: maybe.m.at, by: "rule" } }, now)));
  }
  return { closes, stateRows };
}
