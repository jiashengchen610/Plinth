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

function startServer(workspace) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PLINTH_WORKSPACE: workspace, PLINTH_TOKEN: "test-token", PLINTH_PORT: "4390" },
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
  for (const n of ["status", "create_design_system", "propose_change", "apply_change", "run_checks", "publish"]) assert.ok(names.includes(n), `missing tool ${n}`);

  assert.equal((await s.call("status")).exists, false);
  const created = await s.call("create_design_system", { name: "Acme Money", brand: "acme", context: "mobile-app" });
  assert.match(created.version, /^[0-9a-f]{7}$/);

  const status = await s.call("status");
  assert.equal(status.exists, true);
  assert.deepEqual(status.brands, ["acme"]);
  assert.equal(status.gate, true, JSON.stringify(status.checks));

  const tokens = await s.call("get_tokens");
  const primary = tokens.tokens.find((x) => x.name === "primary");
  assert.ok(primary.values.default && primary.values.dark);

  // A change that warms the primary and deliberately breaks dark-mode contrast.
  const proposed = await s.call("propose_change", {
    title: "Warm up the primary color",
    rationale: "Brand asked for a warmer, friendlier feel.",
    ops: [
      { op: "set", file: "brands/acme/tokens.json", path: "color/primary", value: "oklch(0.62 0.16 45)" },
      { op: "set", file: "brands/acme/tokens.json", path: "color/muted-foreground", mode: "dark", value: "oklch(0.4 0 0)" },
    ],
  });
  assert.ok(proposed.id);
  assert.ok(proposed.preview.contrastChanges.length > 0);
  assert.ok(proposed.preview.failingAfter > 0, "preview should show the broken dark contrast");
  assert.equal((await s.call("list_pending_changes")).length, 1);

  // Nothing is written before apply.
  assert.doesNotMatch(readFileSync(join(ws, "brands/acme/tokens.json"), "utf8"), /0\.62 0\.16 45/);
  const applied = await s.call("apply_change", { id: proposed.id });
  assert.match(applied.version, /^[0-9a-f]{7}$/);
  assert.match(readFileSync(join(ws, "src/styles/tokens.css"), "utf8"), /--primary: oklch\(0\.62 0\.16 45\)/);

  const checks = await s.call("run_checks");
  assert.equal(checks.gate, false);
  assert.ok(checks.contrastFailures.some((f) => f.fg === "muted-foreground" && f.mode === "dark"));

  // Deterministic contrast repair.
  const fixes = await s.call("propose_contrast_fixes");
  assert.ok(fixes.id, JSON.stringify(fixes));
  await s.call("apply_change", { id: fixes.id });
  assert.equal((await s.call("run_checks")).gate, true);

  // Versions and restore.
  const versions = await s.call("list_versions");
  assert.equal(versions.length, 3);
  const restored = await s.call("restore_version", { version: versions[2].short });
  assert.ok(restored.version);
  assert.doesNotMatch(readFileSync(join(ws, "brands/acme/tokens.json"), "utf8"), /0\.62 0\.16 45/);
  assert.equal((await s.call("list_versions")).length, 4, "restore adds a commit instead of rewriting history");

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

  // Publish dry run: gate passes, exports written and committed, nothing pushed.
  const pub = await s.call("publish", { dryRun: true });
  assert.equal(pub.dryRun, true, JSON.stringify(pub));
  assert.ok(existsSync(join(ws, "exports/acme/DESIGN.md")));
  assert.ok(existsSync(join(ws, "exports/kids/DESIGN.md")));

  // HTTP API: token required, state reflects the workspace.
  const ui = (await s.call("open_ui")).url;
  assert.match(ui, /^http:\/\/localhost:\d+\/$/);
  assert.equal((await fetch(new URL("api/state", ui))).status, 401);
  const st = await (await fetch(new URL("api/state", ui), { headers: { "X-Plinth-Token": "test-token" } })).json();
  assert.deepEqual(st.brands, ["acme", "kids"]);
  assert.equal(st.checks.gate, true);
  assert.ok(st.tokens.kids.rows.length > 10);
});
