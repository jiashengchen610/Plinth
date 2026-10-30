// `plinth connect`: a product repo takes files from a design system, gets plinth-source.json, the CLAUDE.md rules
// and (optionally) the session hook; later connects take more, take newer versions, or mark files merged by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as ws from "../engine/workspace.mjs";
import { writeUpdateRecord } from "../engine/record.mjs";
import { composeDesignMd } from "../engine/design-md.mjs";
import { resolveTake, localPath, withClaudeSection, withHook, claudeMdSection } from "../engine/connect.mjs";
import { connect, connectMarkdown } from "../server/connect.mjs";
import { status } from "../server/status.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const append = (file, text) => writeFileSync(file, readFileSync(file, "utf8") + text);

/** A design system with its DESIGN.md export and update record, as a publish leaves it, and an empty product folder. */
function setUp(t) {
  const ds = mkdtempSync(join(tmpdir(), "plinth-connect-ds-"));
  const prod = mkdtempSync(join(tmpdir(), "plinth-connect-prod-"));
  t.after(() => { rmSync(ds, { recursive: true, force: true }); rmSync(prod, { recursive: true, force: true }); });
  ws.initWorkspace(ds, { name: "Source", brand: "acme" });
  mkdirSync(join(ds, "exports", "acme"), { recursive: true });
  writeFileSync(join(ds, "exports", "acme", "DESIGN.md"), composeDesignMd(ds, "acme"));
  ws.gitCommit(ds, "Publish: update exports", ["exports"]);
  const record = writeUpdateRecord(ds);
  return { ds, prod, record };
}

