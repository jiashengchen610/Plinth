// Token engine: loads a workspace's DTCG token files layer by layer, resolves aliases per brand and mode,
// converts values to CSS, and emits one generated stylesheet that supports every brand × mode combination.
// Also produces the flat token table the UI and the MCP tools use. Zero dependencies.
//
// Layers (design-system.json → layers, bottom to top; a token should reference its own layer or lower ones):
//   primitives   tokens/primitives.tokens.json            Tailwind's palette, radius and shadow scales, added colors
//   semantic     tokens/base.tokens.json, brands/<brand>/tokens.json   roles; the brand file overrides base
//   …            tokens/layers/<id>.tokens.json           layers the user adds, anywhere in the order
//   components   tokens/components/*.tokens.json          what each component uses
// Workspaces without `layers` (made before layers existed) have one layer: base + brand.
// Modes: a token's $value is the default (light) mode; other modes live in $extensions.plinth.modes.<mode>.
// Transparency: $extensions.plinth.alpha (0..1, or { default, <mode> }) draws a color token at that opacity,
//   so "destructive at 10%" stays an alias of destructive.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseColor, rgbToOklch, formatOklch } from "./color.mjs";

export const LEGACY_LAYERS = [{ id: "semantic", name: "Semantic", files: ["tokens/base.tokens.json", "brands/{brand}/tokens.json"] }];
export const layersOf = (config) => (Array.isArray(config.layers) && config.layers.length ? config.layers : LEGACY_LAYERS);

/** Token files of one brand, bottom layer first: [{ rel, layer, layerId }]. Patterns: {brand}, and * in a file name. */
export function layerFiles(root, config, brand) {
  const out = [];
  layersOf(config).forEach((layer, i) => {
    for (const pattern of layer.files ?? []) {
      const rel = pattern.replace("{brand}", brand);
      if (rel.includes("*")) {
        const dir = rel.slice(0, rel.lastIndexOf("/"));
        const suffix = rel.slice(rel.lastIndexOf("*") + 1);
        if (!existsSync(join(root, dir))) continue;
        for (const f of readdirSync(join(root, dir)).filter((n) => n.endsWith(suffix)).sort()) out.push({ rel: `${dir}/${f}`, layer: i, layerId: layer.id });
      } else if (existsSync(join(root, rel))) out.push({ rel, layer: i, layerId: layer.id });
    }
  });
  return out;
}

const WEIGHTS = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, normal: 400, regular: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 };
export const STRIP_GROUPS = new Set(["color", "colors", "semantic", "tokens"]);
// Groups that coincide with Tailwind v4 theme namespaces: the base variable gets the group as a
// suffix (--card-shadow) so the generated @theme entry (--shadow-card: var(--card-shadow)) is not circular.
const SUFFIX_GROUPS = { shadow: "shadow", shadows: "shadow", elevation: "shadow", radius: "radius", ease: "ease", easing: "ease", blur: "blur", font: "font", fonts: "font", typography: "font" };

const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const isAlias = (v) => typeof v === "string" && /^\{[^}]+\}$/.test(v.trim());

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadConfig(root) {
  const p = join(root, "design-system.json");
  if (!existsSync(p)) throw new Error(`design-system.json not found in ${root}`);
  return readJson(p);
}

export function listBrands(root, config = loadConfig(root)) {
  if (Array.isArray(config.brands) && config.brands.length) return config.brands.map((b) => (typeof b === "string" ? b : b.id));
  const dir = join(root, "brands");
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
}

// ---------- flatten ----------
function flatten(tree, source, out, path = [], inheritedType, layer = { layer: 0, layerId: "semantic" }) {
  if (!tree || typeof tree !== "object" || Array.isArray(tree)) return;
  const groupType = tree.$type ?? inheritedType;
  if ("$value" in tree) {
    const key = path.join("/");
    const ds = tree.$extensions?.plinth ?? {};
    const t = {
      path, key, source, layer: layer.layer, layerId: layer.layerId,
      type: tree.$type ?? groupType ?? inferType(path, tree.$value),
      description: tree.$description ?? "",
      values: { default: tree.$value, ...(ds.modes ?? {}) },
      alpha: ds.alpha ?? null,
      deprecated: Boolean(tree.$deprecated),
    };
    out.set(key, t);
    if (t.type === "typography" && tree.$value && typeof tree.$value === "object") expandTypography(t, out);
    return;
  }
  for (const [k, v] of Object.entries(tree)) if (!k.startsWith("$")) flatten(v, source, out, [...path, k], groupType, layer);
}

