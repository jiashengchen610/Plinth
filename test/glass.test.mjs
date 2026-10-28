// Glass: a recipe on the glass color (opacity, blur, saturation, edge light, ripple) becomes the material-glass
// utility with a solid fallback, its text is checked over the darkest and the lightest backdrop, the tool's ops and
// live readout, and the Glass component bringing the material to a design system that lacks it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as ws from "../engine/workspace.mjs";
import { glassOps, readGlass } from "../engine/style.mjs";
import { checkContrast, glassContrast, glassMinOpacity } from "../engine/checks.mjs";
import { buildCss, resolveBrand } from "../engine/tokens.mjs";

test("glass: the recipe becomes a utility with a solid fallback; its text is checked over black and white", (t) => {
  const root = mkdtempSync(join(tmpdir(), "plinth-glass-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "G", brand: "g" });
  const r = resolveBrand(root, "g");
  const part = (k) => r.tokens.find((x) => x.key === `material/glass/${k}`);
  assert.equal(part("tint").values.default.css, "color-mix(in oklab, var(--material-glass) 70%, transparent)");
  assert.equal(part("blur").values.default.css, "16px");
  const { css } = buildCss(root);
  const utility = css.slice(css.indexOf("@utility material-glass {"), css.indexOf("}\n}", css.indexOf("@utility material-glass {")) + 3);
  assert.match(utility, /backdrop-filter: blur\(var\(--material-glass-blur\)\) saturate\(var\(--material-glass-saturation\)\)/);
  assert.match(utility, /@media \(prefers-reduced-transparency: reduce\) \{\n    background-color: var\(--material-glass\);/, "solid when less transparency is asked for");
  const rows = checkContrast(root).filter((c) => c.glass);
  assert.deepEqual(rows.map((c) => `${c.mode} ${c.bg}`).sort(), ["dark material-glass over black", "dark material-glass over white", "default material-glass over black", "default material-glass over white"]);
  assert.ok(rows.every((c) => c.pass), "the template's glass reads everywhere");

  // The tool: a tint role and a lower opacity; text follows the tint; the readout and the lowest readable opacity.
  assert.deepEqual(readGlass(root).tint, "popover");
  const low = glassContrast(root, "g", { tint: "popover", foreground: "popover-foreground", tintOpacity: 0.2 });
  assert.ok(low.some((c) => !c.pass));
  const min = glassMinOpacity(root, "g", { tint: "popover", foreground: "popover-foreground" });
  assert.ok(min > 0.2 && min < 0.7, `lowest readable opacity ${min}`);
  assert.ok(glassContrast(root, "g", { tint: "popover", foreground: "popover-foreground", tintOpacity: min }).every((c) => c.pass));
  ws.change(root, { title: "glass", ops: glassOps(root, "g", { tint: "primary", tintOpacity: 2, blur: 30, distortion: 0.5 }), by: "test" });
  const g = readGlass(root);
  assert.deepEqual([g.tint, g.foreground, g.recipe.tintOpacity, g.recipe.blur, g.recipe.distortion], ["primary", "primary-foreground", 1, 30, 0.5], "opacity kept in range");
  assert.deepEqual(glassOps(root, "g", { tint: "primary", blur: 30 }), [], "nothing to change");
  assert.throws(() => glassOps(root, "g", { tint: "nope" }), /no color role/);
});

test("glass: adding the Glass component brings the glass material to a design system without it", (t) => {
  const root = mkdtempSync(join(tmpdir(), "plinth-glass-add-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "G", brand: "g", skipComponents: ["glass"] });
  const basePath = join(root, "tokens/base.tokens.json");
  const base = JSON.parse(readFileSync(basePath, "utf8"));
  delete base.material;
  writeFileSync(basePath, JSON.stringify(base, null, 2));
  ws.regenerate(root);
  assert.equal(readGlass(root), null);
  ws.change(root, { title: "Add Glass", ops: ws.catalogComponentOps(root, "glass"), by: "test" });
  assert.equal(readGlass(root).tint, "popover");
  assert.deepEqual(resolveBrand(root, "g").issues, []);
  assert.match(readFileSync(join(root, "src/styles/tokens.css"), "utf8"), /@utility material-glass \{/);
});
