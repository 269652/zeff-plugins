import { RELATIONS_INSTRUCTIONS, RELATIONS_SCHEMA } from "./lib.mjs";
import { addDays, ymd } from "./_cal.mjs";

/**
 * The Termin-Zuordnung: each open todo gets the appointments it is about — those of the last two weeks and the next month, in every calendar. With many appointments the
 * likeliest few per todo come first (shared words of the todo and the appointment's title, place and description), then the AI picks by content. The built-in's
 * relateAppointments (src/lib/calendar/relations.ts); a lambda only reads — the flow `calendar.relate` writes what this hands back: { picks: { "<todoId>": ["cal:<id>"] },
 * todos, batches, failed }.
 */
const PER_TODO = 6;
const BATCH_CHARS = 30000;
const MAX_BATCHES = 8;
const DAYS_BACK = 14;
const DAYS_AHEAD = 30;
const STOP = new Set(
  "aber alle allem also auch dann dass dein deine denn diese dieser dies doch durch eine einem einen einer eines etwas für habe haben hast hier ihre ihren immer jetzt kann kein keine machen mehr mein meine mich nach noch nicht nur oder sein sind soll über und unter von war weil wenn werden wieder wird wir wollen zum zur with that this from have your".split(" "),
);
const words = (t) => new Set((String(t).toLowerCase().match(/[a-zäöüß0-9]{4,}/g) ?? []).filter((w) => !STOP.has(w)));
const plain = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export async function handler(event, context) {
  const zeff = context.zeff;
  const now = new Date();
  const today = ymd(now);
  const win = await zeff.call("appointments.window", { from: addDays(today, -DAYS_BACK), to: addDays(today, DAYS_AHEAD) });
  // one appointment per series: the same title at the same time of day are occurrences of one — the occurrence nearest to today stands for it
  const bySeries = new Map();
  for (const e of win.events) {
    if (e.cancelled || e.proposed) continue;
    const day = (e.occurrence ?? e.start).slice(0, 10);
    const time = e.allDay ? "ganztägig" : e.start.slice(11, 16);
    const series = `${e.title.trim().toLowerCase()}|${time}|${(e.location ?? "").trim().toLowerCase()}`;
    const prev = bySeries.get(series);
    if (prev && Math.abs(Date.parse(prev.day) - Date.parse(today)) <= Math.abs(Date.parse(day) - Date.parse(today))) continue;
    bySeries.set(series, { ref: `cal:${e.id}`, day, time, title: e.title, place: e.location ?? "", text: e.description ?? "", w: words(`${e.title} ${e.location} ${e.description}`) });
  }
  const list = [...bySeries.values()];
  const open = (await zeff.call("todos.open", {})).todos;
  const tickets = [...new Set(open.map((t) => t.ticket).filter(Boolean))];
  const summaries = tickets.length ? (await zeff.call("todos.tickets", { keys: tickets })).tickets : {};

  const picks = {};
  const groups = [];
  for (const t of open) {
    const tw = words(`${t.text} ${summaries[t.ticket]?.summary ?? ""} ${t.note ?? ""}`);
    const cands = tw.size
      ? list
          .map((a) => ({ a, score: [...tw].filter((x) => a.w.has(x)).length }))
          .filter((x) => x.score >= 2)
          .sort((x, y) => y.score - x.score || x.a.day.localeCompare(y.a.day))
          .slice(0, PER_TODO)
          .map((x) => x.a)
      : [];
    if (cands.length) groups.push({ t, list: cands });
    else picks[t.id] = []; // nothing likely: no appointments
  }
  const line = (a) => `  - [${a.ref}] ${a.day} ${a.time} „${plain(a.title, 160)}“${a.place ? ` (${plain(a.place, 80)})` : ""}${a.text ? ` — ${plain(a.text, 400)}` : ""}`;
  const block = (g) => [`## [${g.t.id}] ${plain(g.t.text, 300)}${g.t.ticket ? ` (${g.t.ticket})` : ""}`, ...g.list.map(line)].join("\n");
  // the groups in batches of what fits one prompt
  const batches = [];
  let cur = [];
  let size = 0;
  for (const g of groups) {
    const b = block(g);
    if (cur.length && size + b.length > BATCH_CHARS) (batches.push(cur), (cur = []), (size = 0));
    cur.push({ g, b });
    size += b.length + 2;
  }
  if (cur.length) batches.push(cur);

  let failed = 0;
  let done = 0;
  const instructions = batches.length ? (await zeff.call("prompts.fill", { key: "calendar-relations", template: RELATIONS_INSTRUCTIONS, vars: {} })).text : "";
  for (const batch of batches.slice(0, MAX_BATCHES)) {
    try {
      const answer = await zeff.call("ai.json", { prompt: `${instructions}\n\n${batch.map((x) => x.b).join("\n\n")}`, schema: RELATIONS_SCHEMA, task: "calendar-ext.relations", budget: 0.3 });
      const said = new Map((answer?.todos ?? []).map((x) => [Number(x.id), x.appointments ?? []]));
      for (const { g } of batch) {
        const known = new Set(g.list.map((a) => a.ref));
        const refs = (said.get(g.t.id) ?? []).map((r) => String(r).trim().replace(/^\[|\]$/g, "")).map((r) => (known.has(r) ? r : `cal:${r}`));
        picks[g.t.id] = refs.filter((r) => known.has(r)).slice(0, 4);
      }
      done++;
    } catch {
      // a batch that fails: its todos keep the appointments they have
      failed++;
    }
  }
  return { picks, todos: Object.keys(picks).length, batches: done, failed };
}
