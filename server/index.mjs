#!/usr/bin/env node
// Plinth MCP server (stdio, newline-delimited JSON-RPC 2.0) + local review UI + chat channel.
// Workspace: PLINTH_WORKSPACE, else CLAUDE_PROJECT_DIR (Claude Code sets it for MCP servers; the spawn cwd is
// not guaranteed to be the project), else the current directory.
// stdout carries protocol messages only; logs go to stderr.
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { TOOLS, toolByName } from "./tools.mjs";
import { startUi } from "./http.mjs";
import { createStorybook } from "./storybook.mjs";
import { createChat } from "./chat.mjs";

const VERSION = "0.2.0";
const root = resolve(process.env.PLINTH_WORKSPACE || process.env.CLAUDE_PROJECT_DIR || process.cwd());
const log = (...a) => process.stderr.write(`[plinth] ${a.join(" ")}\n`);

// Claude Code does not register a channel server that negotiates protocol revision 2026-07-28, so answer with a
// revision we implement and that channels accept, whatever the client offers.
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const write = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => write({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });
const emit = async (method, params) => write({ jsonrpc: "2.0", method, params });

const storybook = createStorybook(root, () => {});
const ctx = { root, storybook, ui: { url: null }, notify: () => {} };
const chat = createChat(root, { notify: emit, bump: () => ctx.notify() });
ctx.chat = chat;

const INSTRUCTIONS = `Plinth maintains a design system (tokens, guidelines, components) in ${root}.

Workflow: call status first. Change anything through propose_change; the user reviews it in the local UI (open_ui) and you call apply_change only after they approve. Tokens are DTCG; components may only use semantic tokens. Run run_checks before publish; use propose_contrast_fixes for contrast failures.

Chat from the Plinth UI: when Claude Code runs with this server as a channel, the user's messages arrive as <channel source="..." chat_id="..." image_path="...">. That user reads the Plinth UI, not this terminal: everything they should see goes through the reply tool, in plain language and a few sentences. If the tag has image_path (or image_path_2 …), Read that file: it is an image they attached. After proposing a change, reply that it is waiting in the Changes tab; do not apply it unless they say so.`;

const REPLY_TOOL = {
  name: "reply",
  description: "Send a message to the user in the Plinth UI chat. Use it to answer every message that arrived through the Plinth channel. Plain language, a few sentences; point to the UI tab where they can see the result.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The message, plain text or simple Markdown" },
      chat_id: { type: "string", description: "chat_id of the message you are answering" },
    },
    required: ["text"],
  },
};

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) {
    // Notifications from Claude Code.
    if (method === "notifications/claude/channel/permission_request") chat.onPermissionRequest(params);
    return;
  }
  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: {
          tools: {},
          experimental: { "claude/channel": {}, "claude/channel/permission": {} },
        },
        serverInfo: { name: "plinth", version: VERSION },
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: [...TOOLS, REPLY_TOOL].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      chat.activity();
      if (params?.name === "reply") return reply(id, { content: [{ type: "text", text: chat.reply(params.arguments ?? {}) }] });
      const tool = toolByName.get(params?.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const result = await tool.run(params.arguments ?? {}, ctx);
        return reply(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        return reply(id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

const ui = await startUi(ctx).catch((e) => { log("UI failed to start:", e.message); return null; });
if (ui) {
  ctx.ui.url = ui.url;
  ctx.notify = ui.bump;
  log(`workspace ${root}; UI ${ui.url}`);
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, "Parse error"); }
  handle(msg).catch((e) => fail(msg.id ?? null, -32603, e.message));
});
const shutdown = () => { storybook.stop(); ui?.close(); process.exit(0); };
rl.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
