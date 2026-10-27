// Publish a workspace: checks → exports → commit → typecheck and story tests → push → GitHub Pages.
// Uses git and the GitHub CLI (gh). Reports every step so the UI can show progress and where it stopped.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { runChecks } from "../engine/checks.mjs";
import { composeDesignMd, lintDesignMd } from "../engine/design-md.mjs";
import { listBrands, loadConfig } from "../engine/tokens.mjs";
import { git, regenerate, TEMPLATE_DIR } from "../engine/workspace.mjs";
import { findGh, githubStatus } from "./github.mjs";

function gh(root, args) {
  return execFileSync(findGh() ?? "gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
}
function hasGh() {
  return findGh() !== null;
}
function ghAuthed(root) {
  try { gh(root, ["auth", "status", "--hostname", "github.com"]); return true; } catch { return false; }
}
function remoteUrl(root) {
  try { return git(root, ["remote", "get-url", "origin"]); } catch { return null; }
}
const repoFromUrl = (u) => u?.match(/github\.com[:/]([^/]+\/[^/.]+?)(\.git)?$/)?.[1] ?? null;

/**
 * What the Publish dialog needs before the first push. GitHub Pages on a private repository needs a paid plan,
 * so on the free plan the suggested visibility is public.
 */
export function publishDefaults(root) {
  const s = githubStatus();
  const remote = remoteUrl(root);
  let name = "design-system";
  try { name = loadConfig(root).name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || name; } catch { /* no workspace */ }
  const freePlan = s.plan === "free";
  return {
    ghInstalled: s.installed, ghAuthed: s.authed, scopesOk: s.scopesOk, missingScopes: s.missingScopes, user: s.user, plan: s.plan,
    // GitHub does not always report the plan (null); then Pages on a private repository may not work, so suggest public.
    privatePagesAllowed: s.plan === null ? null : !freePlan,
    suggestedVisibility: s.plan && !freePlan ? "private" : "public",
    remote, repo: repoFromUrl(remote), suggestedRepo: s.user ? `${s.user}/${name}` : name,
    ...remoteInfo(root, repoFromUrl(remote), s.authed),
  };
}

/** For a repository that already exists: its visibility and whether Pages is on (null when unknown). */
function remoteInfo(root, full, authed) {
  if (!full || !authed) return { visibility: null, pagesEnabled: null };
  let visibility = null, pagesEnabled = null;
  try { visibility = JSON.parse(gh(root, ["repo", "view", full, "--json", "visibility"])).visibility ?? null; } catch { /* offline */ }
  try { gh(root, ["api", `repos/${full}/pages`]); pagesEnabled = true; } catch (e) { pagesEnabled = /Not Found|404/.test(errText(e)) ? false : null; }
  return { visibility, pagesEnabled };
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

  // The deploy workflow is Plinth's, not the user's design: keep it current so fixes reach published repositories.
  const managed = join(TEMPLATE_DIR, ".github", "workflows", "storybook.yml");
  const target = join(root, ".github", "workflows", "storybook.yml");
  if (existsSync(managed) && (!existsSync(target) || readFileSync(target, "utf8") !== readFileSync(managed, "utf8"))) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(managed, target);
    step("workflow", "updated .github/workflows/storybook.yml");
  }

  // 3. Commit anything outstanding (exports, regenerated CSS, workflow)
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
  if (!hasGh()) return stop("github", { error: "The GitHub CLI is not installed.", next: "Install it from https://cli.github.com (Windows installer), then press Connect GitHub in the Publish dialog." });
  if (!ghAuthed(root)) return stop("github", { error: "GitHub is not connected or the sign-in expired.", next: "Press Connect GitHub in the Publish dialog (or ask Claude to publish again after connecting). Local work is unaffected." });
  const scope = githubStatus();
  if (!scope.scopesOk) return stop("github", { error: `The GitHub sign-in is missing permission: ${scope.missingScopes.join(", ")} (needed to push the Storybook workflow).`, next: "Press Connect GitHub in the Publish dialog to grant it." });

  // 6. Repository, then Pages, then the push: the push starts the workflow, which can only deploy once Pages is on.
  let url = remoteUrl(root);
  let created = false;
  try {
    if (!url) {
      if (!repo) return stop("github", { error: "No GitHub repository yet.", next: "Publish again with repo: \"<owner>/<name>\"." });
      gh(root, ["repo", "create", repo, `--${visibility}`, "--source", ".", "--remote", "origin"]);
      url = remoteUrl(root);
      created = true;
      step("create repository", { repo, visibility });
    }
  } catch (e) {
    const msg = errText(e);
    step("create repository", msg, false);
    return stop("github", { error: msg, next: "Check the repository name (it may already exist on your account) and publish again." });
  }
  const full = repoFromUrl(url);

  const pages = enablePages(root, full);
  if (pages.ok) step("pages", { url: pages.url });
  else step("pages", pages.error, false);

  try {
    git(root, ["push", "-u", "origin", "HEAD"]);
    step("push", { remote: url, created });
  } catch (e) {
    const msg = errText(e);
    step("push", msg, false);
    return stop("github", { error: msg, next: "Check your GitHub access, then publish again. Local work is unaffected." });
  }

  const result = { published: true, version: head, repo: full, github: `https://github.com/${full}`, actions: `https://github.com/${full}/actions`, storybook: pages.url ?? null, steps };
  if (pages.ok) return { ...result, note: "Storybook deploys through GitHub Actions after the tests pass there; it is live a few minutes after the push." };
  return { ...result, pagesBlocked: pages.blocked, note: pages.blocked === "plan" ? "The code is on GitHub, but your GitHub plan does not serve Pages for private repositories, so Storybook is not online. Make the repository public to deploy it, or keep it private without a Storybook site." : `The code is on GitHub, but Storybook could not be deployed: ${pages.error}` };
}

