// MCP tool definitions. Each tool: { name, description, inputSchema, run(args, ctx) → JSON-able result }.
// ctx: { root, ui: { url } , storybook: StorybookProcess }
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as ws from "../engine/workspace.mjs";
import { loadConfig, listBrands, resolveBrand } from "../engine/tokens.mjs";
import { runChecks, contrastFixes } from "../engine/checks.mjs";
import { composeDesignMd, lintDesignMd } from "../engine/design-md.mjs";
import { publish } from "./publish.mjs";

const requireWorkspace = (root) => {
  if (!existsSync(join(root, "design-system.json"))) throw new Error(`No design system in ${root}. Call create_design_system first.`);
};

const OP_SCHEMA = {
  type: "object",
  properties: {
    op: { type: "string", enum: ["set", "delete", "rename", "write"] },
    file: { type: "string", description: "Workspace-relative path, e.g. brands/acme/tokens.json, tokens/base.tokens.json, DESIGN.md, brands/acme/DESIGN.md, WRITING.md, design-system.json, src/components/<name>/<file>" },
    path: { type: "string", description: "Token path inside a token file, e.g. color/primary (set, delete, rename)" },
    to: { type: "string", description: "New token path (rename)" },
    mode: { type: "string", description: "Mode for set: omit for the default (light) value, or e.g. dark" },
    value: { description: "Token value for set: CSS color string (oklch preferred), dimension object {value,unit}, or DTCG composite" },
    type: { type: "string", description: "DTCG $type when creating a token (color, dimension, shadow, typography, …)" },
    description: { type: "string" },
    content: { type: "string", description: "Full file content (write)" },
  },
  required: ["op", "file"],
};

const tokenRow = (t) => ({
  name: t.name, path: t.key, type: t.type, source: t.source, description: t.description || undefined,
  values: Object.fromEntries(Object.entries(t.values).map(([m, v]) => [m, v.raw && typeof v.raw === "object" ? v.css : v.raw])),
});

