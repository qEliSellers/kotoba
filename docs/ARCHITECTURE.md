# Architecture and invariants

## Source of truth

The supplied Japanese Website Plan (revision 1.0), all 14 embedded screenshots, Appendices A–C, and the two later agreed adjustments were read before implementation. `specification.txt` retains extracted document text for implementation reference; the original DOCX remains the authoritative formatted source.

The adjustments are implemented explicitly: kanji-reading questions have no prompt-side speech or reading hints; early reviews retain actual streaks/counts but earn fractional scheduling maturity and urgency-weighted positive memory growth.

## Boundaries

The React UI calls a local same-origin JSON API. The API validates request shapes and delegates to services. `Library` manages source namespaces and activation; `Study` creates frozen sessions, presents questions, grades responses, and records attempts. Pure domain modules have no database or browser dependencies. SQLite is accessed only through the server, with foreign keys enabled, WAL journaling, synchronous FULL durability, and explicit transactions.

The current schema is version 1, recorded with SQLite `user_version`. An existing database receives a consistent `VACUUM INTO` backup before an upgrade. Migrations run atomically; newer unknown versions are rejected instead of downgraded. The version-0-to-1 migration is tested. Future schema changes must add ordered migrations and corresponding migration/restore tests, preserving existing identifiers and snapshots.

## Records

