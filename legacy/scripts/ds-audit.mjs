#!/usr/bin/env node
/**
 * ds-audit.mjs — one report on the health of the design-system knowledge layer.
 *
 *   node scripts/ds-audit.mjs [--storybook http://localhost:6006] [--out .design-system/audit-report.md] [--json] [--strict]
 *
 * Sections (each sub-check is a sibling script run with --json where available):
 *   1. AI-readiness       manifest.index.json: components without description / < 3 stories / no props
 *   2. Hardcoded values   check-hardcoded.mjs over src/
 *   3. Mapping            validate-figma-map.mjs; pending unmapped decisions
 *   4. Variant coverage   every figma-map VARIANT value has a story in the manifest
 *   5. Tokens             build-tokens.mjs --check (drift) and tokens.json freshness (exportedAt age)
 *   6. Code Connect       mappings with status local on a plan that could publish (informational)
 *
 * Exit codes: 0 no errors; 1 errors (or any warning with --strict); 65 config missing.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const one = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const flag = (n) => args.includes(n);
const cwd = process.cwd();
const asJson = flag("--json");
const strict = flag("--strict");
const outPath = one("--out") ? resolve(cwd, one("--out")) : null;

const cfgPath = resolve(cwd, ".design-system/config.json");
if (!existsSync(cfgPath)) {
  process.stderr.write("ds-audit: .design-system/config.json not found; run ds-adopt first\n");
  process.exit(65);
}
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const storybook = one("--storybook", cfg.storybook?.url ?? "http://localhost:6006");

const sections = [];
let errors = 0, warns = 0;
function section(title) {
  const s = { title, items: [] };
  sections.push(s);
  return {
    error: (m) => { s.items.push({ level: "error", text: m }); errors++; },
    warn: (m) => { s.items.push({ level: "warn", text: m }); warns++; },
    info: (m) => s.items.push({ level: "info", text: m }),
    ok: (m) => s.items.push({ level: "ok", text: m }),
  };
}
function runJson(script, extra = []) {
  const r = spawnSync(process.execPath, [join(here, script), ...extra, "--json"], { cwd, encoding: "utf8" });
  let data = null;
  try { data = JSON.parse(r.stdout); } catch { /* non-json */ }
  return { code: r.status, data, stdout: r.stdout, stderr: r.stderr };
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// 1. AI-readiness ------------------------------------------------------------
{
  const s = section("AI-readiness (Storybook manifest)");
  const refresh = spawnSync(process.execPath, [join(here, "snapshot-manifest.mjs"), "--url", storybook, "--report-only"], { cwd, encoding: "utf8" });
  if (refresh.status !== 0) s.warn(`Storybook at ${storybook} unreachable; using the committed snapshot`);
  const idxPath = resolve(cwd, ".design-system/manifest.index.json");
  if (!existsSync(idxPath)) s.error("no .design-system/manifest.index.json; run snapshot-manifest.mjs with Storybook running");
  else {
    const idx = JSON.parse(readFileSync(idxPath, "utf8"));
    const comps = idx.components ?? [];
    s.info(`${comps.length} components, snapshot ${idx.meta?.generatedAt ?? "?"}`);
    for (const c of comps) {
      if (!c.description) s.error(`${c.name}: no description (JSDoc above const meta)`);
      if ((c.stories ?? []).length < 3) s.warn(`${c.name}: only ${(c.stories ?? []).length} stor${c.stories?.length === 1 ? "y" : "ies"}`);
    }
    if (!comps.some((c) => !c.description) && comps.length) s.ok("every component has a description");
  }
}

// 2. Hardcoded values -----------------------------------------------------------
{
  const s = section("Hardcoded design values");
  const r = runJson("check-hardcoded.mjs", ["src"]);
  if (!r.data) s.warn(`check-hardcoded failed to run: ${r.stderr.trim().slice(0, 200)}`);
  else if (r.data.count === 0) s.ok("no hardcoded values outside allowlisted files");
  else {
    const byFile = {};
    for (const f of r.data.findings) (byFile[f.file] ??= []).push(f);
    for (const [file, list] of Object.entries(byFile)) (list.some((f) => f.level === "error") ? s.error : s.warn)(`${file}: ${list.length} finding(s) (${[...new Set(list.map((f) => f.rule))].join(", ")})`);
  }
}

// 3. Mapping --------------------------------------------------------------------
let map = null;
{
  const s = section("Figma ↔ code mapping");
  const mapPath = resolve(cwd, cfg.figmaMap ?? ".design-system/figma-map.json");
  if (!existsSync(mapPath)) s.warn("no figma-map.json yet; run ds-figma-map");
  else {
    map = JSON.parse(readFileSync(mapPath, "utf8"));
    const r = runJson("validate-figma-map.mjs");
    if (!r.data) s.warn(`validate-figma-map failed: ${r.stderr.trim().slice(0, 200)}`);
    else {
      for (const e of r.data.errors) s.error(e);
      for (const w of r.data.warnings) s.warn(w);
      if (!r.data.errors.length) s.ok(`${r.data.components} mapping(s) valid`);
      if (r.data.pending) s.warn(`${r.data.pending} unmapped Figma component(s) awaiting a decision`);
    }
    const suggested = (map.components ?? []).filter((c) => c.source === "suggested").length;
    if (suggested) s.warn(`${suggested} suggested mapping(s) not yet confirmed`);
    if (map.figma?.lastSyncedAt) {
      const days = (Date.now() - Date.parse(map.figma.lastSyncedAt)) / 864e5;
      if (days > 30) s.warn(`map last synced ${Math.round(days)} days ago; run ds-figma-map D (refresh)`);
    }
  }
}