export const TOOLS = [
  {
    name: "status",
    description: "Summary of the design system in this folder: brands, components, pending changes, latest versions, quality gate, and the local UI and Storybook URLs. Call this first.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, ctx) => {
      if (!existsSync(join(ctx.root, "design-system.json"))) return { workspace: ctx.root, exists: false, next: "Call create_design_system to scaffold a new design system here.", ui: ctx.ui.url };
      const checks = runChecks(ctx.root);
      return { exists: true, ...ws.summary(ctx.root), gate: checks.gate, checks: checks.summary, ui: ctx.ui.url, storybook: ctx.storybook.url, dependenciesInstalled: existsSync(join(ctx.root, "node_modules")) };
    },
  },
  {
    name: "create_design_system",
    description: "Scaffold a new design system in the current folder from the template (shadcn/ui base, Storybook, GitHub Pages workflow) and make the first commit. Then customise it with propose_change.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Product or design system name" },
        brand: { type: "string", description: "First brand id, lowercase kebab-case, e.g. acme" },
        context: { type: "string", enum: ["mobile-app", "saas-dashboard", "e-commerce", "marketing-site"] },
        naming: { type: "string", enum: ["shadcn", "material", "apple"], description: "Token naming convention. Default follows the context; components in the template use shadcn names." },
      },
      required: ["name", "brand", "context"],
    },
    run: (a, ctx) => ({ version: ws.initWorkspace(ctx.root, { name: a.name, brand: a.brand, context: a.context, naming: a.naming ?? "shadcn" }), next: "Call install_dependencies, then propose_change to set the brand's tokens and guidelines." }),
  },
  {
    name: "install_dependencies",
    description: "Run npm install in the design system folder (needed once before Storybook and tests). Takes 1–3 minutes.",
    inputSchema: { type: "object", properties: {} },
    run: async (_a, ctx) => { requireWorkspace(ctx.root); return ctx.storybook.install(); },
  },
  {
    name: "get_tokens",
    description: "All tokens for one brand with values per mode (light = default). Use names exactly as returned when writing components (bg-<name>, text-<name>).",
    inputSchema: { type: "object", properties: { brand: { type: "string" } } },
    run: (a, ctx) => {
      requireWorkspace(ctx.root);
      const config = loadConfig(ctx.root);
      const brand = a.brand ?? config.defaultBrand ?? listBrands(ctx.root, config)[0];
      const r = resolveBrand(ctx.root, brand, config);
      return { brand, brands: listBrands(ctx.root, config), modes: r.modes, naming: config.naming, tokens: r.tokens.map(tokenRow), issues: r.issues };
    },
  },
  {
    name: "get_guidelines",
    description: "Design guidelines (shared DESIGN.md + the brand's DESIGN.md) and writing guidelines (WRITING.md). Read before visual or copy decisions.",
    inputSchema: { type: "object", properties: { brand: { type: "string" } } },
    run: (a, ctx) => {
      requireWorkspace(ctx.root);
      const brand = a.brand ?? loadConfig(ctx.root).defaultBrand;
      return { shared: ws.readText(ctx.root, "DESIGN.md"), brand: ws.readText(ctx.root, `brands/${brand}/DESIGN.md`), brandWriting: ws.readText(ctx.root, `brands/${brand}/WRITING.md`), writing: ws.readText(ctx.root, "WRITING.md") };
    },
  },
  {
    name: "list_components",
    description: "Components with their files and specs (<name>.spec.md).",
    inputSchema: { type: "object", properties: {} },
    run: (_a, ctx) => { requireWorkspace(ctx.root); return ws.listComponents(ctx.root); },
  },
  {
    name: "propose_change",
    description: "Queue a change for the user to review in the UI. Nothing is written until apply_change. Ops: set a token value (per mode), delete, rename (aliases are rewritten), or write a whole file (guidelines, component files, design-system.json). Returns a preview including contrast changes.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short imperative summary; becomes the commit message, e.g. 'Warm up the primary color'" },
        rationale: { type: "string", description: "Why, in one or two sentences, for the reviewer" },
        ops: { type: "array", items: OP_SCHEMA, minItems: 1 },
      },
      required: ["title", "ops"],
    },
    run: (a, ctx) => { requireWorkspace(ctx.root); const c = ws.propose(ctx.root, a); ctx.notify(); return { id: c.id, preview: c.preview, review: `${ctx.ui.url}#changes` }; },
  },
  {
    name: "list_pending_changes",
    description: "Changes waiting for review.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, ctx) => ws.listPending(ctx.root).map(({ id, title, rationale, by, createdAt, ops, preview }) => ({ id, title, rationale, by, createdAt, ops: ops.length, files: preview.files, failingAfter: preview.failingAfter })),
  },
  {
    name: "apply_change",
    description: "Apply a pending change: write files, regenerate CSS, commit. Only call when the user approved it (in chat or by asking you to apply).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: (a, ctx) => { requireWorkspace(ctx.root); const r = ws.apply(ctx.root, a.id); ctx.notify(); return r; },
  },
  {
    name: "discard_change",
    description: "Drop a pending change.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: (a, ctx) => { ws.discard(ctx.root, a.id); ctx.notify(); return { discarded: a.id }; },
  },
  {
    name: "run_checks",
    description: "Quality gate: token consistency across brands, WCAG contrast for every brand × mode, hardcoded values in components. Returns failures with details.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, ctx) => {
      requireWorkspace(ctx.root);
      const r = runChecks(ctx.root);
      return { gate: r.gate, summary: r.summary, contrastFailures: r.contrast.filter((c) => !c.pass), tokenIssues: r.tokenIssues, hardcoded: r.hardcoded.slice(0, 30) };
    },
  },
  {
    name: "propose_contrast_fixes",
    description: "Compute deterministic fixes for every failing contrast pair (adjusts the foreground's OKLCH lightness, keeps hue) and queue them as one pending change.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, ctx) => {
      requireWorkspace(ctx.root);
      const { contrast } = runChecks(ctx.root);
      const { ops, skipped } = contrastFixes(contrast);
      if (!ops.length) return { message: "Nothing to fix.", skipped };
      const c = ws.propose(ctx.root, { title: `Fix contrast (${ops.length} pair${ops.length > 1 ? "s" : ""})`, rationale: ops.map((o) => o.why).join("; "), ops: ops.map(({ why, ...o }) => o), by: "engine" });
      ctx.notify();
      return { id: c.id, fixes: ops.map((o) => o.why), skipped };
    },
  },
  {
    name: "list_versions",
    description: "Version history (one commit per applied change).",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
    run: (a, ctx) => ws.versions(ctx.root, a.limit ?? 30),
  },
  {
    name: "restore_version",
    description: "Return the design system to an earlier version. Creates a new commit; history is kept.",
    inputSchema: { type: "object", properties: { version: { type: "string", description: "Short or full commit id from list_versions" } }, required: ["version"] },
    run: (a, ctx) => { requireWorkspace(ctx.root); const v = ws.restore(ctx.root, a.version); ctx.notify(); return { version: v }; },
  },
  {
    name: "export_design_md",
    description: "Compose the complete DESIGN.md (Google DESIGN.md format) for a brand: YAML generated from tokens + shared and brand prose. Returns the text and lint issues.",
    inputSchema: { type: "object", properties: { brand: { type: "string" } }, required: ["brand"] },
    run: (a, ctx) => { requireWorkspace(ctx.root); const text = composeDesignMd(ctx.root, a.brand); return { text, lint: lintDesignMd(text) }; },
  },
  {
    name: "start_storybook",
    description: "Start the workspace's Storybook (needed for component previews in the UI and for screenshots). Returns its URL.",
    inputSchema: { type: "object", properties: {} },
    run: async (_a, ctx) => { requireWorkspace(ctx.root); return ctx.storybook.start(); },
  },
  {
    name: "open_ui",
    description: "URL of the local review UI (tokens tree, components, guidelines, pending changes, versions). Give it to the user.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, ctx) => ({ url: ctx.ui.url }),
  },
  {
    name: "publish",
    description: "Publish: run the quality gate, write exports/<brand>/DESIGN.md, commit, push to GitHub (creates the repo on first publish) and enable GitHub Pages for Storybook. Requires the GitHub CLI signed in. Only call when the user asked to publish.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name for the first publish; ignored when a remote exists" },
        visibility: { type: "string", enum: ["private", "public"], description: "First publish only. Default private." },
        dryRun: { type: "boolean", description: "Run every step except pushing and enabling Pages" },
      },
    },
    run: async (a, ctx) => { requireWorkspace(ctx.root); const r = await publish(ctx.root, a); ctx.notify(); return r; },
  },
];

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));
