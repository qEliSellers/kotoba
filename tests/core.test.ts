import { test } from "node:test";
import assert from "node:assert/strict";
import {
  freshMemory,
  schedule,
  urgency,
  DAY,
  rankedCards,
  prefix,
  speedFactor,
} from "../src/core/scheduler.ts";
import { matches, romanize } from "../src/core/answers.ts";
import { previewCSV } from "../src/core/imports.ts";
import {
  conjugate,
  FORMS,
  assignVerbs,
  eligibility,
} from "../src/core/conjugation.ts";
import { EntryData, type Entry, type Card } from "../src/core/models.ts";
const entry = (
  word: string,
  reading: string,
  pos: string,
  id = word,
): Entry => ({
  id,
  kind: "vocabulary",
  source: "test",
  sourceId: id,
  data: EntryData.parse({ word, reading, pos, rank: 1, meanings: ["test"] }),
  active: true,
  deleted: false,
  created: 0,
});
const approx = (a: number, b: number, delta = 0.03) =>
  assert.ok(Math.abs(a - b) < delta, `${a} ≈ ${b}`);
test("Appendix B: urgency is capped for display AND equal-priority ranking", () => {
  const m = {
    ...freshMemory(),
    interval: 10,
    lastReviewed: 0,
    nextDue: 10 * DAY,
  };
  assert.equal(urgency(m, 10 * DAY), 100);
  assert.equal(urgency(m, 20 * DAY), 200);
  assert.equal(urgency(m, 100 * DAY), 200);
  const a = { id: "a", memory: { ...m, lastReviewed: -1000 * DAY } } as Card,
    b = { id: "b", memory: m } as Card;
  assert.deepEqual(
    rankedCards([b, a], 100 * DAY).map((x) => x.id),
    ["a", "b"],
  );
  a.memory.lastReviewed = 0;
  b.memory.lastReviewed = -1000 * DAY;
  assert.deepEqual(
    rankedCards([b, a], 100 * DAY).map((x) => x.id),
    ["a", "b"],
  );
});
test("Appendix B: exactly 54 of a 300-card queue", () => {
  const q = Array.from({ length: 300 }, (_, i) => i);
  assert.deepEqual(prefix(q, 54), q.slice(0, 54));
  assert.equal(prefix(q, 54).length, 54);
});
test("Appendix B: ordinary first, second and eighth success calibration", () => {
  let m = freshMemory(),
    now = 100000;
  for (let i = 1; i <= 8; i++) {
    m = schedule(m, "correct", 8, now).after;
    if (i === 1) approx(m.interval, 2);
    if (i === 2) approx(m.interval, 2.5);
    if (i === 8) approx(m.interval, 14, 0.15);
    now = m.nextDue!;
  }
  assert.equal(m.streak, 8);
  assert.equal(m.maturity, 8);
});
test("Appendix B: overdue bonus never exceeds 2x and does not depend on excess lateness", () => {
  const m = schedule(freshMemory(), "correct", 5, 0).after;
  const due = schedule(m, "correct", 5, 2 * DAY),
    late = schedule(m, "correct", 5, 4 * DAY),
    far = schedule(m, "correct", 5, 100 * DAY);
  approx(late.after.interval, due.after.interval * 2);
  approx(far.after.interval, late.after.interval);
});
test("Appendix B: early updates blend absolute due dates by urgency squared", () => {
  const m = schedule(freshMemory(), "correct", 5, 0).after;
  const r = schedule(m, "correct", 5, 0.4 * DAY);
  assert.equal(r.debug.urgency, 20);
  approx(r.debug.weight, 0.04, 0.000001);
  approx(
    r.after.nextDue!,
    m.nextDue! + (r.debug.targetDue - m.nextDue!) * 0.04,
    1,
  );
  assert.ok(r.after.nextDue! - m.nextDue! < 0.05 * DAY);
  assert.equal(r.after.streak, 2);
  approx(r.after.maturity, 1.04);
});
test("agreed adjustment: 1,000 rapid early repeats cannot manufacture maturity or memory", () => {
  let m = schedule(freshMemory(), "correct", 5, 0).after;
  const r = schedule(m, "correct", 5, 0.1 * DAY);
  m = r.after;
  const baseline = { ...m };
  for (let i = 0; i < 1000; i++) m = schedule(m, "correct", 5, 0.1 * DAY).after;
  assert.equal(m.total, 1002);
  assert.equal(m.correct, 1002);
  assert.equal(m.streak, 1002);
  assert.equal(m.maturity, baseline.maturity);
  assert.equal(m.stability, baseline.stability);
  assert.equal(m.nextDue, baseline.nextDue);
  assert.ok(m.maturity < 1.01);
});
test("Appendix B: speed threshold and aggressive earned-growth penalties", () => {
  assert.equal(speedFactor(9.9), 1);
  assert.equal(speedFactor(10), 1);
  assert.equal(speedFactor(15), 0.5);
  assert.equal(speedFactor(25), 0.05);
  assert.equal(speedFactor(100), 0.05);
  const fast = schedule(freshMemory(), "correct", 10, 0).after,
    slow = schedule(freshMemory(), "correct", 25, 0).after;
  assert.ok(slow.interval < 1.1);
  assert.ok(fast.interval > 1.9);
  assert.equal(slow.correct, 1);
  assert.equal(slow.streak, 1);
  assert.equal(slow.maturity, 0.05);
});
test("wrong and pass have identical failure scheduling; early failures always reset streak", () => {
  const m = schedule(freshMemory(), "correct", 1, 0).after;
  assert.deepEqual(
    schedule(m, "wrong", 12, 2 * DAY),
    schedule(m, "pass", 12, 2 * DAY),
  );
  const failed = schedule(m, "wrong", 3, 2 * DAY).after;
  assert.equal(failed.interval, 1);
  assert.equal(failed.streak, 0);
  assert.equal(failed.correct, 1);
  assert.equal(failed.total, 2);
  assert.equal(failed.maturity, 0);
  assert.ok(failed.stability < m.stability);
  const early = schedule(m, "pass", 2, 0.2 * DAY).after;
  assert.equal(early.streak, 0);
  assert.ok(early.nextDue! > 1.9 * DAY);
});
test("Appendix B: precise English synonyms and deterministic common romaji", () => {
  for (const s of ["no way", "SURELY NOT!", "Unexpected."])
    assert.ok(matches(s, ["no way", "surely not", "unexpected"], "english"));
  assert.ok(!matches("maybe", ["no way"], "english"));
  for (const s of ["taberu", "TABERU", "たべる"])
    assert.ok(matches(s, ["たべる"], "japanese"));
  for (const s of ["shi", "si"]) assert.ok(matches(s, ["し"], "japanese"));
  for (const s of ["chi", "ti"]) assert.ok(matches(s, ["ち"], "japanese"));
  assert.ok(matches("gakkou", ["がっこう"], "japanese"));
  assert.ok(!matches("gakou", ["がっこう"], "japanese"));
  assert.equal(romanize("タベル"), "taberu");
});
test("Appendix B: exact 250-row import report, exclusions and duplicates", () => {
  const rows = Array.from(
    { length: 250 },
    (_, i) => `${i},食べる,たべる,${i + 1},v1-t,to eat,to consume,`,
  );
  for (let i = 0; i < 10; i++) rows[i] += "!!! excluded";
  for (let i = 10; i < 15; i++) rows[i] = `${i},食べる,,x,v1-t,to eat,,`;
  for (let i = 20; i < 25; i++) rows[i] = rows[19];
  const p = previewCSV(
    "id,word,form,freq,pos,translation,extended,notes\n" + rows.join("\n"),
    "vocabulary",
  );
  assert.equal(p.total, 250);
  assert.equal(p.accepted.length, 230);
  assert.equal(p.skipped.length, 10);
  assert.equal(p.invalid.length, 5);
  assert.equal(p.duplicates.length, 5);
});
test("CSV handles BOM, quoted commas, multiline notes and rejects missing headers/encoding", () => {
  const p = previewCSV(
    '\ufeffid,word,form,freq,pos,translation,extended,notes\r\n1,食べる,たべる,1,v1-t,"eat, consume",,"line one\nline two"',
    "vocabulary",
  );
  assert.equal(p.accepted[0].data.meanings[0], "eat, consume");
  assert.equal(p.accepted[0].data.notes, "line one\nline two");
  assert.throws(() => previewCSV("id,word\n1,食べる", "vocabulary"));
  assert.throws(() => previewCSV("\ufffd", "vocabulary"));
});
const kaku = entry("書く", "かく", "v5-t");
const expected64 = [
  "書く",
  "書きます",
  "書かない",
  "書きません",
  "書いた",
  "書きました",
  "書かなかった",
  "書きませんでした",
  "書いて",
  "書かないで",
  "書かなくて",
  "書きまして",
  "書いたら",
  "書かなかったら",
  "書きましたら",
  "書けば",
  "書かなければ",
  "書いたり",
  "書きたい",
  "書きたいです",
  "書きたくない",
  "書きたくないです",
  "書きたかった",
  "書きたかったです",
  "書きたくなかった",
  "書きたくなかったです",
  "書ける",
  "書けます",
  "書けない",
  "書けません",
  "書けた",
  "書けました",
  "書けなかった",
  "書けませんでした",
  "書きましょう",
  "書こう",
  "書け",
  "書くな",
  "書きなさい",
  "書くまい",
  "書かれる",
  "書かれます",
  "書かれない",
  "書かれません",
  "書かれた",
  "書かれました",
  "書かれなかった",
  "書かれませんでした",
  "書かせる",
  "書かせます",
  "書かせない",
  "書かせません",
  "書かせた",
  "書かせました",
  "書かせなかった",
  "書かせませんでした",
  "書かせられる",
  "書かせられます",
  "書かせられない",
  "書かせられません",
  "書かせられた",
  "書かせられました",
  "書かせられなかった",
  "書かせられませんでした",
];
test("Appendix A: every one of the 64 supplied written examples", () => {
  assert.equal(FORMS.length, 64);
  assert.equal(new Set(FORMS.map((f) => f.id)).size, 64);
  FORMS.forEach((f, i) =>
    assert.equal(conjugate(kaku, f.id).written[0], expected64[i], f.label),
  );
});
const coreCases = [
  [
    "食べる",
    "たべる",
    "v1-t",
    [
      "たべる",
      "たべます",
      "たべない",
      "たべません",
      "たべた",
      "たべました",
      "たべなかった",
      "たべませんでした",
    ],
  ],
  [
    "する",
    "する",
    "v-irr-t",
    [
      "する",
      "します",
      "しない",
      "しません",
      "した",
      "しました",
      "しなかった",
      "しませんでした",
    ],
  ],
  [
    "来る",
    "くる",
    "v-irr-i",
    [
      "くる",
      "きます",
      "こない",
      "きません",
      "きた",
      "きました",
      "こなかった",
      "きませんでした",
    ],
  ],
] as const;
for (const [w, r, p, expected] of coreCases)
  test("finite variants: " + w, () =>
    expected.forEach((x, i) =>
      assert.equal(conjugate(entry(w, r, p), "core-" + i).readings[0], x),
    ),
  );
