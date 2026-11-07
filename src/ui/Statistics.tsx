import React, { useEffect, useState } from "react";
import type { Attempt, Card } from "../core/models.ts";
import { api, date, days } from "./api.ts";
import { summarize } from "../core/statistics.ts";
import { strength } from "../core/scheduler.ts";
import { FORMS } from "../core/conjugation.ts";
import { AttemptTable, SessionSummary } from "./StudyView.tsx";
export function Statistics({ onError, onLaunch, initialCard, onClear }: any) {
  const [all, setAll] = useState<Attempt[]>([]),
    [cards, setCards] = useState<Card[]>([]),
    [entries, setEntries] = useState<any[]>([]),
    [deck, setDeck] = useState("all"),
    [range, setRange] = useState("all"),
    [tab, setTab] = useState(initialCard ? "card" : "overview"),
    [cardId, setCardId] = useState(initialCard ?? ""),
    [ranking, setRanking] = useState("strength"),
    [session, setSession] = useState<any>(null),
    [sessions, setSessions] = useState<any[]>([]);
  useEffect(() => {
    Promise.all([
      api("/history"),
      api("/cards"),
      api("/entries?kind=vocabulary"),
      api("/entries?kind=kanji"),
      api("/sessions"),
    ])
      .then(([a, c, v, k, s]) => {
        setAll(a);
        setCards(c);
        setEntries([...v, ...k]);
        setSessions(s);
      })
      .catch(onError);
  }, []);
  const cutoff = range === "all" ? 0 : Date.now() - Number(range) * 86400000;
  const attempts = all.filter(
      (a) =>
        (deck === "all" || a.question.deck === deck) && a.timestamp >= cutoff,
    ),
    filteredCards = cards.filter((c) => deck === "all" || c.deck === deck),
    stats = summarize(attempts, filteredCards);
  const cardAttempts = all.filter((a) => a.cardId === cardId);
  const label = (c: Card) =>
    `${entries.find((e) => e.id === c.entryId)?.data.word ?? (c.formId ? (FORMS.find((f) => f.id === c.formId)?.label ?? "Conjugation") + " #" + c.slot : "Archived entry")} · ${c.direction}`;
  const scores = filteredCards
    .map((c) => {
      const a = all.filter((a) => a.cardId === c.id);
      return {
        c,
        mean: a.length ? a.reduce((s, x) => s + x.seconds, 0) / a.length : 0,
      };
    })
    .sort((a, b) =>
      ranking === "streak"
        ? b.c.memory.streak - a.c.memory.streak
        : ranking === "accuracy"
          ? b.c.memory.correct / (b.c.memory.total || 1) -
            a.c.memory.correct / (a.c.memory.total || 1)
          : ranking === "slowest"
            ? b.mean - a.mean
            : strength(b.c.memory).total - strength(a.c.memory).total,
    );
  if (session)
    return (
      <SessionSummary
        session={session}
        onFinish={() => setSession(null)}
        onLaunch={onLaunch}
        onError={onError}
      />
    );
  return (
    <section>
      <div className="page-heading">
        <div>
          <div className="eyebrow">EVERY ATTEMPT COUNTS</div>
          <h1>Your progress</h1>
          <p>A record of your practice, one answer at a time.</p>
        </div>
        <div className="actions">
          <select
            aria-label="Statistics deck"
            value={deck}
            onChange={(e) => setDeck(e.target.value)}
          >
            {[
              "all",
              "vocabulary",
              "kanji",
              "conjugation",
              "classification",
            ].map((d) => (
              <option value={d} key={d}>
                {d === "all" ? "All decks" : d}
              </option>
            ))}
          </select>
          <select
            aria-label="Statistics date range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="all">All time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
      </div>
      <div className="tabs">
        {["overview", "evolution", "rankings", "quizzes", "card"].map((t) => (
          <button
            key={t}
            className={t === tab ? "selected" : ""}
            onClick={() => setTab(t)}
          >
            {t === "card" ? "Card history" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {(tab === "overview" || tab === "evolution") && (
        <>
          <div className="metrics">
            <div>
              <span>Reviewed questions</span>
              <strong>{stats.total}</strong>
              <small>{stats.quizzes} quizzes with answers</small>
            </div>
            <div>
              <span>Success rate</span>
              <strong>{Math.round(stats.accuracy * 100)}%</strong>
              <small>{stats.correct} correct answers</small>
            </div>
            <div>
              <span>Practice time</span>
              <strong>
                {(stats.seconds / 60).toFixed(1)}
                <em>min</em>
              </strong>
              <small>Timed recall</small>
            </div>
            <div>
              <span>Study streak</span>
              <strong>
                {stats.streak}
                <em>days</em>
              </strong>
              <small>{stats.studyDays} total study days in filter</small>
            </div>
          </div>
        </>
      )}
      {tab === "overview" && (
        <>
          <div className="panel">
            <h2>Flashcard maturity</h2>
            <p className="muted">
              Based on earned scheduling maturity. Includes paused cards; new
              cards are shown separately.
            </p>
            <div className="mastery">
              {Object.entries(stats.mastery).map(([k, n], i) => (
                <div
                  key={k}
                  style={{
                    flex: Math.max(n, 0.01),
                    background: [
                      "#536558",
                      "#d8887a",
                      "#dbba65",
                      "#82ac8e",
                      "#c9dfb5",
                    ][i],
                  }}
                  title={`${k}: ${n}`}
                />
              ))}
            </div>
            <div className="mastery-labels">
              {Object.entries(stats.mastery).map(([k, n]) => (
                <span key={k}>
                  {k} <b>{n}</b>
                </span>
              ))}
            </div>
          </div>
          <div className="panel">
            <h2>By deck</h2>
            <table>
              <thead>
                <tr>
                  <th>DECK</th>
                  <th>REVIEWS</th>
                  <th>ACCURACY</th>
                  <th>TIME</th>
                </tr>
              </thead>
              <tbody>
                {["vocabulary", "kanji", "conjugation", "classification"].map(
                  (d) => {
                    const s = summarize(
                      attempts.filter((a) => a.question.deck === d),
                      [],
                    );
                    return (
                      <tr key={d}>
                        <td>{d}</td>
                        <td>{s.total}</td>
                        <td>{Math.round(100 * s.accuracy)}%</td>
                        <td>{s.seconds.toFixed(1)}s</td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === "evolution" && (
        <div className="panel">
          <h2>Practice over time</h2>
          <p>
            Daily reviewed questions and correct answers from saved attempts.
          </p>
          {stats.daily.length ? (
            <>
              <svg
                viewBox="0 0 900 240"
                role="img"
                aria-label="Daily review totals"
              >
                <line x1="40" y1="200" x2="880" y2="200" stroke="#425246" />
                {stats.daily.map((d, i) => {
                  const max = Math.max(...stats.daily.map((x) => x.total), 1);
                  const w = 820 / stats.daily.length;
                  return (
                    <g key={d.date}>
                      <rect
                        x={40 + i * w}
                        y={200 - (d.total / max) * 160}
                        width={Math.max(1, w - 4)}
                        height={(d.total / max) * 160}
                        fill="#526854"
                      />
                      <rect
                        x={40 + i * w}
                        y={200 - (d.correct / max) * 160}
                        width={Math.max(1, w - 4)}
                        height={(d.correct / max) * 160}
                        fill="#cee5b7"
                      />
                      <title>
                        {d.date}: {d.correct}/{d.total} correct,{" "}
                        {d.seconds.toFixed(1)} seconds
                      </title>
                    </g>
                  );
                })}
                <text x="40" y="225">
                  {stats.daily[0].date}
                </text>
                <text x="880" y="225" textAnchor="end">
                  {stats.daily.at(-1)?.date}
                </text>
              </svg>
              <table>
                <thead>
                  <tr>
                    <th>DATE</th>
                    <th>REVIEWS</th>
                    <th>CORRECT</th>
                    <th>SECONDS</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.daily.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td>{d.total}</td>
                      <td>{d.correct}</td>
                      <td>{d.seconds.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p>No reviews in this period yet.</p>
          )}
        </div>
      )}
      {tab === "rankings" && (
        <div className="panel">
          <div className="panel-heading">
            <h2>Card rankings</h2>
            <select
              value={ranking}
              aria-label="Rank by"
              onChange={(e) => setRanking(e.target.value)}
            >
              <option value="strength">Strength</option>
              <option value="streak">Actual streak</option>
              <option value="accuracy">Lifetime accuracy</option>
              <option value="slowest">Slowest recall</option>
            </select>
          </div>
          <table>
            <thead>
              <tr>
                <th>CARD</th>
                <th>STRENGTH</th>
                <th>STREAK</th>
                <th>ACCURACY</th>
                <th>MEAN TIME</th>
              </tr>
            </thead>
            <tbody>
              {scores.map(({ c, mean }) => (
                <tr key={c.id}>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => {
                        setCardId(c.id);
                        setTab("card");
                      }}
                    >
                      {label(c)}
                    </button>
                  </td>
                  <td>{(100 * strength(c.memory).total).toFixed(1)}%</td>
                  <td>{c.memory.streak}</td>
                  <td>
                    {c.memory.correct}/{c.memory.total}
                  </td>
                  <td>{mean.toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === "quizzes" && (
        <div className="panel">
          <h2>Quiz history</h2>
          {sessions
            .filter(
              (s) =>
                s.started >= cutoff &&
                (deck === "all" || attempts.some((a) => a.sessionId === s.id)),
            )
            .map((s) => (
              <button
                className="card-row"
                key={s.id}
                onClick={async () => {
                  try {
                    setSession(await api("/sessions/" + s.id));
                  } catch (e) {
                    onError(e);
                  }
                }}
              >
                <span>
                  {s.mode} <small>{date(s.started)}</small>
                </span>
                <span>
                  {s.answered} attempts · {s.ended ? "Complete" : "In progress"}{" "}
                  →
                </span>
              </button>
            ))}
        </div>
      )}
      {tab === "card" && (
        <>
          <label>
            Inspect an independent card
            <select
              value={cardId}
              onChange={(e) => {
                setCardId(e.target.value);
                onClear();
              }}
            >
              <option value="">Choose a card…</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {label(c)}
                </option>
              ))}
            </select>
          </label>
          {cardId && (
            <>
              <div className="panel">
                <h2>Recall speed over time</h2>
                <p>
                  Every graded attempt for this card, including all quiz entry
                  points.
                </p>
                <Scatter attempts={cardAttempts} />
                <div className="legend">
                  <span className="correct">● Correct</span>
                  <span className="pass">● Pass</span>
                  <span className="wrong">● Wrong</span>
                </div>
              </div>
              <AttemptTable attempts={cardAttempts} />
            </>
          )}
        </>
      )}
    </section>
  );
}
function Scatter({ attempts }: { attempts: Attempt[] }) {
  if (!attempts.length) return <p>No attempts for this card yet.</p>;
  const first = attempts[0].timestamp,
    last = attempts.at(-1)!.timestamp,
    max = Math.max(1, ...attempts.map((a) => a.seconds));
  return (
    <svg
      viewBox="0 0 900 290"
      role="img"
      aria-label="Response seconds by review date"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line
            x1="55"
            y1={230 - f * 190}
            x2="870"
            y2={230 - f * 190}
            stroke="#354439"
          />
          <text x="45" y={235 - f * 190} textAnchor="end">
            {(f * max).toFixed(1)}s
          </text>
        </g>
      ))}
      {attempts.map((a) => (
        <circle
          key={a.id}
          cx={
            55 +
            (last === first ? 0.5 : (a.timestamp - first) / (last - first)) *
              815
          }
          cy={230 - (a.seconds / max) * 190}
          r="5"
          fill={
            { correct: "#9ed39e", pass: "#e4c66e", wrong: "#ee9485" }[a.result]
          }
        >
          <title>
            {date(a.timestamp)} · {a.seconds.toFixed(2)}s · {a.result}
          </title>
        </circle>
      ))}
      <text x="55" y="260">
        {new Date(first).toLocaleDateString()}
      </text>
      <text x="870" y="260" textAnchor="end">
        {new Date(last).toLocaleDateString()}
      </text>
      <text x="450" y="285" textAnchor="middle">
        Chronological review date
      </text>
    </svg>
  );
}
