// Scaffolding from the template as installed by npm/npx: the install lives under a node_modules folder and
// npm drops .gitignore files from packages. Both must not break a new workspace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, cpSync, existsSync, readFileSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initWorkspace, TEMPLATE_DIR } from "../engine/workspace.mjs";

test("scaffold: template copied from an install under node_modules, with a .gitignore", (t) => {
  const base = mkdtempSync(join(tmpdir(), "plinth-npx-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  // Mimic the npx layout and npm's packing: template under node_modules, .gitignore absent.
  const installed = join(base, "node_modules", "plinth", "template");
  cpSync(TEMPLATE_DIR, installed, { recursive: true });
  if (existsSync(join(installed, ".gitignore"))) rmSync(join(installed, ".gitignore"));
  assert.ok(existsSync(join(installed, "gitignore")), "the template ships its gitignore without the dot");

  const root = join(base, "workspace");
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
