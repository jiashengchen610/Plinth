// Chart colors: made from the palette (categories near the main color's hue, kept apart for normal vision and
// simulated color vision deficiencies, 3:1 on the page; low to high; around a middle), following the main color while
// untouched (also colors 0.10 made), and the
// Chart component bringing its colors and Recharts to a design system without them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as ws from "../engine/workspace.mjs";
import { CHART_HUE_RANGE, chartFollowOps, chartMaker, chartOps, chartPalette, chartView, checkChart } from "../engine/chart.mjs";
import { simulateCvd, deltaE, parseColor, rgbToOklch } from "../engine/color.mjs";
import { styleOps } from "../engine/style.mjs";

test("chart colors: eight series apart for everyone, 3:1 on the page; they follow the main color until edited", (t) => {
  const root = mkdtempSync(join(tmpdir(), "plinth-chart-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "C", brand: "c" });
  assert.deepEqual(chartOps(root, "c"), [], "the template ships the colors Plinth makes");
  assert.deepEqual(checkChart(root, ["c"]).filter((x) => !x.pass), []);
  assert.equal(chartView(root, "c").safe, 8);

  // A new main color: the chart follows it, and starts from it.
  const main = styleOps(root, "c", { main: "teal" });
  const follow = chartFollowOps(root, "c", { main: "teal" });
  assert.ok(follow.length > 0);
  ws.change(root, { title: "teal", ops: [...main, ...follow], by: "test" });
  assert.equal(chartPalette(root, "c").categorical[0].family, "teal");
  assert.match(JSON.parse(readFileSync(join(root, "brands/c/tokens.json"), "utf8")).color.chart["1"].$value, /^\{color\.teal\.\d+\}$/);
  assert.deepEqual(checkChart(root, ["c"]).filter((x) => !x.pass), [], "still apart and readable");
  // They keep to the main color's hues: the first three within the first range around teal.
  const palette = JSON.parse(readFileSync(join(root, "tokens/primitives.tokens.json"), "utf8")).color;
  const hue = (f) => rgbToOklch(parseColor(palette[f]["500"].$value)).h;
  const gap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  for (const s of chartPalette(root, "c").categorical.slice(0, 3)) assert.ok(gap(hue(s.family), hue("teal")) <= CHART_HUE_RANGE.start, `${s.family} is near teal`);
  const div = chartPalette(root, "c").diverging;
  assert.equal(div.length, 7);
  assert.match(div[3].default, /^\{color\.neutral\.200\}$/, "the middle is a neutral");
  assert.equal(chartView(root, "c").madeBy, "plinth");

  // Colors 0.10 made (the most distant families) are recognized, and follow the main color into the new way.
  ws.change(root, { title: "older", ops: chartOps(root, "c", {}, "spread"), by: "test" });
  assert.equal(chartMaker(root, "c"), "older");
  const again = chartFollowOps(root, "c", { main: "violet" });
  assert.ok(again.length > 0);
  ws.change(root, { title: "violet", ops: [...styleOps(root, "c", { main: "violet" }), ...again], by: "test" });
  assert.equal(chartMaker(root, "c"), "plinth");

  // A series picked by hand stays when the main color changes again.
  ws.change(root, { title: "mine", ops: [{ op: "set", file: "brands/c/tokens.json", path: "color/chart/2", value: "{color.lime.700}" }], by: "test" });
  assert.deepEqual(chartFollowOps(root, "c", { main: "rose" }), []);
  assert.equal(chartView(root, "c").madeBy, "hand");
});

test("color vision: simulated colors keep grays and move reds and greens together for deutan vision", () => {
  assert.equal(simulateCvd("#808080", "deutan"), "#808080");
  const red = simulateCvd("#e53935", "deutan"), green = simulateCvd("#43a047", "deutan");
  assert.ok(deltaE(red, green) < deltaE("#e53935", "#43a047") / 2, "red and green move closer for deutan vision");
  assert.equal(simulateCvd("nope", "deutan"), null);
});

test("chart component: adding it brings chart colors and Recharts to a design system without them", (t) => {
  const root = mkdtempSync(join(tmpdir(), "plinth-chart-add-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "C", brand: "c", skipComponents: ["chart"] });
  const brandFile = join(root, "brands/c/tokens.json");
  const brand = JSON.parse(readFileSync(brandFile, "utf8"));
  delete brand.color.chart;
  writeFileSync(brandFile, JSON.stringify(brand, null, 2));
  const pkgFile = join(root, "package.json");
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
  delete pkg.dependencies.recharts;
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
  ws.regenerate(root);
  assert.equal(chartView(root, "c"), null);

  assert.deepEqual(ws.missingPackages(root, "chart"), { recharts: JSON.parse(readFileSync(join(ws.TEMPLATE_DIR, "package.json"), "utf8")).dependencies.recharts });
  assert.deepEqual(ws.missingPackages(root, "tabs"), {}, "nothing for a component without packages");
  ws.change(root, { title: "Add Chart", ops: ws.catalogComponentOps(root, "chart"), by: "test" });
  assert.equal(chartView(root, "c").series.length, 8);
  assert.ok(ws.addPackages(root, ws.missingPackages(root, "chart")));
  assert.ok(JSON.parse(readFileSync(pkgFile, "utf8")).dependencies.recharts);
  assert.deepEqual(ws.missingPackages(root, "chart"), {});
});
