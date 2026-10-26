// Publish a workspace: checks → exports → commit → typecheck and story tests → push → GitHub Pages.
// Uses git and the GitHub CLI (gh). Reports every step so the UI can show progress and where it stopped.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runChecks } from "../engine/checks.mjs";
import { composeDesignMd, lintDesignMd } from "../engine/design-md.mjs";
import { listBrands, loadConfig } from "../engine/tokens.mjs";
import { git, regenerate } from "../engine/workspace.mjs";

function gh(root, args) {
  return execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
}
function hasGh() {
  try { execFileSync("gh", ["--version"], { stdio: "ignore", windowsHide: true }); return true; } catch { return false; }
}
function ghAuthed(root) {
  try { gh(root, ["auth", "status", "--hostname", "github.com"]); return true; } catch { return false; }
}
function remoteUrl(root) {
  try { return git(root, ["remote", "get-url", "origin"]); } catch { return null; }
}
const repoFromUrl = (u) => u?.match(/github\.com[:/]([^/]+\/[^/.]+?)(\.git)?$/)?.[1] ?? null;

/** What the Publish dialog needs before the first push. */
export function publishDefaults(root) {
  const installed = hasGh();
  const authed = installed && ghAuthed(root);
  let user = null;
  if (authed) { try { user = JSON.parse(gh(root, ["api", "user"])).login ?? null; } catch { /* offline */ } }
  const remote = remoteUrl(root);
  let name = "design-system";
  try { name = loadConfig(root).name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || name; } catch { /* no workspace */ }
  return { ghInstalled: installed, ghAuthed: authed, user, remote, repo: repoFromUrl(remote), suggestedRepo: user ? `${user}/${name}` : name };
}

/**
 * @param {object} opts { repo, visibility, dryRun }
 * @param {object} deps { tests: createTests(), onStep(step) }
 */
export async function publish(root, { repo, visibility = "private", dryRun = false } = {}, { tests, onStep = () => {} } = {}) {
  const steps = [];
  const step = (name, detail, ok = true) => { const s = { name, ok, detail }; steps.push(s); onStep(s); return s; };
  const stop = (stoppedAt, extra) => ({ published: false, stoppedAt, steps, ...extra });

  // 1. Deterministic checks
  regenerate(root);
  const checks = runChecks(root);
  if (!checks.gate) {
    step("checks", checks.summary, false);
    return stop("checks", { summary: checks.summary, contrastFailures: checks.contrast.filter((c) => !c.pass && !c.accepted).slice(0, 20), distinctFailures: checks.distinct.filter((c) => !c.pass && !c.accepted).slice(0, 20), hardcoded: checks.hardcoded.filter((f) => !f.accepted).slice(0, 20), tokenIssues: checks.tokenIssues, next: "Fix the failures in Checks (or accept them as exceptions), then publish again." });
  }
  step("checks", { ...checks.summary, exceptions: checks.exceptions.length });

  // 2. Exports: one complete DESIGN.md per brand
  const config = loadConfig(root);
  const lint = {};
  for (const brand of listBrands(root, config)) {
    const text = composeDesignMd(root, brand, config);
    mkdirSync(join(root, "exports", brand), { recursive: true });
    writeFileSync(join(root, "exports", brand, "DESIGN.md"), text);
    lint[brand] = lintDesignMd(text);
  }
  step("exports", { files: Object.keys(lint).map((b) => `exports/${b}/DESIGN.md`), lint });

  // 3. Commit anything outstanding (exports, regenerated CSS)
  git(root, ["add", "-A"]);
  if (git(root, ["status", "--porcelain"])) {
    git(root, ["-c", "user.name=Design System", "-c", "user.email=design-system@localhost", "commit", "-q", "-m", "Publish: update exports"]);
  }
  const head = git(root, ["rev-parse", "--short", "HEAD"]);
  step("commit", { version: head });

  // 4. Type check and story tests (interaction + accessibility), when the workspace can run them
  if (tests) {
    const r = await tests.run();
    if (r.error) step("tests", { skipped: r.error });
    else if (!r.ok) {
      step("tests", r, false);
      return stop("tests", { tests: r, next: "Fix the failing tests (ask Claude in the chat), then publish again. GitHub Actions runs the same tests before deploying." });
    } else step("tests", { typecheck: "ok", stories: `${r.tests.passed} passed` });
  }

  if (dryRun) return { published: false, dryRun: true, steps, next: "Run publish without dryRun to push." };

  // 5. GitHub
  if (!hasGh()) return stop("github", { error: "The GitHub CLI (gh) is not installed.", next: "Install it from https://cli.github.com, then run: gh auth login --web" });
  if (!ghAuthed(root)) return stop("github", { error: "GitHub is not connected or the sign-in expired.", next: "Reconnect GitHub: run `gh auth login --web` and finish in the browser. Local work is unaffected; publish again afterwards." });

  let url = remoteUrl(root);
  try {
    if (!url) {
      if (!repo) return stop("github", { error: "No GitHub repository yet.", next: "Publish again with repo: \"<owner>/<name>\"." });
      gh(root, ["repo", "create", repo, `--${visibility}`, "--source", ".", "--remote", "origin", "--push"]);
      url = remoteUrl(root);
      step("create repository", { repo });
    } else {
      git(root, ["push", "-u", "origin", "HEAD"]);
      step("push", { remote: url });
    }
  } catch (e) {
    step("push", e.stderr?.toString().trim() || e.message, false);
    return stop("github", { error: (e.stderr?.toString().trim() || e.message).split("\n").slice(-3).join(" "), next: "Check the repository name and your GitHub access, then publish again." });
  }
  const full = repoFromUrl(url);

  // 6. GitHub Pages via Actions (idempotent: ignore "already enabled")
  let pagesUrl = null;
  try {
    gh(root, ["api", "--method", "POST", `repos/${full}/pages`, "-f", "build_type=workflow"]);
  } catch { /* already enabled, or no permission: reported below */ }
  try {
    pagesUrl = JSON.parse(gh(root, ["api", `repos/${full}/pages`])).html_url ?? null;
    step("pages", { url: pagesUrl });
  } catch {
    step("pages", "Could not enable GitHub Pages. In the repository settings, set Pages → Source to GitHub Actions.", false);
  }
  return { published: true, version: head, github: `https://github.com/${full}`, actions: `https://github.com/${full}/actions`, storybook: pagesUrl, steps, note: "Storybook deploys through GitHub Actions after the tests pass there; it is live a few minutes after the push." };
}
