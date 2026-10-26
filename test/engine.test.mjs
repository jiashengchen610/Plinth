// Unit tests for the deterministic engine. Run: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseColor, contrastRatio, fixContrast, rgbToOklch, oklchToRgb, formatHex } from "../engine/color.mjs";
import { buildCss, resolveBrand, cssName } from "../engine/tokens.mjs";
import { contrastPairs, checkContrast, contrastFixes } from "../engine/checks.mjs";
import { composeDesignMd, lintDesignMd, parseSections } from "../engine/design-md.mjs";

test("color: parse, round-trip, contrast", () => {
  assert.deepEqual(parseColor("#fff"), { r: 1, g: 1, b: 1, alpha: 1 });
  assert.equal(formatHex(oklchToRgb(rgbToOklch(parseColor("#e2725b")))), "#e2725b");
  assert.equal(Number(contrastRatio("#000", "#fff").toFixed(2)), 21);
  assert.equal(Number(contrastRatio("#777", "#fff").toFixed(2)), 4.48);
  const white = parseColor("oklch(1 0 0)");
  assert.ok(Math.abs(white.r - 1) < 1e-3 && Math.abs(white.b - 1) < 1e-3);
  // translucent foreground is composited over the background
  assert.ok(contrastRatio("oklch(0 0 0 / 50%)", "#fff") < 21);
});

test("color: fixContrast keeps hue and reaches the target", () => {
  const before = contrastRatio("oklch(0.7 0.12 45)", "#ffffff");
  assert.ok(before < 4.5);
  const fix = fixContrast("oklch(0.7 0.12 45)", "#ffffff", 4.5);
  assert.ok(fix.changed && fix.ratio >= 4.5, JSON.stringify(fix));
  assert.match(fix.value, /^oklch\(0\.\d+ [\d.]+ 45\)$/);
  // dark background: moves lighter
  const dark = fixContrast("oklch(0.4 0 0)", "oklch(0.15 0 0)", 4.5);
  assert.ok(dark.to.l > dark.from.l && dark.ratio >= 4.5);
  // already passing: untouched
  assert.equal(fixContrast("#000", "#fff").changed, false);
});

