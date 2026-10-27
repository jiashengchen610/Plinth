#!/usr/bin/env node
// Generate template/tokens/primitives.tokens.json from an installed Tailwind CSS: its color palette, radius scale
// and shadow scale become the primitive layer. Run when upgrading Tailwind:
//   node scripts/tailwind-primitives.mjs <path to node_modules/tailwindcss/theme.css>
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const themePath = process.argv[2];
if (!themePath) { console.error("usage: node scripts/tailwind-primitives.mjs <tailwindcss/theme.css>"); process.exit(64); }
const css = readFileSync(themePath, "utf8");
const version = JSON.parse(readFileSync(join(dirname(themePath), "package.json"), "utf8")).version;

// oklch(97.1% 0.013 17.38) → oklch(0.971 0.013 17.38): one notation across the system.
const normalize = (v) => v.replace(/oklch\(\s*([\d.]+)%/, (_, l) => `oklch(${Number((Number(l) / 100).toFixed(4))}`);

const color = { $type: "color", $description: `Tailwind CSS ${version} palette` };
for (const [, hue, shade, value] of css.matchAll(/--color-([a-z]+)-(\d+):\s*([^;]+);/g)) {
  color[hue] ??= {};
  color[hue][shade] = { $value: normalize(value.trim()) };
}
color.white = { $value: "oklch(1 0 0)" };
color.black = { $value: "oklch(0 0 0)" };

const radius = { $type: "dimension", none: { $value: { value: 0, unit: "px" } } };
for (const [, name, v] of css.matchAll(/--radius-([a-z0-9]+):\s*([\d.]+)rem;/g)) radius[name] = { $value: { value: Number(v), unit: "rem" } };
radius.full = { $value: { value: 9999, unit: "px" } };

const shadow = { $type: "shadow" };
for (const [, name, v] of css.matchAll(/--shadow-([a-z0-9]+):\s*([^;]+);/g)) if (name !== "inner") shadow[name] = { $value: v.trim() };

const out = { color, radius, shadow };
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "template", "tokens", "primitives.tokens.json");
writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
const hues = Object.keys(color).filter((k) => !k.startsWith("$"));
console.log(`wrote ${target}: ${hues.length} color groups, ${Object.keys(radius).length - 1} radii, ${Object.keys(shadow).length - 1} shadows (Tailwind ${version})`);
