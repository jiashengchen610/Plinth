// Bring a workspace made before layers existed onto the layered model, as one proposal the user reviews:
// the Tailwind palette, component tokens, the layer list, radius roles, and the base components rewritten to use
// component tokens, but only those still exactly as they were scaffolded (the user's own edits are never replaced).
// Colors stay as they are; "Link colors to the palette" is a separate, optional step (linkToPaletteOps).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { loadConfig, listBrands, resolveBrand } from "./tokens.mjs";
import { deltaE } from "./color.mjs";
import { fontKind, fontSlug } from "./style.mjs";

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

// Every version of a template component file Plinth shipped (scripts/shipped-hashes.mjs): an upgrade replaces a
// user's copy only while it is exactly one of these.
const SHIPPED = JSON.parse(readFileSync(new URL("./shipped-components.json", import.meta.url), "utf8"));
const lfHash = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
const firstFamily = (v) => (Array.isArray(v) ? v[0] : typeof v === "string" && !/^\{/.test(v) ? v.split(",")[0].trim().replace(/^['"]|['"]$/g, "") : null);

/**
 * For a layered design system made before font roles (one family in font.sans, two text styles): fonts in the
 * palette, font roles, the template's text styles, a text token for every part of the catalog components it has,
 * and those components rewritten to use them, but only files still exactly as Plinth shipped them.
 * A display font different from the text font becomes the headings font.
 * @returns {null | { title, rationale, ops, kept: string[], references: string[] }} null when it has font roles
 */
export function typographyUpgrade(root, templateDir) {
  const config = loadConfig(root);
  if (!Array.isArray(config.layers)) return null; // the layers upgrade comes first
  const readJson = (dir, rel) => (existsSync(join(dir, rel)) ? JSON.parse(readFileSync(join(dir, rel), "utf8")) : {});
  const base = readJson(root, "tokens/base.tokens.json");
  if (base.font?.body !== undefined) return null;
  const tplBase = readJson(templateDir, "tokens/base.tokens.json");
  const ops = [];
  const BASE = "tokens/base.tokens.json", PRIM = "tokens/primitives.tokens.json";
  const palette = new Set();
  const inPalette = (family) => {
    const slug = fontSlug(family);
    if (!palette.has(slug)) { palette.add(slug); ops.push({ op: "set", file: PRIM, path: `font/${slug}`, type: "fontFamily", value: [family, { serif: "serif", mono: "monospace", sans: "sans-serif" }[fontKind(family)]] }); }
    return `{font.${slug}}`;
  };

  // Fonts: the family in use is the text font; a different display family becomes the headings font.
  const text = firstFamily(base.font?.sans?.$value) ?? "Geist";
  const display = firstFamily(base.typography?.display?.$value?.fontFamily);
  const roles = {
    body: inPalette(text),
    heading: display && display !== text ? inPalette(display) : "{font.body}",
    label: "{font.body}",
    code: inPalette(/^geist$/i.test(text) ? "Geist Mono" : "JetBrains Mono"),
    sans: "{font.body}",
    mono: "{font.code}",
  };
  for (const [role, value] of Object.entries(roles)) ops.push({ op: "set", file: BASE, path: `font/${role}`, type: "fontFamily", value, description: tplBase.font?.[role]?.$description });

  // Text styles: the template's, with the display size kept; the old body style goes (its name is now the role's).
  const oldDisplay = base.typography?.display?.$value;
  if (base.typography?.body) ops.push({ op: "delete", file: BASE, path: "typography/body" });
  const styles = (node, path) => Object.entries(node).filter(([k]) => !k.startsWith("$")).flatMap(([k, v]) => ("$value" in v ? [[`${path}/${k}`, v]] : styles(v, `${path}/${k}`)));
  for (const [path, t] of styles(tplBase.typography ?? {}, "typography")) {
    const value = path === "typography/display" && oldDisplay && typeof oldDisplay === "object" ? { ...t.$value, ...oldDisplay, fontFamily: "{font.heading}", letterSpacing: oldDisplay.letterSpacing ?? t.$value.letterSpacing } : t.$value;
    ops.push({ op: "set", file: BASE, path, type: "typography", value, description: t.$description });
  }

  // Component text tokens (and anything else newer), and component code while exactly as shipped.
  const refresh = componentRefresh(root, templateDir);
  ops.push(...refresh.ops);
  const kept = refresh.kept;
  // Code that used the old body style by name.
  const references = [];
  const walk = (dir) => {
    if (!existsSync(join(root, dir))) return;
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (!["node_modules", "foundations", "styles", "icons"].includes(e.name)) walk(rel); continue; }
      if (/\.(tsx?|css|mdx)$/.test(e.name) && /\btext-body\b|--body-font\b|--body-font-/.test(readFileSync(join(root, rel), "utf8"))) references.push(rel);
    }
  };
  walk("src");

  return {
    title: "Fonts for headings, text and buttons",
    rationale: `Adds font roles (headings, text, buttons and labels, code) and text styles, and gives every component part a text token, so headings, text and buttons can each have their own font.${kept.length ? ` Kept as they are because they were edited: ${kept.join(", ")}; their text sizes stay until you or Claude move them onto text tokens.` : ""}${references.length ? ` These files used the old body style by name and need updating: ${references.join(", ")}.` : ""}`,
    ops,
    kept,
    references,
  };
}

/**
 * What newer Plinth templates bring to the components a design system already has: component tokens it lacks
 * (text, corners that fit inside…), the base switch for fitting corners, and component files replaced while
 * exactly as Plinth shipped them. Tokens it has are never changed; edited files are kept.
 * @returns {{ ops, kept: string[], updated: string[] }}
 */
export function componentRefresh(root, templateDir) {
  const readJson = (dir, rel) => (existsSync(join(dir, rel)) ? JSON.parse(readFileSync(join(dir, rel), "utf8")) : {});
  const leaves = (node, path = [], type) => Object.entries(node).filter(([k]) => !k.startsWith("$")).flatMap(([k, v]) => {
    if (!v || typeof v !== "object") return [];
    const t = v.$type ?? node.$type ?? type;
    return "$value" in v ? [[[...path, k].join("/"), v, t]] : leaves(v, [...path, k], t);
  });
  const has = (tree, path) => { let n = tree; for (const s of path.split("/")) { n = n?.[s]; if (!n) return false; } return "$value" in n; };
  const ops = [], updated = [];
  const tplComponents = join(templateDir, "tokens", "components");
  for (const f of existsSync(tplComponents) ? readdirSync(tplComponents) : []) {
    const rel = `tokens/components/${f}`;
    if (!existsSync(join(root, rel))) continue;
    const mine = readJson(root, rel);
    for (const [path, t, type] of leaves(readJson(templateDir, rel))) {
      if (has(mine, path)) continue;
      const fit = t.$extensions?.plinth?.fit;
      ops.push({ op: "set", file: rel, path, ...(type ? { type } : {}), value: t.$value, ...(t.$description ? { description: t.$description } : {}), ...(fit ? { fit } : {}) });
    }
  }
  const base = readJson(root, "tokens/base.tokens.json"), tplBase = readJson(templateDir, "tokens/base.tokens.json");
  const fitSwitch = tplBase.radius?.["fit-inside"];
  if (fitSwitch && base.radius && !base.radius["fit-inside"]) ops.push({ op: "set", file: "tokens/base.tokens.json", path: "radius/fit-inside", type: "number", value: fitSwitch.$value, description: fitSwitch.$description });
  const kept = [];
  for (const [rel, hashes] of Object.entries(SHIPPED)) {
    if (!existsSync(join(root, rel)) || !existsSync(join(templateDir, rel))) continue;
    const now = readFileSync(join(root, rel), "utf8"), want = readFileSync(join(templateDir, rel), "utf8");
    if (lfHash(now) === lfHash(want)) continue;
    if (hashes.includes(lfHash(now))) { ops.push({ op: "write", file: rel, content: want }); updated.push(rel); }
    else kept.push(rel);
  }
  return { ops, kept, updated };
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
