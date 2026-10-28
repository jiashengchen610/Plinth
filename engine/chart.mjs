// Chart colors from the palette, per brand and mode: categorical (up to 8 series), sequential (7 steps of one hue,
// low to high) and diverging (7 steps: two hues through a neutral). Categorical series follow the main color: they
// start from it and stay among hues near it (within 30°, widened 15° at a time only when nothing near it stays apart),
// using lighter and darker steps; inside that range each next one is the color furthest from those picked, for normal
// vision and for protan, deutan and tritan color vision deficiencies (simulated), at a step that reads 3:1 on the
// background. The colors are written as roles (brands/<brand>/tokens.json → color.chart.*) pointing at palette steps,
// so they stay editable.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio, CVD_TYPES, deltaE, parseColor, rgbToOklch, simulateCvd } from "./color.mjs";
import { resolveBrand } from "./tokens.mjs";
import { GRAYS, readStyle } from "./style.mjs";

const PRIMITIVES = "tokens/primitives.tokens.json";
export const CHART_SERIES = 8;
// Steps tried for a series, in order (the first is series 1's): light mode on a light page, dark mode on a dark one.
const SERIES_STEPS = { default: ["600", "500", "700", "800", "900", "400"], dark: ["400", "300", "500", "200", "600", "100"] };
// 0.10 picked the most distant families at fewer steps; kept only to recognize chart colors it made.
const SPREAD_STEPS = { default: ["600", "500", "700", "800"], dark: ["400", "300", "500", "200"] };
/** Hues tried around the main one, in degrees: this far at first, then wider by the step while nothing stays apart. */
export const CHART_HUE_RANGE = { start: 30, step: 15 };
const SEQUENTIAL = { default: ["200", "300", "400", "500", "600", "700", "800"], dark: ["800", "700", "600", "500", "400", "300", "200"] };
// Diverging: the opposite hue's three steps, the neutral, then the main hue's three (light mode); dark mode mirrors
// the lightness so both ends stay strong on a dark page.
const DIVERGING = { default: [["opp", "700"], ["opp", "500"], ["opp", "300"], ["gray", "200"], ["main", "300"], ["main", "500"], ["main", "700"]], dark: [["opp", "300"], ["opp", "500"], ["opp", "700"], ["gray", "800"], ["main", "700"], ["main", "500"], ["main", "300"]] };
/** Below these OKLab distances two series look alike (normal vision, and simulated color vision deficiencies). */
export const CHART_DISTINCT = { normal: 0.08, cvd: 0.04 };

const readJson = (root, rel) => (existsSync(join(root, rel)) ? JSON.parse(readFileSync(join(root, rel), "utf8")) : {});

/** Palette families with their resolved steps: { teal: { "500": "oklch(…)", … } }, grays and white/black left out. */
function hueFamilies(root) {
  const color = readJson(root, PRIMITIVES).color ?? {};
  const out = {};
  for (const [name, node] of Object.entries(color)) {
    if (name.startsWith("$") || GRAYS.includes(name) || !node || typeof node !== "object" || "$value" in node) continue;
    const steps = Object.fromEntries(Object.entries(node).filter(([k, v]) => !k.startsWith("$") && v?.$value).map(([k, v]) => [k, typeof v.$value === "string" ? v.$value : null]).filter(([, v]) => v));
    if (steps["500"]) out[name] = steps;
  }
  return out;
}
const hueOf = (value) => { const c = parseColor(value); return c ? rgbToOklch(c).h : 0; };

/** How far apart two colors are, for the reader who sees them closest: normal vision and each deficiency. */
function separation(a, b) {
  let min = { value: deltaE(a, b) ?? 0, vision: "normal" };
  for (const type of CVD_TYPES) {
    const d = deltaE(simulateCvd(a, type), simulateCvd(b, type)) ?? 0;
    // A deficiency counts against its own (lower) threshold: scale it onto the normal one to compare.
    const scaled = d * (CHART_DISTINCT.normal / CHART_DISTINCT.cvd);
    if (scaled < min.value) min = { value: scaled, vision: type };
  }
  return min;
}
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/**
 * Series that follow the main color: every family at every usable step pair (light, dark) is a candidate; only hues
 * within the range around the main one count, and the range widens only when none of them stays apart from the
 * series picked. Inside it, the candidate furthest from those picked (in both modes) comes next.
 */
