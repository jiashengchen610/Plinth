// The UI chat end to end with a stand-in for the claude binary: a message with an image becomes a headless
// Claude Code run with the right flags, the reply shows up in state, the session is resumed, a vanished
// session is replaced, and a crash is reported instead of hanging.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = join(here, "..", "server", "index.mjs");
const FAKE = join(here, "fake-claude.mjs");
// 1×1 transparent PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

test("chat: UI message → headless Claude Code → reply, resume, recovery", async (t) => {
  const ws = mkdtempSync(join(tmpdir(), "plinth-chat-"));
  const log = join(ws, ".fake-claude.json"); // hidden: an empty folder may hold dotfiles
  const env = { ...process.env, PLINTH_WORKSPACE: ws, PLINTH_TOKEN: "tok", PLINTH_PORT: "4396", PLINTH_CLAUDE_BIN: FAKE, FAKE_CLAUDE_LOG: log, CLAUDECODE: "1" };
  const child = spawn(process.execPath, [SERVER], { env, stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { child.stdin.end(); rmSync(ws, { recursive: true, force: true }); });

  const responses = new Map();
  let nextId = 1;
  createInterface({ input: child.stdout }).on("line", (line) => { const m = JSON.parse(line); if (m.id !== undefined) responses.get(m.id)?.(m); });
  const request = (method, params) => new Promise((resolve) => { const id = nextId++; responses.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  const ui = JSON.parse((await request("tools/call", { name: "open_ui", arguments: {} })).result.content[0].text).url;
  const api = (path, body) => fetch(new URL(path, ui), { method: body ? "POST" : "GET", headers: { "X-Plinth-Token": "tok", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const turn = async (text, images = [], mentions = []) => {
    const r = await api("api/chat", { text, images, mentions });
    assert.equal(r.status, 200, await r.text());
    for (let i = 0; i < 400; i++) {
      const s = await (await api("api/state")).json();
      if (!s.chat.working && s.chat.messages.at(-1)?.role === "assistant") return s;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error("turn did not finish");
  };
  const lastCall = () => JSON.parse(readFileSync(log, "utf8"));

  // 1. A message with an image, before any design system exists.
  let s = await turn("Create a design system for a budgeting app", [{ type: "image/png", data: PNG }]);
  assert.deepEqual(s.chat.messages.map((m) => m.role), ["user", "assistant"]);
  assert.match(s.chat.messages[1].text, /^I read .*inbox[\\/].*\.png\.$/, "the reply saw the image path");
  assert.equal(s.chat.session, "sess-0001");
  assert.deepEqual(s.chat.messages[1].tools, ["status"]);
  const call = lastCall();
  assert.equal(call.env.PLINTH_WORKSPACE, ws, "the session's Plinth server finds this one through the workspace");
  assert.equal(call.env.CLAUDECODE, null, "nested-session guard is cleared");
  assert.equal(call.cwd.replace(/\\/g, "/").toLowerCase(), ws.replace(/\\/g, "/").toLowerCase());
  assert.ok(call.args.includes("--plugin-dir") && call.args.includes("--allowedTools"));
  assert.ok(call.args.indexOf("Write") > call.args.indexOf("--disallowedTools"), "Write is disallowed");
  assert.ok(!call.args.includes("--resume"), "first turn starts a session");
  assert.ok(existsSync(join(ws, ".ds", "claude-session.json")));

  // 2. The next message resumes the session.
  s = await turn("Make it warmer vanish-next");
  assert.equal(s.chat.messages.at(-1).text, "Echo: Make it warmer vanish-next");
  assert.equal(lastCall().args[lastCall().args.indexOf("--resume") + 1], "sess-0001");
  assert.equal(s.chat.session, "gone-session");

  // 3. A session Claude Code no longer has is replaced by a fresh one, transparently.
  s = await turn("Still there?");
  assert.equal(s.chat.messages.at(-1).text, "Echo: Still there?");
  assert.ok(!lastCall().args.includes("--resume"), "retried without --resume");
  assert.equal(s.chat.session, "sess-0001");

  // 4. Reset forgets the thread.
  await api("api/chat/reset", {});
  s = await turn("New thread");
  assert.ok(!lastCall().args.includes("--resume"));

  // 5. A crash is reported, not swallowed.
  s = await turn("please crash");
  assert.match(s.chat.messages.at(-1).text, /exited \(3\)/);
  assert.equal(s.chat.working, false);

  // 6. Bad input is refused before anything runs.
  assert.equal((await api("api/chat", { text: "", images: [] })).status, 400);
  assert.equal((await api("api/chat", { text: "x", images: [{ type: "image/svg+xml", data: "PHN2Zz4=" }] })).status, 400);
  assert.equal((await fetch(new URL("api/chat", ui), { method: "POST", body: "{}" })).status, 401);
  assert.ok(existsSync(join(ws, ".ds", "chat.jsonl")));

  // 7. The review at publish: one run on a cheap model, with the read-only tools only.
  await request("tools/call", { name: "create_design_system", arguments: { name: "Review", brand: "acme", context: "saas-dashboard" } });
  assert.equal((await api("api/review", {})).status, 200);
  let review = null;
  for (let i = 0; i < 400 && !review; i++) {
    const st = await (await api("api/state")).json();
    if (st.review && !st.review.running && st.review.result) review = st.review.result;
    else await new Promise((res) => setTimeout(res, 50));
  }
  assert.ok(review?.ok, JSON.stringify(review));
  assert.equal(review.text, "Echo: Review the changes since the last publish.");
  const args = lastCall().args;
  assert.equal(args[args.indexOf("--model") + 1], "haiku");
  assert.ok(args.includes("mcp__plugin_plinth_plinth__review_changes"));
  assert.ok(args.indexOf("mcp__plugin_plinth_plinth__change") > args.indexOf("--disallowedTools"), "the review cannot write");
  assert.ok(!args.includes("--resume"), "the review is not part of the chat thread");

  // 8. The vocabulary knows what this design system has; a pick applies without Claude; names picked from the menu
  //    reach Claude as exact ids with how to apply them.
  const vocab = async () => (await (await api("api/vocab")).json()).entries;
  let v = await vocab();
  assert.ok(v.find((e) => e.id === "component:button").inSystem && v.find((e) => e.id === "component:button").apply === null, "button is in the system");
  assert.equal((await api("api/remove-component", { name: "tooltip" })).status, 200);
  v = await vocab();
  assert.deepEqual(v.find((e) => e.id === "component:tooltip").apply, [{ tool: "add_component", args: { name: "tooltip" } }], "a removed component can be added back from the menu");
  assert.equal(v.find((e) => e.id === "corners:pill").current, false);
  const applied = await api("api/vocab/apply", { id: "corners:pill", brand: "acme" });
  assert.equal(applied.status, 200, await applied.text());
  v = await vocab();
  assert.equal(v.find((e) => e.id === "corners:pill").current, true, "the pick is now the current corners");
  assert.equal((await api("api/vocab/apply", { id: "component:button", brand: "acme" })).status, 400, "already in the system");
  assert.equal((await api("api/vocab/apply", { id: "nope" })).status, 400);
  s = await turn("Make this rounder", [], ["component:button", "look:soft-rounded", "nope"]);
  const p = lastCall().prompt;
  assert.match(p, /^Make this rounder\n\nPicked from Plinth's menu/);
  assert.match(p, /- Component "Button" \(button\): already in this design system at src\/components\/button/);
  assert.match(p, /- Look "Soft and rounded": .*set_style \{"main":"teal"/);
  assert.ok(!p.includes("nope"), "unknown ids are dropped");
  assert.deepEqual(s.chat.messages.at(-2).mentions.map((m) => m.id), ["component:button", "look:soft-rounded"]);
  assert.equal(s.chat.messages.at(-2).text, "Make this rounder");
  s = await turn("", [], ["component:tooltip"]);
  assert.match(lastCall().prompt, /^\(see what was picked below\)\n\nPicked from Plinth's menu.*\n- Component "Tooltip" \(tooltip\): not in this design system yet; add it with add_component/);
  const added = await api("api/vocab/apply", { id: "component:tooltip", brand: "acme" });
  assert.equal(added.status, 200, await added.text());
  assert.equal((await vocab()).find((e) => e.id === "component:tooltip").inSystem, true, "applying the pick added it back");
});
