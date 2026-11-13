// What the card helper's rules say about one card under review (the values for {{ … }} in card.md): its front and back, the lesson it
// came from, the course. inputs: { key: "card-<id>" (or the card's id) }
const CARDS = "@learn-ext.i4";
const STEPS = "@learn-ext.i3";
const COURSES = "@learn-ext.i2";
const id = String(inputs.key).trim().replace(/^card-/, "").replace(/^#/, "");
const cards = await zeff.database(CARDS);
const kc = (n) => cards.cols.indexOf(n);
const at = cards.ids.findIndex((x) => String(x) === id);
if (at < 0) throw new Error(`There is no card "${inputs.key}".`);
const card = cards.rows[at];
const step = String(card[kc("Step")] || "");

const steps = await zeff.database(STEPS);
const sc = (n) => steps.cols.indexOf(n);
const s = steps.rows.find((r) => String(r[0]).trim() === step.trim());
const courseName = s ? String(s[sc("Course")] || "").split(",")[0].trim().replace(/^#/, "") : "";
const courses = await zeff.database(COURSES);
const ci = courses.rows.findIndex((r, i) => String(courses.ids[i]) === courseName || String(r[0]).trim().toLowerCase() === courseName.toLowerCase());
const course = ci >= 0 ? courses.rows[ci] : [];

const guide = await zeff.api("workspace.widgets.guide");
return {
  kitGuide: guide.exercises,
  front: String(card[0] || ""),
  back: String(card[kc("Back")] || ""),
  step,
  stepSummary: s && s[sc("Summary")] ? ` (${s[sc("Summary")]})` : "",
  course: String(course[0] || courseName || ""),
  prior: String(course[courses.cols.indexOf("Prior")] || "unbekannt"),
};
