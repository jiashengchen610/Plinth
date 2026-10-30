// The update record (exports/update.json): the saved versions with their notes and a hash per file, deterministic,
// written by publish and by `plinth record` (the deploy workflow rewrites it on a clean checkout).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as ws from "../engine/workspace.mjs";
import { updateRecord, writeUpdateRecord, RECORD_FILE, contentHash } from "../engine/record.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

test("update record: the saved versions with their notes, a hash and the last version per file, deterministic", (t) => {
  const root = mkdtempSync(join(tmpdir(), "plinth-record-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = ws.initWorkspace(root, { name: "Record", brand: "acme" });

  const a = updateRecord(root);
  assert.equal(a.name, "Record");
  assert.deepEqual(a.brands, ["acme"]);
  assert.equal(a.version.short, first);
  assert.equal(a.versions.length, 1);
  assert.match(a.files["tokens/base.tokens.json"].hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(a.files["tokens/base.tokens.json"].version, first);
  assert.ok(a.files["src/components/button/button.tsx"], "components are listed");
  assert.ok(a.files["WRITING.md"], "guidelines are listed");
  assert.ok(a.files["src/styles/tokens.css"], "the generated styles are listed");
  assert.ok(!a.files["package.json"], "only what a product may take");
  assert.ok(!a.files[".github/workflows/storybook.yml"]);
  assert.deepEqual(updateRecord(root), a, "the same commit gives the same record");

  // A saved version with a note: the record carries the note, and only the files it changed move to it.
  writeFileSync(join(root, "WRITING.md"), readFileSync(join(root, "WRITING.md"), "utf8") + "\nError messages say what to do next.\n");
  const { version: second } = ws.saveVersion(root, "Friendlier error messages");
  const b = updateRecord(root);
  assert.equal(b.versions[0].subject, "Friendlier error messages");
  assert.equal(b.versions[0].short, second);
  assert.equal(b.version.short, second);
  assert.equal(b.files["WRITING.md"].version, second);
  assert.notEqual(b.files["WRITING.md"].hash, a.files["WRITING.md"].hash);
  assert.equal(b.files["tokens/base.tokens.json"].version, first);
  assert.equal(b.files["tokens/base.tokens.json"].hash, a.files["tokens/base.tokens.json"].hash);

  // Written into exports/ and never listed in itself; Plinth's own publish commit is not one of the user's versions.
  const written = writeUpdateRecord(root);
  assert.ok(existsSync(join(root, RECORD_FILE)));
  assert.deepEqual(JSON.parse(readFileSync(join(root, RECORD_FILE), "utf8")), written);
  assert.ok(!written.files[RECORD_FILE]);
  ws.gitCommit(root, "Publish: update exports", ["exports"]);
  const c = updateRecord(root);
  assert.equal(c.versions.length, 2);
  assert.equal(c.version.short, second);
  assert.ok(!c.files[RECORD_FILE]);
});

test("contentHash ignores line endings, so Windows and Linux checkouts agree", () => {
  assert.equal(contentHash(Buffer.from("a\r\nb\r\n")), contentHash(Buffer.from("a\nb\n")));
  assert.notEqual(contentHash(Buffer.from("a\n")), contentHash(Buffer.from("b\n")));
});

test("plinth record writes the record; the deploy workflow rewrites it and ships exports/ with the site", (t) => {
  const root = mkdtempSync(join(tmpdir(), "plinth-record-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "Cli", brand: "acme" });
  const out = execFileSync(process.execPath, [join(repo, "server", "cli.mjs"), "record", root, "--json"], { encoding: "utf8" });
  const record = JSON.parse(out);
  assert.equal(record.name, "Cli");
  assert.ok(Object.keys(record.files).length > 20);
  assert.ok(existsSync(join(root, RECORD_FILE)));
  const workflow = readFileSync(join(root, ".github", "workflows", "storybook.yml"), "utf8");
  assert.match(workflow, /fetch-depth: 0/, "the whole history, so the record lists every version");
  assert.match(workflow, /Plinth#v\d+\.\d+\.\d+ record/, "the workflow rewrites the record");
  assert.match(workflow, /cp -r exports site\/exports/, "the exports travel with the site");
});
