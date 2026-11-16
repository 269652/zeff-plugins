import { optionOf, stampOf, stepDay, viewRange, viewTitle, VIEWS, whenText, ymd } from "./_cal.mjs";

/**
 * What the calendar page shows (the plugin's app view views/calendar.html reads it as data.cal.*): the toolbar's figures (the view, the day, a step back and on, the
 * range as a title), the calendars by source for the sidebar, and the appointments of the range as the page's <schedule> takes them — the calendars' (a series' occurrence
 * is one item), the proposed ones ("Proposed: …" — dashed in the built-in) and those the open todos propose — each with what its details dialog says. The built-in's
 * calendarViewData + calendarAppData + calendarItems (src/plugins/calendar/view-data.ts, app-data.ts, view-shared.ts) over the kernel's appointments.window.
 * event: { view, day, proposed ("true"|"false") }.
 */
const SOURCES = [
  ["zeff", "My calendars"],
  ["google", "Google Calendar"],
  ["outlook", "Outlook"],
];
const MOVABLE = new Set(["calendar-event", "gcal-event", "calendar-entry"]);

export async function handler(event, context) {
  const zeff = context.zeff;
  const lang = context.language === "de" || context.language === "es" ? context.language : "en";
  const today = ymd(new Date());
  const view = VIEWS.includes(event?.view) ? event.view : "week";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(event?.day ?? "")) ? event.day : today;
  const showProposed = event?.proposed === undefined || event?.proposed === null ? true : !["false", "", "0", "no"].includes(String(event.proposed).toLowerCase());
  const { from, to } = viewRange(view, day);
  const win = await zeff.call("appointments.window", { from, to });
  const byId = new Map(win.calendars.map((c) => [c.id, c]));

  const items = [];
  for (const e of win.events) {
    const cal = byId.get(e.calendarId);
    if (!cal || !cal.visible || e.cancelled || (e.proposed && !showProposed)) continue;
    const opt = e.proposed ? optionOf(e.key) : null;
    const shown = e.proposed ? (opt ? `Option ${opt.letter}: ${e.title}` : `Proposed: ${e.title}`) : e.title;
    items.push({
      id: e.occurrence ? `e${e.id}@${e.occurrence}` : `e${e.id}`,
      kind: e.proposed ? "proposal" : "event",
      eventId: e.id,
      occurrence: e.occurrence ?? "",
      title: shown,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      color: e.proposed ? "#6366F1" : cal.color,
      editable: cal.source === "zeff" || e.proposed || (!!cal.writable && (!e.response || e.response === "organizer")),
      when: whenText(e, lang),
      calendar: cal.name,
      location: e.location,
      description: e.description,
      organizer: e.organizer,
      attendees: (e.attendees ?? []).map((a) => ({ a })),
      response: e.response ?? "",
      online: e.online,
      url: e.url,
      series: !!e.recurrence || !!e.seriesId,
      todoRef: "",
      // what the details can do: Zeff never deletes in Google; an invitation of a Google calendar you may write to is answered; a proposal is accepted or dismissed
      canDelete: cal.source === "zeff" || e.proposed,
      canRespond: cal.source === "google" && !!cal.writable && !!e.response && e.response !== "organizer" && !e.proposed,
      canDecide: e.proposed,
      todoId: e.todoId ?? 0,
      index: 0,
      todoTitle: "",
    });
  }
  if (showProposed)
    for (const p of win.proposed) {
      items.push({
        id: `p${p.todoId}_${p.index}`,
        kind: "todo-proposal",
        eventId: 0,
        occurrence: "",
        title: `Proposed: ${p.title}`,
        start: p.start,
        end: p.end,
        allDay: false,
        color: "#6366F1",
        editable: MOVABLE.has(p.type),
        when: whenText({ start: p.start, end: p.end, allDay: false }, lang),
        calendar: p.target,
        location: "",
        description: p.todoText,
        organizer: "",
        attendees: [],
        response: "",
        online: false,
        url: p.href ?? "",
        series: false,
        todoRef: p.todoRef,
        canDelete: false,
        canRespond: false,
        canDecide: false,
        todoId: p.todoId,
        index: p.index,
        todoTitle: p.title,
      });
    }

  const groups = SOURCES.map(([source, label]) => ({
    source,
    label,
    calendars: win.calendars.filter((c) => c.source === source).map((c) => ({ id: c.id, name: c.name, color: c.color, free: !c.busy, visible: c.visible, mark: c.visible ? "●" : "○" })),
  })).filter((g) => g.calendars.length);
  // the calendars an appointment can be put in: Zeff's own (and Google's you may write to)
  const writable = win.calendars.filter((c) => c.source === "zeff" || (c.source === "google" && c.writable));
  const half = new Date();
  half.setMinutes(half.getMinutes() < 30 ? 30 : 60, 0, 0);
  return {
    loading: false,
    view,
    day,
    today,
    prev: stepDay(view, day, -1),
    next: stepDay(view, day, 1),
    title: viewTitle(view, day, lang),
    canSync: !!win.canSync,
    syncFrom: from,
    syncTo: to,
    groups,
    calendarOptions: writable.map((c) => `${c.id}:${String(c.name).replace(/[,:]/g, " ")}`).join(", "),
    firstCalendar: writable[0]?.id ?? 0,
    proposedCount: win.proposed.length,
    newStart: stampOf(half),
    newEnd: stampOf(new Date(half.getTime() + 3600000)),
    items,
    count: items.length,
  };
}
