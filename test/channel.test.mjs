// The chat channel, end to end, with this test playing Claude Code: protocol negotiation, a UI message (with an
// image) becoming a channel notification, the reply tool, and permission relay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "server", "index.mjs");
// 1×1 transparent PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

test("channel: UI chat ↔ Claude Code session", async (t) => {
  const ws = mkdtempSync(join(tmpdir(), "plinth-chan-"));
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PLINTH_WORKSPACE: ws, PLINTH_TOKEN: "tok", PLINTH_PORT: "4395" }, stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { child.stdin.end(); rmSync(ws, { recursive: true, force: true }); });

  const responses = new Map();
  const notifications = [];
  let nextId = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    const m = JSON.parse(line);
    if (m.id !== undefined) responses.get(m.id)?.(m);
    else notifications.push(m);
  });
  const request = (method, params) => new Promise((resolve) => { const id = nextId++; responses.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  const notifyServer = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  const waitFor = async (pred, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { const n = notifications.find(pred); if (n) return n; await new Promise((r) => setTimeout(r, 25)); } return null; };

  // A client offering the newest revision gets one channels accept.
  const init = await request("initialize", { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "claude-code", version: "test" } });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.deepEqual(init.result.capabilities.experimental, { "claude/channel": {}, "claude/channel/permission": {} });
  assert.match(init.result.instructions, /reply tool/);
  const tools = (await request("tools/list", {})).result.tools.map((x) => x.name);
  assert.ok(tools.includes("reply"));

  const ui = JSON.parse((await request("tools/call", { name: "open_ui", arguments: {} })).result.content[0].text).url;
  const api = (path, body) => fetch(new URL(path, ui), { method: body ? "POST" : "GET", headers: { "X-Plinth-Token": "tok", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

  // UI → session, before any design system exists (the first message is the brief).
  const sent = await (await api("api/chat", { text: "Create a design system for a budgeting app", images: [{ type: "image/png", data: PNG }] })).json();
  assert.ok(sent.id);
  const event = await waitFor((n) => n.method === "notifications/claude/channel");
  assert.ok(event, "a channel notification reaches the session");
  assert.equal(event.params.content, "Create a design system for a budgeting app");
  assert.equal(event.params.meta.chat_id, sent.id);
  assert.ok(existsSync(event.params.meta.image_path), "the image is saved where Claude can Read it");
  assert.ok(Object.keys(event.params.meta).every((k) => /^\w+$/.test(k)), "meta keys are identifiers");
  assert.deepEqual(readFileSync(event.params.meta.image_path), Buffer.from(PNG, "base64"));

  // Bad input is refused before anything reaches the session.
  assert.equal((await api("api/chat", { text: "", images: [] })).status, 400);
  assert.equal((await api("api/chat", { text: "x", images: [{ type: "image/svg+xml", data: "PHN2Zz4=" }] })).status, 400);
  assert.equal((await fetch(new URL("api/chat", ui), { method: "POST", body: "{}" })).status, 401);

  // Session → UI through the reply tool.
  const r = await request("tools/call", { name: "reply", arguments: { text: "Created **Penny**. Review it in Changes.", chat_id: sent.id } });
  assert.equal(r.result.content[0].text, "sent");
  let state = await (await api("api/state")).json();
  assert.equal(state.exists, false);
  assert.deepEqual(state.chat.messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(state.chat.messages[1].text, "Created **Penny**. Review it in Changes.");
  const img = await fetch(new URL(`inbox/${state.chat.messages[0].images[0].split("/").pop()}?t=tok`, ui));
  assert.equal(img.status, 200);
  assert.equal((await fetch(new URL(`inbox/${state.chat.messages[0].images[0].split("/").pop()}`, ui))).status, 401);

  // Permission relay: Claude Code asks, the UI answers.
  notifyServer("notifications/claude/channel/permission_request", { request_id: "abcde", tool_name: "Bash", description: "Install dependencies", input_preview: '{"command":"npm install"}' });
  await new Promise((res) => setTimeout(res, 100));
  state = await (await api("api/state")).json();
  assert.equal(state.chat.permissions.length, 1);
  assert.equal(state.chat.permissions[0].tool_name, "Bash");
  assert.equal((await api("api/permissions/abcde", { behavior: "allow" })).status, 200);
  const verdict = await waitFor((n) => n.method === "notifications/claude/channel/permission");
  assert.deepEqual(verdict.params, { request_id: "abcde", behavior: "allow" });
  assert.equal((await api("api/permissions/abcde", { behavior: "deny" })).status, 400, "an answered request cannot be answered again");
  state = await (await api("api/state")).json();
  assert.equal(state.chat.permissions.length, 0);

  // The conversation survives a restart (stored in the workspace's .ds/, which is gitignored).
  assert.ok(existsSync(join(ws, ".ds", "chat.jsonl")));
});
