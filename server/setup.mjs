// First-run setup in the terminal, before the UI opens: the user is already at a prompt, so check everything
// Plinth needs and offer to fix what is missing right there (install with winget / brew / npm, sign in to
// Claude Code, connect GitHub). Required: git, Claude Code signed in. Optional: GitHub, for publishing; it can
// also be connected later from the Publish dialog.
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { findGh, ghSync, githubStatus, REQUIRED_SCOPES } from "./github.mjs";

const isWin = process.platform === "win32";
const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => console.log(`  ✖ ${m}`);
const note = (m) => console.log(`    ${m}`);

/**
 * spawnSync that also finds Windows .cmd shims (npm, an npm-installed claude): those need a shell, and a shell
 * with an args array is deprecated, so retry once as a single command line. Every argument here is a constant.
 */
function sh(cmd, args, opts) {
  const r = spawnSync(cmd, args, { windowsHide: true, ...opts });
  if (isWin && r.error?.code === "ENOENT") return spawnSync([cmd, ...args].join(" "), { windowsHide: true, shell: true, ...opts });
  return r;
}
const has = (cmd) => sh(cmd, ["--version"], { stdio: "ignore" }).status === 0;
/** Run a command attached to this terminal (installers, sign-in flows). */
const interactive = (cmd, args) => sh(cmd, args, { stdio: "inherit" }).status === 0;

function claudeSignedIn() {
  const r = sh("claude", ["auth", "status"], { encoding: "utf8" });
  try { return JSON.parse(r.stdout).loggedIn === true; } catch { return false; }
}

/** How to install a tool on this machine: { cmd, args, shell, label } or null when there is no package manager. */
function installer(tool) {
  if (isWin && has("winget")) {
    const id = { git: "Git.Git", gh: "GitHub.cli" }[tool];
    if (id) return { cmd: "winget", args: ["install", "--id", id, "-e", "--source", "winget", "--accept-package-agreements", "--accept-source-agreements"], label: `winget install ${id}` };
  }
  if (process.platform === "darwin" && has("brew")) {
    const pkg = { git: "git", gh: "gh" }[tool];
    if (pkg) return { cmd: "brew", args: ["install", pkg], label: `brew install ${pkg}` };
  }
  if (tool === "claude") return { cmd: "npm", args: ["install", "-g", "@anthropic-ai/claude-code"], label: "npm install -g @anthropic-ai/claude-code" };
  return null;
}

/**
 * Check and fix prerequisites. With `prompt` false (no terminal attached, or --no-setup) it only reports.
 * @returns {Promise<{ ready: boolean, github: boolean }>} ready: the UI can work; github: publishing can work.
 */
export async function setup({ prompt = process.stdin.isTTY && process.stdout.isTTY } = {}) {
  const rl = prompt ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = async (q, def = true) => {
    if (!rl) return false;
    const a = (await rl.question(`    ${q} ${def ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
    return a ? a.startsWith("y") : def;
  };
  const tryInstall = async (tool, why) => {
    const inst = installer(tool);
    if (!inst) { note(`Install it from ${{ git: "https://git-scm.com", gh: "https://cli.github.com", claude: "https://claude.com/claude-code" }[tool]} and run this again.`); return false; }
    if (!(await ask(`${why} Install it now with \`${inst.label}\`?`))) return false;
    return interactive(inst.cmd, inst.args);
  };

  console.log("\nChecking what Plinth needs…\n");
  let ready = true;

  // Node runs this file, so it exists; the version matters.
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) ok(`Node ${process.versions.node}`);
  else { bad(`Node ${process.versions.node}: Plinth needs Node 20 or newer (https://nodejs.org).`); ready = false; }

  // git: every applied change is a commit.
  if (has("git")) ok("git");
  else {
    bad("git is not installed. Every change you apply is saved as a git version.");
    if (await tryInstall("git", "")) { note("Installed. Close this window, open a new one and run the same command again, so git is on the PATH."); }
    ready = false;
  }

  // Claude Code, installed and signed in: it drives the chat.
  let claude = has("claude");
  if (!claude) {
    bad("Claude Code is not installed. The chat in Plinth runs Claude Code on this computer.");
    claude = (await tryInstall("claude", "")) && has("claude");
  }
  if (claude) {
    if (claudeSignedIn()) ok("Claude Code, signed in");
    else {
      bad("Claude Code is not signed in.");
      if (await ask("Sign in now? A browser window opens.")) interactive("claude", ["auth", "login"]);
      if (claudeSignedIn()) ok("Claude Code, signed in");
      else { note("Run `claude auth login`, or sign in later; the chat will tell you if it cannot reach Claude."); ready = false; }
    }
  } else ready = false;

  // GitHub: only for publishing.
  let github = false;
  if (!findGh()) {
    bad("GitHub CLI is not installed (only needed to publish to GitHub and Storybook).");
    if (await tryInstall("gh", "")) note("Installed.");
  }
  if (findGh()) {
    let s = githubStatus();
    if (s.authed && s.scopesOk) { ok(`GitHub, connected as ${s.user ?? "your account"}${s.plan ? ` (${s.plan} plan)` : ""}`); github = true; }
    else {
      bad(s.authed ? `GitHub is connected but cannot push the Storybook workflow yet (missing: ${s.missingScopes.join(", ")}).` : "GitHub is not connected (only needed to publish).");
      if (await ask(s.authed ? "Grant the missing permission now? A browser window opens." : "Connect GitHub now? A browser window opens; enter the code shown here.")) {
        const args = s.authed
          ? ["auth", "refresh", "--hostname", "github.com", "--scopes", REQUIRED_SCOPES.join(",")]
          : ["auth", "login", "--web", "--hostname", "github.com", "--git-protocol", "https", "--scopes", REQUIRED_SCOPES.join(",")];
        interactive(findGh(), args);
        ghSync(["auth", "setup-git", "--hostname", "github.com"]);
        s = githubStatus();
      }
      if (s.authed && s.scopesOk) { ok(`GitHub, connected as ${s.user ?? "your account"}${s.plan ? ` (${s.plan} plan)` : ""}`); github = true; }
      else note("You can connect later from the Publish dialog in the UI.");
    }
    if (github && s.plan === "free") note("Free GitHub plan: publish as a public repository, since GitHub Pages does not serve private ones on this plan.");
  }

  rl?.close();
  console.log(ready ? (github ? "\nAll set.\n" : "\nReady. Connect GitHub when you want to publish.\n") :"\nSome required items are missing; the UI opens anyway and shows what does not work yet.\n");
  return { ready, github };
}