const errText = (e) => (e.stderr?.toString().trim() || e.message).split("\n").filter(Boolean).slice(-3).join(" ").replace(/^gh: /, "");

/** Turn on GitHub Pages with GitHub Actions as the source. Idempotent. */
function enablePages(root, full) {
  let createError = null;
  try { gh(root, ["api", "--method", "POST", `repos/${full}/pages`, "-f", "build_type=workflow"]); }
  catch (e) { createError = errText(e); }
  try {
    const p = JSON.parse(gh(root, ["api", `repos/${full}/pages`]));
    // An older site may build from a branch; the workflow needs the Actions source.
    if (p.build_type !== "workflow") gh(root, ["api", "--method", "PUT", `repos/${full}/pages`, "-f", "build_type=workflow"]);
    return { ok: true, url: p.html_url ?? null };
  } catch {
    const blocked = /plan does not support GitHub Pages/i.test(createError ?? "") ? "plan" : null;
    return { ok: false, blocked, url: null, error: createError ?? "GitHub Pages is not available for this repository." };
  }
}

/**
 * After a publish that could not deploy because the repository is private on a plan without private Pages: make it
 * public, turn Pages on and run the Storybook workflow again. Nothing is pushed.
 */
export function makePublicAndDeploy(root) {
  const full = repoFromUrl(remoteUrl(root));
  if (!full) throw new Error("This design system has not been published to GitHub yet.");
  gh(root, ["repo", "edit", full, "--visibility", "public", "--accept-visibility-change-consequences"]);
  const pages = enablePages(root, full);
  if (!pages.ok) throw new Error(pages.error);
  return redeploy(root, { full, pages });
}

/** Run the Storybook workflow again (after fixing Pages or a failed run). */
export function redeploy(root, { full = repoFromUrl(remoteUrl(root)), pages } = {}) {
  if (!full) throw new Error("This design system has not been published to GitHub yet.");
  gh(root, ["workflow", "run", "storybook.yml", "-R", full, "--ref", "main"]);
  const url = pages?.url ?? (() => { try { return JSON.parse(gh(root, ["api", `repos/${full}/pages`])).html_url ?? null; } catch { return null; } })();
  return { github: `https://github.com/${full}`, actions: `https://github.com/${full}/actions`, storybook: url, note: "Storybook is building on GitHub Actions; it is live in a few minutes." };
}