/** Opacity of a token in a mode: $extensions.plinth.alpha as a number, or per mode. 1 when unset. */
const alphaIn = (t, mode) => {
  const a = t.alpha;
  if (a === null || a === undefined) return 1;
  if (typeof a === "number") return a;
  return a[mode] ?? a.default ?? 1;
};
/** A resolved color at an opacity, as oklch with alpha (what contrast checks composite over the page). */
const withAlpha = (resolved, alpha) => {
  const rgb = parseColor(resolved);
  return rgb ? formatOklch({ ...rgbToOklch(rgb), alpha: (rgb.alpha ?? 1) * alpha }) : resolved;
};

function expandTypography(t, out) {
  const parts = { "font-family": ["fontFamily", "fontFamily"], "font-size": ["fontSize", "dimension"], "font-weight": ["fontWeight", "fontWeight"], "line-height": ["lineHeight", null], "letter-spacing": ["letterSpacing", "dimension"] };
  for (const [suffix, [prop, type]] of Object.entries(parts)) {
    const values = {};
    for (const [mode, v] of Object.entries(t.values)) if (v && typeof v === "object" && v[prop] !== undefined) values[mode] = v[prop];
    if (!Object.keys(values).length) continue;
    const lh = values.default;
    out.set(`${t.key}/${suffix}`, { path: [...t.path, suffix], key: `${t.key}/${suffix}`, source: t.source, layer: t.layer, layerId: t.layerId, type: type ?? (typeof lh === "object" ? "dimension" : "number"), description: "", values, derived: true });
  }
}

function inferType(path, value) {
  const l = path.join("/").toLowerCase();
  if (typeof value === "string" && /^#|^(rgb|hsl|oklch|oklab|color)\(/.test(value)) return "color";
  if (value && typeof value === "object" && ("colorSpace" in value || "hex" in value)) return "color";
  if (/radius|spacing|space|size|width|height|gap/.test(l)) return "dimension";
  if (/opacity|line-?height/.test(l)) return "number";
  return typeof value === "number" ? "dimension" : "string";
}

// ---------- naming ----------
export function cssName(token, config = {}) {
  const rename = config.tokens?.rename ?? {};
  if (rename[token.key]) return rename[token.key];
  const segs = token.path.flatMap((x) => String(x).split(/[./]/)).map(slug).filter(Boolean);
  while (segs.length > 1 && STRIP_GROUPS.has(segs[0])) segs.shift();
  const suffix = segs.length > 1 ? SUFFIX_GROUPS[segs[0]] : undefined;
  if (suffix) {
    const rest = segs.slice(1);
    if (token.derived) return rest.join("-");
    if (suffix === "font" && token.type === "typography") return rest.join("-") + "-font";
    return rest.join("-") + "-" + suffix;
  }
  return segs.join("-");
}

// ---------- values ----------
function colorCss(v) {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    if (typeof v.hex === "string" && (v.alpha === undefined || v.alpha === 1)) return v.hex;
    const space = String(v.colorSpace ?? "srgb").toLowerCase();
    const c = (v.components ?? []).map(Number);
    const a = v.alpha !== undefined && v.alpha !== 1 ? ` / ${v.alpha}` : "";
    if (space === "srgb") {
      const [r, g, b] = c.map((x) => Math.round(x * 255));
      return a ? `rgb(${r} ${g} ${b}${a})` : "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
    }
    if (space === "oklch" || space === "oklab") return `${space}(${c.join(" ")}${a})`;
    return `color(${space} ${c.join(" ")}${a})`;
  }
  return String(v);
}
const dim = (v) => (v && typeof v === "object" && "value" in v ? `${v.value}${v.unit ?? "px"}` : typeof v === "number" ? (v === 0 ? "0" : `${v}px`) : String(v ?? 0));
const fontList = (v) => (Array.isArray(v) ? v : [v]).map((f) => (/[^a-zA-Z0-9-]/.test(f) ? `'${f}'` : f)).join(", ");
const weight = (v) => (typeof v === "number" ? String(v) : String(WEIGHTS[String(v).trim().toLowerCase()] ?? v));

