// Color math for the token engine: parse CSS / DTCG colors, convert between sRGB and OKLCH,
// compute WCAG 2.x contrast, and repair a foreground color's lightness until it meets a target ratio.
// Zero dependencies. All channel values are floats; sRGB channels are 0..1.

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// ---------- sRGB <-> linear ----------
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

// ---------- OKLab / OKLCH (Björn Ottosson) ----------
function linearSrgbToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function oklabToLinearSrgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** @returns {{l:number,c:number,h:number,alpha:number}} */
export function rgbToOklch({ r, g, b, alpha = 1 }) {
  const [L, a, bb] = linearSrgbToOklab([r, g, b].map(toLinear));
  const c = Math.hypot(a, bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h: c < 1e-4 ? 0 : h, alpha };
}

/** OKLCH → sRGB, gamut-mapped by reducing chroma until the color fits. */
export function oklchToRgb({ l, c, h, alpha = 1 }) {
  const toRgb = (cc) => {
    const hr = (h * Math.PI) / 180;
    return oklabToLinearSrgb([l, cc * Math.cos(hr), cc * Math.sin(hr)]).map(fromLinear);
  };
  let rgb = toRgb(c);
  const inGamut = (v) => v.every((x) => x >= -1e-4 && x <= 1 + 1e-4);
  if (!inGamut(rgb)) {
    let lo = 0, hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(toRgb(mid))) lo = mid; else hi = mid;
    }
    rgb = toRgb(lo);
  }
  const [r, g, b] = rgb.map(clamp01);
  return { r, g, b, alpha };
}

// ---------- parsing ----------
const NUM = "([+-]?(?:\\d+\\.?\\d*|\\.\\d+))";

/** Parse a CSS color string or a DTCG color object. Returns sRGB {r,g,b,alpha} or null. */
export function parseColor(value) {
  if (value == null) return null;
  // Already-parsed sRGB object (as returned by this module).
  if (typeof value === "object" && typeof value.r === "number" && typeof value.g === "number" && typeof value.b === "number") {
    return { r: value.r, g: value.g, b: value.b, alpha: value.alpha ?? 1 };
  }
  if (typeof value === "object") {
    if (typeof value.hex === "string") return parseColor(value.hex);
    const space = String(value.colorSpace ?? "srgb").toLowerCase();
    const comps = (value.components ?? []).map(Number);
    const alpha = value.alpha ?? 1;
    if (space === "srgb") return { r: comps[0], g: comps[1], b: comps[2], alpha };
    if (space === "oklch") return oklchToRgb({ l: comps[0], c: comps[1], h: comps[2], alpha });
    return null;
  }
  const s = String(value).trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((ch) => ch + ch).join("");
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = (i) => parseInt(hex.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), alpha: hex.length === 8 ? n(6) : 1 };
  }
  m = s.match(new RegExp(`^oklch\\(\\s*${NUM}(%?)\\s+${NUM}\\s+${NUM}(?:deg)?\\s*(?:/\\s*${NUM}(%?))?\\s*\\)$`));
  if (m) {
    let l = Number(m[1]);
    if (m[2] === "%" || l > 1.5) l /= 100;
    let alpha = m[5] !== undefined ? Number(m[5]) : 1;
    if (m[6] === "%") alpha /= 100;
    return oklchToRgb({ l, c: Number(m[3]), h: Number(m[4]), alpha });
  }
  m = s.match(new RegExp(`^rgba?\\(\\s*${NUM}[\\s,]+${NUM}[\\s,]+${NUM}\\s*(?:[,/]\\s*${NUM}(%?))?\\s*\\)$`));
  if (m) {
    let alpha = m[4] !== undefined ? Number(m[4]) : 1;
    if (m[5] === "%") alpha /= 100;
    return { r: Number(m[1]) / 255, g: Number(m[2]) / 255, b: Number(m[3]) / 255, alpha };
  }
  if (s === "white") return { r: 1, g: 1, b: 1, alpha: 1 };
  if (s === "black") return { r: 0, g: 0, b: 0, alpha: 1 };
  return null;
}

// ---------- formatting ----------
const round = (x, d) => Number(x.toFixed(d));
export function formatOklch({ l, c, h, alpha = 1 }) {
  return `oklch(${round(l, 3)} ${round(c, 3)} ${round(h, 1)}${alpha < 1 ? ` / ${round(alpha, 3)}` : ""})`;
}
export function formatHex({ r, g, b }) {
  return "#" + [r, g, b].map((x) => Math.round(clamp01(x) * 255).toString(16).padStart(2, "0")).join("");
}

// ---------- distance ----------
/** Perceptual distance in OKLab (ΔE_OK). Roughly: 0.02 just noticeable, 0.1 clearly different. null if unparseable. */
export function deltaE(aValue, bValue) {
  const a = parseColor(aValue), b = parseColor(bValue);
  if (!a || !b) return null;
  const [l1, a1, b1] = linearSrgbToOklab([a.r, a.g, a.b].map(toLinear));
  const [l2, a2, b2] = linearSrgbToOklab([b.r, b.g, b.b].map(toLinear));
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
/** Shortest hue difference in degrees, or null when either color is (near) achromatic. */
export function hueDifference(aValue, bValue, minChroma = 0.05) {
  const a = parseColor(aValue), b = parseColor(bValue);
  if (!a || !b) return null;
  const la = rgbToOklch(a), lb = rgbToOklch(b);
  if (la.c < minChroma || lb.c < minChroma) return null;
  const d = Math.abs(la.h - lb.h) % 360;
  return d > 180 ? 360 - d : d;
}

// ---------- contrast ----------
export function relativeLuminance({ r, g, b }) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}
/** Composite a translucent color over an opaque background. */
function over(fg, bg) {
  const a = fg.alpha ?? 1;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), alpha: 1 };
}
/** WCAG 2.x contrast ratio between two colors (any parseable form). Returns null if unparseable. */
export function contrastRatio(fgValue, bgValue) {
  const bg = parseColor(bgValue);
  let fg = parseColor(fgValue);
  if (!fg || !bg) return null;
  fg = over(fg, bg);
  const a = relativeLuminance(fg), b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Move the foreground's OKLCH lightness (hue and chroma kept, chroma gamut-mapped) until the
 * contrast against the background reaches `target`. Searches toward whichever end of the
 * lightness axis is farther from the background. Returns null if the target is unreachable.
 */
export function fixContrast(fgValue, bgValue, target = 4.5) {
  const fg = parseColor(fgValue), bg = parseColor(bgValue);
  if (!fg || !bg) return null;
  const start = contrastRatio(fg, bg);
  if (start >= target) return { value: fgValue, ratio: start, changed: false };
  const lch = rgbToOklch(fg);
  const bgL = rgbToOklch(bg).l;
  const towards = bgL > 0.5 ? 0 : 1; // dark text on light bg, light text on dark bg
  const ratioAt = (l) => contrastRatio(oklchToRgb({ ...lch, l }), bg);
  if (ratioAt(towards) < target) return null;
  let lo = lch.l, hi = towards; // lo fails, hi passes
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (ratioAt(mid) >= target) hi = mid; else lo = mid;
  }
  // Nudge a hair past the boundary so rounding in formatOklch cannot drop below target.
  const l = towards === 0 ? Math.max(0, hi - 0.004) : Math.min(1, hi + 0.004);
  const out = { ...lch, l };
  return { value: formatOklch(out), ratio: contrastRatio(oklchToRgb(out), bg), changed: true, from: { l: lch.l }, to: { l } };
}
