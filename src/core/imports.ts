import { parse } from "csv-parse/sync";
import { EntryData, type EntryKind } from "./models.ts";
import { splitAnswers, kana } from "./answers.ts";
export interface ImportRow {
  sourceId: string;
  data: EntryData;
}
export interface ImportPreview {
  accepted: ImportRow[];
  skipped: { row: number; id: string; reason: string }[];
  duplicates: { row: number; id: string }[];
  invalid: { row: number; reason: string }[];
  total: number;
}
export const templates = {
  vocabulary:
    "id,word,form,freq,pos,translation,extended,notes\n190,食べる,たべる,194,v1-t,to eat,to consume,\n",
  kanji:
    "id,kanji,onyomi,kunyomi,meaning,extended meaning,notes,freq\n1,食,ショク,た.べる,eat,food,,\n",
};
export const readingList = (s: string) =>
  s
    .split(/[;；|、,，\n]/)
    .map((x) => x.trim())
    .filter((x) => x && !/^(?:-|—|n\/a|none)$/i.test(x));
export function previewCSV(text: string, kind: EntryKind): ImportPreview {
  if (text.includes("\ufffd"))
    throw new Error("Invalid UTF-8: save your file with UTF-8 encoding");
  const rows: string[][] = parse(text, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });
  const header = (rows.shift() ?? []).map((s) =>
    s
      .trim()
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/^on[ ’'-]*yomi$/, "onyomi")
      .replace(/^kun[ ’'-]*yomi$/, "kunyomi"),
  );
  if (new Set(header).size !== header.length)
    throw new Error("Duplicate CSV column names");
  const required =
    kind === "vocabulary"
      ? [
          "id",
          "word",
          "form",
          "freq",
          "pos",
          "translation",
          "extended",
          "notes",
        ]
      : [
          "id",
          "kanji",
          "onyomi",
          "kunyomi",
          "meaning",
          "extended meaning",
          "notes",
        ];
  const missing = required.filter((x) => !header.includes(x));
  if (missing.length)
    throw new Error("Missing CSV columns: " + missing.join(", "));
  const result: ImportPreview = {
    accepted: [],
    skipped: [],
    duplicates: [],
    invalid: [],
    total: rows.length,
  };
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const n = i + 2;
    const r = Object.fromEntries(
      header.map((h, j) => [h, (row[j] ?? "").trim()]),
    );
    if (row.length !== header.length) {
      result.invalid.push({
        row: n,
        reason: "Column count does not match header",
      });
      return;
    }
    if (r.notes.includes("!!!")) {
      result.skipped.push({
        row: n,
        id: r.id,
        reason: "Excluded by !!!; existing entries and history are retained",
      });
      return;
    }
    if (seen.has(r.id)) {
      result.duplicates.push({ row: n, id: r.id });
      return;
    }
    if (r.id) seen.add(r.id);
    try {
      if (!r.id) throw new Error("Missing source ID");
      const freq = r.freq ?? r.rank ?? "";
      if (kind === "vocabulary" && !freq)
        throw new Error("Missing frequency rank");
      if (
        kind === "vocabulary" &&
        (!r.form ||
          !/^[\p{Script=Hiragana}\p{Script=Katakana}ー\s・]+$/u.test(
            kana(r.form),
          ))
      )
        throw new Error("A kana reading is required");
      const data = EntryData.parse({
        word: kind === "vocabulary" ? r.word : r.kanji,
        reading: r.form ?? "",
        rank: freq ? Number(freq) : null,
        pos: r.pos ?? "",
        meanings: splitAnswers(
          kind === "vocabulary" ? r.translation : r.meaning,
        ),
        extended: splitAnswers(r.extended ?? r["extended meaning"] ?? ""),
        notes: r.notes,
        onyomi: readingList(r.onyomi ?? ""),
        kunyomi: readingList(r.kunyomi ?? ""),
      });
      if (kind === "kanji" && !/^\p{Script=Han}$/u.test(data.word))
        throw new Error("Kanji must contain one Han character");
      for (const reading of [...data.onyomi, ...data.kunyomi])
        if (!/^[\p{Script=Hiragana}ー]+$/u.test(kana(reading)))
          throw new Error("Kanji readings must be kana");
      result.accepted.push({ sourceId: r.id, data });
    } catch (e) {
      result.invalid.push({
        row: n,
        reason: e instanceof Error ? e.message : "Invalid row",
      });
    }
  });
  return result;
}