function literal(value, type, ref) {
  switch (type) {
    case "color": return colorCss(value);
    case "dimension": return dim(value);
    case "duration": return typeof value === "object" ? `${value.value}${value.unit ?? "ms"}` : String(value);
    case "fontWeight": return weight(value);
    case "fontFamily": return fontList(value);
    case "number": case "string": case "boolean": return String(value);
    case "shadow": {
      const list = Array.isArray(value) ? value : [value];
      return list.map((s) => (typeof s === "string" ? s : `${s.inset ? "inset " : ""}${dim(s.offsetX)} ${dim(s.offsetY)} ${dim(s.blur)} ${dim(s.spread)} ${ref(s.color, "color")}`)).join(", ");
    }
    case "gradient": {
      const stops = Array.isArray(value) ? value : value.stops ?? [];
      const angle = (!Array.isArray(value) && value.angle) || "180deg";
      return `linear-gradient(${angle}, ${stops.map((st) => `${ref(st.color, "color")} ${Math.round((st.position ?? 0) * 100)}%`).join(", ")})`;
    }
    case "cubicBezier": return Array.isArray(value) ? `cubic-bezier(${value.join(", ")})` : String(value);
    case "transition": {
      const d = typeof value.duration === "object" ? `${value.duration.value}${value.duration.unit ?? "ms"}` : value.duration ?? "150ms";
      const tf = Array.isArray(value.timingFunction) ? `cubic-bezier(${value.timingFunction.join(", ")})` : ref(value.timingFunction ?? "ease", "cubicBezier");
      return `${d} ${tf}`;
    }
    case "border": return `${dim(value.width)} ${value.style ?? "solid"} ${ref(value.color, "color")}`;
    case "typography": {
      const lh = value.lineHeight !== undefined ? `/${typeof value.lineHeight === "object" ? dim(value.lineHeight) : value.lineHeight}` : "";
      return `${weight(value.fontWeight ?? 400)} ${value.fontSize !== undefined ? dim(value.fontSize) : "1rem"}${lh} ${fontList(value.fontFamily ?? "inherit")}`;
    }
    default: return typeof value === "object" ? null : String(value);
  }
}

// ---------- resolve one brand ----------
/**
 * Load every layer's tokens for one brand (later files override earlier ones on the same path) and resolve every
 * token for every mode.
 * @returns {{ brand, modes: string[], layers: Array<{id,name}>, tokens: Array<{key,name,type,description,source,layer,layerId,refs,derived?,deprecated?,values:{[mode]:{raw,css,resolved,alpha}}}>, issues: string[] }}
 */
