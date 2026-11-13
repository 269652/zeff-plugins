// Cards for a lesson: the things worth remembering, coming back for review when the person is about to forget them. Each card can keep an
// exercise of its own (an exercise set of the kit, checked here first): the review shows it — the same kind of exercise as in the lesson,
// with no AI needed then. inputs: { step: id or title, cards: [{ front, back, exercise?: exercise set (object or JSON) }], today?: "YYYY-MM-DD" }
const STEPS = "@learn-ext.i3";
const CARDS = "@learn-ext.i4";
const today = inputs.today || new Date().toISOString().slice(0, 10);
const steps = await zeff.database(STEPS);
const want = String(inputs.step).trim().replace(/^#/, "").toLowerCase();
const at = steps.rows.findIndex((r, i) => String(steps.ids[i]) === want || String(r[0]).trim().toLowerCase() === want);
if (at < 0) throw new Error(`There is no step "${inputs.step}".`);
const title = String(steps.rows[at][0]);
const list = (Array.isArray(inputs.cards) ? inputs.cards : []).slice(0, 12).filter((c) => c && c.front && c.back);
// Every exercise checked before anything is written: a mistake comes back with each place, so the cards are sent again whole.
const specs = [];
const problems = [];
for (const [n, c] of list.entries()) {
  const spec = typeof c.exercise === "string" && c.exercise.trim() ? JSON.parse(c.exercise) : c.exercise && typeof c.exercise === "object" ? c.exercise : null;
  if (spec) {
    const chk = await zeff.api("workspace.widgets.check", { spec });
    if (!chk.ok) problems.push(...chk.problems.map((p) => `card ${n + 1} („${String(c.front).slice(0, 40)}“): ${p}`));
  }
  specs.push(spec);
}
if (problems.length) throw new Error(`No cards were made - fix these exercises and send the cards again:\n- ${problems.join("\n- ")}`);
let made = 0;
for (const [n, c] of list.entries()) {
  await zeff.addRow(CARDS, { Front: String(c.front).slice(0, 200), Back: String(c.back).slice(0, 800), Step: title, Box: 1, Reps: 0, Lapses: 0, Ease: 2.5, Interval: 0, Due: today, Exercise: specs[n] ? JSON.stringify(specs[n]) : "" });
  made++;
}
return { step: title, cards: made, withExercise: specs.filter(Boolean).length };
