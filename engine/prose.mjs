// Prose consistency: tokens change by value, guidelines describe them in words. When a color token moves to
// another hue family, find the sentences in DESIGN.md files that still name the old family so the same
// change can rewrite them. The engine finds; Claude rewrites; the user approves.
import { parseColor, rgbToOklch } from "./color.mjs";

// Hue families on the OKLCH wheel, with the words guidelines use for them.
const FAMILIES = [
  [0, 20, "red", ["red", "crimson", "scarlet"]],
  [20, 60, "orange", ["orange", "terracotta", "coral", "amber", "rust", "peach"]],
  [60, 105, "yellow", ["yellow", "gold", "mustard", "cream"]],
  [105, 165, "green", ["green", "lime", "olive", "mint", "emerald", "sage"]],
  [165, 215, "teal", ["teal", "cyan", "turquoise", "aqua"]],
  [215, 275, "blue", ["blue", "navy", "azure", "cobalt", "sky"]],
  [275, 310, "purple", ["purple", "violet", "indigo", "lavender", "lilac"]],
  [310, 340, "magenta", ["magenta", "fuchsia", "plum", "orchid"]],
  [340, 360, "pink", ["pink", "rose", "blush"]],
];

/** Hue family of a color value: "pink", "blue", … or "neutral" for greys. null when unparseable. */
export function hueFamily(value) {
  const rgb = parseColor(value);
  if (!rgb) return null;
  const { c, h } = rgbToOklch(rgb);
  if (c < 0.04) return "neutral";
  return FAMILIES.find(([from, to]) => h >= from && h < to)?.[2] ?? "red";
}

/** Words a guideline might use for a hue family. */
export function familyWords(family) {
  return FAMILIES.find((f) => f[2] === family)?.[3] ?? (family === "neutral" ? ["grey", "gray", "neutral", "monochrome"] : []);
}

/**
 * Sentences in `text` that mention the old family of a color that moved to a new one.
 * @returns {Array<{ word: string, section: string, line: string }>}
 */
export function staleMentions(text, oldFamily, newFamily) {
  if (!text || !oldFamily || oldFamily === newFamily) return [];
  const words = familyWords(oldFamily);
  if (!words.length) return [];
  const re = new RegExp(`\\b(${words.join("|")})\\b`, "i");
  const out = [];
  let section = "";
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { section = h[1]; continue; }
    const m = line.match(re);
    if (m) out.push({ word: m[1], section, line: line.trim().slice(0, 120) });
  }
  return out;
}
