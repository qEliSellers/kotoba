import { z } from "zod";
import { Store } from "./database.ts";
import { EntryData, Directions } from "../core/models.ts";
import { FORMS } from "../core/conjugation.ts";
import { Library } from "./library.ts";
const id = z.string().min(1).max(200),
  num = z.number().finite(),
  time = num.nonnegative(),
  flag = z.union([z.literal(0), z.literal(1)]);
const json = <T extends z.ZodType>(schema: T) =>
  z.unknown().transform((s, ctx) => {
    try {
      const x = typeof s === "string" ? JSON.parse(s) : s;
      schema.parse(x);
      return JSON.stringify(x);
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid structured record" });
      return z.NEVER;
    }
  });
export const MemorySchema = z
  .object({
    streak: num.int().nonnegative(),
    maturity: num.nonnegative(),
    correct: num.int().nonnegative(),
    total: num.int().nonnegative(),
    stability: num.nonnegative(),
    difficulty: num.min(1).max(10),
    interval: num.nonnegative(),
    lastReviewed: time.nullable(),
    nextDue: time.nullable(),
  })
  .strict()
  .refine(
    (m) =>
      m.correct <= m.total &&
      m.streak <= m.correct &&
      m.maturity <= m.streak + 1e-7 &&
      ((m.total === 0 && m.lastReviewed === null && m.nextDue === null) ||
        (m.total > 0 &&
          m.lastReviewed !== null &&
          m.nextDue !== null &&
          m.interval > 0 &&
          Math.abs(m.nextDue - m.lastReviewed - m.interval * 86400000) < 10)),
  );
