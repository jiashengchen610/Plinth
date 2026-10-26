#!/usr/bin/env node
/**
 * visual-diff.mjs — compare a rendered Storybook story against a Figma screenshot.
 *
 *   node scripts/visual-diff.mjs --story <storyId> --figma <figma.png> [--storybook http://localhost:6006]
 *        [--out .design-system/.cache/visual/<storyId>] [--threshold 0.05] [--pixel-threshold 0.1]
 *        [--selector "#storybook-root > *"] [--dark] [--globals key:value,...] [--json]
 *
 * Runs in the TARGET project (needs its node_modules): uses `playwright` (installed by Storybook's test
 * feature) plus `pixelmatch` and `pngjs` (`npm i -D pixelmatch pngjs`). Scales the browser so the story's
 * rendered width matches the Figma PNG width (Figma exports are often 2x), screenshots only the story
 * element, and compares the overlapping area.
 *
 * Writes into --out:  story.png  figma.png  diff.png  side-by-side.png  result.json
 * The PNGs are meant to be looked at (by the ds-reviewer agent or a human), not just scored.
 *
 * Exit codes: 0 within threshold; 1 above threshold; 2 size mismatch beyond 10% (layout problem);
 *             3 Storybook unreachable / story not found; 64 usage; 66 missing dependency.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const one = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const flag = (n) => args.includes(n);
const cwd = process.cwd();

const storyId = one("--story");
const figmaPath = one("--figma");
if (!storyId || !figmaPath) {
  process.stderr.write("usage: visual-diff.mjs --story <storyId> --figma <png> [--storybook <url>] [--out <dir>] [--threshold 0.05]\n");
  process.exit(64);
}
const cfg = existsSync(resolve(cwd, ".design-system/config.json")) ? JSON.parse(readFileSync(resolve(cwd, ".design-system/config.json"), "utf8")) : {};
const storybook = one("--storybook", cfg.storybook?.url ?? "http://localhost:6006").replace(/\/$/, "");
const outDir = resolve(cwd, one("--out", `.design-system/.cache/visual/${storyId}`));
const threshold = Number(one("--threshold", cfg.verify?.visualDiffThreshold ?? 0.05));
const pixelThreshold = Number(one("--pixel-threshold", 0.1));
const selector = one("--selector", "#storybook-root > *");
const dark = flag("--dark");
const globals = one("--globals", dark ? "theme:dark" : "");
const asJson = flag("--json");

// Resolve deps from the target project.
const req = createRequire(join(cwd, "package.json"));
let chromium, PNG, pixelmatch;
try {
  ({ chromium } = req("playwright"));
} catch {
  process.stderr.write("visual-diff: `playwright` not found in this project. Storybook's test feature installs it; otherwise `npm i -D playwright && npx playwright install chromium`.\n");
  process.exit(66);
}
try {
  ({ PNG } = req("pngjs"));
  pixelmatch = req("pixelmatch");
  pixelmatch = pixelmatch.default ?? pixelmatch;
} catch {
  process.stderr.write("visual-diff: `pixelmatch` and `pngjs` are required: npm i -D pixelmatch pngjs\n");
  process.exit(66);
}

if (!existsSync(resolve(cwd, figmaPath))) {
  process.stderr.write(`visual-diff: Figma screenshot not found: ${figmaPath}\n`);
  process.exit(64);
}
const figmaPng = PNG.sync.read(readFileSync(resolve(cwd, figmaPath)));
mkdirSync(outDir, { recursive: true });

const url = `${storybook}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story${globals ? `&globals=${encodeURIComponent(globals)}` : ""}`;

const browser = await chromium.launch();
try {
  // Pass 1: measure the story element at scale 1 to pick a device scale factor matching the Figma width.
  let context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  let page = await context.newPage();
  const res = await page.goto(url, { waitUntil: "networkidle" }).catch(() => null);
  if (!res || !res.ok()) {
    process.stderr.write(`visual-diff: cannot load ${url} (HTTP ${res?.status() ?? "n/a"}). Is Storybook running?\n`);
    process.exitCode = 3;
    throw new Error("storybook unreachable");
  }
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  const el = await page.waitForSelector(selector, { timeout: 15000 }).catch(() => null);
  if (!el) {
    process.stderr.write(`visual-diff: selector ${selector} not found for story ${storyId}. Check the id with docs-list withStoryIds.\n`);
    process.exitCode = 3;
    throw new Error("story element not found");
  }
  const box = await el.boundingBox();
  const dsf = Math.max(1, Math.min(4, figmaPng.width / Math.max(1, box.width)));
  const dsfRounded = Math.round(dsf * 100) / 100;
  await context.close();

  // Pass 2: screenshot at the matched scale.
  context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: dsfRounded });
  page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  const el2 = await page.waitForSelector(selector, { timeout: 15000 });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(150);
  const storyBuf = await el2.screenshot({ type: "png", animations: "disabled" });
  writeFileSync(join(outDir, "story.png"), storyBuf);
  writeFileSync(join(outDir, "figma.png"), readFileSync(resolve(cwd, figmaPath)));
  await context.close();

  const storyPng = PNG.sync.read(storyBuf);
  const w = Math.min(storyPng.width, figmaPng.width);
  const h = Math.min(storyPng.height, figmaPng.height);
  const crop = (png) => {
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(png, out, 0, 0, w, h, 0, 0);
    return out;
  };
  const a = crop(storyPng);
  const b = crop(figmaPng);
  const diff = new PNG({ width: w, height: h });
  const mismatched = pixelmatch(a.data, b.data, diff.data, w, h, { threshold: pixelThreshold, includeAA: false });
  const ratio = mismatched / (w * h);
  writeFileSync(join(outDir, "diff.png"), PNG.sync.write(diff));

  // Side-by-side: story | figma | diff, padded to the tallest.
  const gap = 16;
  const H = Math.max(storyPng.height, figmaPng.height, h);
  const sbs = new PNG({ width: storyPng.width + figmaPng.width + w + gap * 2, height: H, fill: true });
  sbs.data.fill(255);
  PNG.bitblt(storyPng, sbs, 0, 0, storyPng.width, storyPng.height, 0, 0);
  PNG.bitblt(figmaPng, sbs, 0, 0, figmaPng.width, figmaPng.height, storyPng.width + gap, 0);
  PNG.bitblt(diff, sbs, 0, 0, w, h, storyPng.width + figmaPng.width + gap * 2, 0);
  writeFileSync(join(outDir, "side-by-side.png"), PNG.sync.write(sbs));

  const sizeDelta = {
    width: (storyPng.width - figmaPng.width) / figmaPng.width,
    height: (storyPng.height - figmaPng.height) / figmaPng.height,
  };
  const sizeMismatch = Math.abs(sizeDelta.width) > 0.1 || Math.abs(sizeDelta.height) > 0.1;
  const result = {
    storyId, url, figma: figmaPath, deviceScaleFactor: dsfRounded,
    story: { width: storyPng.width, height: storyPng.height },
    figmaSize: { width: figmaPng.width, height: figmaPng.height },
    compared: { width: w, height: h },
    mismatchedPixels: mismatched, mismatchRatio: Number(ratio.toFixed(4)), threshold,
    sizeDelta: { width: Number(sizeDelta.width.toFixed(3)), height: Number(sizeDelta.height.toFixed(3)) },
    pass: ratio <= threshold && !sizeMismatch,
    files: { story: join(outDir, "story.png"), figma: join(outDir, "figma.png"), diff: join(outDir, "diff.png"), sideBySide: join(outDir, "side-by-side.png") },
  };
  writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n");

  if (asJson) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  else {
    process.stdout.write([
      `visual-diff: ${storyId} vs ${figmaPath}`,
      `  story ${storyPng.width}x${storyPng.height} @${dsfRounded}x  figma ${figmaPng.width}x${figmaPng.height}  compared ${w}x${h}`,
      `  mismatch ${(ratio * 100).toFixed(2)}% (threshold ${(threshold * 100).toFixed(1)}%)  size delta w ${(sizeDelta.width * 100).toFixed(1)}% h ${(sizeDelta.height * 100).toFixed(1)}%`,
      `  ${result.pass ? "PASS" : sizeMismatch ? "SIZE MISMATCH — layout differs; inspect side-by-side.png" : "FAIL — inspect diff.png"}`,
      `  ${join(outDir, "side-by-side.png")}`,
    ].join("\n") + "\n");
  }
  process.exitCode = result.pass ? 0 : sizeMismatch ? 2 : 1;
} catch (e) {
  if (!process.exitCode) {
    process.stderr.write(`visual-diff: ${e.message}\n`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
