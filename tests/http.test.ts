import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
async function freePort() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const p = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}
async function start(db: string, port: number) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/server/index.ts", "--production"],
    {
      env: { ...process.env, KOTOBA_DB: db, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Server startup timeout"));
    }, 10000);
    let log = "";
    child.stdout!.on("data", (b) => {
      log += b;
      if (log.includes("Kotoba is ready")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr!.on("data", (b) => {
      log += b;
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited ${code}: ${log}`));
    });
  });
  return child;
}
async function stop(p: ChildProcess) {
  if (p.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    p.once("exit", () => resolve());
    p.kill("SIGTERM");
  });
}
test("production HTTP workflows: static startup, import, activation, concurrent review, restart, restore, conjugation and histories", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kotoba-http-")),
    port = await freePort(),
    base = `http://127.0.0.1:${port}`;
  let child = await start(join(dir, "data.sqlite"), port);
  const request = async (path: string, body?: unknown) => {
    const r = await fetch(
      base + "/api" + path,
      body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "content-type": "application/json", origin: base },
            body: JSON.stringify(body),
          },
    );
    const v = await r.json();
    assert.ok(r.ok, JSON.stringify(v));
    return v;
  };
  try {
    assert.deepEqual(await request("/health"), { ok: true });
    const html = await (await fetch(base)).text();
    assert.match(html, /Kotoba/);
    const asset = html.match(/src="([^"]+\.js)"/)![1];
    assert.equal((await fetch(base + asset)).status, 200);
    const csv =
      "id,word,form,freq,pos,translation,extended,notes\n1,食べる,たべる,194,v1-t,to eat,to consume,\n2,する,する,1,v-irr-t,to do,,\n3,来る,くる,2,v-irr-i,to come,,\n";
    const preview = await request("/import", {
      kind: "vocabulary",
      source: "http",
      text: csv,
    });
    assert.equal(preview.accepted.length, 3);
    assert.equal((await request("/entries")).length, 0);
    await request("/import", {
      kind: "vocabulary",
      source: "http",
      text: csv,
      commit: true,
    });
    const entries = await request("/entries");
    assert.equal(entries.length, 3);
    assert.equal((await request("/cards")).length, 0);
    await request("/activation", {
      ids: entries.map((e: any) => e.id),
      active: true,
    });
    const cards = await request("/cards");
    assert.equal(cards.length, 6);
    const eat = entries.find((e: any) => e.data.word === "食べる"),
      c = cards.find(
        (c: any) => c.entryId === eat.id && c.direction === "en-jp",
      );
    let s = await request("/sessions", { mode: "custom", cardIds: [c.id] });
    const i = s.items[0];
    assert.ok(!i.question.expected);
    assert.ok(!i.question.details);
    await request("/present", { id: i.id });
    const payload = { id: i.id, key: "http-answer", given: "TABERU" };
    const [a, b] = await Promise.all([
      request("/submit", payload),
      request("/submit", payload),
    ]);
    assert.equal(a.id, b.id);
    assert.equal(a.result, "correct");
    assert.equal((await request("/history")).length, 1);
    const before = await request("/backup");
    await stop(child);
    child = await start(join(dir, "data.sqlite"), port);
    assert.deepEqual(await request("/backup"), before);
    await request("/forms", { id: "core-1", enabled: true });
    const q = await request("/queue?deck=conjugation");
    assert.equal(q.length, 6);
    const forward = q.filter((x: any) => x.direction === "forward");
    s = await request("/sessions", {
      mode: "conjugation",
      cardIds: forward.map((x: any) => x.id),
    });
    for (const item of s.items) {
      const shown = await request("/present", { id: item.id });
      assert.ok(!shown.question.details);
      assert.ok(!/Godan|Ichidan|Irregular/.test(shown.question.label));
      await request("/submit", {
        id: item.id,
        key: item.id,
        given: "",
        grade: "pass",
      });
    }
    assert.equal((await request("/history")).length, 4);
    const malformed = structuredClone(before);
    malformed.tables.cards[0].memory = "{}";
    const failed = await fetch(base + "/api/restore", {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ confirm: true, backup: malformed }),
    });
    assert.equal(failed.status, 400);
    assert.equal((await request("/history")).length, 4);
    await request("/restore", { confirm: true, backup: before });
    assert.deepEqual(await request("/backup"), before);
    const denied = await fetch(base + "/api/activation", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://foreign.example",
      },
      body: JSON.stringify({ ids: [], active: true }),
    });
    assert.equal(denied.status, 403);
    assert.equal(
      (await request("/sessions/" + a.sessionId)).items[0].attempt.id,
      a.id,
    );
  } finally {
    await stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});
