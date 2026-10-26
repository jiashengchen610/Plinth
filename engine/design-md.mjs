// Compose one complete DESIGN.md per brand (Google DESIGN.md spec, alpha) from:
//   - the brand's resolved tokens (YAML front matter: colors, typography, rounded, spacing),
//   - the shared root DESIGN.md prose,
//   - the brand's brands/<id>/DESIGN.md prose (brand sections replace shared ones; Do's and Don'ts merge).
// Authors never write the YAML by hand; it is generated so tokens.json stays the single source of truth.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveBrand } from "./tokens.mjs";
import { parseColor, formatHex } from "./color.mjs";

const SECTION_ORDER = ["Overview", "Colors", "Typography", "Layout", "Elevation & Depth", "Shapes", "Components", "Do's and Don'ts"];
const ALIASES = { "brand & style": "Overview", "layout & spacing": "Layout", elevation: "Elevation & Depth", "dos and don'ts": "Do's and Don'ts", "do's and don'ts": "Do's and Don'ts" };

/** Split markdown into { preamble, sections: Map(title → body) } on "## " headings; strips YAML front matter. */
export function parseSections(md) {
  const text = (md ?? "").replace(/^---\n[\s\S]*?\n---\n?/, "");
  const sections = new Map();
  let current = null, buf = [], preamble = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (current) sections.set(current, buf.join("\n").trim());
      const raw = m[1].trim();
      current = ALIASES[raw.toLowerCase()] ?? raw;
      buf = [];
    } else if (current) buf.push(line);
    else preamble.push(line);
  }
  if (current) sections.set(current, buf.join("\n").trim());
  return { preamble: preamble.join("\n").trim(), sections };
}

// Plain scalars only for safe words; anything with "#" (a YAML comment), ":" or a leading digit is quoted.
const yamlString = (s) => (/^[A-Za-z][\w. ()-]*$/.test(String(s)) ? String(s) : JSON.stringify(String(s)));

function frontMatter(brandName, description, resolved) {
  const lines = ["---", 'version: "alpha"', `name: ${yamlString(brandName)}`];
  if (description) lines.push(`description: ${yamlString(description)}`);
  const val = (t) => t.values.default?.resolved;
  const colors = resolved.tokens.filter((t) => t.type === "color" && val(t));
  if (colors.length) {
    lines.push("colors:");
    for (const t of colors) {
      const rgb = parseColor(val(t));
      // The spec recommends hex; keep the original when it cannot be represented (e.g. translucent).
      lines.push(`  ${t.name}: ${yamlString(rgb && (rgb.alpha ?? 1) === 1 ? formatHex(rgb) : val(t))}`);
    }
  }
  const typo = resolved.tokens.filter((t) => t.type === "typography" && !t.derived);
  if (typo.length) {
    lines.push("typography:");
    for (const t of typo) {
      const v = t.values.default.raw;
      const name = t.name.replace(/-font$/, "");
      lines.push(`  ${name}:`);
      if (v.fontFamily) lines.push(`    fontFamily: ${yamlString(Array.isArray(v.fontFamily) ? v.fontFamily[0] : v.fontFamily)}`);
      if (v.fontSize) lines.push(`    fontSize: ${typeof v.fontSize === "object" ? `${v.fontSize.value}${v.fontSize.unit}` : v.fontSize}`);
      if (v.fontWeight) lines.push(`    fontWeight: ${v.fontWeight}`);
      if (v.lineHeight) lines.push(`    lineHeight: ${typeof v.lineHeight === "object" ? `${v.lineHeight.value}${v.lineHeight.unit}` : v.lineHeight}`);
      if (v.letterSpacing) lines.push(`    letterSpacing: ${typeof v.letterSpacing === "object" ? `${v.letterSpacing.value}${v.letterSpacing.unit}` : v.letterSpacing}`);
    }
  }
  const dims = (re) => resolved.tokens.filter((t) => t.type === "dimension" && re.test(t.name) && /(px|rem|em)$/.test(String(val(t))));
  const rounded = dims(/radius/);
  if (rounded.length) {
    lines.push("rounded:");
    for (const t of rounded) lines.push(`  ${t.name.replace(/^radius-?/, "").replace(/-radius$/, "") || "md"}: ${val(t)}`);
  }
  const spacing = dims(/^spac(e|ing)-/);
  if (spacing.length) {
    lines.push("spacing:");
    for (const t of spacing) lines.push(`  ${t.name.replace(/^spac(e|ing)-/, "")}: ${val(t)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

/** Merge "Do …"/"Don't …" list items from shared and brand prose, de-duplicated, shared first. */
function mergeDos(shared = "", brand = "") {
  const items = (s) => s.split(/\r?\n/).filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, "- ").trim());
  const intro = (s) => s.split(/\r?\n/).filter((l) => l.trim() && !/^\s*[-*]\s+/.test(l)).join("\n");
  const seen = new Set();
  const out = [...items(shared), ...items(brand)].filter((l) => !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()));
  return [intro(brand) || intro(shared), out.join("\n")].filter(Boolean).join("\n\n");
}

/** Build the complete DESIGN.md text for one brand. */
export function composeDesignMd(root, brand, config = loadConfig(root)) {
  const resolved = resolveBrand(root, brand, config);
  const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : "");
  const shared = parseSections(read("DESIGN.md"));
  const own = parseSections(read(`brands/${brand}/DESIGN.md`));
  const meta = (config.brands ?? []).find((b) => (b.id ?? b) === brand) ?? {};
  const title = meta.name ?? brand;

  const titles = [...new Set([...SECTION_ORDER, ...shared.sections.keys(), ...own.sections.keys()])];
  const body = [];
  for (const t of titles) {
    let text;
    if (t === "Do's and Don'ts") text = mergeDos(shared.sections.get(t), own.sections.get(t));
    else text = own.sections.get(t) ?? shared.sections.get(t);
    if (text) body.push(`## ${t}\n\n${text}`);
  }
  const description = meta.description ?? (own.preamble || shared.preamble || "").split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#")) ?? "";
  return `${frontMatter(title, description, resolved)}\n\n# ${title}\n\n${body.join("\n\n")}\n`;
}

/** Light structural lint mirroring the spec: duplicate sections, missing primary color, section order. */
export function lintDesignMd(text) {
  const issues = [];
  const heads = [...text.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  const dup = heads.filter((h, i) => heads.indexOf(h) !== i);
  if (dup.length) issues.push(`duplicate sections: ${[...new Set(dup)].join(", ")}`);
  if (!/^colors:\n(?:\s{2}.+\n)*?\s{2}primary:/m.test(text)) issues.push("colors.primary is missing");
  const order = heads.filter((h) => SECTION_ORDER.includes(h)).map((h) => SECTION_ORDER.indexOf(h));
  if (order.some((v, i) => i > 0 && v < order[i - 1])) issues.push("sections are out of the spec order");
  for (const s of SECTION_ORDER) if (!heads.includes(s)) issues.push(`missing section: ${s}`);
  return issues;
}
