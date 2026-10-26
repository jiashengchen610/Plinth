#!/usr/bin/env node
/**
 * validate-figma-map.mjs — structural + cross-reference checks for .design-system/figma-map.json
 *
 *   node scripts/validate-figma-map.mjs [--map .design-system/figma-map.json] [--manifest .design-system/manifest.index.json] [--json]
 *
 * Checks (no external schema library; mirrors templates/figma-map.schema.json):
 *   structure   required keys, enums, nodeId format, duplicate Figma identities
 *   manifest    code.component exists in manifest.index.json; code.prop names exist on that component;
 *               storyId matches; import matches the manifest's alias import
 *   values      VARIANT props have a non-empty `values` map; `state` transforms map visual states to null
 *   hygiene     no `figd_` tokens or emails anywhere in the file
 *
 * Exit codes: 0 valid (warnings allowed); 1 errors; 65 file missing / invalid JSON.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const one = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const asJson = args.includes("--json");
const cwd = process.cwd();
const cfg = existsSync(resolve(cwd, ".design-system/config.json")) ? JSON.parse(readFileSync(resolve(cwd, ".design-system/config.json"), "utf8")) : {};
const mapPath = resolve(cwd, one("--map", cfg.figmaMap ?? ".design-system/figma-map.json"));
const manifestPath = resolve(cwd, one("--manifest", ".design-system/manifest.index.json"));

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

if (!existsSync(mapPath)) {
  process.stderr.write(`validate-figma-map: ${mapPath} not found\n`);
  process.exit(65);
}
const raw = readFileSync(mapPath, "utf8");
let map;
try {
  map = JSON.parse(raw);
} catch (e) {
  process.stderr.write(`validate-figma-map: invalid JSON: ${e.message}\n`);
  process.exit(65);
}

// hygiene
if (/\bfigd_[A-Za-z0-9_-]{20,}/.test(raw)) err("file contains a Figma personal access token (figd_…); remove it and rotate the token");
if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(raw)) warn("file contains an email address; figma-map should hold design identifiers only");

// structure
if (map.version !== 1) err(`version must be 1 (got ${JSON.stringify(map.version)})`);
if (!Array.isArray(map.components)) err("components must be an array");
const components = Array.isArray(map.components) ? map.components : [];
const unmapped = Array.isArray(map.unmapped) ? map.unmapped : [];
const PROP_TYPES = new Set(["VARIANT", "BOOLEAN", "TEXT", "INSTANCE_SWAP", "SLOT"]);
const SOURCES = new Set(["confirmed", "suggested", "code-connect"]);
const CC_STATUS = new Set(["local", "published", "unsupported", "failed"]);
const NODE_ID = /^[0-9]+:[0-9]+$/;

const identities = new Map();
function identity(f) {
  return f?.componentKey ? `key:${f.componentKey}` : f?.nodeId ? `node:${f.nodeId}` : f?.name ? `name:${f.name}` : null;
}

components.forEach((c, i) => {
  const label = c?.figma?.name ?? c?.code?.component ?? `#${i}`;
  if (!c.figma?.name) err(`${label}: figma.name is required`);
  if (c.figma?.nodeId && !NODE_ID.test(c.figma.nodeId)) err(`${label}: figma.nodeId must look like "12:345" (URLs use "12-345"; convert '-' to ':')`);
  if (!c.figma?.componentKey && !c.figma?.nodeId) warn(`${label}: no componentKey or nodeId; mapping by name only is fragile`);
  if (!c.code?.component) err(`${label}: code.component is required`);
  if (!c.code?.import) err(`${label}: code.import is required`);
  else if (!/^@\//.test(c.code.import) && !/^[a-z@]/.test(c.code.import)) warn(`${label}: code.import "${c.code.import}" is not an alias or package import`);
  if (!SOURCES.has(c.source)) err(`${label}: source must be one of ${[...SOURCES].join(", ")}`);
  if (c.source === "suggested" && (c.confidence ?? 0) >= 1) warn(`${label}: suggested mapping with confidence 1; confirm it or lower the confidence`);
  if (c.codeConnect && !CC_STATUS.has(c.codeConnect.status)) err(`${label}: codeConnect.status must be one of ${[...CC_STATUS].join(", ")}`);
  const id = identity(c.figma);
  if (id) {
    if (identities.has(id)) err(`${label}: duplicate Figma identity ${id} (also ${identities.get(id)})`);
    identities.set(id, label);
  }
  (c.props ?? []).forEach((p, j) => {
    const pl = `${label}.props[${j}] (${p?.figma?.name ?? "?"})`;
    if (!p.figma?.name) err(`${pl}: figma.name is required`);
    if (!PROP_TYPES.has(p.figma?.type)) err(`${pl}: figma.type must be one of ${[...PROP_TYPES].join(", ")}`);
    if (!p.code || (p.code.prop === undefined && !p.code.transform)) err(`${pl}: code.prop (or null + transform) is required`);
    if (p.figma?.type === "VARIANT") {
      if (!p.values || Object.keys(p.values).length === 0) err(`${pl}: VARIANT props need a non-empty values map (Figma label → code value)`);
      else if (p.code.prop === null && p.code.transform !== "state") warn(`${pl}: variant with no code prop and no "state" transform`);
    }
    if (p.code?.transform === "state" && p.values) {
      for (const [k, v] of Object.entries(p.values)) {
        if (/hover|focus|press|active/i.test(k) && v !== null) warn(`${pl}: visual state "${k}" should map to null`);
      }
    }
  });
});

unmapped.forEach((u, i) => {
  const label = u?.figma?.name ?? `unmapped#${i}`;
  if (!u.figma?.name) err(`${label}: figma.name is required`);
  if (!u.reason) err(`${label}: reason is required`);
  if (!["pending", "create", "skip"].includes(u.decision)) err(`${label}: decision must be pending | create | skip`);
  const id = identity(u.figma);
  if (id && identities.has(id)) err(`${label}: listed as unmapped but also mapped (${identities.get(id)})`);
});

// manifest cross-check
let manifest = null;
if (existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    warn(`manifest ${manifestPath} unreadable: ${e.message}`);
  }
} else {
  warn(`no manifest at ${manifestPath}; run snapshot-manifest.mjs to enable cross-checks`);
}
if (manifest?.components) {
  const byName = new Map(manifest.components.map((c) => [c.name, c]));
  for (const c of components) {
    const m = byName.get(c.code?.component);
    const label = c.figma?.name ?? c.code?.component;
    if (!m) {
      // sub-components (CardHeader) are not top-level manifest entries; only warn.
      warn(`${label}: code.component "${c.code?.component}" is not a top-level component in the manifest (sub-component, or missing stories)`);
      continue;
    }
    if (c.code.storyId && c.code.storyId !== m.id) err(`${label}: storyId "${c.code.storyId}" does not match manifest id "${m.id}"`);
    if (!c.code.storyId) warn(`${label}: add code.storyId "${m.id}" so agents can jump to docs-show`);
    const expectedImport = m.import?.match(/from "([^"]+)"/)?.[1];
    if (expectedImport && c.code.import !== expectedImport) warn(`${label}: code.import "${c.code.import}" differs from manifest import "${expectedImport}"`);
    const manifestProps = new Set(m.props ?? []);
    for (const p of c.props ?? []) {
      const prop = p.code?.prop;
      if (prop && prop !== "children" && !manifestProps.has(prop) && !/^(className|aria-|data-|on[A-Z])/.test(prop)) {
        err(`${label}: prop "${prop}" is not in the manifest (${[...manifestProps].join(", ") || "no props extracted"}); native attributes are allowed only as children/className/aria-*/on*`);
      }
    }
  }
}

const result = { map: mapPath, components: components.length, unmapped: unmapped.length, pending: unmapped.filter((u) => u.decision === "pending").length, errors, warnings };
if (asJson) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
else {
  const lines = [`validate-figma-map: ${components.length} mapping(s), ${unmapped.length} unmapped (${result.pending} pending decision)`];
  for (const e of errors) lines.push(`  [error] ${e}`);
  for (const w of warnings) lines.push(`  [warn]  ${w}`);
  if (!errors.length && !warnings.length) lines.push("  OK");
  process.stdout.write(lines.join("\n") + "\n");
}
process.exitCode = errors.length ? 1 : 0;
