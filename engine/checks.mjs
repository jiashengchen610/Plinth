// Quality checks over a workspace: color contrast for every brand × mode, role colors that cannot be told
// apart, token consistency across brands, and hardcoded values in component code. Also turns contrast
// failures into token fixes. Exceptions the user accepted (design-system.json → exceptions) are reported
// but do not block the gate.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio, fixContrast, deltaE, hueDifference, tint, parseColor, rgbToOklch } from "./color.mjs";
import { loadConfig, listBrands, resolveBrand, buildCss } from "./tokens.mjs";
import { scan } from "./check-hardcoded.mjs";

/**
 * Foreground/background pairs that must meet contrast. Derived from naming conventions:
 *   shadcn   X / X-foreground            (background / foreground is the page pair)
 *   material X / on-X
 *   component tokens  …-background / …-foreground   (button-default-background, card-foreground …)
 *   explicit design-system.json → contrastPairs: [["bg-name","fg-name", minRatio?]]
 */
export function contrastPairs(colorNames, config = {}) {
  const set = new Set(colorNames);
  const pairs = [];
  const add = (bg, fg, min = 4.5) => {
    if (set.has(bg) && set.has(fg) && !pairs.some((p) => p.bg === bg && p.fg === fg)) pairs.push({ bg, fg, min });
  };
  add("background", "foreground");
  for (const n of colorNames) {
    if (set.has(`${n}-foreground`)) add(n, `${n}-foreground`);
    if (set.has(`on-${n}`)) add(n, `on-${n}`);
    if (n.endsWith("-background")) add(n, n.replace(/-background$/, "-foreground"));
  }
  if (set.has("muted-foreground")) add("background", "muted-foreground");
  // The focus ring is not text, but people must see it: 3:1 against the page (WCAG 1.4.11).
  if (set.has("ring")) add("background", "ring", 3);
  if (set.has("on-surface-variant") && set.has("surface")) add("surface", "on-surface-variant");
  for (const [bg, fg, min] of config.contrastPairs ?? []) add(bg, fg, min ?? 4.5);
  return pairs;
}

/**
 * Text drawn on a translucent tint of its own color, as components write it: `bg-destructive/10 text-destructive`
 * (shadcn's destructive Badge and Button), with `dark:bg-X/NN` for the dark mode. The token pairs above do not
 * cover these, and the browser's accessibility test does, so they are read from the component sources.
 * @returns {Array<{ fg: string, light: number, dark: number, files: string[] }>} alphas 0..1
 */
export function tintedPairs(root) {
  const dir = join(root, "src", "components");
  if (!existsSync(dir)) return [];
  const found = new Map();
  for (const comp of readdirSync(dir)) {
    const folder = join(dir, comp);
    if (!statSync(folder).isDirectory()) continue;
    for (const file of readdirSync(folder).filter((f) => f.endsWith(".tsx") && !f.endsWith(".stories.tsx"))) {
      const src = readFileSync(join(folder, file), "utf8");
      // Every string literal is one class list.
      for (const [, cls] of src.matchAll(/["'`]([^"'`\n]*\bbg-[a-z0-9-]+\/\d+[^"'`\n]*)["'`]/g)) {
        const words = cls.split(/\s+/);
        for (const w of words) {
          const m = w.match(/^bg-([a-z0-9-]+)\/(\d+)$/);
          if (!m || !words.includes(`text-${m[1]}`)) continue;
          const dark = words.map((x) => x.match(new RegExp(`^dark:bg-${m[1]}\\/(\\d+)$`))).find(Boolean);
          const key = `${m[1]}|${m[2]}|${dark?.[1] ?? m[2]}`;
          const entry = found.get(key) ?? { fg: m[1], light: Number(m[2]) / 100, dark: Number(dark?.[1] ?? m[2]) / 100, files: [] };
          const rel = `src/components/${comp}/${file}`;
          if (!entry.files.includes(rel)) entry.files.push(rel);
          found.set(key, entry);
        }
      }
    }
  }
  return [...found.values()];
}

const aliasKey = (v) => (typeof v === "string" && /^\{[^}]+\}$/.test(v.trim()) ? v.trim().slice(1, -1).replace(/\./g, "/") : null);

/**
 * Where a color's value really lives, following aliases: the token to edit to change it, and when that token points
 * at the palette, the palette colors a fix may move to. Fixes never edit the palette itself: they re-point the token
 * that refers to it, along the same hue (or, for white and black, between white, black and the neutral greys).
 */
