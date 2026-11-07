import type { Entry } from "./models.ts";
import { kana } from "./answers.ts";
export type VerbClass = "Godan" | "Ichidan" | "Irregular";
export interface Form {
  id: string;
  label: string;
  group: string;
  variant: number;
}
const finiteLabels = [
  "present) (casual) (affirmative",
  "present) (polite) (affirmative",
  "present) (casual) (negative",
  "present) (polite) (negative",
  "past) (casual) (affirmative",
  "past) (polite) (affirmative",
  "past) (casual) (negative",
  "past) (polite) (negative",
];
const eight = (group: string): Form[] =>
  finiteLabels.map((x, i) => ({
    id: `${group.toLowerCase()}-${i}`,
    group,
    label: `${group} (${x})`,
    variant: i,
  }));
export const FORMS: Form[] = [
  ...eight("Core").map((f, i) => ({
    ...f,
    label: `${i < 4 ? "Present" : "Past"} (${i % 2 ? "polite" : "casual"}) (${i % 4 < 2 ? "affirmative" : "negative"})`,
  })),
  ...[
    "Te (casual) (affirmative)",
    "Te (negative: without)",
    "Te (negative: reason)",
    "Te (formal connective)",
    "Tara (casual) (affirmative)",
    "Tara (casual) (negative)",
    "Tara (polite) (affirmative)",
    "Ba (casual) (affirmative)",
    "Ba (casual) (negative)",
    "Tari (affirmative)",
  ].map((label, i) => ({
    id: `connective-${i}`,
    label,
    group: "Connectives",
    variant: i,
  })),
  ...eight("Desire"),
  ...eight("Potential"),
  ...[
    "Volitional (polite)",
    "Volitional (casual)",
    "Imperative (casual)",
    "Prohibitive",
    "Imperative (なさい)",
    "Negative volitional (formal)",
  ].map((label, i) => ({
    id: `command-${i}`,
    label,
    group: "Commands",
    variant: i,
  })),
  ...eight("Passive"),
  ...eight("Causative"),
  ...eight("Causative-passive"),
];
export function verbClass(e: Entry): VerbClass | null {
  if (e.kind !== "vocabulary") return null;
  if (/(^|[;,\s])v1(?:\b|-)/.test(e.data.pos)) return "Ichidan";
  if (/(^|[;,\s])v5(?:\b|-)/.test(e.data.pos)) return "Godan";
  if (/v-irr|vs|vk/.test(e.data.pos)) return "Irregular";
  return null;
}
const rows: Record<string, string[]> = {
  う: ["わ", "い", "え", "お", "って", "った"],
  く: ["か", "き", "け", "こ", "いて", "いた"],
  ぐ: ["が", "ぎ", "げ", "ご", "いで", "いだ"],
  す: ["さ", "し", "せ", "そ", "して", "した"],
  つ: ["た", "ち", "て", "と", "って", "った"],
  ぬ: ["な", "に", "ね", "の", "んで", "んだ"],
  ぶ: ["ば", "び", "べ", "ぼ", "んで", "んだ"],
  む: ["ま", "み", "め", "も", "んで", "んだ"],
  る: ["ら", "り", "れ", "ろ", "って", "った"],
};
interface Roots {
  dictionary: string;
  masu: string;
  renyo: string;
  negative: string;
  te: string;
  past: string;
  ba: string;
  potential: string;
  passive: string;
  causative: string;
  cp: string[];
  volitional: string;
  imperative: string;
  mai: string;
}
function roots(text: string, reading: string, cl: VerbClass): Roots {
  const st = text.slice(0, -1),
    last = reading.slice(-1);
  let a = "",
    i = "",
    renyo = "",
    e = "",
    o = "",
    te = "",
    past = "",
    potential = "",
    passive = "",
    causative = "",
    cp: string[] = [],
    volitional = "",
    imperative = "",
    negative = "",
    mai = text + "まい";
  if (cl === "Irregular" && reading.endsWith("する")) {
    const p = text.endsWith("する") ? text.slice(0, -2) : text.slice(0, -1);
    i = p + "し";
    negative = p + "しない";
    te = p + "して";
    past = p + "した";
    e = p + "すれ";
    potential = p + "できる";
    passive = p + "される";
    causative = p + "させる";
    cp = [p + "させられる"];
    volitional = p + "しよう";
    imperative = p + "しろ";
    mai = p + "するまい";
  } else if (cl === "Irregular" && reading === "くる") {
    const kanji = text === "来る",
      p = kanji ? "来" : "";
    i = p + (kanji ? "" : "き");
    negative = p + (kanji ? "" : "こ") + "ない";
    te = i + "て";
    past = i + "た";
    e = p + (kanji ? "れ" : "くれ");
    potential = p + (kanji ? "" : "こ") + "られる";
    passive = potential;
    causative = p + (kanji ? "" : "こ") + "させる";
    cp = [p + (kanji ? "" : "こ") + "させられる"];
    volitional = p + (kanji ? "" : "こ") + "よう";
    imperative = p + (kanji ? "" : "こ") + "い";
    mai = text + "まい";
  } else if (cl === "Ichidan") {
    i = st;
    negative = st + "ない";
    te = st + "て";
    past = st + "た";
    e = st + "れ";
    potential = st + "られる";
    passive = potential;
    causative = st + "させる";
    cp = [st + "させられる"];
    volitional = st + "よう";
    imperative = st + "ろ";
  } else if (cl === "Godan" && rows[last]) {
    const r = rows[last];
    a = st + r[0];
    i = st + r[1];
    e = st + r[2];
    o = st + r[3];
    negative = a + "ない";
    te = st + r[4];
    past = st + r[5];
    potential = e + "る";
    passive = a + "れる";
    causative = a + "せる";
    cp = [a + "せられる", ...(last !== "す" ? [a + "される"] : [])];
    volitional = o + "う";
    imperative = e;
    if (reading === "いく" || reading === "ゆく") {
      te = st + "って";
      past = st + "った";
    }
    if (reading === "ある") negative = "ない";
    if (["とう", "こう"].includes(reading)) {
      te = text + "て";
      past = text + "た";
    }
    renyo = i;
    if (
      ["くださる", "なさる", "いらっしゃる", "おっしゃる", "ござる"].includes(
        reading,
      )
    ) {
      i = st + "い";
      imperative = i;
    }
  } else throw new Error("Unsupported verb metadata");
  return {
    dictionary: text,
    masu: i,
    renyo: renyo || i,
    negative,
    te,
    past,
    ba: e + "ば",
    potential,
    passive,
    causative,
    cp,
    volitional,
    imperative,
    mai,
  };
}
function finite(r: Roots): string[] {
  return [
    r.dictionary,
    r.masu + "ます",
    r.negative,
    r.masu + "ません",
    r.past,
    r.masu + "ました",
    r.negative.slice(0, -1) + "かった",
    r.masu + "ませんでした",
  ];
}
function inflect(r: Roots, f: Form): string[] {
  const v = f.variant;
  if (f.group === "Core") return [finite(r)[v]];
  if (f.group === "Connectives")
    return [
      [
        r.te,
        r.negative + "で",
        r.negative.slice(0, -1) + "くて",
        r.masu + "まして",
        r.past + "ら",
        r.negative.slice(0, -1) + "かったら",
        r.masu + "ましたら",
        r.ba,
        r.negative.slice(0, -1) + "ければ",
        r.past + "り",
      ][v],
    ];
  if (f.group === "Desire")
    return [
      [
        r.renyo + "たい",
        r.renyo + "たいです",
        r.renyo + "たくない",
        r.renyo + "たくないです",
        r.renyo + "たかった",
        r.renyo + "たかったです",
        r.renyo + "たくなかった",
        r.renyo + "たくなかったです",
      ][v],
      ...(v === 3
        ? [r.renyo + "たくありません"]
        : v === 7
          ? [r.renyo + "たくありませんでした"]
          : []),
    ];
  if (f.group === "Commands")
    return [
      [
        r.masu + "ましょう",
        r.volitional,
        r.imperative,
        r.dictionary + "な",
        r.renyo + "なさい",
        r.mai,
      ][v],
    ];
  const bases =
    f.group === "Potential"
      ? [r.potential]
      : f.group === "Passive"
        ? [r.passive]
        : f.group === "Causative"
          ? [r.causative]
          : r.cp;
  return bases.map((b) => finite(roots(b, b, "Ichidan"))[v]);
}
export function eligibility(
  e: Entry,
  f: Form,
): { eligible: boolean; reason?: string } {
  const cl = verbClass(e),
    reading = kana(e.data.reading);
  if (!cl)
    return { eligible: false, reason: "Verb class is missing or unsupported" };
  if (
    e.data.excludedForms.includes(f.id) ||
    e.data.excludedForms.includes(f.group)
  )
    return { eligible: false, reason: "Excluded for this entry" };
  if (cl === "Irregular" && !(reading.endsWith("する") || reading === "くる"))
    return { eligible: false, reason: "Unsupported lexical irregularity" };
  if (cl === "Godan" && !rows[reading.slice(-1)])
    return { eligible: false, reason: "Invalid godan ending" };
  if (cl === "Ichidan" && !reading.endsWith("る"))
    return { eligible: false, reason: "Invalid ichidan ending" };
  if (
    ["ある", "いる", "できる", "わかる"].includes(reading) &&
    [
      "Potential",
      "Desire",
      "Commands",
      "Passive",
      "Causative",
      "Causative-passive",
    ].includes(f.group)
  )
    return {
      eligible: false,
      reason: "Conservative exclusion of stative/inherent-ability verbs",
    };
  return { eligible: true };
}
export function conjugate(e: Entry, formId: string) {
  const f = FORMS.find((f) => f.id === formId);
  if (!f) throw new Error("Unknown conjugation form");
  const eligible = eligibility(e, f);
  if (!eligible.eligible) throw new Error(eligible.reason);
  const cl = verbClass(e)!;
  return {
    written: inflect(roots(e.data.word, kana(e.data.reading), cl), f),
    readings: inflect(roots(kana(e.data.reading), kana(e.data.reading), cl), f),
  };
}
export function assignVerbs(
  entries: Entry[],
  form: Form,
  random = Math.random,
): Map<number, Entry> {
  // Duplicate imports remain separate library records, but identical surface
  // examples must not fill multiple slots in the same session.
  const seen = new Set<string>();
  const eligible = entries
    .filter((e) => e.active && !e.deleted && eligibility(e, form).eligible)
    .sort(
      (a, b) =>
        (a.data.rank ?? Infinity) - (b.data.rank ?? Infinity) ||
        a.id.localeCompare(b.id),
    )
    .filter((e) => {
      const key = [e.data.word, kana(e.data.reading), verbClass(e)].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const picked = new Map<number, Entry>();
  const reserved = new Set<string>();
  for (const [slot, r] of [
    [3, "する"],
    [4, "くる"],
  ] as const) {
    const e = eligible.find(
      (e) =>
        kana(e.data.reading) === r &&
        (r === "する"
          ? e.data.word === "する"
          : ["来る", "くる"].includes(e.data.word)),
    );
    if (e) {
      picked.set(slot, e);
      reserved.add(e.id);
    }
  }
  // Exponential keys implement weighted sampling without replacement.
  const pool = eligible
    .filter((e) => !reserved.has(e.id))
    .map((e) => ({
      e,
      key:
        -Math.log(Math.max(Number.EPSILON, random())) *
        Math.sqrt(e.data.rank ?? 10000),
    }))
    .sort((a, b) => a.key - b.key || a.e.id.localeCompare(b.e.id));
  for (let slot = 1; slot <= 50 && pool.length; slot++) {
    if (!picked.has(slot)) picked.set(slot, pool.shift()!.e);
  }
  return picked;
}
