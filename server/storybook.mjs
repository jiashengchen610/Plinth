// Manages the workspace's npm install and Storybook dev server as child processes.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";

const isWin = process.platform === "win32";

function freePort(start) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const srv = createServer().once("error", () => tryPort(p + 1)).once("listening", () => srv.close(() => resolve(p)));
      srv.listen(p, "127.0.0.1");
    };
    tryPort(start);
  });
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: isWin, windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, tail: out.split("\n").slice(-15).join("\n") }));
  });
}

export function createStorybook(root, log = () => {}) {
  let child = null;
  let url = null;
  let installing = null;

  const api = {
    get url() { return url; },
    async install() {
      if (installing) return installing;
      installing = run("npm", ["install", "--no-audit", "--no-fund"], root).then((r) => {
        installing = null;
        return r.code === 0 ? { installed: true } : { installed: false, error: r.tail };
      });
      return installing;
    },
    async start() {
      if (url) return { url, alreadyRunning: true };
      if (!existsSync(join(root, "node_modules"))) return { started: false, error: "Dependencies are not installed.", next: "Call install_dependencies first." };
      const port = await freePort(6006);
      child = spawn("npx", ["storybook", "dev", "-p", String(port), "--no-open", "--ci", "--disable-telemetry"], { cwd: root, shell: isWin, windowsHide: true });
      child.on("exit", () => { child = null; url = null; });
      const ready = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 120000);
        const onData = (d) => {
          log(String(d));
          if (/Storybook ready|Local:/.test(String(d))) { clearTimeout(timer); resolve(true); }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("exit", () => { clearTimeout(timer); resolve(false); });
      });
      if (!ready) return { started: false, error: "Storybook did not start within 2 minutes." };
      url = `http://localhost:${port}`;
      return { started: true, url };
    },
    stop() {
      if (!child) return;
      if (isWin) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill("SIGTERM");
    },
  };
  return api;
}

export { freePort };
