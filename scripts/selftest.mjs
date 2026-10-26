#!/usr/bin/env node
/**
 * selftest.mjs — one command to test the plugin itself (scripts, skills, demo knowledge layer).
 *
 *   node scripts/selftest.mjs            # offline checks (≈10 s)
 *   node scripts/selftest.mjs --live     # + checks against a running demo Storybook (manifests, MCP tools)
 *   node scripts/selftest.mjs --vitest   # + runs the demo's 39 story tests (needs Playwright chromium, ≈1 min)
 *
 * Exit 0 when every check passes or is skipped; 1 otherwise. Figma-dependent behavior is NOT covered here
 * (it needs an authorized Figma MCP in an interactive Claude Code session; see README "Testing").
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, mkdtempSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = join(root, "scripts");
const demo = join(root, "examples", "demo-react");
const args = process.argv.slice(2);
const live = args.includes("--live");
const vitest = args.includes("--vitest");
const storybookUrl = "http://localhost:6006";

const results = [];
function record(name, ok, detail = "", skipped = false) {
  results.push({ name, ok, detail, skipped });
  const mark = skipped ? "–" : ok ? "✓" : "✗";
  process.stdout.write(`${mark} ${name}${detail ? `  ${detail}` : ""}\n`);
}
function run(cmd, cmdArgs, cwd, input) {
  const r = spawnSync(cmd, cmdArgs, { cwd, encoding: "utf8", input, windowsHide: true });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? ""), stdout: r.stdout ?? "" };
}
const node = (script, a = [], cwd = root, input) => run(process.execPath, [join(scripts, script), ...a], cwd, input);
const tmp = mkdtempSync(join(tmpdir(), "ds-skills-selftest-"));
process.stdout.write(`design-system-skills selftest  (temp: ${tmp})\n\n`);

// 1. Syntax of every script --------------------------------------------------
{
  const files = readdirSync(scripts).filter((f) => f.endsWith(".mjs"));
  const bad = files.filter((f) => run(process.execPath, ["--check", join(scripts, f)], root).code !== 0);
  record("scripts parse (node --check)", bad.length === 0, bad.length ? `failed: ${bad.join(", ")}` : `${files.length} files`);
}

// 2. Plugin structure -----------------------------------------------------------
{
  const problems = [];
  for (const f of [".claude-plugin/plugin.json", ".mcp.json", "hooks/hooks.json", "templates/design-system.config.schema.json", "templates/figma-map.schema.json"]) {
    try { JSON.parse(readFileSync(join(root, f), "utf8")); } catch (e) { problems.push(`${f}: ${e.message}`); }
  }
  const skillDirs = readdirSync(join(root, "skills"));
  for (const d of skillDirs) {
    const p = join(root, "skills", d, "SKILL.md");
    if (!existsSync(p)) { problems.push(`skills/${d}: no SKILL.md`); continue; }
    const head = readFileSync(p, "utf8").split("\n").slice(0, 6).join("\n");
    if (!/^name:\s*\S/m.test(head) || !/^description:\s*\S/m.test(head)) problems.push(`skills/${d}: frontmatter needs name + description`);
    if (!new RegExp(`^name:\\s*${d}\\s*$`, "m").test(head)) problems.push(`skills/${d}: frontmatter name does not match folder`);
  }
  for (const f of readdirSync(join(root, "agents"))) {
    const head = readFileSync(join(root, "agents", f), "utf8").split("\n").slice(0, 8).join("\n");
    for (const k of ["name", "description", "model", "color"]) if (!new RegExp(`^${k}:\\s*\\S`, "m").test(head)) problems.push(`agents/${f}: missing ${k}`);
  }
  // every scripts/*.mjs or references/*.md mentioned in skills/agents/README must exist
  const mentioned = new Set();
  for (const f of [...skillDirs.map((d) => join(root, "skills", d, "SKILL.md")), ...readdirSync(join(root, "agents")).map((f) => join(root, "agents", f)), join(root, "README.md")]) {
    for (const m of readFileSync(f, "utf8").matchAll(/\b(scripts\/[a-z-]+\.mjs|references\/[a-z/-]+\.md|templates\/[a-zA-Z.-]+)/g)) mentioned.add(m[1]);
  }
  for (const m of mentioned) if (!existsSync(join(root, m)) && m !== "scripts/convert-tokens.mjs") problems.push(`referenced but missing: ${m}`);
  record("plugin structure (json, frontmatter, references)", problems.length === 0, problems.join("; ") || `${skillDirs.length} skills`);
}

// 3. check-hardcoded fixtures ---------------------------------------------------
{
  const dir = join(tmp, "hc"); mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "Bad.tsx"), 'export function Bad() {\n  // #abc in a comment\n  return <div className="bg-[#ff0000] p-[13px]" style={{ color: "#1e293b", gap: "16px", borderWidth: "1px" }}><span style={{ background: "rgba(0, 0, 0, 0.5)" }}>x</span></div>;\n}\n');
  writeFileSync(join(dir, "src", "Good.tsx"), 'export const Good = () => <div className="bg-primary p-4 rounded-[min(var(--radius-md),10px)]">ok</div>;\n');
  writeFileSync(join(dir, "src", "leak.ts"), 'const t = "' + "fig" + "d_" + "abcdefghijklmnopqrstuvwxyz0123456789" + '";\n');
  writeFileSync(join(dir, "src", "globals.css"), ":root { --primary: #1e293b; --radius: 8px; }\n");
  const bad = node("check-hardcoded.mjs", ["src/Bad.tsx", "--json"], dir);
  const badCount = (() => { try { return JSON.parse(bad.stdout).count; } catch { return -1; } })();
  const good = node("check-hardcoded.mjs", ["src/Good.tsx", "--json"], dir);
  const goodCount = (() => { try { return JSON.parse(good.stdout).count; } catch { return -1; } })();
  const leak = node("check-hardcoded.mjs", ["src/leak.ts"], dir);
  const hookWarn = node("check-hardcoded.mjs", ["--hook"], dir, JSON.stringify({ cwd: dir, tool_input: { file_path: "src/Bad.tsx" } }));
  const hookLeak = node("check-hardcoded.mjs", ["--hook"], dir, JSON.stringify({ cwd: dir, tool_input: { file_path: "src/leak.ts" } }));
  const hookClean = node("check-hardcoded.mjs", ["--hook"], dir, JSON.stringify({ cwd: dir, tool_input: { file_path: "src/globals.css" } }));
  record("check-hardcoded: flags hex/px/arbitrary/color-fn, ignores comments", badCount === 7, `Bad.tsx findings=${badCount} (expect 7)`);
  record("check-hardcoded: token-based values pass", goodCount === 0, `Good.tsx findings=${goodCount}`);
  record("check-hardcoded: Figma PAT is an error (exit 1)", leak.code === 1);
  record("check-hardcoded --hook: warnings → additionalContext, exit 0", hookWarn.code === 0 && hookWarn.stdout.includes("additionalContext"));
  record("check-hardcoded --hook: PAT → exit 2 with stderr", hookLeak.code === 2);
  record("check-hardcoded --hook: allowlisted file → silent exit 0", hookClean.code === 0 && hookClean.stdout.trim() === "");
}

// 4. storybook-ai-ready on a fake project ------------------------------------------
{
  const dir = join(tmp, "fake"); mkdirSync(join(dir, ".storybook"), { recursive: true }); mkdirSync(join(dir, "src", "components", "ui"), { recursive: true }); mkdirSync(join(dir, "src", "stories"), { recursive: true });
  writeFileSync(join(dir, ".storybook", "main.ts"), "import type { StorybookConfig } from '@storybook/react-vite';\nconst config: StorybookConfig = {\n  stories: ['../src/**/*.stories.@(ts|tsx)'],\n  addons: ['@storybook/addon-docs'],\n  framework: '@storybook/react-vite',\n};\nexport default config;\n");
  writeFileSync(join(dir, ".storybook", "preview.ts"), "import type { Preview } from '@storybook/react-vite';\nconst preview: Preview = { parameters: {} };\nexport default preview;\n");
  writeFileSync(join(dir, "package.json"), '{"name":"fake","devDependencies":{"storybook":"^10.6.1"}}');
  writeFileSync(join(dir, "tsconfig.json"), "{}");
  writeFileSync(join(dir, "src", "index.css"), ":root{--x:1}");
  writeFileSync(join(dir, "src", "components", "ui", "button.tsx"), "");
  writeFileSync(join(dir, "src", "stories", "Example.stories.ts"), "");
  const first = node("storybook-ai-ready.mjs", ["--remove-examples"], dir);
  const main = readFileSync(join(dir, ".storybook", "main.ts"), "utf8");
  const cfg = existsSync(join(dir, ".design-system", "config.json")) ? JSON.parse(readFileSync(join(dir, ".design-system", "config.json"), "utf8")) : null;
  const second = node("storybook-ai-ready.mjs", [], dir);
  record("storybook-ai-ready: patches main/preview, writes config + .mcp.json, removes examples",
    first.code === 0 && /componentsManifest:\s*true/.test(main) && /react-docgen-typescript/.test(main) && main.includes("@storybook/addon-mcp") && cfg?.hardcoded?.allowFiles?.includes("src/components/ui/button.tsx") && !existsSync(join(dir, "src", "stories")) && existsSync(join(dir, ".mcp.json")));
  record("storybook-ai-ready: second run is idempotent", second.code === 0 && !second.out.includes("Changed:"));
}