function toneSeries(fams, usable, main, modes) {
  const cache = new Map();
  const apart = (a, b) => { const k = a < b ? `${a}|${b}` : `${b}|${a}`; if (!cache.has(k)) cache.set(k, separation(a, b).value); return cache.get(k); };
  const h0 = hueOf(fams[main]["500"]);
  const chosen = [{ f: main, default: usable[main].default[0], dark: usable[main].dark[0] }];
  const same = (a, b) => a.f === b.f && a.default === b.default && a.dark === b.dark;
  const candidates = Object.keys(fams).flatMap((f) => usable[f].default.flatMap((d) => usable[f].dark.map((k) => ({ f, default: d, dark: k, gap: hueGap(h0, hueOf(fams[f]["500"])) }))));
  let range = CHART_HUE_RANGE.start;
  while (chosen.length < CHART_SERIES) {
    let best = null;
    for (const c of candidates) {
      if (c.gap > range || chosen.some((x) => same(x, c))) continue;
      const score = Math.min(...modes.map((m) => Math.min(...chosen.map((x) => apart(fams[c.f][c[m]], fams[x.f][x[m]])))));
      if (!best || score > best.score) best = { ...c, score };
    }
    if (best && (best.score >= CHART_DISTINCT.normal || range >= 180)) chosen.push(best);
    else if (range >= 180) break;
    else range += CHART_HUE_RANGE.step;
  }
  return chosen;
}

/** 0.10's series: after the main color, each next one is the family furthest from those picked. */
function spreadSeries(fams, usable, main, modes) {
  const names = Object.keys(fams);
  const chosen = [{ f: main, default: usable[main].default[0], dark: usable[main].dark[0] }];
  while (chosen.length < Math.min(CHART_SERIES, names.length)) {
    let best = null;
    for (const f of names.filter((n) => !chosen.some((c) => c.f === n))) {
      // Per mode, the step that keeps this family furthest from the series already picked.
      const per = modes.map((m) => {
        let top = null;
        for (const s of usable[f][m]) {
          const d = Math.min(...chosen.map((c) => separation(fams[f][s], fams[c.f][c[m]]).value));
          if (!top || d > top.d + 1e-9) top = { s, d };
        }
        return top;
      });
      const score = Math.min(...per.map((p) => p.d));
      if (!best || score > best.score) best = { f, score, default: per[0].s, dark: per[1].s };
    }
    chosen.push(best);
  }
  return chosen;
}

/**
 * The chart colors for a brand: { categorical: [{ family, default, dark }], sequential: [...], diverging: [...] },
 * each entry a palette reference per mode ("{color.teal.600}"). method "spread" is 0.10's way, for recognizing it.
 */
