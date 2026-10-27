// Child processes over the user's workspace: npm install (plus the Playwright browser the story tests need)
// and the Storybook dev server.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";

/**
 * JSON over HTTP without the global fetch. undici keeps sockets alive; a synchronous spawn (git, npm) while one
 * is closing trips a libuv assertion on Node 24 / Windows and kills the process silently. node:http with
 * agent: false leaves nothing behind.
 */
export function httpJson(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, agent: false, headers: { ...headers, ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) } },
      (res) => {
        let out = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (out += d));
        res.on("end", () => { try { resolve({ status: res.statusCode, json: out ? JSON.parse(out) : {} }); } catch (e) { reject(e); } });
      },
    );
    req.on("error", reject);
    req.end(data);
  });
}

const isWin = process.platform === "win32";

export function freePort(start) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const srv = createServer().once("error", () => tryPort(p + 1)).once("listening", () => srv.close(() => resolve(p)));
      srv.listen(p, "127.0.0.1");
    };
    tryPort(start);
  });
}

/** Run a command to completion; resolves with the exit code and the last lines of output. */
export function run(cmd, args, cwd, { timeout = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: isWin, windowsHide: true, env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
    let out = "";
    const timer = setTimeout(() => { kill(child); out += "\n[timed out]"; }, timeout);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, output: out, tail: out.trim().split("\n").slice(-20).join("\n") }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, output: e.message, tail: e.message }); });
  });
}

export function kill(child) {
  if (!child || child.exitCode !== null) return;
  if (isWin) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  else child.kill("SIGTERM");
}

/** Dependencies of the workspace: installed once, state visible to the UI. */
export function createDeps(root, bump = () => {}) {
  let installing = null;
  let last = null;
  return {
    get installed() { return existsSync(join(root, "node_modules", ".package-lock.json")); },
    get installing() { return Boolean(installing); },
    get last() { return last; },
    state() { return { installed: this.installed, installing: this.installing, error: last && !last.installed ? last.error : null }; },
    async install() {
      if (installing) return installing;
      bump();
      installing = (async () => {
        const npm = await run("npm", ["install", "--no-audit", "--no-fund"], root);
        if (npm.code !== 0) return { installed: false, error: npm.tail };
        // Story tests run in a real browser; a missing one is the most common reason "npm test" fails locally.
        const pw = await run("npx", ["playwright", "install", "chromium"], root);
        return { installed: true, browser: pw.code === 0, note: pw.code === 0 ? undefined : `Playwright browser install failed: ${pw.tail}` };
      })().then((r) => { last = r; installing = null; bump(); return r; });
      return installing;
    },
  };
}

/** The workspace's Storybook dev server. */
export function createStorybook(root, deps, bump = () => {}) {
  let child = null;
  let url = null;
  let starting = null;
  return {
    get url() { return url; },
    get starting() { return Boolean(starting); },
    async start() {
      if (url) return { url, alreadyRunning: true };
      if (starting) return starting;
      if (!deps.installed) return { started: false, error: "Dependencies are not installed.", next: "Call install_dependencies first." };
      starting = (async () => {
        const port = await freePort(6006);
        child = spawn("npx", ["storybook", "dev", "-p", String(port), "--no-open", "--ci", "--disable-telemetry"], { cwd: root, shell: isWin, windowsHide: true, env: { ...process.env, FORCE_COLOR: "0" } });
        child.on("exit", () => { child = null; url = null; bump(); });
        let log = "";
        const ready = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), 120000);
          const onData = (d) => {
            log += d;
            if (/Storybook ready|Local:/.test(String(d))) { clearTimeout(timer); resolve(true); }
          };
          child.stdout.on("data", onData);
          child.stderr.on("data", onData);
          child.on("exit", () => { clearTimeout(timer); resolve(false); });
        });
        if (!ready) { kill(child); return { started: false, error: "Storybook did not start within 2 minutes.", log: log.trim().split("\n").slice(-15).join("\n") }; }
        url = `http://localhost:${port}`;
        return { started: true, url };
      })().then((r) => { starting = null; bump(); return r; });
      return starting;
    },
    stop() { kill(child); child = null; url = null; },
  };
}

/**
 * Inside the headless Claude session the Plinth UI spawns, a second server instance runs for the tools.
 * Long-lived processes (install, Storybook, tests) stay with the UI's server; this proxy forwards to it.
 * Nothing is requested at construction: the first request happens inside a tool call, on demand.
 */
export function createRemote(root, parentUrl, token) {
  const call = async (path, method = "POST") => {
    if (!parentUrl) throw new Error("The Plinth UI server is not reachable from this session.");
    const r = await httpJson(new URL(path, parentUrl).href, { method, headers: { "X-Plinth-Token": token } });
    if (r.status >= 400) throw new Error(r.json.error ?? `Plinth UI server answered ${r.status}`);
    return r.json;
  };
  let url = null;
  const deps = {
    get installed() { return existsSync(join(root, "node_modules", ".package-lock.json")); },
    installing: false,
    state: () => ({}),
    install: () => call("api/install?wait=1"),
  };
  const storybook = {
    get url() { return url; },
    async refresh() { try { url = (await call("api/state", "GET")).storybook ?? null; } catch { /* parent gone */ } return url; },
    async start() { const r = await call("api/storybook/start"); url = r.url ?? url; return r; },
    stop() {},
  };
  const tests = { running: false, last: null, state: () => ({}), run: () => call("api/tests?wait=1") };
  return { deps, storybook, tests };
}