// 5. migration-state round trip ----------------------------------------------------
{
  const dir = join(tmp, "mig"); mkdirSync(join(dir, ".design-system"), { recursive: true });
  writeFileSync(join(dir, "items.json"), JSON.stringify([{ id: "1:1", name: "Atom", kind: "component" }, { id: "2:1", name: "Molecule", kind: "pattern", dependsOn: ["1:1"] }]));
  const ok = node("migration-state.mjs", ["init", "--file-key", "K", "items.json"], dir).code === 0
    && JSON.parse(node("migration-state.mjs", ["next"], dir).stdout).next.map((x) => x.id).join() === "1:1"
    && node("migration-state.mjs", ["review", "1:1"], dir).code === 0
    && JSON.parse(node("migration-state.mjs", ["next"], dir).stdout).next.map((x) => x.id).join() === "2:1"
    && node("migration-state.mjs", ["fail", "2:1", "--note", "token gap"], dir).code === 0
    && node("migration-state.mjs", ["summary"], dir).stdout.includes("failed 1");
  record("migration-state: dependency ordering, review, fail, summary", ok);
}

// 5b. build-tokens composite types (shadow, gradient, typography, easing, transition, border) --------
{
  const dir = join(tmp, "tok"); mkdirSync(join(dir, ".design-system"), { recursive: true }); mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, ".design-system", "config.json"), JSON.stringify({ tokens: { dtcg: ".design-system/tokens.json", cssOutput: "src/index.css" } }));
  writeFileSync(join(dir, ".design-system", "tokens.json"), JSON.stringify({
    color: { $type: "color", ink: { $value: "#112233", $extensions: { "ds-skills": { modes: { dark: "#eeeeee" } } } }, brand: { $value: "#2b6bde" } },
    shadow: { card: { $type: "shadow", $value: { color: "{color.ink}", offsetX: 0, offsetY: { value: 1, unit: "px" }, blur: "2px", spread: 0 } } },
    gradient: { hero: { $type: "gradient", $value: { angle: "135deg", stops: [{ color: "{color.brand}", position: 0 }, { color: "#ffffff", position: 1 }] } } },
    typography: { display: { $type: "typography", $value: { fontFamily: ["Geist Variable", "sans-serif"], fontSize: { value: 2, unit: "rem" }, fontWeight: "semibold", lineHeight: 1.15, letterSpacing: { value: -0.02, unit: "em" } } } },
    ease: { snappy: { $type: "cubicBezier", $value: [0.2, 0, 0, 1] } },
    motion: { fast: { $type: "transition", $value: { duration: { value: 150, unit: "ms" }, timingFunction: "{ease.snappy}" } } },
    border: { hairline: { $type: "border", $value: { width: 1, style: "solid", color: "{color.ink}" } } },
  }));
  writeFileSync(join(dir, "src", "index.css"), "@import \"tailwindcss\";\n:root { --ink: #000; }\n");
  const r = node("build-tokens.mjs", ["--theme"], dir);
  const css = readFileSync(join(dir, "src", "index.css"), "utf8");
  const expect = [
    "--card-shadow: 0 1px 2px 0 var(--ink);",
    "--gradient-hero: linear-gradient(135deg, var(--brand) 0%, #ffffff 100%);",
    "--display-font: 600 2rem/1.15 'Geist Variable', sans-serif;",
    "--display-font-size: 2rem;",
    "--snappy-ease: cubic-bezier(0.2, 0, 0, 1);",
    "--motion-fast: 150ms var(--snappy-ease);",
    "--border-hairline: 1px solid var(--ink);",
    "--shadow-card: var(--card-shadow);",
    "--ease-snappy: var(--snappy-ease);",
    "--text-display: var(--display-font-size);",
    "--text-display--line-height: var(--display-line-height);",
    "--tracking-display: var(--display-letter-spacing);",
    "--color-brand: var(--brand);",
    ".dark {", "--ink: #eeeeee;",
  ];
  const missing = expect.filter((e) => !css.includes(e));
  record("build-tokens: composite tokens → CSS (shadow, gradient, typography, ease, transition, border) + @theme", r.code === 0 && missing.length === 0, missing.length ? `missing: ${missing.join(" | ")}` : "12 expectations");
}

