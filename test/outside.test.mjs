// Edits made outside Plinth (by hand, another tool, a Claude Code session with full permissions): never folded
// into a Plinth version, listed, blocking publish and restore until recorded or discarded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import * as ws from "../engine/workspace.mjs";
import { publish } from "../server/publish.mjs";

const filesIn = (root, rev) => execFileSync("git", ["show", "--name-only", "--pretty=format:", rev], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);

test("outside edits: kept out of Plinth versions, listed, and gate publish and restore", async (t) => {
  const root = join(mkdtempSync(join(tmpdir(), "plinth-outside-")), "ws");
  t.after(() => rmSync(join(root, ".."), { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "Outside", brand: "acme", context: "saas-dashboard" });
  const first = ws.versions(root)[0].short;
  assert.deepEqual(ws.outsideChanges(root), []);

  // Someone edits a guideline and package.json by hand, and adds a file.
  writeFileSync(join(root, "WRITING.md"), readFileSync(join(root, "WRITING.md"), "utf8") + "\n- Do say thanks.\n");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  pkg.description = "hand edit";
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2));
  writeFileSync(join(root, "notes.txt"), "scratch\n");
  assert.deepEqual(ws.outsideChanges(root).map((o) => `${o.status} ${o.file}`).sort(), ["added notes.txt", "modified WRITING.md", "modified package.json"]);

  // A Plinth change on other files commits only its own files and what it regenerated.
  const c = ws.propose(root, { title: "Bluer primary", ops: [{ op: "set", file: "brands/acme/tokens.json", path: "color/primary", value: "oklch(0.45 0.15 250)" }] });
  ws.apply(root, c.id);
  const applied = filesIn(root, "HEAD");
  assert.ok(applied.includes("brands/acme/tokens.json") && applied.includes("src/styles/tokens.css"), applied.join(", "));
  assert.ok(!applied.includes("WRITING.md") && !applied.includes("package.json") && !applied.includes("notes.txt"), "outside edits stay out");
  assert.equal(ws.outsideChanges(root).length, 3);

  // A change to a file that was edited outside is refused rather than silently including the edit.
  const overlapping = ws.propose(root, { title: "Rewrite writing", ops: [{ op: "write", file: "WRITING.md", content: "# Writing\n" }] });
  assert.throws(() => ws.apply(root, overlapping.id), /WRITING\.md changed outside Plinth/);
  ws.discard(root, overlapping.id);

  // Publish and restore wait.
  const pub = await publish(root, { dryRun: true });
  assert.equal(pub.stoppedAt, "outside edits");
  assert.equal(pub.outside.length, 3);
  assert.throws(() => ws.restore(root, first), /changed outside Plinth/);

  // Record: one version named after the files, marked as outside in History.
  const rec = ws.recordOutside(root, "copy tweaks");
  assert.match(rec.version, /^[0-9a-f]{7}$/);
  assert.deepEqual(ws.outsideChanges(root), []);
  const v = ws.versions(root)[0];
  assert.match(v.subject, /^Outside edits: .*\(copy tweaks\)$/);
  assert.equal(v.outside, true);
  assert.deepEqual(filesIn(root, "HEAD").sort(), ["WRITING.md", "notes.txt", "package.json"]);

  // Discard: back to the last version, added files removed.
  writeFileSync(join(root, "DESIGN.md"), "broken\n");
  writeFileSync(join(root, "extra.txt"), "x\n");
  assert.deepEqual(ws.discardOutside(root).discarded.sort(), ["DESIGN.md", "extra.txt"]);
  assert.deepEqual(ws.outsideChanges(root), []);
  assert.ok(!existsSync(join(root, "extra.txt")));
  assert.notEqual(readFileSync(join(root, "DESIGN.md"), "utf8"), "broken\n");

  // With a clean tree, restore works again and is itself a version.
  assert.match(ws.restore(root, first), /^[0-9a-f]{7}$/);
});
