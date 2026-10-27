#!/usr/bin/env node
// Generate engine/icon-sets/lucide.json from an installed lucide-react: every icon's SVG elements, by name, with
// aliases. Plinth ships this set so a design system can vendor icons into its repo without depending on an icon
// package. Run when upgrading Lucide:
//   node scripts/lucide-icons.mjs <path to node_modules/lucide-react>
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = process.argv[2];
if (!pkgDir) { console.error("usage: node scripts/lucide-icons.mjs <node_modules/lucide-react>"); process.exit(64); }
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const dir = join(pkgDir, "dist", "esm", "icons");

const icons = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort()) {
  const src = readFileSync(join(dir, file), "utf8");
  // const __iconData = { name: "check", size: 24, node: [["path", { d: "…", key: "…" }]] };
  const m = /const __iconData = (\{[\s\S]*?\n\});/.exec(src);
  if (!m) continue;
  const data = new Function(`return (${m[1]});`)();
  icons[data.name] = data.node.map(([tag, attrs]) => [tag, Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== "key"))]);
}
// Aliases: files that re-export another icon (loader-2 → loader-circle).
const aliases = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith(".mjs"))) {
  const name = file.replace(/\.mjs$/, "");
  if (icons[name]) continue;
  const m = /from '\.\/([a-z0-9-]+)\.mjs'/.exec(readFileSync(join(dir, file), "utf8"));
  if (m && icons[m[1]]) aliases[name] = m[1];
}

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "icon-sets", "lucide.json");
mkdirSync(dirname(out), { recursive: true });
const license = readFileSync(join(pkgDir, "LICENSE"), "utf8").split("\n---")[0].trim();
writeFileSync(out, JSON.stringify({ name: "Lucide", version: pkg.version, license: "ISC", licenseText: license, homepage: "https://lucide.dev", size: 24, aliases, icons }) + "\n");
console.log(`${Object.keys(icons).length} icons, ${Object.keys(aliases).length} aliases → ${out}`);