// 6. Demo knowledge layer (offline) ----------------------------------------------------
const demoReady = existsSync(join(demo, "node_modules")) && existsSync(join(demo, ".design-system", "config.json"));
if (!demoReady) {
  record("demo checks", true, "skipped: run `npm install` in examples/demo-react first", true);
} else {
  const v = node("validate-figma-map.mjs", [], demo);
  record("demo: figma-map valid against manifest", v.code === 0, v.out.split("\n")[0]);
  const t = node("build-tokens.mjs", ["--theme", "--check"], demo);
  record("demo: tokens.json ↔ CSS managed region in sync (build-tokens --check)", t.code === 0);
  const h = node("check-hardcoded.mjs", ["src"], demo);
  record("demo: no hardcoded values outside vendored files", h.code === 0);
  const cc = node("figma-map-to-code-connect.mjs", ["--dry-run", "--component", "Button"], demo);
  record("demo: Code Connect template generates (parserless figma.code)", cc.code === 0 && cc.stdout.includes("figma.code`<Button") && !cc.stdout.includes("figma.connect("));
  const a = node("ds-audit.mjs", ["--json"], demo);
  let errs = -1; try { errs = JSON.parse(a.stdout).errors; } catch { /* */ }
  record("demo: ds-audit reports no errors", errs === 0, `errors=${errs}`);
  const r = node("css-to-dtcg.mjs", ["--out", join(tmp, "from-css.json")], demo);
  record("demo: css-to-dtcg extracts shadcn variables", r.code === 0 && existsSync(join(tmp, "from-css.json")) && /color/.test(readFileSync(join(tmp, "from-css.json"), "utf8")));
}

