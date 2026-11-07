import type { Attempt, Card } from "./models.ts";
export const dayKey = (n: number) => {
  const d = new Date(n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function summarize(
  attempts: Attempt[],
  cards: Card[],
  now = Date.now(),
) {
  const correct = attempts.filter((a) => a.result === "correct").length,
    seconds = attempts.reduce((n, a) => n + a.seconds, 0),
    days = new Set(attempts.map((a) => dayKey(a.timestamp)));
  let streak = 0;
  const cursor = new Date(now);
  if (!days.has(dayKey(+cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(+cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  const daily = new Map<
    string,
    { date: string; total: number; correct: number; seconds: number }
  >();
  for (const a of attempts) {
    const key = dayKey(a.timestamp),
      d = daily.get(key) ?? { date: key, total: 0, correct: 0, seconds: 0 };
    d.total++;
    d.correct += Number(a.result === "correct");
    d.seconds += a.seconds;
    daily.set(key, d);
  }
  const mastery = {
    New: 0,
    Relearning: 0,
    Developing: 0,
    Established: 0,
    Mature: 0,
  };
  for (const c of cards) {
    const m = c.memory;
    const category =
      m.total === 0
        ? "New"
        : m.maturity < 1
          ? "Relearning"
          : m.maturity < 3
            ? "Developing"
            : m.maturity < 8
              ? "Established"
              : "Mature";
    mastery[category]++;
  }
  return {
    total: attempts.length,
    correct,
    seconds,
    accuracy: attempts.length ? correct / attempts.length : 0,
    quizzes: new Set(attempts.map((a) => a.sessionId)).size,
    streak,
    studyDays: days.size,
    mastery,
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