function editPoint(byKey, start, mode) {
  let cur = start, prev = null;
  for (let i = 0; i < 20; i++) {
    const raw = cur.values[mode]?.raw ?? cur.values.default?.raw;
    const next = aliasKey(raw) && byKey.get(aliasKey(raw));
    if (!next) break;
    prev = cur;
    cur = next;
  }
  if (cur.layerId === "primitives" && cur.path[0] === "color") {
    if (!prev) return { token: cur, raw: null, palette: [], end: cur.key, frozen: true };
    const isPalette = (t) => t.layerId === "primitives" && t.path[0] === "color" && t.values.default?.resolved;
    const ref = (t) => `{${t.path.join(".")}}`;
    const hue = cur.path.length === 3 ? cur.path[1] : null;
    const candidates = [...byKey.values()].filter((t) => isPalette(t) && (hue
      ? t.path.length === 3 && t.path[1] === hue
      : (t.path.length === 2 && ["white", "black"].includes(t.path[1])) || (t.path.length === 3 && t.path[1] === "neutral")));
    return { token: prev, raw: prev.values[mode]?.raw ?? prev.values.default?.raw, palette: candidates.map((t) => ({ ref: ref(t), value: t.values.default.resolved })), end: cur.key };
  }
  return { token: cur, raw: cur.values[mode]?.raw ?? cur.values.default?.raw, palette: null, end: cur.key };
}

/** Contrast results for every brand and mode. */
export function checkContrast(root, config = loadConfig(root)) {
  const results = [];
  const tinted = tintedPairs(root);
  for (const brand of listBrands(root, config)) {
    const r = resolveBrand(root, brand, config);
    const byKey = new Map(r.tokens.map((t) => [t.key, t]));
    const colors = r.tokens.filter((t) => t.type === "color");
    const byName = new Map(colors.map((t) => [t.name, t]));
    const valueIn = (name, mode) => byName.get(name).values[mode] ?? byName.get(name).values.default;
    const page = (mode) => (byName.has("background") ? valueIn("background", mode)?.resolved : "#ffffff");
    // A translucent surface is seen over the page.
    const opaque = (v, mode) => { const c = parseColor(v); return c && (c.alpha ?? 1) < 1 ? tint(v, 1, page(mode)) : v; };
    const row = (p, mode, bgValue, extra = {}) => {
      const fg = valueIn(p.fg, mode);
      const ratio = contrastRatio(fg?.resolved, bgValue);
      const edit = editPoint(byKey, byName.get(p.fg), mode);
      return {
        brand, mode, bg: p.bg, fg: p.fg, min: p.min,
        ratio: ratio === null ? null : Number(ratio.toFixed(2)),
        pass: ratio !== null && ratio >= p.min,
        // The token to edit, in its file: this mode's own value when it has one, else the default it inherits.
        fgToken: edit.token.key, fgSource: edit.token.source, fgRaw: edit.raw, palette: edit.palette, bgValue,
        ...extra,
      };
    };
    for (const p of contrastPairs(colors.map((t) => t.name), config)) {
      for (const mode of r.modes) {
        const bg = valueIn(p.bg, mode);
        const extra = {};
        // A tint of the text's own color (component token "destructive at 10%"): the background moves with any fix.
        if ((bg?.alpha ?? 1) < 1 && editPoint(byKey, byName.get(p.bg), mode).end === editPoint(byKey, byName.get(p.fg), mode).end) {
          extra.selfTint = { alpha: bg.alpha, base: page(mode) };
        }
        results.push(row(p, mode, opaque(bg?.resolved, mode), extra));
      }
    }
    for (const t of tinted) {
      if (!byName.has(t.fg) || !byName.has("background")) continue;
      for (const mode of r.modes) {
        const alpha = mode === "dark" ? t.dark : t.light;
        const base = page(mode);
        const bgValue = tint(valueIn(t.fg, mode)?.resolved, alpha, base);
        results.push(row({ fg: t.fg, bg: `${t.fg}/${Math.round(alpha * 100)}`, min: 4.5 }, mode, bgValue, { selfTint: { alpha, base }, files: t.files }));
      }
    }
  }
  return results;
}

/**
 * Role colors that carry meaning on their own (an action, an error, a success) usually need to be told apart.
 * Neutral surfaces (muted, secondary, accent, card …) are allowed to coincide, as they do in shadcn.
 *   shadcn   primary, destructive, success, warning, info (+ design-system.json → distinctRoles)
 *   material primary, secondary, tertiary, error
 * Two roles are flagged when they are closer than distinctMin (ΔE_OK, default 0.08: about four just-noticeable
 * differences, clearly apart side by side) or share a hue (< 20°, e.g. two reds at different lightness).
 * This is advisory: it is shown, never blocks the gate. Sharing a color on purpose is a valid design decision;
 * marking the pair as intended (an exception) hides the notice.
 */
