import { createHash } from "node:crypto";
import { INSTRUCTIONS, SCHEMA, appointmentsAllowed, autoActionsPrompt, busyLinesOf, placeAppointment, PRIVATE_WINDOW } from "./lib.mjs";

/**
 * The auto-actions review: the open todos without actions — new ones, or changed since they were last gone through — in batches (each its own prompt);
 * what the AI proposes, held to the actions' own rules (todos.clean-ops) and placed into free times, is handed back for the flow to put on the todos
 * (a lambda only reads). The built-in's reviewTodosForActions (src/plugins/auto-actions/review.ts), over the kernel's todo reads. event: { all, ids }.
 */
const BATCH_TODOS = 6;
const plain = (s, max) => {
  const t = (s ?? "").replace(/\{(code|noformat|quote|panel)[^}]*\}/g, "").replace(/!([^!\s|]+)(\|[^!]*)?!/g, "[Bild]").replace(/\[~([^\]]+)\]/g, "@$1").replace(/\[([^|\]]+)\|([^\]]+)\]/g, "$1").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const batchByChars = (items, sizeOf, limit, max) => {
  const out = [];
  let size = 0;
  for (const item of items) {
    const n = sizeOf(item);
    if (!out.length || size + n > limit || out[out.length - 1].length >= max) {
      out.push([]);
      size = 0;
    }
    out[out.length - 1].push(item);
    size += n;
  }
  return out;
};
const stamp = (s) => new Date(`${String(s).slice(0, 16)}:00`);

