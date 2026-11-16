/**
 * An appointment dragged or resized on the page: what to write (a lambda only reads — the flow `calendar.move` writes). item: the page's id — "e<id>" (a calendar's
 * appointment), "e<id>@<day>" (one occurrence of a series: changed alone) or "p<todoId>_<index>" (an appointment a todo proposes: its action gets the new time).
 * Answers { kind: "save", input } (for appointments.save), { kind: "todo", todo, index, start, end } (appointments.move-todo-proposal) or { kind: "none", error }.
 */
const STAMP = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

export async function handler(event, context) {
  const item = String(event?.item ?? "");
  const start = String(event?.start ?? "").slice(0, 16);
  const end = String(event?.end ?? "").slice(0, 16);
  if (!STAMP.test(start) || !STAMP.test(end)) return { kind: "none", error: "The time isn't one (YYYY-MM-DDTHH:MM)." };
  const prop = /^p(\d+)_(\d+)$/.exec(item);
  if (prop) return { kind: "todo", todo: Number(prop[1]), index: Number(prop[2]), start, end };
  const m = /^e(\d+)(?:@(\d{4}-\d{2}-\d{2}))?$/.exec(item);
  if (!m) return { kind: "none", error: "That isn't an appointment." };
  const got = await context.zeff.call("appointments.event", { id: Number(m[1]), occurrence: m[2] ?? "" });
  if (!got.found) return { kind: "none", error: "This event isn't there any more — reload the calendar." };
  const e = got.event;
  return {
    kind: "save",
    input: {
      id: e.id,
      calendarId: e.calendarId,
      title: e.title,
      start: e.allDay ? start.slice(0, 10) : start,
      end: e.allDay ? end.slice(0, 10) : end,
      allDay: e.allDay,
      location: e.location,
      description: e.description,
      occurrence: m[2] ?? "",
      // an occurrence of a series moves alone
      scope: m[2] ? "one" : "all",
    },
  };
}
