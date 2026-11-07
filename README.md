# Kotoba — local Japanese study

A desktop-first React/TypeScript study application with a local Node server and SQLite. Your library and study history live on your computer. There is no account, cloud database, or required remote service.

## Run

Requires Node.js **24 or newer** and npm. Development and verification here used Node 26.8.2.

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3210**. Keep that terminal running while you study; press Ctrl+C to stop. Once dependencies are installed and the application is built, these study workflows work without an internet connection. `npm start` uses the compiled local assets, with no CDN fonts or runtime network dependency. The browser still connects to the local server.

For development:

```sh
npm run dev
```

This also serves port 3210, with Vite middleware for source changes. To select another port or database:

```sh
PORT=3215 KOTOBA_DB=./data/another-workspace.sqlite npm start
```

The default database is `data/kotoba.sqlite`, relative to this project directory. Do not delete `data/` to update the app. The app refuses to open a database from a newer schema version.

## First session

1. Open Library → Vocabulary → Import CSV. Download the template or select your own UTF-8 file.
2. Choose a stable source name. Preview the row report, then commit the import. Reuse that source name and source row IDs for future updates.
3. Select entries and activate them. Importing does **not** automatically activate cards.
4. Open Study. Select a prefix of the urgency graph, adjust the count, and start reviewing. Answer Japanese prompts in English and Japanese-reading questions in romaji. Every graded attempt updates that card's one scheduling state.
5. For kanji, import the separate kanji CSV. Activate individual entries, use the vocabulary extraction controls, or add the top N eligible entries. Missing kanji are reported, never invented.
6. For conjugation, activate verbs with class metadata in your vocabulary deck, enable desired forms in Conjugation, then choose Practice enabled forms. All 64 forms start disabled.

`samples/` contains small, explicitly illustrative CSV files for trying the workflows. They are not a full dictionary or a verified frequency corpus. Nothing is preloaded into your real study database.

## Imports and answers

Vocabulary columns: `id,word,form,freq,pos,translation,extended,notes`.

Kanji columns: `id,kanji,onyomi,kunyomi,meaning,extended meaning,notes`, with optional `freq` or `rank`. Reading-header aliases such as `on’yomi` and `kun_yomi` are accepted. Readings may be separated with semicolons, commas, or Japanese commas. Blank readings or `-` do not create impossible cards. Dotted kun readings such as `た.べる` are matched as the full supplied pronunciation, `taberu`.

English alternatives are separated by semicolons. Case, whitespace, and punctuation are normalized; no guessed synonyms are introduced. Common Hepburn/Kunrei romaji variants are handled by WanaKana plus explicit normalization. Long vowels remain meaningful.

Use `v1-t` / `v1-i` for ichidan, `v5-t` / `v5-i` for godan, and `v-irr-t` / `v-irr-i` for supported irregular verbs. JMdict-style `vs` and `vk` labels are recognized. Unknown verb classes remain valid vocabulary but are excluded from conjugation. Do not infer class from a る ending.

A row whose notes contain `!!!` is skipped. Existing entries omitted by an import, excluded with `!!!`, or explicitly deleted previously retain their history. A reimport will not silently undelete an entry. Deleting an entry is a confirmed soft deletion: its cards are paused and its past attempts remain available.

## Backups and recovery

Settings → Export all data downloads a versioned JSON file containing entries, forms, cards, sessions, frozen questions, attempts, confusion evidence, and preferences. Structured fields are exported as nested JSON objects, not database-specific binary data.

Settings → Restore validates the complete backup in an isolated SQLite database before changing your real data. It checks schemas, foreign keys, source/card uniqueness, counts, snapshot references, scheduling history chains, and activation consistency. Restoration is atomic and requires a UI confirmation because it replaces the current workspace.

Before restoration or a schema upgrade, a consistent SQLite recovery copy is saved under `data/backups/`. For manual recovery from one of those copies, stop the server, preserve the current `data/` directory, and launch against the recovery copy using `KOTOBA_DB=/absolute/path/to/recovery.sqlite npm start`. Export JSON from that recovered workspace if you want to restore it through the normal UI. Avoid copying an open database without its WAL state; the application's own backup operation handles this correctly.

## Verification

```sh
npm run build
npm test
```

The test suite includes pure logic, SQLite/service tests, and HTTP tests that launch a real production server on a temporary port, import and activate entries, review, restart, and restore backups. Test databases are isolated in temporary directories. Build before testing so the HTTP suite can check the current compiled client assets.

See [implementation status](docs/IMPLEMENTATION_STATUS.md) for acceptance coverage and the remaining limitations. The main browser workflows, keyboard navigation, and selected desktop/narrow layouts were checked with an isolated test database. Audible Japanese speech playback still needs a human listening check on the target computer.

## Code map

- `src/core/`: shared models and pure scheduling, matching, conjugation, CSV parsing, selection, confusion scoring, and statistics.
- `src/server/`: migrations/storage, transactional library and study services, backup validation, and the same-origin HTTP API.
- `src/ui/`: React screens and local CSS. The UI cannot decide a typed answer's grade or write scheduling state directly.
- `tests/`: Appendix B cases, complete Appendix A reference forms, and persistence/integrity regressions.
- `docs/ARCHITECTURE.md`: invariants, scheduling formulas, session lifecycle, and extension points.

The server binds to loopback only and rejects foreign Host/Origin values for mutation requests. It is a single-user local application; it has no authentication or multi-user authorization layer and is not configured for public hosting.