export function chartPalette(root, brand, override = {}, method = "tone") {
  const fams = hueFamilies(root);
  const names = Object.keys(fams);
  if (!names.length) throw new Error("no palette colors to make chart colors from");
  const style = { ...readStyle(root, brand), ...Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined)) };
  const roles = resolveBrand(root, brand).tokens;
  const background = (mode) => { const t = roles.find((x) => x.key === "color/background"); return (t?.values[mode] ?? t?.values.default)?.resolved ?? (mode === "dark" ? "#000000" : "#ffffff"); };
  const modes = ["default", "dark"];
  // Steps a family may use as a series per mode: those that read 3:1 on the page (else the one closest to it). The
  // first is the preferred one; others give lightness to tell series apart when hue alone does not.
  const stepsFor = method === "spread" ? SPREAD_STEPS : SERIES_STEPS;
  const usable = {};
  for (const f of names) {
    usable[f] = {};
    for (const m of modes) {
      const steps = stepsFor[m].filter((s) => fams[f][s]);
      const reads = steps.filter((s) => (contrastRatio(fams[f][s], background(m)) ?? 0) >= 3);
      usable[f][m] = reads.length ? reads : [steps.sort((a, b) => (contrastRatio(fams[f][b], background(m)) ?? 0) - (contrastRatio(fams[f][a], background(m)) ?? 0))[0]];
    }
  }
  const main = names.includes(style.main) ? style.main : names.includes("blue") ? "blue" : names[0];
  const chosen = (method === "spread" ? spreadSeries : toneSeries)(fams, usable, main, modes);
  const ref = (f, s) => `{color.${f}.${s}}`;
  // The opposite hue for diverging: the family whose hue is closest to the main one turned half way round.
  const target = (hueOf(fams[main]["500"]) + 180) % 360;
  const opposite = names.filter((n) => n !== main).sort((a, b) => Math.abs(((hueOf(fams[a]["500"]) - target + 540) % 360) - 180) - Math.abs(((hueOf(fams[b]["500"]) - target + 540) % 360) - 180))[0] ?? main;
  const gray = GRAYS.includes(style.gray) ? style.gray : "neutral";
  const seq = (i) => Object.fromEntries(modes.map((m) => [m, ref(main, SEQUENTIAL[m][i])]));
  const div = (i) => Object.fromEntries(modes.map((m) => { const [k, s] = DIVERGING[m][i]; return [m, ref(k === "main" ? main : k === "opp" ? opposite : gray, s)]; }));
  return {
    categorical: chosen.map((c) => ({ family: c.f, default: ref(c.f, c.default), dark: ref(c.f, c.dark) })),
    sequential: SEQUENTIAL.default.map((_, i) => seq(i)),
    diverging: DIVERGING.default.map((_, i) => div(i)),
    main, opposite,
  };
}

/** Role paths of the chart colors: color/chart/1…8, color/chart/seq/1…7, color/chart/div/1…7. */
export const chartPaths = (p) => [
  ...p.categorical.map((c, i) => [`color/chart/${i + 1}`, c]),
  ...p.sequential.map((c, i) => [`color/chart/seq/${i + 1}`, c]),
  ...p.diverging.map((c, i) => [`color/chart/div/${i + 1}`, c]),
];

/** Ops that write the chart colors into the brand file (only what changes). */
export function chartOps(root, brand, override = {}, method = "tone") {
  const file = `brands/${brand}/tokens.json`;
  const tree = readJson(root, file);
  const at = (path) => path.split("/").reduce((n, k) => n?.[k], tree);
  const ops = [];
  for (const [path, c] of chartPaths(chartPalette(root, brand, override, method))) {
    const cur = at(path);
    const curDark = cur?.$extensions?.plinth?.modes?.dark;
    if (cur?.$value !== c.default) ops.push({ op: "set", file, path, type: "color", value: c.default, ...(cur ? {} : { description: CHART_DESCRIPTIONS[path.split("/")[2] === "seq" ? "seq" : path.split("/")[2] === "div" ? "div" : "series"] }) });
    if ((curDark ?? cur?.$value) !== c.dark || (curDark === undefined && c.dark !== c.default)) ops.push({ op: "set", file, path, mode: "dark", value: c.dark });
  }
  return ops;
}
/**
 * Who made the brand's chart colors: "plinth" (what Plinth makes now from the current main color), "older" (what
 * 0.10 made, the most distant families), "hand" (picked by someone), or null when there are none.
 */
export function chartMaker(root, brand) {
  if (!readJson(root, `brands/${brand}/tokens.json`).color?.chart) return null;
  if (!chartOps(root, brand).length) return "plinth";
  return chartOps(root, brand, {}, "spread").length ? "hand" : "older";
}
/**
 * Chart colors that follow a new main color or grays: only while they are still what Plinth made from the current
 * ones, now or in 0.10 (someone who picked their own chart colors keeps them). [] when there are none yet.
 */
