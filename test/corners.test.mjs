// Corners: outer and inner set apart, parts inside a rounded container fitting its corners (its radius minus the
// gap, so the space between stays even), and a 0.7.0 design system brought up to date without touching edits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import * as ws from "../engine/workspace.mjs";
import { componentRefresh, typographyUpgrade } from "../engine/upgrade.mjs";
import { readStyle, styleOps } from "../engine/style.mjs";
import { resolveBrand } from "../engine/tokens.mjs";
import { checkRepo } from "../engine/check.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const radius = (root, key) => resolveBrand(root, "c").tokens.find((t) => t.key === key).values.default;

test("corners: outer and inner apart; parts inside fit the container's corners minus the gap", (t) => {
  const root = mkdtempSync(join(tmpdir(), "plinth-corners-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "C", brand: "c" });
  const st = readStyle(root, "c");
  assert.deepEqual([st.corners, st.outer, st.inner, st.fitInside], ["round", "xl", "lg", true]);
  // The tab bar is an inner control (lg, 8px) with a 4px gap: tabs inside get 4px. Options: 8 − 4 − 1px border.
  assert.equal(radius(root, "tabs/trigger/radius").css, "max(0px, calc(var(--tabs-radius) - var(--spacing) * 1))");
  assert.equal(radius(root, "tabs/trigger/radius").resolved, "4px");
  assert.equal(radius(root, "select/item/radius").resolved, "3px");
  assert.equal(radius(root, "dialog/close/radius").resolved, "4px", "never below the small corners");

  ws.change(root, { title: "corners", ops: styleOps(root, "c", { outer: "3xl", inner: "md" }), by: "test" });
  assert.deepEqual(((s) => [s.corners, s.outer, s.inner])(readStyle(root, "c")), ["custom", "3xl", "md"]);
  assert.equal(radius(root, "tabs/trigger/radius").resolved, "2px", "6px bar, 4px gap");
  assert.equal(radius(root, "dialog/close/radius").resolved, "7px", "24px dialog, 16px + 1px from its corner");
  assert.throws(() => styleOps(root, "c", { outer: "huge" }), /no radius step/);

  ws.change(root, { title: "own", ops: styleOps(root, "c", { fitInside: false }), by: "test" });
  assert.equal(readStyle(root, "c").fitInside, false);
  assert.equal(radius(root, "tabs/trigger/radius").css, "var(--control-radius)", "their own corners again");
  assert.deepEqual(styleOps(root, "c", { outer: "3xl", inner: "md", fitInside: false }), [], "nothing to change");
  const css = readFileSync(join(root, "src/styles/tokens.css"), "utf8");
  assert.match(css, /--radius-tabs-trigger: var\(--tabs-trigger-radius\);/);
  assert.doesNotMatch(css, /--radius-fit-inside/, "the switch is not a corner utility");
});

test("components refresh: a 0.7.0 design system gets corners that fit; edited components stay", (t) => {
  let tar;
  try {
    execFileSync("git", ["rev-parse", "--verify", "v0.7.0"], { cwd: repo, stdio: "ignore" });
    tar = execFileSync("git", ["archive", "--format=tar", "v0.7.0", "template"], { cwd: repo, maxBuffer: 256 * 1024 * 1024 });
  } catch { t.skip("needs this repository's history (tag v0.7.0)"); return; }
  const dir = mkdtempSync(join(tmpdir(), "plinth-refresh-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "old.tar"), tar);
  execFileSync("tar", ["-xf", "old.tar"], { cwd: dir });
  const root = join(dir, "ws");
  ws.initWorkspace(root, { name: "Old", brand: "c", templateDir: join(dir, "template") });
  const select = join(root, "src/components/select/select.tsx");
  writeFileSync(select, readFileSync(select, "utf8").replace("min-w-32", "min-w-40"));

  assert.equal(typographyUpgrade(root, ws.TEMPLATE_DIR), null, "fonts are already layered");
  const r = componentRefresh(root, ws.TEMPLATE_DIR);
  assert.deepEqual(r.kept, ["src/components/select/select.tsx"]);
  assert.ok(r.updated.includes("src/components/tabs/tabs.tsx"));
  ws.change(root, { title: "refresh", ops: r.ops, by: "test" });
  assert.equal(componentRefresh(root, ws.TEMPLATE_DIR).ops.length, 0, "offered once");
  assert.equal(radius(root, "tabs/trigger/radius").resolved, "4px");
  assert.equal(readStyle(root, "c").fitInside, true);
  const check = checkRepo(root);
  assert.equal(check.ok, true, JSON.stringify(check.blocking));
  assert.ok(check.reminders.nestedCorners.some((x) => x.startsWith("src/components/select/select.tsx") && /rounded-select/.test(x)), "the kept select's nested corners are a reminder");
});
