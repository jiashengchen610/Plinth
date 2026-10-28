// Scaffolding from the template as installed by npm/npx: the install lives under a node_modules folder and
// npm drops .gitignore files from packages. Both must not break a new workspace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, cpSync, existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { initWorkspace, syncManaged, TEMPLATE_DIR } from "../engine/workspace.mjs";

test("scaffold: template copied from an install under node_modules, with a .gitignore", (t) => {
  const base = mkdtempSync(join(tmpdir(), "plinth-npx-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  // Mimic the npx layout and npm's packing: template under node_modules, .gitignore absent.
  const installed = join(base, "node_modules", "plinth", "template");
  cpSync(TEMPLATE_DIR, installed, { recursive: true });
  if (existsSync(join(installed, ".gitignore"))) rmSync(join(installed, ".gitignore"));
  assert.ok(existsSync(join(installed, "gitignore")), "the template ships its gitignore without the dot");

  // The user's folder exists before Plinth runs (they cd into it), and may hold .ds/ from the chat already.
  const root = join(base, "workspace");
  mkdirSync(join(root, ".ds"), { recursive: true });
  const version = initWorkspace(root, { name: "Npx Check", brand: "acme", context: "marketing-site", templateDir: installed });
  assert.match(version, /^[0-9a-f]{7}$/);
  for (const f of ["design-system.json", "package.json", "package-lock.json", "brands/acme/tokens.json", "src/components/button/button.tsx", ".storybook/preview.tsx", ".github/workflows/storybook.yml", "src/styles/tokens.css", "src/styles/fonts.css", ".gitignore"]) {
    assert.ok(existsSync(join(root, f)), `missing ${f}`);
  }
  assert.ok(!existsSync(join(root, "gitignore")));
  assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /^\.ds\/$/m, ".ds/ (chat, inbox images) stays out of the user's repo");
  assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /^node_modules$/m);
  assert.ok(!readdirSync(root).includes("node_modules"));

  // A second scaffold into the same folder is refused.
  assert.throws(() => initWorkspace(root, { templateDir: installed }), /already contains/);
});

test("no fs.cpSync in engine/ or server/ (aborts Node 24 on Windows for D:\<folder> targets)", () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const dir of ["engine", "server"]) {
    for (const f of readdirSync(join(repo, dir)).filter((n) => n.endsWith(".mjs"))) {
      const src = readFileSync(join(repo, dir, f), "utf8").replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "");
      assert.doesNotMatch(src, /\bcpSync\b/, `${dir}/${f} uses cpSync; use copyDir from engine/workspace.mjs`);
    }
  }
});

