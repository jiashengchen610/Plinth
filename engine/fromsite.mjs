// Starting from a website: what dembrandt read from a page (its colors, fonts, corners and buttons) turned into the
// style picks Describe makes, so the design system starts from that look. Pure and zero-dependency: the server runs
// dembrandt and checks fonts with Google; everything here is computed from its JSON and the palette.
import { contrastRatio, deltaE, formatHex, parseColor, rgbToOklch } from "./color.mjs";
import { SHADES } from "./palette.mjs";

/** The dembrandt release Plinth runs (its JSON shape is what this file reads). */
export const DEMBRANDT = "dembrandt@0.39.2";

const GRAY_FAMILIES = ["slate", "gray", "zinc", "neutral", "stone", "mauve", "olive", "mist", "taupe"];
// Closer than this (ΔE_OK) to a palette step, a site color is that step; farther, it gets its own scale.
const SAME = 0.02;
// Below this chroma a color counts as a gray when the grays are matched.
const GRAYISH = 0.04;

const lch = (v) => { const c = parseColor(v); return c ? rgbToOklch(c) : null; };
const hex = (v) => { const c = parseColor(v); return c ? formatHex(c) : null; };
const opaque = (v) => (parseColor(v)?.alpha ?? 0) >= 0.9;
const px = (v) => {
  const n = Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
};

/** Palette families with their steps as given in primitives: { teal: { "500": "oklch(…)" }, … }. */
function families(primitives) {
  const out = {};
  for (const [name, node] of Object.entries(primitives.color ?? {})) {
    if (name.startsWith("$") || !node || typeof node !== "object" || "$value" in node) continue;
    const steps = Object.fromEntries(SHADES.filter((s) => node[s]?.$value).map((s) => [s, node[s].$value]));
    if (Object.keys(steps).length) out[name] = steps;
  }
  return out;
}

/** The nearest palette step to a color: { family, step, distance }. */
export function nearestStep(primitives, value, only) {
  let best = null;
  for (const [family, steps] of Object.entries(families(primitives))) {
    if (only && !only.includes(family)) continue;
    for (const [step, v] of Object.entries(steps)) {
      const d = deltaE(value, v);
      if (d != null && (!best || d < best.distance)) best = { family, step, distance: d };
    }
  }
  return best;
}

/**
 * A main color as a palette pick: the step it (nearly) is; for black and near-grays a step of the gray family (a
 * scale made from black would only be grays); otherwise its own scale, made from it.
 */
export function matchMain(primitives, color, gray) {
  const l = lch(color);
  if (l && l.c < 0.02) {
    const near = nearestStep(primitives, color, [gray]);
    return { family: gray, step: near?.step ?? "900", color };
  }
  const near = nearestStep(primitives, color);
  return near && near.distance < SAME ? { family: near.family, step: near.step, color } : { custom: color, color };
}

/** The radius scale in primitives, smallest first: [{ step, px }]. */
function radiusScale(primitives) {
  return Object.entries(primitives.radius ?? {})
    .filter(([k, v]) => !k.startsWith("$") && v?.$value && typeof v.$value === "object")
    .map(([step, v]) => ({ step, px: v.$value.unit === "rem" ? v.$value.value * 16 : Number(v.$value.value) }))
    .sort((a, b) => a.px - b.px);
}
const nearestRadius = (scale, value) => scale.reduce((best, s) => (Math.abs(s.px - value) < Math.abs(best.px - value) ? s : best), scale[0]);

// ---------------- what the page shows ----------------

/** Buttons that are filled with a color of their own (not see-through, not the page's background). */
function filledButtons(x) {
  const page = x.colors?.semantic?.background ?? "#ffffff";
  return (x.components?.buttons ?? [])
    .map((b) => ({ ...b.states?.default, confidence: b.confidence, text: b.text }))
    .filter((b) => b.backgroundColor && opaque(b.backgroundColor) && (deltaE(b.backgroundColor, page) ?? 0) > 0.05);
}

