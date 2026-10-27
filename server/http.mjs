// Local Plinth UI: serves app/dist and a JSON API over the workspace. Bound to 127.0.0.1; every API call
// must carry the per-session token, and the Host header must be local (blocks DNS rebinding).
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, watch } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as ws from "../engine/workspace.mjs";
import { loadConfig, listBrands, resolveBrand } from "../engine/tokens.mjs";
import { runChecks, contrastFixes } from "../engine/checks.mjs";
import { publishDefaults } from "./publish.mjs";
import { freePort, httpJson } from "./storybook.mjs";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".woff2": "font/woff2", ".json": "application/json" };

export async function startUi(ctx, { port: wanted = Number(process.env.PLINTH_PORT) || 4319 } = {}) {
  const token = process.env.PLINTH_TOKEN || randomBytes(16).toString("hex");
  let rev = 1;
  const bump = () => { rev++; };

  // Watch the workspace for edits made outside the tools (git, the user, an editor).
  let timer = null;
  try {
    watch(ctx.root, { recursive: true }, (_e, file) => {
      if (!file || /node_modules|[\\/]\.git[\\/]|^\.git[\\/]|storybook-static|^\.ds[\\/]/.test(file)) return;
      clearTimeout(timer);
      timer = setTimeout(bump, 150);
    });
  } catch { /* recursive watch unsupported: tools still bump rev */ }

  const state = () => {
    const exists = existsSync(join(ctx.root, "design-system.json"));
    const common = { rev, exists, workspace: ctx.root, chat: ctx.chat?.state() ?? null, deps: ctx.deps.state(), tests: ctx.tests.state(), publish: ctx.publish.state(), github: ctx.github.state() };
    if (!exists) return common;
    const config = loadConfig(ctx.root);
    const brands = listBrands(ctx.root, config);
    const tokens = {};
    for (const b of brands) {
      const r = resolveBrand(ctx.root, b, config);
      tokens[b] = { modes: r.modes, issues: r.issues, rows: r.tokens.map((t) => ({ name: t.name, path: t.key, type: t.type, source: t.source, description: t.description, derived: Boolean(t.derived), values: Object.fromEntries(Object.entries(t.values).map(([m, v]) => [m, { raw: v.raw, css: v.css, resolved: v.resolved }])) })) };
    }
    const checks = runChecks(ctx.root);
    return {
      ...common, config, brands, tokens,
      checks: { gate: checks.gate, summary: checks.summary, contrast: checks.contrast, distinct: checks.distinct, hardcoded: checks.hardcoded.slice(0, 50), tokenIssues: checks.tokenIssues, exceptions: checks.exceptions },
      components: ws.listComponents(ctx.root),
      guidelines: { shared: ws.readText(ctx.root, "DESIGN.md"), writing: ws.readText(ctx.root, "WRITING.md"), brands: Object.fromEntries(brands.map((b) => [b, ws.readText(ctx.root, `brands/${b}/DESIGN.md`)])) },
      pending: ws.listPending(ctx.root),
      versions: ws.versions(ctx.root, 40),
      storybook: ctx.storybook.url,
    };
  };

  const send = (res, code, body, type = "application/json") => {
    res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(type === "application/json" ? JSON.stringify(body) : body);
  };

  // JSON request bodies (chat messages may carry images as base64), capped at 40 MB.
  const readJson = (req) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 40 * 1024 * 1024) { reject(new Error("Request too large.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(new Error("Invalid JSON body.")); } });
    req.on("error", reject);
  });
  const needsWorkspace = () => { if (!existsSync(join(ctx.root, "design-system.json"))) throw new Error("No design system yet. Describe one in the chat first."); };

  // Long operations return at once and report through state; ?wait=1 (used by the nested session's tools) waits.
  const longOp = async (url, start) => (url.searchParams.get("wait") ? start() : (start(), { started: true }));

  const routes = {
    "GET /api/rev": () => ({ rev }),
    "GET /api/state": () => state(),
    "POST /api/chat": async (req) => { const { id } = await ctx.chat.send(await readJson(req)); return { id }; },
    "POST /api/chat/stop": () => ctx.chat.stop(),
    "POST /api/chat/reset": () => ctx.chat.reset(),
    "POST /api/install": (_req, url) => { needsWorkspace(); return longOp(url, () => ctx.deps.install()); },
    "POST /api/tests": (_req, url) => { needsWorkspace(); return longOp(url, () => ctx.tests.run()); },
    "POST /api/storybook/start": () => { needsWorkspace(); return ctx.storybook.start(); },
    "GET /api/publish/defaults": () => { needsWorkspace(); return publishDefaults(ctx.root); },
    "POST /api/github/login": () => ctx.github.start(),
    "POST /api/github/cancel": () => ctx.github.cancel(),
    "POST /api/publish": async (req, url) => { needsWorkspace(); const opts = await readJson(req); return longOp(url, () => ctx.publish.start(opts)); },
    "POST /api/contrast-fixes": () => {
      needsWorkspace();
      const { ops, skipped } = contrastFixes(runChecks(ctx.root).contrast);
      if (!ops.length) return { message: "Nothing to fix.", skipped };
      const c = ws.propose(ctx.root, { title: `Fix contrast (${ops.length} pair${ops.length > 1 ? "s" : ""})`, rationale: ops.map((o) => o.why).join("; "), ops: ops.map(({ why, ...o }) => o), by: "engine" });
      return { id: c.id };
    },
    "POST /api/exceptions": async (req) => { needsWorkspace(); return { version: ws.acceptException(ctx.root, await readJson(req)) }; },
    "POST /api/exceptions/remove": async (req) => { needsWorkspace(); return { version: ws.removeException(ctx.root, await readJson(req)) }; },
    // Storybook's index, proxied so the UI needs no cross-origin access. Lists story ids per component.
    "GET /api/storybook/index": async () => {
      if (!ctx.storybook.url) return { running: false, entries: [] };
      const idx = (await httpJson(`${ctx.storybook.url}/index.json`)).json;
      return { running: true, url: ctx.storybook.url, entries: Object.values(idx.entries ?? {}).map((e) => ({ id: e.id, title: e.title, name: e.name, type: e.type, importPath: e.importPath })) };
    },
  };

  const server = createServer(async (req, res) => {
    try {
      const host = (req.headers.host ?? "").split(":")[0];
      if (!["127.0.0.1", "localhost"].includes(host)) return send(res, 403, { error: "forbidden host" });
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        if (req.headers["x-plinth-token"] !== token) return send(res, 401, { error: "missing or wrong session token" });
        const key = `${req.method} ${url.pathname}`;
        let m;
        let result;
        if (routes[key]) result = await routes[key](req, url);
        else if (req.method === "POST" && (m = url.pathname.match(/^\/api\/changes\/([\w-]+)\/(apply|discard)$/))) {
          result = m[2] === "apply" ? ws.apply(ctx.root, m[1]) : (ws.discard(ctx.root, m[1]), { discarded: m[1] });
        } else if (req.method === "POST" && (m = url.pathname.match(/^\/api\/versions\/([0-9a-f]{4,40})\/restore$/))) {
          result = { version: ws.restore(ctx.root, m[1]) };
        } else return send(res, 404, { error: "not found" });
        if (req.method === "POST") bump();
        return send(res, 200, result);
      }
      // Images the user attached in chat (token in the query string: <img> cannot send headers).
      if (url.pathname.startsWith("/inbox/")) {
        if (url.searchParams.get("t") !== token) return send(res, 401, { error: "missing or wrong session token" });
        const name = url.pathname.slice("/inbox/".length);
        if (!/^[\w-]+\.(png|jpg|webp|gif)$/.test(name)) return send(res, 404, { error: "not found" });
        const file = join(ctx.root, ".ds", "inbox", name);
        if (!existsSync(file)) return send(res, 404, { error: "not found" });
        return send(res, 200, readFileSync(file), TYPES[extname(file)] ?? "application/octet-stream");
      }
      // static app
      let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([\\/])+/, "");
      if (!rel || rel === "." ) rel = "index.html";
      let file = join(DIST, rel);
      if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
      if (!existsSync(file)) return send(res, 503, "The UI is not built. Run: npm run build:app", "text/plain; charset=utf-8");
      let body = readFileSync(file);
      if (file.endsWith("index.html")) body = String(body).replace("</head>", `<meta name="plinth-token" content="${token}"></head>`);
      return send(res, 200, body, TYPES[extname(file)] ?? "application/octet-stream");
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  });

  const port = await freePort(wanted);
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { url: `http://localhost:${port}/`, port, token, bump, close: () => server.close() };
}
