// Publish a workspace: gate → exports → commit → push → GitHub Pages. Uses git and the GitHub CLI (gh).
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runChecks } from "../engine/checks.mjs";
import { composeDesignMd, lintDesignMd } from "../engine/design-md.mjs";
import { listBrands, loadConfig } from "../engine/tokens.mjs";
import { git, regenerate } from "../engine/workspace.mjs";

function gh(root, args) {
  return execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function hasGh() {
  try { execFileSync("gh", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}
function ghAuthed(root) {
  try { gh(root, ["auth", "status", "--hostname", "github.com"]); return true; } catch { return false; }
}
function remoteUrl(root) {
  try { return git(root, ["remote", "get-url", "origin"]); } catch { return null; }
}
const repoFromUrl = (u) => u?.match(/github\.com[:/]([^/]+\/[^/.]+?)(\.git)?$/)?.[1] ?? null;

export async function publish(root, { repo, visibility = "private", dryRun = false } = {}) {
  const steps = [];
  const step = (name, detail) => steps.push({ name, ok: true, detail });

  // 1. Quality gate
  regenerate(root);
  const checks = runChecks(root);
  if (!checks.gate) {
    return { published: false, stoppedAt: "quality gate", summary: checks.summary, contrastFailures: checks.contrast.filter((c) => !c.pass).slice(0, 20), hardcoded: checks.hardcoded.slice(0, 20), tokenIssues: checks.tokenIssues, next: "Fix the failures (propose_contrast_fixes for contrast), then publish again." };
  }
  step("quality gate", checks.summary);

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

  if (dryRun) return { published: false, dryRun: true, steps, next: "Run publish without dryRun to push." };

  // 4. GitHub
  if (!hasGh()) return { published: false, stoppedAt: "github", steps, error: "The GitHub CLI (gh) is not installed.", next: "Install it from https://cli.github.com, then run: gh auth login --web" };
  if (!ghAuthed(root)) return { published: false, stoppedAt: "github", steps, error: "GitHub is not connected or the sign-in expired.", next: "Reconnect GitHub: run `gh auth login --web` and finish in the browser. Local work is unaffected; publish again afterwards." };

  let url = remoteUrl(root);
  if (!url) {
    if (!repo) return { published: false, stoppedAt: "github", steps, error: "No GitHub repository yet.", next: "Publish again with repo: \"<owner>/<name>\"." };
    gh(root, ["repo", "create", repo, `--${visibility}`, "--source", ".", "--remote", "origin", "--push"]);
    url = remoteUrl(root);
    step("create repository", { repo });
  } else {
    git(root, ["push", "-u", "origin", "HEAD"]);
    step("push", { remote: url });
  }
  const full = repoFromUrl(url);

  // 5. GitHub Pages via Actions (idempotent: ignore "already enabled")
  let pagesUrl = null;
  try {
    gh(root, ["api", "--method", "POST", `repos/${full}/pages`, "-f", "build_type=workflow"]);
  } catch { /* already enabled, or no permission: reported below */ }
  try {
    pagesUrl = JSON.parse(gh(root, ["api", `repos/${full}/pages`])).html_url ?? null;
    step("pages", { url: pagesUrl });
  } catch (e) {
    steps.push({ name: "pages", ok: false, detail: "Could not enable GitHub Pages. In the repository settings, set Pages → Source to GitHub Actions." });
  }
  return { published: true, version: head, github: `https://github.com/${full}`, storybook: pagesUrl, steps, note: "Storybook deploys through GitHub Actions; it is live a few minutes after the push." };
}
