import type { Entry } from "./models.ts";
import { english, kana, matches } from "./answers.ts";
export function distance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        row[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = row;
  }
  return prev[b.length];
}
const phoneticFamily = (s: string) =>
  kana(s)
    .normalize("NFD")
    .replace(/[\u3099\u309a]/g, "")
    .normalize("NFC");
export function senses(e: Entry) {
  return [...e.data.meanings, ...e.data.extended];
}
export function confusionMatches(
  entries: Entry[],
  target: Entry,
  given: string,
  direction: string,
) {
  return entries.filter(
    (e) =>
      e.kind === "vocabulary" &&
      e.active &&
      !e.deleted &&
      e.id !== target.id &&
      matches(
        given,
        direction === "en-jp" ? [e.data.reading] : senses(e),
        direction === "en-jp" ? "japanese" : "english",
      ),
  );
}
export function contrasts(
  target: Entry,
  entries: Entry[],
  evidence: Map<string, number>,
  reviewed: Set<string>,
) {
  const targetSenses = new Set(senses(target).map(english));
  const promptSense = english(target.data.meanings[0]);
  return entries
    .filter(
      (e) =>
        e.kind === "vocabulary" &&
        e.active &&
        !e.deleted &&
        e.id !== target.id &&
        e.data.word !== target.data.word &&
        !senses(e).some((s) => english(s) === promptSense),
    )
    .map((e) => {
      const a = kana(target.data.reading),
        b = kana(e.data.reading),
        d = distance(a, b);
      return {
        entry: e,
        score:
          (evidence.get(e.id) ?? 0) * 10 +
          (a === b
            ? 5
            : phoneticFamily(a) === phoneticFamily(b)
              ? 2.5
              : d <= 2
                ? 3 / (d + 1)
                : 0) +
          (senses(e).some((s) => targetSenses.has(english(s))) ? 1 : 0) +
          (reviewed.has(e.id) ? 0.2 : 0),
      };
    })
    .filter((e) => e.score > 0.5)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .filter(
      (x, i, all) =>
        all.findIndex(
          (y) =>
            y.entry.data.word === x.entry.data.word &&
            y.entry.data.reading === x.entry.data.reading,
        ) === i,
    )
    .slice(0, 3);
}
