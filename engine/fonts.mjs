// Font loading generated from tokens. Every family a font role or a text style ends at (font roles point at fonts
// in the palette; text styles point at roles) that is not a generic or system family is loaded from Google Fonts,
// so changing a font is one token change: the engine rewrites src/styles/fonts.css on regenerate. Zero dependencies.
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
  // Families and weights as resolved: font roles and text styles point at fonts by reference ({font.body}).
  for (const brand of listBrands(root, config)) {
    const tokens = resolveBrand(root, brand, config).tokens;
    const byKey = new Map(tokens.map((t) => [t.key, t]));
    for (const t of tokens) {
      for (const [mode, v] of Object.entries(t.values)) {
        // Fonts in the palette load only when a role points at them (through these role tokens).
        if (t.type === "fontFamily" && !t.derived && t.layerId !== "primitives") first(v.resolved).slice(0, 1).forEach((f) => add(f));
        if (t.type === "typography" && !t.derived && v.raw && typeof v.raw === "object") {
          const part = (name) => { const p = byKey.get(`${t.key}/${name}`); return (p?.values[mode] ?? p?.values.default)?.resolved; };
          first(part("font-family")).slice(0, 1).forEach((f) => add(f, part("font-weight")));
        }
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
