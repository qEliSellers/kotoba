import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { z } from "zod";
import { Store } from "./database.ts";
import { Study } from "./study.ts";
import { restore } from "./backup.ts";
import { EntryKind } from "../core/models.ts";
import { templates } from "../core/imports.ts";
const port = Number(process.env.PORT ?? 3210);
const store = new Store(resolve(process.env.KOTOBA_DB ?? "data/kotoba.sqlite"));
const study = new Study(store);
const lib = study.library;
const dev = !process.argv.includes("--production");
const vite = dev
  ? await (
      await import("vite")
    ).createServer({ server: { middlewareMode: true }, appType: "spa" })
  : null;
const ids = z.array(z.string().min(1)).max(100000),
  id = z.string().min(1).max(200);
async function body(req: import("node:http").IncomingMessage) {
  let s = "";
  for await (const chunk of req) {
    s += chunk;
    if (Buffer.byteLength(s) > 100 * 1024 * 1024)
      throw new Error("Request exceeds 100 MB");
  }
  return s ? JSON.parse(s) : {};
}
function reply(
  res: import("node:http").ServerResponse,
  value: unknown,
  status = 200,
  pretty = false,
) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value, null, pretty ? 2 : undefined));
}
const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? "";
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) {
      reply(res, { error: "Invalid host" }, 403);
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}`);
    const path = url.pathname;
    const method = req.method ?? "GET";
    if (path.startsWith("/api/")) {
      if (
        method !== "GET" &&
        ((req.headers.origin && req.headers.origin !== `http://${host}`) ||
          !req.headers["content-type"]?.startsWith("application/json"))
      ) {
        reply(res, { error: "Same-origin JSON requests required" }, 403);
        return;
      }
      const b = method === "GET" ? {} : await body(req);
      const p = Object.fromEntries(url.searchParams);
      if (path === "/api/health") return reply(res, { ok: true });
      if (path === "/api/entries" && method === "GET")
        return reply(
          res,
          lib.search(
            EntryKind.parse(p.kind ?? "vocabulary"),
            p.q,
            p.min ? Number(p.min) : 0,
            p.max ? Number(p.max) : Infinity,
            p.active,
          ),
        );
      if (path === "/api/entries" && method === "POST") {
        const v = z
          .object({ kind: EntryKind, data: z.unknown(), id: id.optional() })
          .parse(b);
        return reply(res, lib.save(v.kind, v.data, v.id));
      }
      if (path === "/api/entries/delete") {
        const v = z.object({ id, confirm: z.literal(true) }).parse(b);
        lib.remove(v.id);
        return reply(res, { ok: true });
      }
      if (path === "/api/activation") {
        const v = z.object({ ids, active: z.boolean() }).parse(b);
        return reply(res, { count: lib.activate(v.ids, v.active) });
      }
      if (path === "/api/import") {
        const v = z
          .object({
            kind: EntryKind,
            source: id,
            text: z.string().max(50_000_000),
            commit: z.boolean().default(false),
          })
          .parse(b);
        return reply(res, lib.import(v.kind, v.source, v.text, v.commit));
      }
      if (path === "/api/templates") {
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=${EntryKind.parse(p.kind)}-template.csv`,
        });
        return res.end(templates[EntryKind.parse(p.kind)]);
      }
      if (path === "/api/kanji/source") {
        const v = z
          .object({
            entryIds: ids.optional(),
            top: z.number().int().min(1).max(100000).optional(),
          })
          .parse(b);
        return reply(res, lib.sourceKanji(v.entryIds, v.top));
      }
      if (path === "/api/cards") return reply(res, lib.cards());
      if (path === "/api/queue")
        return reply(
          res,
          study.queue({
            ...p,
            min: p.min ? Number(p.min) : undefined,
            max: p.max ? Number(p.max) : undefined,
            entryIds: p.entryIds ? p.entryIds.split(",") : undefined,
          }),
        );
      if (path === "/api/forms" && method === "GET")
        return reply(res, study.forms());
      if (path === "/api/forms") {
        const v = z.object({ id, enabled: z.boolean() }).parse(b);
        study.enable(v.id, v.enabled);
        return reply(res, { ok: true });
      }
      if (path === "/api/sessions" && method === "POST") {
        const v = z
          .object({
            mode: z.enum([
              "flex",
              "custom",
              "smart",
              "conjugation",
              "classification",
              "confusables",
              "retry",
            ]),
            cardIds: ids.default([]),
            count: z.number().int().min(1).max(300).optional(),
            tricky: z.boolean().optional(),
          })
          .parse(b);
        const s = study.create(v.mode, v.cardIds, v);
        return reply(res, study.publicSession(s.id));
      }
      if (path === "/api/sessions" && method === "GET")
        return reply(
          res,
          store.all(
            "SELECT s.*,count(a.id) AS answered FROM sessions s LEFT JOIN attempts a ON a.session_id=s.id GROUP BY s.id ORDER BY s.started DESC",
          ),
        );
      if (path.startsWith("/api/sessions/"))
        return reply(
          res,
          study.publicSession(decodeURIComponent(path.split("/").pop()!)),
        );
      if (path === "/api/present")
        return reply(res, study.present(id.parse(b.id)));
      if (path === "/api/reveal")
        return reply(res, study.reveal(id.parse(b.id)));
      if (path === "/api/submit") {
        const v = z
          .object({
            id,
            key: id,
            given: z.string().max(10000).default(""),
            grade: z.enum(["correct", "wrong", "pass"]).optional(),
          })
          .parse(b);
        return reply(res, study.submit(v.id, v.key, v.given, v.grade));
      }
      if (path === "/api/history") return reply(res, study.history(p.cardId));
      if (path === "/api/backup" && method === "GET") {
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=kotoba-${new Date().toISOString().slice(0, 10)}.json`,
        );
        return reply(res, store.export(), 200, true);
      }
      if (path === "/api/restore") {
        if (b.confirm !== true)
          throw new Error("Confirm replacement before restoring");
        return reply(res, restore(store, b.backup));
      }
      if (path === "/api/settings" && method === "GET")
        return reply(
          res,
          Object.fromEntries(
            store
              .all("SELECT * FROM settings")
              .map((x) => [x.key, JSON.parse(x.value)]),
          ),
        );
      if (path === "/api/settings") {
        const settings = z
          .object({ mute: z.boolean(), furigana: z.boolean() })
          .parse(b);
        store.tx(() => {
          for (const [key, value] of Object.entries(settings))
            store.run(
              "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
              key,
              JSON.stringify(value),
            );
        });
        return reply(res, settings);
      }
      return reply(res, { error: "Unknown API route" }, 404);
    }
    if (vite) return vite.middlewares(req, res);
    const file = resolve("dist", "." + (path === "/" ? "/index.html" : path));
    if (!file.startsWith(resolve("dist") + "/")) {
      res.writeHead(404);
      return res.end();
    }
    let target = file;
    try {
      if (!(await stat(target)).isFile()) target = resolve("dist/index.html");
    } catch {
      target = resolve("dist/index.html");
    }
    res.setHeader(
      "Content-Type",
      (
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".csv": "text/csv",
        } as Record<string, string>
      )[extname(target)] ?? "application/octet-stream",
    );
    res.end(await readFile(target));
  } catch (e) {
    reply(
      res,
      { error: e instanceof Error ? e.message : "Request failed" },
      400,
    );
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Kotoba is ready at http://127.0.0.1:${port} (${dev ? "development" : "offline production"})`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    server.close();
    void vite?.close();
    store.close();
    process.exit(0);
  });