// 7. Live Storybook (optional) --------------------------------------------------------
if (live) {
  let up = false;
  try { up = (await fetch(`${storybookUrl}/index.json`)).ok; } catch { /* down */ }
  if (!up) {
    record("live: Storybook reachable", true, `skipped: start it with  cd examples/demo-react && npm run storybook -- --no-open --ci`, true);
  } else {
    const s = node("snapshot-manifest.mjs", ["--url", storybookUrl, "--report-only"], demo);
    record("live: components manifest served and readable", s.code === 0 && /\d+ component\(s\)/.test(s.stdout), s.stdout.split("\n")[0]);
    try {
      const init = await fetch(`${storybookUrl}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "selftest", version: "0" } } }) });
      const sid = init.headers.get("mcp-session-id");
      const h = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(sid ? { "Mcp-Session-Id": sid } : {}) };
      await fetch(`${storybookUrl}/mcp`, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
      const list = await (await fetch(`${storybookUrl}/mcp`, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) })).text();
      const data = list.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("");
      const tools = JSON.parse(data).result.tools.map((t) => t.name);
      record("live: Storybook MCP answers tools/list", tools.includes("docs-list") && tools.includes("test-run"), `${tools.length} tools`);
    } catch (e) {
      record("live: Storybook MCP answers tools/list", false, e.message);
    }
    const vd = node("visual-diff.mjs", ["--story", "components-actions-button--default", "--figma", join(demo, ".design-system", ".cache", "fake-figma-button-outline.png"), "--out", join(tmp, "vd")], demo);
    if (existsSync(join(demo, ".design-system", ".cache", "fake-figma-button-outline.png"))) record("live: visual-diff runs and detects a size mismatch (exit 2)", vd.code === 2, vd.stdout.split("\n").slice(1, 3).join(" | "));
    else record("live: visual-diff", true, "skipped: no fixture screenshot (.design-system/.cache/fake-figma-button-outline.png)", true);
  }
} else {
  record("live checks (manifest, MCP, visual-diff)", true, "skipped: pass --live with the demo Storybook running", true);
}

// 8. Vitest (optional) ------------------------------------------------------------------
if (vitest && demoReady) {
  // Call vitest's entry directly so no shell is involved on Windows (avoids DEP0190 and .cmd quirks).
  const r = run(process.execPath, [join(demo, "node_modules", "vitest", "vitest.mjs"), "run", "--project", "storybook"], demo);
  const m = r.out.match(/Tests\s+(\d+) passed/);
  record("vitest: demo story tests (interaction + a11y)", r.code === 0 && !!m, m ? `${m[1]} passed` : r.out.split("\n").filter((l) => /FAIL|Error/.test(l)).slice(0, 3).join(" | "));
} else {
  record("vitest story tests", true, "skipped: pass --vitest (≈1 min, needs Playwright chromium)", true);
}

// summary --------------------------------------------------------------------------------
rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok && !r.skipped);
const skipped = results.filter((r) => r.skipped).length;
process.stdout.write(`\n${results.length - failed.length - skipped} passed, ${failed.length} failed, ${skipped} skipped\n`);
process.exitCode = failed.length ? 1 : 0;
