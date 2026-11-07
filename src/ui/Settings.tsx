import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { StudyView } from "./StudyView.tsx";
import { SRS } from "../core/scheduler.ts";
export function Settings({ prefs, onPrefs, onError, onRestore }: any) {
  const [backup, setBackup] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const restoreFile = useRef<HTMLInputElement>(null);
  async function save(next: any) {
    try {
      await api("/settings", next);
      onPrefs(next);
    } catch (e) {
      onError(e);
    }
  }
  return (
    <section>
      <div className="eyebrow">MAKE IT YOURS</div>
      <h1>Settings</h1>
      <p>Your study preferences and portable data.</p>
      <div className="panel">
        <h2>Study preferences</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={prefs.furigana}
            onChange={(e) => save({ ...prefs, furigana: e.target.checked })}
          />{" "}
          Show vocabulary furigana
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={prefs.mute}
            onChange={(e) => save({ ...prefs, mute: e.target.checked })}
          />{" "}
          Mute automatic Japanese audio
        </label>
        <p className="muted">
          Audio uses your browser’s Japanese voice. Install a local Japanese
          system voice for offline playback. Kanji-reading questions stay silent
          until answer reveal.
        </p>
      </div>
      <div className="panel">
        <h2>Back up your learning</h2>
        <p>
          Export your entire library, independent schedules, quiz sessions, and
          review history as a versioned JSON file.
        </p>
        <a className="button primary" href="/api/backup">
          ↓ Export all data
        </a>
        <hr />
        <h3>Restore a backup</h3>
        <p>
          A restore replaces the current workspace. A recovery copy is saved
          automatically before replacement.
        </p>
        <label>
          Backup file
          <input
            ref={restoreFile}
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              try {
                const f = e.target.files?.[0];
                if (f) {
                  const data = JSON.parse(await f.text());
                  setBackup(data);
                  setMessage(
                    `${data.format ?? "Unknown format"} · version ${data.version ?? "?"} · ${data.tables?.entries?.length ?? 0} entries · ${data.tables?.attempts?.length ?? 0} attempts`,
                  );
                }
              } catch (e) {
                setBackup(null);
                onError(e);
              }
            }}
          />
        </label>
        {message && <p role="status">{message}</p>}
        <button
          disabled={!backup || busy}
          onClick={async () => {
            if (
              !confirm(
                "Replace this workspace with the selected backup? A pre-restore recovery copy will be saved.",
              )
            )
              return;
            setBusy(true);
            try {
              await api("/restore", { backup, confirm: true });
              localStorage.removeItem("kotoba-session");
              onPrefs({
                mute: false,
                furigana: true,
                ...(await api("/settings")),
              });
              setMessage("Backup restored successfully.");
              setBackup(null);
              if (restoreFile.current) restoreFile.current.value = "";
              onRestore();
            } catch (e) {
              onError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Validate and restore backup
        </button>
      </div>
      <div className="panel">
        <h2>Scheduling model</h2>
        <p>
          The experimental scheduler is versioned. Every attempt stores its
          inputs, settings, and calculation for inspection in Card history.
        </p>
        <p className="muted">
          Constants are maintained in <code>src/core/scheduler.ts</code>.
          Editing them applies to future attempts; existing history remains
          intact.
        </p>
        <details>
          <summary>Current configuration</summary>
          <pre>{JSON.stringify(SRS, null, 2)}</pre>
        </details>
      </div>
    </section>
  );
}
export function ConjugationView({ onLaunch, onError }: any) {
  const [forms, setForms] = useState<any[]>([]),
    [practice, setPractice] = useState(false),
    [busy, setBusy] = useState("");
  useEffect(() => {
    api("/forms").then(setForms).catch(onError);
  }, []);
  async function toggle(f: any) {
    setBusy(f.id);
    try {
      await api("/forms", { id: f.id, enabled: !f.enabled });
      setForms(await api("/forms"));
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
    }
  }
  if (practice)
    return (
      <>
        <button onClick={() => setPractice(false)}>← Manage forms</button>
        <StudyView conjugation onLaunch={onLaunch} onError={onError} />
      </>
    );
  return (
    <section>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ONE SKILL, MANY VERBS</div>
          <h1>Conjugation</h1>
          <p>
            Unlock forms at your pace. Practice them with the verbs in your
            active deck.
          </p>
        </div>
        <button className="primary" onClick={() => setPractice(true)}>
          Practice enabled forms →
        </button>
      </div>
      <div className="notice">
        {forms.filter((f) => f.enabled).length} of 64 forms enabled · Up to 50
        stable slots per form, with two independent directions.
        <br />
        <small>
          Examples change between sessions. Slot history stays with you. Fewer
          eligible verbs means fewer filled slots.
        </small>
      </div>
      {[...new Set(forms.map((f) => f.group))].map((group) => (
        <div className="panel" key={group}>
          <h2>{group}</h2>
          <div className="form-catalog">
            {forms
              .filter((f) => f.group === group)
              .map((f) => (
                <label
                  className={f.enabled ? "form-toggle enabled" : "form-toggle"}
                  key={f.id}
                >
                  <input
                    type="checkbox"
                    checked={f.enabled}
                    disabled={!!busy}
                    onChange={() => toggle(f)}
                  />
                  <span>
                    {f.label}
                    <small>{f.enabled ? "Enabled" : "Locked"}</small>
                  </span>
                </label>
              ))}
          </div>
        </div>
      ))}
    </section>
  );
}
