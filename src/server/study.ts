import { randomUUID } from "node:crypto";
import { Library } from "./library.ts";
import { Store } from "./database.ts";
import type {
  Entry,
  Card,
  Question,
  Attempt,
  Session,
  SessionItem,
  Outcome,
} from "../core/models.ts";
import {
  FORMS,
  assignVerbs,
  conjugate,
  verbClass,
} from "../core/conjugation.ts";
import {
  freshMemory,
  rankedCards,
  schedule,
  strength,
  urgency,
  DAY,
} from "../core/scheduler.ts";
import { matches, kana } from "../core/answers.ts";
import { confusionMatches, contrasts, senses } from "../core/confusables.ts";
export class Study {
  library: Library;
  constructor(
    public store: Store,
    public clock = Date.now,
    public random = Math.random,
  ) {
    this.library = new Library(store);
  }
  forms() {
    return this.store.all("SELECT * FROM forms").map((r) => ({
      ...FORMS.find((f) => f.id === r.id)!,
      enabled: !!r.enabled,
    }));
  }
  enable(formId: string, enabled: boolean) {
    if (!FORMS.some((f) => f.id === formId)) throw new Error("Unknown form");
    return this.store.tx(() => {
      this.store.run(
        "UPDATE forms SET enabled=? WHERE id=?",
        Number(enabled),
        formId,
      );
      if (enabled)
        for (let n = 1; n <= 50; n++)
          for (const d of ["forward", "reverse"])
            this.store.run(
              "INSERT INTO cards(id,form_id,slot,deck,direction,active,created,memory) VALUES(?,?,?,'conjugation',?,1,?,?) ON CONFLICT(form_id,slot,direction) DO UPDATE SET active=1",
              randomUUID(),
              formId,
              n,
              d,
              this.clock(),
              JSON.stringify(freshMemory()),
            );
      else this.store.run("UPDATE cards SET active=0 WHERE form_id=?", formId);
    });
  }
  assignments() {
    const entries = this.library
      .entries()
      .filter((e) => e.kind === "vocabulary" && e.active);
    return new Map(
      this.forms()
        .filter((f) => f.enabled)
        .map((f) => [f.id, assignVerbs(entries, f, this.random)]),
    );
  }
  available(assignments = this.assignments()) {
    return this.library
      .cards(true)
      .filter(
        (c) =>
          c.deck !== "conjugation" || assignments.get(c.formId!)?.has(c.slot!),
      );
  }
  queue(
    filters: {
      deck?: string;
      direction?: string;
      min?: number;
      max?: number;
      preset?: string;
      entryIds?: string[];
    } = {},
  ) {
    const entries = new Map(this.library.entries().map((e) => [e.id, e]));
    let cards = this.available().filter(
      (c) =>
        (!filters.deck || filters.deck === "all" || c.deck === filters.deck) &&
        (!filters.direction ||
          filters.direction === "all" ||
          c.direction === filters.direction) &&
        (!filters.entryIds ||
          (!!c.entryId && filters.entryIds.includes(c.entryId))) &&
        (entries.get(c.entryId ?? "")?.data.rank ?? 0) >= (filters.min ?? 0) &&
        (entries.get(c.entryId ?? "")?.data.rank ?? 0) <=
          (filters.max ?? Infinity),
    );
    cards = rankedCards(cards, this.clock());
    if (filters.preset === "weakest")
      cards.sort(
        (a, b) =>
          strength(a.memory).total - strength(b.memory).total ||
          a.id.localeCompare(b.id),
      );
    if (filters.preset === "streak")
      cards.sort(
        (a, b) => a.memory.streak - b.memory.streak || a.id.localeCompare(b.id),
      );
    if (filters.preset === "oldest")
      cards.sort(
        (a, b) =>
          (a.memory.lastReviewed ?? 0) - (b.memory.lastReviewed ?? 0) ||
          a.id.localeCompare(b.id),
      );
    if (filters.preset === "newest")
      cards.sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
    return cards.map((c) => ({
      ...c,
      urgency: urgency(c.memory, this.clock()),
      score: strength(c.memory).total,
      title: c.entryId
        ? entries.get(c.entryId)?.data.word
        : `${FORMS.find((f) => f.id === c.formId)?.label} · #${c.slot}`,
    }));
  }
  question(c: Card, assignments: ReturnType<Study["assignments"]>): Question {
    if (c.deck === "conjugation") {
      const e = assignments.get(c.formId!)?.get(c.slot!);
      if (!e) throw new Error("No eligible active verb for this slot");
      const form = FORMS.find((f) => f.id === c.formId)!;
      const forms = conjugate(e, c.formId!);
      const reverse = c.direction === "reverse";
      return {
        cardId: c.id,
        entryId: e.id,
        deck: c.deck,
        direction: c.direction,
        formId: c.formId!,
        slot: c.slot!,
        verbId: e.id,
        prompt: reverse ? forms.written[0] : e.data.word,
        reading: reverse ? forms.readings[0] : e.data.reading,
        label: reverse
          ? "Recall the dictionary form and conjugation label"
          : form.label,
        expected: reverse ? [`${e.data.word} / ${form.label}`] : forms.readings,
        answerKind: reverse ? "self" : "japanese",
        details: e.data,
        speechPrompt: reverse ? forms.readings[0] : e.data.reading,
        speechAnswer: reverse ? e.data.reading : forms.readings[0],
      };
    }
    const e = this.library.entry(c.entryId!);
    const japanese =
      c.direction === "en-jp" || c.direction === "on" || c.direction === "kun";
    const expected =
      c.direction === "en-jp"
        ? [e.data.reading]
        : c.direction === "on"
          ? e.data.onyomi
          : c.direction === "kun"
            ? e.data.kunyomi
            : senses(e);
    return {
      cardId: c.id,
      entryId: e.id,
      deck: c.deck,
      direction: c.direction,
      prompt: c.direction === "en-jp" ? e.data.meanings[0] : e.data.word,
      reading:
        c.deck === "vocabulary" && c.direction === "jp-en"
          ? e.data.reading
          : "",
      label: (
        {
          "jp-en": "Japanese → English",
          "en-jp": "English → Japanese",
          on: "On’yomi reading",
          kun: "Kun’yomi reading",
          meaning: "Kanji meaning",
        } as any
      )[c.direction],
      expected,
      answerKind: japanese ? "japanese" : "english",
      details: e.data,
      speechPrompt: c.direction === "jp-en" ? e.data.reading : "",
      speechAnswer:
        c.deck === "vocabulary"
          ? e.data.reading
          : japanese
            ? kana(expected[0])
            : "",
    };
  }
  create(
    mode: string,
    cardIds: string[] = [],
    options: { count?: number; tricky?: boolean } = {},
  ): Session {
    const assignments = this.assignments(),
      available = new Map(this.available(assignments).map((c) => [c.id, c]));
    let questions: Question[] = [];
    if (mode === "classification") {
      const verbs = this.library
        .entries()
        .filter(
          (e) =>
            e.active &&
            verbClass(e) &&
            (!options.tricky || e.data.reading.endsWith("る")),
        )
        .map((e) => ({ e, key: this.random() }))
        .sort((a, b) => a.key - b.key)
        .slice(0, options.count ?? 20);
      questions = verbs.map(({ e }) => ({
        cardId: null,
        entryId: e.id,
        deck: "classification",
        direction: "class",
        prompt: e.data.word,
        reading: e.data.reading,
        label: "Choose the verb class",
        expected: [verbClass(e)!],
        answerKind: "classification",
        details: e.data,
        speechPrompt: e.data.reading,
        speechAnswer: e.data.reading,
        options: ["Godan", "Ichidan", "Irregular"].map((s) => ({
          id: s,
          text: s,
        })),
      }));
    } else if (mode === "confusables") {
      const entries = this.library
        .entries()
        .filter((e) => e.active && e.kind === "vocabulary");
      const reviewed = new Set(
        this.store
          .all("SELECT DISTINCT entry_id FROM attempts")
          .map((r) => r.entry_id),
      );
      for (const target of entries) {
        const evidence = new Map<string, number>(
          this.store
            .all("SELECT * FROM confusions WHERE a=?", target.id)
            .map((r) => [
              r.b,
              r.score * Math.exp(-(this.clock() - r.last_seen) / (30 * DAY)),
            ]),
        );
        const candidates = contrasts(target, entries, evidence, reviewed);
        if (candidates.length < 2) continue;
        const c = [...available.values()].find(
          (c) => c.entryId === target.id && c.direction === "en-jp",
        );
        if (!c) continue;
        const q = this.question(c, assignments);
        q.answerKind = "choice";
        q.expected = [target.id];
        q.options = [target, ...candidates.map((x) => x.entry)]
          .map((e) => ({
            id: e.id,
            text: `${e.data.word} (${e.data.reading})`,
          }))
          .map((e) => ({ e, key: this.random() }))
          .sort((a, b) => a.key - b.key)
          .map((x) => x.e);
        q.comparison = [target, ...candidates.map((x) => x.entry)].map((e) => ({
          id: e.id,
          word: e.data.word,
          reading: e.data.reading,
          meaning: e.data.meanings.join("; "),
        }));
        questions.push(q);
        if (questions.length >= (options.count ?? 20)) break;
      }
    } else {
      if (new Set(cardIds).size !== cardIds.length)
        throw new Error("Duplicate cards in selection");
      questions = cardIds.map((id) => {
        const c = available.get(id);
        if (!c)
          throw new Error(
            "Selected card is inactive or has no eligible example; refresh the queue",
          );
        return this.question(c, assignments);
      });
    }
    if (!questions.length)
      throw new Error(
        mode === "confusables"
          ? "No unambiguous contrast sets with at least three active words are available yet."
          : "No eligible cards. Activate entries or enable forms first.",
      );
    const id = randomUUID();
    this.store.tx(() => {
      this.store.run(
        "INSERT INTO sessions VALUES(?,?,?,NULL)",
        id,
        mode,
        this.clock(),
      );
      questions.forEach((q, i) =>
        this.store.run(
          "INSERT INTO items VALUES(?,?,?,?,?,NULL,NULL,NULL)",
          randomUUID(),
          id,
          i,
          q.cardId,
          JSON.stringify(q),
        ),
      );
    });
    return this.session(id);
  }
  session(id: string): Session {
    const r = this.store.get("SELECT * FROM sessions WHERE id=?", id);
    if (!r) throw new Error("Session not found");
    const items = this.store
      .all("SELECT * FROM items WHERE session_id=? ORDER BY ordinal", id)
      .map((x): SessionItem => ({
        id: x.id,
        sessionId: id,
        ordinal: x.ordinal,
        question: JSON.parse(x.question),
        presented: x.presented,
        revealed: x.revealed,
        seconds: x.seconds,
        attempt: this.attemptForItem(x.id),
      }));
    return { id, mode: r.mode, started: r.started, ended: r.ended, items };
  }
  attemptForItem(id: string): Attempt | undefined {
    const r = this.store.get("SELECT data FROM attempts WHERE item_id=?", id);
    return r ? JSON.parse(r.data) : undefined;
  }
  item(id: string) {
    const r = this.store.get("SELECT * FROM items WHERE id=?", id);
    if (!r) throw new Error("Question not found");
    return { ...r, question: JSON.parse(r.question) as Question };
  }
  present(id: string) {
    const item = this.item(id);
    const previous = this.store.get(
      "SELECT i.id FROM items i LEFT JOIN attempts a ON a.item_id=i.id WHERE i.session_id=? AND i.ordinal<? AND a.id IS NULL LIMIT 1",
      item.session_id,
      item.ordinal,
    );
    if (previous) throw new Error("Answer the current question first");
    this.store.run(
      "UPDATE items SET presented=COALESCE(presented,?) WHERE id=?",
      this.clock(),
      id,
    );
    return this.publicItem(this.item(id));
  }
  publicItem(item: any) {
    const q: Question = item.question;
    const answered = this.attemptForItem(item.id);
    if (answered || item.revealed !== null)
      return { ...item, attempt: answered };
    const { expected, details, speechAnswer, verbId, comparison, ...safe } = q;
    return { ...item, question: safe };
  }
  publicSession(id: string) {
    const s = this.session(id);
    return {
      ...s,
      items: s.items.map((i) => this.publicItem({ ...i, session_id: id })),
    };
  }
  reveal(id: string) {
    return this.store.tx(() => {
      const item = this.item(id);
      if (item.question.answerKind !== "self")
        throw new Error("Only reverse conjugation cards use self-grading");
      if (item.presented === null)
        throw new Error("Present the question first");
      this.store.run(
        "UPDATE items SET revealed=COALESCE(revealed,?),seconds=COALESCE(seconds,?) WHERE id=?",
        this.clock(),
        Math.max(0, (this.clock() - item.presented) / 1000),
        id,
      );
      return this.publicItem(this.item(id));
    });
  }
  submit(id: string, key: string, given: string, grade?: Outcome): Attempt {
    return this.store.tx(() => {
      const prior = this.attemptForItem(id);
      if (prior) return prior;
      if (this.store.get("SELECT id FROM attempts WHERE submission_key=?", key))
        throw new Error("Submission key already belongs to another answer");
      const item = this.item(id),
        q: Question = item.question;
      if (item.presented === null)
        throw new Error("Question was not presented");
      let result: Outcome;
      if (q.answerKind === "self") {
        if (item.revealed === null)
          throw new Error("Reveal before self-grading");
        if (!grade) throw new Error("Choose a grade");
        result = grade;
      } else if (grade === "pass") result = "pass";
      else if (q.answerKind === "choice" || q.answerKind === "classification")
        result = q.expected.includes(given) ? "correct" : "wrong";
      else
        result = matches(given, q.expected, q.answerKind) ? "correct" : "wrong";
      const now = this.clock(),
        seconds = item.seconds ?? Math.max(0, (now - item.presented) / 1000);
      const card = q.cardId ? this.library.card(q.cardId) : null;
      const update = card ? schedule(card.memory, result, seconds, now) : null;
      const attempt: Attempt = {
        id: randomUUID(),
        itemId: id,
        sessionId: item.session_id,
        cardId: q.cardId,
        entryId: q.entryId,
        timestamp: now,
        mode: this.session(item.session_id).mode,
        question: q,
        given,
        result,
        seconds,
        urgency: card ? urgency(card.memory, now) : null,
        before: card?.memory ?? null,
        after: update?.after ?? null,
        debug: update?.debug ?? null,
      };
      if (card)
        this.store.run(
          "UPDATE cards SET memory=? WHERE id=?",
          JSON.stringify(update!.after),
          card.id,
        );
      this.store.run(
        "INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?)",
        attempt.id,
        id,
        item.session_id,
        q.cardId,
        q.entryId,
        now,
        key,
        JSON.stringify(attempt),
      );
      if (
        result === "wrong" &&
        q.deck === "vocabulary" &&
        ["english", "japanese"].includes(q.answerKind)
      ) {
        const target = this.library.entry(q.entryId),
          associations = confusionMatches(
            this.library.entries(),
            target,
            given,
            q.direction,
          );
        for (const other of associations) {
          const prior = this.store.get(
            "SELECT * FROM confusions WHERE a=? AND b=?",
            target.id,
            other.id,
          );
          const confidence =
            (q.answerKind === "english" && !given.trim().includes(" ")
              ? 0.25
              : 1) / Math.max(1, associations.length);
          const score =
            (prior
              ? prior.score * Math.exp(-(now - prior.last_seen) / (30 * DAY))
              : 0) + confidence;
          this.store.run(
            "INSERT INTO confusions VALUES(?,?,?,?) ON CONFLICT(a,b) DO UPDATE SET score=excluded.score,last_seen=excluded.last_seen",
            target.id,
            other.id,
            score,
            now,
          );
        }
      }
      const left = this.store.get(
        "SELECT count(*) AS n FROM items i LEFT JOIN attempts a ON a.item_id=i.id WHERE i.session_id=? AND a.id IS NULL",
        item.session_id,
      ).n;
      if (!left)
        this.store.run(
          "UPDATE sessions SET ended=? WHERE id=?",
          now,
          item.session_id,
        );
      return attempt;
    });
  }
  history(cardId?: string) {
    return this.store
      .all(
        `SELECT data FROM attempts ${cardId ? "WHERE card_id=?" : ""} ORDER BY timestamp,id`,
        ...(cardId ? [cardId] : []),
      )
      .map((r) => JSON.parse(r.data) as Attempt);
  }
}