test("representative classes: all eight voice/desire variants against independent stem fixtures", () => {
  const fixtures = [
    [
      "食べる",
      "たべる",
      "v1-t",
      "たべ",
      "たべられ",
      "たべられ",
      "たべさせ",
      "たべさせられ",
    ],
    ["する", "する", "v-irr-t", "し", "でき", "され", "させ", "させられ"],
    [
      "来る",
      "くる",
      "v-irr-i",
      "き",
      "こられ",
      "こられ",
      "こさせ",
      "こさせられ",
    ],
  ];
  for (const [w, r, p, desire, potential, passive, causative, cp] of fixtures) {
    const e = entry(w, r, p);
    for (const [g, stem] of [
      ["potential", potential],
      ["passive", passive],
      ["causative", causative],
      ["causative-passive", cp],
    ])
      [
        "る",
        "ます",
        "ない",
        "ません",
        "た",
        "ました",
        "なかった",
        "ませんでした",
      ].forEach((s, i) =>
        assert.equal(conjugate(e, g + "-" + i).readings[0], stem + s),
      );
    [
      "たい",
      "たいです",
      "たくない",
      "たくないです",
      "たかった",
      "たかったです",
      "たくなかった",
      "たくなかったです",
    ].forEach((s, i) =>
      assert.equal(conjugate(e, "desire-" + i).readings[0], desire + s),
    );
  }
});
test("all connective and command variants for ichidan, suru, kuru", () => {
  const fixtures = [
    [
      "食べる",
      "たべる",
      "v1-t",
      "たべて,たべないで,たべなくて,たべまして,たべたら,たべなかったら,たべましたら,たべれば,たべなければ,たべたり",
      "たべましょう,たべよう,たべろ,たべるな,たべなさい,たべるまい",
    ],
    [
      "する",
      "する",
      "v-irr-t",
      "して,しないで,しなくて,しまして,したら,しなかったら,しましたら,すれば,しなければ,したり",
      "しましょう,しよう,しろ,するな,しなさい,するまい",
    ],
    [
      "来る",
      "くる",
      "v-irr-i",
      "きて,こないで,こなくて,きまして,きたら,こなかったら,きましたら,くれば,こなければ,きたり",
      "きましょう,こよう,こい,くるな,きなさい,くるまい",
    ],
  ];
  for (const [w, r, p, con, command] of fixtures) {
    const e = entry(w, r, p);
    con
      .split(",")
      .forEach((x, i) =>
        assert.equal(conjugate(e, "connective-" + i).readings[0], x),
      );
    command
      .split(",")
      .forEach((x, i) =>
        assert.equal(conjugate(e, "command-" + i).readings[0], x),
      );
  }
});
test("Appendix B: godan endings, irregular iku/aru, contractions, semantic eligibility", () => {
  for (const [w, r, te, past] of [
    ["買う", "かう", "かって", "かった"],
    ["行く", "いく", "いって", "いった"],
    ["泳ぐ", "およぐ", "およいで", "およいだ"],
    ["話す", "はなす", "はなして", "はなした"],
    ["待つ", "まつ", "まって", "まった"],
    ["死ぬ", "しぬ", "しんで", "しんだ"],
    ["遊ぶ", "あそぶ", "あそんで", "あそんだ"],
    ["飲む", "のむ", "のんで", "のんだ"],
    ["帰る", "かえる", "かえって", "かえった"],
  ]) {
    const e = entry(w, r, "v5-i");
    assert.equal(conjugate(e, "connective-0").readings[0], te);
    assert.equal(conjugate(e, "core-4").readings[0], past);
  }
  const aru = entry("ある", "ある", "v5-i");
  assert.equal(conjugate(aru, "core-2").readings[0], "ない");
  assert.equal(conjugate(aru, "core-6").readings[0], "なかった");
  assert.ok(
    !eligibility(
      aru,
      FORMS.find((f) => f.id === "potential-0")!,
    ).eligible,
  );
  assert.ok(
    conjugate(kaku, "causative-passive-0").readings.includes("かかされる"),
  );
  assert.equal(
    conjugate(entry("話す", "はなす", "v5-t"), "causative-passive-0").readings
      .length,
    1,
  );
  assert.ok(
    conjugate(kaku, "desire-3").readings.includes("かきたくありません"),
  );
  assert.ok(
    !matches("kakanaide", conjugate(kaku, "connective-2").readings, "japanese"),
  );
});
test("Appendix B: assignment is active-only, without replacement, reserved and unpadded", () => {
  const entries = [
    kaku,
    entry("する", "する", "v-irr-t"),
    entry("来る", "くる", "v-irr-i"),
    { ...entry("食べる", "たべる", "v1-t"), active: false },
  ];
  const a = assignVerbs(entries, FORMS[0], () => 0.5);
  assert.equal(a.size, 3);
  assert.equal(a.get(3)?.data.word, "する");
  assert.equal(a.get(4)?.data.word, "来る");
  assert.equal(new Set([...a.values()].map((e) => e.id)).size, 3);
  assert.ok(![...a.values()].some((e) => !e.active));
});

