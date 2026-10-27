// The server's shared state: workspace root, child processes over it, the UI, the chat, and the long
// operations (install, tests, publish) whose progress the UI shows.
import { resolve } from "node:path";
import { createDeps, createStorybook, createRemote } from "./storybook.mjs";
import { createTests } from "./tests.mjs";
import { publish as runPublish } from "./publish.mjs";
import { createGithubLogin } from "./github.mjs";

export function createContext({ root = resolve(process.env.PLINTH_WORKSPACE || process.env.CLAUDE_PROJECT_DIR || process.cwd()), child = Boolean(process.env.PLINTH_CHILD) } = {}) {
  const ctx = { root, child, ui: { url: process.env.PLINTH_PARENT_URL || null, token: process.env.PLINTH_PARENT_TOKEN || null }, notify: () => {} };
  const bump = () => ctx.notify();
  if (child) {
    // Tools run inside the headless session the UI spawned: forward long-lived processes to the UI's server.
    Object.assign(ctx, createRemote(root, ctx.ui.url, ctx.ui.token));
  } else {
    ctx.deps = createDeps(root, bump);
    ctx.storybook = createStorybook(root, ctx.deps, bump);
    ctx.tests = createTests(root, ctx.deps, bump);
  }
  ctx.github = createGithubLogin(bump);

  // Publish runs once at a time; its steps stream into state while it runs.
  let running = null;
  let last = null;
  ctx.publish = {
    get running() { return Boolean(running); },
    state() { return { running: Boolean(running), steps: running?.steps ?? last?.steps ?? [], result: running ? null : last, startedAt: running?.startedAt ?? null }; },
    start(opts = {}) {
      if (running) return running.promise;
      const steps = [];
      const promise = runPublish(root, opts, { tests: ctx.tests, onStep: (s) => { steps.push(s); bump(); } })
        .catch((e) => ({ published: false, stoppedAt: "error", error: e.message, steps }))
        .then((r) => { last = { ...r, at: new Date().toISOString() }; running = null; bump(); return last; });
      running = { promise, steps, startedAt: new Date().toISOString() };
      bump();
      return promise;
    },
  };
  return ctx;
}
