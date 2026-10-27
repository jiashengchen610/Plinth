// Palette colors: a user's color becomes a full 50–950 scale shaped like Tailwind's. The lightness and chroma curves
// are measured from the Tailwind palette in tokens/primitives.tokens.json, so a new hue sits next to the built-in
// ones. The given color lands exactly on its nearest step; the hue stays the same on every step.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseColor, rgbToOklch, oklchToRgb, formatOklch } from "./color.mjs";

// Keep a step inside what screens can show (sRGB): chroma is reduced, lightness and hue kept.
const inGamut = (lch) => formatOklch({ ...rgbToOklch(oklchToRgb(lch)), l: lch.l, h: lch.h });

export const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
// Greys and near-greys: their chroma says nothing about a colorful scale.
const NEUTRAL = new Set(["slate", "gray", "zinc", "neutral", "stone", "mauve", "olive", "mist", "taupe"]);

/** Average lightness, and chroma relative to each hue's peak, per step, over Tailwind's colorful hues. */
export function paletteProfile(primitives) {
  const L = Object.fromEntries(SHADES.map((s) => [s, []]));
  const C = Object.fromEntries(SHADES.map((s) => [s, []]));
  for (const [hue, scale] of Object.entries(primitives.color ?? {})) {
    if (hue.startsWith("$") || NEUTRAL.has(hue) || !scale || !scale["500"]) continue;
    const lch = Object.fromEntries(SHADES.map((s) => [s, scale[s] && rgbToOklch(parseColor(scale[s].$value) ?? { r: 0, g: 0, b: 0 })]));
    const peak = Math.max(...SHADES.map((s) => lch[s]?.c ?? 0));
    if (!peak) continue;
    for (const s of SHADES) if (lch[s]) { L[s].push(lch[s].l); C[s].push(lch[s].c / peak); }
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return { l: Object.fromEntries(SHADES.map((s) => [s, mean(L[s])])), c: Object.fromEntries(SHADES.map((s) => [s, mean(C[s])])) };
}

/** The primitives file of a workspace, or the template's. */
export function loadPrimitives(root, templateDir) {
  for (const p of [join(root, "tokens", "primitives.tokens.json"), templateDir && join(templateDir, "tokens", "primitives.tokens.json")]) {
    if (p && existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  }
  return { color: {} };
}

/**
 * A 50–950 scale around `value`.
 * @returns {{ anchor: string, shades: Record<string, string> }} anchor is the step the given color landed on
 */
export function generateScale(value, profile) {
  const rgb = parseColor(value);
  if (!rgb) throw new Error(`not a color: ${value}`);
  const { l, c, h } = rgbToOklch(rgb);
  const anchorIdx = SHADES.reduce((best, s, i) => (Math.abs(profile.l[s] - l) < Math.abs(profile.l[SHADES[best]] - l) ? i : best), 0);
  const anchor = SHADES[anchorIdx];
  const shift = l - profile.l[anchor];
  const peak = c / Math.max(profile.c[anchor], 0.05);
  const shades = {};
  SHADES.forEach((s, i) => {
    if (i === anchorIdx) { shades[s] = formatOklch({ l, c, h }); return; }
    // The lightness offset of the given color fades out towards both ends, so 50 stays light and 950 dark.
    const fade = 1 - Math.min(1, Math.abs(i - anchorIdx) / (i < anchorIdx ? anchorIdx || 1 : SHADES.length - 1 - anchorIdx || 1));
    const L = Math.min(0.99, Math.max(0.1, profile.l[s] + shift * fade));
    shades[s] = inGamut({ l: L, c: Math.max(0, peak * profile.c[s]), h });
  });
  return { anchor, shades };
}

/** Ops that add (or replace) a palette color named `name`. */
export function paletteColorOps(root, { name, value, templateDir }) {
  const slugName = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slugName) throw new Error("a palette color needs a name, e.g. brand-red");
  const primitives = loadPrimitives(root, templateDir);
  const { anchor, shades } = generateScale(value, paletteProfile(primitives));
  const replacing = Boolean(primitives.color?.[slugName]);
  return {
    name: slugName, anchor, shades, replacing,
    ops: SHADES.map((s) => ({ op: "set", file: "tokens/primitives.tokens.json", path: `color/${slugName}/${s}`, type: "color", value: shades[s] })),
  };
}