export async function handler(event, context) {
  const zeff = context.zeff;
  const ids = Array.isArray(event?.ids) ? event.ids.map(Number).filter(Number.isInteger) : [];
  const me = (await zeff.call("jira.my-name", {})).name;
  const today = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const rules = await zeff.call("todos.ops-rules", {});
  const prompt = await zeff.call("prompts.fill", { key: "auto-actions", template: INSTRUCTIONS, vars: { me: me || "der Nutzer", today }, step: "autoactions", reserve: 9000 });
  // What can be done changed (a plugin came) or the prompt did: every open todo without actions is looked at again, once.
  const promptHash = createHash("sha1").update(prompt.raw).digest("hex").slice(0, 8);
  const offered = rules.available.join(",") + `|${promptHash}`;
  const all = event?.all === true || (await zeff.call("pref.get", { key: "autoactions:offered" })).value !== offered;

  const { todos: open } = await zeff.call("todos.open", {});
  const due = new Set(open.filter((t) => all || !t.reviewedAt || t.updatedAt > t.reviewedAt).map((t) => t.id));
  // What a todo learned since its actions were proposed here: a note, a newer message, an account that became known — proposed again.
  const ours = open.filter((t) => t.opsCount && t.autoOpsWhy && due.has(t.id));
  const oursSources = ours.length ? (await zeff.call("todos.sources", { ids: ours.map((t) => t.id) })).sources : {};
  const learned = new Set();
  for (const t of ours) {
    const at = t.reviewedAt ?? "";
    let known = t.allNoteTimes.some((n) => n > at) || (oursSources[t.id] ?? []).some((x) => (x.at ?? "") > at);
    if (!known) known = (await zeff.call("people.named-in", { text: t.text })).people.some((p) => p.accountAt > at);
    if (known) learned.add(t.id);
  }
  const gaps = new Set(open.filter((t) => t.gapOpen.length).map((t) => t.id));
  const list = ids.length
    ? open.filter((t) => ids.includes(t.id) && (!t.opsCount || !!t.autoOpsWhy || gaps.has(t.id)))
    : open.filter((t) => due.has(t.id) && (!t.opsCount || (!!t.autoOpsWhy && (all || learned.has(t.id))) || (!t.autoOpsWhy && gaps.has(t.id))));
  const setOffered = !ids.length;
  if (!list.length) return { changes: [], offered, setOffered, reviewed: 0, withActions: 0, batches: 0, ok: true, message: "0 todos reviewed, 0 with actions" };

  const sources = (await zeff.call("todos.sources", { ids: list.map((t) => t.id) })).sources;
  const keys = [...new Set(list.map((t) => t.ticket).filter(Boolean))];
  const tickets = keys.length ? (await zeff.call("todos.tickets", { keys })).tickets : {};
  const wantsDescription = (text) => rules.needs.some((n) => new RegExp(n.match, "i").test(text) && n.context.includes("ticket.description"));

  const blocks = [];
  for (const t of list) {
    const tk = tickets[t.ticket];
    const from = [...(sources[t.id] ?? [])].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, 8);
    const lines = [
      `## Todo [${t.id}] ${t.ticket || "(kein Ticket)"} — ${t.kindLabel}${t.owner === "other" ? ", wartet auf andere" : ""}: ${plain(t.text, 400)}`,
      ...(t.ticket ? [`Ticket ${t.ticket}: ${plain(tk?.summary, 160)} — Status ${tk?.status || "?"}, zugewiesen ${tk?.assignee || "niemand"}`] : []),
      ...(t.ticket && tk?.description && wantsDescription(plain(t.text, 400)) ? [`Beschreibung von ${t.ticket}:\n${plain(tk.description, 3500)}`] : []),
      ...(tk?.people?.length ? [`Beteiligte: ${tk.people.join(", ")}`] : []),
      ...(tk?.transitions?.length ? [`Mögliche Übergänge: ${tk.transitions.join(", ")}`] : []),
      ...(t.source ? [`Quelle laut Lage: ${plain(t.source, 160)}`] : []),
      ...(t.planned.length ? [`Danach geplant: ${t.planned.join(" → ")}`] : []),
      ...t.notes.map((n) => `${n.by ? `Bericht ${n.by}` : n.kind === "instruction" ? "Meine Anweisung" : "Meine Notiz"} (${n.at.slice(0, 10)}): ${plain(n.text, 400)}`),
      ...(t.note ? [`Notiz: ${plain(t.note, 200)}`] : []),
      ...(t.repo ? [`Projekt ${t.repo.name} (aus dem Wissen — nenne in Nachrichten und Kommentaren die passende Adresse):\n${t.repo.summary}`] : []),
      ...from.map((s) => `- [${s.ref}] ${s.label} ${(s.at ?? "").slice(0, 16).replace("T", " ")} ${s.author ?? ""}: ${plain(s.headline, 120)} — ${plain(s.text, 450)}`),
    ];
    // The conversations its messages are from: their last messages, both sides.
    for (const c of [...new Set(from.map((s) => s.convId).filter(Boolean))].slice(0, 2)) {
      const msgs = (await zeff.call("mail.conversation", { convId: c, limit: 8 })).messages;
      if (msgs.length < 2) continue;
      lines.push(`Verlauf ${msgs[0].chat ? "des Chats" : "der Unterhaltung"} „${plain(msgs[msgs.length - 1].subject, 60)}“ (älteste zuerst):`, ...msgs.map((m) => `  ${m.receivedAt.slice(0, 10)} ${m.fromName ?? m.fromEmail ?? "?"}: ${plain(m.preview, 220)}`));
    }
    blocks.push({ t, text: lines.join("\n") });
  }
  // What Zeff knows of a todo's people and things (facts): those whose subject names them; and what exists that an action may adjust.
  const facts = (await zeff.call("facts.list", {})).facts;
  for (const b of blocks) {
    const about = [b.t.text, ...(sources[b.t.id] ?? []).flatMap((s) => [s.author ?? "", s.subject ?? ""])].join(" ").toLowerCase();
    const known = facts.filter((f) => f.subject.split(/[\s:,–-]+/).some((w) => w.length > 3 && about.includes(w.toLowerCase()))).slice(0, 6).map((f) => `Bekannt (Stand ${f.updatedAt.slice(0, 10)}): ${plain(f.subject, 80)} — ${plain(f.text, 200)}`);
    if (known.length) b.text += "\n" + known.join("\n");
    const lines = (await zeff.call("actions.offer-context", { ticket: b.t.ticket, text: plain(b.t.text, 400) })).lines;
    if (lines.length) b.text += "\n" + ["", "Bestehendes in Zeff (für Aktionen, die etwas anpassen):", ...lines].join("\n");
  }

  const busy = (await zeff.call("calendar.busy", { days: 14 })).busy.map((b) => ({ start: stamp(b.start), end: stamp(b.end), subject: b.title }));
  const busyLines = busyLinesOf(busy);
  const reviewing = new Set(list.map((x) => x.id));
  const taken = open.filter((x) => !reviewing.has(x.id)).flatMap((x) => x.calendarOps).map((o) => ({ start: stamp(o.start), end: new Date(stamp(o.start).getTime() + o.minutes * 60000) })).filter((b) => !Number.isNaN(b.start.getTime()));
  const senders = (await zeff.call("mail.senders", {})).senders;
  const batches = batchByChars(blocks, (b) => b.text.length + 2, prompt.room - rules.dictionary.length, BATCH_TODOS);
  let failed = 0;
  const ask = async (batch) => {
    const text = batch.map((b) => b.text).join("\n\n");
    const lower = text.toLowerCase();
    const book = senders.filter((s) => s.name.split(/\s+/).some((p) => p.length > 3 && lower.includes(p.toLowerCase()))).map((s) => `${s.name} <${s.email}>`).slice(0, 40);
    const people = (await zeff.call("people.named-in", { text })).people;
    const accounts = people.flatMap((p) => {
      const parts = [p.iban ? `IBAN ${p.iban}${p.bic ? ` (BIC ${p.bic})` : ""}${p.ibanConfirmedAt ? `, bestätigt ${p.ibanConfirmedAt}` : ""}` : "", p.revtag ? `RevTag ${p.revtag}` : ""].filter(Boolean);
      return parts.length ? [`- ${p.name}: ${parts.join(" · ")}`] : [];
    });
    const full = autoActionsPrompt({ instructions: prompt.text + prompt.extra, dictionary: rules.dictionary, book, accounts, busyLines, todos: text });
    try {
      return [{ batch, answer: await zeff.call("ai.json", { prompt: full, schema: SCHEMA, task: "auto-actions-ext.review", budget: 1 }) }];
    } catch {
      if (batch.length === 1) {
        failed++;
        return [];
      }
      // Halved and asked again — a broken answer costs only its half.
      const half = Math.ceil(batch.length / 2);
      return [...(await ask(batch.slice(0, half))), ...(await ask(batch.slice(half)))];
    }
  };
  const asked = (await Promise.all(batches.map(ask))).flat();

  const now = new Date().toISOString();
  const changes = [];
  let withActions = 0;
  for (const { batch, answer } of asked) {
    const said = new Map((answer?.todos ?? []).filter((x) => Number.isInteger(x?.id)).map((x) => [x.id, x]));
    for (const { t } of batch) {
      const a = said.get(t.id);
      const cleaned = (await zeff.call("todos.clean-ops", { ops: a?.ops ?? [], ticket: t.ticket || "", noAppointments: t.recurring || !appointmentsAllowed({ source: t.source }), me })).ops;
      // An appointment into a free time (mine, and the ones placed before it).
      const ops = cleaned.map((o) =>
        o.type === "calendar-event" ? { ...o, start: placeAppointment(o.start, o.minutes, busy, taken) } : o.type === "calendar-entry" || o.type === "gcal-event" ? { ...o, start: placeAppointment(o.start, o.minutes, busy, taken, PRIVATE_WINDOW) } : o,
      );
      const gap = gaps.has(t.id) && t.opsCount > 0 && !t.autoOpsWhy;
      const replace = (ids.length > 0 || all || learned.has(t.id)) && !!t.autoOpsWhy;
      if (gap ? ops.some((o) => o.type === "gitlab-reply") : ops.length && (!t.opsCount || replace)) withActions++;
      changes.push({ id: t.id, ops, why: (a?.why ?? "").trim().slice(0, 500), mode: gap ? "gap" : "set", replace, reviewedAt: now });
    }
  }
  return { changes, offered, setOffered, reviewed: list.length, withActions, batches: batches.length, ok: failed < list.length, message: `${list.length} todos reviewed, ${withActions} with actions${failed ? ` (${failed} without a valid answer)` : ""}` };
}
