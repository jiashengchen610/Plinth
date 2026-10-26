// Local review UI: serves app/dist and a small JSON API over the workspace. Bound to 127.0.0.1; every
// API call must carry the per-session token, and the Host header must be local (blocks DNS rebinding).
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, watch } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as ws from "../engine/workspace.mjs";
import { loadConfig, listBrands, resolveBrand } from "../engine/tokens.mjs";
import { runChecks, contrastFixes } from "../engine/checks.mjs";
import { freePort } from "./storybook.mjs";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };

export async function startUi(ctx, { port: wanted = Number(process.env.PLINTH_PORT) || 4319 } = {}) {
  const token = process.env.PLINTH_TOKEN || randomBytes(16).toString("hex");
  let rev = 1;
  const bump = () => { rev++; };

  // Watch the workspace for edits made outside the tools (Claude editing files, git, the user).
  let timer = null;
  try {
    watch(ctx.root, { recursive: true }, (_e, file) => {
      if (!file || /node_modules|[\\/]\.git[\\/]|^\.git[\\/]|storybook-static/.test(file)) return;
      clearTimeout(timer);
      timer = setTimeout(bump, 150);
    });
  } catch { /* recursive watch unsupported: tools still bump rev */ }

  const state = () => {
    const exists = existsSync(join(ctx.root, "design-system.json"));
    if (!exists) return { rev, exists: false, workspace: ctx.root };
    const config = loadConfig(ctx.root);
    const brands = listBrands(ctx.root, config);
    const tokens = {};
    for (const b of brands) {
      const r = resolveBrand(ctx.root, b, config);
      tokens[b] = { modes: r.modes, issues: r.issues, rows: r.tokens.map((t) => ({ name: t.name, path: t.key, type: t.type, source: t.source, description: t.description, derived: Boolean(t.derived), values: Object.fromEntries(Object.entries(t.values).map(([m, v]) => [m, { raw: v.raw, css: v.css, resolved: v.resolved }])) })) };
    }
    const checks = runChecks(ctx.root);
    return {
      rev, exists: true, workspace: ctx.root, config, brands, tokens,
      checks: { gate: checks.gate, summary: checks.summary, contrast: checks.contrast, hardcoded: checks.hardcoded.slice(0, 50), tokenIssues: checks.tokenIssues },
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

  const routes = {
    "GET /api/rev": () => ({ rev }),
    "GET /api/state": () => state(),
    "POST /api/contrast-fixes": () => {
      const { ops, skipped } = contrastFixes(runChecks(ctx.root).contrast);
      if (!ops.length) return { message: "Nothing to fix.", skipped };
      const c = ws.propose(ctx.root, { title: `Fix contrast (${ops.length} pair${ops.length > 1 ? "s" : ""})`, rationale: ops.map((o) => o.why).join("; "), ops: ops.map(({ why, ...o }) => o), by: "engine" });
      return { id: c.id };
    },
    "POST /api/storybook/start": () => ctx.storybook.start(),
    // Storybook's index, proxied so the UI needs no cross-origin access. Lists story ids per component.
    "GET /api/storybook/index": async () => {
      if (!ctx.storybook.url) return { running: false, entries: [] };
      const idx = await (await fetch(`${ctx.storybook.url}/index.json`)).json();
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
        if (routes[key]) result = await routes[key]();
        else if (req.method === "POST" && (m = url.pathname.match(/^\/api\/changes\/([\w-]+)\/(apply|discard)$/))) {
          result = m[2] === "apply" ? ws.apply(ctx.root, m[1]) : (ws.discard(ctx.root, m[1]), { discarded: m[1] });
        } else if (req.method === "POST" && (m = url.pathname.match(/^\/api\/versions\/([0-9a-f]{4,40})\/restore$/))) {
          result = { version: ws.restore(ctx.root, m[1]) };
        } else return send(res, 404, { error: "not found" });
        if (req.method === "POST") bump();
        return send(res, 200, result);
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
  return { url: `http://localhost:${port}/`, port, bump, close: () => server.close() };
}