const ROLE_NAMES = ["primary", "destructive", "success", "warning", "info", "error", "tertiary"];
export function checkDistinct(root, config = loadConfig(root)) {
  const minDelta = config.distinctMin ?? 0.08;
  const minHue = config.distinctHue ?? 20;
  const results = [];
  for (const brand of listBrands(root, config)) {
    const r = resolveBrand(root, brand, config);
    const names = new Set([...ROLE_NAMES, ...(config.distinctRoles ?? [])]);
    if (config.naming === "material") names.add("secondary");
    const roles = r.tokens.filter((t) => t.type === "color" && names.has(t.name));
    for (let i = 0; i < roles.length; i++) {
      for (let j = i + 1; j < roles.length; j++) {
        for (const mode of r.modes) {
          const a = (roles[i].values[mode] ?? roles[i].values.default)?.resolved;
          const b = (roles[j].values[mode] ?? roles[j].values.default)?.resolved;
          const dE = deltaE(a, b);
          const dH = hueDifference(a, b);
          if (dE === null) continue;
          const sameHue = dH !== null && dH < minHue;
          results.push({
            brand, mode, a: roles[i].name, b: roles[j].name,
            deltaE: Number(dE.toFixed(3)), hueDiff: dH === null ? null : Math.round(dH),
            pass: dE >= minDelta && !sameHue,
            reason: dE < minDelta ? "too similar" : sameHue ? "same hue" : null,
          });
        }
      }
    }
  }
  return results;
}

/**
 * Turn failing contrast results into token edits. A color linked to the palette moves to the nearest shade of the
 * same hue that passes (the token that points at the palette is re-pointed; the palette itself never changes). A
 * literal color moves its OKLCH lightness, keeping the hue.
 */
