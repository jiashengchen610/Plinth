// The workspace tests Plinth runs before publishing: a story test that fails once and passes on a second run is a
// timing fluke (reported, not stopping), one that fails twice stops; the last result is kept in .ds/tests.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTests } from "../server/tests.mjs";

// A stand-in workspace: npm run typecheck passes; npm test fails the first `fails` times, then passes.
function workspace(t, fails) {
  const root = mkdtempSync(join(tmpdir(), "plinth-tests-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "w", private: true, scripts: { typecheck: "node ok.mjs", test: "node stories.mjs" } }));
  writeFileSync(join(root, "ok.mjs"), "");
  writeFileSync(join(root, "stories.mjs"), [
    'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
    'const n = existsSync("runs") ? Number(readFileSync("runs", "utf8")) : 0;',
    'writeFileSync("runs", String(n + 1));',
    `if (n < ${fails}) { console.log(" FAIL  |storybook (chromium)| src/components/toast/toast.stories.tsx > Shows\\n\\n  Expected the toast to be visible"); console.log("      Tests  1 failed | 92 passed (93)"); process.exit(1); }`,
    'console.log("      Tests  93 passed (93)");',
  ].join("\n"));
  return root;
}

test("tests: a failure that passes on a second run is flaky, not a stop; twice is a stop; the result is kept", async (t) => {
  const once = workspace(t, 1);
  const r = await createTests(once, { installed: true }).run();
  assert.equal(r.ok, true);
  assert.deepEqual(r.tests.flaky, ["toast/toast.stories.tsx > Shows — Expected the toast to be visible"]);
  assert.equal(r.tests.passed, 93);
  assert.ok(existsSync(join(once, ".ds", "tests.json")));
  assert.equal(createTests(once, { installed: true }).last.tests.flaky.length, 1, "read back after a restart");

  const twice = workspace(t, 2);
  const s = await createTests(twice, { installed: true }).run();
  assert.equal(s.ok, false);
  assert.deepEqual(s.tests.failures, ["toast/toast.stories.tsx > Shows — Expected the toast to be visible"]);
  assert.deepEqual(s.tests.flaky, []);
  assert.equal(Number(readFileSync(join(twice, "runs"), "utf8")), 2, "run twice, not more");
});
