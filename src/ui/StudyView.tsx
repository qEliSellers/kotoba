import React, { useEffect, useRef, useState } from "react";
import { api, date, days } from "./api.ts";
import type { Attempt, Session, SessionItem } from "../core/models.ts";
import type { Prefs } from "./main.tsx";
export function StudyView({
  onLaunch,
  onError,
  conjugation = false,
}: {
  onLaunch: (id: string) => void;
  onError: (e: unknown) => void;
  conjugation?: boolean;
}) {
  const [queue, setQueue] = useState<any[]>([]),
    [count, setCount] = useState(20),
    [deck, setDeck] = useState(conjugation ? "conjugation" : "all"),
    [direction, setDirection] = useState("all"),
    [preset, setPreset] = useState("flex"),
    [expanded, setExpanded] = useState(false),
    [min, setMin] = useState(""),
    [max, setMax] = useState(""),
    [busy, setBusy] = useState(false),
    [sessions, setSessions] = useState<any[]>([]),
    [tricky, setTricky] = useState(false);
  useEffect(() => {
    let live = true;
    api("/queue?" + new URLSearchParams({ deck, direction, preset, min, max }))
      .then((q) => {
        if (live) {
          setQueue(q);
          setCount(Math.min(20, q.length));
        }
      })
      .catch(onError);
    api("/sessions")
      .then((s) => {
        if (live) setSessions(s.filter((x: any) => !x.ended));
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [deck, direction, preset, min, max]);
  const visible = expanded ? queue : queue.slice(0, 300),
    n = Math.min(count, visible.length),
    due = queue.filter((c) => c.urgency >= 100).length;
  async function launch(mode: string) {
    setBusy(true);
    try {
      const s = await api("/sessions", {
        mode,
        cardIds: visible.slice(0, n).map((c) => c.id),
        tricky,
        count: 20,
      });
      onLaunch(s.id);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A LITTLE PRACTICE, EVERY DAY</div>
          <h1>{conjugation ? "Practice conjugation" : "Your study desk"}</h1>
          <p>Make space for what you’re learning.</p>
        </div>
        <span className="date-label">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </span>
      </div>
      <div className="metrics">
        <div>
          <span>Ready to review</span>
          <strong>{due}</strong>
          <small>Due or overdue cards</small>
        </div>
        <div>
          <span>Active flashcards</span>
          <strong>{queue.length}</strong>
          <small>In the current selection</small>
        </div>
        <div>
          <span>Selected today</span>
          <strong className="accent">{n}</strong>
          <small>One question at a time</small>
        </div>
      </div>
      {sessions.length > 0 && (
        <div className="notice">
          An unfinished session is saved.{" "}
          <button onClick={() => onLaunch(sessions[0].id)}>
            Resume {sessions[0].mode} · {sessions[0].answered} answered →
          </button>
          {sessions.length > 1 && (
            <details>
              <summary>
                Show {sessions.length - 1} other unfinished{" "}
                {sessions.length === 2 ? "session" : "sessions"}
              </summary>
              <div className="unfinished-sessions">
                {sessions.slice(1).map((saved) => (
                  <button key={saved.id} onClick={() => onLaunch(saved.id)}>
                    Resume {saved.mode} · {saved.answered} answered ·{" "}
                    {date(saved.started)} →
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      <div className="panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">
              {preset === "flex"
                ? "FLEXSRS"
                : preset === "custom"
                  ? "CUSTOM QUIZ"
                  : "SMART QUIZ"}
            </div>
            <h2>
              {["flex", "custom"].includes(preset)
                ? "Your review horizon"
                : "Your targeted selection"}
            </h2>
          </div>
          <span className="legend">
            <i /> Selected cards <b /> Upcoming cards
          </span>
        </div>
        <div className="toolbar">
          <select
            aria-label="Deck filter"
            value={deck}
            onChange={(e) => setDeck(e.target.value)}
          >
            <option value="all">All decks</option>
            <option value="vocabulary">Vocabulary</option>
            <option value="kanji">Kanji</option>
            <option value="conjugation">Conjugation</option>
          </select>
          <select
            aria-label="Skill filter"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="all">All directions / skills</option>
            {[
              "jp-en",
              "en-jp",
              "on",
              "kun",
              "meaning",
              "forward",
              "reverse",
            ].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <select
            aria-label="Quiz selection"
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
          >
            <option value="flex">FlexSRS · urgency</option>
            <option value="custom">Custom · all selected count</option>
            <option value="weakest">Smart · weakest strength</option>
            <option value="streak">Smart · lowest streak</option>
            <option value="oldest">Smart · least recently reviewed</option>
            <option value="newest">Smart · newly added</option>
          </select>
          <input
            className="small-input"
            placeholder="Rank from"
            aria-label="Study minimum rank"
            type="number"
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
          <input
            className="small-input"
            placeholder="Rank to"
            aria-label="Study maximum rank"
            type="number"
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </div>
        <div className="graph">
          <div className="graph-label top">200%</div>
          <div className="graph-label middle">100%</div>
          <div className="graph-label bottom">0%</div>
          <div
            className="bars"
            style={{ gap: visible.length > 100 ? 0 : 2 }}
            role="group"
            aria-label="Review urgency graph"
          >
            <div className="due-line">
              <span>Due for review</span>
            </div>
            {visible.map((c, i) => (
              <button
                key={c.id}
                aria-label={`Select first ${i + 1} cards`}
                aria-pressed={i < n}
                title={`${i + 1}. ${c.title} · ${c.direction} · ${c.urgency.toFixed(1)}% urgency`}
                className={i < n ? "bar chosen" : "bar"}
                style={{ height: Math.max(1, c.urgency / 2) + "%" }}
                onClick={() => setCount(i + 1)}
              />
            ))}
            {!visible.length && (
              <div className="graph-empty">
                Your review horizon starts with an active deck.
                <br />
                <small>Add words in Library, then activate them.</small>
              </div>
            )}
          </div>
        </div>
        <div className="graph-footer">
          <span>
            Showing {visible.length} of {queue.length} cards{" "}
            {queue.length > 300 && (
              <button
                className="text-button"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "Show first 300" : "Expand all"}
              </button>
            )}
          </span>
          <span>Click a bar to select the first N cards</span>
        </div>
        <div className="review-start">
          <div className="counter">
            <button
              aria-label="Select fewer cards"
              onClick={() => setCount(Math.max(0, n - 1))}
            >
              −
            </button>
            <input
              aria-label="Number of cards"
              type="number"
              min="0"
              max={visible.length}
              value={n}
              onChange={(e) =>
                setCount(
                  Math.max(0, Math.min(visible.length, Number(e.target.value))),
                )
              }
            />
            <button
              aria-label="Select more cards"
              onClick={() => setCount(Math.min(visible.length, n + 1))}
            >
              ＋
            </button>
            <span>questions</span>
          </div>
          <button
            className="primary"
            disabled={!n || busy}
            onClick={() =>
              launch(
                conjugation
                  ? "conjugation"
                  : preset === "flex"
                    ? "flex"
                    : preset === "custom"
                      ? "custom"
                      : "smart",
              )
            }
          >
            Start review <span>→</span>
          </button>
        </div>
      </div>
      {!conjugation && (
        <div className="two-columns">
          <div className="panel shortcut">
            <span className="tile-symbol">分</span>
            <h2>Verb classification</h2>
            <p>Build instinct for godan, ichidan, and irregular verbs.</p>
            <label className="check">
              <input
                type="checkbox"
                checked={tricky}
                onChange={(e) => setTricky(e.target.checked)}
              />{" "}
              Only tricky る-ending verbs
            </label>
            <button disabled={busy} onClick={() => launch("classification")}>
              Practice classification →
            </button>
          </div>
          <div className="panel shortcut">
            <span className="tile-symbol">似</span>
            <h2>Untangle similar words</h2>
            <p>
              Practice automatic contrasts based on your answers and the words
              in your deck.
            </p>
            <button disabled={busy} onClick={() => launch("confusables")}>
              Practice confusables →
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
export function speak(text: string, mute: boolean) {
  if (mute || !text || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  const voice = window.speechSynthesis
    .getVoices()
    .find((v) => v.lang.startsWith("ja") && v.localService);
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}
export function Quiz({
  id,
  prefs,
  onFinish,
  onError,
  onLaunch,
}: {
  id: string;
  prefs: Prefs;
  onFinish: () => void;
  onError: (e: unknown) => void;
  onLaunch: (id: string) => void;
}) {
  const [session, setSession] = useState<Session | null>(null),
    [item, setItem] = useState<any>(null),
    [given, setGiven] = useState(""),
    [result, setResult] = useState<Attempt | null>(null),
    [busy, setBusy] = useState(false),
    [revealed, setRevealed] = useState(false),
    [summary, setSummary] = useState(false);
  const key = useRef(crypto.randomUUID()),
    input = useRef<HTMLInputElement>(null),
    nextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    load();
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, [id]);
  async function load() {
    try {
      const s = await api<Session>("/sessions/" + id);
      setSession(s);
      const pending = s.items.find((i) => !i.attempt);
      if (!pending) {
        setSummary(true);
        setItem(null);
        return;
      }
      const presented = await api("/present", { id: pending.id });
      setItem(presented);
      setRevealed(presented.revealed !== null);
      setGiven("");
      setResult(null);
      key.current = crypto.randomUUID();
      speak(presented.question.speechPrompt, prefs.mute);
    } catch (e) {
      onError(e);
    }
  }
  useEffect(() => {
    if (item && !result) input.current?.focus();
    else if (result) nextButton.current?.focus();
  }, [item, result]);
  async function submit(grade?: string, choice?: string) {
    if (!item || busy) return;
    setBusy(true);
    try {
      const a = await api<Attempt>("/submit", {
        id: item.id,
        key: key.current,
        given: choice ?? given,
        grade,
      });
      setResult(a);
      speak(a.question.speechAnswer, prefs.mute);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function reveal() {
    setBusy(true);
    try {
      const r = await api("/reveal", { id: item.id });
      setItem(r);
      setRevealed(true);
      speak(r.question.speechAnswer, prefs.mute);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  if (!session) return <p>Opening your session…</p>;
  if (summary)
    return (
      <SessionSummary
        session={session}
        onFinish={onFinish}
        onLaunch={onLaunch}
        onError={onError}
      />
    );
  if (!item) return null;
  const q = item.question;
  const done = session.items.filter((i) => i.attempt).length;
  return (
    <section className="quiz">
      <div className="quiz-top">
        <button onClick={onFinish}>← Save & leave</button>
        <span>
          {session.mode} · Question {item.ordinal + 1} of {session.items.length}
        </span>
        <span>{done} completed</span>
      </div>
      <div className="progress">
        <div style={{ width: (100 * done) / session.items.length + "%" }} />
      </div>
      <div className="question">
        <div className="eyebrow">
          {q.deck === "conjugation"
            ? `CONJUGATION · SLOT ${q.slot}`
            : q.deck.toUpperCase()}
        </div>
        <div className="question-label">{q.label}</div>
        <h1 lang={q.direction === "en-jp" ? "en" : "ja"}>{q.prompt}</h1>
        {prefs.furigana && q.reading && (
          <div className="reading" lang="ja">
            {q.reading}
          </div>
        )}
        {q.speechPrompt && (
          <button
            className="text-button"
            onClick={() => speak(q.speechPrompt, false)}
          >
            ♪ Repeat audio
          </button>
        )}
      </div>
      {result ? (
        <div className={"answer-feedback " + result.result}>
          <div className="eyebrow">
            {result.result === "correct"
              ? "✓ Correct"
              : result.result === "pass"
                ? "— Pass"
                : "✕ Incorrect"}
          </div>
          <h2>
            {result.question.answerKind === "choice"
              ? result.question.details.word
              : result.question.expected.join(" / ")}
          </h2>
          <p>
            {result.question.details.word} · {result.question.details.reading} ·{" "}
            {result.question.details.meanings.join("; ")}
          </p>
          <p>{result.question.details.extended.join("; ")}</p>
          {result.question.details.notes && (
            <p>{result.question.details.notes}</p>
          )}
          {result.question.speechAnswer && (
            <button
              className="text-button answer-audio"
              onClick={() => speak(result.question.speechAnswer, false)}
            >
              ♪ Repeat answer audio
            </button>
          )}
          <small>
            Your answer: {displayAnswer(result)} · {result.seconds.toFixed(1)}{" "}
            seconds{" "}
            {result.after && `· Next interval ${days(result.after.interval)}`}
          </small>
          {q.answerKind === "choice" && (
            <div className="comparison">
              {result.question.comparison?.map((o) => (
                <span key={o.id}>
                  {o.word} ({o.reading}) — {o.meaning}
                  {o.id === result.question.entryId ? " ✓" : ""}
                </span>
              ))}
            </div>
          )}
          <button ref={nextButton} className="primary" onClick={load}>
            Next question →
          </button>
        </div>
      ) : q.answerKind === "self" ? (
        <div className="answer-area">
          {revealed ? (
            <>
              <h2>{q.expected.join(" / ")}</h2>
              {q.speechAnswer && (
                <button
                  className="text-button"
                  onClick={() => speak(q.speechAnswer, false)}
                >
                  ♪ Repeat answer audio
                </button>
              )}
              <p>Did you recall both the dictionary form and the form label?</p>
              <div className="actions centered">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => submit("correct")}
                >
                  Correct
                </button>
                <button disabled={busy} onClick={() => submit("wrong")}>
                  Incorrect
                </button>
                <button disabled={busy} onClick={() => submit("pass")}>
                  Pass
                </button>
              </div>
            </>
          ) : (
            <button className="primary" disabled={busy} onClick={reveal}>
              Reveal answer
            </button>
          )}
        </div>
      ) : q.answerKind === "choice" || q.answerKind === "classification" ? (
        <div className="answer-area">
          <div className="choice-grid">
            {q.options.map((o: any) => (
              <button
                key={o.id}
                disabled={busy}
                onClick={() => submit(undefined, o.id)}
              >
                {o.text}
              </button>
            ))}
          </div>
          <button disabled={busy} onClick={() => submit("pass")}>
            Pass / Don’t know
          </button>
        </div>
      ) : (
        <form
          className="answer-area"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="answer">
            {q.answerKind === "japanese"
              ? "Type the pronunciation in romaji"
              : "Type the English meaning"}
          </label>
          <input
            id="answer"
            ref={input}
            value={given}
            onChange={(e) => setGiven(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={busy}
          />
          <div className="actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => submit("pass")}
            >
              Pass / Don’t know
            </button>
            <button className="primary" disabled={busy || !given.trim()}>
              Check answer ↵
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
const displayAnswer = (a: Attempt) =>
  a.question.options?.find((o) => o.id === a.given)?.text ?? (a.given || "—");
export function SessionSummary({ session, onFinish, onLaunch, onError }: any) {
  const attempts: Attempt[] = session.items.flatMap((i: SessionItem) =>
    i.attempt ? [i.attempt] : [],
  );
  const correct = attempts.filter((a) => a.result === "correct").length;
  const failed = [
    ...new Set(
      attempts
        .filter((a) => a.result !== "correct" && a.cardId)
        .map((a) => a.cardId),
    ),
  ];
  return (
    <section>
      <div className="eyebrow">
        {session.ended ? "SESSION COMPLETE" : "SESSION IN PROGRESS"}
      </div>
      <h1>A little further today.</h1>
      <p>
        {date(session.started)} · {session.mode}
      </p>
      <div className="metrics">
        <div>
          <strong>
            {attempts.length
              ? Math.round((100 * correct) / attempts.length)
              : 0}
            %
          </strong>
          <span>Accuracy</span>
        </div>
        <div>
          <strong>
            {correct} / {attempts.length}
          </strong>
          <span>Correct answers</span>
        </div>
        <div>
          <strong>
            {attempts.reduce((s, a) => s + a.seconds, 0).toFixed(0)}s
          </strong>
          <span>Active recall time</span>
        </div>
      </div>
      <div className="actions">
        <button className="primary" onClick={onFinish}>
          Back to study
        </button>
        {failed.length > 0 && (
          <button
            onClick={async () => {
              try {
                const s = await api("/sessions", {
                  mode: "retry",
                  cardIds: failed,
                });
                onLaunch(s.id);
              } catch (e) {
                onError(e);
              }
            }}
          >
            Review missed cards
          </button>
        )}
      </div>
      <div className="legend" style={{ marginTop: 24 }}>
        <span className="correct">{correct} correct</span>
        <span className="pass">
          {attempts.filter((a) => a.result === "pass").length} pass
        </span>
        <span className="wrong">
          {attempts.filter((a) => a.result === "wrong").length} incorrect
        </span>
      </div>
      <AttemptTable attempts={attempts} />
    </section>
  );
}
export function AttemptTable({
  attempts,
  onCard,
}: {
  attempts: Attempt[];
  onCard?: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>DATE / QUESTION</th>
            <th>ANSWER / OUTCOME</th>
            <th>TIME</th>
            <th>URGENCY</th>
            <th>INTERVAL</th>
            <th>STREAK / MATURITY</th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((a) => (
            <tr key={a.id}>
              <td>
                <small>
                  {date(a.timestamp)} · {a.mode}
                </small>
                {onCard && a.cardId ? (
                  <button
                    className="text-button"
                    onClick={() => onCard(a.cardId!)}
                  >
                    {a.question.prompt}
                  </button>
                ) : (
                  a.question.prompt
                )}
                <small>{a.question.label}</small>
              </td>
              <td>
                <span className={"outcome " + a.result}>{a.result}</span>{" "}
                {displayAnswer(a)}
                <small>
                  Accepted:{" "}
                  {a.question.answerKind === "choice"
                    ? a.question.details.word
                    : a.question.expected.join(" / ")}
                </small>
              </td>
              <td>{a.seconds.toFixed(2)}s</td>
              <td>{a.urgency?.toFixed(1) ?? "—"}%</td>
              <td>
                {a.before && a.after ? (
                  <>
                    {days(a.before.interval)} → {days(a.after.interval)}
                    <small>Due: {date(a.after.nextDue)}</small>
                  </>
                ) : (
                  "Drill only"
                )}
              </td>
              <td>
                {a.after && (
                  <>
                    {a.before?.streak} → {a.after.streak}
                    <small>Earned: {a.after.maturity.toFixed(3)}</small>
                    <details>
                      <summary>Calculation</summary>
                      <pre>{JSON.stringify(a.debug, null, 2)}</pre>
                    </details>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
