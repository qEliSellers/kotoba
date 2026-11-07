import type { Memory, Outcome, Card } from "./models.ts";
export const DAY = 86_400_000;
// Version is persisted with every attempt; all tunable constants live here.
export const SRS = Object.freeze({
  version: "flex-local-1",
  maxInterval: 365,
  baselineDays: 2,
  baselineGain: 0.5,
  baselinePower: 1.633,
  priorCorrect: 1,
  priorWrong: 1,
  weights: { streak: 0.35, accuracy: 0.35, memory: 0.3 },
  strengthMin: 0.75,
  strengthMax: 1.25,
  maturityScale: 4,
  earlyPower: 2,
  maxOverdue: 2,
  relearnDays: 1,
  failureRetention: 0.35,
  difficultyStep: 0.4,
  recallAtStability: 0.9,
  speedPoints: [
    [10, 1],
    [12, 0.8],
    [15, 0.5],
    [20, 0.2],
    [25, 0.05],
  ] as readonly (readonly number[])[],
});
export const clamp = (x: number, min: number, max: number) =>
  Math.max(min, Math.min(max, x));
export const freshMemory = (): Memory => ({
  streak: 0,
  maturity: 0,
  correct: 0,
  total: 0,
  stability: 0,
  difficulty: 5,
  interval: 0,
  lastReviewed: null,
  nextDue: null,
});
export function urgency(m: Memory, now: number): number {
  return m.lastReviewed === null
    ? 100
    : clamp(
        (100 * (now - m.lastReviewed)) / (Math.max(m.interval, 1e-9) * DAY),
        0,
        200,
      );
}
export function speedFactor(seconds: number): number {
  if (seconds <= 10) return 1;
  if (seconds >= 25) return 0.05;
  for (let i = 1; i < SRS.speedPoints.length; i++) {
    const [x, y] = SRS.speedPoints[i],
      [px, py] = SRS.speedPoints[i - 1];
    if (seconds <= x) return py + ((y - py) * (seconds - px)) / (x - px);
  }
  return 0.05;
}
export function baseline(maturity: number): number {
  return Math.min(
    SRS.maxInterval,
    SRS.baselineDays +
      SRS.baselineGain * Math.max(0, maturity - 1) ** SRS.baselinePower,
  );
}
export function strength(m: Memory) {
  const streak = m.maturity / (m.maturity + SRS.maturityScale);
  const accuracy =
    (m.correct + SRS.priorCorrect) /
    (m.total + SRS.priorCorrect + SRS.priorWrong);
  const memory = clamp(
    Math.log1p(m.stability) / Math.log1p(SRS.maxInterval),
    0,
    1,
  );
  return {
    streak,
    accuracy,
    memory,
    total:
      SRS.weights.streak * streak +
      SRS.weights.accuracy * accuracy +
      SRS.weights.memory * memory,
  };
}
export function schedule(
  before: Memory,
  result: Outcome,
  seconds: number,
  now: number,
) {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(now))
    throw new Error("Invalid review time");
  if (before.lastReviewed !== null && now < before.lastReviewed)
    throw new Error("Clock moved backwards; retry after the last review time");
  const u = urgency(before, now),
    weight = u < 100 ? (u / 100) ** SRS.earlyPower : 1,
    speed = speedFactor(seconds),
    correct = result === "correct";
  const after: Memory = {
    ...before,
    streak: correct ? before.streak + 1 : 0,
    total: before.total + 1,
    correct: before.correct + (correct ? 1 : 0),
    maturity: correct ? before.maturity + weight * speed : 0,
    lastReviewed: now,
  };
  after.difficulty = clamp(
    before.difficulty +
      (correct ? -SRS.difficultyStep * weight * speed : SRS.difficultyStep),
    1,
    10,
  );
  const elapsed =
    before.lastReviewed === null
      ? 0
      : Math.max(0, (now - before.lastReviewed) / DAY);
  const retrievability =
    before.stability > 0
      ? Math.exp((Math.log(SRS.recallAtStability) * elapsed) / before.stability)
      : 0;
  const referenceDifficulty = clamp(
    5 - SRS.difficultyStep * before.maturity,
    1,
    10,
  );
  const difficultyFactor = clamp(
    (11 - before.difficulty) / (11 - referenceDifficulty),
    0.5,
    1.5,
  );
  const retrievalCredit =
    before.total === 0
      ? 1
      : clamp((1 - retrievability) / (1 - SRS.recallAtStability), 0, 1);
  if (correct) {
    const target = Math.max(baseline(after.maturity), before.stability);
    after.stability =
      before.stability +
      (target - before.stability) *
        weight *
        speed *
        difficultyFactor *
        retrievalCredit;
  } else
    after.stability =
      before.stability * (1 - (1 - SRS.failureRetention) * weight);
  const q = strength(after);
  const reference: Memory = {
    ...after,
    correct: after.maturity,
    total: after.maturity,
    stability: baseline(after.maturity),
  };
  const adjustment = clamp(
    1 + q.total - strength(reference).total,
    SRS.strengthMin,
    SRS.strengthMax,
  );
  const late = clamp(u / 100, 1, SRS.maxOverdue);
  const rawCandidate = correct
    ? baseline(after.maturity) * adjustment * late
    : SRS.relearnDays;
  // Penalize earned interval growth, not the existing interval. New slow successes also get little credit.
  const floor =
    before.total === 0
      ? SRS.relearnDays
      : Math.min(before.interval, rawCandidate);
  const candidate = correct
    ? floor + (rawCandidate - floor) * speed
    : rawCandidate;
  const targetDue = now + Math.min(SRS.maxInterval, candidate) * DAY;
  const oldDue = before.nextDue ?? now;
  after.nextDue = oldDue + (targetDue - oldDue) * weight;
  // Re-anchor interval to the latest attempt so urgency=100 precisely at next_due after blending.
  after.interval = Math.max(1e-9, (after.nextDue - now) / DAY);
  return {
    after,
    debug: {
      version: SRS.version,
      config: SRS,
      urgency: u,
      weight,
      speed,
      retrievability,
      difficultyFactor,
      retrievalCredit,
      late,
      rawCandidate,
      candidate,
      adjustment,
      strength: q,
      referenceStrength: strength(reference),
      oldDue,
      targetDue,
      nextDue: after.nextDue,
    },
  };
}
export function rankedCards(cards: Card[], now: number): Card[] {
  return [...cards].sort(
    (a, b) =>
      urgency(b.memory, now) - urgency(a.memory, now) ||
      strength(a.memory).total - strength(b.memory).total ||
      a.id.localeCompare(b.id),
  );
}
export function prefix<T>(items: T[], n: number) {
  return items.slice(0, clamp(Math.floor(n), 0, items.length));
}
