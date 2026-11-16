/** The calendar's day arithmetic and wording — the built-in's view-shared.ts (viewRange, stepDay, viewTitle, whenText, optionOf …) as plain code for the lambdas. Local days "YYYY-MM-DD", local stamps "YYYY-MM-DDTHH:MM". */
const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const stampOf = (d) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const noon = (day) => new Date(`${day}T12:00:00`);
export const addDays = (day, n) => {
  const d = noon(day);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const weekday = (day) => (noon(day).getDay() + 6) % 7;
export const mondayOf = (day) => addDays(day, -weekday(day));
export const VIEWS = ["day", "week", "month", "agenda"];

/** The range a view's appointments are read for ([from, to), days). */
export function viewRange(view, day) {
  if (view === "day") return { from: day, to: addDays(day, 1) };
  if (view === "week") {
    const from = mondayOf(day);
    return { from, to: addDays(from, 7) };
  }
  if (view === "month") {
    const from = mondayOf(`${day.slice(0, 7)}-01`);
    return { from, to: addDays(from, 42) };
  }
  return { from: day, to: addDays(day, 30) };
}

/** The day a step back or forward goes to. */
export function stepDay(view, day, n) {
  if (view === "day") return addDays(day, n);
  if (view === "week") return addDays(day, 7 * n);
  if (view === "agenda") return addDays(day, 30 * n);
  const d = noon(`${day.slice(0, 7)}-01`);
  d.setMonth(d.getMonth() + n);
  return ymd(d);
}

/** The heading of what's shown: "12 – 18 Oct 2026", "October 2026", "Monday, 12 October 2026". */
export function viewTitle(view, day, lang) {
  const d = noon(day);
  if (view === "day") return d.toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (view === "month") return d.toLocaleDateString(lang, { month: "long", year: "numeric" });
  const { from, to } = viewRange(view, day);
  const a = noon(from);
  const b = noon(addDays(to, -1));
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  return `${a.toLocaleDateString(lang, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short", ...(a.getFullYear() !== b.getFullYear() ? { year: "numeric" } : {}) })} – ${b.toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" })}`;
}

const dayText = (s, lang) => noon(s.slice(0, 10)).toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" });
const timeText = (s) => (s.length === 10 ? "" : s.slice(11, 16));
/** "Mon 12 Oct, 09:00 – 10:30", "Mon 12 Oct – Wed 14 Oct · all day". */
export function whenText(it, lang) {
  if (it.allDay) {
    const last = addDays(it.end, -1);
    return last > it.start ? `${dayText(it.start, lang)} – ${dayText(last, lang)} · all day` : `${dayText(it.start, lang)} · all day`;
  }
  return it.start.slice(0, 10) === it.end.slice(0, 10) || (it.end.slice(11) === "00:00" && addDays(it.start.slice(0, 10), 1) === it.end.slice(0, 10))
    ? `${dayText(it.start, lang)}, ${timeText(it.start)} – ${timeText(it.end)}`
    : `${dayText(it.start, lang)} ${timeText(it.start)} – ${dayText(it.end, lang)} ${timeText(it.end)}`;
}

/** An appointment that is one of several options for the same thing: its group and letter ("opt:<group>:<letter>"). */
export const optionOf = (key) => {
  const m = /^opt:([^:]+):([A-Z])$/.exec(String(key ?? ""));
  return m ? { group: m[1], letter: m[2] } : null;
};
