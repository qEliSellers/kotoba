import React, { useEffect, useState } from "react";
import type { Entry, EntryKind, Card } from "../core/models.ts";
import { api, days } from "./api.ts";
import { splitAnswers } from "../core/answers.ts";
import { Modal } from "./Modal.tsx";
export function LibraryView({
  onError,
  onHistory,
  onLaunch,
}: {
  onLaunch: (id: string) => void;
  onError: (e: unknown) => void;
  onHistory: (id: string) => void;
}) {
  const [kind, setKind] = useState<EntryKind>("vocabulary"),
    [entries, setEntries] = useState<any[]>([]),
    [q, setQ] = useState(""),
    [active, setActive] = useState("all"),
    [min, setMin] = useState(""),
    [max, setMax] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [edit, setEdit] = useState<Entry | "new" | null>(null),
    [importing, setImporting] = useState(false),
    [detail, setDetail] = useState<Entry | null>(null),
    [cards, setCards] = useState<Card[]>([]),
    [notice, setNotice] = useState("");
  const load = () =>
    api("/entries?" + new URLSearchParams({ kind, q, active, min, max }))
      .then(setEntries)
      .catch(onError);
  useEffect(() => {
    let valid = true;
    api("/entries?" + new URLSearchParams({ kind, q, active, min, max }))
      .then((x) => {
        if (valid) setEntries(x);
      })
      .catch(onError);
    return () => {
      valid = false;
    };
  }, [kind, q, active, min, max]);
  async function activate(ids: string[], value: boolean) {
    try {
      await api("/activation", { ids, active: value });
      await load();
      setSelected([]);
      setNotice(`${ids.length} entries ${value ? "activated" : "paused"}.`);
    } catch (e) {
      onError(e);
    }
  }
  async function show(e: Entry) {
    setDetail(e);
    setCards([]);
    try {
      setCards((await api<Card[]>("/cards")).filter((c) => c.entryId === e.id));
    } catch (error) {
      onError(error);
    }
  }
  async function kanji(entryIds?: string[], top?: number) {
    try {
      const r = await api("/kanji/source", { entryIds, top });
      setNotice(
        `Activated ${r.activated} kanji entries.${r.missing.length ? " Missing from the kanji library: " + r.missing.join("、") : " No missing kanji."}`,
      );
      load();
    } catch (e) {
      onError(e);
    }
  }
  return (
    <section>
      <div className="page-heading">
        <div>
          <div className="eyebrow">BUILD YOUR COLLECTION</div>
          <h1>Library</h1>
          <p>Collect words, then choose what you want to learn.</p>
        </div>
        <div className="actions">
          <button onClick={() => setImporting(true)}>↑ Import CSV</button>
          <button className="primary" onClick={() => setEdit("new")}>
            ＋ Add entry
          </button>
        </div>
      </div>
      <div className="tabs">
        {(["vocabulary", "kanji"] as const).map((k) => (
          <button
            className={kind === k ? "selected" : ""}
            key={k}
            onClick={() => {
              setKind(k);
              setSelected([]);
            }}
          >
            {k === "vocabulary" ? "Vocabulary" : "Kanji"}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <input
          aria-label="Search library"
          className="search"
          placeholder="Search Japanese, romaji, meaning, or rank…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          aria-label="Active filter"
          value={active}
          onChange={(e) => setActive(e.target.value)}
        >
          <option value="all">All entries</option>
          <option value="active">Active deck</option>
          <option value="inactive">Library only</option>
        </select>
        <input
          className="small-input"
          aria-label="Minimum rank"
          placeholder="Rank from"
          type="number"
          value={min}
          onChange={(e) => setMin(e.target.value)}
        />
        <input
          className="small-input"
          aria-label="Maximum rank"
          placeholder="Rank to"
          type="number"
          value={max}
          onChange={(e) => setMax(e.target.value)}
        />
      </div>
      {notice && <div className="notice">{notice}</div>}
      <div className="table-actions">
        <span>
          {entries.length.toLocaleString()} entries · {selected.length} selected
        </span>
        <div className="actions">
          <button
            disabled={!entries.length}
            onClick={() => setSelected(entries.map((e) => e.id))}
          >
            Select all filtered
          </button>
          <button
            disabled={!selected.length}
            onClick={() => activate(selected, true)}
          >
            Activate selected
          </button>
          <button
            disabled={!selected.length}
            onClick={() => activate(selected, false)}
          >
            Pause selected
          </button>
          <button
            disabled={!selected.length}
            onClick={async () => {
              try {
                const cards = await api<Card[]>("/cards");
                const s = await api("/sessions", {
                  mode: "custom",
                  cardIds: cards
                    .filter(
                      (c) =>
                        c.active && c.entryId && selected.includes(c.entryId),
                    )
                    .map((c) => c.id),
                });
                onLaunch(s.id);
              } catch (e) {
                onError(e);
              }
            }}
          >
            Study selected
          </button>
          {kind === "kanji" && (
            <>
              <button onClick={() => kanji()}>From active vocabulary</button>
              <button
                onClick={() => {
                  const n = prompt("How many not-yet-active kanji?", "20");
                  if (n && Number(n) > 0)
                    kanji(undefined, Math.floor(Number(n)));
                }}
              >
                Add top N
              </button>
            </>
          )}
        </div>
      </div>
      {entries.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select displayed entries"
                    checked={
                      entries.length > 0 &&
                      entries.every((e) => selected.includes(e.id))
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? entries.map((x) => x.id) : [],
                      )
                    }
                  />
                </th>
                <th>
                  {kind === "vocabulary"
                    ? "WORD / READING"
                    : "KANJI / READINGS"}
                </th>
                <th>MEANING</th>
                <th>FREQUENCY</th>
                <th>DECK</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 1000).map((e) => (
                <tr key={e.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={"Select " + e.data.word}
                      checked={selected.includes(e.id)}
                      onChange={(ev) =>
                        setSelected((s) =>
                          ev.target.checked
                            ? [...s, e.id]
                            : s.filter((x) => x !== e.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <button className="word-link" onClick={() => show(e)}>
                      {e.data.word}
                    </button>
                    <small>
                      {e.data.reading ||
                        [...e.data.onyomi, ...e.data.kunyomi].join(" · ")}
                    </small>
                  </td>
                  <td>
                    {e.data.meanings.join("; ")}
                    <small>{e.data.extended.join("; ")}</small>
                  </td>
                  <td>
                    {e.displayRank ? "#" + e.displayRank : "—"}
                    {e.derived && <small>Derived from vocabulary</small>}
                  </td>
                  <td>
                    <button
                      className={e.active ? "pill green" : "pill"}
                      onClick={() => activate([e.id], !e.active)}
                    >
                      {e.active ? "Active" : "Activate"}
                    </button>
                  </td>
                  <td>
                    <button className="text-button" onClick={() => setEdit(e)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length > 1000 && (
            <p className="muted">
              Showing the first 1,000 results. Narrow the search to browse more.
              Bulk selection includes all filtered results.
            </p>
          )}
        </div>
      ) : (
        <div className="empty">
          <span className="empty-kanji">語</span>
          <h2>A place for your words</h2>
          <p>
            Import your dictionary or add an entry to begin.
            <br />
            Library entries become flashcards only when you activate them.
          </p>
          <button className="primary" onClick={() => setImporting(true)}>
            Import your first CSV
          </button>
          <a href={"/api/templates?kind=" + kind}>Download a CSV template</a>
        </div>
      )}
      {importing && (
        <ImportDialog
          kind={kind}
          onClose={() => setImporting(false)}
          onDone={() => {
            load();
            setImporting(false);
          }}
          onError={onError}
        />
      )}
      {edit && (
        <EntryEditor
          kind={kind}
          entry={edit === "new" ? undefined : edit}
          onClose={() => setEdit(null)}
          onDone={() => {
            load();
            setEdit(null);
          }}
          onError={onError}
        />
      )}
      {detail && (
        <Modal
          title={`${detail.data.word} details`}
          onClose={() => setDetail(null)}
        >
          <div className="eyebrow">ENTRY DETAILS</div>
          <h1 lang="ja">{detail.data.word}</h1>
          <p>{detail.data.reading}</p>
          <h2>{detail.data.meanings.join("; ")}</h2>
          <p>{detail.data.extended.join("; ")}</p>
          <p>{detail.data.notes || "No notes."}</p>
          <div className="muted">
            Source: {detail.source} / {detail.sourceId} · {detail.data.pos}
          </div>
          <h3>Independent flashcards</h3>
          {cards.length ? (
            cards.map((c) => (
              <button
                key={c.id}
                className="card-row"
                onClick={() => onHistory(c.id)}
              >
                <b>{c.direction}</b>
                <span>
                  {c.active ? "Active" : "Paused"} · {c.memory.total} attempts ·{" "}
                  {days(c.memory.interval)}
                </span>
                <span>History →</span>
              </button>
            ))
          ) : (
            <p>Activate this entry to create its flashcards.</p>
          )}
          {detail.kind === "kanji" && (
            <p className="muted">
              {!detail.data.onyomi.length &&
                "On’yomi excluded: no supplied readings. "}
              {!detail.data.kunyomi.length &&
                "Kun’yomi excluded: no supplied readings."}
            </p>
          )}
          {detail.kind === "vocabulary" && (
            <button onClick={() => kanji([detail.id])}>
              Activate kanji in this word
            </button>
          )}
        </Modal>
      )}
    </section>
  );
}
function EntryEditor({ kind, entry, onClose, onDone }: any) {
  const d = entry?.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [onyomi, setOnyomi] = useState(d?.onyomi.join("; ") ?? "");
  const [kunyomi, setKunyomi] = useState(d?.kunyomi.join("; ") ?? "");
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    setError("");
    setBusy(true);
    try {
      await api("/entries", {
        id: entry?.id,
        kind,
        data: {
          word: f.word,
          reading: f.reading || "",
          rank: f.rank ? Number(f.rank) : null,
          pos: f.pos || "",
          meanings: splitAnswers(String(f.meanings)),
          extended: splitAnswers(String(f.extended)),
          notes: f.notes,
          onyomi: splitAnswers(String(f.onyomi || "")),
          kunyomi: splitAnswers(String(f.kunyomi || "")),
          excludedForms: splitAnswers(String(f.excludedForms || "")),
        },
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${entry ? "Edit" : "Add"} ${kind}`} onClose={onClose}>
      <h2>
        {entry ? "Edit" : "Add"}{" "}
        {kind === "vocabulary" ? "vocabulary" : "kanji"}
      </h2>
      {error && (
        <div className="modal-error" role="alert">
          {error}
          <button type="button" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}
      <form onSubmit={save}>
        <div className="form-grid">
          <label>
            {kind === "vocabulary" ? "Word" : "Kanji"}
            <input name="word" required defaultValue={d?.word} />
          </label>
          {kind === "vocabulary" ? (
            <>
              <label>
                Kana reading
                <input name="reading" required defaultValue={d?.reading} />
              </label>
              <label>
                Frequency rank
                <input
                  name="rank"
                  type="number"
                  min="1"
                  required
                  defaultValue={d?.rank}
                />
              </label>
              <label>
                Part of speech
                <input
                  name="pos"
                  placeholder="v1-t, v5-i, v-irr-i…"
                  defaultValue={d?.pos}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                On’yomi (semicolon separated)
                <input
                  name="onyomi"
                  value={onyomi}
                  onChange={(e) => setOnyomi(e.target.value)}
                />
                {!splitAnswers(onyomi).length && (
                  <small>
                    No on’yomi card will be created without a reading.
                  </small>
                )}
              </label>
              <label>
                Kun’yomi (semicolon separated)
                <input
                  name="kunyomi"
                  value={kunyomi}
                  onChange={(e) => setKunyomi(e.target.value)}
                />
                {!splitAnswers(kunyomi).length && (
                  <small>
                    No kun’yomi card will be created without a reading.
                  </small>
                )}
              </label>
              <label>
                Frequency rank (optional)
                <input
                  name="rank"
                  type="number"
                  min="1"
                  defaultValue={d?.rank}
                />
              </label>
            </>
          )}
        </div>
        <label>
          Primary meaning(s)
          <input
            name="meanings"
            required
            defaultValue={d?.meanings.join("; ")}
          />
        </label>
        <label>
          Other accepted meanings (semicolon separated)
          <input name="extended" defaultValue={d?.extended.join("; ")} />
        </label>
        <label>
          Notes
          <textarea name="notes" defaultValue={d?.notes} />
        </label>
        {kind === "vocabulary" && (
          <label>
            Excluded conjugation groups or form IDs (optional)
            <input
              name="excludedForms"
              placeholder="Potential; command-2"
              defaultValue={d?.excludedForms.join("; ")}
            />
          </label>
        )}
        <div className="actions">
          <button className="primary" disabled={busy}>
            Save entry
          </button>
          {entry && (
            <button
              type="button"
              className="danger"
              onClick={async () => {
                if (
                  confirm(
                    "Delete this library entry? Its cards will be paused and all past review records retained.",
                  )
                )
                  try {
                    await api("/entries/delete", {
                      id: entry.id,
                      confirm: true,
                    });
                    onDone();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
              }}
            >
              Delete entry
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
function ImportDialog({ kind, onClose, onDone }: any) {
  const [source, setSource] = useState("my-dictionary"),
    [text, setText] = useState(""),
    [preview, setPreview] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(commit: boolean) {
    setError("");
    setBusy(true);
    try {
      const r = await api("/import", { kind, source, text, commit });
      if (commit) onDone();
      else setPreview(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Import ${kind}`} onClose={onClose} wide>
      <div className="eyebrow">BRING YOUR OWN DICTIONARY</div>
      <h2>Import {kind}</h2>
      {error && (
        <div className="modal-error" role="alert">
          {error}
          <button type="button" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}
      <p>
        Rows stay in the library until you activate them. Reuse the same source
        name and row IDs to update existing entries.
      </p>
      <label>
        Source name
        <input
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setPreview(null);
          }}
        />
      </label>
      <label>
        UTF-8 CSV file
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f)
              try {
                setText(
                  new TextDecoder("utf-8", { fatal: true }).decode(
                    await f.arrayBuffer(),
                  ),
                );
                setPreview(null);
              } catch {
                setError("The file is not valid UTF-8");
              }
          }}
        />
      </label>
      <label>
        Or paste CSV
        <textarea
          aria-label="CSV contents"
          rows={7}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
        />
      </label>
      <div className="actions">
        <a href={"/api/templates?kind=" + kind}>Download template</a>
        <button disabled={!text || !source || busy} onClick={() => run(false)}>
          Preview import
        </button>
      </div>
      {preview && (
        <>
          <div className="metrics compact">
            {[
              ["Accepted", preview.accepted.length],
              ["New", preview.newEntries],
              ["Updates", preview.updates],
              ["Skipped !!!", preview.skipped.length],
              ["Duplicates", preview.duplicates.length],
              ["Invalid", preview.invalid.length],
            ].map(([s, n]) => (
              <div key={s}>
                <strong>{n}</strong>
                <span>{s}</span>
              </div>
            ))}
          </div>
          <p>
            {preview.archived.length} deleted source IDs will remain archived.
            Skipped or omitted entries keep their existing data and history.
          </p>
          <details>
            <summary>View row report</summary>
            <pre>
              {JSON.stringify(
                {
                  skipped: preview.skipped,
                  duplicates: preview.duplicates,
                  invalid: preview.invalid,
                  archived: preview.archived,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <button
            className="primary"
            disabled={busy || !preview.accepted.length}
            onClick={() => run(true)}
          >
            Commit import
          </button>
        </>
      )}
    </Modal>
  );
}
