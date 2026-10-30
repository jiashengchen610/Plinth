// Resolved tokens for other platforms (exports/tokens/<brand>.<mode>.json): every token of a brand in one mode with
// its references followed and its value in plain terms, so an app's agent or build (SwiftUI, Compose, Flutter, a
// second web stack) reads values instead of resolving aliases, picking modes and converting CSS. Colors are hex
// with a separate alpha (and oklch for reference), lengths are px numbers (rem × 16) except em, durations are ms,
// shadows, typography, gradients and transitions are structured. Recipes (glass) keep their parameters: a platform
// maps them to its own material rather than translating CSS. Deterministic: nothing but the tokens goes in.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, listBrands, resolveBrand } from "./tokens.mjs";
import { parseColor, formatHex, formatOklch, rgbToOklch } from "./color.mjs";
import { PLINTH_VERSION } from "./workspace.mjs";

export const EXPORT_DIR = "exports/tokens";
const modeName = (m) => (m === "default" ? "light" : m);
const round = (x, d = 3) => Number(Number(x).toFixed(d));
const isAlias = (v) => typeof v === "string" && /^\{[^}]+\}$/.test(v.trim());

// ---------- value parsers ----------
const DIM = /^(-?[\d.]+)(px|rem|em|%|ms|s)?$/;
const unitize = (value, unit) => (unit === "rem" ? { value: round(value * 16), unit: "px" } : unit === "s" ? { value: round(value * 1000), unit: "ms" } : { value: round(value), unit });
/** A length or time as { value, unit }: rem becomes px, s becomes ms, em and % stay. */
export function dimension(v, fallbackUnit = "px") {
  if (v && typeof v === "object" && "value" in v) return unitize(Number(v.value), v.unit ?? fallbackUnit);
  if (typeof v === "number") return { value: round(v), unit: fallbackUnit };
  const m = DIM.exec(String(v ?? "").trim());
  return m ? unitize(Number(m[1]), m[2] ?? fallbackUnit) : null;
}
/** A color as { value: "#rrggbb", alpha, oklch }; an unparseable one keeps its text. */
export function colorValue(v, alphaMul = 1) {
  const c = parseColor(v);
  if (!c) return v === undefined || v === null ? null : { value: String(v) };
  const alpha = round((c.alpha ?? 1) * alphaMul);
  return { value: formatHex(c), alpha, oklch: formatOklch({ ...rgbToOklch(c), alpha: 1 }) };
}
const fontList = (v) => (Array.isArray(v) ? v.map(String) : String(v).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
const bezier = (v) => (Array.isArray(v) ? v.map(Number) : (String(v).match(/^cubic-bezier\(([^)]*)\)$/)?.[1].split(",").map((n) => Number(n.trim())) ?? String(v)));
const weight = (v) => (typeof v === "number" ? v : /^\d+$/.test(String(v)) ? Number(v) : String(v));
/** Split a CSS list on the commas outside parentheses. */
const splitTop = (s) => {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of String(s)) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
/** One CSS shadow ("inset 0 1px 2px 0 rgb(0 0 0 / 0.1)") as a structure; the color is last, as Plinth and Tailwind write it. */
function parseShadow(text) {
  let s = text.trim();
  const inset = /^inset\s+/i.test(s);
  if (inset) s = s.replace(/^inset\s+/i, "");
  const m = s.match(/^(.*?)\s*((?:rgba?|oklch|oklab|hsla?|color)\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+)$/i);
  const lengths = (m ? m[1] : s).trim().split(/\s+/).filter(Boolean).map((x) => dimension(x));
  const zero = { value: 0, unit: "px" };
  const [x = zero, y = zero, blur = zero, spread = zero] = lengths;
  return { inset, x, y, blur, spread, color: m ? colorValue(m[2]) : null };
}

