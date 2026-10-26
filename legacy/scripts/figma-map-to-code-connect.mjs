#!/usr/bin/env node
/**
 * figma-map-to-code-connect.mjs — generate parserless Code Connect templates (`<Name>.figma.ts`) from figma-map.json.
 *
 *   node scripts/figma-map-to-code-connect.mjs [--map .design-system/figma-map.json] [--component Button]...
 *        [--out-dir <dir>] [--write-map] [--dry-run]
 *
 * Follows the official `figma-code-connect` skill's parserless format: header comments (url/source/component),
 * `import figma from 'figma'`, `figma.selectedInstance`, `getString/getEnum/getBoolean/getInstanceSwap/getSlot`,
 * and a default export `{ example: figma.code`…`, imports, id, metadata }`. Never emits `.figma.tsx` or `figma.connect()`.
 *
 * What it cannot know is left as `// TODO(code-connect):` lines for the agent to resolve with the official skill
 * (nested instance rendering for boolean-toggled icons, custom transforms). Publishing is done by ds-figma-map via
 * `add_code_connect_map` (MCP) or `npx figma connect publish`.
 *
 * --write-map  records codeConnect.templatePath (status stays "local") in figma-map.json
 * Exit codes: 0 ok; 1 nothing generated; 65 map missing/invalid.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";

const args = process.argv.slice(2);
const one = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const multi = (n) => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []));
const flag = (n) => args.includes(n);
const cwd = process.cwd();
const cfg = existsSync(resolve(cwd, ".design-system/config.json")) ? JSON.parse(readFileSync(resolve(cwd, ".design-system/config.json"), "utf8")) : {};
const mapPath = resolve(cwd, one("--map", cfg.figmaMap ?? ".design-system/figma-map.json"));
const only = new Set(multi("--component"));
const outDirOpt = one("--out-dir");
const writeMap = flag("--write-map");
const dryRun = flag("--dry-run");

if (!existsSync(mapPath)) {
  process.stderr.write(`figma-map-to-code-connect: ${mapPath} not found\n`);
  process.exit(65);
}
const map = JSON.parse(readFileSync(mapPath, "utf8"));

const camel = (s) => {
  const parts = String(s).replace(/[^a-zA-Z0-9]+/g, " ").trim().split(" ");
  const out = parts.map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1))).join("");
  return /^[0-9]/.test(out) ? "p" + out : out || "value";
};
const q = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const kebab = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

function stateAttr(value) {
  // values map for `state` transforms: {} | null | { disabled: true } | { "aria-busy": true } …
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return Object.entries(value).map(([k, v]) => (v === true ? k : `${k}=${JSON.stringify(v)}`)).join(" ");
  return String(value);
}

function generate(entry) {
  const { figma: f, code: c, props = [], children = [] } = entry;
  const name = c.component;
  const lines = [];
  const todos = [];
  const url = f.url ?? (map.figma?.fileKey && f.nodeId ? `https://www.figma.com/design/${map.figma.fileKey}/?node-id=${f.nodeId.replace(":", "-")}` : null);
  if (!url) return { error: `${f.name}: no url and no fileKey+nodeId; cannot write the url= header` };

  lines.push(`// url=${url}`, `// source=${c.path ?? "unknown"}`, `// component=${name}`, `import figma from 'figma'`, `const instance = figma.selectedInstance`, "");

  const attrs = [];
  const childParts = [];
  const used = new Set();
  const varName = (base) => {
    let v = camel(base);
    while (used.has(v)) v += "_";
    used.add(v);
    return v;
  };

  for (const p of props) {
    const fname = p.figma.name;
    const prop = p.code?.prop;
    const transform = p.code?.transform;
    switch (p.figma.type) {
      case "TEXT": {
        const v = varName(fname);
        lines.push(`const ${v} = instance.getString(${q(fname)})`);
        if (prop === "children" || !prop) childParts.push(`\${${v}}`);
        else attrs.push(`${prop}="\${${v}}"`);
        break;
      }
      case "VARIANT": {
        const v = varName(fname);
        const values = p.values ?? {};
        if (transform === "state" || prop === null) {
          const entries = Object.entries(values).map(([k, val]) => `  ${q(k)}: ${q(stateAttr(val))},`);
          lines.push(`// Figma visual states have no prop; only states that change markup emit attributes.`, `const ${v} = instance.getEnum(${q(fname)}, {`, ...entries, `})`);
          attrs.push(`\${${v}}`);
        } else {
          const entries = Object.entries(values).map(([k, val]) => `  ${q(k)}: ${val === null ? "undefined" : q(val)},`);
          lines.push(`const ${v} = instance.getEnum(${q(fname)}, {`, ...entries, `})`);
          attrs.push(`${prop}="\${${v}}"`);
        }
        break;
      }
      case "BOOLEAN": {
        const v = varName(fname);
        lines.push(`const ${v} = instance.getBoolean(${q(fname)})`);
        if (transform === "leading-icon" || transform === "trailing-icon") {
          const child = children.find((ch) => /icon/i.test(ch.figma?.name ?? "")) ?? null;
          const pos = transform === "leading-icon" ? "inline-start" : "inline-end";
          todos.push(`resolve the ${transform} child: use instance.findInstance({ name: ${q(child?.figma?.name ?? "Icon")} }) and executeTemplate() if the icon component has its own template; the placeholder below renders a generic icon.`);
          const piece = `\${${v} ? figma.code\`<Icon data-icon="${pos}" />\` : ''}`;
          if (transform === "leading-icon") childParts.unshift(piece);
          else childParts.push(piece);
        } else if (prop) {
          attrs.push(`\${${v} ? '${prop}' : ''}`);
        } else {
          todos.push(`boolean ${q(fname)} has no code prop and no known transform (${transform ?? "none"}); decide what it toggles.`);
        }
        break;
      }
      case "INSTANCE_SWAP": {
        const v = varName(fname);
        lines.push(`const ${v} = instance.getInstanceSwap(${q(fname)})`, `let ${v}Code`, `if (${v} && ${v}.type === 'INSTANCE') {`, `  ${v}Code = ${v}.executeTemplate().example`, `}`);
        if (prop === "children" || !prop) childParts.push(`\${${v}Code ?? ''}`);
        else attrs.push(`\${${v}Code ? figma.code\`${prop}={\${${v}Code}}\` : ''}`);
        break;
      }
      case "SLOT": {
        const v = varName(fname);
        lines.push(`const ${v} = instance.getSlot(${q(fname)})`);
        childParts.push(`\${${v}}`);
        break;
      }
      default:
        todos.push(`unknown Figma property type ${p.figma.type} for ${q(fname)}`);
    }
  }
  if (transformNotes(props).length) todos.push(...transformNotes(props));

  lines.push("");
  const attrText = attrs.length ? " " + attrs.join(" ") : "";
  const example = childParts.length
    ? `figma.code\`<${name}${attrText}>${childParts.join("")}</${name}>\``
    : `figma.code\`<${name}${attrText} />\``;
  lines.push(
    `export default {`,
    `  example: ${example},`,
    `  imports: [${q(`import { ${name} } from "${c.import}"`)}],`,
    `  id: ${q(kebab(name))},`,
    `  metadata: { nestable: true },`,
    `}`,
    "",
  );
  if (todos.length) lines.splice(5, 0, ...todos.map((t) => `// TODO(code-connect): ${t}`));
  return { text: lines.join("\n"), todos };
}

function transformNotes(props) {
  return props.filter((p) => p.code?.transform && !["state", "leading-icon", "trailing-icon"].includes(p.code.transform) && !p.code.transform.startsWith("slot:"))
    .map((p) => `prop ${q(p.figma.name)} uses custom transform "${p.code.transform}"; implement it by hand.`);
}

const results = [];
for (const entry of map.components ?? []) {
  if (only.size && !only.has(entry.code?.component) && !only.has(entry.figma?.name)) continue;
  if (entry.source === "suggested") {
    results.push({ name: entry.figma.name, skipped: "suggested mapping not confirmed" });
    continue;
  }
  const gen = generate(entry);
  if (gen.error) {
    results.push({ name: entry.figma.name, skipped: gen.error });
    continue;
  }
  const dir = outDirOpt ? resolve(cwd, outDirOpt) : entry.code.path ? resolve(cwd, dirname(entry.code.path)) : resolve(cwd, "src/figma");
  const file = join(dir, `${basename(entry.code.path ?? entry.code.component.toLowerCase(), ".tsx")}.figma.ts`);
  if (!dryRun) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, gen.text);
  }
  entry.codeConnect = { ...(entry.codeConnect ?? {}), status: entry.codeConnect?.status === "published" ? "published" : "local", templatePath: file.replace(cwd, ".").split("\\").join("/") };
  results.push({ name: entry.figma.name, file, todos: gen.todos.length });
  if (dryRun) process.stdout.write(`\n--- ${file}\n${gen.text}`);
}

if (writeMap && !dryRun) writeFileSync(mapPath, JSON.stringify(map, null, 2) + "\n");

const generated = results.filter((r) => r.file);
process.stdout.write(`figma-map-to-code-connect: ${generated.length} template(s)${dryRun ? " (dry-run)" : ""}\n`);
for (const r of results) process.stdout.write(r.file ? `  + ${r.file}${r.todos ? `  (${r.todos} TODO)` : ""}\n` : `  - ${r.name}: skipped — ${r.skipped}\n`);
if (writeMap && !dryRun) process.stdout.write(`  updated codeConnect.templatePath in ${mapPath}\n`);
process.stdout.write(`Next: review TODO lines, then publish with the Figma MCP (add_code_connect_map) via ds-figma-map, or 'npx figma connect publish'.\n`);
process.exitCode = generated.length ? 0 : 1;
