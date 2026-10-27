// `plinth --terminal` / `--full`: Claude Code in the terminal on the same pipeline as the UI chat, continuing its
// conversation; the UI chat waits while the terminal holds it. Uses the stand-in for the claude binary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createChat, terminalLock } from "../server/claude.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "server", "cli.mjs");
const FAKE = join(here, "fake-claude.mjs");

function runCli(ws, extra, log) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ws, "--no-setup", "--port", "4398", ...extra], {
      env: { ...process.env, PLINTH_CLAUDE_BIN: FAKE, FAKE_CLAUDE_LOG: log, PLINTH_TOKEN: "t", CLAUDE_CONFIG_DIR: join(ws, "..", "claude-config") },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.stdin.end("Hello from the terminal\n");
    child.on("exit", (code) => resolve({ code, out }));
  });
}

test("terminal: strict and full modes, resume the UI conversation, lock while open", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "plinth-term-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const ws = join(base, "ws");
  const log = join(base, "fake.json");
  mkdirSync(join(ws, ".ds"), { recursive: true });
  writeFileSync(join(ws, ".ds", "claude-session.json"), JSON.stringify({ id: "ui-session-42" }));

  // Strict: the UI chat's restrictions, continuing its session, as a child of this launcher's UI server.
  const strict = await runCli(ws, ["--terminal"], log);
  assert.equal(strict.code, 0, strict.out);
  assert.match(strict.out, /Continuing the conversation from the UI chat/);
  let call = JSON.parse(readFileSync(log, "utf8"));
  assert.equal(call.args[call.args.indexOf("--resume") + 1], "ui-session-42");
  assert.ok(call.args.includes("--plugin-dir"));
  assert.ok(call.args.indexOf("Write") > call.args.indexOf("--disallowedTools"), "writes are disallowed");
  assert.equal(call.env.PLINTH_CHILD, "1");
  assert.equal(call.env.CLAUDECODE, null);
  assert.ok(!existsSync(terminalLock(ws)), "the lock is released when Claude Code exits");

  // Full: every tool (the workspace's .claude/settings.json is what protects design files).
  const full = await runCli(ws, ["--full"], log);
  assert.equal(full.code, 0, full.out);
  call = JSON.parse(readFileSync(log, "utf8"));
  assert.ok(!call.args.includes("--disallowedTools") && !call.args.includes("--allowedTools"));
  assert.match(full.out, /every Claude Code tool/);

  // While a terminal holds the conversation, the UI chat waits instead of forking it.
  writeFileSync(terminalLock(ws), JSON.stringify({ pid: process.pid }));
  const chat = createChat({ root: ws, ui: { url: null, token: null } }, { bin: FAKE });
  await assert.rejects(chat.send({ text: "hi" }), /open in a terminal/);
  assert.equal(chat.state().terminal, true);
  // A stale lock (process gone) does not block.
  writeFileSync(terminalLock(ws), JSON.stringify({ pid: 999999 }));
  assert.equal(chat.state().terminal, false);
});
