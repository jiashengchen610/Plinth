// GitHub connection for publishing, without a terminal: the UI starts the GitHub CLI's device login, shows the
// one-time code, opens github.com/login/device in the browser, and learns when the user has authorized.
// Plinth never sees a password or token; gh stores the credential as it always does.
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

// A terminal opened before the GitHub CLI was installed has no gh on PATH; on Windows try the installer's location.
const CANDIDATES = ["gh", ...(process.platform === "win32" ? [join(process.env.ProgramFiles ?? "C:\\Program Files", "GitHub CLI", "gh.exe")] : [])];
// Pushing .github/workflows needs "workflow"; "repo" covers creating the repo and enabling Pages.
export const REQUIRED_SCOPES = ["repo", "workflow"];
let bin = null;

export function findGh() {
  if (bin) return bin;
  for (const c of CANDIDATES) {
    const r = spawnSync(c, ["--version"], { stdio: "ignore", windowsHide: true });
    if (r.status === 0) { bin = c; return c; }
  }
  return null;
}

/** Run gh to completion; { status, out } with stdout and stderr together (gh prints status to either). */
export function ghSync(args, cwd) {
  const r = spawnSync(findGh() ?? "gh", args, { cwd, encoding: "utf8", windowsHide: true });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/** Who is signed in, with which scopes and plan. Never throws. */
export function githubStatus() {
  if (!findGh()) return { installed: false, authed: false, user: null, scopesOk: false, missingScopes: REQUIRED_SCOPES, plan: null };
  const st = ghSync(["auth", "status", "--hostname", "github.com"]);
  if (st.status !== 0) return { installed: true, authed: false, user: null, scopesOk: false, missingScopes: REQUIRED_SCOPES, plan: null };
  const scopes = (st.out.match(/Token scopes:\s*(.+)/)?.[1] ?? "").replace(/'/g, "").split(/,\s*/).filter(Boolean);
  // Fine-grained tokens and some auth methods report no scopes; treat "none listed" as unknown, not missing.
  const missingScopes = scopes.length ? REQUIRED_SCOPES.filter((s) => !scopes.includes(s)) : [];
  let user = null, plan = null;
  const u = ghSync(["api", "user"]);
  if (u.status === 0) { try { const j = JSON.parse(u.out); user = j.login ?? null; plan = j.plan?.name ?? null; } catch { /* offline */ } }
  return { installed: true, authed: true, user, scopesOk: missingScopes.length === 0, missingScopes, plan };
}

function openBrowser(url) {
  if (process.env.PLINTH_NO_BROWSER) return;
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).unref(); } catch { /* the URL is shown in the UI */ }
}

/** Device login (or a scope refresh for an existing login), driven from the UI. */
export function createGithubLogin(bump = () => {}) {
  let child = null;
  let state = { status: "idle" }; // idle | waiting | done | error

  const set = (s) => { state = s; bump(); };
  return {
    state: () => state,
    start() {
      if (child) return state;
      const gh = findGh();
      if (!gh) { set({ status: "error", error: "The GitHub CLI is not installed." }); return state; }
      const current = githubStatus();
      const args = current.authed
        ? ["auth", "refresh", "--hostname", "github.com", "--scopes", REQUIRED_SCOPES.join(",")]
        : ["auth", "login", "--web", "--hostname", "github.com", "--git-protocol", "https", "--scopes", REQUIRED_SCOPES.join(",")];
      child = spawn(gh, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let opened = false;
      const onData = (d) => {
        out += d;
        const code = out.match(/code[^A-Z0-9]*\(?([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1];
        const url = out.match(/https:\/\/github\.com\/login\/device\S*/)?.[0];
        if (code && url && !opened) { opened = true; set({ status: "waiting", code, url, since: Date.now() }); openBrowser(url); }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("close", (code) => {
        child = null;
        if (code === 0) {
          // Let git push over HTTPS with the same credential.
          ghSync(["auth", "setup-git", "--hostname", "github.com"]);
          set({ status: "done" });
        } else if (state.status !== "idle") {
          set({ status: "error", error: out.trim().split("\n").slice(-3).join(" ") || `GitHub login stopped (${code}).` });
        }
      });
      set({ status: "starting" });
      return state;
    },
    cancel() {
      const c = child;
      child = null;
      state = { status: "idle" };
      if (c) { if (process.platform === "win32") spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { windowsHide: true }); else c.kill("SIGTERM"); }
      bump();
      return state;
    },
    stop() { if (child) this.cancel(); },
  };
}