export function resolveBrand(root, brand, config = loadConfig(root)) {
  const map = new Map();
  if (!existsSync(join(root, "brands", brand, "tokens.json"))) throw new Error(`brand "${brand}" has no tokens.json`);
  for (const f of layerFiles(root, config, brand)) flatten(readJson(join(root, f.rel)), f.rel, map, [], undefined, f);

  const issues = [];
  const byKey = map;
  const byDot = new Map([...map.values()].map((t) => [t.path.join("."), t]));
  const names = new Map([...map.values()].map((t) => [t, cssName(t, config)]));
  const modes = [...new Set([...map.values()].flatMap((t) => Object.keys(t.values)))];
  const targetOf = (ref) => {
    const inner = ref.slice(1, -1).trim();
    return byKey.get(inner.replace(/\./g, "/")) ?? byDot.get(inner.replace(/\//g, ".")) ?? null;
  };
  const valueIn = (t, mode) => (t.values[mode] !== undefined ? t.values[mode] : t.values.default);

  const resolveRaw = (t, mode, seen = new Set()) => {
    const v = valueIn(t, mode);
    if (!isAlias(v)) return v;
    const target = targetOf(v);
    if (!target) { issues.push(`unresolved alias ${t.key} → ${v}`); return undefined; }
    if (seen.has(target.key)) { issues.push(`alias cycle at ${t.key}`); return undefined; }
    return resolveRaw(target, mode, new Set([...seen, t.key]));
  };
  // Opacity multiplies along an alias chain: "hover at 80%" of "destructive at 10%" is 8%.
  const alphaChain = (t, mode, seen = new Set()) => {
    const own = alphaIn(t, mode);
    const v = valueIn(t, mode);
    if (!isAlias(v)) return own;
    const target = targetOf(v);
    if (!target || seen.has(target.key)) return own;
    return own * alphaChain(target, mode, new Set([...seen, t.key]));
  };
  // Reference inside a composite: emit var() so the cascade follows brand/mode; resolve for previews.
  const refCss = (v, type) => {
    if (isAlias(v)) {
      const target = targetOf(v);
      if (!target) { issues.push(`unresolved alias in composite → ${v}`); return "currentColor"; }
      return `var(--${names.get(target)})`;
    }
    return literal(v, type, refCss) ?? String(v);
  };

  const tokens = [...map.values()].map((t) => {
    const values = {};
    for (const mode of modes) {
      const v = valueIn(t, mode);
      if (v === undefined) continue;
      let css;
      if (isAlias(v)) {
        const target = targetOf(v);
        css = target ? `var(--${names.get(target)})` : null;
        if (!target) issues.push(`unresolved alias ${t.key} → ${v}`);
      } else {
        css = literal(v, t.type, refCss);
        if (css === null) issues.push(`${t.key}: ${t.type} value is not emitted (unknown composite)`);
      }
      const own = t.type === "color" ? alphaIn(t, mode) : 1;
      if (css !== null && own < 1) css = `color-mix(in oklab, ${css} ${Number((own * 100).toFixed(2))}%, transparent)`;
      const raw = resolveRaw(t, mode);
      let resolved = raw === undefined ? null : literal(raw, t.type, refCss);
      const alpha = t.type === "color" ? alphaChain(t, mode) : 1;
      if (resolved !== null && alpha < 1) resolved = withAlpha(resolved, alpha);
      values[mode] = { raw: v, css, resolved, alpha };
    }
    const first = valueIn(t, "default");
    const refs = [...new Set(Object.values(t.values).filter(isAlias).map((v) => targetOf(v)?.key).filter(Boolean))];
    return { key: t.key, path: t.path, name: names.get(t), type: t.type, description: t.description, source: t.source, layer: t.layer, layerId: t.layerId, refs, linked: isAlias(first), derived: t.derived, deprecated: t.deprecated, values };
  });

  const seen = new Map();
  for (const t of tokens) {
    if (seen.has(t.name) && seen.get(t.name) !== t.key) issues.push(`name collision: --${t.name} from ${seen.get(t.name)} and ${t.key}`);
    seen.set(t.name, t.key);
  }
  return { brand, modes, layers: layersOf(config).map(({ id, name }) => ({ id, name: name ?? id })), tokens, issues: [...new Set(issues)] };
}

// ---------- Tailwind v4 @theme entries ----------
function themeEntries(tokens) {
  const have = new Set(tokens.map((t) => t.name));
  const lines = [];
  const add = (theme, base) => { if (theme !== base) lines.push(`  --${theme}: var(--${base});`); };
  for (const t of tokens) {
    const n = t.name, last = t.path.at(-1);
    if (t.type === "color") add(`color-${n}`, n);
    else if (/^radius/.test(n) || /radius$/.test(n)) { if (n !== "radius") add(`radius-${n.replace(/^radius-/, "").replace(/-radius$/, "")}`, n); }
    else if (t.type === "shadow") add(`shadow-${n.replace(/-shadow$/, "")}`, n);
    else if (t.type === "cubicBezier") add(`ease-${n.replace(/-ease$/, "")}`, n);
    else if (t.type === "fontFamily" && !t.derived) add(`font-${n.replace(/-font$/, "")}`, n);
    else if (t.derived && last === "font-size") {
      const base = n.replace(/-font-size$/, "");
      add(`text-${base}`, n);
      if (have.has(`${base}-line-height`)) lines.push(`  --text-${base}--line-height: var(--${base}-line-height);`);
    } else if (t.derived && last === "letter-spacing") add(`tracking-${n.replace(/-letter-spacing$/, "")}`, n);
    else if (t.type === "dimension" && /^spacing-|^space-/.test(n)) add(`spacing-${n.replace(/^spac(ing|e)-/, "")}`, n);
  }
  return [...new Set(lines)].sort();
}

// ---------- stylesheet ----------
/**
 * Build the generated stylesheet for every brand. The default brand (config.defaultBrand or the
 * first brand) also binds to :root / .dark so pages without data-brand still render.
 * Selectors: [data-brand="<id>"] for light, [data-brand="<id>"].dark for dark (both on <html>).
 */
export function buildCss(root, config = loadConfig(root)) {
  const brands = listBrands(root, config);
  if (!brands.length) throw new Error("no brands found (brands/<id>/tokens.json)");
  const defaultBrand = config.defaultBrand ?? brands[0];
  const resolved = brands.map((b) => resolveBrand(root, b, config));
  const issues = [];
  const out = ["/* Generated from tokens/ and brands/ by the design-system engine. Do not edit. */", ""];

  // Every brand must expose the same variable names, or switching brands leaks values.
  const nameSets = resolved.map((r) => new Set(r.tokens.filter((t) => Object.values(t.values).some((v) => v.css !== null)).map((t) => t.name)));
  const all = new Set(nameSets.flatMap((s) => [...s]));
  resolved.forEach((r, i) => {
    const missing = [...all].filter((n) => !nameSets[i].has(n));
    if (missing.length) issues.push(`brand "${r.brand}" is missing ${missing.length} token(s) other brands define: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ", …" : ""}`);
    issues.push(...r.issues.map((x) => `[${r.brand}] ${x}`));
  });

  // The palette is the same for every brand and mode: declare it once.
  const constant = (t) => t.layerId === "primitives" && Object.values(t.values).every((v) => v.css === t.values.default?.css);
  const palette = resolved[0].tokens.filter((t) => constant(t) && t.values.default?.css !== null).map((t) => `  --${t.name}: ${t.values.default.css};`).sort();
  if (palette.length) out.push(":root {", ...palette, "}", "");

  for (const r of resolved) {
    const isDefault = r.brand === defaultBrand;
    const otherModes = r.modes.filter((m) => m !== "default");
    const block = (mode) => r.tokens
      .filter((t) => !constant(t))
      .map((t) => {
        // A mode without its own value repeats the default so another brand's dark value never leaks in.
        const v = t.values[mode] ?? t.values.default;
        return v && v.css !== null ? `  --${t.name}: ${v.css};` : null;
      })
      .filter(Boolean)
      .sort();
    const lightSel = isDefault ? `:root,\n[data-brand="${r.brand}"]` : `[data-brand="${r.brand}"]`;
    out.push(`${lightSel} {`, ...block("default"), "}", "");
    for (const mode of otherModes) {
      const cls = mode === "dark" ? "dark" : `theme-${slug(mode)}`;
      const sel = isDefault ? `.${cls},\n[data-brand="${r.brand}"].${cls}` : `[data-brand="${r.brand}"].${cls}`;
      out.push(`${sel} {`, ...block(mode), "}", "");
    }
  }
  const theme = themeEntries(resolved.find((r) => r.brand === defaultBrand).tokens);
  if (theme.length) out.push("@theme inline {", ...theme, "}", "");
  return { css: out.join("\n"), brands, defaultBrand, issues };
}
