// Gradients: a gradient token's stops are color roles and its angle an extension; the engine emits the variable and
// the bg-gradient-<name> utility, checks its text against every stop, and the tool's ops change or create one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as ws from "../engine/workspace.mjs";
import { defaultGradient, gradientOps, readGradients } from "../engine/style.mjs";
import { checkContrast, gradientContrast } from "../engine/checks.mjs";
import { buildCss, resolveBrand } from "../engine/tokens.mjs";
import { scan } from "../engine/check-hardcoded.mjs";

test("gradients: roles in, a utility out, text checked at every stop, ops to change or create one", (t) => {
  const root = mkdtempSync(join(tmpdir(), "plinth-gradient-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "G", brand: "g" });
  const r = resolveBrand(root, "g");
  const brand = r.tokens.find((x) => x.key === "gradient/brand");
  assert.equal(brand.values.default.css, "linear-gradient(135deg, var(--primary) 0%, var(--chart-2) 100%)");
  assert.match(brand.values.dark.resolved, /^linear-gradient\(135deg, oklch\(.+\) 0%, oklch\(.+\) 100%\)$/, "resolved per mode for previews");
  assert.deepEqual(brand.gradient, { angle: 135 });
  assert.deepEqual(r.issues, []);
  const { css } = buildCss(root);
  assert.match(css, /@utility bg-gradient-brand \{\n  background-image: var\(--gradient-brand\);\n\}/);
  assert.match(css, /--color-gradient-brand-foreground: var\(--gradient-brand-foreground\);/, "text on it is an ordinary color utility");
  const rows = checkContrast(root).filter((c) => c.gradient);
  assert.deepEqual(rows.map((c) => `${c.mode} ${c.bg}`).sort(), ["dark gradient-brand at 0%", "dark gradient-brand at 100%", "dark gradient-surface at 0%", "dark gradient-surface at 100%", "default gradient-brand at 0%", "default gradient-brand at 100%", "default gradient-surface at 0%", "default gradient-surface at 100%"]);
  assert.ok(rows.every((c) => c.pass), "the template's gradients read everywhere");
  // Using one in a screen is not a hardcoded value.
  mkdirSync(join(root, "src", "app"), { recursive: true });
  writeFileSync(join(root, "src", "app", "Hero.tsx"), 'export const Hero = () => <div className="bg-gradient-brand text-gradient-brand-foreground p-6" />;\n');
  assert.deepEqual(scan(["src/app"], root), []);

  // Changing one: stops sorted by position, the angle, the text kept; nothing to change gives no ops.
  assert.deepEqual(readGradients(root).map((g) => g.name), ["brand", "surface"]);
  ws.change(root, { title: "gradient", ops: gradientOps(root, "g", { name: "brand", stops: [{ color: "chart-3", position: 1 }, { color: "primary", position: 0 }, { color: "destructive", position: 0.5 }], angle: 90 }), by: "test" });
  const b = readGradients(root).find((g) => g.name === "brand");
  assert.deepEqual(b.stops, [{ color: "primary", position: 0 }, { color: "destructive", position: 0.5 }, { color: "chart-3", position: 1 }]);
  assert.equal(b.angle, 90);
  assert.equal(b.foreground, "primary-foreground");
  assert.equal(resolveBrand(root, "g").tokens.find((x) => x.key === "gradient/brand").values.default.css, "linear-gradient(90deg, var(--primary) 0%, var(--destructive) 50%, var(--chart-3) 100%)");
  assert.deepEqual(gradientOps(root, "g", { name: "brand", stops: b.stops, angle: 90 }), [], "nothing to change");
  // Creating one: a typed name becomes its key, positions spread evenly, the angle wraps, text falls back to foreground.
  ws.change(root, { title: "hero", ops: gradientOps(root, "g", { name: "Hero band", stops: [{ color: "background" }, { color: "muted" }], angle: 400 }), by: "test" });
  const hero = readGradients(root).find((g) => g.name === "hero-band");
  assert.deepEqual([hero.stops.map((s) => s.position), hero.angle, hero.foreground], [[0, 1], 40, "foreground"]);
  assert.match(readFileSync(join(root, "src/styles/tokens.css"), "utf8"), /@utility bg-gradient-hero-band \{/);
  assert.throws(() => gradientOps(root, "g", { name: "x", stops: [{ color: "nope" }, { color: "primary" }] }), /no color role nope/);
  assert.throws(() => gradientOps(root, "g", { name: "x", stops: [{ color: "primary" }] }), /2 to 5/);
  // The tool's live readout: light text reads on the main color, not on the page color.
  const live = gradientContrast(root, "g", { stops: [{ color: "primary", position: 0 }, { color: "background", position: 1 }], foreground: "primary-foreground" });
  assert.equal(live.length, 4);
  assert.ok(live.find((c) => c.mode === "default" && c.percent === 0).pass);
  assert.ok(!live.find((c) => c.mode === "default" && c.percent === 100).pass);
  assert.deepEqual(defaultGradient(root, "g"), { name: "brand", stops: [{ color: "primary", position: 0 }, { color: "chart-2", position: 1 }], angle: 135 });
});

test("gradients: a design system from before them gets one when the tool saves", (t) => {
  const root = mkdtempSync(join(tmpdir(), "plinth-gradient-old-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "G", brand: "g" });
  const basePath = join(root, "tokens/base.tokens.json");
  const base = JSON.parse(readFileSync(basePath, "utf8"));
  delete base.gradient;
  writeFileSync(basePath, JSON.stringify(base, null, 2));
  ws.regenerate(root);
  assert.deepEqual(readGradients(root), []);
  assert.ok(!readFileSync(join(root, "src/styles/tokens.css"), "utf8").includes("bg-gradient-"));
  ws.change(root, { title: "gradient", ops: gradientOps(root, "g", defaultGradient(root, "g")), by: "test" });
  assert.equal(readGradients(root)[0].foreground, "primary-foreground");
  assert.deepEqual(resolveBrand(root, "g").issues, []);
  assert.match(readFileSync(join(root, "src/styles/tokens.css"), "utf8"), /@utility bg-gradient-brand \{/);
});