/** The main action color: the most used filled button's background, else what dembrandt calls primary, else the logo. */
function mainColor(x) {
  const counts = new Map();
  for (const b of filledButtons(x)) {
    const h = hex(b.backgroundColor);
    const w = b.confidence === "high" ? 2 : 1;
    counts.set(h, { n: (counts.get(h)?.n ?? 0) + w, button: counts.get(h)?.button ?? b });
  }
  const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  if (top) return { color: top[0], from: "buttons", button: top[1].button };
  const primary = x.colors?.semantic?.primary;
  if (primary && opaque(primary)) return { color: hex(primary), from: "page" };
  if (x.logo?.color) return { color: hex(x.logo.color), from: "logo" };
  return null;
}

/** A colorful brand color other than the main one (often the logo's), shown as a note. */
function accentColor(x, main) {
  const candidates = [x.logo?.color, x.colors?.semantic?.accent, ...(x.colors?.palette ?? []).filter((p) => p.role === "accent").map((p) => p.normalized ?? p.color)];
  for (const c of candidates) {
    const l = c && lch(c);
    if (l && l.c >= 0.06 && (!main || (deltaE(c, main) ?? 1) > 0.08)) return hex(c);
  }
  return null;
}

/** The gray family whose hue and tint come closest to the page's grays (text, borders, muted surfaces). */
function grayFamily(x, primitives) {
  const seen = [];
  for (const p of x.colors?.palette ?? []) seen.push([p.normalized ?? p.color, p.count ?? 1]);
  for (const b of x.borders?.combinations ?? []) seen.push([b.color, b.count ?? 1]);
  if (x.colors?.semantic?.text) seen.push([x.colors.semantic.text, 5]);
  let a = 0, b = 0, w = 0;
  for (const [v, n] of seen) {
    const c = lch(v);
    if (!c || c.c >= GRAYISH || c.l > 0.97 || c.l < 0.12) continue;
    a += c.c * Math.cos((c.h * Math.PI) / 180) * n;
    b += c.c * Math.sin((c.h * Math.PI) / 180) * n;
    w += n;
  }
  if (!w) return "neutral";
  a /= w; b /= w;
  if (Math.hypot(a, b) < 0.004) return "neutral";
  const fams = families(primitives);
  let best = null;
  for (const name of GRAY_FAMILIES) {
    const steps = fams[name];
    if (!steps) continue;
    let fa = 0, fb = 0, k = 0;
    for (const s of ["300", "400", "500", "600", "700"]) {
      const c = lch(steps[s]);
      if (!c) continue;
      fa += c.c * Math.cos((c.h * Math.PI) / 180); fb += c.c * Math.sin((c.h * Math.PI) / 180); k++;
    }
    const d = Math.hypot(a - fa / k, b - fb / k);
    if (!best || d < best.d) best = { name, d };
  }
  return best?.name ?? "neutral";
}

// A button corner this big is a pill: buttons are rarely taller than twice this.
const PILL = 40;

/** Corners of buttons (controls) and of cards and dialogs (containers), in px; "pill" for pill-shaped buttons. */
function corners(x, main) {
  const r = (v) => { const n = px(v); return n == null ? null : n >= PILL ? "pill" : n; };
  const control = r(main?.button?.borderRadius) ?? r(filledButtons(x)[0]?.borderRadius);
  const boxy = /^(div|article|section|dialog|details|aside|form|li|card)$/i;
  let container = null;
  for (const v of x.borderRadius?.values ?? []) {
    const n = px(v.value);
    if (n == null || n < 6 || n > 48 || v.confidence === "low") continue;
    if (!(v.elements ?? []).some((e) => boxy.test(e))) continue;
    if (!container || (v.count ?? 0) > container.count) container = { px: n, count: v.count ?? 0 };
  }
  return { control, container: container?.px ?? null };
}

