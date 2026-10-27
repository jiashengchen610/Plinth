// Quality checks over a workspace: color contrast for every brand × mode, role colors that cannot be told
// apart, token consistency across brands, and hardcoded values in component code. Also turns contrast
// failures into token fixes. Exceptions the user accepted (design-system.json → exceptions) are reported
// but do not block the gate.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio, fixContrast, deltaE, hueDifference, tint } from "./color.mjs";
import { loadConfig, listBrands, resolveBrand, buildCss } from "./tokens.mjs";
import { scan } from "./check-hardcoded.mjs";

/**
 * Foreground/background pairs that must meet contrast. Derived from naming conventions:
 *   shadcn   X / X-foreground            (background / foreground is the page pair)
 *   material X / on-X
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
  }
  if (set.has("muted-foreground")) add("background", "muted-foreground");
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

/** Contrast results for every brand and mode. */
export function checkContrast(root, config = loadConfig(root)) {
  const results = [];
  const tinted = tintedPairs(root);
  for (const brand of listBrands(root, config)) {
    const r = resolveBrand(root, brand, config);
    const colors = r.tokens.filter((t) => t.type === "color");
    const byName = new Map(colors.map((t) => [t.name, t]));
    const valueIn = (name, mode) => byName.get(name).values[mode] ?? byName.get(name).values.default;
    const row = (p, mode, bgValue, extra = {}) => {
      const fg = valueIn(p.fg, mode);
      const ratio = contrastRatio(fg?.resolved, bgValue);
      return {
        brand, mode, bg: p.bg, fg: p.fg, min: p.min,
        ratio: ratio === null ? null : Number(ratio.toFixed(2)),
        pass: ratio !== null && ratio >= p.min,
        fgToken: byName.get(p.fg).key, fgSource: byName.get(p.fg).source,
        // The value to edit: this mode's own value when it has one, else the default it inherits.
        fgRaw: byName.get(p.fg).values[mode]?.raw ?? byName.get(p.fg).values.default?.raw, bgValue,
        ...extra,
      };
    };
    for (const p of contrastPairs(colors.map((t) => t.name), config)) {
      for (const mode of r.modes) results.push(row(p, mode, valueIn(p.bg, mode)?.resolved));
    }
    for (const t of tinted) {
      if (!byName.has(t.fg) || !byName.has("background")) continue;
      for (const mode of r.modes) {
        const alpha = mode === "dark" ? t.dark : t.light;
        const base = valueIn("background", mode)?.resolved;
        const bgValue = tint(valueIn(t.fg, mode)?.resolved, alpha, base);
        // The background moves with the text color: fixes recompute it (see contrastFixes).
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
 * Turn failing contrast results into token edits: move the foreground's lightness until it passes.
 * Aliased foregrounds are reported, not edited (fix the alias target instead).
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
    if (typeof r.fgRaw === "string" && /^\{.+\}$/.test(r.fgRaw)) { skipped.push(...failing.map((f) => ({ ...f, reason: "foreground is an alias; fix the token it points to" }))); continue; }
    // A tint of the text's own color moves with it; every other background is fixed.
    const bgOf = (p, v) => (p.selfTint ? tint(v, p.selfTint.alpha, p.selfTint.base) : p.bgValue);
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
    const ok = value && pairs.every((p) => (contrastRatio(value, bgOf(p, value)) ?? 0) >= p.min);
    if (!ok) { skipped.push(...failing.map((f) => ({ ...f, reason: "no lightness satisfies every background this color is used on; change a background or the hue" }))); continue; }
    ops.push({
      op: "set", file: r.fgSource === "base" ? "tokens/base.tokens.json" : `${r.fgSource}/tokens.json`,
      path: r.fgToken, mode: r.mode, value,
      why: `${r.fg} (${r.brand}, ${r.mode === "default" ? "light" : r.mode}): ${failing.map((f) => `on ${f.bg} ${f.ratio} → ${contrastRatio(value, bgOf(f, value)).toFixed(2)}`).join(", ")}`,
    });
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

/** Run every check. `gate` is true when the workspace may be published. */
export function runChecks(root) {
  const config = loadConfig(root);
  const exceptions = Array.isArray(config.exceptions) ? config.exceptions : [];
  const css = buildCss(root, config);
  const contrast = markAccepted(checkContrast(root, config), "contrast", exceptions);
  const distinct = markAccepted(checkDistinct(root, config), "distinct", exceptions);
  const componentsDir = join(root, "src", "components");
  const hardcoded = markAccepted(existsSync(componentsDir) ? scan(["src/components"], root) : [], "hardcoded", exceptions);
  const blocking = (list) => list.filter((c) => !c.pass && !c.accepted);
  const summary = {
    tokens: { ok: css.issues.length === 0, issues: css.issues },
    contrast: { ok: blocking(contrast).length === 0, failing: blocking(contrast).length, accepted: contrast.filter((c) => !c.pass && c.accepted).length, total: contrast.length },
    hardcoded: { ok: hardcoded.every((f) => f.accepted), count: hardcoded.filter((f) => !f.accepted).length, accepted: hardcoded.filter((f) => f.accepted).length },
    // Advisory: reported, never part of the gate.
    distinct: { ok: blocking(distinct).length === 0, advisory: true, failing: blocking(distinct).length, accepted: distinct.filter((c) => !c.pass && c.accepted).length, total: distinct.length },
  };
  const gate = Object.values(summary).every((s) => s.ok || s.advisory);
  return { gate, summary, contrast, distinct, hardcoded, tokenIssues: css.issues, exceptions };
}
