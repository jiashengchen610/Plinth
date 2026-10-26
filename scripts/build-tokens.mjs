#!/usr/bin/env node
/**
 * build-tokens.mjs — DTCG tokens → CSS variables in a managed region of the project's CSS entry.
 *
 * Zero dependencies. Input/output rules: references/dtcg-schema.md.
 *
 *   node scripts/build-tokens.mjs [--in <tokens.json>]... [--mode <name>=<file>]... [--css <file>]
 *        [--config .design-system/config.json] [--theme] [--check] [--dry-run] [--json]
 *
 * Defaults come from .design-system/config.json → tokens.dtcg and tokens.cssOutput.
 * --theme   also emit `@theme inline` entries for tokens that have no Tailwind utility yet
 * --check   exit 1 if the managed region would change (drift detection), write nothing
 * --dry-run print the region, write nothing
 *
 * Exit codes: 0 ok; 1 drift (--check) or unresolved aliases with --strict; 64 usage; 65 input error.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ---------------- args / config ----------------
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const multi = (n) => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []));
const one = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);

const cwd = process.cwd();
const cfgPath = resolve(cwd, one("--config", ".design-system/config.json"));
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
const tcfg = cfg.tokens ?? {};

const inputs = multi("--in").length ? multi("--in") : [tcfg.dtcg ?? ".design-system/tokens.json"];
const modeFiles = multi("--mode").map((s) => {
  const i = s.indexOf("=");
  return { mode: s.slice(0, i), file: s.slice(i + 1) };
});
const cssPath = resolve(cwd, one("--css", tcfg.cssOutput ?? "src/index.css"));
const emitTheme = flag("--theme");
const check = flag("--check");
const dryRun = flag("--dry-run");
const asJson = flag("--json");
const strict = flag("--strict");

const START = tcfg.managedRegion?.start ?? "/* design-system-skills:tokens:start";
const END = tcfg.managedRegion?.end ?? "/* design-system-skills:tokens:end */";
const MODE_SELECTORS = { light: ":root", default: ":root", value: ":root", base: ":root", dark: ".dark", ...(tcfg.modeSelectors ?? {}) };
const STRIP_GROUPS = new Set((tcfg.stripGroups ?? ["color", "colors", "semantic", "tokens", "shadcn", "sds"]).map((s) => s.toLowerCase()));
const PREFIX = tcfg.prefix ?? "";
const RENAME = tcfg.rename ?? {};

const warnings = [];
const die = (code, msg) => {
  process.stderr.write(`build-tokens: ${msg}\n`);
  process.exit(code);
};

