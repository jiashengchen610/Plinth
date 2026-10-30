// `plinth status` for a product repo: its copies compared with the design system's update record, file by file,
// with the versions (and notes) in between; --diff fetches the changed files and diffs them. The design system is a
// local folder here; over HTTPS only the transport differs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as ws from "../engine/workspace.mjs";
import { writeUpdateRecord, contentHash } from "../engine/record.mjs";
import { compareStatus, statusMarkdown, SOURCE_FILE } from "../engine/status.mjs";
import { status, readSource } from "../server/status.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const append = (file, text) => writeFileSync(file, readFileSync(file, "utf8") + text);

/** A design system folder with one saved version and its record, and a product folder that took three files. */
function setUp(t) {
  const ds = mkdtempSync(join(tmpdir(), "plinth-status-ds-"));
  const prod = mkdtempSync(join(tmpdir(), "plinth-status-prod-"));
  t.after(() => { rmSync(ds, { recursive: true, force: true }); rmSync(prod, { recursive: true, force: true }); });
  const v1 = ws.initWorkspace(ds, { name: "Source", brand: "acme" });
  const record = writeUpdateRecord(ds);
  const take = (from, to = from) => { mkdirSync(dirname(join(prod, to)), { recursive: true }); copyFileSync(join(ds, from), join(prod, to)); return [to, { from, hash: record.files[from].hash }]; };
  const files = Object.fromEntries([
    take("src/components/button/button.tsx"),
    take("WRITING.md", "docs/WRITING.md"),
    take("tokens/base.tokens.json"),
  ]);
  writeFileSync(join(prod, SOURCE_FILE), JSON.stringify({ source: ds, version: v1, files }, null, 2));
  return { ds, prod, v1 };
}

test("status: up to date right after taking the files", async (t) => {
  const { prod } = setUp(t);
  const r = await status(prod);
  assert.equal(r.name, "Source");
  assert.equal(r.upToDate, true);
  assert.equal(r.since.length, 0);
  assert.deepEqual(r.files.map((f) => f.state), ["unchanged", "unchanged", "unchanged"]);
  assert.ok(r.notTaken.length > 100, "the design system has many files this repo did not take");
  assert.match(statusMarkdown(r), /No new version since/);
});

test("status: upstream, local and two-sided changes, with the version and note that changed each file", async (t) => {
  const { ds, prod, v1 } = setUp(t);
  // The design system changes the button and the writing guide, and saves a version with a note.
  append(join(ds, "src/components/button/button.tsx"), "\n// rounder\n");
  append(join(ds, "WRITING.md"), "\nSay what happens next.\n");
  const { version: v2 } = ws.saveVersion(ds, "Rounder buttons and clearer labels");
  writeUpdateRecord(ds);
  // The product edits its button (so both sides changed it) and its tokens (only here).
  append(join(prod, "src/components/button/button.tsx"), "\n// product tweak\n");
  append(join(prod, "tokens/base.tokens.json"), "\n");

  const r = await status(prod, { diff: true });
  const by = Object.fromEntries(r.files.map((f) => [f.path, f]));
  assert.equal(by["src/components/button/button.tsx"].state, "both");
  assert.equal(by["src/components/button/button.tsx"].version, v2);
  assert.equal(by["src/components/button/button.tsx"].note, "Rounder buttons and clearer labels");
  assert.equal(by["docs/WRITING.md"].state, "upstream");
  assert.equal(by["docs/WRITING.md"].from, "WRITING.md");
  assert.equal(by["tokens/base.tokens.json"].state, "local");
  assert.equal(by["tokens/base.tokens.json"].version, undefined);
  assert.equal(r.taken, v1);
  assert.equal(r.latest.short, v2);
  assert.deepEqual(r.since.map((v) => v.subject), ["Rounder buttons and clearer labels"]);
  assert.equal(r.upToDate, false);
  // The diff shows the design system's change, fetched into .ds/upstream.
  assert.ok(existsSync(join(prod, ".ds", "upstream", "WRITING.md")));
  assert.match(r.diffs["docs/WRITING.md"], /^\+Say what happens next\.$/m);
  assert.match(r.diffs["src/components/button/button.tsx"], /^\+\/\/ rounder$/m);
  assert.match(r.diffs["src/components/button/button.tsx"], /^-\/\/ product tweak$/m);
  assert.equal(r.diffs["tokens/base.tokens.json"], undefined, "a file changed only here has nothing to fetch");
  const md = statusMarkdown(r, r.diffs);
  assert.match(md, /## 1 version since\n\n- \w{7} \d{4}-\d{2}-\d{2} Rounder buttons and clearer labels/);
  assert.match(md, /## Changed in the design system \(take it\?\) · 1\n\n- docs\/WRITING\.md — version \w{7}: Rounder buttons and clearer labels \(from WRITING\.md\)/);
  assert.match(md, /## Changed on both sides \(merge\) · 1/);
  assert.match(md, /## Changed here only \(keep it\?\) · 1/);
  assert.match(md, /```diff/);
});

test("compareStatus: files the design system removed, copies this repo lost, and an unknown version", () => {
  const record = { name: "S", version: { short: "bbbbbbb", sha: "b".repeat(40) }, versions: [{ short: "bbbbbbb", sha: "b".repeat(40), date: "2026-10-30T00:00:00Z", subject: "Two" }, { short: "aaaaaaa", sha: "a".repeat(40), date: "2026-10-29T00:00:00Z", subject: "One" }], files: { "a.txt": { hash: "sha256:1", version: "aaaaaaa" } } };
  const source = { source: "x", version: "zzzzzzz", files: { "a.txt": { hash: "sha256:1" }, "gone.txt": { hash: "sha256:2" } } };
  const r = compareStatus(source, record, { "a.txt": null, "gone.txt": "sha256:2" });
  assert.equal(r.versionKnown, false);
  assert.equal(r.since.length, 2, "an unknown version lists every version");
  assert.deepEqual(r.files.map((f) => f.state), ["missing", "removed"]);
  assert.match(statusMarkdown(r), /not in the design system's record/);
});

test("plinth status from the command line, and a clear message when the folder is not connected", (t) => {
  const { prod } = setUp(t);
  const out = execFileSync(process.execPath, [join(repo, "server", "cli.mjs"), "status", prod, "--json"], { encoding: "utf8" });
  assert.equal(JSON.parse(out).upToDate, true);
  const empty = mkdtempSync(join(tmpdir(), "plinth-status-none-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [join(repo, "server", "cli.mjs"), "status", empty], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not connected to a design system/);
  assert.throws(() => readSource(empty), /plinth-source\.json/);
});

test("contentHash of a copy equals the record's hash for that file", (t) => {
  const { ds, prod } = setUp(t);
  const record = JSON.parse(readFileSync(join(ds, "exports", "update.json"), "utf8"));
  assert.equal(contentHash(readFileSync(join(prod, "docs", "WRITING.md"))), record.files["WRITING.md"].hash);
});
