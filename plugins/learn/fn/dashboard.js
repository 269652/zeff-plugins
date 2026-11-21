// Every course at a glance, for the Learn page: totals (courses, steps mastered, cards due and in which stack, XP today and this week,
// the best streak, exercises done and how well), XP per day for the heatmap, and one line per course. inputs: {}
// (Six reads of the databases at once and no more: every call into Zeff costs a round trip.)
const COURSES = "@learn-ext.i2";
const STEPS = "@learn-ext.i3";
const CARDS = "@learn-ext.i4";
const ACTIVITY = "@learn-ext.i5";
const EXERCISES = "@learn-ext.i10";
const TRIES = "@learn-ext.i20";
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const clean = (s) => String(s ?? "").split(",")[0].trim().replace(/^#/, "").toLowerCase();
const yes = (v) => v === true || v === "Yes" || v === "yes" || v === "true";
const [courses, steps, cards, activity, exercises, tries] = await Promise.all([COURSES, STEPS, CARDS, ACTIVITY, EXERCISES, TRIES].map((d) => zeff.database(d)));
const col = (db) => (n) => db.cols.indexOf(n);
const cc = col(courses), sc = col(steps), kc = col(cards), ac = col(activity), ec = col(exercises), tc = col(tries);
const boxOf = (r) => {
  const b = kc("Box") >= 0 ? Number(r[kc("Box")]) : 0;
  if (b >= 1) return Math.min(4, b);
  const i = Number(r[kc("Interval")]) || 0;
  return i >= 14 ? 4 : i >= 5 ? 3 : i >= 2 ? 2 : 1;
};

// XP per day (the activity log), the last 26 weeks.
const since = daysAgo(26 * 7);
const xpByDay = new Map();
for (const r of activity.rows) {
  const day = String(r[ac("At")] || "").slice(0, 10);
  if (day < since) continue;
  xpByDay.set(day, (xpByDay.get(day) || 0) + (Number(r[ac("XP")]) || 0));
}
const days = [...xpByDay.entries()].sort().map(([day, xp]) => ({ day, xp }));
const lastDays = (n) => Array.from({ length: n }, (_, i) => xpByDay.get(daysAgo(n - 1 - i)) || 0);
const week = lastDays(7).reduce((a, b) => a + b, 0);
const lastWeek = Array.from({ length: 7 }, (_, i) => xpByDay.get(daysAgo(13 - i)) || 0).reduce((a, b) => a + b, 0);
// Days in a row with any XP, up to today (or yesterday, when today has none yet).
let streak = 0;
for (let i = xpByDay.get(today) ? 0 : 1; i < 400 && xpByDay.get(daysAgo(i)); i++) streak++;

// Per course: steps, cards, XP.
const perCourse = courses.rows.map((r, i) => {
  const status = String(r[cc("Status")] || "ready");
  const mine = new Set([String(courses.ids[i]), String(r[0]).trim().toLowerCase()]);
  const own = steps.rows.filter((s) => mine.has(clean(s[sc("Course")])));
  const parents = new Set(own.map((s) => String(s[sc("Parent")] || "")).filter(Boolean));
  const leaves = own.filter((s) => !parents.has(String(s[sc("Key")] || "")));
  const mastered = leaves.filter((s) => yes(s[sc("Mastered")])).length;
  const begun = leaves.filter((s) => yes(s[sc("Begun")]) && !yes(s[sc("Mastered")])).length;
  const titles = new Set(own.map((s) => String(s[0])));
  const myCards = cards.rows.filter((c) => titles.has(String(c[kc("Step")])));
  const due = myCards.filter((c) => String(c[kc("Due")] || "0") <= today).length;
  const lastDay = String(r[cc("LastDay")] || "");
  return {
    title: String(r[0]),
    // (the course's own page: the Courses database opened on it)
    href: courses.id ? `/workspace/${courses.id}?s.tab=course&s.course=${encodeURIComponent(String(r[0]))}` : "",
    status,
    level: Number(r[cc("Level")]) || 1,
    xp: Number(r[cc("XP")]) || 0,
    streak: Number(r[cc("Streak")]) || 0,
    todayXp: lastDay === today ? Number(r[cc("TodayXP")]) || 0 : 0,
    dailyGoal: Number(r[cc("DailyGoal")]) || 50,
    steps: leaves.length,
    mastered,
    begun,
    percent: leaves.length ? Math.round((mastered / leaves.length) * 100) : 0,
    cards: myCards.length,
    due,
    stacks: [1, 2, 3, 4].map((box) => myCards.filter((c) => boxOf(c) === box).length),
  };
});
const ready = perCourse.filter((c) => c.status === "ready");
const sum = (list, k) => list.reduce((a, c) => a + (Number(c[k]) || 0), 0);

// Exercises: done (a best score above 0) and how well; tries in the last 7 days.
const done = exercises.rows.filter((r) => (Number(r[ec("Best")]) || 0) > 0);
const avgBest = done.length ? Math.round((done.reduce((a, r) => a + (Number(r[ec("Best")]) || 0), 0) / done.length) * 100) : 0;
const triesWeek = tries.rows.filter((r) => String(r[tc("At")] || "").slice(0, 10) >= daysAgo(6)).length;

const stackTotals = [1, 2, 3, 4].map((box) => ({ box, n: sum(perCourse.map((c) => ({ n: c.stacks[box - 1] })), "n") }));
const cardsAll = sum(perCourse, "cards");
const stepsAll = sum(ready, "steps");
const masteredAll = sum(ready, "mastered");
const goalAll = sum(ready, "dailyGoal");
const todayAll = sum(ready, "todayXp");
return {
  totals: {
    courses: perCourse.length,
    ready: ready.length,
    steps: stepsAll,
    mastered: masteredAll,
    begun: sum(ready, "begun"),
    percent: stepsAll ? Math.round((masteredAll / stepsAll) * 100) : 0,
    cards: cardsAll,
    due: sum(ready, "due"),
    // (well known: in stack 3 or 4)
    known: stackTotals[2].n + stackTotals[3].n,
    knownPercent: cardsAll ? Math.round(((stackTotals[2].n + stackTotals[3].n) / cardsAll) * 100) : 0,
    xp: sum(perCourse, "xp"),
    todayXp: todayAll,
    dailyGoal: goalAll,
    todayPercent: goalAll ? Math.min(100, Math.round((todayAll / goalAll) * 100)) : 0,
    week,
    lastWeek,
    weekTrend: week - lastWeek,
    streak: Math.max(streak, ...perCourse.map((c) => c.streak), 0),
    level: Math.max(1, ...perCourse.map((c) => c.level)),
    exercises: exercises.rows.length,
    exercisesDone: done.length,
    avgBest,
    triesWeek,
  },
  stacks: stackTotals.map((s) => ({ ...s, days: [1, 3, 7, 21][s.box - 1], percent: cardsAll ? Math.round((s.n / cardsAll) * 100) : 0 })),
  last14: lastDays(14).join(","),
  days,
  courses: perCourse.sort((a, b) => b.xp - a.xp),
};
