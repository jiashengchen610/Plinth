// A round of work: what differs from the published version, per step, so the UI can start the steps over after a
// publish and show what this round changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as ws from "../engine/workspace.mjs";

test("round: nothing before the first publish; after it, changes per step, saved versions counted", (t) => {
  const root = mkdtempSync(join(tmpdir(), "plinth-round-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "R", brand: "r" });
  assert.deepEqual(ws.sincePublish(root), { published: null });

  // Published (the record publish leaves when there is no remote branch).
  const head = ws.versions(root, 1)[0].sha;
  mkdirSync(join(root, ".ds"), { recursive: true });
  writeFileSync(join(root, ".ds", "published.json"), JSON.stringify({ sha: head }));
  assert.deepEqual(ws.sincePublish(root), { published: head, versions: 0, files: 0, steps: { style: false, components: false } });

  ws.change(root, { title: "main", by: "test", ops: [{ op: "set", file: "brands/r/tokens.json", path: "color/primary", value: "{color.violet.700}" }] });
  let r = ws.sincePublish(root);
  assert.equal(r.steps.style, true);
  assert.equal(r.steps.components, false);
  assert.equal(r.versions, 0, "not saved yet");

  ws.saveVersion(root, "Violet main color");
  ws.change(root, { title: "button", by: "test", ops: [{ op: "set", file: "tokens/components/button.tokens.json", path: "button/default/background", value: "{color.card}" }] });
  r = ws.sincePublish(root);
  assert.equal(r.versions, 1);
  assert.deepEqual(r.steps, { style: true, components: true });
});
