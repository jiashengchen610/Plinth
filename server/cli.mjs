#!/usr/bin/env node
// Standalone launcher: `plinth [folder]` checks and sets up what Plinth needs (git, Claude Code, GitHub), then
// serves the Plinth UI for a design-system folder (default: the current one) and opens it in the browser. The
// chat drives Claude Code headless, so no terminal session is needed after this. If Plinth already runs for the
// folder (this launcher, or a Claude Code session with the plugin), it opens that one instead: one Plinth per folder.
//
// `plinth check [folder]` runs the checks the deploy workflow runs before building Storybook (engine/check.mjs).
// `plinth record [folder]` writes the update record (exports/update.json) the workflow ships with the site.
// `plinth status [folder]` in a product repo: what the design system changed since this repo took its copies.
// `plinth connect <site|folder> [folder]` connects a product repo: copies files, writes plinth-source.json and the
// CLAUDE.md rules; `--take` and `--mark` update what was taken.
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);

if (args[0] === "check") {
  const { checkRepo, checkMarkdown } = await import("../engine/check.mjs");
  const root = resolve(args.find((a, i) => i > 0 && !a.startsWith("--")) ?? process.cwd());
  const result = checkRepo(root);
  const md = checkMarkdown(result);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : md);
  process.exitCode = result.ok ? 0 : 1;
} else if (args[0] === "record") {
  const { writeUpdateRecord, RECORD_FILE } = await import("../engine/record.mjs");
  const root = resolve(args.find((a, i) => i > 0 && !a.startsWith("--")) ?? process.cwd());
  const record = writeUpdateRecord(root);
  const n = record.versions.length;
  console.log(args.includes("--json") ? JSON.stringify(record, null, 2) : `${RECORD_FILE}: version ${record.version?.short ?? "none"}, ${n} saved version${n === 1 ? "" : "s"}, ${Object.keys(record.files).length} files hashed.`);
} else if (args[0] === "status") {
  const { status } = await import("./status.mjs");
  const { statusMarkdown } = await import("../engine/status.mjs");
  const root = resolve(args.find((a, i) => i > 0 && !a.startsWith("--")) ?? process.cwd());
  try {
    const report = await status(root, { diff: args.includes("--diff") });
    console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : statusMarkdown(report, report.diffs ?? null));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
} else if (args[0] === "connect") {
  const { connect, connectMarkdown } = await import("./connect.mjs");
  const positional = [], lists = { "--take": [], "--mark": [], "--repository": [] };
  for (let i = 1; i < args.length; i++) {
    if (args[i] in lists) { if (args[i + 1] !== undefined) lists[args[i]].push(args[++i]); } else if (!args[i].startsWith("--")) positional.push(args[i]);
  }
  const [source, folder] = positional;
  try {
    const r = await connect(resolve(folder ?? process.cwd()), { source, take: lists["--take"], mark: lists["--mark"], hook: args.includes("--hook"), repository: lists["--repository"][0] ?? null });
    console.log(args.includes("--json") ? JSON.stringify(r, null, 2) : connectMarkdown(r));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
} else {
  await launch();
}

async function launch() {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: plinth [folder] [--no-open] [--no-setup] [--port <n>]
       plinth check [folder] [--json]
       plinth record [folder] [--json]
       plinth status [folder] [--diff] [--json]
       plinth connect <site|folder> [folder] [--take <group|path>,…] [--mark <path>,…] [--hook] [--json]

Checks git, Claude Code and GitHub (offering to install or sign in to what is missing), then serves the Plinth UI
for the design system in <folder> (default: current folder; an empty folder starts a new one). Chat in the UI runs
Claude Code headless; keep this process running while you use the UI. To talk to Claude in a terminal instead, run
Claude Code in the folder with the Plinth plugin: it uses this same Plinth.

  check        the checks GitHub runs before deploying Storybook; exit code 1 when something blocks the deploy
  record       write exports/update.json: the saved versions with their notes and a hash per file, for product repos
  status       in a product repo (plinth-source.json): what the design system changed since this repo took its
               copies, what changed here, and what changed on both sides; --diff fetches the changed files and
               shows the differences. It reports; it changes nothing.
  connect      connect a product repo to a design system (its site or folder): copies the files asked for (a first
               connect takes the guidelines and the generated styles; groups: guidelines, styles, tokens, icons,
               components, or components/<name>, or a path), writes plinth-source.json and the design-system
               section of CLAUDE.md; --mark records a file merged by hand; --hook runs status when a Claude Code
               session starts.
  --no-setup   skip the checks
  --no-open    do not open the browser
  --port <n>   UI port (default 4319, or the next free one)`);
    return;
  }
  if (args.includes("--terminal") || args.includes("--full")) {
    console.log("Terminal mode was removed in Plinth 0.4. Run Claude Code in the design-system folder with the Plinth plugin instead; it works on the same Plinth as the UI.");
    process.exitCode = 1;
    return;
  }
  const folder = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port");
  const portIdx = args.indexOf("--port");
  if (portIdx >= 0) process.env.PLINTH_PORT = args[portIdx + 1];

  const { createContext } = await import("./context.mjs");
  const { startUi } = await import("./http.mjs");
  const { createChat, createReview } = await import("./claude.mjs");
  const { setup } = await import("./setup.mjs");
  const { findOwner, claimOwner, releaseOwner } = await import("./owner.mjs");

  console.log("Plinth: a design system you build by talking to Claude.");
  const root = resolve(folder ?? process.cwd());
  const running = await findOwner(root);
  if (running) {
    console.log(`Plinth is already running for this folder: ${running.url}\nWorkspace  ${root}`);
    if (!args.includes("--no-open")) openBrowser(running.url);
    return;
  }
  if (!args.includes("--no-setup")) await setup();

  const ctx = createContext({ root });
  const ui = await startUi(ctx);
  ctx.ui = { url: ui.url, token: ui.token };
  ctx.notify = ui.bump;
  ctx.chat = createChat(ctx, { bump: ui.bump });
  ctx.review = createReview(ctx, { bump: ui.bump });
  claimOwner(ctx.root, ui);

  const shutdown = () => { ctx.storybook?.stop?.(); ctx.chat?.stop?.(); ctx.review?.stop?.(); ctx.github?.stop?.(); ui.close(); releaseOwner(ctx.root); process.exit(0); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  console.log(`Plinth UI  ${ui.url}\nWorkspace  ${ctx.root}\nKeep this window open while you use the UI. Press Ctrl+C to stop.`);
  if (!args.includes("--no-open")) openBrowser(ui.url);
}

function openBrowser(url) {
  const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(opener[0], opener[1], { stdio: "ignore", detached: true, windowsHide: true }).unref(); } catch { /* the URL is printed */ }
}
