// One Plinth per folder. The first process that starts for a workspace (the `plinth` launcher, or the MCP server of
// a Claude Code session) serves the UI and owns the long-lived work: file writes and their undo history, installs,
// Storybook, tests, publish. It records itself in .ds/server.json. Every later one (another Claude Code session, the
// UI chat's headless session, a product repo connected to this folder) forwards its tool calls there.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { httpJson } from "./storybook.mjs";

const lockPath = (root) => join(root, ".ds", "server.json");

/** The process serving this workspace, if it is another one and it answers. */
export async function findOwner(root) {
  let lock;
  try { lock = JSON.parse(readFileSync(lockPath(root), "utf8")); } catch { return null; }
  if (lock.pid === process.pid || !lock.url || !lock.token) return null;
  try {
    const r = await httpJson(new URL("api/rev", lock.url).href, { headers: { "X-Plinth-Token": lock.token }, timeout: 2000 });
    return r.status === 200 ? lock : null;
  } catch { return null; }
}

export function claimOwner(root, { url, token }) {
  mkdirSync(join(root, ".ds"), { recursive: true });
  writeFileSync(lockPath(root), JSON.stringify({ pid: process.pid, url, token, at: new Date().toISOString() }) + "\n");
}

export function releaseOwner(root) {
  try { if (JSON.parse(readFileSync(lockPath(root), "utf8")).pid === process.pid) rmSync(lockPath(root), { force: true }); } catch { /* gone */ }
}

/** Run a tool in the owner. A tool's own error comes back as `toolError`; anything else means the owner is gone. */
export async function callOwner(owner, name, args) {
  const r = await httpJson(new URL(`api/tools/${encodeURIComponent(name)}`, owner.url).href, { method: "POST", headers: { "X-Plinth-Token": owner.token }, body: args ?? {} });
  if (r.status >= 400) {
    const e = new Error(r.json.error ?? `Plinth answered ${r.status}`);
    e.toolError = r.status !== 401;
    throw e;
  }
  return r.json;
}