// Free fonts that stand in for well-known paid ones (lowercase name, or the start of it).
const STAND_INS = [
  ["helvetica", "Inter"], ["arial", "Inter"], ["sf pro", "Inter"], ["-apple-system", "Inter"], ["system-ui", "Inter"],
  ["söhne", "Inter"], ["sohne", "Inter"], ["graphik", "Inter"], ["gt america", "Inter"], ["neue haas", "Inter"],
  ["suisse", "Inter"], ["aktiv grotesk", "Inter"], ["maison neue", "Inter"], ["inter display", "Inter"],
  ["circular", "DM Sans"], ["gt walsheim", "DM Sans"], ["cerebri", "DM Sans"], ["avenir", "Nunito Sans"],
  ["proxima nova", "Montserrat"], ["gotham", "Montserrat"], ["futura", "Jost"], ["brandon", "Josefin Sans"],
  ["abc favorit", "Space Grotesk"], ["favorit", "Space Grotesk"], ["gt pressura", "Space Grotesk"], ["apercu", "Work Sans"],
  ["tiempos", "Source Serif 4"], ["freight", "Source Serif 4"], ["gt sectra", "Fraunces"], ["canela", "Playfair Display"],
  ["sf mono", "JetBrains Mono"], ["menlo", "JetBrains Mono"], ["monaco", "JetBrains Mono"], ["consolas", "JetBrains Mono"],
];
const KIND = (name) => (/mono|code/i.test(name) ? "mono" : /serif|tiempos|freight|canela|sectra|garamond|times|georgia/i.test(name) && !/sans/i.test(name) ? "serif" : "sans");
const BY_KIND = { sans: "Inter", serif: "Source Serif 4", mono: "JetBrains Mono" };