test("connect: a first connect takes the guidelines and styles, writes plinth-source.json, CLAUDE.md and .gitignore", async (t) => {
  const { ds, prod, record } = setUp(t);
  assert.ok(record.files["exports/acme/DESIGN.md"], "the export is in the record");
  assert.ok(record.packages.react, "the record names the packages the components need");
  const r = await connect(prod, { source: ds });
  assert.equal(r.first, true);
  assert.deepEqual([...r.took].sort(), ["DESIGN.md", "WRITING.md", "src/styles/fonts.css", "src/styles/tokens.css"]);
  assert.equal(readFileSync(join(prod, "DESIGN.md"), "utf8"), readFileSync(join(ds, "exports", "acme", "DESIGN.md"), "utf8"));
  const source = JSON.parse(readFileSync(join(prod, "plinth-source.json"), "utf8"));
  assert.equal(source.source, ds);
  assert.equal(source.version, record.version.short);
  assert.equal(source.files["DESIGN.md"].from, "exports/acme/DESIGN.md");
  assert.equal(source.files["DESIGN.md"].hash, record.files["exports/acme/DESIGN.md"].hash);
  assert.equal(source.files["src/styles/tokens.css"].version, record.files["src/styles/tokens.css"].version);
  const claude = readFileSync(join(prod, "CLAUDE.md"), "utf8");
  assert.match(claude, /## Design system \(Source\)/);
  assert.match(claude, /status --diff/);
  assert.match(claude, /wait for their decision/);
  assert.match(readFileSync(join(prod, ".gitignore"), "utf8"), /^\.ds\/$/m);
  assert.equal(r.claudeMd, "created");
  assert.equal(r.hook, false);
  assert.deepEqual(Object.keys(r.packages), [], "no components taken, no package list");
  assert.ok(r.available.components > 20 && r.available.icons > 0 && r.available.tokens > 0);
  assert.equal(r.available.guidelines, undefined, "everything in a taken group is taken");
  const md = connectMarkdown(r);
  assert.match(md, /# Connected to Source at version \w{7}/);
  assert.match(md, /Also available: .*components \(\d+ files, `--take components`\)/);
  // Right after connecting, status is up to date.
  assert.equal((await status(prod)).upToDate, true);
});

test("connect: later connects take more (one component, the icons), keep one CLAUDE.md section, and list the packages", async (t) => {
  const { ds, prod } = setUp(t);
  await connect(prod, { source: ds });
  const own = "# My product\n\nRules of this repo.\n";
  writeFileSync(join(prod, "CLAUDE.md"), own + readFileSync(join(prod, "CLAUDE.md"), "utf8"));
  const r = await connect(prod, { source: ds, take: ["components/button", "icons"] });
  assert.equal(r.first, false);
  assert.ok(r.took.includes("src/components/button/button.tsx"));
  assert.ok(r.took.includes("src/icons/index.tsx"));
  assert.ok(r.took.some((f) => /^icons\/.+\.svg$/.test(f)));
  assert.ok(r.packages["radix-ui"], "components need their packages");
  const claude = readFileSync(join(prod, "CLAUDE.md"), "utf8");
  assert.ok(claude.startsWith(own), "the product's own rules stay first");
  assert.equal(claude.match(/<!-- plinth:design-system -->/g).length, 1, "one section");
  assert.equal(JSON.parse(readFileSync(join(prod, "plinth-source.json"), "utf8")).files["DESIGN.md"].from, "exports/acme/DESIGN.md", "earlier entries kept");
});

test("connect: the session hook is added once and kept current", async (t) => {
  const { ds, prod } = setUp(t);
  mkdirSync(join(prod, ".claude"), { recursive: true });
  writeFileSync(join(prod, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Bash(npm test)"] }, hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }] } }));
  await connect(prod, { source: ds, hook: true });
  await connect(prod, { source: ds, hook: true, take: ["WRITING.md"] });
  const settings = JSON.parse(readFileSync(join(prod, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(settings.permissions, { allow: ["Bash(npm test)"] }, "other settings untouched");
  const commands = settings.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
  assert.equal(commands.length, 2);
  assert.equal(commands[0], "echo hi");
  assert.match(commands[1], /^npx -y github:jiashengchen610\/Plinth#v\d+\.\d+\.\d+ status$/);
});

test("connect: --take brings the design system's newer version; --mark records a file merged by hand", async (t) => {
  const { ds, prod } = setUp(t);
  await connect(prod, { source: ds, take: ["guidelines", "components/button"] });
  // The design system changes the writing guide and the button, and saves a version.
  append(join(ds, "WRITING.md"), "\nSay what happens next.\n");
  append(join(ds, "src/components/button/button.tsx"), "\n// rounder\n");
  ws.saveVersion(ds, "Rounder buttons");
  writeUpdateRecord(ds);
  // The product had changed its button too.
  append(join(prod, "src/components/button/button.tsx"), "\n// product tweak\n");
  let s = await status(prod);
  let by = Object.fromEntries(s.files.map((f) => [f.path, f.state]));
  assert.equal(by["WRITING.md"], "upstream");
  assert.equal(by["src/components/button/button.tsx"], "both");
  // The person decides: take the guide, merge the button by hand.
  const r = await connect(prod, { source: ds, take: ["WRITING.md"], mark: ["src/components/button/button.tsx"] });
  assert.deepEqual(r.took, ["WRITING.md"]);
  assert.deepEqual(r.marked, ["src/components/button/button.tsx"]);
  assert.match(readFileSync(join(prod, "WRITING.md"), "utf8"), /Say what happens next/);
  assert.match(readFileSync(join(prod, "src/components/button/button.tsx"), "utf8"), /product tweak/, "marking never overwrites");
  s = await status(prod);
  by = Object.fromEntries(s.files.map((f) => [f.path, f.state]));
  assert.equal(by["WRITING.md"], "unchanged");
  assert.equal(by["src/components/button/button.tsx"], "local", "merged: differs from the design system by this repo's own change only");
  assert.equal(s.since.length, 0, "the version taken is the current one");
});

test("resolveTake, localPath, withClaudeSection, withHook", () => {
  const record = { brands: ["a", "b"], files: { "exports/a/DESIGN.md": { hash: "1" }, "exports/b/DESIGN.md": { hash: "2" }, "WRITING.md": { hash: "3" }, "src/components/card/card.tsx": { hash: "4" }, "src/components/card/card.stories.tsx": { hash: "5" }, "icons/x.svg": { hash: "6" } } };
  assert.deepEqual(resolveTake(record, ["guidelines"]).map((e) => e.to), ["WRITING.md", "DESIGN.a.md", "DESIGN.b.md"]);
  assert.deepEqual(resolveTake(record, ["components/card"]).map((e) => e.from), ["src/components/card/card.stories.tsx", "src/components/card/card.tsx"]);
  assert.deepEqual(resolveTake(record, ["icons/x.svg,WRITING.md"]).map((e) => e.from), ["WRITING.md", "icons/x.svg"]);
  assert.throws(() => resolveTake(record, ["components/nothing"]), /Not in the design system: components\/nothing/);
  assert.equal(localPath("exports/a/DESIGN.md", ["a"]), "DESIGN.md");
  assert.equal(localPath("exports/a/DESIGN.md", ["a", "b"]), "DESIGN.a.md");
  const section = claudeMdSection({ source: "https://x.test/", name: "X", plinthVersion: "9.9.9" });
  const once = withClaudeSection("# Mine\n", section);
  assert.equal(withClaudeSection(once, section), once, "replacing the section changes nothing when it is current");
  assert.match(withClaudeSection("", section), /^<!-- plinth:design-system -->/);
  const hooked = withHook({}, "npx -y github:jiashengchen610/Plinth#v1.0.0 status");
  assert.equal(withHook(hooked, "npx -y github:jiashengchen610/Plinth#v1.1.0 status").hooks.SessionStart[0].hooks[0].command, "npx -y github:jiashengchen610/Plinth#v1.1.0 status");
});

test("plinth connect from the command line", (t) => {
  const { ds, prod } = setUp(t);
  const out = execFileSync(process.execPath, [join(repo, "server", "cli.mjs"), "connect", ds, prod, "--take", "guidelines", "--json"], { encoding: "utf8" });
  const r = JSON.parse(out);
  assert.deepEqual([...r.took].sort(), ["DESIGN.md", "WRITING.md"]);
  assert.ok(existsSync(join(prod, "plinth-source.json")));
  const text = execFileSync(process.execPath, [join(repo, "server", "cli.mjs"), "status", prod], { encoding: "utf8" });
  assert.match(text, /No new version since/);
});
