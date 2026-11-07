import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { FORMS } from "../core/conjugation.ts";
export const SCHEMA_VERSION = 1;
export const TABLES = [
  "entries",
  "forms",
  "cards",
  "sessions",
  "items",
  "attempts",
  "confusions",
  "settings",
] as const;
const immutable = `CREATE TRIGGER IF NOT EXISTS attempt_no_update BEFORE UPDATE ON attempts BEGIN SELECT RAISE(ABORT,'Review attempts are immutable'); END;
CREATE TRIGGER IF NOT EXISTS attempt_no_delete BEFORE DELETE ON attempts BEGIN SELECT RAISE(ABORT,'Review attempts are immutable'); END;`;
const schema = `
CREATE TABLE entries(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('vocabulary','kanji')),source TEXT NOT NULL,source_id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),created REAL NOT NULL,UNIQUE(kind,source,source_id));
CREATE TABLE forms(id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)));
CREATE TABLE cards(id TEXT PRIMARY KEY,entry_id TEXT REFERENCES entries(id),form_id TEXT REFERENCES forms(id),slot INTEGER,deck TEXT NOT NULL CHECK(deck IN ('vocabulary','kanji','conjugation')),direction TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN (0,1)),created REAL NOT NULL,memory TEXT NOT NULL CHECK(json_valid(memory)),
CHECK((deck='conjugation' AND entry_id IS NULL AND form_id IS NOT NULL AND slot BETWEEN 1 AND 50 AND direction IN ('forward','reverse')) OR (deck='vocabulary' AND entry_id IS NOT NULL AND form_id IS NULL AND slot IS NULL AND direction IN ('jp-en','en-jp')) OR (deck='kanji' AND entry_id IS NOT NULL AND form_id IS NULL AND slot IS NULL AND direction IN ('on','kun','meaning'))),UNIQUE(entry_id,direction),UNIQUE(form_id,slot,direction));
CREATE TABLE sessions(id TEXT PRIMARY KEY,mode TEXT NOT NULL,started REAL NOT NULL,ended REAL);
CREATE TABLE items(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id),ordinal INTEGER NOT NULL,card_id TEXT REFERENCES cards(id),question TEXT NOT NULL CHECK(json_valid(question)),presented REAL,revealed REAL,seconds REAL,UNIQUE(session_id,ordinal));
CREATE TABLE attempts(id TEXT PRIMARY KEY,item_id TEXT NOT NULL UNIQUE REFERENCES items(id),session_id TEXT NOT NULL REFERENCES sessions(id),card_id TEXT REFERENCES cards(id),entry_id TEXT NOT NULL REFERENCES entries(id),timestamp REAL NOT NULL,submission_key TEXT NOT NULL UNIQUE,data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE confusions(a TEXT NOT NULL REFERENCES entries(id),b TEXT NOT NULL REFERENCES entries(id),score REAL NOT NULL,last_seen REAL NOT NULL,PRIMARY KEY(a,b),CHECK(a!=b));
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL CHECK(json_valid(value)));
CREATE INDEX cards_active ON cards(active,deck);
CREATE INDEX attempts_card_time ON attempts(card_id,timestamp);
CREATE INDEX attempts_session ON attempts(session_id);
CREATE INDEX items_session ON items(session_id,ordinal);
CREATE TRIGGER item_snapshot_frozen BEFORE UPDATE OF question,card_id,session_id,ordinal ON items BEGIN SELECT RAISE(ABORT,'Session question snapshots are immutable'); END;
${immutable}`;
export class Store {
  db: DatabaseSync;
  path: string;
  constructor(path: string) {
    this.path = path;
    const existed = path !== ":memory:" && existsSync(path);
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
      const v = (
        this.db.prepare("PRAGMA user_version").get() as { user_version: number }
      ).user_version;
      if (v > SCHEMA_VERSION)
        throw new Error(
          "Database was created by a newer application; refusing to downgrade",
        );
      if (v < SCHEMA_VERSION) {
        if (existed) this.backup("pre-migration");
        this.tx(() => {
          this.db.exec(schema);
          this.db.exec("PRAGMA user_version=1");
          for (const f of FORMS)
            this.db.prepare("INSERT INTO forms(id) VALUES(?)").run(f.id);
        });
      }
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  backup(label: string) {
    if (this.path === ":memory:") return null;
    const p = join(dirname(this.path), "backups");
    mkdirSync(p, { recursive: true });
    const dest = join(
      p,
      `${label}-${Date.now()}-${randomUUID().slice(0, 8)}.sqlite`,
    );
    this.db.prepare("VACUUM INTO ?").run(dest);
    return dest;
  }
  all(sql: string, ...args: any[]): any[] {
    return this.db.prepare(sql).all(...args);
  }
  get(sql: string, ...args: any[]): any {
    return this.db.prepare(sql).get(...args);
  }
  run(sql: string, ...args: any[]) {
    return this.db.prepare(sql).run(...args);
  }
  export() {
    return {
      format: "kotoba-backup",
      version: 1,
      schemaVersion: SCHEMA_VERSION,
      tables: Object.fromEntries(
        TABLES.map((t) => [
          t,
          this.all(
            `SELECT * FROM ${t} ORDER BY ${t === "confusions" ? "a,b" : t === "settings" ? "key" : "id"}`,
          ).map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([key, value]) => [
                key,
                ["data", "memory", "question", "value"].includes(key)
                  ? JSON.parse(value as string)
                  : value,
              ]),
            ),
          ),
        ]),
      ),
    };
  }
  replaceTables(tables: Record<string, any[]>) {
    this.tx(() => {
      this.db.exec(
        "DROP TRIGGER attempt_no_delete; DROP TRIGGER attempt_no_update;",
      );
      for (const t of [...TABLES].reverse()) this.db.exec(`DELETE FROM ${t}`);
      for (const t of TABLES) {
        const columns = this.all(`PRAGMA table_info(${t})`).map((c) => c.name);
        const insert = this.db.prepare(
          `INSERT INTO ${t}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        );
        for (const row of tables[t]) insert.run(...columns.map((c) => row[c]));
      }
      const fk = this.all("PRAGMA foreign_key_check");
      if (fk.length) throw new Error("Backup contains broken references");
      this.db.exec(immutable);
    });
  }
  close() {
    this.db.close();
  }
}
