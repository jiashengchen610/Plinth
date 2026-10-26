// The workspace's own quality tests: TypeScript (npm run typecheck) and every story's interaction and
// accessibility tests in a real browser (npm test). Slow (about a minute), so they run on demand and before
// publishing, never on every change; the last result is kept for the UI and the status tool.
import { run } from "./storybook.mjs";

export function createTests(root, deps, bump = () => {}) {
  let running = null;
  let last = null;
  return {
    get running() { return Boolean(running); },
    get last() { return last; },
    state() { return { running: this.running, last }; },
    async run() {
      if (running) return running;
      if (!deps.installed) return { ok: false, error: "Dependencies are not installed.", next: "Call install_dependencies first." };
      bump();
      running = (async () => {
        const startedAt = new Date().toISOString();
        const typecheck = await run("npm", ["run", "typecheck"], root, { timeout: 5 * 60 * 1000 });
        const tests = await run("npm", ["test"], root, { timeout: 10 * 60 * 1000 });
        const counts = tests.output.match(/Tests\s+(?:(\d+) failed[^\n]*?\|\s*)?(\d+) passed \((\d+)\)/);
        const failedCount = counts ? Number(counts[1] ?? 0) : null;
        const failures = [...tests.output.matchAll(/^\s*(?:×|✗|✖|FAIL)\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 20);
        return {
          ok: typecheck.code === 0 && tests.code === 0,
          at: startedAt,
          typecheck: { ok: typecheck.code === 0, tail: typecheck.code === 0 ? undefined : typecheck.tail },
          tests: { ok: tests.code === 0, passed: counts ? Number(counts[2]) : null, failed: failedCount, total: counts ? Number(counts[3]) : null, failures, tail: tests.code === 0 ? undefined : tests.tail },
        };
      })().then((r) => { last = r; running = null; bump(); return r; });
      return running;
    },
  };
}
