// Publish a workspace: checks → exports → commit → typecheck and story tests → push → GitHub Pages.
// Uses git and the GitHub CLI (gh). Reports every step so the UI can show progress and where it stopped.
import { execFileSync, execFile } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runChecks } from "../engine/checks.mjs";
import { checkRepo } from "../engine/check.mjs";
import { composeDesignMd, lintDesignMd } from "../engine/design-md.mjs";
import { listBrands, loadConfig } from "../engine/tokens.mjs";
import { git, regenerate, unsavedChanges, gitCommit, GENERATED } from "../engine/workspace.mjs";
import { findGh, githubStatus } from "./github.mjs";

function gh(root, args) {
  return execFileSync(findGh() ?? "gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
}
/** gh without blocking the server: for status polled while the UI is open. */
function ghAsync(root, args) {
  return new Promise((resolve, reject) => execFile(findGh() ?? "gh", args, { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (e, out, err) => (e ? reject(Object.assign(e, { stderr: err })) : resolve(out.trim()))));
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

  // 0. Publishing pushes saved versions: unsaved work is saved (or discarded) first, by the user.
  const generated = (f) => GENERATED.some((g) => f === g || f.startsWith(`${g}/`)) || f.startsWith("exports/");
  const unsaved = unsavedChanges(root).filter((c) => !generated(c.file));
  if (unsaved.length) {
    step("unsaved changes", unsaved.map((o) => o.file), false);
    return stop("unsaved", { unsaved, error: `${unsaved.length} unsaved change${unsaved.length > 1 ? "s" : ""}.`, next: "Save them as a version (or discard them), then publish again." });
  }

  // 1. The same checks the deploy workflow runs (plinth check): broken token references and components outside the
  //    component format stop here, so they never reach GitHub. Design findings are reminders.
  regenerate(root);
  const checks = runChecks(root);
  const repoCheck = checkRepo(root);
  if (!repoCheck.ok) {
    step("checks", repoCheck.blocking.map((b) => b.detail), false);
    return stop("checks", { blocking: repoCheck.blocking, tokenIssues: checks.tokenIssues, next: "Fix these first (ask Claude in the chat): GitHub would refuse to deploy them. Then publish again." });
  }
  step("checks", { ...checks.summary, exceptions: checks.exceptions.length, warnings: checks.warnings });

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

  // 3. Commit what publishing wrote: exports and regenerated or Plinth-managed files.
  gitCommit(root, "Publish: update exports", ["exports", ...GENERATED]);
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
    // What the next review starts from, should the remote branch go away.
    mkdirSync(join(root, ".ds"), { recursive: true });
    writeFileSync(join(root, ".ds", "published.json"), JSON.stringify({ sha: git(root, ["rev-parse", "HEAD"]), at: new Date().toISOString() }) + "\n");
  } catch (e) {
    const msg = errText(e);
    step("push", msg, false);
    return stop("github", { error: msg, next: "Check your GitHub access, then publish again. Local work is unaffected." });
  }

  const result = { published: true, warnings: checks.warnings, version: head, repo: full, github: `https://github.com/${full}`, actions: `https://github.com/${full}/actions`, storybook: pages.url ?? null, steps };
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

/**
 * What GitHub did with the last publish: the newest Storybook workflow run for the pushed commit. The push alone
 * does not put anything online; the workflow tests first and deploys only if everything passes.
 * { status: "waiting" | "running" | "live" | "failed" | "unknown", sha, run, site, step, failures, errors }
 */
export async function deployStatus(root, { after = 0 } = {}) {
  let pub;
  try { pub = JSON.parse(readFileSync(join(root, ".ds", "published.json"), "utf8")); } catch { return null; }
  const full = repoFromUrl(remoteUrl(root));
  if (!full) return null;
  const base = { sha: pub.sha, pushedAt: pub.at, actions: `https://github.com/${full}/actions` };
  let run;
  try { run = JSON.parse(await ghAsync(root, ["run", "list", "-R", full, "--commit", pub.sha, "--workflow", "storybook.yml", "--limit", "1", "--json", "databaseId,status,conclusion,url,createdAt"]))[0]; }
  catch (e) { return { ...base, status: "unknown", error: errText(e) }; }
  // After "Try again" GitHub lists the old run as newest for a few seconds: until the new one shows, wait.
  if (!run || (after && Date.parse(run.createdAt) < after - 30_000)) return { ...base, status: "waiting" };
  const common = { ...base, run: run.url, runId: run.databaseId, since: run.createdAt };
  if (run.status !== "completed") return { ...common, status: "running" };
  if (run.conclusion === "success") {
    let site = null;
    try { site = JSON.parse(await ghAsync(root, ["api", `repos/${full}/pages`])).html_url ?? null; } catch { /* Pages off since */ }
    return { ...common, status: "live", site };
  }
  let log = "";
  try { log = await ghAsync(root, ["run", "view", String(run.databaseId), "-R", full, "--log-failed"]); } catch { /* summary without details */ }
  return { ...common, status: "failed", conclusion: run.conclusion, ...failureSummary(log) };
}

/**
 * The failing step and story tests of a failed run, from `gh run view --log-failed` (lines are
 * "job<TAB>step<TAB>timestamp text"). Story test failures read "FAIL  storybook (chromium) src/… > Story name".
 */
export function failureSummary(log) {
  // Color codes arrive as escape characters, or written out as "^[[31m" (gh on Windows).
  const lines = String(log).replace(/(?:\x1b|\^\[)\[[0-9;]*m/g, "").split(/\r?\n/).map((l) => { const [, step, ...rest] = l.split("\t"); return { step, text: rest.join("\t").replace(/^\S+Z\s?/, "") }; });
  const errorLine = lines.find((l) => /##\[error\]/.test(l.text));
  const step = (errorLine ?? lines.find((l) => l.step))?.step ?? null;
  const failures = [...new Set(lines.map((l) => /FAIL\s+(?:\S+\s+\([^)]+\)\s+)?(src\/\S+)\s+>\s+(.+?)\s*$/.exec(l.text)).filter(Boolean).map((m) => `${m[1]} › ${m[2]}`))];
  const errors = [...new Set(lines.filter((l) => /##\[error\]/.test(l.text)).map((l) => l.text.replace(/^.*##\[error\]/, "").trim()).filter((t) => t && !/^Process completed with exit code/.test(t) && !/^Error:\s*$/.test(t)))].slice(0, 5);
  return { step, failures: failures.slice(0, 10), errors };
}

/** Run the Storybook workflow again (after fixing Pages or a failed run). */
export function redeploy(root, { full = repoFromUrl(remoteUrl(root)), pages } = {}) {
  if (!full) throw new Error("This design system has not been published to GitHub yet.");
  gh(root, ["workflow", "run", "storybook.yml", "-R", full, "--ref", "main"]);
  const url = pages?.url ?? (() => { try { return JSON.parse(gh(root, ["api", `repos/${full}/pages`])).html_url ?? null; } catch { return null; } })();
  return { github: `https://github.com/${full}`, actions: `https://github.com/${full}/actions`, storybook: url, note: "Storybook is building on GitHub Actions; it is live in a few minutes." };
}
