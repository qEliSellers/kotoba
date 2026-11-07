import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { LibraryView } from "./LibraryView.tsx";
import { StudyView, Quiz } from "./StudyView.tsx";
import { Statistics } from "./Statistics.tsx";
import { Settings, ConjugationView } from "./Settings.tsx";
import { api } from "./api.ts";
import "./style.css";
export type Prefs = { mute: boolean; furigana: boolean };
function App() {
  const [page, setPage] = useState("Study"),
    [session, setSession] = useState<string | null>(null),
    [prefs, setPrefs] = useState<Prefs>({ mute: false, furigana: true }),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0),
    [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    api("/settings")
      .then((p) => setPrefs({ mute: false, furigana: true, ...p }))
      .catch((e) => setError(e.message));
    const saved = localStorage.getItem("kotoba-session");
    if (saved)
      api("/sessions/" + saved)
        .then((s) => {
          if (!s.ended) setSession(saved);
          else localStorage.removeItem("kotoba-session");
        })
        .catch(() => localStorage.removeItem("kotoba-session"));
  }, []);
  function launch(id: string) {
    setSession(id);
    localStorage.setItem("kotoba-session", id);
  }
  function finish() {
    setSession(null);
    localStorage.removeItem("kotoba-session");
    setVersion((v) => v + 1);
  }
  function history(id: string) {
    setTarget(id);
    setPage("Statistics");
  }
  const props = {
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    onLaunch: launch,
  };
  return (
    <div className="app">
      <aside>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("Study");
            setSession(null);
          }}
        >
          <span className="brand-mark">言</span>
          <span>
            Kotoba<small>JAPANESE STUDY</small>
          </span>
        </a>
        <div className="nav-label">YOUR WORKSPACE</div>
        <nav>
          {["Library", "Study", "Conjugation", "Statistics", "Settings"].map(
            (p, i) => (
              <button
                key={p}
                className={!session && page === p ? "nav active" : "nav"}
                onClick={() => {
                  setPage(p);
                  setSession(null);
                }}
              >
                <span>{["▤", "◉", "あ", "▥", "⚙"][i]}</span>
                {p}
              </button>
            ),
          )}
        </nav>
        <div className="sidebar-bottom">
          <span className="online-dot" /> Stored on this Mac
          <small>Your words. Your pace.</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            学び続ける <span className="muted">/</span> Keep learning
          </span>
          <span className="local-badge">LOCAL WORKSPACE</span>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {session ? (
          <Quiz
            key={session}
            id={session}
            prefs={prefs}
            onFinish={finish}
            {...props}
          />
        ) : (
          <React.Fragment key={version + page}>
            {page === "Library" && (
              <LibraryView {...props} onHistory={history} />
            )}
            {page === "Study" && <StudyView {...props} />}
            {page === "Conjugation" && <ConjugationView {...props} />}
            {page === "Statistics" && (
              <Statistics
                {...props}
                initialCard={target}
                onClear={() => setTarget(null)}
              />
            )}
            {page === "Settings" && (
              <Settings
                {...props}
                prefs={prefs}
                onPrefs={setPrefs}
                onRestore={() => setTarget(null)}
              />
            )}
          </React.Fragment>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
