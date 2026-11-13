// An exercise kept with a card (an exercise set of the kit, checked here first) — the review shows it from then on, with no AI needed.
// inputs: { card: "card-<id>" or the card's id, exercise: exercise set (object or JSON) }
const CARDS = "@learn-ext.i4";
const id = String(inputs.card).trim().replace(/^card-/, "").replace(/^#/, "");
const cards = await zeff.database(CARDS);
const at = cards.ids.findIndex((x) => String(x) === id);
if (at < 0) throw new Error(`There is no card "${inputs.card}".`);
const spec = typeof inputs.exercise === "string" ? JSON.parse(inputs.exercise) : inputs.exercise;
if (!spec || typeof spec !== "object") throw new Error("exercise: an exercise set of the kit ({ title, items: [...] }).");
const chk = await zeff.api("workspace.widgets.check", { spec });
if (!chk.ok) throw new Error(`The exercise wasn't kept - fix these and send it again:\n- ${chk.problems.join("\n- ")}`);
await zeff.updateRow(CARDS, cards.ids[at], { Exercise: JSON.stringify(spec) });
return { card: cards.ids[at], kept: true };
