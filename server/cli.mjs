#!/usr/bin/env node
// Standalone launcher: `plinth [folder]` checks and sets up what Plinth needs (git, Claude Code, GitHub), then
// serves the Plinth UI for a design-system folder (default: the current one) and opens it in the browser. The
// chat drives Claude Code headless, so no terminal session is needed after this.
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createContext } from "./context.mjs";
import { startUi } from "./http.mjs";
import { createChat } from "./claude.mjs";
import { setup } from "./setup.mjs";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: plinth [folder] [--no-open] [--no-setup] [--port <n>]

Checks git, Claude Code and GitHub (offering to install or sign in to what is missing), then serves the Plinth UI
for the design system in <folder> (default: current folder; an empty folder starts a new one). Chat in the UI runs
Claude Code headless; keep this process running while you use the UI.

  --no-setup   skip the checks
  --no-open    do not open the browser
  --port <n>   UI port (default 4319, or the next free one)`);
  process.exit(0);
}
const folder = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port");
const portIdx = args.indexOf("--port");
if (portIdx >= 0) process.env.PLINTH_PORT = args[portIdx + 1];

console.log("Plinth: a design system you build by talking to Claude.");
if (!args.includes("--no-setup")) await setup();

const ctx = createContext({ root: resolve(folder ?? process.cwd()), child: false });
const ui = await startUi(ctx);
ctx.ui = { url: ui.url, token: ui.token };
ctx.notify = ui.bump;
ctx.chat = createChat(ctx, { bump: ui.bump });

console.log(`Plinth UI  ${ui.url}\nWorkspace  ${ctx.root}\nKeep this window open while you use the UI. Press Ctrl+C to stop.`);
if (!args.includes("--no-open")) {
  const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", ui.url]] : process.platform === "darwin" ? ["open", [ui.url]] : ["xdg-open", [ui.url]];
  try { spawn(opener[0], opener[1], { stdio: "ignore", detached: true, windowsHide: true }).unref(); } catch { /* the URL is printed */ }
}

const shutdown = () => { ctx.storybook?.stop?.(); ctx.chat?.stop?.(); ctx.github?.stop?.(); ui.close(); process.exit(0); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
