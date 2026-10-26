#!/usr/bin/env node
/**
 * storybook-ai-ready.mjs — make an existing Storybook (10.6+) consumable by AI agents.
 *
 * Idempotent. Patches text, never rewrites whole files, and reports what it could not do.
 *
 *   node scripts/storybook-ai-ready.mjs [--project <dir>] [--storybook-dir .storybook]
 *        [--css src/index.css] [--port 6006] [--adapter shadcn|vanilla] [--ui-dir src/components/ui]
 *        [--remove-examples] [--dry-run]
 *
 * What it does:
 *   1. .storybook/main.(ts|js|mjs): ensure addons include @storybook/addon-docs, addon-a11y, addon-mcp;
 *      ensure features.componentsManifest = true; ensure typescript.reactDocgen = 'react-docgen-typescript'.
 *   2. .storybook/preview.(ts|tsx|js|jsx): ensure the project CSS (Tailwind / tokens) is imported.
 *   3. .design-system/config.json: create if missing (adapter, storybook url, token paths, vendored allowlist).
 *   4. .mcp.json in the project: add the Storybook MCP server (http://localhost:<port>/mcp) if missing.
 *   5. --remove-examples: delete Storybook's generated src/stories example folder.
 *   6. Report missing devDependencies (addon-mcp, addon-a11y, addon-vitest) with the install commands.
 *
 * Exit codes: 0 done; 1 Storybook config not found; 3 a patch could not be applied (details printed).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const has = (n) => args.includes(n);

const project = resolve(process.cwd(), opt("--project", "."));
const sbDir = resolve(project, opt("--storybook-dir", ".storybook"));
const cssPath = opt("--css", "src/index.css");
const port = Number(opt("--port", "6006"));
const adapter = opt("--adapter", "shadcn");
const uiDir = opt("--ui-dir", "src/components/ui");
const dryRun = has("--dry-run");
const removeExamples = has("--remove-examples");

const report = { changed: [], unchanged: [], todo: [], errors: [] };
let exitCode = 0;

function findFile(dir, bases, exts) {
  for (const b of bases) for (const e of exts) {
    const p = join(dir, `${b}.${e}`);
    if (existsSync(p)) return p;
  }
  return null;
}

function write(p, content, label) {
  if (dryRun) {
    report.changed.push(`${label} (dry-run)`);
    return;
  }
  writeFileSync(p, content);
  report.changed.push(label);
}

// ---------- 1. main config ----------
const mainPath = findFile(sbDir, ["main"], ["ts", "mts", "js", "mjs", "cjs"]);
if (!mainPath) {
  process.stderr.write(`storybook-ai-ready: no Storybook config in ${sbDir}. Run: npx storybook@latest init --yes --no-dev --features docs test a11y ai\n`);
  process.exit(1);
}
let main = readFileSync(mainPath, "utf8");
const mainBefore = main;
const isTs = /\.m?ts$/.test(mainPath);

function ensureAddon(src, addon) {
  if (src.includes(`"${addon}"`) || src.includes(`'${addon}'`)) return src;
  const m = src.match(/addons\s*:\s*\[/);
  if (!m) {
    report.errors.push(`could not find an addons array in ${mainPath}; add "${addon}" manually`);
    return src;
  }
  const insertAt = m.index + m[0].length;
  return src.slice(0, insertAt) + `\n    "${addon}",` + src.slice(insertAt);
}
for (const addon of ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-mcp"]) main = ensureAddon(main, addon);

// features.componentsManifest
if (/componentsManifest\s*:\s*true/.test(main)) {
  // present
} else if (/features\s*:\s*\{/.test(main)) {
  main = main.replace(/features\s*:\s*\{/, (m) => `${m}\n    componentsManifest: true,`);
} else {
  const anchor = main.match(/\n(\s*)framework\s*:/);
  if (anchor) {
    main = main.replace(/\n(\s*)framework\s*:/, (m, ind) => `\n${ind}// AI layer: /manifests/components.json + /manifests/docs.json for addon-mcp and snapshot-manifest.mjs\n${ind}features: {\n${ind}  componentsManifest: true,\n${ind}},${m}`);
  } else {
    report.errors.push(`could not place features.componentsManifest in ${mainPath}; add: features: { componentsManifest: true }`);
  }
}

// typescript.reactDocgen
if (isTs || existsSync(join(project, "tsconfig.json"))) {
  if (/reactDocgen\s*:\s*["']react-docgen-typescript["']/.test(main)) {
    // present
  } else if (/reactDocgen\s*:/.test(main)) {
    main = main.replace(/reactDocgen\s*:\s*["'][^"']*["']/, `reactDocgen: "react-docgen-typescript"`);
  } else if (/typescript\s*:\s*\{/.test(main)) {
    main = main.replace(/typescript\s*:\s*\{/, (m) => `${m}\n    reactDocgen: "react-docgen-typescript",`);
  } else {
    const anchor = main.match(/\n(\s*)framework\s*:/);
    if (anchor) {
      main = main.replace(/\n(\s*)framework\s*:/, (m, ind) =>
        `\n${ind}// react-docgen-typescript puts union literals and JSDoc into the components manifest.\n${ind}typescript: {\n${ind}  reactDocgen: "react-docgen-typescript",\n${ind}  reactDocgenTypescriptOptions: {\n${ind}    shouldExtractLiteralValuesFromEnum: true,\n${ind}    shouldRemoveUndefinedFromOptional: true,\n${ind}    propFilter: (prop) => (prop.parent ? !/node_modules/.test(prop.parent.fileName) : true),\n${ind}  },\n${ind}},${m}`);
    } else {
      report.errors.push(`could not place typescript.reactDocgen in ${mainPath}`);
    }
  }
}
if (main !== mainBefore) write(mainPath, main, `patched ${mainPath}`);
else report.unchanged.push(mainPath);

// ---------- 2. preview: import project CSS ----------
const previewPath = findFile(sbDir, ["preview"], ["tsx", "ts", "jsx", "js", "mjs"]);
if (previewPath) {
  let preview = readFileSync(previewPath, "utf8");
  const rel = "../" + cssPath.replace(/^\.\//, "");
  if (!preview.includes(rel)) {
    if (existsSync(resolve(project, cssPath))) {
      preview = `import "${rel}";\n` + preview;
      write(previewPath, preview, `imported ${rel} in ${previewPath}`);
    } else {
      report.todo.push(`CSS file ${cssPath} not found; pass --css <path> so stories get the theme`);
    }
  } else {
    report.unchanged.push(previewPath);
  }
} else {
  report.todo.push(`no preview file in ${sbDir}; create preview.ts importing ${cssPath}`);
}

// ---------- 3. .design-system/config.json ----------
const dsDir = join(project, ".design-system");
const cfgPath = join(dsDir, "config.json");
if (!existsSync(cfgPath)) {
  const uiAbs = resolve(project, uiDir);
  const vendored = existsSync(uiAbs)
    ? readdirSync(uiAbs).filter((f) => /\.(tsx|jsx)$/.test(f) && !/\.stories\./.test(f)).map((f) => `${uiDir.replace(/\/$/, "")}/${f}`)
    : [];
  const cfg = {
    $schema: "https://design-system-skills/schemas/design-system.config.json",
    adapter,
    aliases: { "@/": "src/" },
    storybook: { url: `http://localhost:${port}`, configDir: opt("--storybook-dir", ".storybook") },
    tokens: { dtcg: ".design-system/tokens.json", cssOutput: cssPath },
    figmaMap: ".design-system/figma-map.json",
    figma: { codeConnect: "auto" },
    verify: { visualDiffThreshold: 0.05, maxFixIterations: 3 },
    hardcoded: {
      allowFiles: vendored,
      allowFilesNote: "Vendored design-system sources are accepted as-is; new or edited components are still checked.",
    },
  };
  if (!dryRun) mkdirSync(dsDir, { recursive: true });
  write(cfgPath, JSON.stringify(cfg, null, 2) + "\n", `created ${cfgPath} (${vendored.length} vendored files allowlisted)`);
} else {
  report.unchanged.push(cfgPath);
}

// ---------- 4. project .mcp.json ----------
const mcpPath = join(project, ".mcp.json");
let mcp = { mcpServers: {} };
if (existsSync(mcpPath)) {
  try {
    mcp = JSON.parse(readFileSync(mcpPath, "utf8"));
    mcp.mcpServers ??= {};
  } catch (e) {
    report.errors.push(`${mcpPath} is not valid JSON (${e.message}); add the storybook server manually`);
    mcp = null;
  }
}
if (mcp) {
  const already = Object.values(mcp.mcpServers).some((s) => typeof s?.url === "string" && s.url.includes(`:${port}/mcp`));
  if (!already) {
    mcp.mcpServers.storybook = { type: "http", url: `http://localhost:${port}/mcp` };
    write(mcpPath, JSON.stringify(mcp, null, 2) + "\n", `registered Storybook MCP in ${mcpPath}`);
  } else {
    report.unchanged.push(mcpPath);
  }
}

// ---------- 5. examples ----------
const examples = join(project, "src", "stories");
if (existsSync(examples)) {
  if (removeExamples) {
    if (!dryRun) rmSync(examples, { recursive: true, force: true });
    report.changed.push(`removed ${examples} (Storybook example stories with hardcoded CSS)`);
  } else {
    report.todo.push(`${examples} contains Storybook's example stories (hardcoded colors); rerun with --remove-examples or delete it`);
  }
}

// ---------- 6. dependencies ----------
const pkgPath = join(project, "package.json");
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const sbVersion = deps.storybook ?? deps["@storybook/react-vite"] ?? "";
  const major = Number((sbVersion.match(/\d+/) ?? ["0"])[0]);
  if (major && major < 10) report.todo.push(`Storybook ${sbVersion} detected; manifests + MCP need 10.6+: npx storybook@latest upgrade`);
  for (const dep of ["@storybook/addon-mcp", "@storybook/addon-a11y", "@storybook/addon-docs"]) {
    if (!deps[dep]) report.todo.push(`install ${dep}: npx storybook add ${dep} --yes`);
  }
  if (!deps["@storybook/addon-vitest"]) report.todo.push(`optional: npx storybook add @storybook/addon-vitest --yes  (enables MCP test-run)`);
  if (!pkg.scripts?.storybook) report.todo.push(`add script: "storybook": "storybook dev -p ${port}"`);
}

// ---------- report ----------
const out = ["storybook-ai-ready" + (dryRun ? " (dry-run)" : "")];
if (report.changed.length) out.push("\nChanged:", ...report.changed.map((s) => "  + " + s));
if (report.unchanged.length) out.push("\nAlready OK:", ...report.unchanged.map((s) => "  = " + s));
if (report.todo.length) out.push("\nTo do:", ...report.todo.map((s) => "  > " + s));
if (report.errors.length) {
  out.push("\nCould not apply:", ...report.errors.map((s) => "  ! " + s));
  exitCode = 3;
}
out.push(`\nNext: start Storybook (npm run storybook -- --no-open --ci), then\n  node scripts/snapshot-manifest.mjs --url http://localhost:${port}`);
process.stdout.write(out.join("\n") + "\n");
process.exitCode = exitCode;