/** A font name as Google Fonts spells families: "GeistSans" → "Geist", "Inter Variable" → "Inter". */
export function cleanFamily(name) {
  let f = String(name ?? "").replace(/^['"]|['"]$/g, "").trim();
  f = f.replace(/\s*(Variable|VF|Web|Webfont)$/i, "").trim();
  f = f.replace(/([a-z])([A-Z])/g, "$1 $2");
  if (/^geist sans$/i.test(f)) return "Geist";
  return f;
}

/** Names to try on Google Fonts for a family, most specific first: "Monzo Sans Text" → that, "Monzo Sans", "Monzo". */
export function familyCandidates(name) {
  const f = cleanFamily(name);
  const out = [f];
  const short = f.replace(/\s+(Text|Display|Headline|Pro|UI)$/i, "");
  if (short !== f) out.push(short);
  return [...new Set(out)].filter(Boolean);
}

/** A free stand-in for a font Google does not have. */
export function standIn(name) {
  const f = cleanFamily(name).toLowerCase();
  return STAND_INS.find(([k]) => f.startsWith(k))?.[1] ?? BY_KIND[KIND(f)];
}

/** Font families the page uses for headings, text and buttons (most used first). */
function pageFonts(x) {
  const tally = (pred) => {
    const m = new Map();
    for (const s of x.typography?.styles ?? []) if (s.family && pred(s.context ?? "")) m.set(s.family, (m.get(s.family) ?? 0) + (s.count ?? 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const heading = tally((c) => /^(display|heading)/.test(c));
  const body = tally((c) => /^(body|text|paragraph)/.test(c)) ?? heading;
  const label = tally((c) => /^(ui|button|label)/.test(c)) ?? body;
  return { heading: heading ?? body, body, label };
}

/** Families the server should ask Google about: those the page loads from somewhere else than Google Fonts. */
export function fontsToCheck(extraction) {
  const f = pageFonts(extraction);
  return [...new Set([f.heading, f.body, f.label].filter(Boolean).flatMap(familyCandidates))];
}

/**
 * The look of a page as Describe's picks, with what was found and plain notes for the user.
 * @param extraction dembrandt's JSON
 * @param primitives tokens/primitives.tokens.json (the workspace's or the template's)
 * @param googleHas  family name → true when Google Fonts serves it (checked by the server)
 */
export function siteLook(extraction, primitives, googleHas = () => false) {
  const x = extraction ?? {};
  const notes = [];
  const found = { name: x.siteName ?? null, url: x.url ?? null };

  // Colors: the main color is the buttons' color, matched to the palette or made into its own scale.
  const gray = grayFamily(x, primitives);
  found.gray = gray;
  const main = mainColor(x);
  let mainPick = null;
  if (main?.color) {
    mainPick = matchMain(primitives, main.color, gray);
    found.main = { color: main.color, from: main.from };
    if (main.button?.color) found.main.text = hex(main.button.color);
  } else notes.push("No main color found on the page; pick one in the palette question.");
  const accent = accentColor(x, main?.color);
  if (accent) { found.accent = accent; notes.push(`Also on the site: ${accent}, a second brand color (often the logo's). Add it later in Style if you want it.`); }
  let background = null;
  const page = x.colors?.semantic?.background;
  if (page && opaque(page) && (deltaE(page, "#ffffff") ?? 0) > 0.01) {
    // The page's own gray family first: several grays share their lightest steps.
    const own = nearestStep(primitives, page, [gray]);
    const near = own && own.distance < SAME ? own : nearestStep(primitives, page, GRAY_FAMILIES);
    if (near && near.distance < SAME * 1.5 && Number(near.step) <= 100) background = `${near.family}.${near.step}`;
    found.background = hex(page);
    if (!background) notes.push(`The page background (${hex(page)}) is not close to a gray in the palette; the design system starts on white.`);
  }

  // Corners: buttons set the inner corners, cards and dialogs the outer ones.
  const scale = radiusScale(primitives);
  const c = corners(x, main);
  found.corners = { buttons: c.control, cards: c.container };
  let cornerPick = null;
  if (c.control != null && scale.length) {
    const preset = c.control === 0 ? "square" : c.control === "pill" ? "pill" : c.control <= 4 ? "slight" : "round";
    cornerPick = { preset };
    if (c.control !== "pill") cornerPick.inner = nearestRadius(scale, c.control).step;
    if (c.container != null) cornerPick.outer = nearestRadius(scale, c.container).step;
  } else notes.push("No buttons with corners found; pick corners in the corners question.");

  // Fonts: the page's own families when Google has them, else a free stand-in.
  const pf = pageFonts(x);
  const free = (name) => {
    if (!name) return null;
    const google = new Set((x.typography?.sources?.googleFonts ?? []).map((g) => cleanFamily(g).toLowerCase()));
    for (const cand of familyCandidates(name)) if (google.has(cand.toLowerCase()) || googleHas(cand)) return { family: cand, from: name, free: true };
    return { family: standIn(name), from: name, free: false };
  };
  const body = free(pf.body), heading = free(pf.heading), label = free(pf.label);
  found.fonts = { body, heading, label };
  for (const f of [heading, body].filter(Boolean)) {
    if (!f.free && !notes.some((n) => n.includes(f.from))) notes.push(`${cleanFamily(f.from)} is the site's own font and not free to use; ${f.family} is the closest free one.`);
  }
  const fontPick = body ? {
    font: body.family,
    headingFont: heading && heading.family !== body.family ? heading.family : "",
    labelFont: label && heading && label.family === heading.family && heading.family !== body.family ? "heading" : "body",
  } : null;

  return { found, picks: { main: mainPick, gray, background, corners: cornerPick, fonts: fontPick }, notes };
}

/**
 * After styleOps: point primary at the site's exact color when text can sit on it (white, black, or the family's
 * darkest or lightest step), as the site does; otherwise styleOps' readable step stays. Ops on the brand file.
 */
export function exactPrimaryOps(brand, family, step, shades) {
  const color = shades[step];
  if (!color) return [];
  const options = [["{color.white}", "#ffffff"], [`{color.${family}.950}`, shades["950"]], ["{color.black}", "#000000"], [`{color.${family}.50}`, shades["50"]]];
  const best = options.map(([ref, v]) => [ref, contrastRatio(v, color) ?? 0]).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 4.5) return [];
  const file = `brands/${brand}/tokens.json`;
  return [
    { op: "set", file, path: "color/primary", value: `{color.${family}.${step}}` },
    { op: "set", file, path: "color/primary-foreground", value: best[0] },
  ];
}