/** Follow aliases through a brand's resolved token list. */
function resolver(tokens) {
  const byDot = new Map(tokens.map((t) => [t.path.join("."), t]));
  const byKey = new Map(tokens.map((t) => [t.key, t]));
  const target = (ref) => { const inner = ref.slice(1, -1).trim(); return byDot.get(inner.replace(/\//g, ".")) ?? byKey.get(inner.replace(/\./g, "/")) ?? null; };
  const rawIn = (t, mode) => (t.values[mode] ?? t.values.default)?.raw;
  /** The raw value at the end of the alias chain, and the token that holds it. */
  const rawOf = (t, mode, seen = new Set()) => {
    const v = rawIn(t, mode);
    if (!isAlias(v)) return { value: v, from: t };
    const tg = target(v);
    if (!tg || seen.has(tg.key)) return { value: undefined, from: t };
    return rawOf(tg, mode, new Set([...seen, t.key]));
  };
  /** A value that may be an alias (a part of a composite), followed to its raw value. */
  const deep = (v, mode) => (isAlias(v) ? rawOf(target(v) ?? { values: {}, key: "" }, mode).value : v);
  return { target, rawOf, deep };
}

/** One token's value in plain terms for a mode. */
function exportValue(t, mode, R) {
  const { value: raw } = R.rawOf(t, mode);
  const deep = (v) => R.deep(v, mode);
  switch (t.type) {
    case "color": return colorValue(raw, t.values[mode]?.alpha ?? 1);
    case "dimension": return t.fit?.on ? dimension(t.values[mode]?.resolved) : dimension(raw);
    case "duration": return dimension(raw, "ms");
    case "fontWeight": return weight(raw);
    case "fontFamily": return fontList(raw);
    case "cubicBezier": return bezier(raw);
    case "number": case "string": case "boolean": return raw;
    case "transition": return raw && typeof raw === "object" ? { duration: dimension(raw.duration ?? "150ms", "ms"), easing: bezier(deep(raw.timingFunction ?? "ease")) } : raw;
    case "shadow": {
      const list = Array.isArray(raw) ? raw : typeof raw === "string" ? splitTop(raw) : raw ? [raw] : [];
      return list.map((s) => (typeof s === "string" ? parseShadow(s) : { inset: Boolean(s.inset), x: dimension(s.offsetX), y: dimension(s.offsetY), blur: dimension(s.blur), spread: dimension(s.spread ?? 0), color: colorValue(deep(s.color)) }));
    }
    case "gradient": {
      const stops = Array.isArray(raw) ? raw : raw?.stops ?? [];
      return { angle: t.gradient?.angle ?? 180, stops: stops.map((st, i) => ({ color: colorValue(deep(st.color)), position: round(st.position ?? i / Math.max(1, stops.length - 1)) })) };
    }
    case "border": return raw && typeof raw === "object" ? { width: dimension(raw.width), style: raw.style ?? "solid", color: colorValue(deep(raw.color)) } : raw;
    case "typography": {
      if (!raw || typeof raw !== "object") return raw;
      const lh = deep(raw.lineHeight);
      return {
        fontFamily: fontList(deep(raw.fontFamily ?? "inherit")),
        fontSize: dimension(deep(raw.fontSize ?? "1rem")),
        fontWeight: weight(deep(raw.fontWeight ?? 400)),
        lineHeight: lh === undefined ? undefined : typeof lh === "number" ? lh : dimension(lh),
        ...(raw.letterSpacing !== undefined ? { letterSpacing: dimension(deep(raw.letterSpacing)) } : {}),
      };
    }
    default: return raw;
  }
}

/**
 * The resolved tokens of one brand in one mode.
 * @returns {{ name, plinth, brand, mode, tokens: Record<string, { type, value, cssVar, layer, ref?, description?, glass? }> }}
 */
export function exportBrandMode(root, brand, mode, config = loadConfig(root), resolved = resolveBrand(root, brand, config)) {
  const R = resolver(resolved.tokens);
  const tokens = {};
  for (const t of resolved.tokens.filter((x) => !x.derived).sort((a, b) => a.path.join(".").localeCompare(b.path.join(".")))) {
    const own = (t.values[mode] ?? t.values.default)?.raw;
    const ref = isAlias(own) ? R.target(own)?.path.join(".") ?? null : null;
    tokens[t.path.join(".")] = {
      type: t.type,
      value: exportValue(t, mode, R),
      cssVar: `--${t.name}`,
      layer: t.layerId ?? null,
      ...(ref ? { ref } : {}),
      ...(t.description ? { description: t.description } : {}),
      ...(t.glass ? { glass: t.glass } : {}),
      ...(t.deprecated ? { deprecated: true } : {}),
    };
  }
  return { name: config.name ?? null, plinth: PLINTH_VERSION, brand, mode: modeName(mode), tokens };
}

/** Every brand × mode, plus the index that lists them. */
export function tokenExports(root, config = loadConfig(root)) {
  const files = {};
  const brands = {};
  for (const brand of listBrands(root, config)) {
    const resolved = resolveBrand(root, brand, config);
    brands[brand] = { modes: {} };
    for (const mode of resolved.modes) {
      const file = `${brand}.${modeName(mode)}.json`;
      files[file] = exportBrandMode(root, brand, mode, config, resolved);
      brands[brand].modes[modeName(mode)] = file;
    }
  }
  files["index.json"] = { name: config.name ?? null, plinth: PLINTH_VERSION, brands, format: "Every token of a brand in one mode, references followed: colors as hex with alpha (and oklch), lengths in px (em kept), durations in ms, structured shadows, typography, gradients and transitions; glass keeps its recipe." };
  return files;
}

/** Write them under exports/tokens/ and return the paths written. */
export function writeTokenExports(root, config = loadConfig(root)) {
  const dir = join(root, EXPORT_DIR);
  mkdirSync(dir, { recursive: true });
  const files = tokenExports(root, config);
  for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(data, null, 2) + "\n");
  return Object.keys(files).map((f) => `${EXPORT_DIR}/${f}`);
}
