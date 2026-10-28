// MCP tool definitions. Each tool: { name, description, inputSchema, run(args, ctx) → JSON-able result }.
// ctx: see context.mjs ({ root, ui, deps, storybook, tests, publish, notify }). Tools run in the process that owns
// the workspace (owner.mjs); other processes forward their calls to it.
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as ws from "../engine/workspace.mjs";
import { loadConfig, listBrands, resolveBrand } from "../engine/tokens.mjs";
import { runChecks, contrastFixes, glassContrast } from "../engine/checks.mjs";
import { composeDesignMd, lintDesignMd } from "../engine/design-md.mjs";
import { paletteColorOps } from "../engine/palette.mjs";
import { upgradeProposal, linkToPaletteOps, typographyUpgrade, componentRefresh } from "../engine/upgrade.mjs";
import { GLASS_PRESETS, glassOps, readGlass, readStyle, roleColorOps, styleOps, styleTitle } from "../engine/style.mjs";
import { addIconOps, findIcons, iconSet, listIcons } from "../engine/icons.mjs";
import { COMPONENTS } from "./start.mjs";
import { deployStatus } from "./publish.mjs";
import { chartFollowOps, chartOps, chartView } from "../engine/chart.mjs";

/** Change titles use the name people see in the UI (Text box, Dropdown); components outside the catalog keep their id. */
const componentName = (id) => COMPONENTS.find((c) => c.id === id)?.name ?? id;

const requireWorkspace = (root) => {
  if (!existsSync(join(root, "design-system.json"))) throw new Error(`No design system in ${root}. Call create_design_system first.`);
};

const OP_SCHEMA = {
  type: "object",
  properties: {
    op: { type: "string", enum: ["set", "delete", "rename", "write"] },
    file: { type: "string", description: "Workspace-relative path, e.g. brands/acme/tokens.json, tokens/base.tokens.json, tokens/components/button.tokens.json, DESIGN.md, brands/acme/DESIGN.md, WRITING.md, design-system.json, src/components/<name>/<file>" },
    path: { type: "string", description: "Token path inside a token file, e.g. color/primary (set, delete, rename)" },
    to: { type: "string", description: "New token path (rename). Aliases in token files and utilities in components (bg-old → bg-new) are rewritten." },
    mode: { type: "string", description: "Mode for set: omit for the default (light) value, or e.g. dark" },
    value: { description: "Token value for set: a reference like {color.red.600} (preferred for colors), a CSS color string (oklch preferred), a dimension object {value,unit}, or a DTCG composite" },
    type: { type: "string", description: "DTCG $type when creating a token (color, dimension, shadow, typography, …)" },
    description: { type: "string" },
    alpha: { type: "number", description: "Opacity 0..1 of a color token (set), for `mode` or the light value; 1 removes it" },
    content: { type: "string", description: "Full file content (write)" },
  },
  required: ["op", "file"],
};

const tokenRow = (t) => ({
  name: t.name, path: t.key, type: t.type, source: t.source, description: t.description || undefined,
  values: Object.fromEntries(Object.entries(t.values).map(([m, v]) => [m, v.raw && typeof v.raw === "object" ? v.css : v.raw])),
});

const failures = (r) => ({
  contrastFailures: r.contrast.filter((c) => !c.pass && !c.accepted).map(({ brand, mode, bg, fg, ratio, min }) => ({ brand, mode, bg, fg, ratio, min })),
  distinctFailures: r.distinct.filter((c) => !c.pass && !c.accepted).map(({ brand, mode, a, b, deltaE, hueDiff, reason }) => ({ brand, mode, a, b, deltaE, hueDiff, reason })),
  hardcoded: r.hardcoded.filter((f) => !f.accepted).slice(0, 30).map(({ file, line, rule, match }) => ({ file, line, rule, match })),
  structure: (r.structure ?? []).filter((x) => !x.accepted).slice(0, 30).map(({ brand, kind, detail }) => ({ brand, kind, detail })),
  tokenIssues: r.tokenIssues,
  exceptions: r.exceptions,
});