| Table        | Identity and purpose                                                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entries`    | UUID primary key; unique `(kind, source, source_id)`. Validated structured vocabulary/kanji data, active and deleted flags. Source IDs, not display spelling or rank, govern reimports. |
| `forms`      | Stable catalog ID and enabled flag; all 64 start disabled.                                                                                                                              |
| `cards`      | UUID; exactly one owner: a library entry or a `(form_id, slot)` skill. Unique `(entry_id, direction)` or `(form_id, slot, direction)`. Owns one validated memory state.                 |
| `sessions`   | UUID, entry-point mode, start/end timestamps.                                                                                                                                           |
| `items`      | UUID; unique `(session_id, ordinal)`, card reference and frozen question/answer/entry/verb data. Persistent presentation/reveal timing.                                                 |
| `attempts`   | UUID; unique item ID and submission key, indexed card/session/time references, immutable result and before/after calculation snapshots.                                                 |
| `confusions` | Directed pair of existing entry IDs, confidence-weighted repeat score and latest evidence time.                                                                                         |
| `settings`   | Validated user preference values.                                                                                                                                                       |

Structured domain fields are stored as checked JSON in SQLite; ownership and indexing fields remain relational. Portable backups expose those fields as nested objects. This avoids changing SQL columns for every added display field while retaining constraints on relationships and identity.

Deleting an entry never deletes a card or an attempt. Removing a kanji reading pauses the corresponding card; supplying it again reuses that card. Disabling a conjugation form pauses its cards. Library details may change, but previously frozen questions and attempt snapshots are never rebuilt from edited entries.

`attempts` has database triggers rejecting updates and deletes. Only an explicitly confirmed complete restore temporarily removes those triggers inside the replacement transaction; they are reinstated before commit. A restore is validated in a disposable database and backed up before it touches the live tables.

## Review transaction

1. Create a session with explicit card IDs, or generate a classification/confusable session. Normal quiz selections cannot contain duplicate card IDs.
2. Freeze all question data, expected answers, input type, and conjugation examples before presentation. Public unanswered questions omit expected answers, entry notes/POS, answer audio, and distractor comparison details.
3. Mark an item presented on the server. Earlier unanswered items block presenting later ones. A typed submission stops the timer; reverse self-graded conjugation freezes the timer at reveal.
4. Within `BEGIN IMMEDIATE`, return any existing attempt for the item. Reject a submission key reused for a different item.
5. Grade the frozen expected answers. The client may explicitly Pass; only reverse conjugation accepts client self-grading. Read the card's latest state inside the transaction, including updates from another session.
6. Compute the pure scheduling result. Save the state, immutable attempt, confusion evidence, and session completion atomically. Failure at any point rolls everything back.

Repeated requests therefore cannot double-grade. Independent tabs/sessions cannot overwrite each other's history. A session's example remains valid even if the vocabulary entry is later edited or deactivated. Resuming uses the stored session, not freshly sampled verbs.

Timing currently measures wall time from first presentation to submission/reveal. Time spent leaving an unanswered question open, or closing/reopening that session, is included. Idle/pause-aware timing remains a documented improvement.

## Scheduler

`src/core/scheduler.ts` contains the versioned experimental configuration. This is an explicit FSRS-inspired heuristic, not an implementation of the published trained FSRS algorithm, not a reverse-engineered Benkyō formula, and not empirically calibrated from this learner's data.

- New cards have urgency 100. Otherwise `U = clamp(100 * elapsed / interval, 0, 200)`. The interval is measured from the latest graded review. The queue sorts by capped urgency, then composite strength, then stable UUID. Time beyond the cap never breaks ties.
- A success increments the real streak and raw lifetime counts. A failure or Pass resets the streak; both have identical scheduling behavior and distinct stored outcomes.
- For `U < 100`, `w = (U/100)^2`; otherwise `w = 1`. Earned consecutive maturity increases by `w * speedFactor` per success, capped at one unit per attempt; failures reset it to zero. It is never replaced by the raw streak. At urgency 20 and ordinary speed, one correct review earns 0.04 maturity. Immediate repeats at urgency zero earn none, however high their raw streak becomes.
- Positive difficulty/stability improvements are weighted by urgency and speed. The memory estimate uses elapsed time, estimated retrievability, and difficulty. Failed reviews retain a configurable fraction of prior stability, allowing previous experience to influence rebuilding.
- Baseline days are `2 + 0.5 * max(0, maturity - 1)^1.633`, capped at 365 days. At normal timing/speed with consecutive successes, the first two intervals are 2 and 2.5 days; the eighth is approximately 14 days.
- Strength is `0.35 * earned-streak-score + 0.35 * Bayesian-accuracy + 0.30 * stability-score`. The reference strength at the same earned maturity centers a bounded 0.75–1.25 multiplier. Raw lifetime accuracy uses a Beta(1,1) prior, so 1/1 is less established than 50/50.
- Lateness multiplies the candidate by at most 2. Speed has no penalty through 10s, interpolating through `(12,.8), (15,.5), (20,.2), (25,.05)`. It limits earned interval growth as well as maturity and memory growth. Slow correct responses remain correct in all actual counts.
- Due failures get a one-day relearning interval. Early failures still reset streak/maturity but use the same urgency-weighted due-date blending.
- Blend **absolute due timestamps**, `new_due = old_due + w * (candidate_due - old_due)`, then re-anchor `interval = (new_due - review_time)/day`. Thus displayed urgency reaches 100 exactly at the new due date, including after an early review.

Each attempt saves the configuration version and constants, capped urgency, weight, speed multiplier, memory/difficulty factors, strength components/reference, candidate, and due-date calculation. You can inspect the record under Card history → Calculation. Changing future constants does not rewrite old attempts.

## Conjugation

All 64 Appendix A forms have stable IDs and deterministic rules. Enabling a form creates 50 slots × 2 independently scheduled directions. The available queue only contains slots that can currently receive an eligible distinct active verb. Empty slots retain their history but are not presented.

Assignments use frequency-weighted sampling without replacement, with weight proportional to `1/sqrt(rank)`. Identical surface/reading/class examples from duplicate imports do not occupy multiple slots. This does not merge their library identities. Slots 3 and 4 reserve eligible bare する and 来る. The two directions of one slot share its example within a session; separate forms may reuse a verb. Reservation holes do not cause artificial padding.

The engine distinguishes kana output from written output. It handles godan endings, ichidan, standard する and compounds, 来る, 行く, ある negation, 問う/乞う connective exceptions, and the common honorific masu-stem exception. Causative-passive contractions apply to suitable godan endings other than す. Polite desire alternatives are explicit; ないで and なくて are never treated as equivalent.

Eligibility rejects unknown classes and unsupported irregular classes, excludes selected stative/inherent-ability verbs from unsuitable groups, and supports per-entry excluded form/group IDs. It is intentionally conservative and is not an exhaustive semantic lexicon. Expanding lexical exceptions requires curated expected-output fixtures, not generated guesses.

## Confusions and statistics

Wrong typed vocabulary answers are matched only against other active vocabulary readings/imported meanings. Repeated evidence decays over 30 days. Ambiguous one-word English matches have reduced confidence. Optional contrast sets prioritize evidence, then identical/similar kana (including voiced/unvoiced families), then overlapping imported senses, favoring reviewed entries. Options matching the primary prompt's meaning are excluded. Each contrast uses 3–4 distinct active options and stores comparison details for reveal.

Choice reviews update the original EN→JP card; their input type is recorded separately. Classification has exactly three choices and saves a drill attempt with no invented SRS card.

Statistics derive from persisted attempts and card state: actual counts, accuracy, timed recall, local-calendar study streak, per-deck data, daily evolution, earned-maturity categories, rankings, complete sessions, and per-card speed/date points with raw rows. Backup restoration validates all stored scheduling chains and counts. Rankings/current mastery describe the current card state; the date filter limits attempt-based metrics, not historical reconstruction of every card's past state.

## Extension points and constraints

Keep schema migrations, pure scheduling version changes, new catalog forms, and answer-normalization changes independently testable. Snapshot changes should remain backward compatible with existing backup formats or add explicit version migrations. Optional lists and more advanced time-series/performance work can build on the existing stable IDs.

This is a local, single-user service. There are no remote credentials, accounts, cloud sync, external dictionaries, AI-generated answers, kana decks, sentence mining, handwriting, pitch accent, or speech-recognition scoring.

Implementation references: [Node SQLite API](https://nodejs.org/api/sqlite.html) and [WanaKana API](https://wanakana.com/). The supplied specification and its curated examples govern the application behavior.
