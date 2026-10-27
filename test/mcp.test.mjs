// End-to-end test of the MCP server against a fresh workspace (no npm install needed).
// Run: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
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

test("MCP server: create, propose, apply, restore, fix contrast, export, publish dry run", async (t) => {
  const ws = mkdtempSync(join(tmpdir(), "plinth-ws-"));
  const s = startServer(ws);
  t.after(() => { s.stop(); rmSync(ws, { recursive: true, force: true }); });

  const init = await s.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  assert.equal(init.result.serverInfo.name, "plinth");
  const list = await s.request("tools/list", {});
  const names = list.result.tools.map((x) => x.name);
  for (const n of ["status", "create_design_system", "propose_change", "apply_change", "run_checks", "run_tests", "publish"]) assert.ok(names.includes(n), `missing tool ${n}`);

  assert.equal((await s.call("status")).exists, false);
  const created = await s.call("create_design_system", { name: "Acme Money", brand: "acme", context: "mobile-app" });
  assert.match(created.version, /^[0-9a-f]{7}$/);

  const status = await s.call("status");
  assert.equal(status.exists, true);
  assert.deepEqual(status.brands, ["acme"]);
  assert.equal(status.gate, true, JSON.stringify(status.checks));
  assert.equal(status.checks.distinct.ok, true);

  // Fonts load from tokens: the generated loader names the template's family.
  assert.match(readFileSync(join(ws, "src/styles/fonts.css"), "utf8"), /fonts\.googleapis\.com\/css2\?family=Geist:wght@/);
  assert.match(readFileSync(join(ws, "src/index.css"), "utf8"), /@import "\.\/styles\/fonts\.css"/);

  const tokens = await s.call("get_tokens");
  const primary = tokens.tokens.find((x) => x.name === "primary");
  assert.ok(primary.values.default && primary.values.dark);
  assert.ok(tokens.tokens.some((x) => x.name === "success-foreground"), "status colors ship with the template");

  // A change that gives the primary a hue and deliberately breaks dark-mode contrast.
  const proposed = await s.call("propose_change", {
    title: "Give the primary a teal hue",
    rationale: "Brand asked for a calmer, friendlier feel.",
    ops: [
      { op: "set", file: "brands/acme/tokens.json", path: "color/primary", value: "oklch(0.55 0.12 190)" },
      { op: "set", file: "brands/acme/tokens.json", path: "color/muted-foreground", mode: "dark", value: "oklch(0.4 0 0)" },
    ],
  });
  assert.ok(proposed.id);
  assert.ok(proposed.preview.contrastChanges.length > 0);
  assert.ok(proposed.preview.failingAfter > 0, "preview should show the broken dark contrast");
  assert.deepEqual(proposed.preview.distinctFailures, [], "teal primary is distinguishable from every status color");
  assert.equal((await s.call("list_pending_changes")).length, 1);

  // Nothing is written before apply.
  assert.doesNotMatch(readFileSync(join(ws, "brands/acme/tokens.json"), "utf8"), /0\.55 0\.12 190/);
  const applied = await s.call("apply_change", { id: proposed.id });
  assert.match(applied.version, /^[0-9a-f]{7}$/);
  assert.match(readFileSync(join(ws, "src/styles/tokens.css"), "utf8"), /--primary: oklch\(0\.55 0\.12 190\)/);

  const checks = await s.call("run_checks");
  assert.equal(checks.gate, false);
  assert.ok(checks.contrastFailures.some((f) => f.fg === "muted-foreground" && f.mode === "dark"));

  // Deterministic contrast repair.
  const fixes = await s.call("propose_contrast_fixes");
  assert.ok(fixes.id, JSON.stringify(fixes));
  await s.call("apply_change", { id: fixes.id });
  assert.equal((await s.call("run_checks")).gate, true);

  // Distinct roles: a primary that is the destructive red is flagged in the preview, and the prose note
  // points at the guideline that still describes the old hue.
  const same = await s.call("propose_change", {
    title: "Make the primary red",
    ops: [{ op: "set", file: "brands/acme/tokens.json", path: "color/primary", value: "oklch(0.5 0.22 27)" }],
  });
  assert.ok(same.preview.distinctFailures.some((d) => d.a === "primary" && d.b === "destructive" && !d.pass), JSON.stringify(same.preview.distinctFailures));
  await s.call("discard_change", { id: same.id });
  const prose = await s.call("propose_change", {
    title: "Describe the teal primary",
    ops: [{ op: "write", file: "brands/acme/DESIGN.md", content: "# Acme\n\nCalm money app.\n\n## Overview\n\nThe teal primary signals calm.\n" }],
  });
  await s.call("apply_change", { id: prose.id });
  const toPurple = await s.call("propose_change", {
    title: "Make the primary purple",
    ops: [{ op: "set", file: "brands/acme/tokens.json", path: "color/primary", value: "oklch(0.5 0.16 300)" }],
  });
  assert.ok(toPurple.preview.notes.some((n) => /brands\/acme\/DESIGN\.md \(Overview\) still says "teal" but primary is now purple/.test(n)), JSON.stringify(toPurple.preview.notes));
  await s.call("discard_change", { id: toPurple.id });

  // Rename follows into components: bg-primary → bg-brand in button.tsx, primary-foreground untouched.
  const renamed = await s.call("propose_change", {
    title: "Rename primary to brand",
    ops: [{ op: "rename", file: "brands/acme/tokens.json", path: "color/primary", to: "color/brand" }],
  });
  assert.ok(renamed.preview.files.includes("src/components/button/button.tsx"), JSON.stringify(renamed.preview.files));
  await s.call("apply_change", { id: renamed.id });
  const button = readFileSync(join(ws, "src/components/button/button.tsx"), "utf8");
  assert.match(button, /bg-brand/);
  assert.doesNotMatch(button, /bg-primary(?![\w-])/);
  assert.match(button, /text-primary-foreground/, "a sibling token with a longer name is not touched");
  assert.match(readFileSync(join(ws, "src/styles/tokens.css"), "utf8"), /--brand: oklch/);
  // and back, so the rest of the test sees shadcn names
  const back = await s.call("propose_change", { title: "Rename brand back", ops: [{ op: "rename", file: "brands/acme/tokens.json", path: "color/brand", to: "color/primary" }] });
  await s.call("apply_change", { id: back.id });

  // Versions and restore.
  const versions = await s.call("list_versions");
  assert.equal(versions.length, 6);
  const restored = await s.call("restore_version", { version: versions[5].short });
  assert.ok(restored.version);
  assert.doesNotMatch(readFileSync(join(ws, "brands/acme/tokens.json"), "utf8"), /0\.55 0\.12 190/);
  assert.equal((await s.call("list_versions")).length, 7, "restore adds a commit instead of rewriting history");

  // Second brand through a write op on design-system.json + brand files.
  const cfg = JSON.parse(readFileSync(join(ws, "design-system.json"), "utf8"));
  cfg.brands.push({ id: "kids", name: "Acme Kids" });
  const kidsTokens = readFileSync(join(ws, "brands/acme/tokens.json"), "utf8").replace(/oklch\(0\.205 0 0\)/, "oklch(0.55 0.2 300)");
  const brandChange = await s.call("propose_change", {
    title: "Add the Acme Kids brand",
    ops: [
      { op: "write", file: "brands/kids/tokens.json", content: kidsTokens },
      { op: "write", file: "brands/kids/DESIGN.md", content: "# Acme Kids\n\nPlayful and bright.\n\n## Overview\n\nPlayful, bright, rounded.\n\n## Do's and Don'ts\n\n- Do use big touch targets.\n" },
      { op: "write", file: "design-system.json", content: JSON.stringify(cfg, null, 2) },
    ],
  });
  await s.call("apply_change", { id: brandChange.id });
  assert.deepEqual((await s.call("status")).brands, ["acme", "kids"]);
  const css = readFileSync(join(ws, "src/styles/tokens.css"), "utf8");
  assert.match(css, /\[data-brand="kids"\] \{/);
  assert.match(css, /\[data-brand="kids"\]\.dark \{/);

  // DESIGN.md export merges shared + brand prose and generates YAML.
  const md = await s.call("export_design_md", { brand: "kids" });
  assert.match(md.text, /^---\nversion: "alpha"\nname: Acme Kids/);
  assert.match(md.text, /colors:\n(\s{2}.+\n)*\s{2}primary: "?#/);
  assert.match(md.text, /- Do use big touch targets\./);
  assert.match(md.text, /- Do use semantic tokens/);

  // Invalid paths are refused.
  await assert.rejects(s.call("propose_change", { title: "x", ops: [{ op: "write", file: "../evil.txt", content: "x" }] }), /may not touch/);
  await assert.rejects(s.call("propose_change", { title: "x", ops: [{ op: "write", file: "package.json", content: "{}" }] }), /may not touch/);

  // HTTP API: token required, state reflects the workspace.
  const ui = (await s.call("open_ui")).url;
  assert.match(ui, /^http:\/\/localhost:\d+\/$/);
  const api = (path, body) => fetch(new URL(path, ui), { method: body ? "POST" : "GET", headers: { "X-Plinth-Token": "test-token", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await fetch(new URL("api/state", ui))).status, 401);
  let st = await (await api("api/state")).json();
  assert.deepEqual(st.brands, ["acme", "kids"]);
  assert.equal(st.checks.gate, true);
  assert.ok(st.tokens.kids.rows.length > 10);
  assert.deepEqual(Object.keys(st.deps).sort(), ["error", "installed", "installing"]);
  assert.equal(st.publish.running, false);

  // Exceptions: a failing check the user accepts stops blocking the gate and is listed.
  const breakIt = await s.call("propose_change", { title: "Low-contrast muted text", ops: [{ op: "set", file: "brands/kids/tokens.json", path: "color/muted-foreground", value: "oklch(0.8 0 0)" }] });
  await s.call("apply_change", { id: breakIt.id });
  const failing = (await s.call("run_checks")).contrastFailures;
  assert.ok(failing.length >= 2 && failing.every((f) => f.fg === "muted-foreground"), JSON.stringify(failing));
  // One exception for a decorative role covers every brand, mode and background it sits on.
  assert.equal((await api("api/exceptions", { check: "contrast", key: "*|*|*|muted-foreground", reason: "decorative text" })).status, 200);
  const after = await s.call("run_checks");
  assert.equal(after.gate, true, JSON.stringify(after.summary));
  assert.equal(after.exceptions.length, 1);
  assert.equal(after.summary.contrast.accepted, failing.length);
  st = await (await api("api/state")).json();
  assert.ok(st.checks.contrast.some((c) => c.accepted && c.exceptionReason === "decorative text"));
  assert.equal((await api("api/exceptions/remove", { check: "contrast", key: "*|*|*|muted-foreground" })).status, 200);
  assert.equal((await s.call("run_checks")).gate, false);
  assert.equal((await api("api/exceptions", { check: "contrast", key: "nonsense" })).status, 400);
  await api("api/exceptions", { check: "contrast", key: "*|*|*|muted-foreground", reason: "decorative text" });

  // Publish dry run: checks pass, exports written and committed, tests skipped (no node_modules), nothing pushed.
  // (continued below)
  const pub = await s.call("publish", { dryRun: true });
  assert.equal(pub.dryRun, true, JSON.stringify(pub));
  assert.ok(existsSync(join(ws, "exports/acme/DESIGN.md")));
  assert.ok(existsSync(join(ws, "exports/kids/DESIGN.md")));
  assert.ok(pub.steps.find((x) => x.name === "tests")?.detail?.skipped, "tests are skipped without dependencies, and say so");
  st = await (await api("api/state")).json();
  assert.equal(st.publish.result.dryRun, true);
});

test("MCP server in child mode: tools over the UI's workspace, long processes forwarded to the parent", async (t) => {
  const ws = mkdtempSync(join(tmpdir(), "plinth-child-"));
  const parent = startServer(ws, { PLINTH_PORT: "4392" });
  t.after(() => { parent.stop(); rmSync(ws, { recursive: true, force: true }); });
  await parent.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  const ui = (await parent.call("open_ui")).url;

  // The nested instance: no UI of its own, same workspace, parent reachable only for install/Storybook/tests.
  const child = startServer(ws, { PLINTH_CHILD: "1", PLINTH_PARENT_URL: ui, PLINTH_PARENT_TOKEN: "test-token", PLINTH_PORT: "4393" });
  t.after(() => child.stop());
  await child.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude", version: "0" } });
  assert.equal((await child.call("open_ui")).url, ui, "the child hands out the parent's UI");
  assert.equal((await child.call("status")).exists, false);
  // Scaffolding runs git synchronously right after the connection was set up: must not take the process down.
  const created = await child.call("create_design_system", { name: "Child Made", brand: "acme", context: "marketing-site" });
  assert.match(created.version, /^[0-9a-f]{7}$/);
  const status = await child.call("status");
  assert.equal(status.exists, true);
  assert.equal(status.storybook, null);
  assert.equal(status.dependenciesInstalled, false);
  const sb = await child.call("start_storybook");
  assert.equal(sb.started, false, JSON.stringify(sb));
  assert.match(sb.error, /not installed/);
  const tests = await child.call("run_tests");
  assert.match(tests.error, /not installed/);
  // The parent sees the workspace the child created.
  const st = await (await fetch(new URL("api/state", ui), { headers: { "X-Plinth-Token": "test-token" } })).json();
  assert.equal(st.exists, true);
  assert.deepEqual(st.brands, ["acme"]);
  assert.equal(child.stderr().includes("Assertion"), false, child.stderr());
});
