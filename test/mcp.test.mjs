// End-to-end test of the MCP server against a fresh workspace (no npm install needed).
// Run: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "server", "index.mjs");

function startServer(workspace, extraEnv = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PLINTH_WORKSPACE: workspace, PLINTH_TOKEN: "test-token", PLINTH_PORT: "4390", ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let nextId = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const request = (method, params) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const call = async (name, args = {}) => {
    const r = await request("tools/call", { name, arguments: args });
    const text = r.result.content[0].text;
    if (r.result.isError) throw new Error(text);
    return JSON.parse(text);
  };
  return { child, request, call, stderr: () => stderr, stop: () => child.stdin.end() };
}
const init = (s) => s.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
const read = (ws, f) => readFileSync(join(ws, f), "utf8");

test("MCP server: create, change at once, undo, save, restore, fix contrast, export, review, publish dry run", async (t) => {
  const ws = mkdtempSync(join(tmpdir(), "plinth-ws-"));
  const s = startServer(ws);
  t.after(() => { s.stop(); rmSync(ws, { recursive: true, force: true }); });

  const hello = await init(s);
  assert.equal(hello.result.serverInfo.name, "plinth");
  const names = (await s.request("tools/list", {})).result.tools.map((x) => x.name);
  for (const n of ["status", "create_design_system", "change", "undo", "save_version", "review_changes", "run_checks", "run_tests", "publish"]) assert.ok(names.includes(n), `missing tool ${n}`);
  for (const n of ["propose_change", "apply_change", "list_pending_changes", "record_outside_edits"]) assert.ok(!names.includes(n), `${n} should be gone`);

  assert.equal((await s.call("status")).exists, false);
  const created = await s.call("create_design_system", { name: "Acme Money", brand: "acme", context: "mobile-app" });
  assert.match(created.version, /^[0-9a-f]{7}$/);

  const status = await s.call("status");
  assert.equal(status.exists, true);
  assert.deepEqual(status.brands, ["acme"]);
  assert.equal(status.gate, true, JSON.stringify(status.checks));
  assert.equal(status.unsaved, 0);
  // The workspace no longer ships deny rules: edits from anywhere are checked instead.
  assert.ok(!existsSync(join(ws, ".claude", "settings.json")));
  // The deploy workflow runs `plinth check` from this release.
  assert.match(read(ws, ".github/workflows/storybook.yml"), /npx -y github:jiashengchen610\/Plinth#v\d+\.\d+\.\d+ check/);

  // Fonts load from tokens: the generated loader names the template's family.
  assert.match(read(ws, "src/styles/fonts.css"), /fonts\.googleapis\.com\/css2\?family=Geist:wght@/);
  assert.match(read(ws, "src/index.css"), /@import "\.\/styles\/fonts\.css"/);

  const tokens = await s.call("get_tokens");
  const primary = tokens.tokens.find((x) => x.name === "primary");
  assert.ok(primary.values.default && primary.values.dark);
  assert.ok(tokens.tokens.some((x) => x.name === "success-foreground"), "status colors ship with the template");

  // A change is written at once; its reminders report the dark-mode contrast it breaks, without stopping it.
  const teal = await s.call("change", {
    title: "Give the primary a teal hue",
    ops: [
      { op: "set", file: "brands/acme/tokens.json", path: "color/primary", value: "oklch(0.45 0.1 190)" },
      { op: "set", file: "brands/acme/tokens.json", path: "color/muted-foreground", mode: "dark", value: "oklch(0.4 0 0)" },
    ],
  });
  assert.equal(teal.written, true);
  assert.ok(teal.reminders.contrastFailing.some((f) => f.fg === "muted-foreground" && f.mode === "dark"), JSON.stringify(teal.reminders));
  assert.deepEqual(teal.reminders.lookAlike, [], "teal primary is distinguishable from every status color");
  assert.match(read(ws, "src/styles/tokens.css"), /--primary: oklch\(0\.45 0\.1 190\)/);
  assert.equal((await s.call("status")).lastChange.title, "Give the primary a teal hue");

  const checks = await s.call("run_checks");
  assert.equal(checks.gate, true, "contrast is a reminder, not a gate");
  assert.equal(checks.summary.contrast.ok, false);
  assert.ok(checks.contrastFailures.some((f) => f.fg === "muted-foreground" && f.mode === "dark"));

  // Deterministic contrast repair, written at once.
  const fixes = await s.call("fix_contrast");
  assert.ok(fixes.fixes?.length, JSON.stringify(fixes));
  assert.equal((await s.call("run_checks")).summary.contrast.ok, true);

  // A red primary sits next to the red destructive: a reminder, and Undo takes it back.
  const red = await s.call("change", { title: "Make the primary red", ops: [{ op: "set", file: "brands/acme/tokens.json", path: "color/primary", value: "oklch(0.5 0.22 27)" }] });
  assert.ok(red.reminders.lookAlike.some((d) => d.a === "primary" && d.b === "destructive"), JSON.stringify(red.reminders.lookAlike));
  const undone = await s.call("undo");
  assert.equal(undone.undone, "Make the primary red");
  assert.match(read(ws, "src/styles/tokens.css"), /--primary: oklch\(0\.45 0\.1 190\)/);

  // Guideline prose that still names the old hue comes back as a note.
  await s.call("change", { title: "Describe the teal primary", ops: [{ op: "write", file: "brands/acme/DESIGN.md", content: "# Acme\n\nCalm money app.\n\n## Overview\n\nThe teal primary signals calm.\n" }] });
  const purple = await s.call("change", { title: "Make the primary purple", ops: [{ op: "set", file: "brands/acme/tokens.json", path: "color/primary", value: "oklch(0.5 0.16 300)" }] });
  assert.ok(purple.reminders.guidelineNotes.some((n) => /brands\/acme\/DESIGN\.md \(Overview\) still says "teal" but primary is now purple/.test(n)), JSON.stringify(purple.reminders.guidelineNotes));
  await s.call("undo");

  // Undo refuses to throw away an edit made after the change.
  await s.call("change", { title: "Tweak writing", ops: [{ op: "write", file: "WRITING.md", content: "# Writing\n\nShort sentences.\n" }] });
  writeFileSync(join(ws, "WRITING.md"), "# Writing\n\nEdited by hand afterwards.\n");
  await assert.rejects(s.call("undo"), /changed after "Tweak writing"/);
  writeFileSync(join(ws, "WRITING.md"), "# Writing\n\nShort sentences.\n");
  await s.call("undo");

  // A change that would break a reference writes nothing.
  await assert.rejects(s.call("change", { title: "Broken", ops: [{ op: "set", file: "brands/acme/tokens.json", path: "color/primary", value: "{color.nope.500}" }] }), /Nothing was written/);
  assert.match(read(ws, "src/styles/tokens.css"), /--primary: oklch\(0\.45 0\.1 190\)/);

  // Rename follows the references: component tokens that pointed at primary now point at brand.
  const renamed = await s.call("change", { title: "Rename primary to brand", ops: [{ op: "rename", file: "brands/acme/tokens.json", path: "color/primary", to: "color/brand" }] });
  assert.ok(renamed.files.includes("tokens/components/button.tokens.json"), JSON.stringify(renamed.files));
  assert.ok(!renamed.files.includes("tokens/primitives.tokens.json"), "the palette does not refer to primary");
  const buttonTokens = read(ws, "tokens/components/button.tokens.json");
  assert.match(buttonTokens, /\{color\.brand\}/);
  assert.doesNotMatch(buttonTokens, /\{color\.primary\}/);
  assert.match(buttonTokens, /\{color\.primary-foreground\}/, "a sibling token with a longer name is not touched");
  assert.equal((await s.call("run_checks")).tokenIssues.length, 0, "no reference was left dangling");
  await s.call("change", { title: "Rename brand back", ops: [{ op: "rename", file: "brands/acme/tokens.json", path: "color/brand", to: "color/primary" }] });

  // The review at publish sees everything since the first version: the teal primary, as written and resolved.
  const review = await s.call("review_changes");
  assert.equal(review.since, "the first version");
  const row = review.tokens.find((r) => r.token === "primary" && r.mode === "light");
  assert.equal(row.after.value, "oklch(0.45 0.1 190)", JSON.stringify(review.tokens.slice(0, 3)));
  assert.ok(review.followTheseChanges.count > 0, "component tokens that follow the primary are counted, not listed");
  assert.ok(review.files.some((f) => f.file === "brands/acme/DESIGN.md"));

  // Versions: the user saves; restore needs saved work and adds a version.
  let versions = await s.call("list_versions");
  assert.equal(versions.versions.length, 1);
  assert.ok(versions.unsaved.length > 0);
  const saved = await s.call("save_version", { message: "Teal primary" });
  assert.match(saved.version, /^[0-9a-f]{7}$/);
  versions = await s.call("list_versions");
  assert.deepEqual(versions.unsaved, []);
  assert.equal(versions.versions.length, 2);
  await s.call("change", { title: "Unsaved tweak", ops: [{ op: "write", file: "WRITING.md", content: "# Writing\n\nUnsaved.\n" }] });
  await assert.rejects(s.call("restore_version", { version: versions.versions[1].short }), /unsaved change/);
  await s.call("undo");
  const restored = await s.call("restore_version", { version: versions.versions[1].short });
  assert.ok(restored.version);
  assert.doesNotMatch(read(ws, "brands/acme/tokens.json"), /0\.45 0\.1 190/);
  assert.equal((await s.call("list_versions")).versions.length, 3, "restore adds a version instead of rewriting history");

  // Second brand through write ops on design-system.json + brand files.
  const cfg = JSON.parse(read(ws, "design-system.json"));
  cfg.brands.push({ id: "kids", name: "Acme Kids" });
  const kidsTokens = read(ws, "brands/acme/tokens.json");
  await s.call("change", {
    title: "Add the Acme Kids brand",
    ops: [
      { op: "write", file: "brands/kids/tokens.json", content: kidsTokens },
      { op: "write", file: "brands/kids/DESIGN.md", content: "# Acme Kids\n\nPlayful and bright.\n\n## Overview\n\nPlayful, bright, rounded.\n\n## Do's and Don'ts\n\n- Do use big touch targets.\n" },
      { op: "write", file: "design-system.json", content: JSON.stringify(cfg, null, 2) },
    ],
  });
  assert.deepEqual((await s.call("status")).brands, ["acme", "kids"]);
  const css = read(ws, "src/styles/tokens.css");
  assert.match(css, /\[data-brand="kids"\] \{/);
  assert.match(css, /\[data-brand="kids"\]\.dark \{/);

  // DESIGN.md export merges shared + brand prose and generates YAML.
  const md = await s.call("export_design_md", { brand: "kids" });
  assert.match(md.text, /^---\nversion: "alpha"\nname: Acme Kids/);
  assert.match(md.text, /colors:\n(\s{2}.+\n)*\s{2}primary: "?#/);
  assert.match(md.text, /- Do use big touch targets\./);

  // Invalid paths are refused.
  await assert.rejects(s.call("change", { title: "x", ops: [{ op: "write", file: "../evil.txt", content: "x" }] }), /may not touch/);
  await assert.rejects(s.call("change", { title: "x", ops: [{ op: "write", file: "package.json", content: "{}" }] }), /may not touch/);

  // HTTP API: token required, state reflects the workspace.
  const ui = (await s.call("open_ui")).url;
  assert.match(ui, /^http:\/\/localhost:\d+\/$/);
  const api = (path, body) => fetch(new URL(path, ui), { method: body ? "POST" : "GET", headers: { "X-Plinth-Token": "test-token", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await fetch(new URL("api/state", ui))).status, 401);
  let st = await (await api("api/state")).json();
  assert.deepEqual(st.brands, ["acme", "kids"]);
  assert.equal(st.checks.gate, true);
  assert.ok(st.tokens.kids.rows.length > 10);
  assert.ok(st.unsaved.some((u) => u.file === "brands/kids/tokens.json"));
  assert.equal(st.lastChange.title, "Add the Acme Kids brand");
  assert.equal(st.pending, undefined);

  // Exceptions: a failing check the user accepts stops counting, is listed, and is a change like any other.
  await s.call("change", { title: "Low-contrast muted text", ops: [{ op: "set", file: "brands/kids/tokens.json", path: "color/muted-foreground", value: "oklch(0.8 0 0)" }] });
  const failing = (await s.call("run_checks")).contrastFailures;
  assert.ok(failing.length >= 2 && failing.every((f) => f.fg === "muted-foreground"), JSON.stringify(failing));
  assert.equal((await api("api/exceptions", { check: "contrast", key: "*|*|*|muted-foreground", reason: "decorative text" })).status, 200);
  const after = await s.call("run_checks");
  assert.equal(after.exceptions.length, 1);
  assert.equal(after.summary.contrast.accepted, failing.length);
  st = await (await api("api/state")).json();
  assert.ok(st.checks.contrast.some((c) => c.accepted && c.exceptionReason === "decorative text"));
  assert.equal(st.lastChange.title, "Accept exception: contrast *|*|*|muted-foreground (decorative text)");
  assert.equal((await api("api/exceptions", { check: "contrast", key: "nonsense" })).status, 400);

  // Publish pushes saved versions: unsaved work stops it, then a dry run passes the checks and writes exports.
  const blocked = await s.call("publish", { dryRun: true });
  assert.equal(blocked.stoppedAt, "unsaved", JSON.stringify(blocked));
  assert.equal((await api("api/save", { message: "Kids brand" })).status, 200);
  const pub = await s.call("publish", { dryRun: true });
  assert.equal(pub.dryRun, true, JSON.stringify(pub));
  assert.ok(existsSync(join(ws, "exports/acme/DESIGN.md")));
  assert.ok(existsSync(join(ws, "exports/kids/DESIGN.md")));
  assert.ok(pub.steps.find((x) => x.name === "tests")?.detail?.skipped, "tests are skipped without dependencies, and say so");
  st = await (await api("api/state")).json();
  assert.equal(st.publish.result.dryRun, true);
});

test("one Plinth per folder: a second server forwards its tools to the first, and takes over when it exits", async (t) => {
  const ws = mkdtempSync(join(tmpdir(), "plinth-owner-"));
  const first = startServer(ws, { PLINTH_PORT: "4392" });
  t.after(() => { first.stop(); rmSync(ws, { recursive: true, force: true }); });
  await init(first);
  const ui = (await first.call("open_ui")).url;

  const second = startServer(ws, { PLINTH_PORT: "4393" });
  t.after(() => second.stop());
  await init(second);
  assert.equal((await second.call("open_ui")).url, ui, "the second server hands out the first one's UI");
  assert.equal((await second.call("status")).exists, false);
  // Scaffolding runs git synchronously right after the connection was set up: must not take either process down.
  const created = await second.call("create_design_system", { name: "Second Made", brand: "acme", context: "marketing-site" });
  assert.match(created.version, /^[0-9a-f]{7}$/);
  await second.call("change", { title: "Darker primary", ops: [{ op: "set", file: "brands/acme/tokens.json", path: "color/primary", value: "{color.neutral.950}" }] });
  // One undo history: the first server undoes what the second one changed.
  assert.equal((await first.call("undo")).undone, "Darker primary");
  const sb = await second.call("start_storybook");
  assert.equal(sb.started, false, JSON.stringify(sb));
  assert.match(sb.error, /not installed/);
  const st = await (await fetch(new URL("api/state", ui), { headers: { "X-Plinth-Token": "test-token" } })).json();
  assert.deepEqual(st.brands, ["acme"]);
  assert.match(second.stderr(), /using the Plinth already running/);

  // The first one ends (its Claude Code session closed): the second serves the workspace from now on.
  first.stop();
  await once(first.child, "exit");
  const status = await second.call("status");
  assert.equal(status.exists, true);
  const own = (await second.call("open_ui")).url;
  assert.notEqual(own, ui);
  assert.equal((await fetch(new URL("api/rev", own), { headers: { "X-Plinth-Token": "test-token" } })).status, 200);
  assert.equal(second.stderr().includes("Assertion"), false, second.stderr());
});

test("UI edits: written at once, undo, save version, discard, opacity", async (t) => {
  const ws = mkdtempSync(join(tmpdir(), "plinth-ui-edit-"));
  const s = startServer(ws, { PLINTH_PORT: "4394" });
  t.after(() => { s.stop(); rmSync(ws, { recursive: true, force: true }); });
  await init(s);
  await s.call("create_design_system", { name: "Edits", brand: "acme", context: "saas-dashboard" });
  const ui = (await s.call("open_ui")).url;
  const api = async (path, body) => { const r = await fetch(new URL(path, ui), { method: body ? "POST" : "GET", headers: { "X-Plinth-Token": "test-token", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json() }; };

  const ops = [
    { op: "set", file: "brands/acme/tokens.json", path: "color/primary", value: "{color.red.700}" },
    { op: "set", file: "tokens/components/button.tokens.json", path: "button/destructive/background", alpha: 0.25 },
    { op: "set", file: "tokens/components/button.tokens.json", path: "button/destructive/background", mode: "dark", alpha: 0.4 },
  ];
  const made = await api("api/change", { title: "Red primary, stronger destructive tint", ops });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  assert.ok(made.json.reminders.lookAlike.some((d) => d.a === "primary" && d.b === "destructive"), "red primary next to red destructive is a reminder");
  assert.equal(JSON.parse(read(ws, "brands/acme/tokens.json")).color.primary.$value, "{color.red.700}", "written at once");
  const button = JSON.parse(read(ws, "tokens/components/button.tokens.json"));
  assert.deepEqual(button.button.destructive.background.$extensions.plinth.alpha, { default: 0.25, dark: 0.4 });
  assert.match(read(ws, "src/styles/tokens.css"), /--button-destructive-background: color-mix\(in oklab, var\(--destructive\) 25%, transparent\);/);
  let st = (await api("api/state")).json;
  assert.equal(st.lastChange.by, "you");
  assert.ok(st.unsaved.length >= 2);

  // Undo, then do it again and save it as a version.
  assert.equal((await api("api/undo", {})).json.undone, "Red primary, stronger destructive tint");
  assert.equal(JSON.parse(read(ws, "brands/acme/tokens.json")).color.primary.$value, "{color.neutral.900}");
  assert.equal((await api("api/state")).json.unsaved.length, 0, "undoing the only change leaves nothing unsaved");
  await api("api/change", { title: "Red primary", ops: ops.slice(0, 1) });
  assert.equal((await api("api/save", { message: "" })).status, 400, "a version needs a description");
  const saved = await api("api/save", { message: "Red primary" });
  assert.match(saved.json.version, /^[0-9a-f]{7}$/);
  st = (await api("api/state")).json;
  assert.equal(st.unsaved.length, 0);
  assert.equal(st.versions[0].subject, "Red primary");

  // Opacity back to 100% removes it; discard throws unsaved work away.
  await api("api/change", { title: "Opaque", ops: [{ op: "set", file: "tokens/components/button.tokens.json", path: "button/destructive/background", alpha: 1 }, { op: "set", file: "tokens/components/button.tokens.json", path: "button/destructive/background", mode: "dark", alpha: 1 }] });
  assert.equal(JSON.parse(read(ws, "tokens/components/button.tokens.json")).button.destructive.background.$extensions, undefined);
  writeFileSync(join(ws, "notes.txt"), "scratch\n");
  const discarded = (await api("api/discard", {})).json.discarded;
  assert.ok(discarded.includes("notes.txt") && discarded.includes("tokens/components/button.tokens.json"), JSON.stringify(discarded));
  assert.ok(!existsSync(join(ws, "notes.txt")));
  assert.equal((await api("api/state")).json.unsaved.length, 0);
  // Opacity on a token that does not exist is refused instead of creating an empty one.
  assert.equal((await api("api/change", { title: "x", ops: [{ op: "set", file: "tokens/components/button.tokens.json", path: "button/nope", alpha: 0.5 }] })).status, 400);
});