export function chartFollowOps(root, brand, { main, gray } = {}) {
  if (main === undefined && gray === undefined) return [];
  const maker = chartMaker(root, brand);
  if (maker !== "plinth" && maker !== "older") return [];
  return chartOps(root, brand, { main, gray });
}

/**
 * What the Style step shows: each set's colors per mode as resolved, also as seen with each color vision deficiency,
 * how many series stay apart for everyone, and what does not. null when the brand has no chart colors yet.
 */
export function chartView(root, brand) {
  const r = resolveBrand(root, brand);
  const pick = (re) => r.tokens.filter((t) => re.test(t.key)).sort((a, b) => Number(a.path.at(-1)) - Number(b.path.at(-1)));
  const series = pick(/^color\/chart\/\d+$/);
  if (!series.length) return null;
  const view = (t) => Object.fromEntries(r.modes.map((m) => {
    const v = (t.values[m] ?? t.values.default)?.resolved;
    return [m, { color: v, ...Object.fromEntries(CVD_TYPES.map((type) => [type, simulateCvd(v, type)])) }];
  }));
  const checks = checkChart(root, [brand]);
  const failing = checks.filter((c) => !c.pass);
  let safe = 1;
  for (let n = 2; n <= series.length; n++) {
    const inside = (name) => Number(name.split("-").at(-1)) <= n;
    if (failing.some((c) => inside(c.a) && (c.b === undefined || inside(c.b)))) break;
    safe = n;
  }
  return {
    series: series.map((t) => ({ name: t.name, path: t.key, ...view(t) })),
    sequential: pick(/^color\/chart\/seq\/\d+$/).map((t) => ({ name: t.name, ...view(t) })),
    diverging: pick(/^color\/chart\/div\/\d+$/).map((t) => ({ name: t.name, ...view(t) })),
    safe, failing, madeBy: chartMaker(root, brand),
  };
}

const CHART_DESCRIPTIONS = {
  series: "Chart series color (categories): distinct from the others, also for color vision deficiencies, and 3:1 on the page",
  seq: "Chart sequential step (low to high values) in one hue",
  div: "Chart diverging step: one hue below the middle, a neutral at it, another hue above",
};

/**
 * Checks for the chart series colors, per brand and mode: each reads 3:1 on the page, and each pair stays apart for
 * normal vision and for simulated color vision deficiencies. Reminders, never deploy stops.
 */
export function checkChart(root, brands) {
  const out = [];
  for (const brand of brands) {
    const r = resolveBrand(root, brand);
    const series = r.tokens.filter((t) => /^color\/chart\/\d+$/.test(t.key)).sort((a, b) => Number(a.path.at(-1)) - Number(b.path.at(-1)));
    if (!series.length) continue;
    const bg = r.tokens.find((t) => t.key === "color/background");
    for (const mode of r.modes) {
      const v = (t) => (t.values[mode] ?? t.values.default)?.resolved;
      for (const s of series) {
        const ratio = contrastRatio(v(s), bg ? v(bg) : "#ffffff");
        out.push({ brand, mode, kind: "contrast", a: s.name, ratio: ratio === null ? null : Number(ratio.toFixed(2)), pass: (ratio ?? 0) >= 3 });
      }
      for (let i = 0; i < series.length; i++) for (let j = i + 1; j < series.length; j++) {
        const s = separation(v(series[i]), v(series[j]));
        out.push({ brand, mode, kind: "distinct", a: series[i].name, b: series[j].name, vision: s.vision, deltaE: Number((s.vision === "normal" ? s.value : s.value * (CHART_DISTINCT.cvd / CHART_DISTINCT.normal)).toFixed(3)), pass: s.value >= CHART_DISTINCT.normal });
      }
    }
  }
  return out;
}
