#!/usr/bin/env node
/**
 * snapshot-manifest.mjs — copy Storybook's AI manifests into the repo knowledge layer
 * and report how "AI-ready" the stories are.
 *
 * Storybook 10.6+ serves:
 *   <storybook>/manifests/components.json   (from CSF files + react-docgen)
 *   <storybook>/manifests/docs.json         (from MDX docs)
 *
 * Usage:
 *   node scripts/snapshot-manifest.mjs --url http://localhost:6006 [--out .design-system]
 *   node scripts/snapshot-manifest.mjs --static storybook-static [--out .design-system]
 *   node scripts/snapshot-manifest.mjs --report-only --url http://localhost:6006
 *
 * Writes:
 *   <out>/manifest.json        { meta, components, docs }  — full snapshot, committed to git
 *   <out>/manifest.index.json  slim per-component index for cheap agent reads
 *
 * Exit codes: 0 ok; 1 manifests unreachable; 2 readiness report has blocking issues (with --strict).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const has = (name) => args.includes(name);

const url = opt("--url");
const staticDir = opt("--static");
const outDir = resolve(process.cwd(), opt("--out", ".design-system"));
const reportOnly = has("--report-only");
const strict = has("--strict");

if (!url && !staticDir) {
  process.stderr.write("usage: snapshot-manifest.mjs (--url <storybook-url> | --static <dir>) [--out <dir>] [--report-only] [--strict]\n");
  process.exit(64);
}

async function loadJson(name) {
  if (staticDir) {
    const p = resolve(process.cwd(), staticDir, "manifests", name);
    if (!existsSync(p)) return { data: null, error: `missing ${p}` };
    try {
      return { data: JSON.parse(readFileSync(p, "utf8")) };
    } catch (e) {
      return { data: null, error: `${p}: ${e.message}` };
    }
  }
  const u = `${url.replace(/\/$/, "")}/manifests/${name}`;
  try {
    const res = await fetch(u);
    if (!res.ok) return { data: null, error: `${u} -> HTTP ${res.status}` };
    return { data: await res.json() };
  } catch (e) {
    return { data: null, error: `${u}: ${e.message}` };
  }
}

/** Storybook may emit components as an array or as an id-keyed object; normalize to an array. */
function normalizeComponents(manifest) {
  if (!manifest) return [];
  const raw = manifest.components ?? manifest.entries ?? manifest;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object") return Object.entries(raw).map(([id, c]) => ({ id, ...c }));
  return [];
}

function normalizeDocs(manifest) {
  if (!manifest) return [];
  const raw = manifest.docs ?? manifest.entries ?? manifest;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object") return Object.entries(raw).map(([id, d]) => ({ id, ...d }));
  return [];
}

/** Storybook names the docgen block after the extractor: reactDocgenTypescript | reactDocgen | docgen. */
function propsOf(c) {
  const docgen = c.reactDocgenTypescript ?? c.reactDocgen ?? c.docgen ?? {};
  const props = docgen.props ?? c.props ?? {};
  return Array.isArray(props) ? props : Object.entries(props).map(([name, p]) => ({ name, ...p }));
}

/**
 * Storybook derives `import` from the package name (e.g. `from 'demo-react'`), which is wrong for
 * vendored components. Derive a path-alias import from the stories path using config.aliases
 * (default `{"@/": "src/"}`) so agents import `@/components/ui/button`, never a deep or fake path.
 */