// ---------------- load + flatten ----------------
function slug(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Flatten a DTCG (or Tokens Studio) tree into tokens: { path:[], type, valuesByMode:{mode:value}, ext } */
function flatten(tree, defaultMode, out, path = [], inheritedType) {
  if (tree === null || typeof tree !== "object" || Array.isArray(tree)) return;
  const groupType = tree.$type ?? inheritedType;
  const isLeaf = "$value" in tree || ("value" in tree && !("$value" in tree) && path.length > 0 && typeof tree.value !== "object" || (typeof tree.value === "object" && tree.type));
  if (isLeaf) {
    const value = "$value" in tree ? tree.$value : tree.value;
    const type = tree.$type ?? tree.type ?? inheritedType ?? inferType(path, value);
    const key = path.join("/");
    const t = out.get(key) ?? { path, type, valuesByMode: {}, ext: {}, description: tree.$description ?? tree.description ?? "" };
    t.type = type;
    t.valuesByMode[defaultMode] = value;
    const fx = tree.$extensions?.["figma-console-mcp"];
    if (fx?.modes) for (const [m, v] of Object.entries(fx.modes)) t.valuesByMode[m] = v;
    if (fx) t.ext.figma = { variableId: fx.variableId, key: fx.key };
    const ds = tree.$extensions?.["ds-skills"];
    if (ds?.modes) for (const [m, v] of Object.entries(ds.modes)) t.valuesByMode[m] = v;
    if (ds?.source) t.ext.source = ds.source;
    out.set(key, t);
    // Typography composites also expand into per-property tokens so Tailwind gets --text-*, --leading-*, --tracking-*.
    if (type === "typography" && value && typeof value === "object") {
      const parts = {
        "font-family": ["fontFamily", "fontFamily"],
        "font-size": ["fontSize", "dimension"],
        "font-weight": ["fontWeight", "fontWeight"],
        "line-height": ["lineHeight", typeof value.lineHeight === "object" ? "dimension" : "number"],
        "letter-spacing": ["letterSpacing", "dimension"],
      };
      for (const [suffix, [prop, ptype]] of Object.entries(parts)) {
        if (value[prop] === undefined) continue;
        const skey = `${key}/${suffix}`;
        const st = out.get(skey) ?? { path: [...path, suffix], type: ptype, valuesByMode: {}, ext: { derived: true }, description: "" };
        st.valuesByMode[defaultMode] = value[prop];
        for (const src of [fx?.modes, ds?.modes]) {
          if (!src) continue;
          for (const [m, mv] of Object.entries(src)) if (mv && typeof mv === "object" && mv[prop] !== undefined) st.valuesByMode[m] = mv[prop];
        }
        out.set(skey, st);
      }
    }
    return;
  }
  for (const [k, v] of Object.entries(tree)) {
    if (k.startsWith("$")) continue; // $themes, $metadata, $schema, $extensions on groups
    flatten(v, defaultMode, out, [...path, k], groupType);
  }
}

function inferType(path, value) {
  const l = path.join("/").toLowerCase();
  if (typeof value === "string" && /^#|^(rgb|hsl|oklch|oklab|color)\(/.test(value)) return "color";
  if (/color|colour|bg|background|foreground|border|ring/.test(l)) return "color";
  if (/radius|spacing|space|size|width|height|gap/.test(l)) return "dimension";
  if (/opacity|line-?height|weight/.test(l)) return "number";
  if (/font.?family|typeface/.test(l)) return "fontFamily";
  return typeof value === "number" ? "dimension" : "string";
}

const tokens = new Map();
for (const f of inputs) {
  const p = resolve(cwd, f);
  if (!existsSync(p)) die(65, `input not found: ${p}`);
  let doc;
  try {
    doc = JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    die(65, `${p}: ${e.message}`);
  }
  flatten(doc, "default", tokens);
}
for (const { mode, file } of modeFiles) {
  const p = resolve(cwd, file);
  if (!existsSync(p)) die(65, `mode file not found: ${p}`);
  flatten(JSON.parse(readFileSync(p, "utf8")), mode, tokens);
}
if (tokens.size === 0) die(65, "no tokens found in input");

// ---------------- naming ----------------
// Groups that coincide with Tailwind v4 @theme namespaces get the group as a SUFFIX on the base variable
// (--card-shadow, --snappy-ease, --sans-font, --display-font) so the generated @theme entry (--shadow-card: var(--card-shadow))
// is never circular. Typography sub-properties drop the group instead (--display-font-size).
const SUFFIX_GROUPS = { shadow: "shadow", shadows: "shadow", elevation: "shadow", ease: "ease", easing: "ease", blur: "blur", font: "font", fonts: "font", typography: "font", type: "font", text: "font" };
function cssName(t) {
  const src = t.path.join("/");
  if (RENAME[src]) return PREFIX + RENAME[src];
  const segs = t.path.flatMap((x) => String(x).split(/[./]/)).map(slug).filter(Boolean);
  while (segs.length > 1 && STRIP_GROUPS.has(segs[0])) segs.shift();
  const suffix = segs.length > 1 ? SUFFIX_GROUPS[segs[0]] : undefined;
  if (suffix) {
    const rest = segs.slice(1);
    if (t.ext?.derived) return PREFIX + rest.join("-");            // typography part: display-font-size
    if (suffix === "font" && t.type === "typography") return PREFIX + rest.join("-") + "-font";
    return PREFIX + rest.join("-") + "-" + suffix;                     // card-shadow, snappy-ease, sans-font
  }
  return PREFIX + segs.join("-");
}
const byPath = new Map([...tokens.values()].map((t) => [t.path.join("/"), t]));
const byDotPath = new Map([...tokens.values()].map((t) => [t.path.join("."), t]));
const names = new Map([...tokens.values()].map((t) => [t, cssName(t)]));
{
  const seen = new Map();
  for (const [t, n] of names) {
    if (seen.has(n)) warnings.push(`name collision on --${n}: ${seen.get(n)} and ${t.path.join("/")} (last wins)`);
    seen.set(n, t.path.join("/"));
  }
}

// ---------------- values ----------------
const WEIGHTS = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, normal: 400, regular: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 };
const unresolved = [];

function aliasTarget(ref) {
  const inner = ref.slice(1, -1).trim();
  return byPath.get(inner.replace(/\./g, "/")) ?? byDotPath.get(inner.replace(/\//g, ".")) ?? null;
}
const isAlias = (v) => typeof v === "string" && /^\{[^}]+\}$/.test(v.trim());

function colorToCss(v) {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    if (typeof v.hex === "string" && (v.alpha === undefined || v.alpha === 1)) return v.hex;
    const space = (v.colorSpace ?? "srgb").toLowerCase();
    const c = (v.components ?? []).map((x) => (x === "none" ? "none" : Number(x)));
    const a = v.alpha !== undefined && v.alpha !== 1 ? ` / ${v.alpha}` : "";
    if (space === "srgb") {
      const [r, g, b] = c.map((x) => Math.round(x * 255));
      if (!a) return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
      return `rgb(${r} ${g} ${b}${a})`;
    }
    if (space === "hsl") return `hsl(${c[0]} ${c[1]}% ${c[2]}%${a})`;
    if (space === "oklch" || space === "oklab" || space === "lab" || space === "lch") return `${space}(${c.join(" ")}${a})`;
    return `color(${space} ${c.join(" ")}${a})`;
  }
  return String(v);
}
function dimensionToCss(v) {
  if (typeof v === "number") return v === 0 ? "0" : `${v}px`;
  if (v && typeof v === "object" && "value" in v) return `${v.value}${v.unit ?? "px"}`;
  return String(v);
}
function literal(value, type) {
  switch (type) {
    case "color": return colorToCss(value);
    case "dimension": return dimensionToCss(value);
    case "duration": return typeof value === "object" ? `${value.value}${value.unit ?? "ms"}` : String(value);
    case "fontWeight": {
      if (typeof value === "number") return String(value);
      const w = WEIGHTS[String(value).trim().toLowerCase()];
      if (w) return String(w);
      warnings.push(`font weight "${value}" is not numeric; emitted as-is`);
      return String(value);
    }
    case "fontFamily": {
      const list = Array.isArray(value) ? value : [value];
      return list.map((f) => (/[^a-zA-Z0-9-]/.test(f) ? `'${f}'` : f)).join(", ");
    }
    case "number": case "boolean": case "string": return String(value);
    default:
      return compositeToCss(value, type);
  }
}

// Composite types (DTCG 2025.10): the token layer is deliberately a superset of what Figma Variables can hold
// (Figma: color/number/string/boolean only; shadows, gradients, typography, motion live in styles or nowhere).
function dim(v) {
  if (v && typeof v === "object" && "value" in v) return `${v.value}${v.unit ?? "px"}`;
  if (typeof v === "number") return v === 0 ? "0" : `${v}px`;
  return String(v ?? 0);
}
function colorRef(v) {
  if (isAlias(v)) {
    const t = aliasTarget(v);
    if (!t) { unresolved.push(`composite → ${v}`); return "currentColor"; }
    return `var(--${names.get(t)})`;
  }
  return colorToCss(v);
}
function fontList(v) {
  const list = Array.isArray(v) ? v : [v];
  return list.map((f) => (/[^a-zA-Z0-9-]/.test(f) ? `'${f}'` : f)).join(", ");
}
function compositeToCss(value, type) {
  if (typeof value === "string" || typeof value === "number") return String(value); // custom types pass through
  if (!value || typeof value !== "object") return String(value);
  switch (type) {
    case "shadow": {
      const list = Array.isArray(value) ? value : [value];
      return list.map((s) => (typeof s === "string" ? s : `${s.inset ? "inset " : ""}${dim(s.offsetX)} ${dim(s.offsetY)} ${dim(s.blur)} ${dim(s.spread)} ${colorRef(s.color)}`)).join(", ");
    }
    case "gradient": {
      const stops = Array.isArray(value) ? value : value.stops ?? [];
      const angle = (!Array.isArray(value) && value.angle) || "180deg";
      return `linear-gradient(${angle}, ${stops.map((st) => `${colorRef(st.color)} ${Math.round((st.position ?? 0) * 100)}%`).join(", ")})`;
    }
    case "cubicBezier":
      return Array.isArray(value) ? `cubic-bezier(${value.join(", ")})` : String(value);
    case "transition": {
      const d = typeof value.duration === "object" ? `${value.duration.value}${value.duration.unit ?? "ms"}` : value.duration ?? "150ms";
      const tf = Array.isArray(value.timingFunction) ? `cubic-bezier(${value.timingFunction.join(", ")})` : isAlias(value.timingFunction) ? colorRef(value.timingFunction) : value.timingFunction ?? "ease";
      const delay = typeof value.delay === "object" ? `${value.delay.value}${value.delay.unit ?? "ms"}` : value.delay;
      return `${d} ${tf}${delay ? ` ${delay}` : ""}`;
    }
    case "border":
      return `${dim(value.width)} ${value.style ?? "solid"} ${colorRef(value.color)}`;
    case "typography": {
      const size = value.fontSize !== undefined ? dim(value.fontSize) : "1rem";
      const lh = value.lineHeight !== undefined ? `/${typeof value.lineHeight === "object" ? dim(value.lineHeight) : value.lineHeight}` : "";
      const w = typeof value.fontWeight === "number" ? value.fontWeight : (WEIGHTS[String(value.fontWeight ?? "").trim().toLowerCase()] ?? value.fontWeight ?? 400);
      return `${w} ${size}${lh} ${fontList(value.fontFamily ?? "inherit")}`;
    }
    default:
      return null; // unknown composite: reported, not emitted
  }
}
function resolveValue(t, mode, depth = 0) {
  const v = t.valuesByMode[mode] ?? t.valuesByMode.default;
  if (v === undefined) return undefined;
  if (isAlias(v)) {
    const target = aliasTarget(v);
    if (!target) {
      unresolved.push(`${t.path.join("/")} → ${v}`);
      return null;
    }
    if (depth > 10) {
      unresolved.push(`${t.path.join("/")}: alias cycle`);
      return null;
    }
    // Emit var() so the cascade keeps following the target; fall back to a literal if the target has no value.
    const targetHas = target.valuesByMode[mode] !== undefined || target.valuesByMode.default !== undefined;
    return targetHas ? `var(--${names.get(target)})` : resolveValue(target, mode, depth + 1);
  }
  return literal(v, t.type);
}

// ---------------- selector blocks ----------------
const modes = [...new Set([...tokens.values()].flatMap((t) => Object.keys(t.valuesByMode)))];
const selectorFor = (m) => MODE_SELECTORS[m.toLowerCase()] ?? `[data-theme="${slug(m)}"]`;
const blocks = new Map(); // selector -> [lines]
const composites = [];
const emitted = new Set();
for (const t of tokens.values()) {
  for (const m of Object.keys(t.valuesByMode)) {
    const css = resolveValue(t, m);
    if (css === undefined) continue;
    if (css === null) {
      if (t.valuesByMode[m] && typeof t.valuesByMode[m] === "object" && !isAlias(t.valuesByMode[m])) composites.push(`${t.path.join("/")} (${t.type})`);
      continue;
    }
    const sel = selectorFor(m);
    (blocks.get(sel) ?? blocks.set(sel, []).get(sel)).push(`  --${names.get(t)}: ${css};`);
    emitted.add(names.get(t));
  }
}
const order = [...blocks.keys()].sort((a, b) => (a === ":root" ? -1 : b === ":root" ? 1 : a.localeCompare(b)));

// ---------------- CSS file: existing vars + @theme coverage ----------------
let css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";
const startIdx = css.indexOf(START);
const endIdx = css.indexOf(END);
const outside = startIdx >= 0 && endIdx > startIdx ? css.slice(0, startIdx) + css.slice(endIdx + END.length) : css;
const declaredVars = new Set([...outside.matchAll(/--([a-zA-Z0-9_-]+)\s*:/g)].map((m) => m[1]));
const themeVars = new Set([...outside.matchAll(/@theme[^{]*\{([\s\S]*?)\}/g)].flatMap((m) => [...m[1].matchAll(/--([a-zA-Z0-9_-]+)\s*:/g)].map((x) => x[1])));

const newVars = [...emitted].filter((n) => !declaredVars.has(n));
const overridden = [...emitted].filter((n) => declaredVars.has(n));
const codeOnly = [...declaredVars].filter((n) => !emitted.has(n) && !/^(color|radius|spacing|font|font-weight|shadow|animate|tw-|ease|text|leading|tracking|breakpoint|container)-/.test(n) && !themeVars.has(n));

const themeLines = [];
if (emitTheme) {
  const add = (themeName, baseVar) => { if (!themeVars.has(themeName) && themeName !== baseVar) themeLines.push(`  --${themeName}: var(--${baseVar});`); };
  for (const t of tokens.values()) {
    const n = names.get(t);
    if (!emitted.has(n)) continue;
    const last = t.path.at(-1);
    const joined = t.path.join("/");
    if (t.type === "color") { if (n !== "color") add(`color-${n.replace(/^color-/, "")}`, n); continue; }
    if (/radius/.test(n)) { if (n !== "radius") add(`radius-${n.replace(/^radius-/, "").replace(/-radius$/, "")}`, n); continue; }
    if (t.type === "shadow") { add(`shadow-${n.replace(/-shadow$/, "")}`, n); continue; }
    if (t.type === "cubicBezier") { add(`ease-${n.replace(/-ease$/, "")}`, n); continue; }
    if (t.type === "fontFamily" && !t.ext?.derived) { add(`font-${n.replace(/-font$/, "")}`, n); continue; }
    if (t.ext?.derived) {
      // typography parts: --text-<name> (+ --line-height companion), --tracking-<name>
      if (last === "font-size") {
        const base = n.replace(/-font-size$/, "");
        add(`text-${base}`, n);
        if (emitted.has(`${base}-line-height`) && !themeVars.has(`text-${base}`)) themeLines.push(`  --text-${base}--line-height: var(--${base}-line-height);`);
      } else if (last === "letter-spacing") add(`tracking-${n.replace(/-letter-spacing$/, "")}`, n);
      continue;
    }
    if (t.type === "dimension" && /blur/.test(joined)) { add(`blur-${n.replace(/-blur$/, "")}`, n); continue; }
    if (t.type === "dimension" && /spacing|space/.test(joined)) { if (n !== "spacing") add(`spacing-${n.replace(/^spacing-/, "")}`, n); continue; }
    if (t.type === "number" && last === "line-height") { add(`leading-${n.replace(/-line-height$/, "")}`, n); continue; }
  }
}

// ---------------- region ----------------
const stamp = new Date().toISOString();
const header = `${START} | source: ${inputs.join(", ")}${modeFiles.length ? " + " + modeFiles.map((m) => `${m.mode}=${m.file}`).join(", ") : ""} | ${stamp} | do not edit by hand */`;
const region = [header];
const byVarName = (a, b) => a.slice(0, a.indexOf(":")).localeCompare(b.slice(0, b.indexOf(":")));
for (const sel of order) region.push(`${sel} {`, ...blocks.get(sel).sort(byVarName), `}`);
if (themeLines.length) region.push(`@theme inline {`, ...themeLines.sort(byVarName), `}`);
region.push(END);
const regionText = region.join("\n");

// Compare ignoring the timestamp.
const stripStamp = (s) => s.replace(/\| \d{4}-\d{2}-\d{2}T[^|]*\| do not edit/, "| <stamp> | do not edit");
const existingRegion = startIdx >= 0 && endIdx > startIdx ? css.slice(startIdx, endIdx + END.length) : null;
const changed = existingRegion === null || stripStamp(existingRegion) !== stripStamp(regionText);

let nextCss;
if (existingRegion !== null) nextCss = css.slice(0, startIdx) + regionText + css.slice(endIdx + END.length);
else nextCss = (css.endsWith("\n") || css === "" ? css : css + "\n") + "\n" + regionText + "\n";

// ---------------- report ----------------
const report = {
  tokens: tokens.size,
  modes,
  selectors: order,
  emittedVars: emitted.size,
  overriddenVars: overridden.length,
  newVars,
  codeOnlyVars: codeOnly,
  composites,
  unresolvedAliases: unresolved,
  themeEntriesAdded: themeLines.length,
  changed,
  cssPath,
  warnings,
};

if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  const lines = [
    `build-tokens: ${tokens.size} tokens, modes [${modes.join(", ")}] → ${order.join(", ")}`,
    `  emitted ${emitted.size} variables: ${overridden.length} override existing declarations, ${newVars.length} new`,
  ];
  if (newVars.length) lines.push(`  new (no declaration in CSS yet): ${newVars.join(", ")}`);
  if (codeOnly.length) lines.push(`  code-only (declared in CSS, no token; candidates for import-tokens-figma): ${codeOnly.join(", ")}`);
  if (composites.length) lines.push(`  composite tokens not emitted (map by hand): ${composites.join(", ")}`);
  if (unresolved.length) lines.push(`  unresolved aliases: ${unresolved.join("; ")}`);
  if (themeLines.length) lines.push(`  @theme inline entries added: ${themeLines.length}`);
  for (const w of warnings) lines.push(`  warning: ${w}`);
  lines.push(changed ? (check ? `  DRIFT: managed region in ${cssPath} is out of date` : dryRun ? `  would update ${cssPath}` : `  updated ${cssPath}`) : `  ${cssPath} already up to date`);
  process.stdout.write(lines.join("\n") + "\n");
  if (dryRun) process.stdout.write("\n" + regionText + "\n");
}

if (check) process.exitCode = changed ? 1 : 0;
else if (!dryRun && changed) writeFileSync(cssPath, nextCss);
if (strict && unresolved.length) process.exitCode = 1;
