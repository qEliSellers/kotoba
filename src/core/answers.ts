import { toHiragana, toKana, toRomaji } from "wanakana";
export const splitAnswers = (s: string) =>
  s
    .split(/[;；|、\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
export function english(s: string) {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function kana(s: string) {
  return toHiragana(
    s
      .normalize("NFKC")
      .trim()
      .replace(/[.。・\s\-]/g, ""),
  ).replace(/[.。・\s\-]/g, "");
}
export function romanize(s: string) {
  return toRomaji(kana(s));
}
// Canonicalize deterministic Hepburn/Kunrei spellings while preserving long vowels.
export function japanese(s: string) {
  const normalized = s
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/ō/g, "ou")
    .replace(/ū/g, "uu")
    .replace(/ā/g, "aa")
    .replace(/ī/g, "ii")
    .replace(/ē/g, "ee")
    .replace(/[\s.\-]/g, "");
  return kana(toKana(normalized)).replace(/ぢ/g, "じ").replace(/づ/g, "ず");
}
export function matches(
  given: string,
  expected: string[],
  kind: "english" | "japanese",
) {
  const normal = kind === "english" ? english : japanese;
  const g = normal(given);
  return !!g && expected.some((x) => normal(x) === g);
}