function importHint(c, aliases) {
  const p = (c.path ?? "").replace(/^\.\//, "").replace(/\.stories\.[cm]?[jt]sx?$/, "");
  if (!p) return null;
  for (const [alias, dir] of Object.entries(aliases)) {
    if (p.startsWith(dir)) return `import { ${c.name} } from "${alias}${p.slice(dir.length)}";`;
  }
  return null;
}

function loadAliases() {
  const p = resolve(process.cwd(), ".design-system/config.json");
  if (!existsSync(p)) return { "@/": "src/" };
  try {
    return JSON.parse(readFileSync(p, "utf8")).aliases ?? { "@/": "src/" };
  } catch {
    return { "@/": "src/" };
  }
}

function readiness(components) {
  const issues = [];
  for (const c of components) {
    const name = c.name ?? c.id;
    const stories = c.stories ?? [];
    const props = propsOf(c);
    if (!c.description || String(c.description).trim().length < 20) {
      issues.push({ component: name, level: "warn", issue: "no component description (add JSDoc above the component or parameters.docs.description.component)" });
    }
    if (stories.length === 0) {
      issues.push({ component: name, level: "error", issue: "no stories" });
    } else if (stories.length === 1) {
      issues.push({ component: name, level: "warn", issue: "only one story; add one story per meaningful variant / state" });
    }
    if (stories.some((s) => !s.snippet)) {
      issues.push({ component: name, level: "warn", issue: "some stories have no code snippet (story args should be static so Storybook can render a snippet)" });
    }
    if (props.length === 0) {
      issues.push({ component: name, level: "info", issue: "no own props extracted: either a native-element wrapper (e.g. React.ComponentProps<\"input\">, fine) or untyped props (export a typed props interface)" });
    } else {
      const undocumented = props.filter((p) => !p.description).length;
      if (undocumented > 0 && undocumented / props.length > 0.5) {
        issues.push({ component: name, level: "info", issue: `${undocumented}/${props.length} props lack descriptions (JSDoc on each prop)` });
      }
    }
  }
  return issues;
}

const [components, docs] = await Promise.all([loadJson("components.json"), loadJson("docs.json")]);
if (!components.data && !docs.data) {
  process.stderr.write(`snapshot-manifest: no manifests found.\n  ${components.error}\n  ${docs.error}\n` +
    "Enable them in .storybook/main.ts:  features: { componentsManifest: true }  (Storybook 10.6+, React/Vue3/Angular Vite frameworks).\n");
  process.exitCode = 1;
} else {
  await main();
}

async function main() {
if (!components.data) process.stderr.write(`snapshot-manifest: components manifest unavailable: ${components.error}\n`);
if (!docs.data) process.stderr.write(`snapshot-manifest: docs manifest unavailable: ${docs.error}\n`);

const comps = normalizeComponents(components.data);
const docEntries = normalizeDocs(docs.data);
const issues = readiness(comps);

const aliases = loadAliases();
const index = comps.map((c) => ({
  id: c.id,
  name: c.name ?? c.id,
  import: importHint({ ...c, name: c.name ?? c.id }, aliases) ?? c.import ?? null,
  storybookImport: c.import ?? null,
  path: c.path ?? null,
  description: c.description ? String(c.description).slice(0, 200) : null,
  props: propsOf(c).map((p) => p.name),
  stories: (c.stories ?? []).map((s) => s.name ?? s.id),
}));

const meta = {
  generatedAt: new Date().toISOString(),
  source: url ? { type: "dev-server", url } : { type: "static", dir: staticDir },
  componentCount: comps.length,
  docsCount: docEntries.length,
  readinessIssues: issues.length,
};

if (!reportOnly) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ meta, components: components.data, docs: docs.data }, null, 2) + "\n");
  writeFileSync(join(outDir, "manifest.index.json"), JSON.stringify({ meta, components: index }, null, 2) + "\n");
}

const lines = [
  `snapshot-manifest: ${comps.length} component(s), ${docEntries.length} docs page(s)` + (reportOnly ? " (report only)" : ` -> ${outDir}`),
];
for (const c of index) lines.push(`  ${c.name.padEnd(28)} props:${String(c.props.length).padStart(3)}  stories:${String(c.stories.length).padStart(3)}  ${c.description ? "" : "(no description)"}`);
if (issues.length) {
  lines.push(`\nAI-readiness issues (${issues.length}):`);
  for (const i of issues) lines.push(`  [${i.level}] ${i.component}: ${i.issue}`);
} else if (comps.length) {
  lines.push("\nAI-readiness: all components have descriptions, props and multiple stories with snippets.");
}
process.stdout.write(lines.join("\n") + "\n");
// Set exitCode instead of calling process.exit(): on Node 24 / Windows, exiting while fetch handles
// are still closing trips a libuv assertion (UV_HANDLE_CLOSING) and exits 127.
process.exitCode = strict && issues.some((i) => i.level === "error") ? 2 : 0;
}
