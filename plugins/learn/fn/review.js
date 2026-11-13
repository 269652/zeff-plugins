// Four stacks (as a Leitner box): a card lives in the stack of how well it is known, and each stack comes back at its own pace — stack 1
// every day, 2 every 3 days, 3 every week, 4 every 3 weeks. Again: back to stack 1, again today (at the end of the round); hard: it stays;
// good: one stack up; easy: two up. inputs: { box?, reps, lapses, ease, interval, grade: "again" | "hard" | "good" | "easy", today?: "YYYY-MM-DD" }
// -> the card's new state. A card without a stack yet is put in the one its interval so far fits.
const DAYS = [1, 3, 7, 21];
const boxOf = (interval) => (interval >= 14 ? 4 : interval >= 5 ? 3 : interval >= 2 ? 2 : 1);
const day = (today, plus) => {
  const t = new Date(`${today}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + plus);
  return t.toISOString().slice(0, 10);
};
const today = inputs.today || new Date().toISOString().slice(0, 10);
const c = { reps: Number(inputs.reps) || 0, lapses: Number(inputs.lapses) || 0, ease: Number(inputs.ease) || 2.5, interval: Number(inputs.interval) || 0 };
const grade = String(inputs.grade || "good");
if (!["again", "hard", "good", "easy"].includes(grade)) throw new Error(`grade is again, hard, good or easy - not "${grade}"`);
const was = Math.min(4, Math.max(1, Number(inputs.box) || boxOf(c.interval)));
if (grade === "again") return { box: 1, reps: 0, lapses: c.lapses + 1, ease: c.ease, interval: 0, due: today, last: today };
const box = Math.min(4, grade === "hard" ? was : grade === "good" ? was + 1 : was + 2);
const interval = DAYS[box - 1];
return { box, reps: c.reps + 1, lapses: c.lapses, ease: c.ease, interval, due: day(today, interval), last: today };
