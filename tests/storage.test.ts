import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/database.ts";
import { Study } from "../src/server/study.ts";
import { restore } from "../src/server/backup.ts";
import { DAY } from "../src/core/scheduler.ts";
import { summarize } from "../src/core/statistics.ts";
const vocab =
  "id,word,form,freq,pos,translation,extended,notes\n1,食べる,たべる,194,v1-t,to eat,to consume,\n2,まさか,まさか,241,adv,no way,surely not; unexpected,\n3,書く,かく,10,v5-t,to write,,\n4,帰る,かえる,20,v5-i,return home,,\n5,変える,かえる,21,v1-t,to change,,\n6,買える,かえる,22,v1-t,can buy,,\n7,する,する,1,v-irr-t,to do,,\n8,来る,くる,2,v-irr-i,to come,,\n";
const kanji =
  "id,kanji,onyomi,kunyomi,meaning,extended meaning,notes\n1,食,ショク,た.べる,eat,food,\n2,書,ショ,か.く,write,,\n3,帰,,かえ.る,return,,\n";
function fixture() {
  const store = new Store(":memory:");
  let now = 1_000_000;
  const study = new Study(
    store,
    () => now,
    () => 0.5,
  );
  study.library.import("vocabulary", "test", vocab, true);
  const entries = study.library
    .entries()
    .sort((a, b) => Number(a.sourceId) - Number(b.sourceId));
  return { store, study, entries, advance: (n: number) => (now += n) };
}
function answer(study: Study, cardId: string, given: string, mode = "custom") {
  const s = study.create(mode, [cardId]);
  study.present(s.items[0].id);
  return study.submit(s.items[0].id, "key-" + s.id, given);
}
test("Appendix B: import is inactive; activation yields exactly two independent stable cards", () => {
  const { store, study, entries, advance } = fixture();
  try {
    assert.equal(study.library.cards().length, 0);
    study.library.activate([entries[0].id], true);
    const cards = study.library.cards();
    assert.equal(cards.length, 2);
    const c = cards.find((c) => c.direction === "en-jp")!;
    answer(study, c.id, "taberu");
    assert.equal(study.library.card(c.id).memory.correct, 1);
    assert.equal(
      study.library.card(cards.find((x) => x.id !== c.id)!.id).memory.total,
      0,
    );
    advance(DAY);
    study.library.activate([entries[0].id], false);
    assert.equal(study.available().length, 0);
    study.library.activate([entries[0].id], true);
    assert.equal(study.library.cards().length, 2);
    assert.equal(study.library.card(c.id).memory.total, 1);
  } finally {
    store.close();
  }
});
test("reimports update source namespace identities, retain history, skips and omissions", () => {
  const { store, study, entries } = fixture();
  try {
    study.library.activate([entries[0].id], true);
    const c = study.library.cards()[0];
    answer(study, c.id, "to eat");
    study.library.import(
      "vocabulary",
      "test",
      vocab.replace("to eat", "eat food"),
      true,
    );
    assert.equal(
      study.library.entry(entries[0].id).data.meanings[0],
      "eat food",
    );
    assert.equal(study.history(c.id).length, 1);
    assert.equal(study.library.cards().length, 2);
    assert.equal(study.history(c.id)[0].question.details.meanings[0], "to eat");
    const excluded = vocab.split("\n").slice(0, 2).join("\n") + "!!!";
    const report = study.library.import("vocabulary", "test", excluded, true);
    assert.equal(report.skipped.length, 1);
    assert.equal(study.library.entries().length, 8);
    study.library.import("vocabulary", "another-source", vocab, true);
    assert.equal(study.library.entries().length, 16);
  } finally {
    store.close();
  }
});
test("Appendix B: kanji three-card and missing-reading rules, extraction reports misses", () => {
  const { store, study, entries } = fixture();
  try {
    study.library.import("kanji", "test", kanji, true);
    study.library.activate(
      entries.map((e) => e.id),
      true,
    );
    const report = study.library.sourceKanji();
    assert.deepEqual(report.missing.sort(), ["変", "来", "買"]);
    const kanjiEntries = study.library
      .entries()
      .filter((e) => e.kind === "kanji")
      .sort((a, b) => Number(a.sourceId) - Number(b.sourceId));
    assert.equal(
      study.library.cards().filter((c) => c.entryId === kanjiEntries[0].id)
        .length,
      3,
    );
    assert.equal(
      study.library.cards().filter((c) => c.entryId === kanjiEntries[2].id)
        .length,
      2,
    );
    const on = study.library.cards().find((c) => c.direction === "on")!;
    const s = study.create("flex", [on.id]);
    assert.equal(s.items[0].question.speechPrompt, "");
    assert.equal(s.items[0].question.reading, "");
    const publicQ = study.present(s.items[0].id).question;
    assert.ok(!("expected" in publicQ));
    assert.ok(!("details" in publicQ));
    assert.ok(!("speechAnswer" in publicQ));
    assert.equal(study.library.search("kanji")[0].data.word, "書");
    assert.equal(study.library.search("kanji")[0].derived, true);
  } finally {
    store.close();
  }
});
test("Appendix B: custom and FlexSRS share immutable history and every snapshot field", () => {
  const { store, study, entries, advance } = fixture();
  try {
    study.library.activate([entries[0].id], true);
    const c = study.library.cards().find((c) => c.direction === "en-jp")!;
    const a = answer(study, c.id, "taberu");
    advance(2 * DAY);
    const b = answer(study, c.id, "TABERU", "flex");
    assert.equal(study.history(c.id).length, 2);
    assert.equal(b.after!.streak, 2);
    assert.equal(b.after!.interval, 2.5);
    assert.equal(a.mode, "custom");
    assert.equal(b.mode, "flex");
    assert.equal(b.given, "TABERU");
    assert.ok(b.debug);
    assert.throws(
      () => store.run("UPDATE attempts SET timestamp=0 WHERE id=?", a.id),
      /immutable/,
    );
    assert.throws(
      () => store.run("DELETE FROM attempts WHERE id=?", a.id),
      /immutable/,
    );
  } finally {
    store.close();
  }
});
test("duplicate requests and independent keys cannot double-grade the same session item", () => {
  const { store, study, entries } = fixture();
  try {
    study.library.activate([entries[0].id], true);
    const c = study.library.cards()[0],
      s = study.create("custom", [c.id]),
      id = s.items[0].id;
    study.present(id);
    const a = study.submit(id, "submit-key", "to eat");
    assert.deepEqual(study.submit(id, "submit-key", "to eat"), a);
    assert.deepEqual(study.submit(id, "other-key", "incorrect"), a);
    assert.equal(study.library.card(c.id).memory.total, 1);
    const s2 = study.create("flex", [c.id]);
    study.present(s2.items[0].id);
    assert.throws(
      () => study.submit(s2.items[0].id, "submit-key", "to eat"),
      /another answer/,
    );
  } finally {
    store.close();
  }
});
test("transaction rollback leaves no partial attempt OR changed schedule", () => {
  const { store, study, entries } = fixture();
  try {
    study.library.activate([entries[0].id], true);
    const c = study.library.cards()[0],
      s = study.create("flex", [c.id]);
    study.present(s.items[0].id);
    store.db.exec(
      "CREATE TRIGGER fail_attempt BEFORE INSERT ON attempts BEGIN SELECT RAISE(ABORT,'injected failure'); END",
    );
    assert.throws(
      () => study.submit(s.items[0].id, "failure", "to eat"),
      /injected failure/,
    );
    assert.deepEqual(study.library.card(c.id).memory, c.memory);
    assert.equal(study.history().length, 0);
    assert.equal(study.session(s.id).ended, null);
    store.db.exec("DROP TRIGGER fail_attempt");
    assert.equal(
      study.submit(s.items[0].id, "failure", "to eat").result,
      "correct",
    );
  } finally {
    store.close();
  }
});
test("Appendix B: restart persists exact entries, intervals, due dates and sessions", () => {
  const dir = mkdtempSync(join(tmpdir(), "kotoba-test-")),
    path = join(dir, "db.sqlite");
  let store = new Store(path);
  try {
    let study = new Study(store, () => 1000000);
    study.library.import("vocabulary", "test", vocab, true);
    study.library.activate(
      [study.library.entries().find((e) => e.data.word === "食べる")!.id],
      true,
    );
    const c = study.library.cards().find((c) => c.direction === "jp-en")!;
    answer(study, c.id, "to eat");
    const saved = store.export();
    store.close();
    store = new Store(path);
    study = new Study(store);
    assert.deepEqual(store.export(), saved);
    assert.equal(study.history(c.id).length, 1);
    assert.equal(study.library.card(c.id).memory.nextDue, 1000000 + 2 * DAY);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Appendix B: complete backup roundtrip and malformed data/ref validation", () => {
  const { store, study, entries } = fixture();
  const target = new Store(":memory:");
  try {
    study.library.activate(
      entries.map((e) => e.id),
      true,
    );
    study.enable("core-0", true);
    answer(
      study,
      study.library.cards().find((c) => c.direction === "en-jp")!.id,
      "taberu",
    );
    const backup = store.export();
    restore(target, backup);
    assert.deepEqual(target.export(), backup);
    const bad = structuredClone(backup);
    bad.tables.cards[0].memory = '{"total":-2}';
    assert.throws(() => restore(target, bad));
    assert.deepEqual(target.export(), backup);
    const broken = structuredClone(backup);
    broken.tables.items[0].session_id = "missing";
    assert.throws(() => restore(target, broken));
    assert.deepEqual(target.export(), backup);
    const absent = structuredClone(backup);
    absent.tables.attempts = [];
    assert.throws(() => restore(target, absent), /history/);
    assert.deepEqual(target.export(), backup);
  } finally {
    store.close();
    target.close();
  }
});
test("restore makes a pre-replacement SQLite recovery copy", () => {
  const dir = mkdtempSync(join(tmpdir(), "kotoba-backup-"));
  const store = new Store(join(dir, "db.sqlite"));
  try {
    restore(store, store.export());
    assert.equal(readdirSync(join(dir, "backups")).length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Appendix B: slots persist when active example verbs change between sessions", () => {
  const { store, study, entries, advance } = fixture();
  try {
    const eat = entries[0],
      write = entries[2];
    study.library.activate([eat.id], true);
    assert.ok(study.forms().every((f) => !f.enabled));
    study.enable("core-1", true);
    assert.equal(
      study.library.cards().filter((c) => c.deck === "conjugation").length,
      100,
    );
    assert.equal(
      study.available().filter((c) => c.deck === "conjugation").length,
      2,
    );
    const c = study
      .available()
      .find((c) => c.deck === "conjugation" && c.direction === "forward")!;
    const s = study.create("conjugation", [c.id]);
    assert.equal(s.items[0].question.verbId, eat.id);
    assert.ok(
      !/Godan|Ichidan|Irregular|v1|v5/.test(
        JSON.stringify(study.present(s.items[0].id).question),
      ),
    );
    study.library.activate([eat.id], false);
    study.library.activate([write.id], true);
    assert.equal(study.session(s.id).items[0].question.verbId, eat.id);
    study.submit(s.items[0].id, "eat", "tabemasu");
    advance(2 * DAY);
    const s2 = study.create("conjugation", [c.id]);
    assert.equal(s2.items[0].question.verbId, write.id);
    study.present(s2.items[0].id);
    study.submit(s2.items[0].id, "write", "kakimasu");
    assert.equal(study.history(c.id).length, 2);
    assert.equal(study.library.card(c.id).memory.streak, 2);
  } finally {
    store.close();
  }
});
test("reverse conjugation timer stops at reveal, examples agree across directions", () => {
  const { store, study, entries, advance } = fixture();
  try {
    study.library.activate(
      entries.map((e) => e.id),
      true,
    );
    study.enable("core-1", true);
    const cards = study
      .available()
      .filter((c) => c.deck === "conjugation" && c.slot === 1);
    const s = study.create(
      "conjugation",
      cards.map((c) => c.id),
    );
    assert.equal(s.items[0].question.verbId, s.items[1].question.verbId);
    const reverse = cards.find((c) => c.direction === "reverse")!;
    const s2 = study.create("conjugation", [reverse.id]);
    study.present(s2.items[0].id);
    advance(5000);
    study.reveal(s2.items[0].id);
    advance(60000);
    const a = study.submit(s2.items[0].id, "reverse", "", "correct");
    assert.equal(a.seconds, 5);
    assert.equal(a.result, "correct");
  } finally {
    store.close();
  }
});
test("Appendix B: wrong-answer associations produce optional unique-choice reviews of original cards", () => {
  const { store, study, entries } = fixture();
  try {
    study.library.activate(
      entries.map((e) => e.id),
      true,
    );
    const home = entries.find((e) => e.data.word === "帰る")!,
      change = entries.find((e) => e.data.word === "変える")!;
    const c = study.library
      .cards()
      .find((c) => c.entryId === home.id && c.direction === "jp-en")!;
    answer(study, c.id, "to change");
    const pair = store.get(
      "SELECT * FROM confusions WHERE a=? AND b=?",
      home.id,
      change.id,
    );
    assert.equal(pair.score, 1);
    answer(study, c.id, "to change");
    assert.equal(
      store.get(
        "SELECT * FROM confusions WHERE a=? AND b=?",
        home.id,
        change.id,
      ).score,
      2,
    );
    const s = study.create("confusables", [], { count: 20 });
    assert.ok(s.items.length);
    for (const item of s.items) {
      assert.ok(item.question.cardId);
      assert.ok(item.question.options!.length >= 3);
      assert.equal(
        new Set(item.question.options!.map((x) => x.id)).size,
        item.question.options!.length,
      );
    }
    const i = s.items[0];
    study.present(i.id);
    const a = study.submit(i.id, "choice", i.question.expected[0]);
    assert.equal(a.result, "correct");
    assert.equal(a.cardId, i.question.cardId);
    assert.equal(a.question.answerKind, "choice");
  } finally {
    store.close();
  }
});
test("classification has exactly three buttons and records drill stats without inventing cards", () => {
  const { store, study, entries } = fixture();
  try {
    study.library.activate(
      entries.map((e) => e.id),
      true,
    );
    const count = study.library.cards().length,
      s = study.create("classification");
    const i = s.items[0];
    assert.deepEqual(
      i.question.options!.map((x) => x.id),
      ["Godan", "Ichidan", "Irregular"],
    );
    study.present(i.id);
    const a = study.submit(i.id, "class", i.question.expected[0]);
    assert.equal(a.cardId, null);
    assert.equal(study.library.cards().length, count);
    const stats = summarize(study.history(), study.library.cards(), 1000000);
    assert.equal(stats.total, 1);
    assert.equal(stats.correct, 1);
    assert.equal(stats.streak, 1);
  } finally {
    store.close();
  }
});
test("deleted entries retain history and reimports do not silently reactivate them", () => {
  const { store, study, entries } = fixture();
  try {
    study.library.activate([entries[0].id], true);
    const c = study.library.cards()[0];
    answer(study, c.id, "to eat");
    study.library.remove(entries[0].id);
    assert.equal(study.history(c.id).length, 1);
    assert.equal(study.library.card(c.id).active, false);
    const p = study.library.import("vocabulary", "test", vocab, true);
    assert.equal(p.archived.length, 1);
    assert.ok(study.library.entry(entries[0].id).deleted);
  } finally {
    store.close();
  }
});

test("interleaved sessions use the latest scheduling state without losing either attempt", () => {
  const { store, study, entries, advance } = fixture();
  try {
    study.library.activate([entries[0].id], true);
    const c = study.library.cards().find((c) => c.direction === "en-jp")!;
    const a = study.create("flex", [c.id]),
      b = study.create("custom", [c.id]);
    study.present(a.items[0].id);
    study.present(b.items[0].id);
    const first = study.submit(a.items[0].id, "concurrent-a", "taberu");
    advance(1000);
    const second = study.submit(b.items[0].id, "concurrent-b", "taberu");
    assert.deepEqual(second.before, first.after);
    assert.equal(second.after!.total, 2);
    assert.ok(second.after!.maturity < 1.001);
    assert.equal(study.history(c.id).length, 2);
  } finally {
    store.close();
  }
});
test("semantic overlaps propose contrasts only when the primary prompt stays unambiguous", async () => {
  const { contrasts } = await import("../src/core/confusables.ts");
  const { store, study, entries } = fixture();
  try {
    const target = {
      ...entries[0],
      active: true,
      data: { ...entries[0].data, meanings: ["consume"], extended: ["use"] },
    };
    const candidate = {
      ...entries[1],
      active: true,
      data: {
        ...entries[1].data,
        reading: "ものすごくながい",
        meanings: ["employ"],
        extended: ["use"],
      },
    };
    const ambiguous = {
      ...entries[2],
      active: true,
      data: { ...entries[2].data, meanings: ["consume"], extended: [] },
    };
    const result = contrasts(
      target,
      [candidate, ambiguous],
      new Map(),
      new Set(),
    );
    assert.deepEqual(
      result.map((x) => x.entry.id),
      [candidate.id],
    );
  } finally {
    store.close();
  }
});
test("wrong-answer evidence never links to a kanji entry", async () => {
  const { confusionMatches } = await import("../src/core/confusables.ts");
  const { store, study, entries } = fixture();
  try {
    study.library.import("kanji", "kanji", kanji, true);
    const k = study.library.entries().find((e) => e.kind === "kanji")!;
    assert.equal(
      confusionMatches(
        [{ ...k, active: true }],
        entries[0],
        k.data.meanings[0],
        "jp-en",
      ).length,
      0,
    );
  } finally {
    store.close();
  }
});
test("pre-migration backup is saved before initializing an existing SQLite file", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "kotoba-migrate-")),
    path = join(dir, "existing.sqlite");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA user_version=0");
  db.close();
  const store = new Store(path);
  try {
    assert.equal(
      readdirSync(join(dir, "backups")).filter((n) =>
        n.startsWith("pre-migration"),
      ).length,
      1,
    );
    assert.equal(store.get("PRAGMA user_version").user_version, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("session snapshot immutability is enforced by SQLite", () => {
  const { store, study, entries } = fixture();
  try {
    study.library.activate([entries[0].id], true);
    const s = study.create("flex", [study.library.cards()[0].id]);
    assert.throws(
      () =>
        store.run(
          "UPDATE items SET question=? WHERE id=?",
          "{}",
          s.items[0].id,
        ),
      /immutable/,
    );
    study.present(s.items[0].id);
  } finally {
    store.close();
  }
});

test("unranked kanji without a matching vocabulary word is not labeled as derived", () => {
  const { store, study } = fixture();
  try {
    study.library.import("kanji", "test", kanji, true);
    const unranked = study.library.save("kanji", {
      word: "日",
      meanings: ["sun"],
      onyomi: [],
      kunyomi: ["ひ"],
    });
    const record = study.library
      .search("kanji")
      .find((e) => e.id === unranked.id)!;
    assert.equal(record.displayRank, null);
    assert.equal(record.derived, false);
    const matched = study.library
      .search("kanji")
      .find((e) => e.data.word === "食")!;
    assert.equal(matched.displayRank, 194);
    assert.equal(matched.derived, true);
  } finally {
    store.close();
  }
});
