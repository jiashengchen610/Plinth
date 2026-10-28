// The workspace's own quality tests: TypeScript (npm run typecheck) and every story's interaction and
// accessibility tests in a real browser (npm test). Slow (about a minute), so they run on demand and before
// publishing, never on every change. Story tests that fail run once more: a test that passes then is a timing fluke
// (an animation, a busy machine), reported as flaky, and does not stop a publish. The last result is kept in
// .ds/tests.json for the UI, the status tool and Claude, also after a restart.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./storybook.mjs";

const FILE = (root) => join(root, ".ds", "tests.json");
const readLast = (root) => { try { return JSON.parse(readFileSync(FILE(root), "utf8")); } catch { return null; } };

/** "FAIL  |storybook (chromium)| src/components/badge/badge.stories.tsx > Destructive", then the rule that failed. */
const failuresOf = (output) => [...output.matchAll(/^\s*FAIL\s+(?:\|[^|]*\|\s*)?(.+?)\s*\n(?:\s*\n)*\s*"?([^"\n]*)"?/gm)]
  .map((m) => `${m[1].replace(/^src\/components\//, "")}${m[2] ? ` — ${m[2]}` : ""}`).slice(0, 20);

export function createTests(root, deps, bump = () => {}) {
  let running = null;
  let last = readLast(root);
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
        let tests = await run("npm", ["test"], root, { timeout: 10 * 60 * 1000 });
        let flaky = [];
        if (tests.code !== 0) {
          const first = failuresOf(tests.output);
          const again = await run("npm", ["test"], root, { timeout: 10 * 60 * 1000 });
          if (again.code === 0) flaky = first.length ? first : ["a story test (its name was not in the output)"];
          tests = again;
        }
        const counts = tests.output.match(/Tests\s+(?:(\d+) failed[^\n]*?\|\s*)?(\d+) passed \((\d+)\)/);
        const failedCount = counts ? Number(counts[1] ?? 0) : null;
        return {
          ok: typecheck.code === 0 && tests.code === 0,
          at: startedAt,
          typecheck: { ok: typecheck.code === 0, tail: typecheck.code === 0 ? undefined : typecheck.tail },
          tests: { ok: tests.code === 0, passed: counts ? Number(counts[2]) : null, failed: failedCount, total: counts ? Number(counts[3]) : null, failures: failuresOf(tests.output), flaky, tail: tests.code === 0 ? undefined : tests.tail },
        };
      })().then((r) => {
        last = r; running = null;
        try { if (existsSync(join(root, ".git"))) { mkdirSync(join(root, ".ds"), { recursive: true }); writeFileSync(FILE(root), JSON.stringify(r, null, 2)); } } catch { /* kept in memory */ }
        bump(); return r;
      });
      return running;
    },
  };
}
