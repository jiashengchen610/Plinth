// Font loading generated from tokens. Every fontFamily used by a token (font/* and the fontFamily of
// typography/*) that is not a generic or system family is loaded from Google Fonts, so changing a font is
// one token change: the engine rewrites src/styles/fonts.css on regenerate. Zero dependencies.
import { loadConfig, listBrands, resolveBrand } from "./tokens.mjs";

// Families the browser already has, or that are CSS keywords: never fetched.
const LOCAL = new Set(["sans-serif", "serif", "monospace", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "cursive", "fantasy", "math", "emoji", "inherit", "-apple-system", "blinkmacsystemfont", "segoe ui", "roboto", "helvetica neue", "helvetica", "arial", "georgia", "times new roman", "times", "courier new", "courier", "menlo", "monaco", "consolas", "sf pro", "sf pro text", "sf pro display", "sf mono", "noto color emoji", "apple color emoji", "segoe ui emoji"]);
const DEFAULT_WEIGHTS = [400, 500, 600, 700];

const first = (v) => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => String(s).trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);

/** Google Fonts family name for a token family: "Geist Variable" → "Geist", "Inter" → "Inter". */
export const googleFamily = (name) => String(name).replace(/\s+variable$/i, "").trim();

/**
 * Families to load for a workspace, across all brands: [{ family, weights }], sorted.
 * Weights come from typography tokens using the family (plus the defaults shadcn utilities need).
 */
export function fontsToLoad(root, config = loadConfig(root)) {
  const map = new Map();
  const add = (name, weight) => {
    const family = googleFamily(name);
    if (!family || LOCAL.has(family.toLowerCase())) return;
    const w = map.get(family) ?? new Set(DEFAULT_WEIGHTS);
    if (weight) w.add(Number(weight) || 400);
    map.set(family, w);
  };
  for (const brand of listBrands(root, config)) {
    for (const t of resolveBrand(root, brand, config).tokens) {
      for (const v of Object.values(t.values)) {
        const raw = v.raw;
        if (t.type === "fontFamily") first(raw).slice(0, 1).forEach((f) => add(f));
        if (t.type === "typography" && raw && typeof raw === "object" && !t.derived) first(raw.fontFamily).slice(0, 1).forEach((f) => add(f, raw.fontWeight));
      }
    }
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([family, weights]) => ({ family, weights: [...weights].filter((w) => w >= 100 && w <= 900).sort((a, b) => a - b) }));
}

/** One @import per family (a family Google does not have fails alone). */
export function fontsCss(fonts) {
  const lines = ["/* Generated from font tokens by the design-system engine. Do not edit. */"];
  if (!fonts.length) lines.push("/* No web fonts: every font token names a system family. */");
  for (const f of fonts) {
    const family = encodeURIComponent(f.family).replace(/%20/g, "+");
    lines.push(`@import url("https://fonts.googleapis.com/css2?family=${family}:wght@${f.weights.join(";")}&display=swap");`);
  }
  return lines.join("\n") + "\n";
}
