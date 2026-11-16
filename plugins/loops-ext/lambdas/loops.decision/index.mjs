import { SNOOZE_DAYS, flatSlice } from "./lib.mjs";
import { allLoops, merged, snapshotOf, toRow } from "./_loops.mjs";

/**
 * Your word on a loop — close, dismiss (not a loop), confirm, reopen, accept-close / reject-close (a proposal to close it), later — worked out: what is to be
 * written, for the flow `loops.decide` to do (a lambda only reads): the promise's own review (claimReviews), a promise closed by a message (claimCloses),
 * the learning ledger's rows (feedbacks) and the loop's new state (stateRows). The built-in's decideLoop (src/plugins/loops/store.ts). event: { ref, op }.
 */
const OPS = ["close", "dismiss", "confirm", "reopen", "accept-close", "reject-close", "later"];
const loopFeedback = (l, verdict, op, kind = `${l.kind}:${l.direction}`, detail = {}) => ({ step: "open-loops", itemRef: l.ref, verdict, sourceRef: l.sourceRef || null, sender: l.who || null, kind, detail: { op, origin: l.origin, text: l.text, quote: l.quote, ...detail } });

export async function handler(event, context) {
  const ref = String(event?.ref ?? "").slice(0, 400);
  const op = String(event?.op ?? "");
  if (!OPS.includes(op)) return { ok: false, error: `unknown op ${op}` };
  const now = new Date();
  const all = await allLoops(context.zeff, now);
  const loop = [...all.open, ...all.closed, ...all.settled].find((l) => l.ref === ref);
  if (!loop) return { ok: false, error: "no such loop" };
  const m = /^claim:(\d+)$/.exec(ref);
  const id = m ? Number(m[1]) : null;
  const at = now.toISOString();
  const st = all.states.get(ref) ?? null;
  const out = { ok: true, claimReviews: [], claimCloses: [], feedbacks: [], stateRows: [] };
  const put = (patch) => out.stateRows.push(toRow(merged(ref, st, patch, now)));
  switch (op) {
    case "close":
      if (loop.state === "closed") break;
      // A promise: ticked off where it lives (the kernel records it in the ledger then).
      if (id) out.claimReviews.push({ id, op: "done" });
      else out.feedbacks.push(loopFeedback(loop, "accepted", "close"));
      put({ state: "closed", closedBy: "you", closeRef: "", closeQuote: "", closedAt: at, proposal: null, snapshot: snapshotOf(loop) });
      break;
    case "dismiss":
      out.feedbacks.push(loopFeedback(loop, "rejected", "dismiss"));
      if (id) out.claimReviews.push({ id, op: "reject" });
      put({ state: "dismissed", closedAt: at, proposal: null, snapshot: snapshotOf(loop) });
      break;
    case "confirm":
      if (!id || loop.confirmed) break;
      out.claimReviews.push({ id, op: "confirm" });
      out.feedbacks.push(loopFeedback(loop, "accepted", "confirm"));
      break;
    case "reopen": {
      if (loop.state === "open") break;
      // A closing by rule or the AI that was wrong: in the ledger, and its message never closes it again.
      if (st?.closedBy === "rule" || st?.closedBy === "ai") out.feedbacks.push(loopFeedback(loop, "rejected", "reopen", `close:${st.closedBy}`, { closeQuote: st.closeQuote, closeRef: st.closeRef }));
      if (id) out.claimReviews.push({ id, op: "reopen" });
      put({ state: "open", closedBy: null, closeRef: "", closeQuote: "", closedAt: null, rejected: [...(st?.rejected ?? []), ...(st?.closeRef ? [st.closeRef] : [])] });
      break;
    }
    case "accept-close": {
      const p = st?.proposal;
      if (!p) return { ok: false, error: "no proposal" };
      out.feedbacks.push(loopFeedback(loop, "accepted", "accept-close", `close:${p.by}`, { closeQuote: p.quote, closeRef: p.ref }));
      if (id) out.claimCloses.push({ id, by: p.by, closeRef: p.ref, quote: p.quote, href: p.href });
      put({ state: "closed", closedBy: p.by, closeRef: p.ref, closeQuote: flatSlice(p.quote, 400), closedAt: at, proposal: null, ...(id ? {} : { snapshot: snapshotOf(loop) }) });
      break;
    }
    case "reject-close": {
      const p = st?.proposal;
      if (!p) return { ok: false, error: "no proposal" };
      out.feedbacks.push(loopFeedback(loop, "rejected", "reject-close", `close:${p.by}`, { closeQuote: p.quote, closeRef: p.ref }));
      put({ proposal: null, rejected: [...(st?.rejected ?? []), p.ref] });
      break;
    }
    case "later":
      put({ snoozeUntil: new Date(now.getTime() + SNOOZE_DAYS * 864e5).toISOString(), snapshot: st?.snapshot && Object.keys(st.snapshot).length ? st.snapshot : snapshotOf(loop) });
      break;
  }
  return out;
}
