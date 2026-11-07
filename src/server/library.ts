import { randomUUID } from "node:crypto";
import { Store } from "./database.ts";
import {
  EntryData,
  type Entry,
  type EntryKind,
  type Card,
  type Direction,
} from "../core/models.ts";
import { freshMemory } from "../core/scheduler.ts";
import { previewCSV } from "../core/imports.ts";
import { romanize, kana } from "../core/answers.ts";
export const readEntry = (r: any): Entry => ({
  id: r.id,
  kind: r.kind,
  source: r.source,
  sourceId: r.source_id,
  data: JSON.parse(r.data),
  active: !!r.active,
  deleted: !!r.deleted,
  created: r.created,
});
export const readCard = (r: any): Card => ({
  id: r.id,
  entryId: r.entry_id,
  formId: r.form_id,
  slot: r.slot,
  deck: r.deck,
  direction: r.direction,
  active: !!r.active,
  created: r.created,
  memory: JSON.parse(r.memory),
});
export class Library {
  constructor(public store: Store) {}
  entries(includeDeleted = false) {
    return this.store
      .all(
        `SELECT * FROM entries ${includeDeleted ? "" : "WHERE deleted=0"} ORDER BY created,id`,
      )
      .map(readEntry);
  }
  entry(id: string) {
    const r = this.store.get("SELECT * FROM entries WHERE id=?", id);
    if (!r) throw new Error("Entry not found");
    return readEntry(r);
  }
  cards(activeOnly = false) {
    return this.store
      .all(`SELECT * FROM cards ${activeOnly ? "WHERE active=1" : ""}`)
      .map(readCard);
  }
  card(id: string) {
    const r = this.store.get("SELECT * FROM cards WHERE id=?", id);
    if (!r) throw new Error("Card not found");
    return readCard(r);
  }
  validate(kind: EntryKind, raw: unknown) {
    const d = EntryData.parse(raw);
    if (kind === "vocabulary" && (!d.reading || !d.rank))
      throw new Error("Vocabulary requires a kana reading and positive rank");
    if (
      kind === "vocabulary" &&
      !/^[\p{Script=Hiragana}ー]+$/u.test(kana(d.reading))
    )
      throw new Error("Reading must be kana");
    if (kind === "kanji" && !/^\p{Script=Han}$/u.test(d.word))
      throw new Error("Enter one kanji character");
    for (const r of [...d.onyomi, ...d.kunyomi])
      if (!/^[\p{Script=Hiragana}ー]+$/u.test(kana(r)))
        throw new Error("Reading must be kana");
    return d;
  }
  save(kind: EntryKind, raw: unknown, id?: string) {
    const d = this.validate(kind, raw);
    return this.store.tx(() => {
      if (id) {
        const e = this.entry(id);
        if (e.kind !== kind || e.deleted)
          throw new Error("Entry cannot be edited");
        this.store.run(
          "UPDATE entries SET data=? WHERE id=?",
          JSON.stringify(d),
          id,
        );
        this.syncCards(id);
        return this.entry(id);
      }
      const newId = randomUUID();
      this.store.run(
        "INSERT INTO entries VALUES(?,?,?,?,?,0,0,?)",
        newId,
        kind,
        "manual",
        newId,
        JSON.stringify(d),
        Date.now(),
      );
      return this.entry(newId);
    });
  }
  import(kind: EntryKind, source: string, text: string, commit = false) {
    const p = previewCSV(text, kind);
    const existing = new Map(
      this.entries(true)
        .filter((e) => e.kind === kind && e.source === source)
        .map((e) => [e.sourceId, e]),
    );
    const updates = p.accepted.filter(
      (r) => existing.has(r.sourceId) && !existing.get(r.sourceId)!.deleted,
    ).length;
    const archived = p.accepted
      .filter((r) => existing.get(r.sourceId)?.deleted)
      .map((r) => r.sourceId);
    if (commit)
      this.store.tx(() => {
        for (const row of p.accepted) {
          const old = existing.get(row.sourceId);
          if (old?.deleted) continue;
          if (old) {
            this.store.run(
              "UPDATE entries SET data=? WHERE id=?",
              JSON.stringify(row.data),
              old.id,
            );
            this.syncCards(old.id);
          } else
            this.store.run(
              "INSERT INTO entries VALUES(?,?,?,?,?,0,0,?)",
              randomUUID(),
              kind,
              source,
              row.sourceId,
              JSON.stringify(row.data),
              Date.now(),
            );
        }
      });
    return {
      ...p,
      updates,
      archived,
      newEntries: p.accepted.length - updates - archived.length,
    };
  }
  syncCards(id: string) {
    const e = this.entry(id);
    const directions: Direction[] =
      e.kind === "vocabulary"
        ? ["jp-en", "en-jp"]
        : [
            ...(e.data.onyomi.length ? ["on" as const] : []),
            ...(e.data.kunyomi.length ? ["kun" as const] : []),
            "meaning",
          ];
    this.store.run("UPDATE cards SET active=0 WHERE entry_id=?", id);
    if (!e.active || e.deleted) return;
    for (const d of directions) {
      this.store.run(
        "INSERT INTO cards(id,entry_id,deck,direction,active,created,memory) VALUES(?,?,?,?,1,?,?) ON CONFLICT(entry_id,direction) DO UPDATE SET active=1",
        randomUUID(),
        id,
        e.kind,
        d,
        Date.now(),
        JSON.stringify(freshMemory()),
      );
    }
  }
  activate(ids: string[], active: boolean) {
    return this.store.tx(() => {
      for (const id of ids) {
        const e = this.entry(id);
        if (e.deleted) throw new Error("Deleted entries cannot be activated");
        this.store.run(
          "UPDATE entries SET active=? WHERE id=?",
          Number(active),
          id,
        );
        this.syncCards(id);
      }
      return ids.length;
    });
  }
  remove(id: string) {
    return this.store.tx(() => {
      this.entry(id);
      this.store.run("UPDATE entries SET deleted=1,active=0 WHERE id=?", id);
      this.syncCards(id);
    });
  }
  search(kind: EntryKind, query = "", min = 0, max = Infinity, active = "all") {
    const q = query.toLowerCase().trim();
    const entries = this.entries();
    const vocab = entries.filter((e) => e.kind === "vocabulary");
    return entries
      .filter((e) => e.kind === kind)
      .map((e) => {
        const ranks = vocab
          .filter((v) => v.data.word.includes(e.data.word))
          .map((v) => v.data.rank ?? Infinity);
        const bestRank = ranks.length ? Math.min(...ranks) : Infinity;
        const derivedRank = Number.isFinite(bestRank) ? bestRank : null;
        return {
          ...e,
          displayRank: e.data.rank ?? derivedRank,
          derived:
            e.kind === "kanji" && e.data.rank === null && derivedRank !== null,
        };
      })
      .filter(
        (e) =>
          (active === "all" || e.active === (active === "active")) &&
          (e.displayRank ?? Infinity) >= min &&
          (e.displayRank ?? Infinity) <= max &&
          (!q ||
            [
              e.data.word,
              e.data.reading,
              romanize(e.data.reading),
              ...e.data.onyomi,
              ...e.data.kunyomi,
              ...e.data.onyomi.map(romanize),
              ...e.data.kunyomi.map(romanize),
              ...e.data.meanings,
              ...e.data.extended,
              String(e.displayRank ?? ""),
            ].some((s) => s.toLowerCase().includes(q))),
      )
      .sort(
        (a, b) =>
          (a.displayRank ?? Infinity) - (b.displayRank ?? Infinity) ||
          a.id.localeCompare(b.id),
      );
  }
  sourceKanji(entryIds?: string[], top?: number) {
    const all = this.entries(),
      kanji = all.filter((e) => e.kind === "kanji");
    let ids: string[] = [],
      missing: string[] = [];
    if (top !== undefined)
      ids = this.search("kanji")
        .filter((e) => !e.active)
        .slice(0, top)
        .map((e) => e.id);
    else {
      const words = all.filter(
        (e) =>
          e.kind === "vocabulary" &&
          (entryIds ? entryIds.includes(e.id) : e.active),
      );
      const chars = [
        ...new Set(
          words.flatMap((e) => e.data.word.match(/\p{Script=Han}/gu) ?? []),
        ),
      ];
      for (const c of chars) {
        const matches = kanji.filter((e) => e.data.word === c);
        if (matches.length) ids.push(...matches.map((e) => e.id));
        else missing.push(c);
      }
    }
    this.activate(ids, true);
    return { activated: ids.length, missing };
  }
}
