// The launcher's setup checks, without a terminal: report only, never prompt or install, and always continue to
// the UI. Runs against stand-ins on PATH so the result does not depend on this machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "server", "cli.mjs");

test("setup: reports what is missing without a terminal, then serves the UI", { skip: process.platform === "win32" ? "stand-in executables need a POSIX shell" : false }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "plinth-setup-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  const stub = (name, body) => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  rmSync(bin, { recursive: true, force: true });
  (await import("node:fs")).mkdirSync(bin);
  stub("git", "exit 0");
  stub("claude", `[ "$1" = "auth" ] && echo '{"loggedIn": false}'; exit 0`);
  // no gh at all
  const child = spawn(process.execPath, [CLI, join(dir, "ws"), "--no-open", "--port", "4397"], { env: { ...process.env, PATH: `${bin}:${dirname(process.execPath)}` }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill());
  let out = "";
  await new Promise((res) => { child.stdout.on("data", (d) => { out += d; if (/Plinth UI/.test(out)) res(); }); setTimeout(res, 8000); });
  assert.match(out, /✔ git/);
  assert.match(out, /✖ Claude Code is not signed in/);
  assert.match(out, /✖ GitHub CLI is not installed/);
  assert.match(out, /Plinth UI {2}http:\/\/localhost:\d+\//, "the UI still starts");
  assert.doesNotMatch(out, /\[Y\/n\]/, "no prompts without a terminal");
});
