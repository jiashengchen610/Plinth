#!/usr/bin/env node
// Plinth MCP server (stdio, newline-delimited JSON-RPC 2.0). Claude Code starts it when the plugin loads;
// it also serves the local UI and runs the UI's chat (see claude.mjs). With PLINTH_CHILD set it is the
// nested instance inside a headless session: tools only, no UI, no child processes of its own.
// Workspace: PLINTH_WORKSPACE, else CLAUDE_PROJECT_DIR (Claude Code sets it for MCP servers; the spawn cwd is
// not guaranteed to be the project), else the current directory.
// stdout carries protocol messages only; logs go to stderr.
import { createInterface } from "node:readline";
import { TOOLS, toolByName } from "./tools.mjs";
import { createContext } from "./context.mjs";
import { startUi } from "./http.mjs";
import { createChat } from "./claude.mjs";

const VERSION = "0.3.0";
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const log = (...a) => process.stderr.write(`[plinth] ${a.join(" ")}\n`);

const write = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => write({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });

const ctx = createContext();

const INSTRUCTIONS = `Plinth maintains a design system (tokens, guidelines, components) in ${ctx.root}.

Workflow: call status first. Change anything through propose_change; the user reviews it in the local UI (open_ui) and you call apply_change only after they approve. Tokens are DTCG; components may only use semantic tokens. Run run_checks after every applied change and run_tests after component work; publish runs both.`;

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications
  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "plinth", version: VERSION },
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
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

let ui = null;
if (!ctx.child) {
  ui = await startUi(ctx).catch((e) => { log("UI failed to start:", e.message); return null; });
  if (ui) {
    ctx.ui = { url: ui.url, token: ui.token };
    ctx.notify = ui.bump;
    ctx.chat = createChat(ctx, { bump: ui.bump });
    log(`workspace ${ctx.root}; UI ${ui.url}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, "Parse error"); }
  handle(msg).catch((e) => fail(msg.id ?? null, -32603, e.message));
});
const shutdown = () => { ctx.storybook?.stop?.(); ctx.chat?.stop?.(); ui?.close(); process.exit(0); };
rl.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
