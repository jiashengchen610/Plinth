// OKLCH ↔ hex for the color wheel, the same math as the engine (engine/color.mjs, Björn Ottosson's OKLab), so a color
// picked here is the one the engine makes its scale from.
export type Oklch = { l: number; c: number; h: number };

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab([r, g, b]: number[]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, a, b]: number[]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

/** "#ca8a04" (or "#c80") → OKLCH; null when it is not a hex color. */
export function hexToOklch(hex: string): Oklch | null {
  const m = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const full = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
  const [L, a, b] = toOklab([0, 2, 4].map((i) => toLinear(parseInt(full.slice(i, i + 2), 16) / 255)));
  const c = Math.hypot(a, b);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { l: L, c, h: c < 1e-4 ? 0 : (h + 360) % 360 };
}

/** A resolved token value ("oklch(0.546 0.245 262.9)", "oklch(54.6% 0.245 262.9)" or hex) → OKLCH; null otherwise. */
export function cssToOklch(value: string | null | undefined): Oklch | null {
  if (!value) return null;
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i.exec(value.trim());
  if (m) return { l: Number(m[1]) / (m[2] ? 100 : 1), c: Number(m[3]), h: Number(m[4]) };
  return hexToOklch(value);
}

/** OKLCH → hex, reducing chroma until the color fits the screen's colors. */
export function oklchToHex({ l, c, h }: Oklch): string {
  const rgb = (cc: number) => fromOklab([l, cc * Math.cos((h * Math.PI) / 180), cc * Math.sin((h * Math.PI) / 180)]).map(fromLinear);
  const fits = (v: number[]) => v.every((x) => x >= -1e-4 && x <= 1 + 1e-4);
  let out = rgb(c);
  if (!fits(out)) {
    let lo = 0, hi = c;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(rgb(mid))) lo = mid; else hi = mid; }
    out = rgb(lo);
  }
  return `#${out.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, "0")).join("")}`;
}
