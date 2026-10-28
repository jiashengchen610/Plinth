// Local Plinth UI: serves app/dist and a JSON API over the workspace. Bound to 127.0.0.1; every API call
// must carry the per-session token, and the Host header must be local (blocks DNS rebinding).
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, watch } from "node:fs";
import { join, extname, normalize, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as ws from "../engine/workspace.mjs";
import { loadConfig, listBrands, resolveBrand } from "../engine/tokens.mjs";
import { runChecks } from "../engine/checks.mjs";
import { publishDefaults, makePublicAndDeploy, redeploy, deployStatus } from "./publish.mjs";
import { toolByName, upgradeKind } from "./tools.mjs";
import { freePort, httpJson } from "./storybook.mjs";
import { createSetup, presets, suggest } from "./start.mjs";
import { draftVersionMessage } from "./quick.mjs";
import { colorName } from "../engine/color-names.mjs";
import { readStyle } from "../engine/style.mjs";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".woff2": "font/woff2", ".json": "application/json" };

export async function startUi(ctx, { port: wanted = Number(process.env.PLINTH_PORT) || 4319 } = {}) {
  const token = process.env.PLINTH_TOKEN || randomBytes(16).toString("hex");
  let rev = 1;
  const bump = () => { rev++; };

  // Watch the workspace. Any edit, from Plinth, an editor, git or another tool, refreshes the UI; an edit to tokens or
  // the configuration also regenerates the CSS, fonts and Foundations data, so the result is checked the same way
  // whoever made it. Generated files are not watched for that, or regenerating would trigger itself.
  let timer = null, regen = false;
  const SOURCE = /^(tokens[\\/]|brands[\\/][^\\/]+[\\/]tokens\.json$|design-system\.json$)/;
  try {
    watch(ctx.root, { recursive: true }, (_e, file) => {
      if (!file || /node_modules|[\\/]\.git[\\/]|^\.git[\\/]|storybook-static|^\.ds[\\/]/.test(file)) return;
      if (SOURCE.test(file)) regen = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (regen && existsSync(join(ctx.root, "design-system.json"))) { try { ws.regenerate(ctx.root); } catch { /* mid-edit, invalid JSON: the next save regenerates */ } }
        regen = false;
        bump();
      }, 200);
    });
  } catch { /* recursive watch unsupported: tools still bump rev */ }

  // Creating the design system from the Describe step (start.mjs): the engine's part at once, Claude's in the chat.
  ctx.setup ??= createSetup(ctx, { bump });

  // Template files Plinth shipped with a bug and the user never changed get the fix, as an undoable change.
  if (existsSync(join(ctx.root, "design-system.json"))) {
    try { const fix = ws.templateFixOps(ctx.root); if (fix.ops.length) ws.change(ctx.root, { title: fix.title, ops: fix.ops, by: "Plinth" }); } catch { /* the next start tries again */ }
  }

  const state = () => {
    const exists = existsSync(join(ctx.root, "design-system.json"));
    const common = { rev, exists, workspace: ctx.root, chat: ctx.chat?.state() ?? null, review: ctx.review?.state() ?? null, deps: ctx.deps.state(), tests: ctx.tests.state(), publish: ctx.publish.state(), github: ctx.github.state(), setup: ctx.setup.state() };
    if (!exists) return common;
    const config = loadConfig(ctx.root);
    const brands = listBrands(ctx.root, config);
    const tokens = {};
    for (const b of brands) {
      const r = resolveBrand(ctx.root, b, config);
      tokens[b] = { modes: r.modes, layers: r.layers, issues: r.issues, rows: r.tokens.map((t) => ({ name: t.name, path: t.key, type: t.type, source: t.source, layer: t.layer, layerId: t.layerId, refs: t.refs, linked: t.linked, description: t.description, derived: Boolean(t.derived), ...(t.fit ? { fit: t.fit } : {}), values: Object.fromEntries(Object.entries(t.values).map(([m, v]) => [m, { raw: v.raw, css: v.css, resolved: v.resolved, alpha: v.alpha }])) })) };
    }
    const checks = runChecks(ctx.root);
    return {
      ...common, config, brands, tokens,
      checks: { gate: checks.gate, summary: checks.summary, warnings: checks.warnings, contrast: checks.contrast, distinct: checks.distinct, structure: checks.structure, hardcoded: checks.hardcoded.slice(0, 50), tokenIssues: checks.tokenIssues, exceptions: checks.exceptions },
      layers: (config.layers ?? null), upgradeAvailable: upgradeKind(ctx.root, config),
      components: ws.listComponents(ctx.root),
      style: Object.fromEntries(brands.map((b) => [b, readStyle(ctx.root, b)])),
      guidelines: { shared: ws.readText(ctx.root, "DESIGN.md"), writing: ws.readText(ctx.root, "WRITING.md"), brands: Object.fromEntries(brands.map((b) => [b, ws.readText(ctx.root, `brands/${b}/DESIGN.md`)])) },
      unsaved: ws.unsavedChanges(ctx.root),
      lastChange: ws.lastChange(ctx.root),
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

  // Long operations return at once and report through state.
  const longOp = async (_url, start) => (start(), { started: true });
  const tool = (name, args = {}) => toolByName.get(name).run(args, ctx);

  // What GitHub did with the last publish. Polled by the Publish page while GitHub works; a result that will not
  // change (live, failed) is kept a minute, and anything that starts a new run forgets it.
  let deployCache = { at: 0, value: null };
  let rerunAt = 0;
  const deploy = async () => {
    const final = ["live", "failed"].includes(deployCache.value?.status);
    if (Date.now() - deployCache.at < (final ? 60_000 : 8_000)) return deployCache.value;
    // A rerun that has not shown up within 3 minutes is not coming (Actions off, or GitHub busy): report what is there.
    if (rerunAt && Date.now() - rerunAt > 180_000) rerunAt = 0;
    deployCache = { at: Date.now(), value: await deployStatus(ctx.root, { after: rerunAt }) };
    return deployCache.value;
  };
  const fresh = (r) => { deployCache = { at: 0, value: null }; return r; };

  // The description of the next version: the engine's draft at once, Claude's when it is ready. Asked once per set of
  // changes; the user confirms or changes it before saving.
  const drafts = new Map();
  const draftKey = () => JSON.stringify(ws.changesSinceSave(ctx.root));

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
    "POST /api/publish/make-public": () => { needsWorkspace(); rerunAt = Date.now(); return fresh(makePublicAndDeploy(ctx.root)); },
    "POST /api/publish/redeploy": () => { needsWorkspace(); rerunAt = Date.now(); return fresh(redeploy(ctx.root)); },
    "GET /api/deploy": async () => { needsWorkspace(); return { deploy: await deploy() }; },
    "POST /api/github/login": () => ctx.github.start(),
    "POST /api/github/cancel": () => ctx.github.cancel(),
    "POST /api/publish": async (req, url) => { needsWorkspace(); const opts = await readJson(req); return longOp(url, () => ctx.publish.start(opts).then((r) => { rerunAt = 0; return fresh(r); })); },
    // Edits made in the UI: written at once, like any change; Undo takes them back, Save version commits them.
    "POST /api/change": async (req) => { needsWorkspace(); const { title, ops } = await readJson(req); return ws.change(ctx.root, { title: title || "Edit in the token graph", ops, by: "you" }); },
    "POST /api/undo": () => { needsWorkspace(); return ws.undo(ctx.root); },
    "GET /api/version-draft": () => { needsWorkspace(); const changes = ws.changesSinceSave(ctx.root); return { key: JSON.stringify(changes), text: ws.versionDraft(changes), by: "plinth" }; },
    "POST /api/version-draft": async () => {
      needsWorkspace();
      const key = draftKey();
      if (!drafts.has(key)) { drafts.clear(); drafts.set(key, draftVersionMessage(ctx.root)); }
      return { key, ...(await drafts.get(key)) };
    },
    "POST /api/save": async (req) => { needsWorkspace(); return ws.saveVersion(ctx.root, (await readJson(req)).message); },
    "POST /api/discard": () => { needsWorkspace(); return ws.discardUnsaved(ctx.root); },
    "POST /api/contrast-fixes": () => { needsWorkspace(); return tool("fix_contrast"); },
    "POST /api/exceptions": async (req) => { needsWorkspace(); return ws.acceptException(ctx.root, await readJson(req)); },
    "POST /api/exceptions/remove": async (req) => { needsWorkspace(); return ws.removeException(ctx.root, await readJson(req)); },
    // A name for a color the user is about to add, for them to confirm: the nearest color word the palette lacks.
    "GET /api/color-name": (_req, url) => { needsWorkspace(); const st = readStyle(ctx.root, loadConfig(ctx.root).defaultBrand ?? listBrands(ctx.root)[0]); return { name: colorName(url.searchParams.get("color") ?? "#888888", [...st.hues, ...st.grays]) }; },
    "POST /api/palette": async (req) => { needsWorkspace(); return tool("add_palette_color", await readJson(req)); },
    "POST /api/upgrade": () => { needsWorkspace(); return tool("upgrade_to_layers"); },
    // The Describe step: presets, Claude's suggestions after the first answer, and creating from the answers.
    "GET /api/presets": () => presets(),
    "POST /api/suggest": async (req) => { const { product } = await readJson(req); if (!String(product ?? "").trim()) throw new Error("Say what you're making first."); return suggest(ctx, product); },
    "POST /api/setup": async (req) => { const answers = await readJson(req); const already = Boolean(ctx.setup.state()?.running); ctx.setup.start(answers).catch(() => {}); return { started: true, already }; },
    "POST /api/style": async (req) => { needsWorkspace(); return tool("set_style", { ...(await readJson(req)), by: "you" }); },
    "POST /api/role-color": async (req) => { needsWorkspace(); return tool("set_role_color", { ...(await readJson(req)), by: "you" }); },
    "POST /api/add-component": async (req) => { needsWorkspace(); const { name } = await readJson(req); return tool("add_component", { name, by: "you" }); },
    "POST /api/remove-component": async (req) => { needsWorkspace(); const { name } = await readJson(req); return tool("remove_component", { name, by: "you" }); },
    "POST /api/link-palette": () => { needsWorkspace(); return tool("link_to_palette"); },
    // The AI review at publish: one short headless run over everything since the last publish.
    "POST /api/review": () => { needsWorkspace(); if (!ctx.review) throw new Error("Review is not available in this server."); return ctx.review.start(); },
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
        else if (req.method === "POST" && (m = url.pathname.match(/^\/api\/tools\/([a-z_]+)$/))) {
          // A tool call forwarded by another Plinth process for this workspace (owner.mjs).
          const t = toolByName.get(m[1]);
          if (!t) return send(res, 404, { error: `Unknown tool: ${m[1]}` });
          result = await t.run(await readJson(req), ctx);
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

  // Forwarded tool calls (install, tests, publish) can take minutes: no request timeout on this local server.
  server.requestTimeout = 0;
  const port = await freePort(wanted);
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { url: `http://localhost:${port}/`, port, token, bump, close: () => server.close() };
}