const QuestionSchema = z.object({
  cardId: id.nullable(),
  entryId: id,
  deck: z.enum(["vocabulary", "kanji", "conjugation", "classification"]),
  direction: z.string(),
  prompt: z.string(),
  reading: z.string(),
  label: z.string(),
  expected: z.array(z.string()).min(1),
  answerKind: z.enum([
    "english",
    "japanese",
    "self",
    "choice",
    "classification",
  ]),
  details: EntryData,
  speechPrompt: z.string(),
  speechAnswer: z.string(),
  formId: id.optional(),
  slot: num.int().min(1).max(50).optional(),
  options: z.array(z.object({ id, text: z.string() })).optional(),
  comparison: z
    .array(
      z.object({
        id,
        word: z.string(),
        reading: z.string(),
        meaning: z.string(),
      }),
    )
    .optional(),
  verbId: id.optional(),
});
const AttemptSchema = z.object({
  id,
  itemId: id,
  sessionId: id,
  cardId: id.nullable(),
  entryId: id,
  timestamp: time,
  mode: z.string(),
  question: QuestionSchema,
  given: z.string(),
  result: z.enum(["correct", "wrong", "pass"]),
  seconds: num.nonnegative(),
  urgency: num.min(0).max(200).nullable(),
  before: MemorySchema.nullable(),
  after: MemorySchema.nullable(),
  debug: z.record(z.string(), z.unknown()).nullable(),
});
const BackupSchema = z
  .object({
    format: z.literal("kotoba-backup"),
    version: z.literal(1),
    schemaVersion: z.literal(1),
    tables: z
      .object({
        entries: z.array(
          z
            .object({
              id,
              kind: z.enum(["vocabulary", "kanji"]),
              source: id,
              source_id: id,
              data: json(EntryData),
              active: flag,
              deleted: flag,
              created: time,
            })
            .strict(),
        ),
        forms: z.array(z.object({ id, enabled: flag }).strict()),
        cards: z.array(
          z
            .object({
              id,
              entry_id: id.nullable(),
              form_id: id.nullable(),
              slot: num.int().min(1).max(50).nullable(),
              deck: z.enum(["vocabulary", "kanji", "conjugation"]),
              direction: z.enum(Directions),
              active: flag,
              created: time,
              memory: json(MemorySchema),
            })
            .strict(),
        ),
        sessions: z.array(
          z
            .object({ id, mode: id, started: time, ended: time.nullable() })
            .strict(),
        ),
        items: z.array(
          z
            .object({
              id,
              session_id: id,
              ordinal: num.int().nonnegative(),
              card_id: id.nullable(),
              question: json(QuestionSchema),
              presented: time.nullable(),
              revealed: time.nullable(),
              seconds: num.nonnegative().nullable(),
            })
            .strict(),
        ),
        attempts: z.array(
          z
            .object({
              id,
              item_id: id,
              session_id: id,
              card_id: id.nullable(),
              entry_id: id,
              timestamp: time,
              submission_key: id,
              data: json(AttemptSchema),
            })
            .strict(),
        ),
        confusions: z.array(
          z
            .object({ a: id, b: id, score: num.nonnegative(), last_seen: time })
            .strict(),
        ),
        settings: z.array(
          z
            .object({
              key: z.enum(["mute", "furigana"]),
              value: json(z.boolean()),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();
export function restore(store: Store, input: unknown) {
  const backup = BackupSchema.parse(input);
  const t = backup.tables;
  if (
    t.forms.length !== FORMS.length ||
    FORMS.some((f) => !t.forms.some((x) => x.id === f.id))
  )
    throw new Error("Backup form catalog does not match this version");
  const items = new Map(t.items.map((i) => [i.id, i]));
  const entries = new Map(t.entries.map((e) => [e.id, e]));
  const cards = new Map(t.cards.map((c) => [c.id, c]));
  const byCard = new Map<string, z.infer<typeof AttemptSchema>[]>();
  for (const i of t.items) {
    const q = JSON.parse(i.question);
    const c = i.card_id ? cards.get(i.card_id) : null;
    if (
      q.cardId !== i.card_id ||
      !entries.has(q.entryId) ||
      (c &&
        (c.deck !== q.deck ||
          c.direction !== q.direction ||
          (c.entry_id !== null && c.entry_id !== q.entryId) ||
          (c.form_id !== null &&
            (c.form_id !== q.formId || c.slot !== q.slot)))) ||
      (!c && q.deck !== "classification")
    )
      throw new Error("Invalid question references");
  }
  for (const a of t.attempts) {
    const d = JSON.parse(a.data),
      i = items.get(a.item_id);
    if (
      !i ||
      a.id !== d.id ||
      a.item_id !== d.itemId ||
      a.session_id !== d.sessionId ||
      a.session_id !== i.session_id ||
      a.card_id !== d.cardId ||
      a.card_id !== i.card_id ||
      a.entry_id !== d.entryId ||
      a.timestamp !== d.timestamp ||
      JSON.stringify(d.question) !== i.question
    )
      throw new Error("Inconsistent review snapshot");
    if (a.card_id) {
      const group = byCard.get(a.card_id) ?? [];
      group.push(d);
      byCard.set(a.card_id, group);
    }
  }
  for (const c of t.cards) {
    const m = JSON.parse(c.memory);
    const attempts = (byCard.get(c.id) ?? []).sort(
      (a, b) => a.after!.total - b.after!.total,
    );
    if (
      m.total !== attempts.length ||
      m.correct !== attempts.filter((a) => a.result === "correct").length
    )
      throw new Error("Card counts disagree with history");
    if (
      attempts.length &&
      (attempts.at(-1)!.timestamp !== m.lastReviewed ||
        JSON.stringify(attempts.at(-1)!.after) !== c.memory)
    )
      throw new Error("Card state disagrees with latest history");
    for (let index = 0; index < attempts.length; index++) {
      const a = attempts[index];
      if (
        !a.before ||
        !a.after ||
        a.before.total !== index ||
        a.after.total !== index + 1 ||
        (index > 0 &&
          JSON.stringify(a.before) !==
            JSON.stringify(attempts[index - 1].after))
      )
        throw new Error("Broken scheduling history chain");
    }
    const e = c.entry_id ? entries.get(c.entry_id) : null;
    if (e && (e.kind !== c.deck || (c.active && (!e.active || e.deleted))))
      throw new Error("Card activation disagrees with its entry");
    if (
      c.form_id &&
      c.active &&
      !t.forms.find((f) => f.id === c.form_id)?.enabled
    )
      throw new Error("Active conjugation card belongs to a disabled form");
  }
  const temp = new Store(":memory:");
  try {
    temp.replaceTables(t);
    const library = new Library(temp);
    for (const entry of library.entries(true))
      library.validate(entry.kind, entry.data);
  } finally {
    temp.close();
  }
  const recovery = store.backup("pre-restore");
  store.replaceTables(t);
  return { restored: true, recovery };
}