test("foundations: generated data for Storybook, managed files restored from the template", (t) => {
  const base = mkdtempSync(join(tmpdir(), "plinth-found-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "ws");
  initWorkspace(root, { name: "Found", brand: "acme", context: "saas-dashboard" });
  const data = JSON.parse(readFileSync(join(root, "src/foundations/tokens.generated.json"), "utf8"));
  assert.equal(data.name, "Found");
  assert.equal(data.defaultBrand, "acme");
  const acme = data.brands.acme;
  assert.deepEqual(acme.modes, ["light", "dark"]);
  const primary = acme.tokens.find((x) => x.name === "primary");
  assert.ok(primary.values.light.resolved && primary.values.dark.resolved);
  assert.ok(acme.contrast.some((c) => c.bg === "primary" && c.fg === "primary-foreground" && c.mode === "dark"));
  for (const f of ["Introduction.mdx", "Colors.mdx", "Typography.mdx", "Shape.mdx", "Guidelines.mdx", "Writing.mdx", "blocks.tsx"]) {
    assert.ok(existsSync(join(root, "src/foundations", f)), `missing ${f}`);
  }
  // A managed file that drifted (older Plinth, or a hand edit) is put back on the next regenerate.
  writeFileSync(join(root, ".storybook/preview.tsx"), "// old\n");
  rmSync(join(root, "src/foundations/Colors.mdx"));
  assert.deepEqual(syncManaged(root).sort(), [".storybook/preview.tsx", "src/foundations/Colors.mdx"]);
  assert.match(readFileSync(join(root, ".storybook/preview.tsx"), "utf8"), /globalsUpdated/);
  assert.deepEqual(syncManaged(root), [], "nothing to do the second time");
});

test("contrast: text on a tint of its own color is checked like the browser test, and fixable", async (t) => {
  const { checkContrast, contrastFixes } = await import("../engine/checks.mjs");
  const ws = await import("../engine/workspace.mjs");
  const root = join(mkdtempSync(join(tmpdir(), "plinth-tint-")), "ws");
  t.after(() => rmSync(join(root, ".."), { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "Tint", brand: "acme", context: "saas-dashboard" });
  // The red a real session chose: passes on the page, fails on its own 10% tint (axe measured 4.28 on that brand).
  // Button and Badge draw destructive text on destructive at 10% through their component tokens.
  const brighter = [{ op: "set", file: "brands/acme/tokens.json", path: "color/destructive", value: "#d42515" }];
  assert.equal(ws.previewOps(root, brighter).failingAfter, 2, "the preview sees both components");
  const c = ws.change(root, { title: "Brighter red", ops: brighter });
  assert.equal(c.reminders.contrastFailing.length, 2, "and so do the change's reminders");
  const failing = checkContrast(root).filter((r) => !r.pass);
  assert.deepEqual(failing.map((r) => `${r.mode} ${r.fg} on ${r.bg}`).sort(), ["default badge-destructive-foreground on badge-destructive-background", "default button-destructive-foreground on button-destructive-background"]);
  assert.ok(failing.every((r) => r.ratio > 4 && r.ratio < 4.5 && r.fgToken === "color/destructive"), JSON.stringify(failing.map((r) => [r.ratio, r.fgToken])));
  const { ops } = contrastFixes(checkContrast(root));
  assert.equal(ops.length, 1, "one fix to the semantic color serves both components");
  ws.change(root, { title: "Fix", ops: ops.map(({ why, ...o }) => o) });
  assert.ok(checkContrast(root).every((r) => r.pass), "after the fix every pair passes, the tints included");

  // Components written by hand with a Tailwind opacity modifier are read from the source.
  writeFileSync(join(root, "src/components/button/note.tsx"), 'export const Note = () => <p className="bg-warning/10 text-warning">Heads up</p>;\n');
  assert.ok(checkContrast(root).some((r) => r.fg === "warning" && r.bg === "warning/10"), "bg-X/NN text-X in component code is checked too");
});

test("palette: a color becomes a Tailwind-shaped scale; fixes move along the palette", async (t) => {
  const { checkContrast, contrastFixes } = await import("../engine/checks.mjs");
  const ws = await import("../engine/workspace.mjs");
  const { paletteColorOps } = await import("../engine/palette.mjs");
  const root = join(mkdtempSync(join(tmpdir(), "plinth-pal-")), "ws");
  t.after(() => rmSync(join(root, ".."), { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "Pal", brand: "acme", context: "saas-dashboard" });
  const p = paletteColorOps(root, { name: "Lacquer Red", value: "#c8102e" });
  assert.equal(p.name, "lacquer-red");
  assert.equal(p.ops.length, 11);
  ws.change(root, { title: "Add lacquer red", ops: p.ops });
  // A semantic role points at a step that is too light for white text; the fix moves it down the same hue.
  ws.change(root, { title: "Red primary", ops: [
    { op: "set", file: "brands/acme/tokens.json", path: "color/primary", value: "{color.lacquer-red.400}" },
    { op: "set", file: "brands/acme/tokens.json", path: "color/primary-foreground", value: "{color.white}" },
  ] });
  const failing = checkContrast(root).filter((r) => !r.pass && r.mode === "default" && r.fg === "primary-foreground");
  assert.ok(failing.length, "white on lacquer-red-400 fails");
  const fix = contrastFixes(checkContrast(root)).ops.find((o) => o.path === "color/primary-foreground" || o.path === "color/primary");
  assert.ok(fix, "a fix is offered");
  assert.match(fix.value, /^\{color\.[a-z-]+(\.\d+)?\}$/, `the fix is a palette reference: ${fix.value}`);
  const css = readFileSync(join(root, "src/styles/tokens.css"), "utf8");
  assert.match(css, /--lacquer-red-500: oklch/);
  assert.match(css, /--primary: var\(--lacquer-red-400\)/);
});

test("changes: guideline notes follow references; undo goes back one change at a time", async (t) => {
  const ws = await import("../engine/workspace.mjs");
  const { paletteColorOps } = await import("../engine/palette.mjs");
  const root = join(mkdtempSync(join(tmpdir(), "plinth-notes-")), "ws");
  t.after(() => rmSync(join(root, ".."), { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "Notes", brand: "acme", context: "saas-dashboard" });
  ws.change(root, { title: "Prose", ops: [{ op: "write", file: "brands/acme/DESIGN.md", content: "# Acme\n\n## Colors\n\nA calm grey primary, neutral everywhere.\n" }] });

  // A palette color, then a role that points at it.
  const pal = ws.change(root, { title: "Add tea", ops: paletteColorOps(root, { name: "tea", value: "#2f5d50" }).ops });
  assert.equal(pal.reminders.guidelineNotes.length, 0, "adding palette steps no role uses says nothing about prose");
  const role = ws.change(root, { title: "Tea primary", ops: [
    { op: "set", file: "brands/acme/tokens.json", path: "color/primary", value: "{color.tea.800}" },
    { op: "set", file: "brands/acme/tokens.json", path: "color/primary-foreground", value: "{color.white}" },
  ] });
  assert.deepEqual(role.reminders.contrastFailing, []);
  // The guideline says grey; the primary is now a green-teal through the palette reference.
  assert.ok(role.reminders.guidelineNotes.some((n) => /says "(grey|neutral)" but primary is now (teal|green)/.test(n)), JSON.stringify(role.reminders.guidelineNotes));

  // Picking the value a token already has writes nothing and leaves nothing to undo.
  const same = ws.change(root, { title: "Same tea", ops: [{ op: "set", file: "brands/acme/tokens.json", path: "color/primary", value: "{color.tea.800}" }] });
  assert.equal(same.unchanged, true);

  // Undo takes changes back newest first, down to the last saved version.
  assert.equal(ws.lastChange(root).title, "Tea primary");
  assert.equal(ws.undo(root).undone, "Tea primary");
  assert.equal(ws.undo(root).undone, "Add tea");
  assert.doesNotMatch(readFileSync(join(root, "src/styles/tokens.css"), "utf8"), /--tea-500/);
  assert.equal(ws.undo(root).undone, "Prose");
  assert.deepEqual(ws.unsavedChanges(root), []);
  assert.throws(() => ws.undo(root), /Nothing to undo/);
});

test("plinth check: blocks broken references, stale generated files and components outside the format", async (t) => {
  const ws = await import("../engine/workspace.mjs");
  const { checkRepo, checkMarkdown } = await import("../engine/check.mjs");
  const root = join(mkdtempSync(join(tmpdir(), "plinth-check-")), "ws");
  t.after(() => rmSync(join(root, ".."), { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "Check", brand: "acme", context: "saas-dashboard" });
  assert.deepEqual(checkRepo(root).blocking, [], "a fresh workspace passes");

  // A token edited by hand and committed without regenerating: the CSS no longer matches.
  const tokensFile = join(root, "brands/acme/tokens.json");
  const original = readFileSync(tokensFile, "utf8");
  writeFileSync(tokensFile, original.replace('"{color.neutral.900}"', '"{color.red.700}"'));
  assert.deepEqual(checkRepo(root).blocking.map((b) => b.kind), ["generated", "generated"], "tokens.css and the Foundations data are stale");
  ws.regenerate(root);
  assert.equal(checkRepo(root).ok, true, "regenerating fixes it");
  // A reference to nothing.
  writeFileSync(tokensFile, original.replace('"{color.neutral.900}"', '"{color.nope.700}"'));
  assert.ok(checkRepo(root).blocking.some((b) => b.kind === "token" && /nope/.test(b.detail)));
  writeFileSync(tokensFile, original);
  ws.regenerate(root);

  // A component written by hand: no story, no component tokens, a hex value.
  mkdirSync(join(root, "src/components/banner"), { recursive: true });
  writeFileSync(join(root, "src/components/banner/banner.tsx"), 'export const Banner = () => <div className="bg-[#ff0000] p-4">Sale</div>;\n');
  const r = checkRepo(root);
  // bg-[#ff0000] is both an arbitrary Tailwind value and a hex literal.
  assert.deepEqual(r.blocking.map((b) => b.kind).sort(), ["component", "component", "hardcoded", "hardcoded"], JSON.stringify(r.blocking));
  assert.match(checkMarkdown(r), /4 problems stop the deploy/);
  // Accepting the hardcoded value as an exception is the escape hatch; structure has none.
  ws.acceptException(root, { check: "hardcoded", key: "src/components/banner/banner.tsx|tw-arbitrary|bg-[#ff0000]", reason: "campaign" });
  ws.acceptException(root, { check: "hardcoded", key: "src/components/banner/banner.tsx|hex-color|#ff0000", reason: "campaign" });
  assert.deepEqual(checkRepo(root).blocking.map((b) => b.kind), ["component", "component"]);
});

test("catalog: components not picked stay out; Add brings one back with its tokens, icons and missing base roles", async (t) => {
  const ws = await import("../engine/workspace.mjs");
  const { checkRepo } = await import("../engine/check.mjs");
  const root = join(mkdtempSync(join(tmpdir(), "plinth-catalog-")), "ws");
  t.after(() => rmSync(join(root, ".."), { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "Catalog", brand: "acme", context: "saas-dashboard", skipComponents: ["dialog", "toast", "tooltip"] });
  const ids = () => ws.listComponents(root).map((c) => c.id);
  assert.ok(ids().includes("switch") && ids().includes("button"));
  assert.ok(!ids().includes("dialog") && !existsSync(join(root, "tokens/components/dialog.tokens.json")), "a component not picked leaves no files");
  assert.deepEqual(checkRepo(root).blocking, [], "a workspace without some catalog components passes");

  // Catalog components lean only on the core ones, which every workspace has.
  const core = ["button", "input", "label", "card", "badge"];
  for (const id of ws.catalogComponents()) {
    const dir = join(TEMPLATE_DIR, "src/components", id);
    for (const f of readdirSync(dir)) {
      for (const m of readFileSync(join(dir, f), "utf8").matchAll(/["']@\/components\/([a-z-]+)/g)) assert.ok(m[1] === id || core.includes(m[1]), `${id}/${f} imports ${m[1]}`);
    }
  }

  // A workspace from before some base roles and icons existed: Add fills in what the component needs.
  const baseFile = join(root, "tokens/base.tokens.json");
  const base = JSON.parse(readFileSync(baseFile, "utf8"));
  delete base.layer; delete base.duration; delete base.radius.small; delete base.ease.enter; delete base.ease.exit;
  writeFileSync(baseFile, JSON.stringify(base, null, 2) + "\n");
  rmSync(join(root, "icons/x.svg"));
  ws.regenerate(root);
  const r = ws.change(root, { title: "Add dialog", ops: ws.catalogComponentOps(root, "dialog"), by: "test" });
  assert.ok(r.files.includes("src/components/dialog/dialog.tsx") && r.files.includes("tokens/components/dialog.tokens.json") && r.files.includes("icons/x.svg"), r.files.join());
  const filled = JSON.parse(readFileSync(baseFile, "utf8"));
  assert.equal(filled.radius.small.$value, "{radius.sm}");
  assert.equal(filled.layer.dialog.$value, 60);
  assert.deepEqual(filled.duration.normal.$value, { value: 200, unit: "ms" });
  assert.deepEqual(filled.ease.enter.$value, [0, 0, 0.2, 1]);
  assert.match(readFileSync(join(root, "src/icons/index.tsx"), "utf8"), /export function XIcon/);
  assert.match(readFileSync(join(root, "src/styles/tokens.css"), "utf8"), /--layer-dialog: 60/);
  assert.deepEqual(checkRepo(root).blocking, [], "the added component resolves");
  assert.throws(() => ws.catalogComponentOps(root, "dialog"), /already in this design system/);
  assert.throws(() => ws.catalogComponentOps(root, "date-picker"), /not in the component catalog/);
  ws.undo(root);
  assert.ok(!existsSync(join(root, "src/components/dialog/dialog.tsx")) && !existsSync(join(root, "icons/x.svg")), "Undo takes it all back");
});

test("icons: the shipped set is searched and vendored into icons/; components import them from @/icons only", async (t) => {
  const ws = await import("../engine/workspace.mjs");
  const icons = await import("../engine/icons.mjs");
  const { checkRepo } = await import("../engine/check.mjs");
  const root = join(mkdtempSync(join(tmpdir(), "plinth-icons-")), "ws");
  t.after(() => rmSync(join(root, ".."), { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "Icons", brand: "acme", context: "saas-dashboard" });
  assert.ok(Object.keys(icons.iconSet().icons).length > 1500);
  assert.ok(icons.findIcons("alert").includes("triangle-alert"));
  assert.equal(icons.findIcons("  ").length, 0);
  assert.ok(icons.setIconSvg("alert-circle"), "aliases resolve");

  const gen = () => readFileSync(join(root, "src/icons/index.tsx"), "utf8");
  assert.match(gen(), /^\/\/ Generated by Plinth/);
  assert.match(gen(), /export function CircleCheckIcon/);
  assert.deepEqual(icons.addIconOps(root, ["check"]), [], "already there");
  assert.throws(() => icons.addIconOps(root, ["hart"]), /No icon "hart".*Close:/);
  ws.change(root, { title: "Add heart", ops: icons.addIconOps(root, ["heart"]), by: "test" });
  assert.match(readFileSync(join(root, "icons/heart.svg"), "utf8"), /<path /);
  assert.match(gen(), /export function HeartIcon\(props: IconProps\)/);
  assert.match(gen(), /"heart": HeartIcon,/);
  assert.ok(icons.listIcons(root).includes("heart"));
  assert.deepEqual(checkRepo(root).blocking, []);

  // A user's own SVG becomes a component too; editing the generated module by hand is caught.
  writeFileSync(join(root, "icons/logo-mark.svg"), '<svg viewBox="0 0 32 32" fill="currentColor" stroke="none"><circle cx="16" cy="16" r="12"/></svg>');
  assert.deepEqual(checkRepo(root).blocking.map((b) => b.kind), ["generated"]);
  ws.regenerate(root);
  assert.match(gen(), /export function LogoMarkIcon\(props: IconProps\) \{\n {2}return <Svg viewBox="0 0 32 32" fill="currentColor" stroke="none" \{\.\.\.props\}><circle cx="16" cy="16" r="12" \/><\/Svg>;/);

  // An icon package in a component stops the deploy.
  const badge = join(root, "src/components/badge/badge.tsx");
  writeFileSync(badge, 'import { X } from "lucide-react";\n' + readFileSync(badge, "utf8"));
  const blocked = checkRepo(root).blocking;
  assert.deepEqual(blocked.map((b) => b.kind), ["icons"], JSON.stringify(blocked));
  assert.match(blocked[0].detail, /lucide-react/);
});

test("deny rules from Plinth before 0.4 are removed; the user's own rules stay", async (t) => {
  const ws = await import("../engine/workspace.mjs");
  const root = join(mkdtempSync(join(tmpdir(), "plinth-deny-")), "ws");
  t.after(() => rmSync(join(root, ".."), { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "Deny", brand: "acme", context: "saas-dashboard" });
  mkdirSync(join(root, ".claude"), { recursive: true });
  const old = ["Edit(/tokens/**)", "Edit(/brands/**)", "Edit(/DESIGN.md)", "Edit(/WRITING.md)", "Edit(/design-system.json)", "Edit(/src/components/**)", "Edit(/src/styles/**)", "Edit(/src/foundations/**)", "Edit(/exports/**)", "Edit(/.storybook/**)", "Edit(/.github/**)", "Edit(/.claude/**)", "Edit(/.ds/**)"];
  writeFileSync(join(root, ".claude/settings.json"), JSON.stringify({ permissions: { deny: old } }));
  ws.regenerate(root);
  assert.ok(!existsSync(join(root, ".claude")), "only Plinth's rules: the file and folder go");
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude/settings.json"), JSON.stringify({ permissions: { deny: [...old, "Bash(rm:*)"] }, model: "sonnet" }));
  ws.regenerate(root);
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8")), { permissions: { deny: ["Bash(rm:*)"] }, model: "sonnet" });
});

test("typography: a part edited by path lands in the composite, and old child entries take effect", async (t) => {
  const ws = await import("../engine/workspace.mjs");
  const root = join(mkdtempSync(join(tmpdir(), "plinth-type-")), "ws");
  t.after(() => rmSync(join(root, ".."), { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "Type", brand: "acme", context: "saas-dashboard" });
  // What a real session did: set the parts that get_tokens lists as their own paths.
  ws.change(root, { title: "Serif headings", ops: [
    { op: "set", file: "tokens/base.tokens.json", path: "typography/display/font-family", value: ["Cormorant Garamond", "serif"] },
    { op: "set", file: "tokens/base.tokens.json", path: "typography/display/font-size", value: { value: 2.75, unit: "rem" } },
  ] });
  const base = JSON.parse(readFileSync(join(root, "tokens/base.tokens.json"), "utf8"));
  assert.deepEqual(base.typography.display.$value.fontFamily, ["Cormorant Garamond", "serif"]);
  assert.equal(base.typography.display["font-family"], undefined, "no child token left behind");
  assert.match(readFileSync(join(root, "src/styles/fonts.css"), "utf8"), /family=Cormorant\+Garamond/);
  assert.match(readFileSync(join(root, "src/styles/tokens.css"), "utf8"), /--display-font: 600 2\.75rem\/1\.15 'Cormorant Garamond', serif;/);

  // A file written before the fix (children inside the composite) is read as intended.
  base.typography.body.md["font-family"] = { $value: ["Work Sans", "sans-serif"] };
  writeFileSync(join(root, "tokens/base.tokens.json"), JSON.stringify(base, null, 2));
  ws.regenerate(root);
  assert.match(readFileSync(join(root, "src/styles/tokens.css"), "utf8"), /--body-md-font-family: 'Work Sans', sans-serif;/);
  assert.match(readFileSync(join(root, "src/styles/fonts.css"), "utf8"), /family=Work\+Sans/);
});
