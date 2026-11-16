import { TODOS_INSTRUCTIONS, TODOS_SCHEMA } from "./lib.mjs";
import { addDays, stampOf, ymd } from "./_cal.mjs";

/**
 * Appointments as todos: in a calendar set so ("Todos"), each appointment of today and the next days that has something for you to do becomes a todo on its day — a
 * series' occurrence on its own day, once. Whether it has (a blocker like "Pause 12:30" has not) the AI says, once per appointment or series (the verdicts are kept);
 * without the AI each one is a todo. The built-in's calendarTodos (src/lib/calendar/todos.ts); a lambda only reads — the flow `calendar.todos` writes what this hands back:
 * { adds: [{ text, due, ref, source }], dismiss: [{ ref }], ensureDue: [{ id, day }], verdicts (the whole map to keep, or null: unchanged), asked }.
 */
const BATCH = 40;
const DAYS_PREF = "calendar:todos-days";
const VERDICTS = "calendar:todo-verdicts";
const verdictKey = (e) => `${e.seriesId ?? e.id}|${e.title.trim()}|${(e.location ?? "").trim()}|${(e.description ?? "").trim().slice(0, 600)}`;

export async function handler(event, context) {
  const zeff = context.zeff;
  const now = new Date();
  const ahead = Math.max(1, Math.min(30, Math.round(Number((await zeff.call("pref.get", { key: DAYS_PREF })).value)) || 7));
  const from = ymd(now);
  const to = addDays(from, 1 + ahead);
  const nowLocal = stampOf(now);
  const win = await zeff.call("appointments.window", { from, to });
  const cals = new Map(win.calendars.map((c) => [c.id, c]));
  const due = [];
  const ensureDue = [];
  for (const e of win.events) {
    const cal = cals.get(e.calendarId);
    if (!cal || !cal.todos || e.cancelled || e.proposed) continue;
    const day = (e.occurrence ?? e.start).slice(0, 10);
    if (day < from || day >= to) continue;
    if (!e.allDay && e.end < nowLocal) continue;
    // made for a todo (a proposal accepted): that todo is it — it's due then, no second one
    if (e.todoId) {
      ensureDue.push({ id: e.todoId, day });
      continue;
    }
    due.push({ ...e, day, cal });
  }
  if (!due.length) return { adds: [], dismiss: [], ensureDue, verdicts: null, asked: 0 };

  // the AI's verdicts for the appointments it hasn't judged yet (null: it failed — each one is a todo then)
  let all = (await zeff.call("pref.get", { key: VERDICTS })).value ?? {};
  const ask = [...new Map(due.filter((e) => !all[verdictKey(e)]).map((e) => [verdictKey(e), e])).values()].slice(0, BATCH);
  let verdicts = all;
  let changed = false;
  if (ask.length) {
    try {
      const lines = ask.map((e, i) =>
        JSON.stringify({
          id: String(i),
          title: e.title,
          when: e.allDay ? "ganztägig" : `${e.start.slice(11, 16)}–${e.end.slice(11, 16)}`,
          repeats: !!(e.recurrence || e.seriesId),
          calendar: e.cal.name,
          ...(e.location ? { location: e.location } : {}),
          ...(e.description ? { notes: e.description.slice(0, 600) } : {}),
          ...(e.attendees?.length ? { attendees: e.attendees.length } : {}),
        }),
      );
      const instructions = (await zeff.call("prompts.fill", { key: "calendar-todos", template: TODOS_INSTRUCTIONS, vars: {} })).text;
      const answer = await zeff.call("ai.json", { prompt: [instructions, "", "# Termine", ...lines].join("\n"), schema: TODOS_SCHEMA, task: "calendar-ext.todos", budget: 0.2 });
      const at = new Date().toISOString();
      verdicts = { ...all };
      for (const a of answer?.appointments ?? []) {
        const e = ask[Number(a.id)];
        if (!e || typeof a.todo !== "boolean") continue;
        const text = String(a.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
        verdicts[verdictKey(e)] = { todo: a.todo, ...(text ? { text } : {}), at };
        changed = true;
      }
    } catch {
      verdicts = null;
    }
  }

  const adds = [];
  const dismiss = [];
  for (const e of due) {
    // which appointment on which day: a series and its moved occurrences share one (one read from a source — Outlook — by the source's own key)
    const ref = `event:${e.cal.source === "zeff" ? (e.seriesId ?? e.id) : e.key}@${e.day}`;
    const v = verdicts?.[verdictKey(e)];
    if (verdicts && !v) continue; // not judged yet (beyond this run's batch): the next run
    if (v && !v.todo) {
      dismiss.push({ ref });
      continue;
    }
    const what = v?.text || e.title;
    adds.push({ text: e.allDay ? what : `${what} (${e.start.slice(11, 16)})`, due: e.day, ref, source: `Kalender „${e.cal.name}“` });
  }
  return { adds, dismiss, ensureDue, verdicts: changed ? verdicts : null, asked: ask.length };
}