// 4. Variant coverage ------------------------------------------------------------
{
  const s = section("Variant story coverage");
  const idxPath = resolve(cwd, ".design-system/manifest.index.json");
  if (map && existsSync(idxPath)) {
    const idx = JSON.parse(readFileSync(idxPath, "utf8"));
    const byName = new Map((idx.components ?? []).map((c) => [c.name, c]));
    let missing = 0;
    for (const c of map.components ?? []) {
      const m = byName.get(c.code?.component);
      if (!m) continue;
      const storySlugs = new Set((m.stories ?? []).map(slug));
      for (const p of c.props ?? []) {
        if (p.figma?.type !== "VARIANT" || !p.values || p.code?.transform === "state") continue;
        for (const [label, value] of Object.entries(p.values)) {
          if (value === null || typeof value === "object") continue;
          if (value === "default") continue; // covered by Default
          const covered = storySlugs.has(slug(label)) || storySlugs.has(slug(value)) || [...storySlugs].some((x) => x.endsWith(`-${slug(value)}`) || x.endsWith(`-${slug(label)}`));
          if (!covered) { s.warn(`${c.code.component}: no story for ${p.figma.name}=${label} (${p.code.prop}="${value}")`); missing++; }
        }
      }
    }
    if (!missing) s.ok("every mapped variant value has a story");
  } else s.info("skipped (needs figma-map.json and manifest.index.json)");
}

// 5. Tokens ----------------------------------------------------------------------
{
  const s = section("Tokens");
  const tokPath = resolve(cwd, cfg.tokens?.dtcg ?? ".design-system/tokens.json");
  if (!existsSync(tokPath)) s.warn("no tokens.json; run ds-tokens");
  else {
    const doc = JSON.parse(readFileSync(tokPath, "utf8"));
    const meta = doc.$extensions?.["ds-skills"] ?? {};
    if (meta.exportedAt) {
      const days = (Date.now() - Date.parse(meta.exportedAt)) / 864e5;
      (days > 30 ? s.warn : s.info)(`tokens exported ${Math.round(days)} day(s) ago by ${meta.exporter ?? "unknown"}${meta.figmaFileKey ? ` from ${meta.figmaFileKey}` : ""}`);
    } else s.warn("tokens.json has no $extensions.ds-skills.exportedAt stamp");
    const r = runJson("build-tokens.mjs", ["--theme", "--check"]);
    if (!r.data) s.warn(`build-tokens --check failed: ${r.stderr.trim().slice(0, 200)}`);
    else {
      if (r.data.changed) s.error(`CSS managed region is out of date with tokens.json (run build-tokens.mjs --theme)`);
      else s.ok("CSS managed region matches tokens.json");
      if (r.data.codeOnlyVars?.length) s.info(`${r.data.codeOnlyVars.length} code-only CSS variable(s) without a token: ${r.data.codeOnlyVars.slice(0, 8).join(", ")}${r.data.codeOnlyVars.length > 8 ? ", …" : ""}`);
      if (r.data.unresolvedAliases?.length) s.error(`unresolved aliases: ${r.data.unresolvedAliases.join("; ")}`);
      if (r.data.composites?.length) s.info(`composite tokens not emitted: ${r.data.composites.join(", ")}`);
    }
  }
}

// 6. Code Connect -----------------------------------------------------------------
{
  const s = section("Code Connect");
  if (!map) s.info("skipped");
  else {
    const local = (map.components ?? []).filter((c) => c.source === "confirmed" && (c.codeConnect?.status ?? "local") === "local");
    const failed = (map.components ?? []).filter((c) => c.codeConnect?.status === "failed");
    const published = (map.components ?? []).filter((c) => c.codeConnect?.status === "published");
    s.info(`${published.length} published, ${local.length} local-only, ${failed.length} failed (codeConnect setting: ${cfg.figma?.codeConnect ?? "auto"})`);
    for (const c of failed) s.warn(`${c.code.component}: Code Connect publish failed: ${c.codeConnect?.error ?? "see map"}`);
  }
}

// report ---------------------------------------------------------------------------
const icon = { error: "✗", warn: "!", info: "·", ok: "✓" };
const md = [`# Design-system audit`, ``, `Generated ${new Date().toISOString()} in \`${cwd}\``, ``, `**${errors} error(s), ${warns} warning(s)**`, ``];
for (const s of sections) {
  md.push(`## ${s.title}`, ``);
  for (const i of s.items) md.push(`- ${icon[i.level]} ${i.text}`);
  md.push(``);
}
const text = md.join("\n");
if (asJson) process.stdout.write(JSON.stringify({ errors, warnings: warns, sections }, null, 2) + "\n");
else process.stdout.write(text);
if (outPath) {
  writeFileSync(outPath, text);
  if (!asJson) process.stdout.write(`\nwritten to ${outPath}\n`);
}
process.exitCode = errors || (strict && warns) ? 1 : 0;
