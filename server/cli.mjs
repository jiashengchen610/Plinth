#!/usr/bin/env node
// Standalone launcher: `plinth [folder]` checks and sets up what Plinth needs (git, Claude Code, GitHub), then
// serves the Plinth UI for a design-system folder (default: the current one) and opens it in the browser. The
// chat drives Claude Code headless, so no terminal session is needed after this.
//
// `plinth --terminal` (or `--full`) talks to Claude in this terminal instead: same pipeline, same pending changes
// and history, continuing the UI chat's conversation. The UI keeps running in the background for anyone who
// wants to look, and for the long jobs (install, Storybook, tests).
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createContext } from "./context.mjs";
import { startUi } from "./http.mjs";
import { createChat, terminalArgs, terminalHolder, terminalLock, sessionFile } from "./claude.mjs";
import { setup } from "./setup.mjs";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: plinth [folder] [--terminal | --full] [--no-open] [--no-setup] [--port <n>]

Checks git, Claude Code and GitHub (offering to install or sign in to what is missing), then serves the Plinth UI
for the design system in <folder> (default: current folder; an empty folder starts a new one). Chat in the UI runs
Claude Code headless; keep this process running while you use the UI.

  --terminal   talk to Claude here instead of in the UI: the UI chat's conversation and restrictions (Plinth
               tools and read-only file tools). Changes still wait in the queue; approve them here or in the UI.
  --full       like --terminal, with all of Claude Code's tools (each asks for permission). Design files can still
               only change through Plinth; other edits show up in the UI as outside edits.
  --no-setup   skip the checks
  --no-open    do not open the browser
  --port <n>   UI port (default 4319, or the next free one)`);
  process.exit(0);
}
const folder = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port");
const portIdx = args.indexOf("--port");
if (portIdx >= 0) process.env.PLINTH_PORT = args[portIdx + 1];
const full = args.includes("--full");
const terminal = full || args.includes("--terminal");

console.log("Plinth: a design system you build by talking to Claude.");
if (!args.includes("--no-setup")) await setup();

const ctx = createContext({ root: resolve(folder ?? process.cwd()), child: false });
const ui = await startUi(ctx);
ctx.ui = { url: ui.url, token: ui.token };
ctx.notify = ui.bump;
ctx.chat = createChat(ctx, { bump: ui.bump });

const shutdown = (code = 0) => { ctx.storybook?.stop?.(); ctx.chat?.stop?.(); ctx.github?.stop?.(); ui.close(); process.exit(typeof code === "number" ? code : 0); };
process.on("SIGTERM", shutdown);

if (terminal) await runTerminal();
else {
  console.log(`Plinth UI  ${ui.url}\nWorkspace  ${ctx.root}\nKeep this window open while you use the UI. Press Ctrl+C to stop.`);
  if (!args.includes("--no-open")) openBrowser(ui.url);
  process.on("SIGINT", () => shutdown());
}

function openBrowser(url) {
  const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(opener[0], opener[1], { stdio: "ignore", detached: true, windowsHide: true }).unref(); } catch { /* the URL is printed */ }
}

async function runTerminal() {
  const holder = terminalHolder(ctx.root);
  if (holder) { console.error(`This conversation is already open in another terminal (process ${holder.pid}). Use that one, or close it first.`); shutdown(); }
  let resume = null;
  try { resume = JSON.parse(readFileSync(sessionFile(ctx.root), "utf8")).id ?? null; } catch { /* first conversation */ }
  console.log(`\nPlinth UI  ${ui.url}  (optional: pending changes, checks and history, live)\nWorkspace  ${ctx.root}\n${full ? "Mode       full: every Claude Code tool, each asks first; design files only through Plinth" : "Mode       Plinth tools only, like the UI chat"}\n${resume ? "Continuing the conversation from the UI chat." : "Starting a new conversation."} Type /exit to leave.\n`);
  mkdirSync(join(ctx.root, ".ds"), { recursive: true });
  writeFileSync(terminalLock(ctx.root), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + "\n");
  ui.bump();

  const bin = process.env.PLINTH_CLAUDE_BIN || "claude";
  const [cmd, pre] = /\.(mjs|cjs|js)$/i.test(bin) ? [process.execPath, [bin]] : [bin, []];
  // A child of this UI server: the session's Plinth tools forward install, Storybook and tests here.
  const env = { ...process.env, PLINTH_CHILD: "1", PLINTH_WORKSPACE: ctx.root, PLINTH_PARENT_URL: ui.url, PLINTH_PARENT_TOKEN: ui.token };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const started = Date.now();
  // Ctrl+C belongs to Claude Code (it interrupts a turn); this process ends when Claude Code does.
  process.on("SIGINT", () => {});
  const code = await new Promise((done) => {
    const child = spawn(cmd, [...pre, ...terminalArgs({ full, resume })], { cwd: ctx.root, env, stdio: "inherit" });
    child.on("error", (e) => { console.error(`Could not start Claude Code (${bin}): ${e.message}`); done(1); });
    child.on("exit", (c) => done(c ?? 0));
  });
  rmSync(terminalLock(ctx.root), { force: true });
  saveLatestSession(started);
  shutdown(code);
}

/**
 * Claude Code keeps sessions under ~/.claude/projects/<folder with every non-alphanumeric character as "-">.
 * Hand the conversation back to the UI chat: the newest session written during this terminal run.
 */
function saveLatestSession(since) {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const dir = join(base, "projects", ctx.root.replace(/[^a-zA-Z0-9]/g, "-"));
  if (!existsSync(dir)) return;
  const newest = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).filter((x) => x.t >= since).sort((a, b) => b.t - a.t)[0];
  if (newest) writeFileSync(sessionFile(ctx.root), JSON.stringify({ id: newest.f.replace(/\.jsonl$/, ""), at: new Date().toISOString(), from: "terminal" }) + "\n");
}
