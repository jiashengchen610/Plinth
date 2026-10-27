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