test("tolerant kanji import accepts reading column aliases and explicit missing readings", () => {
  const result = previewCSV(
    'id,kanji,on’yomi,kun_yomi,meaning,extended_meaning,notes\n1,食,"ショク, ジキ",-,eat,food,\n',
    "kanji",
  );
  assert.equal(result.invalid.length, 0);
  assert.deepEqual(result.accepted[0].data.onyomi, ["ショク", "ジキ"]);
  assert.deepEqual(result.accepted[0].data.kunyomi, []);
  assert.throws(
    () =>
      previewCSV(
        "id,id,word,form,freq,pos,translation,extended,notes",
        "vocabulary",
      ),
    /Duplicate CSV/,
  );
});
test("honorific masu irregularity does not corrupt the normal continuative stem", () => {
  const e = entry("くださる", "くださる", "v5-t");
  assert.equal(conjugate(e, "core-1").readings[0], "くださいます");
  assert.equal(conjugate(e, "desire-0").readings[0], "くださりたい");
  assert.equal(conjugate(e, "command-2").readings[0], "ください");
});

test("duplicate source imports do not pad conjugation slots with the same surface verb", () => {
  const duplicate = { ...kaku, id: "second-import" };
  const map = assignVerbs([kaku, duplicate], FORMS[0], () => 0.5);
  assert.equal(map.size, 1);
});
test("many short-interval correct repeats preserve counts without manufacturing a long interval", () => {
  let m = schedule(freshMemory(), "correct", 3, 0).after;
  for (let n = 1; n <= 1000; n++) m = schedule(m, "correct", 3, n * 1000).after;
  assert.equal(m.total, 1001);
  assert.equal(m.streak, 1001);
  assert.ok(m.maturity < 1.0001);
  assert.ok(m.nextDue! < 2.001 * DAY);
});
