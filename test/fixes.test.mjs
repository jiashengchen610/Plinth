// Fixes from trying 0.6.0: Storybook on a port another Storybook holds, reading why GitHub stopped a deploy, drafts
// the user confirms instead of writing (version descriptions, color names), and shipped template files with a bug.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { freePort, storybookUrl } from "../server/storybook.mjs";
import { failureSummary } from "../server/publish.mjs";
import { colorName } from "../engine/color-names.mjs";
import * as ws from "../engine/workspace.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("storybook: a port held on IPv6 is not free; the URL is the one Storybook printed", async (t) => {
  const held = createServer();
  const ok = await new Promise((res) => { held.once("error", () => res(false)); held.listen(0, "::", () => res(true)); });
  if (!ok) { t.skip("no IPv6 on this machine"); return; }
  t.after(() => held.close());
  const port = held.address().port;
  assert.notEqual(await freePort(port), port, "Storybook listens on ::, so a check on 127.0.0.1 alone is not enough");

  const printed = "\u001b[32m╭───╮\u001b[39m\n│   Storybook 10.6.1 for react-vite started   │\n│   Local:            http://localhost:6008/   │\n│   On your network:  http://192.168.0.2:6008/ │";
  assert.equal(storybookUrl(printed), "http://localhost:6008");
  assert.equal(storybookUrl("Storybook ready"), null);
});

test("deploy: a failed GitHub run is read into the failing step and the story tests that failed", () => {
  // As `gh run view --log-failed` prints it on Windows: tab-separated, color codes written out as ^[.
  const log = [
    "deploy\tRun npm test\t2026-10-27T18:24:23.4866466Z ^[[31m⎯⎯⎯⎯⎯⎯⎯^[[39m^[[1m^[[41m Failed Tests 1 ^[[49m^[[22m",
    "deploy\tRun npm test\t2026-10-27T18:24:23.4879138Z ^[[41m^[[1m FAIL ^[[22m^[[49m ^[[30m^[[45m storybook (chromium) ^[[49m^[[39m src/components/toast/toast.stories.tsx^[[2m > ^[[22mShow And Close",
    "deploy\tRun npm test\t2026-10-27T18:24:23.4970029Z ##[error]Error: ",
    "deploy\tRun npm test\t2026-10-27T18:24:23.6334211Z ##[error]Process completed with exit code 1.",
  ].join("\n");
  assert.deepEqual(failureSummary(log), { step: "Run npm test", failures: ["src/components/toast/toast.stories.tsx › Show And Close"], errors: [] });
  const check = "deploy\tRun plinth check\t2026-10-27T18:24:23.1Z \u001b[31m##[error]tokens/components/chip.tokens.json: reference {color.nope} resolves to nothing\u001b[0m";
  assert.deepEqual(failureSummary(check), { step: "Run plinth check", failures: [], errors: ["tokens/components/chip.tokens.json: reference {color.nope} resolves to nothing"] });
});

test("drafts: a version is described from its changes; a new color gets a name the palette lacks", (t) => {
  const root = join(mkdtempSync(join(tmpdir(), "plinth-drafts-")), "ws");
  t.after(() => rmSync(join(root, ".."), { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "Drafts", brand: "acme", context: "saas-dashboard" });
  assert.equal(ws.versionDraft(ws.changesSinceSave(root)), null, "nothing to describe right after creating");
  ws.change(root, { title: "Main color: rose", ops: [{ op: "set", file: "brands/acme/tokens.json", path: "color/primary", value: "{color.rose.700}" }], by: "test" });
  assert.equal(ws.versionDraft(ws.changesSinceSave(root)), "Main color: rose");
  ws.change(root, { title: "Corners: pill", ops: [{ op: "set", file: "tokens/base.tokens.json", path: "radius/control", value: "{radius.full}" }], by: "test" });
  ws.change(root, { title: "Rounder cards", ops: [{ op: "set", file: "tokens/base.tokens.json", path: "radius/container", value: "{radius.2xl}" }], by: "test" });
  const changes = ws.changesSinceSave(root);
  assert.deepEqual(changes.titles, ["Main color: rose", "Corners: pill", "Rounder cards"]);
  assert.ok(changes.files.includes("brands/acme/tokens.json") && !changes.files.some((f) => f.startsWith("src/styles/")), "generated files are not the user's changes");
  assert.equal(ws.versionDraft(changes), "Main color: rose; Corners: pill and 1 more change");
  ws.saveVersion(root, "Rose and pill");
  assert.equal(ws.versionDraft(ws.changesSinceSave(root)), null, "saving starts the list again");
  writeFileSync(join(root, "WRITING.md"), "# Writing\n\nShort sentences.\n");
  assert.equal(ws.versionDraft(ws.changesSinceSave(root)), "Edits to WRITING.md", "edits made outside Plinth are described by file");

  assert.equal(colorName("#e2725b"), "terracotta");
  assert.equal(colorName("#2f5d50"), "hunter", "a dark green is named as a green, not a gray");
  assert.equal(colorName("#777777"), "steel", "a gray gets a gray name");
  assert.notEqual(colorName("#e2725b", ["terracotta"]), "terracotta", "a name the palette has is not offered again");
});

test("template fixes: a shipped file with a known bug is replaced only while the user never changed it", (t) => {
  let old;
  try { old = execFileSync("git", ["show", "c26a719:template/src/components/toast/toast.stories.tsx"], { cwd: join(here, ".."), encoding: "utf8" }); }
  catch { t.skip("needs the git history of this checkout"); return; }
  const root = join(mkdtempSync(join(tmpdir(), "plinth-tfix-")), "ws");
  t.after(() => rmSync(join(root, ".."), { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "Fix", brand: "acme", context: "saas-dashboard" });
  const file = join(root, "src/components/toast/toast.stories.tsx");
  assert.deepEqual(ws.templateFixOps(root).ops, [], "a new workspace already has the fix");

  writeFileSync(file, old.replace(/\n/g, "\r\n"));
  const fix = ws.templateFixOps(root);
  assert.equal(fix.ops.length, 1, "the 0.6.0 version is recognized, whatever the line endings");
  assert.match(fix.title, /Toast test/);
  ws.change(root, { title: fix.title, ops: fix.ops, by: "Plinth" });
  assert.equal(readFileSync(file, "utf8"), readFileSync(join(ws.TEMPLATE_DIR, "src/components/toast/toast.stories.tsx"), "utf8"));
  ws.undo(root);
  assert.match(readFileSync(file, "utf8"), /toBeVisible\(\);\r?\n/, "Undo brings the old file back");

  writeFileSync(file, old + "\n// my own note\n");
  assert.deepEqual(ws.templateFixOps(root).ops, [], "a file the user changed is left alone");
});
