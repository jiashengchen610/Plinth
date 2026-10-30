// The resolved token export (exports/tokens/<brand>.<mode>.json): every token with its references followed and its
// value in plain terms, one file per brand and mode, plus an index; written by publish and by `plinth export`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initWorkspace } from "../engine/workspace.mjs";
import { tokenExports, writeTokenExports, dimension, colorValue, EXPORT_DIR } from "../engine/export.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

test("token export: every brand and mode, values in plain terms, references followed", (t) => {
  const root = mkdtempSync(join(tmpdir(), "plinth-export-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initWorkspace(root, { name: "Export", brand: "acme" });
  const files = tokenExports(root);
  assert.deepEqual(Object.keys(files).sort(), ["acme.dark.json", "acme.light.json", "index.json"]);
  assert.deepEqual(files["index.json"].brands, { acme: { modes: { light: "acme.light.json", dark: "acme.dark.json" } } });
  assert.equal(files["acme.light.json"].mode, "light");
  assert.equal(files["acme.light.json"].name, "Export");
  const light = files["acme.light.json"].tokens, dark = files["acme.dark.json"].tokens;

  // Colors: hex with alpha and oklch, the reference named, modes apart, a translucent role keeps its alpha.
  assert.match(light["color.primary"].value.value, /^#[0-9a-f]{6}$/);
  assert.equal(light["color.primary"].ref, "color.neutral.900");
  assert.equal(light["color.primary"].cssVar, "--primary");
  assert.equal(light["color.background"].value.value, "#ffffff");
  assert.notEqual(dark["color.background"].value.value, "#ffffff");
  assert.equal(light["alert-dialog.overlay"].value.alpha, 0.5);
  // Lengths in px; a part inside a container gets the container's corners minus the gap.
  assert.deepEqual(light["radius.container"].value, { value: 12, unit: "px" });
  assert.deepEqual(light.spacing.value, { value: 4, unit: "px" });
  assert.ok(light["tabs.trigger.radius"].value.value < light["radius.control"].value.value);
  // Text styles structured, letter spacing kept in em; motion in ms and bezier numbers.
  assert.deepEqual(light["typography.display"].value, { fontFamily: ["Geist", "sans-serif"], fontSize: { value: 32, unit: "px" }, fontWeight: 600, lineHeight: 1.15, letterSpacing: { value: -0.02, unit: "em" } });
  assert.deepEqual(light["duration.fast"].value, { value: 120, unit: "ms" });
  assert.deepEqual(light["ease.standard"].value, [0.2, 0, 0, 1]);
  assert.deepEqual(light["motion.fast"].value, { duration: { value: 150, unit: "ms" }, easing: [0.2, 0, 0, 1] });
  // Shadows, gradients and glass.
  const shadow = light["shadow.overlay"].value;
  assert.equal(shadow.length, 2);
  assert.deepEqual(shadow[0].y, { value: 10, unit: "px" });
  assert.equal(shadow[0].color.alpha, 0.1);
  assert.notDeepEqual(dark["shadow.overlay"].value, shadow, "shadows differ by mode");
  assert.equal(light["gradient.brand"].value.angle, 135);
  assert.equal(light["gradient.brand"].value.stops.length, 2);
  assert.match(light["gradient.brand"].value.stops[1].color.value, /^#[0-9a-f]{6}$/);
  assert.equal(light["material.glass"].glass.blur, 16);
  // No derived parts, nothing unparsed, the same every time.
  assert.equal(light["typography.display.font-size"], undefined);
  assert.equal(Object.values(light).filter((x) => x.value === null || x.value === undefined).length, 0);
  assert.deepEqual(tokenExports(root), files);
  // Written under exports/tokens.
  const written = writeTokenExports(root);
  assert.ok(written.includes(`${EXPORT_DIR}/acme.light.json`));
  assert.ok(existsSync(join(root, EXPORT_DIR, "index.json")));
  assert.deepEqual(JSON.parse(readFileSync(join(root, EXPORT_DIR, "acme.dark.json"), "utf8")).tokens["color.background"], dark["color.background"]);
});

test("dimension and colorValue", () => {
  assert.deepEqual(dimension("0.75rem"), { value: 12, unit: "px" });
  assert.deepEqual(dimension({ value: 2, unit: "rem" }), { value: 32, unit: "px" });
  assert.deepEqual(dimension("-0.02em"), { value: -0.02, unit: "em" });
  assert.deepEqual(dimension("0.3s", "ms"), { value: 300, unit: "ms" });
  assert.deepEqual(dimension(0), { value: 0, unit: "px" });
  assert.equal(dimension("auto"), null);
  assert.deepEqual(colorValue("rgb(0 0 0 / 0.1)"), { value: "#000000", alpha: 0.1, oklch: "oklch(0 0 0)" });
  assert.equal(colorValue("oklch(1 0 0)", 0.7).alpha, 0.7);
  assert.deepEqual(colorValue("currentColor"), { value: "currentColor" });
});

test("plinth export from the command line", (t) => {
  const root = mkdtempSync(join(tmpdir(), "plinth-export-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  initWorkspace(root, { name: "Cli", brand: "acme" });
  const out = JSON.parse(execFileSync(process.execPath, [join(repo, "server", "cli.mjs"), "export", root, "--json"], { encoding: "utf8" }));
  assert.equal(out.files.length, 3);
  assert.equal(out.index.name, "Cli");
  const workflow = readFileSync(join(root, ".github", "workflows", "storybook.yml"), "utf8");
  assert.match(workflow, /Plinth#v\d+\.\d+\.\d+ export/, "the workflow rewrites the exports");
});