export function contrastFixes(results) {
  const ops = [], skipped = [];
  // A foreground usually sits on several backgrounds (muted-foreground on muted AND on background).
  // Fix each foreground once per brand × mode against ALL of its backgrounds, including pairs that pass now,
  // so one fix never undoes another or breaks a passing pair.
  const groups = new Map();
  for (const r of results) {
    const k = `${r.brand}|${r.mode}|${r.fgSource}|${r.fgToken}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const pairs of groups.values()) {
    const failing = pairs.filter((p) => !p.pass && !p.accepted);
    if (!failing.length) continue;
    const r = failing[0];
    // A tint of the text's own color moves with it; every other background is fixed.
    const bgOf = (p, v) => (p.selfTint ? tint(v, p.selfTint.alpha, p.selfTint.base) : p.bgValue);
    const passesAll = (v) => pairs.every((p) => (contrastRatio(v, bgOf(p, v)) ?? 0) >= p.min);
    const why = (v) => `${r.fg} (${r.brand}, ${r.mode === "default" ? "light" : r.mode}): ${failing.map((f) => `on ${f.bg} ${f.ratio} → ${contrastRatio(v, bgOf(f, v)).toFixed(2)}`).join(", ")}`;
    const op = (value, resolved) => ({ op: "set", file: r.fgSource, path: r.fgToken, mode: r.mode, value, why: why(resolved) });

    if (r.palette) {
      // Nearest shade (by lightness) of the same hue that works on every background.
      const current = r.palette.find((s) => s.ref === r.fgRaw);
      const lightOf = (v) => rgbToOklch(parseColor(v) ?? { r: 0, g: 0, b: 0 }).l;
      const from = current ? lightOf(current.value) : 0.5;
      const pick = r.palette.filter((s) => s.ref !== r.fgRaw && passesAll(s.value)).sort((a, b) => Math.abs(lightOf(a.value) - from) - Math.abs(lightOf(b.value) - from))[0];
      if (pick) ops.push(op(pick.ref, pick.value));
      else skipped.push(...failing.map((f) => ({ ...f, reason: "no shade of this hue works on every background it is used on; pick another color" })));
      continue;
    }
    if (typeof r.fgRaw !== "string" || /^\{.+\}$/.test(r.fgRaw)) { skipped.push(...failing.map((f) => ({ ...f, reason: "this color is not a plain value; change the token it points to" }))); continue; }
    let value = r.fgRaw;
    for (let round = 0; round < 8; round++) {
      let changed = false;
      for (const p of pairs) {
        const ratio = contrastRatio(value, bgOf(p, value));
        if (ratio !== null && ratio >= p.min) continue;
        // Aim a little higher on a self-tint: the background follows the text and gives some contrast back.
        const fix = fixContrast(value, bgOf(p, value), p.selfTint ? p.min + 0.15 : p.min);
        if (!fix) { value = null; break; }
        value = fix.value;
        changed = true;
      }
      if (!value || !changed) break;
    }
    if (!value || !passesAll(value)) { skipped.push(...failing.map((f) => ({ ...f, reason: "no lightness satisfies every background this color is used on; change a background or the hue" }))); continue; }
    ops.push(op(value, value));
  }
  return { ops, skipped };
}

// ---------------- exceptions ----------------
/**
 * Stable key of a check result, used to match accepted exceptions. A segment of an exception's key may be "*":
 * "*|*|muted|muted-foreground" accepts that pair in every brand and mode (a decorative text role, for instance).
 */
export const exceptionKey = {
  contrast: (r) => `${r.brand}|${r.mode}|${r.bg}|${r.fg}`,
  distinct: (r) => `${r.brand}|${r.mode}|${r.a}|${r.b}`,
  hardcoded: (f) => `${f.file}|${f.rule}|${f.match}`,
  structure: (r) => `${r.brand}|${r.kind}|${r.token}`,
};
const keyMatches = (pattern, key) => {
  const p = pattern.split("|"), k = key.split("|");
  return p.length === k.length && p.every((seg, i) => seg === "*" || seg === k[i]);
};
/** The exception that accepts a result, or undefined. */
export function acceptedBy(exceptions, check, result) {
  const key = exceptionKey[check](result);
  return exceptions.find((e) => e.check === check && keyMatches(e.key, key));
}
function markAccepted(list, check, exceptions) {
  return list.map((r) => { const e = acceptedBy(exceptions, check, r); return e ? { ...r, accepted: true, exceptionReason: e.reason } : r; });
}

/**
 * How the layers are used, per brand: a token pointing at a token in a higher layer (a primitive referring to a
 * semantic color, say), and a color above the palette that is a literal value instead of a palette color.
 * @returns {Array<{ brand, token, layer, kind: "upward" | "unlinked", detail }>}
 */
export function checkStructure(root, config = loadConfig(root)) {
  if (!Array.isArray(config.layers)) return [];
  const results = [];
  const hasPalette = config.layers.some((l) => l.id === "primitives");
  for (const brand of listBrands(root, config)) {
    const r = resolveBrand(root, brand, config);
    const byKey = new Map(r.tokens.map((t) => [t.key, t]));
    for (const t of r.tokens) {
      if (t.derived) continue;
      for (const ref of t.refs ?? []) {
        const target = byKey.get(ref);
        if (target && target.layer > t.layer) {
          results.push({ brand, token: t.key, layer: t.layerId, kind: "upward", pass: false, detail: `${t.key} (${t.layerId}) points at ${ref} (${target.layerId}), a layer above it` });
        }
      }
      if (hasPalette && t.type === "color" && t.layerId !== "primitives" && !t.linked) {
        results.push({ brand, token: t.key, layer: t.layerId, kind: "unlinked", pass: false, detail: `${t.key} is a fixed value, not a palette color` });
      }
    }
  }
  return results;
}

/**
 * Run every check. Design findings (contrast, look-alike roles, hardcoded values, layer structure) are reminders:
 * they are reported and never stop publishing. Only token problems that break the generated CSS (an alias to
 * nothing, a cycle, a brand missing tokens) close the gate. Typecheck and story tests are separate (tests.mjs).
 */
export function runChecks(root) {
  const config = loadConfig(root);
  const exceptions = Array.isArray(config.exceptions) ? config.exceptions : [];
  const css = buildCss(root, config);
  const contrast = markAccepted(checkContrast(root, config), "contrast", exceptions);
  const distinct = markAccepted(checkDistinct(root, config), "distinct", exceptions);
  const structure = markAccepted(checkStructure(root, config), "structure", exceptions);
  const componentsDir = join(root, "src", "components");
  const hardcoded = markAccepted(existsSync(componentsDir) ? scan(["src/components"], root) : [], "hardcoded", exceptions);
  const open = (list) => list.filter((c) => !c.pass && !c.accepted);
  const summary = {
    tokens: { ok: css.issues.length === 0, issues: css.issues },
    contrast: { ok: open(contrast).length === 0, advisory: true, failing: open(contrast).length, accepted: contrast.filter((c) => !c.pass && c.accepted).length, total: contrast.length },
    hardcoded: { ok: hardcoded.every((f) => f.accepted), advisory: true, count: hardcoded.filter((f) => !f.accepted).length, accepted: hardcoded.filter((f) => f.accepted).length },
    distinct: { ok: open(distinct).length === 0, advisory: true, failing: open(distinct).length, accepted: distinct.filter((c) => !c.pass && c.accepted).length, total: distinct.length },
    structure: { ok: open(structure).length === 0, advisory: true, failing: open(structure).length, accepted: structure.filter((c) => c.accepted).length },
  };
  const gate = Object.values(summary).every((s) => s.ok || s.advisory);
  const warnings = Object.entries(summary).filter(([, s]) => s.advisory && !s.ok).map(([k, s]) => ({ check: k, count: s.failing ?? s.count ?? 0 }));
  return { gate, summary, warnings, contrast, distinct, structure, hardcoded, tokenIssues: css.issues, exceptions };
}
