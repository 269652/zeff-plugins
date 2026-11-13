// Where a course stands, for the teacher and for the app: level, experience, streak, the daily goal, the steps with their status, what to do next, the
// paths with the person's interest, the study times, the sources, the cards due - and one lesson's place in it.
// inputs: { course?: title, step?: title | key (the lesson looked at) }
const CARDS = "@learn-ext.i4";
const COURSES = "@learn-ext.i2";
const today = new Date().toISOString().slice(0, 10);
// (The tree, the courses and the cards: read at once.)
const [s, courses, cards] = await Promise.all([zeff.call("learn-ext", "state", { course: inputs.course }), zeff.database(COURSES), zeff.database(CARDS)]);
const cc = (n) => courses.cols.indexOf(n);
const ci = s.course ? courses.ids.indexOf(s.course.id) : 0;
const c = courses.rows[ci];
const json = (name, fallback) => { try { return (c && JSON.parse(c[cc(name)] || "")) ?? fallback; } catch { return fallback; } };
const titles = s.nodes.map((n) => n.title);
const ofCourse = new Set(titles);
const kc = (n) => cards.cols.indexOf(n);
const want = inputs.step ? String(inputs.step).trim().toLowerCase() : "";
const here = want ? s.nodes.find((n) => n.key.toLowerCase() === want || n.title.trim().toLowerCase() === want) : null;
const levelCost = (level) => Math.round((100 * Math.pow(1.25, level - 1)) / 10) * 10;
const xpNow = c ? Number(c[cc("XP")]) || 0 : 0;
let lvl = 1, rest = xpNow;
while (rest >= levelCost(lvl) && lvl < 999) rest -= levelCost(lvl++);
const goal = c ? Number(c[cc("DailyGoal")]) || 50 : 50;
const todayXp = c && c[cc("LastDay")] === today ? Number(c[cc("TodayXP")]) || 0 : 0;
// The four stacks (fn/review.js): a card from before them is put in the one its interval so far fits — once, written to the card.
const DAYS = [1, 3, 7, 21];
const boxOf = (interval) => (interval >= 14 ? 4 : interval >= 5 ? 3 : interval >= 2 ? 2 : 1);
const mine = cards.rows.map((r, i) => ({ r, i })).filter(({ r }) => ofCourse.has(String(r[kc("Step")])));
for (const { r, i } of mine) {
  if (kc("Box") < 0 || Number(r[kc("Box")]) >= 1) continue;
  const box = boxOf(Number(r[kc("Interval")]) || 0);
  r[kc("Box")] = box;
  await zeff.updateRow(CARDS, cards.ids[i], { Box: box });
}
const boxNow = (r) => Math.min(4, Math.max(1, Number(r[kc("Box")]) || 1));
// Due now: the ones answered "again" today come last (the rest of the round first), else the lower stack first.
const dueCards = mine
  .map(({ r, i }) => ({ id: cards.ids[i], front: String(r[0]), back: String(r[kc("Back")] || ""), step: String(r[kc("Step")]), exercise: kc("Exercise") >= 0 ? String(r[kc("Exercise")] || "") : "", box: boxNow(r), due: String(r[kc("Due")] || "0"), again: String(r[kc("Last")] || "") === today }))
  .filter((r) => r.due <= today)
  .sort((a, b) => Number(a.again) - Number(b.again) || a.box - b.box);
const due = dueCards.length;
const stacks = [1, 2, 3, 4].map((box) => {
  const inIt = mine.filter(({ r }) => boxNow(r) === box);
  return { box, days: DAYS[box - 1], n: inIt.length, due: inIt.filter(({ r }) => String(r[kc("Due")] || "0") <= today).length };
});
const interests = s.course ? s.course.interests : {};
const byKey = new Map(s.nodes.map((n) => [n.key, n]));
const tree = s.nodes.map((n) => ({ key: n.key, kind: n.kind, parent: n.parent || "", title: n.title, status: n.status, minutes: n.minutes, depth: n.kind === "year" ? 0 : n.kind === "phase" ? 1 : n.kind === "skill" ? 2 : 3 }));
return {
  course: c ? { title: String(c[0]), xp: xpNow, level: lvl, streak: Number(c[cc("Streak")]) || 0, todayXp, dailyGoal: goal, status: String(c[cc("Status")] || "ready"), error: String(c[cc("Error")] || ""), summary: String(c[cc("Summary")] || ""), space: String(c[cc("Space")] || "") } : null,
  level: { n: lvl, into: rest, need: levelCost(lvl), percent: Math.round((rest / levelCost(lvl)) * 100) },
  today: { xp: todayXp, goal, percent: Math.min(100, Math.round((todayXp / goal) * 100)), reached: todayXp >= goal },
  dueCards,
  stacks,
  badges: c ? String(c[cc("Badges")] || "").split(",").map((x) => x.trim()).filter(Boolean).map((id) => ({ id })) : [],
  progress: { ...s.progress, percent: Math.round(s.progress.share * 100) },
  pathList: Object.entries(s.paths).map(([name, p]) => ({ name, steps: p.steps, mastered: p.mastered, interest: interests[name] ?? 1 })),
  slots: json("Slots", []).map((x, i) => ({ index: i, day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][x.day] ?? "?", time: x.time, minutes: x.minutes })),
  sources: c ? String(c[cc("Sources")] || "").split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((l) => l[1]).map((l) => ({ id: l[0], title: l[1], url: l[2] || "" })) : [],
  problems: c ? String(c[cc("Problems")] || "").split("\n").filter(Boolean).map((text) => ({ text })) : [],
  nodes: tree,
  titles,
  next: s.next.map((k) => ({ key: k, title: byKey.get(k).title, minutes: byKey.get(k).minutes, status: byKey.get(k).status, path: byKey.get(k).path || "", summary: byKey.get(k).summary || "", points: byKey.get(k).points })),
  cardsDue: due,
  thisLesson: here ? { step: here.title, key: here.key, status: here.status, parent: here.parent && byKey.get(here.parent) ? byKey.get(here.parent).title : "", summary: here.summary || "", objectives: String(here.objectives || "").split(/[\n;]/).map((x) => x.trim()).filter(Boolean).map((text) => ({ text })), blockers: here.requires.map((k) => byKey.get(k)).filter((x) => x && x.status !== "mastered").map((x) => ({ title: x.title })) } : null,
};
