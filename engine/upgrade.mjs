// Bring a workspace made before layers existed onto the layered model, as one proposal the user reviews:
// the Tailwind palette, component tokens, the layer list, radius roles, and the base components rewritten to use
// component tokens, but only those still exactly as they were scaffolded (the user's own edits are never replaced).
// Colors stay as they are; "Link colors to the palette" is a separate, optional step (linkToPaletteOps).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig, listBrands, resolveBrand } from "./tokens.mjs";
import { deltaE } from "./color.mjs";

const BASE_COMPONENTS = ["button", "badge", "card", "input", "label"];

const firstCommit = (root) => execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: root, encoding: "utf8" }).trim().split("\n").at(-1);
const atCommit = (root, sha, rel) => { try { return execFileSync("git", ["show", `${sha}:${rel}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };

/** @returns {null | { title, rationale, ops, kept: string[] }} null when the workspace already has layers */
export function upgradeProposal(root, templateDir) {
  const config = loadConfig(root);
  if (Array.isArray(config.layers)) return null;
  const tpl = (rel) => readFileSync(join(templateDir, rel), "utf8");
  const tplConfig = JSON.parse(tpl("design-system.json"));
  const ops = [];

  ops.push({ op: "write", file: "tokens/primitives.tokens.json", content: tpl("tokens/primitives.tokens.json") });
  for (const f of readdirSync(join(templateDir, "tokens", "components"))) {
    ops.push({ op: "write", file: `tokens/components/${f}`, content: tpl(`tokens/components/${f}`) });
  }
  // Radius roles the component tokens point at.
  const base = JSON.parse(tpl("tokens/base.tokens.json"));
  for (const [role, t] of Object.entries(base.radius)) {
    if (role.startsWith("$")) continue;
    ops.push({ op: "set", file: "tokens/base.tokens.json", path: `radius/${role}`, type: "dimension", value: t.$value, description: t.$description });
  }
  // Base components: replaced only when untouched since they were scaffolded.
  const kept = [];
  let first = null;
  try { first = firstCommit(root); } catch { /* not a git repository */ }
  for (const c of BASE_COMPONENTS) {
    const rel = `src/components/${c}/${c}.tsx`;
    if (!existsSync(join(root, rel))) continue;
    const now = readFileSync(join(root, rel), "utf8");
    if (first && atCommit(root, first, rel) === now) ops.push({ op: "write", file: rel, content: tpl(rel) });
    else kept.push(rel);
  }
  ops.push({ op: "write", file: "design-system.json", content: JSON.stringify({ ...config, layers: tplConfig.layers }, null, 2) + "\n" });

  return {
    title: "Upgrade to layered tokens",
    rationale: `Adds the Tailwind palette as the bottom layer, component tokens on top, and the layer list. Colors keep their values; link them to the palette afterwards if you like.${kept.length ? ` Kept as they are because they were edited: ${kept.join(", ")}.` : ""} The shared index.css drops its derived radius scale, so rounded-sm…4xl follow Tailwind's values.`,
    ops,
    kept,
  };
}

/**
 * Point fixed semantic colors at the closest palette color when it is visually the same (ΔE_OK under `max`,
 * about two just-noticeable differences). Per brand file and mode; colors with no close match stay as they are.
 */
export function linkToPaletteOps(root, { max = 0.04 } = {}) {
  const config = loadConfig(root);
  const ops = [], unmatched = [];
  for (const brand of listBrands(root, config)) {
    const r = resolveBrand(root, brand, config);
    const palette = r.tokens.filter((t) => t.layerId === "primitives" && t.type === "color" && t.path[0] === "color" && (t.path.length === 3 || ["white", "black"].includes(t.path[1])));
    if (!palette.length) return { ops: [], unmatched: [], reason: "no palette layer yet: upgrade first" };
    for (const t of r.tokens) {
      if (t.type !== "color" || t.layerId === "primitives" || t.derived) continue;
      if (!t.source.startsWith("brands/") && !t.source.startsWith("tokens/base")) continue;
      for (const [mode, v] of Object.entries(t.values)) {
        if (typeof v.raw !== "string" || /^\{/.test(v.raw)) continue;
        if (mode !== "default" && v.raw === t.values.default?.raw) continue;
        let best = null;
        for (const p of palette) {
          const d = deltaE(v.raw, p.values.default.resolved);
          if (d !== null && (!best || d < best.d)) best = { d, ref: `{${p.path.join(".")}}`, name: p.name };
        }
        if (best && best.d <= max) ops.push({ op: "set", file: t.source, path: t.key, mode: mode === "default" ? undefined : mode, value: best.ref, why: `${t.name} (${brand}, ${mode === "default" ? "light" : mode}) ${v.raw} → ${best.name} (ΔE ${best.d.toFixed(3)})` });
        else unmatched.push({ brand, token: t.key, mode, value: v.raw, closest: best?.name, deltaE: best ? Number(best.d.toFixed(3)) : null });
      }
    }
  }
  // Base tokens are shared: the same op can come from every brand.
  const seen = new Set();
  return { ops: ops.filter((o) => { const k = `${o.file}|${o.path}|${o.mode ?? ""}`; return !seen.has(k) && seen.add(k); }), unmatched };
}
