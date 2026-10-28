#!/usr/bin/env node
// Plinth MCP server (stdio, newline-delimited JSON-RPC 2.0). Claude Code starts it when the plugin loads.
// One Plinth per folder (owner.mjs): if another process already serves this workspace (the `plinth` launcher, the
// UI's own server, another Claude Code session), every tool call is forwarded there. Otherwise this process serves
// the UI and runs the tools itself, and later processes forward to it. If the owner goes away, the next call here
// takes over.
// Workspace: PLINTH_WORKSPACE, else CLAUDE_PROJECT_DIR (Claude Code sets it for MCP servers; the spawn cwd is
// not guaranteed to be the project), else the current directory.
// stdout carries protocol messages only; logs go to stderr.
import { createInterface } from "node:readline";
import { TOOLS, toolByName } from "./tools.mjs";
import { createContext } from "./context.mjs";
import { startUi } from "./http.mjs";
import { createChat, createReview } from "./claude.mjs";
import { findOwner, claimOwner, releaseOwner, callOwner } from "./owner.mjs";

const VERSION = "0.6.2";
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const log = (...a) => process.stderr.write(`[plinth] ${a.join(" ")}\n`);

const write = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => write({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });

const ctx = createContext();

const INSTRUCTIONS = `Plinth maintains a design system (tokens, guidelines, components) in ${ctx.root}.

Workflow: call status first. Change anything with the change tool: it is written at once (the user sees it in the local UI, open_ui, and can undo it), after the engine validates it. Read the guidelines before a change and keep it consistent with them. Tokens are DTCG; components use their component tokens only. The user decides when to save a version and when to publish: call save_version or publish only when they ask.`;

let ui = null;
let owner = null;
async function host() {
  if (ui) return;
  ui = await startUi(ctx);
  ctx.ui = { url: ui.url, token: ui.token };
  ctx.notify = ui.bump;
  ctx.chat = createChat(ctx, { bump: ui.bump });
  ctx.review = createReview(ctx, { bump: ui.bump });
  claimOwner(ctx.root, ui);
  log(`workspace ${ctx.root}; UI ${ui.url}`);
}
const ready = (async () => {
  owner = await findOwner(ctx.root);
  if (owner) log(`workspace ${ctx.root}; using the Plinth already running at ${owner.url}`);
  else await host().catch((e) => log("UI failed to start:", e.message));
})();

async function runTool(name, args) {
  await ready;
  if (owner) {
    try { return await callOwner(owner, name, args); }
    catch (e) {
      if (e.toolError) throw e;
      // The owner is gone (its session ended): find the new one, or serve this workspace from here.
      owner = await findOwner(ctx.root);
      if (owner) return callOwner(owner, name, args);
      await host();
    }
  }
  return toolByName.get(name).run(args, ctx);
}

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
      if (!toolByName.has(params?.name)) return fail(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const result = await runTool(params.name, params.arguments ?? {});
        return reply(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        return reply(id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, "Parse error"); }
  handle(msg).catch((e) => fail(msg.id ?? null, -32603, e.message));
});
const shutdown = () => { ctx.storybook?.stop?.(); ctx.chat?.stop?.(); ctx.review?.stop?.(); ctx.github?.stop?.(); ui?.close(); if (ui) releaseOwner(ctx.root); process.exit(0); };
rl.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