/** Write ops as one change and say what happened, for Claude to relay. */
/** Applies the font upgrade when a layered design system lacks font roles (one undoable change of its own). */
export function upgradeTypographyFirst(ctx) {
  const t = typographyUpgrade(ctx.root, ws.TEMPLATE_DIR);
  if (t) write(ctx, { title: t.title, ops: t.ops, by: "engine" });
}

/** What the Upgrade button would do: "layers", "typography" or false. */
export function upgradeKind(root, config = loadConfig(root)) {
  if (!Array.isArray(config.layers)) return "layers";
  try {
    if (typographyUpgrade(root, ws.TEMPLATE_DIR)) return "typography";
    return componentRefresh(root, ws.TEMPLATE_DIR).ops.length ? "components" : false;
  } catch { return false; }
}

const write = (ctx, args) => {
  const r = ws.change(ctx.root, args);
  ctx.notify();
  return { ...r, written: true, undo: "The user can press Undo in the UI, or ask you (tool: undo).", unsaved: ws.unsavedChanges(ctx.root).length };
};

export const TOOLS = [
  {
    name: "status",
    description: "Summary of the design system in this folder: brands, components, unsaved changes, the last change (what undo would take back), latest versions, checks, dependencies, last test run, and the local UI and Storybook URLs. Call this first.",
    inputSchema: { type: "object", properties: {} },
    run: async (_a, ctx) => {
      if (!existsSync(join(ctx.root, "design-system.json"))) return { workspace: ctx.root, exists: false, next: "Call create_design_system to scaffold a new design system here.", ui: ctx.ui.url };
      const checks = runChecks(ctx.root);
      const config = loadConfig(ctx.root);
      return { exists: true, ...ws.summary(ctx.root), layers: config.layers?.map((l) => l.id) ?? null, upgradeAvailable: upgradeKind(ctx.root, config), gate: checks.gate, checks: checks.summary, warnings: checks.warnings, ui: ctx.ui.url, storybook: ctx.storybook.url, dependenciesInstalled: ctx.deps.installed, tests: ctx.tests.last ?? null };
    },
  },
  {
    name: "create_design_system",
    description: "Scaffold a new design system in the current folder from the template (shadcn/ui base with status colors, Storybook, GitHub Pages workflow with tests) and make the first version. Then customise it with change.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Product or design system name" },
        brand: { type: "string", description: "First brand id, lowercase kebab-case, e.g. acme" },
        context: { type: "string", enum: ["mobile-app", "saas-dashboard", "e-commerce", "marketing-site"] },
      },
      required: ["name", "brand", "context"],
    },
    run: (a, ctx) => { const v = ws.initWorkspace(ctx.root, { name: a.name, brand: a.brand, context: a.context, naming: "shadcn" }); ctx.notify(); return { version: v, next: "Call install_dependencies, then change to set the brand's tokens and guidelines." }; },
  },
  {
    name: "install_dependencies",
    description: "Run npm install in the design system folder and fetch the test browser (needed once before Storybook and tests). Takes 1–3 minutes.",
    inputSchema: { type: "object", properties: {} },
    run: async (_a, ctx) => { requireWorkspace(ctx.root); return ctx.deps.install(); },
  },
  {
    name: "get_tokens",
    description: "All tokens for one brand with values per mode (light = default). Use names exactly as returned when writing components (bg-<name>, text-<name>). Fonts named in font tokens load automatically (Google Fonts).",
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
    name: "change",
    description: "Change the design system now: the files are written at once, CSS and fonts regenerate, and the user sees it in the UI immediately (they can undo it). Ops: set a token value (per mode, optionally its opacity), delete, rename (aliases and component utilities are rewritten), or write a whole file (guidelines, component files, design-system.json). Nothing is written if an op is invalid or the change would break a token reference. Returns reminders (they never block): contrast that fails after the change, contrast it fixed, role colors that look alike, and guideline prose that still describes an old value (fix that prose in a follow-up change). Read the guidelines first and keep the change consistent with them. Do not save a version: the user decides when.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short imperative summary, shown in the UI and in Undo, e.g. 'Warm up the primary color'" },
        ops: { type: "array", items: OP_SCHEMA, minItems: 1 },
      },
      required: ["title", "ops"],
    },
    run: (a, ctx) => { requireWorkspace(ctx.root); return write(ctx, { title: a.title, ops: a.ops, by: "claude" }); },
  },
  {
    name: "undo",
    description: "Take back the newest change that has not been undone yet (any change: from you, from the UI, or from the engine). Refuses if one of its files was edited since. Saved versions are not affected; use restore_version to go back further.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, ctx) => { requireWorkspace(ctx.root); const r = ws.undo(ctx.root); ctx.notify(); return { ...r, next: ws.lastChange(ctx.root)?.title ?? null }; },
  },
  {
    name: "add_palette_color",
    description: "Add a color to the palette (bottom layer): from one color, the engine generates a full 50–950 scale shaped like Tailwind's, with the given color on its nearest step. Written at once. Then point roles at it, e.g. {color.lacquer-red.600}.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Palette name, kebab-case, e.g. lacquer-red" }, color: { type: "string", description: "Any CSS color: #d42515, oklch(0.55 0.2 27) …" } }, required: ["name", "color"] },
    run: (a, ctx) => {
      requireWorkspace(ctx.root);
      const p = paletteColorOps(ctx.root, { name: a.name, value: a.color, templateDir: ws.TEMPLATE_DIR });
      const r = write(ctx, { title: `${p.replacing ? "Replace" : "Add"} ${p.name} in the palette`, ops: p.ops, by: "engine" });
      return { ...r, name: p.name, anchor: p.anchor, shades: p.shades };
    },
  },
  {
    name: "set_style",
    description: "Change the overall look in one step, the way the UI's Style step does: main color (a palette family such as teal, or a gray family for black and white), grays (a gray family: slate, gray, zinc, neutral, stone …), corners (a preset: square, slight, round, pill; then outer and inner separately as radius steps, and fitInside: parts inside a rounded container take its corners minus the gap) and fonts. Fonts are layered: font (the text font, Google Fonts family; code follows it), headingFont (a family for headings and titles, or \"\" for the same as text) and labelFont (\"body\" or \"heading\": what buttons, tabs, badges and labels follow). A new family joins the palette; roles point at it. Roles are re-pointed at palette steps the engine picks for readable text. Written at once; undoable. Prefer this over hand-made ops for these choices.",
    inputSchema: {
      type: "object",
      properties: {
        brand: { type: "string", description: "Brand id; default: the default brand" },
        main: { type: "string" }, gray: { type: "string" },
        corners: { type: "string", enum: ["square", "slight", "round", "pill"] },
        outer: { type: "string", description: "Outer corners (cards, dialogs, menus): a radius step, e.g. none, sm, md, lg, xl, 2xl, 3xl" },
        inner: { type: "string", description: "Inner corners (buttons, fields, tabs bar): a radius step, e.g. none, sm, md, lg, full" },
        fitInside: { type: "boolean", description: "Parts inside a rounded container (tabs, menu options, close buttons) take its corners minus the gap, so the space between stays even (default true)" },
        font: { type: "string", description: "Text font, a Google Fonts family, e.g. Inter, Nunito, Geist" },
        headingFont: { type: "string", description: "Headings font, e.g. Playfair Display, Source Serif 4; \"\" for the same as the text font" },
        labelFont: { type: "string", enum: ["body", "heading"], description: "Buttons and labels follow the text font (body) or the headings font (heading)" },
      },
    },
    run: (a, ctx) => {
      requireWorkspace(ctx.root);
      const config = loadConfig(ctx.root);
      const brand = a.brand ?? config.defaultBrand ?? listBrands(ctx.root, config)[0];
      // headingFont "" is a choice (same as text); the others count when given.
      const pick = Object.fromEntries(["main", "gray", "corners", "outer", "inner", "fitInside", "font", "headingFont", "labelFont"].filter((k) => a[k] !== undefined && (a[k] !== "" || k === "headingFont")).map((k) => [k, a[k]]));
      if (!Object.keys(pick).length) throw new Error("set_style needs main, gray, corners, outer, inner, fitInside, font, headingFont or labelFont");
      // Chart colors follow a new main color or grays while still the ones Plinth made.
      const ops = [...styleOps(ctx.root, brand, pick), ...chartFollowOps(ctx.root, brand, { main: pick.main, gray: pick.gray })];
      if (!ops.length) return { title: styleTitle(pick), files: [], unchanged: true, style: readStyle(ctx.root, brand) };
      return { ...write(ctx, { title: styleTitle(pick), ops, by: a.by ?? "claude" }), style: readStyle(ctx.root, brand) };
    },
  },
  {
    name: "set_glass",
    description: "Tune the glass material (frosted panels over imagery; the Glass component and anything using material-glass), the way the UI's glass tool does: preset (clear, regular, frosted) as a starting point, tint (a color role, e.g. popover, background, card, primary; text on glass follows its -foreground role), tintOpacity (0–1), blur (px, 0–64), saturation (1 = unchanged, up to 3), highlight (edge light, 0–1), distortion (ripple, 0–1, Chromium only). Returns how its text reads over a black and a white backdrop in each mode (needs 4.5:1). Written at once; undoable.",
    inputSchema: {
      type: "object",
      properties: {
        brand: { type: "string", description: "Brand id for the roles; default: the default brand" },
        preset: { type: "string", enum: ["clear", "regular", "frosted"] },
        tint: { type: "string" }, tintOpacity: { type: "number" }, blur: { type: "number" }, saturation: { type: "number" }, highlight: { type: "number" }, distortion: { type: "number" },
        title: { type: "string" },
      },
    },
    run: (a, ctx) => {
      requireWorkspace(ctx.root);
      const config = loadConfig(ctx.root);
      const brand = a.brand ?? config.defaultBrand ?? listBrands(ctx.root, config)[0];
      if (a.preset && !GLASS_PRESETS[a.preset]) throw new Error(`no glass preset ${a.preset}`);
      const change = { ...(a.preset ? GLASS_PRESETS[a.preset] : {}), ...Object.fromEntries(["tint", "tintOpacity", "blur", "saturation", "highlight", "distortion"].filter((k) => a[k] !== undefined).map((k) => [k, a[k]])) };
      const ops = glassOps(ctx.root, brand, change);
      const title = a.title || (a.preset ? `Glass: ${a.preset}` : "Glass settings");
      const result = ops.length ? write(ctx, { title, ops, by: a.by ?? "claude" }) : { title, files: [], unchanged: true };
      const g = readGlass(ctx.root);
      return { ...result, glass: g, contrast: g ? glassContrast(ctx.root, brand, { tint: g.tint, foreground: g.foreground, tintOpacity: g.recipe.tintOpacity }) : [] };
    },
  },
  {
    name: "make_chart_colors",
    description: "Make the chart colors from the palette (what the Chart component's series use: chart-1…8 for categories, chart-seq-1…7 for low to high values, chart-div-1…7 around a middle): series start from the main color and each next one stays furthest from the others for normal vision and protan, deutan and tritan deficiencies, at a step that reads 3:1 on the page. Overwrites chart colors someone picked by hand. Returns the colors, how many series stay apart for everyone, and what does not. Written at once; undoable.",
    inputSchema: { type: "object", properties: { brand: { type: "string", description: "Brand id; default: every brand" } } },
    run: (a, ctx) => {
      requireWorkspace(ctx.root);
      const config = loadConfig(ctx.root);
      const brands = a.brand ? [a.brand] : listBrands(ctx.root, config);
      const ops = brands.flatMap((b) => chartOps(ctx.root, b));
      const result = ops.length ? write(ctx, { title: "Chart colors made from the palette", ops, by: a.by ?? "claude" }) : { title: "Chart colors made from the palette", files: [], unchanged: true };
      return { ...result, chart: Object.fromEntries(brands.map((b) => [b, chartView(ctx.root, b)])) };
    },
  },
  {
    name: "set_role_color",
    description: "Point one color role (primary, destructive, border …) at a palette step in one mode, the way the UI's Components step does when a base color is clicked. The other mode moves to the same family at the step it already uses, so light and dark stay one color. Every component using the role changes. Written at once; undoable. Prefer this over hand-made ops for re-pointing a role.",
    inputSchema: {
      type: "object",
      properties: {
        brand: { type: "string", description: "Brand id; default: the default brand" },
        role: { type: "string", description: "Role name, e.g. primary" },
        color: { type: "string", description: "Palette step, e.g. blue.600, or white / black" },
        mode: { type: "string", enum: ["default", "dark"], description: "default (light) or dark; default: default" },
        title: { type: "string", description: "Change title; default: '<role> → <color>'" },
      },
      required: ["role", "color"],
    },
    run: (a, ctx) => {
      requireWorkspace(ctx.root);
      const config = loadConfig(ctx.root);
      const brand = a.brand ?? config.defaultBrand ?? listBrands(ctx.root, config)[0];
      const ops = roleColorOps(ctx.root, brand, { role: a.role, color: a.color, mode: a.mode ?? "default" });
      const title = a.title || `${a.role} → ${a.color}${a.mode === "dark" ? " (dark)" : ""}`;
      if (!ops.length) return { title, files: [], unchanged: true };
      return write(ctx, { title, ops, by: a.by ?? "claude" });
    },
  },
  {
    name: "add_component",
    description: "Add a component from Plinth's ready-made catalog (button, input, textarea, label, checkbox, radio-group, select, switch, alert, badge, toast, tooltip, card, tabs, dialog, separator, glass, chart): its code, story, spec, component tokens and the icons it uses, in the design system's style at once, as one undoable change. Free and instant: always prefer this over writing a component the catalog has.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Catalog id, e.g. dialog" } }, required: ["name"] },
    run: (a, ctx) => {
      requireWorkspace(ctx.root);
      // Catalog components take their text from text styles: a design system from before those upgrades first.
      upgradeTypographyFirst(ctx);
      const pkgs = ws.missingPackages(ctx.root, a.name);
      const r = write(ctx, { title: `Add ${componentName(a.name)}`, ops: ws.catalogComponentOps(ctx.root, a.name), by: a.by ?? "claude" });
      // A package the component needs that this design system does not have yet (a chart needs Recharts).
      if (!ws.addPackages(ctx.root, pkgs)) return r;
      ctx.deps?.install?.().catch(() => {});
      ctx.notify();
      return { ...r, packages: pkgs, message: `Added ${componentName(a.name)}. Installing ${Object.keys(pkgs).join(", ")} for it (about a minute); its preview shows after that.` };
    },
  },
  {
    name: "find_icons",
    description: "Search the icon set Plinth ships (Lucide, about 1,900 icons) by words, e.g. \"calendar\", \"arrow left\", \"warning\". Local, no network. Returns icon names and which ones the design system already has.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: (a, ctx) => {
      const have = new Set(existsSync(join(ctx.root, "design-system.json")) ? listIcons(ctx.root) : []);
      return { set: iconSet().name, results: findIcons(a.query).map((name) => ({ name, inDesignSystem: have.has(name), import: `${name.split("-").map((s) => s[0].toUpperCase() + s.slice(1)).join("")}Icon` })) };
    },
  },
  {
    name: "add_icons",
    description: "Add icons from the shipped set to the design system's icons/ folder; components then import them from \"@/icons\" (check.svg → CheckIcon). Never import an icon package in a component. Written at once; undoable.",
    inputSchema: { type: "object", properties: { names: { type: "array", items: { type: "string" }, description: "Icon names from find_icons, e.g. [\"calendar\", \"arrow-left\"]" } }, required: ["names"] },
    run: (a, ctx) => {
      requireWorkspace(ctx.root);
      const ops = addIconOps(ctx.root, a.names ?? []);
      if (!ops.length) return { title: "Add icons", files: [], unchanged: true, note: "They are already in icons/." };
      return write(ctx, { title: `Add icon${ops.length > 1 ? "s" : ""}: ${ops.map((o) => o.file.replace(/^icons\/|\.svg$/g, "")).join(", ")}`, ops, by: a.by ?? "claude" });
    },
  },
  {
    name: "remove_component",
    description: "Remove a component: its folder (code, story, spec) and its token file, as one change Undo can take back. Refused for a component that other code imports (the Foundations pages, other components). Ask the user before removing.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Component folder name, e.g. date-picker" } }, required: ["name"] },
    run: (a, ctx) => {
      requireWorkspace(ctx.root);
      return write(ctx, { title: `Remove ${componentName(a.name)}`, ops: ws.removeComponentOps(ctx.root, a.name), by: a.by ?? "claude" });
    },
  },
  {
    name: "upgrade_to_layers",
    description: "For a design system made by an older Plinth: upgrade it. Before layers: the Tailwind palette, component tokens and the layer list. Before font roles: fonts in the palette, font roles (headings, text, buttons and labels, code), text styles and a text token for every component part. After that: what newer components use (tokens the design system lacks, such as corners that fit inside) and newer component files. Component files are rewritten only while exactly as Plinth shipped them. Written at once; undoable.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, ctx) => {
      requireWorkspace(ctx.root);
      const p = upgradeProposal(ctx.root, ws.TEMPLATE_DIR);
      if (p) {
        // The font part needs layers: it follows as its own change.
        const r = write(ctx, { title: p.title, ops: p.ops, by: "engine" });
        const t = typographyUpgrade(ctx.root, ws.TEMPLATE_DIR);
        if (!t) return { ...r, kept: p.kept, about: p.rationale };
        return { ...write(ctx, { title: t.title, ops: t.ops, by: "engine" }), kept: [...p.kept, ...t.kept], references: t.references, about: `${p.rationale} ${t.rationale}` };
      }
      const t = typographyUpgrade(ctx.root, ws.TEMPLATE_DIR);
      if (!t) {
        const c = componentRefresh(ctx.root, ws.TEMPLATE_DIR);
        if (!c.ops.length) return { message: "Already up to date.", kept: c.kept };
        return { ...write(ctx, { title: "Newer versions of components you have not changed", ops: c.ops, by: "engine" }), updated: c.updated, kept: c.kept, about: `Adds what newer components use (text and corner settings) and updates ${c.updated.length} component file${c.updated.length === 1 ? "" : "s"} that were exactly as Plinth shipped them.${c.kept.length ? ` Kept as they are because they were edited: ${c.kept.join(", ")}.` : ""}` };
      }
      return { ...write(ctx, { title: t.title, ops: t.ops, by: "engine" }), kept: t.kept, references: t.references, about: t.rationale };
    },
  },
  {
    name: "link_to_palette",
    description: "Point fixed role colors at the visually identical palette color (ΔE under 0.04), so they follow the palette. Colors without a close match are listed and left alone. Written at once; undoable.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, ctx) => {
      requireWorkspace(ctx.root);
      const { ops, unmatched, reason } = linkToPaletteOps(ctx.root);
      if (!ops.length) return { message: reason ?? "Nothing to link.", unmatched };
      return { ...write(ctx, { title: `Link ${ops.length} color value${ops.length > 1 ? "s" : ""} to the palette`, ops: ops.map(({ why, ...o }) => o), by: "engine" }), linked: ops.map((o) => o.why), unmatched };
    },
  },
  {
    name: "run_checks",
    description: "Deterministic checks: token references (broken ones break the CSS and stop publishing), WCAG contrast for every brand × mode, role colors that look alike, layer structure, and hardcoded values in components. Everything except broken references is a reminder; hardcoded values in components also stop the deploy on GitHub. Fast.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, ctx) => {
      requireWorkspace(ctx.root);
      const r = runChecks(ctx.root);
      return { gate: r.gate, summary: r.summary, warnings: r.warnings, ...failures(r) };
    },
  },
  {
    name: "run_tests",
    description: "The workspace's own tests: TypeScript check and every story's interaction and accessibility tests in a browser (npm run typecheck, npm test). Takes about a minute; needs install_dependencies. Run after creating or changing a component.",
    inputSchema: { type: "object", properties: {} },
    run: async (_a, ctx) => { requireWorkspace(ctx.root); return ctx.tests.run(); },
  },
  {
    name: "fix_contrast",
    description: "Fix every failing contrast pair deterministically (moves the foreground along its palette hue, or adjusts OKLCH lightness for fixed values; never edits the palette). Written at once as one change; undoable.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, ctx) => {
      requireWorkspace(ctx.root);
      const { contrast } = runChecks(ctx.root);
      const { ops, skipped } = contrastFixes(contrast);
      if (!ops.length) return { message: "Nothing to fix.", skipped };
      return { ...write(ctx, { title: `Fix contrast (${ops.length} pair${ops.length > 1 ? "s" : ""})`, ops: ops.map(({ why, ...o }) => o), by: "engine" }), fixes: ops.map((o) => o.why), skipped };
    },
  },
  {
    name: "review_changes",
    description: "Everything that changed since the last publish (or since the first version), unsaved work included: every token whose value differs, per brand and mode, before → after as written and as resolved, plus the other files that changed. For reviewing consistency before a publish.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, ctx) => { requireWorkspace(ctx.root); return ws.changesSince(ctx.root); },
  },
  {
    name: "save_version",
    description: "Save every unsaved change as one version (a git commit). Only when the user asks you to; they usually save from the UI.",
    inputSchema: { type: "object", properties: { message: { type: "string", description: "What changed, in a few words" } }, required: ["message"] },
    run: (a, ctx) => { requireWorkspace(ctx.root); const r = ws.saveVersion(ctx.root, a.message); ctx.notify(); return r; },
  },
  {
    name: "list_versions",
    description: "Saved versions, newest first (published: already on GitHub), and the files changed since the last one.",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
    run: (a, ctx) => ({ unsaved: ws.unsavedChanges(ctx.root), versions: ws.versions(ctx.root, a.limit ?? 30) }),
  },
  {
    name: "restore_version",
    description: "Return the design system to an earlier version. Creates a new version; history is kept. Refuses while there are unsaved changes.",
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
    description: "Start the workspace's Storybook (component previews in the UI). Returns its URL.",
    inputSchema: { type: "object", properties: {} },
    run: async (_a, ctx) => { requireWorkspace(ctx.root); return ctx.storybook.start(); },
  },
  {
    name: "open_ui",
    description: "URL of the local Plinth UI (tokens, components, guidelines, checks, history, publish). Give it to the user.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, ctx) => ({ url: ctx.ui.url }),
  },
  {
    name: "publish",
    description: "Publish saved versions: run the checks the deploy runs and the tests, write exports/<brand>/DESIGN.md, push to GitHub (creates the repo on first publish) and enable GitHub Pages for Storybook. Requires saved work (no unsaved changes) and the GitHub CLI signed in. Only call when the user asked to publish; they can also press Publish in the UI.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name for the first publish; ignored when a remote exists" },
        visibility: { type: "string", enum: ["private", "public"], description: "First publish only. Default private." },
        dryRun: { type: "boolean", description: "Run every step except pushing and enabling Pages" },
      },
    },
    run: async (a, ctx) => { requireWorkspace(ctx.root); return ctx.publish.start(a); },
  },
  {
    name: "deploy_status",
    description: "What GitHub did with the last publish: the push only starts the deploy workflow, which runs plinth check, the typecheck and every story test on Linux, and puts Storybook online only if they pass. Returns status (waiting, running, live, failed), the failing step and story tests, and the run link. Call it after publishing, and before fixing a failed deploy: a story test can pass locally and fail on GitHub (timing during animations), so fix the cause, not only the local run.",
    inputSchema: { type: "object", properties: {} },
    run: async (_a, ctx) => { requireWorkspace(ctx.root); return (await deployStatus(ctx.root)) ?? { status: "not published", next: "Publish first." }; },
  },
];

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));
