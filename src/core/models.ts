import { z } from "zod";
export const EntryKind = z.enum(["vocabulary", "kanji"]);
export type EntryKind = z.infer<typeof EntryKind>;
export const EntryData = z.object({
  word: z.string().trim().min(1).max(200),
  reading: z.string().trim().max(200).default(""),
  meanings: z.array(z.string().trim().min(1).max(500)).min(1),
  extended: z.array(z.string().trim().min(1).max(500)).default([]),
  rank: z.number().int().positive().nullable().default(null),
  pos: z.string().max(200).default(""),
  notes: z.string().max(10000).default(""),
  onyomi: z.array(z.string().min(1)).default([]),
  kunyomi: z.array(z.string().min(1)).default([]),
  excludedForms: z.array(z.string()).default([]),
});
export type EntryData = z.infer<typeof EntryData>;
export interface Entry {
  id: string;
  kind: EntryKind;
  source: string;
  sourceId: string;
  data: EntryData;
  active: boolean;
  deleted: boolean;
  created: number;
}
export const Directions = [
  "jp-en",
  "en-jp",
  "on",
  "kun",
  "meaning",
  "forward",
  "reverse",
] as const;
export type Direction = (typeof Directions)[number];
export type Outcome = "correct" | "wrong" | "pass";
export interface Memory {
  streak: number;
  maturity: number;
  correct: number;
  total: number;
  stability: number;
  difficulty: number;
  interval: number;
  lastReviewed: number | null;
  nextDue: number | null;
}
export interface Card {
  id: string;
  entryId: string | null;
  formId: string | null;
  slot: number | null;
  deck: EntryKind | "conjugation";
  direction: Direction;
  active: boolean;
  created: number;
  memory: Memory;
}
export interface Question {
  cardId: string | null;
  entryId: string;
  deck: EntryKind | "conjugation" | "classification";
  direction: string;
  prompt: string;
  reading: string;
  label: string;
  expected: string[];
  answerKind: "english" | "japanese" | "self" | "choice" | "classification";
  details: EntryData;
  speechPrompt: string;
  speechAnswer: string;
  formId?: string;
  slot?: number;
  options?: { id: string; text: string }[];
  comparison?: { id: string; word: string; reading: string; meaning: string }[];
  verbId?: string;
}
export interface SessionItem {
  id: string;
  sessionId: string;
  ordinal: number;
  question: Question;
  presented: number | null;
  revealed: number | null;
  seconds: number | null;
  attempt?: Attempt;
}
export interface Attempt {
  id: string;
  itemId: string;
  sessionId: string;
  cardId: string | null;
  entryId: string;
  timestamp: number;
  mode: string;
  question: Question;
  given: string;
  result: Outcome;
  seconds: number;
  urgency: number | null;
  before: Memory | null;
  after: Memory | null;
  debug: Record<string, unknown> | null;
}
export interface Session {
  id: string;
  mode: string;
  started: number;
  ended: number | null;
  items: SessionItem[];
}
