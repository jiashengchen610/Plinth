#!/usr/bin/env node
// brandloom MCP server (stdio, newline-delimited JSON-RPC 2.0) + local review UI.
// Workspace: BRANDLOOM_WORKSPACE, else CLAUDE_PROJECT_DIR (Claude Code sets it for MCP servers; the spawn cwd is
// not guaranteed to be the project), else the current directory.
// stdout carries protocol messages only; logs go to stderr.
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { TOOLS, toolByName } from "./tools.mjs";
import { startUi } from "./http.mjs";
import { createStorybook } from "./storybook.mjs";

const VERSION = "0.1.0";
const root = resolve(process.env.BRANDLOOM_WORKSPACE || process.env.CLAUDE_PROJECT_DIR || process.cwd());
const log = (...a) => process.stderr.write(`[brandloom] ${a.join(" ")}\n`);

const storybook = createStorybook(root, () => {});
const ctx = { root, storybook, ui: { url: null }, notify: () => {} };

const INSTRUCTIONS = `brandloom maintains a design system (tokens, guidelines, components) in ${root}.
Workflow: call status first. Change anything through propose_change; the user reviews it in the local UI (open_ui) and you call apply_change only after they approve.
Tokens are DTCG; components may only use semantic tokens. Run run_checks before publish; use propose_contrast_fixes for contrast failures.`;

function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); }
function fail(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n"); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notification
  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "brandloom", version: VERSION },
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