function workspace(files) {
  const root = mkdtempSync(join(tmpdir(), "plinth-engine-"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}
const brandTokens = (primary, primaryDark, fg = "oklch(0.98 0 0)") => ({
  color: {
    $type: "color",
    background: { $value: "oklch(1 0 0)", $extensions: { "ds-skills": { modes: { dark: "oklch(0.15 0 0)" } } } },
    foreground: { $value: "oklch(0.15 0 0)", $extensions: { "ds-skills": { modes: { dark: "oklch(0.98 0 0)" } } } },
    primary: { $value: primary, $extensions: { "ds-skills": { modes: { dark: primaryDark } } } },
    "primary-foreground": { $value: fg },
    ring: { $value: "{color.primary}" },
  },
});

test("tokens: multi-brand CSS with modes, aliases and @theme", (t) => {
  const root = workspace({
    "design-system.json": { naming: "shadcn", defaultBrand: "acme", brands: [{ id: "acme" }, { id: "kids" }], tokens: { rename: { "radius/base": "radius" } } },
    "tokens/base.tokens.json": { radius: { base: { $type: "dimension", $value: { value: 0.5, unit: "rem" } } }, shadow: { card: { $type: "shadow", $value: { color: "{color.foreground}", offsetX: 0, offsetY: 1, blur: 2, spread: 0 } } } },
    "brands/acme/tokens.json": brandTokens("oklch(0.3 0.1 250)", "oklch(0.8 0.1 250)"),
    "brands/kids/tokens.json": brandTokens("oklch(0.35 0.2 300)", "oklch(0.8 0.15 300)"),
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { css, issues } = buildCss(root);
  assert.deepEqual(issues, []);
  assert.match(css, /:root,\n\[data-brand="acme"\] \{/);
  assert.match(css, /\.dark,\n\[data-brand="acme"\]\.dark \{/);
  assert.match(css, /\[data-brand="kids"\] \{[^}]*--primary: oklch\(0\.35 0\.2 300\);/);
  assert.match(css, /\[data-brand="kids"\]\.dark \{[^}]*--primary: oklch\(0\.8 0\.15 300\);/);
  // a token with no dark value repeats its default in the dark block (no leak from another brand)
  assert.match(css, /\[data-brand="kids"\]\.dark \{[^}]*--primary-foreground: oklch\(0\.98 0 0\);/);
  assert.match(css, /--ring: var\(--primary\);/);
  assert.match(css, /--card-shadow: 0 1px 2px 0 var\(--foreground\);/);
  assert.match(css, /--radius: 0\.5rem;/);
  assert.match(css, /--color-primary: var\(--primary\);/);
  assert.match(css, /--shadow-card: var\(--card-shadow\);/);
  const r = resolveBrand(root, "kids");
  assert.equal(r.tokens.find((x) => x.name === "ring").values.default.resolved, "oklch(0.35 0.2 300)");
});

test("tokens: brands with different token names are reported", (t) => {
  const kids = brandTokens("oklch(0.35 0.2 300)", "oklch(0.8 0.15 300)");
  delete kids.color.ring;
  const root = workspace({
    "design-system.json": { brands: [{ id: "a" }, { id: "b" }] },
    "brands/a/tokens.json": brandTokens("oklch(0.3 0.1 250)", "oklch(0.8 0.1 250)"),
    "brands/b/tokens.json": kids,
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.ok(buildCss(root).issues.some((i) => /brand "b" is missing 1 token/.test(i)));
});

test("tokens: naming", () => {
  assert.equal(cssName({ key: "color/primary-foreground", path: ["color", "primary-foreground"], type: "color" }), "primary-foreground");
  assert.equal(cssName({ key: "shadow/card", path: ["shadow", "card"], type: "shadow" }), "card-shadow");
  assert.equal(cssName({ key: "typography/display", path: ["typography", "display"], type: "typography" }), "display-font");
  assert.equal(cssName({ key: "typography/display/font-size", path: ["typography", "display", "font-size"], type: "dimension", derived: true }), "display-font-size");
});

test("checks: pairs from naming conventions and deterministic fixes", (t) => {
  assert.deepEqual(contrastPairs(["surface", "on-surface", "primary", "on-primary"]).map((p) => `${p.bg}/${p.fg}`), ["surface/on-surface", "primary/on-primary"]);
  const root = workspace({
    "design-system.json": { brands: [{ id: "acme" }] },
    "brands/acme/tokens.json": brandTokens("oklch(0.75 0.12 60)", "oklch(0.8 0.1 60)"),
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const results = checkContrast(root);
  const failing = results.filter((r) => !r.pass);
  assert.ok(failing.some((r) => r.fg === "primary-foreground"));
  const { ops } = contrastFixes(results);
  assert.ok(ops.length >= 1 && ops.every((o) => o.file === "brands/acme/tokens.json"));
});

test("design-md: compose merges shared and brand prose, generates YAML, lints", (t) => {
  const root = workspace({
    "design-system.json": { brands: [{ id: "acme", name: "Acme Money" }], tokens: { rename: { "radius/base": "radius" } } },
    "tokens/base.tokens.json": { radius: { base: { $type: "dimension", $value: { value: 0.5, unit: "rem" } } } },
    "brands/acme/tokens.json": brandTokens("oklch(0.3 0.1 250)", "oklch(0.8 0.1 250)"),
    "DESIGN.md": "# Shared\n\n## Layout\n\nGrid of 4.\n\n## Do's and Don'ts\n\n- Do use tokens.\n- Don't number sections.\n",
    "brands/acme/DESIGN.md": "# Acme\n\nCalm money app.\n\n## Overview\n\nCalm.\n\n## Do's and Don'ts\n\n- Do keep one primary action.\n- Do use tokens.\n",
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const md = composeDesignMd(root, "acme");
  assert.match(md, /^---\nversion: "alpha"\nname: Acme Money\ndescription: Calm money app\.\ncolors:\n/);
  assert.match(md, /\n {2}primary: "#[0-9a-f]{6}"\n/);
  assert.match(md, /rounded:\n {2}md: 0\.5rem/);
  assert.ok(md.indexOf("## Overview") < md.indexOf("## Layout"));
  assert.equal((md.match(/- Do use tokens\./g) ?? []).length, 1, "duplicate do's are merged");
  const lint = lintDesignMd(md);
  assert.ok(lint.includes("missing section: Colors"));
  assert.ok(!lint.some((l) => /primary is missing|duplicate|order/.test(l)), lint.join("; "));
  assert.equal(parseSections("## Brand & Style\n\nx").sections.has("Overview"), true);
});
