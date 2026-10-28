// The server's shared state: workspace root, child processes over it, the UI, the chat, the review at publish, and
// the long operations (install, tests, publish) whose progress the UI shows.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDeps, createStorybook } from "./storybook.mjs";
import { createTests } from "./tests.mjs";
import { publish as runPublish } from "./publish.mjs";
import { createGithubLogin } from "./github.mjs";

export function createContext({ root = resolve(process.env.PLINTH_WORKSPACE || process.env.CLAUDE_PROJECT_DIR || process.cwd()) } = {}) {
  const ctx = { root, ui: { url: null, token: null }, notify: () => {} };
  const bump = () => ctx.notify();
  ctx.deps = createDeps(root, bump);
  ctx.storybook = createStorybook(root, ctx.deps, bump);
  ctx.tests = createTests(root, ctx.deps, bump);
  ctx.github = createGithubLogin(bump);

  // Publish runs once at a time; its steps stream into state while it runs. The last result is kept in
  // .ds/publish.json, so what stopped it (the step, the failing tests) is still there after a restart, for Claude too.
  let running = null;
  let last = null;
  try { last = JSON.parse(readFileSync(join(root, ".ds", "publish.json"), "utf8")); } catch { /* none yet */ }
  const keep = (r) => { try { if (existsSync(join(root, ".git"))) { mkdirSync(join(root, ".ds"), { recursive: true }); writeFileSync(join(root, ".ds", "publish.json"), JSON.stringify(r, null, 2)); } } catch { /* kept in memory */ } };
  ctx.publish = {
    get running() { return Boolean(running); },
    get last() { return last; },
    state() { return { running: Boolean(running), steps: running?.steps ?? last?.steps ?? [], result: running ? null : last, startedAt: running?.startedAt ?? null }; },
    start(opts = {}) {
      if (running) return running.promise;
      const steps = [];
      const promise = runPublish(root, opts, { tests: ctx.tests, onStep: (s) => { steps.push(s); bump(); } })
        .catch((e) => ({ published: false, stoppedAt: "error", error: e.message, steps }))
        .then((r) => { last = { ...r, at: new Date().toISOString() }; running = null; keep(last); bump(); return last; });
      running = { promise, steps, startedAt: new Date().toISOString() };
      bump();
      return promise;
    },
  };
  return ctx;
}
