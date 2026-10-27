#!/usr/bin/env node
// Standalone launcher: `plinth [folder]` serves the Plinth UI for a design-system folder (default: the
// current one) and opens it in the browser. The chat drives Claude Code headless, so no terminal session
// is needed; Claude Code must be installed and signed in.
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createContext } from "./context.mjs";
import { startUi } from "./http.mjs";
import { createChat } from "./claude.mjs";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: plinth [folder] [--no-open] [--port <n>]

Serves the Plinth UI for the design system in <folder> (default: current folder; an empty folder starts a
new one). Chat in the UI runs Claude Code headless; keep this process running while you use the UI.`);
  process.exit(0);
}
const folder = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--port");
const portIdx = args.indexOf("--port");
if (portIdx >= 0) process.env.PLINTH_PORT = args[portIdx + 1];

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
