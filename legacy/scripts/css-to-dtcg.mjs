#!/usr/bin/env node
/**
 * css-to-dtcg.mjs — extract CSS custom properties (shadcn `:root` / `.dark` blocks) into a DTCG token file.
 *
 * The reverse of build-tokens.mjs: seeds `.design-system/tokens.json` from an existing codebase so the
 * code-side variables can be pushed into Figma with the `import-tokens-figma` skill, or so a project that
 * has no Figma variables yet still gets a token source of truth.
 *
 *   node scripts/css-to-dtcg.mjs [--css src/index.css] [--out .design-system/tokens.json]
 *        [--selector light=:root] [--selector dark=.dark] [--group color] [--merge] [--dry-run]
 *
 * --group <name>   wrap color tokens under this group (default "color"; build-tokens strips it again)
 * --merge          keep tokens already present in --out (existing values win; new vars are added)
 * Skips the managed region written by build-tokens.mjs and any `@theme` block (those are derived).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const args = process.argv.slice(2);
const one = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const multi = (n) => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []));
const flag = (n) => args.includes(n);

const cwd = process.cwd();
const cfgPath = resolve(cwd, ".design-system/config.json");
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
const cssPath = resolve(cwd, one("--css", cfg.tokens?.cssOutput ?? "src/index.css"));
const outPath = resolve(cwd, one("--out", cfg.tokens?.dtcg ?? ".design-system/tokens.json"));
const colorGroup = one("--group", "color");
const merge = flag("--merge");
const dryRun = flag("--dry-run");

const selectors = Object.fromEntries(
  (multi("--selector").length ? multi("--selector") : ["light=:root", "dark=.dark"]).map((s) => {
    const i = s.indexOf("=");
    return [s.slice(0, i), s.slice(i + 1)];
  }),
);

if (!existsSync(cssPath)) {
  process.stderr.write(`css-to-dtcg: ${cssPath} not found\n`);
  process.exit(65);
}
let css = readFileSync(cssPath, "utf8");
// Drop derived regions: build-tokens managed region and @theme blocks.
css = css.replace(/\/\* design-system-skills:tokens:start[\s\S]*?design-system-skills:tokens:end \*\//g, "");
css = css.replace(/@theme[^{]*\{[\s\S]*?\n\}/g, "");
css = css.replace(/\/\*[\s\S]*?\*\//g, "");

function blockFor(selector) {
  // Match `<selector> {` at line start (not nested in @media); take the first balanced block.
  const re = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "g");
  const decls = {};
  let m;
  while ((m = re.exec(css)) !== null) {
    let depth = 1, i = re.lastIndex, start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    const body = css.slice(start, i - 1);
    for (const d of body.matchAll(/--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g)) decls[d[1]] = d[2].trim();
  }
  return decls;
}

function typeOf(name, value) {
  if (/^(#|rgb|hsl|oklch|oklab|color\()/.test(value)) return "color";
  if (/^var\(--/.test(value)) return "alias";
  if (/^-?[\d.]+(px|rem|em|%)$/.test(value)) return "dimension";
  if (/^-?[\d.]+$/.test(value)) return "number";
  if (/font|family/.test(name)) return "fontFamily";
  if (/^\d+ms$|^\d+s$/.test(value)) return "duration";
  if (/calc\(|min\(|max\(|clamp\(/.test(value)) return "expression";
  return "string";
}

const perMode = Object.fromEntries(Object.entries(selectors).map(([mode, sel]) => [mode, blockFor(sel)]));
const modeNames = Object.keys(perMode);
const primary = modeNames[0];
const names = new Set(modeNames.flatMap((m) => Object.keys(perMode[m])));

const tokens = {};
const skipped = [];
for (const name of [...names].sort()) {
  const primaryValue = perMode[primary][name] ?? perMode[modeNames.find((m) => perMode[m][name])][name];
  const type = typeOf(name, primaryValue);
  if (type === "expression") {
    skipped.push(`${name} = ${primaryValue} (calc/min/max expression; keep it in CSS)`);
    continue;
  }
  const path = type === "color" ? [colorGroup, name] : [name];
  let node = tokens;
  for (const seg of path.slice(0, -1)) node = node[seg] ??= {};
  const leaf = { $type: type === "alias" ? inferAliasType(primaryValue) : type };
  leaf.$value = encode(primaryValue, type);
  const modes = {};
  for (const m of modeNames) if (m !== primary && perMode[m][name] !== undefined) modes[m] = encode(perMode[m][name], typeOf(name, perMode[m][name]));
  leaf.$extensions = { "ds-skills": { source: "code", ...(Object.keys(modes).length ? { modes } : {}) } };
  node[path.at(-1)] = leaf;
}

function inferAliasType(v) {
  const target = v.match(/^var\(--([a-zA-Z0-9_-]+)\)/)?.[1];
  const tv = target && (perMode[primary][target] ?? "");
  return tv ? typeOf(target, tv) : "color";
}
function encode(value, type) {
  if (type === "alias") {
    const target = value.match(/^var\(--([a-zA-Z0-9_-]+)\)/)?.[1];
    const tv = target && perMode[primary][target];
    const ttype = tv ? typeOf(target, tv) : "color";
    return `{${ttype === "color" ? colorGroup + "." : ""}${target}}`;
  }
  if (type === "dimension") {
    const m = value.match(/^(-?[\d.]+)(px|rem|em|%)$/);
    return m ? { value: Number(m[1]), unit: m[2] } : value;
  }
  if (type === "number") return Number(value);
  if (type === "fontFamily") return value.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
  return value;
}

let doc = {
  $schema: "https://tr.designtokens.org/format/",
  $extensions: { "ds-skills": { exportedAt: new Date().toISOString(), exporter: "css-to-dtcg.mjs", sourceCss: cssPath.replace(cwd, ".").split("\\").join("/") } },
  ...tokens,
};
let added = names.size - skipped.length;
if (merge && existsSync(outPath)) {
  const existing = JSON.parse(readFileSync(outPath, "utf8"));
  const deepMerge = (base, extra) => {
    for (const [k, v] of Object.entries(extra)) {
      if (k === "$extensions" && base.$extensions) continue;
      if (v && typeof v === "object" && !Array.isArray(v) && !("$value" in v) && base[k] && typeof base[k] === "object" && !("$value" in base[k])) deepMerge(base[k], v);
      else if (!(k in base)) base[k] = v;
      else added--;
    }
    return base;
  };
  doc = deepMerge(existing, doc);
}

const text = JSON.stringify(doc, null, 2) + "\n";
const summary = [`css-to-dtcg: ${names.size} variables in ${cssPath} (modes: ${modeNames.join(", ")}) → ${added} token(s) ${merge ? "added to" : "written to"} ${outPath}`];
if (skipped.length) summary.push("  skipped:", ...skipped.map((s) => "    " + s));
if (dryRun) {
  process.stdout.write(summary.join("\n") + "\n\n" + text);
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text);
  process.stdout.write(summary.join("\n") + "\n");
}
