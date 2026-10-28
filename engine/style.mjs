// The Style step of the UI: main color, grays, corners and fonts turned into change ops. A choice never changes
// what is in the palette; it re-points roles (brands/<brand>/tokens.json) at other palette steps and the shape and
// font roles (tokens/base.tokens.json) at other scale steps or fonts. A font picked for the first time joins the
// palette. Which steps keep text readable is computed here.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio } from "./color.mjs";

const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
/** Palette families used as grays. Picking one as the main color gives a black-and-white look. */
export const GRAYS = ["slate", "gray", "zinc", "neutral", "stone", "mauve", "olive", "mist", "taupe"];
/** Corner presets: radius roles → steps of the radius scale. "round" is the template's default. */
export const CORNERS = {
  square: { control: "none", container: "none", pill: "none", small: "none" },
  slight: { control: "sm", container: "md", pill: "sm", small: "xs" },
  round: { control: "lg", container: "xl", pill: "full", small: "sm" },
  pill: { control: "full", container: "2xl", pill: "full", small: "md" },
};
const BASE = "tokens/base.tokens.json";
const PRIMITIVES = "tokens/primitives.tokens.json";

const readJson = (root, rel) => (existsSync(join(root, rel)) ? JSON.parse(readFileSync(join(root, rel), "utf8")) : {});
const ref = (v) => (typeof v === "string" ? /^\{([^}]+)\}$/.exec(v.trim())?.[1] ?? null : null);
const darkOf = (t) => t?.$extensions?.plinth?.modes?.dark;

/** Palette families with their steps: { teal: { "500": "oklch(…)" }, … }; white and black are left out. */
function families(root) {
  const color = readJson(root, PRIMITIVES).color ?? {};
  const out = {};
  for (const [name, node] of Object.entries(color)) {
    if (name.startsWith("$") || !node || typeof node !== "object" || "$value" in node) continue;
    const steps = Object.fromEntries(Object.entries(node).filter(([k, v]) => !k.startsWith("$") && v && typeof v === "object" && "$value" in v).map(([k, v]) => [k, v.$value]));
    if (Object.keys(steps).length) out[name] = steps;
  }
  return out;
}

const brandFile = (brand) => `brands/${brand}/tokens.json`;
const colorRoles = (root, brand) => {
  const c = readJson(root, brandFile(brand)).color ?? {};
  return Object.entries(c).filter(([k, v]) => !k.startsWith("$") && v && typeof v === "object" && "$value" in v);
};
const familyOf = (r) => (r && r.startsWith("color.") ? r.split(".")[1] : null);

// ---------------- fonts ----------------
// Fonts are layered like colors: the palette (primitives → font) lists the fonts the system loads, font roles
// (base → font: body, heading, label, code; a brand may override them) point at them, and text styles point at
// the roles. Workspaces from before roles have one family in font.sans.
const FONT_ROLES = ["body", "heading", "label", "code", "sans", "mono"];
const SERIF = new Set(["source serif 4", "playfair display", "fraunces", "lora", "merriweather", "dm serif display", "libre baskerville", "eb garamond", "cormorant garamond", "crimson pro", "instrument serif", "noto serif", "pt serif", "spectral", "newsreader", "young serif"]);
/** "serif", "mono" or "sans", from the family name (serif display faces are listed). */
export function fontKind(family) {
  const f = String(family).trim().toLowerCase();
  if (/\bmono\b|code/.test(f)) return "mono";
  return SERIF.has(f) || (/serif/.test(f) && !/sans/.test(f)) ? "serif" : "sans";
}
/**
 * How one font picked without a role (Describe's answer) is applied: a serif becomes the headings font and text
 * stays a sans, as most systems pair them; anything else becomes the text font. The user can change both in Style.
 */
export const fontPickFor = (family) => (fontKind(family) === "serif" ? { headingFont: family } : { font: family });
export const fontSlug = (family) => { const s = String(family).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); return FONT_ROLES.includes(s) ? `${s}-family` : s; };
const firstFamily = (v) => (Array.isArray(v) ? v[0] : typeof v === "string" && !ref(v) ? v.split(",")[0].trim().replace(/^['"]|['"]$/g, "") : null);

/** Font roles as stored: { roles: { body: "{font.geist}", … }, palette: { geist: ["Geist", "sans-serif"] }, fileOf(role) }. */
function fontTokens(root, brand) {
  const base = readJson(root, BASE).font ?? {};
  const own = readJson(root, brandFile(brand)).font ?? {};
  const palette = readJson(root, PRIMITIVES).font ?? {};
  const roles = {};
  for (const r of FONT_ROLES) { const v = own[r]?.$value ?? base[r]?.$value; if (v !== undefined) roles[r] = v; }
  const pal = Object.fromEntries(Object.entries(palette).filter(([k, v]) => !k.startsWith("$") && v && typeof v === "object" && "$value" in v).map(([k, v]) => [k, v.$value]));
  return { roles, palette: pal, fileOf: (r) => (own[r] !== undefined ? brandFile(brand) : BASE) };
}
const hasFontRoles = (root, brand) => fontTokens(root, brand).roles.body !== undefined;

/** The family a role ends at: body → {font.geist} → "Geist". */
function roleFamily({ roles, palette }, role, seen = new Set()) {
  const v = roles[role];
  const r = ref(v);
  if (!r) return firstFamily(v);
  const k = r.replace(/^font\./, "");
  if (seen.has(k)) return null;
  return k in roles && FONT_ROLES.includes(k) ? roleFamily({ roles, palette }, k, new Set([...seen, role])) : firstFamily(palette[k]);
}

/** The fonts the Style step shows: text font, headings font (null: same as text), what buttons and labels follow. */
export function readFonts(root, brand) {
  const t = fontTokens(root, brand);
  if (!t.roles.body) return { font: firstFamily(t.roles.sans), headingFont: null, labelFont: "body", codeFont: null, fontRoles: false };
  return {
    font: roleFamily(t, "body"),
    headingFont: ref(t.roles.heading) === "font.body" ? null : roleFamily(t, "heading"),
    labelFont: ref(t.roles.label) === "font.heading" ? "heading" : "body",
    codeFont: roleFamily(t, "code"),
    fontRoles: true,
  };
}

/** What the Style step shows as selected, read back from the tokens. Unknown or mixed values read as "custom". */
export function readStyle(root, brand) {
  const roles = Object.fromEntries(colorRoles(root, brand));
  const fams = families(root);
  const main = familyOf(ref(roles.primary?.$value)) ?? "custom";
  const count = {};
  for (const name of ["background", "foreground", "muted", "muted-foreground", "border", "input", "secondary"]) {
    const f = familyOf(ref(roles[name]?.$value)) ?? familyOf(ref(darkOf(roles[name])));
    if (f && GRAYS.includes(f)) count[f] = (count[f] ?? 0) + 1;
  }
  const gray = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "custom";
  const radius = readJson(root, BASE).radius ?? {};
  const step = (n) => ref(radius[n]?.$value)?.split(".")[1];
  const corners = Object.entries(CORNERS).find(([, p]) => p.control === step("control") && p.container === step("container") && p.pill === step("pill"))?.[0] ?? "custom";
  const fonts = readFonts(root, brand);
  return {
    main, gray, corners, ...fonts,
    hues: Object.keys(fams).filter((f) => !GRAYS.includes(f)),
    grays: Object.keys(fams).filter((f) => GRAYS.includes(f)),
  };
}

/** The first step of `order` whose color reaches 4.5:1 against `against`, else the one that comes closest. */
function readable(steps, order, against) {
  let best = null, bestRatio = -1;
  for (const s of order) {
    if (!steps[s]) continue;
    const r = contrastRatio(against, steps[s]) ?? 0;
    if (r >= 4.5) return s;
    if (r > bestRatio) { best = s; bestRatio = r; }
  }
  return best;
}

/**
 * Ops for a style choice: { main, gray, corners, font, headingFont, labelFont }, any subset. Throws on a family or
 * preset that does not exist.
 * font: the text font (font.body); code follows it (Geist Mono with Geist, else JetBrains Mono).
 * headingFont: a family for headings, or "" for the same as text. labelFont: "body" or "heading", what buttons,
 *   tabs and labels follow.
 * main: a palette family. Primary goes to the lightest of 600–800 that white text can sit on (light mode) and the
 *   lightest of 300–500 that the family's 950 can sit on (dark), with the ring one step softer. A gray family gives the
 *   template's black-on-white look (900 / 200).
 * gray: every role pointing at one gray family moves to the same step of the new one (main color roles included).
 */
export function styleOps(root, brand, { main, gray, corners, font, headingFont, labelFont } = {}) {
  const file = brandFile(brand);
  if (!existsSync(join(root, file))) throw new Error(`no brand ${brand}`);
  const fams = families(root);
  const ops = [];
  const after = new Map(); // role → { default, dark } as refs, so a later step sees an earlier one
  for (const [name, t] of colorRoles(root, brand)) after.set(name, { default: t.$value, dark: darkOf(t) });
  const set = (name, mode, value) => {
    const cur = after.get(name) ?? {};
    if (cur[mode] === value) return;
    cur[mode] = value;
    after.set(name, cur);
    ops.push({ op: "set", file, path: `color/${name}`, ...(mode === "dark" ? { mode: "dark" } : {}), value });
  };

  if (gray !== undefined) {
    if (!GRAYS.includes(gray) || !fams[gray]) throw new Error(`no gray family ${gray}`);
    for (const [name, v] of after) {
      for (const mode of ["default", "dark"]) {
        const r = ref(v[mode]);
        const f = familyOf(r);
        if (f && GRAYS.includes(f) && f !== gray && (main === undefined || name !== "primary")) set(name, mode, `{color.${gray}.${r.split(".")[2]}}`);
      }
    }
  }
  if (main !== undefined) {
    const steps = fams[main];
    if (!steps) throw new Error(`no palette color ${main}`);
    if (GRAYS.includes(main)) {
      set("primary", "default", `{color.${main}.900}`); set("primary", "dark", `{color.${main}.200}`);
      set("primary-foreground", "default", `{color.${main}.50}`); set("primary-foreground", "dark", `{color.${main}.900}`);
      set("ring", "default", `{color.${main}.500}`); set("ring", "dark", `{color.${main}.500}`);
    } else {
      const light = readable(steps, ["600", "700", "800"], "#ffffff");
      const dark = readable(steps, ["400", "300", "500"], steps["950"] ?? "#000000");
      set("primary", "default", `{color.${main}.${light}}`);
      set("primary", "dark", `{color.${main}.${dark}}`);
      set("primary-foreground", "default", "{color.white}");
      set("primary-foreground", "dark", `{color.${main}.950}`);
      set("ring", "default", `{color.${main}.${SHADES[Math.max(0, SHADES.indexOf(light) - 1)]}}`);
      set("ring", "dark", `{color.${main}.${SHADES[Math.min(SHADES.length - 1, SHADES.indexOf(dark) + 1)]}}`);
    }
  }
  if (corners !== undefined) {
    const preset = CORNERS[corners];
    if (!preset) throw new Error(`no corner preset ${corners}`);
    const radius = readJson(root, BASE).radius ?? {};
    for (const [role, s] of Object.entries(preset)) if (radius[role] && ref(radius[role].$value) !== `radius.${s}`) ops.push({ op: "set", file: BASE, path: `radius/${role}`, value: `{radius.${s}}` });
  }
  const checkFamily = (f) => {
    const family = String(f).trim();
    if (!family || /[{}"<>;]/.test(family)) throw new Error(`not a font family: ${f}`);
    return family;
  };
  const generic = (family) => ({ serif: "serif", mono: "monospace", sans: "sans-serif" })[fontKind(family)];
  if (!hasFontRoles(root, brand)) {
    // Before font roles: one family for everything.
    if (headingFont !== undefined || labelFont !== undefined) throw new Error("This design system has one font for everything. Upgrade it first (the Upgrade button in Plinth) to pick fonts for headings and buttons.");
    if (font !== undefined) {
      const family = checkFamily(font);
      const value = [family, generic(family) === "monospace" ? "sans-serif" : generic(family)];
      const base = readJson(root, BASE);
      if (JSON.stringify(base.font?.sans?.$value) !== JSON.stringify(value)) ops.push({ op: "set", file: BASE, path: "font/sans", value });
      for (const [name, t] of Object.entries(base.typography ?? {})) {
        if (name.startsWith("$") || !t?.$value || typeof t.$value !== "object") continue;
        if (JSON.stringify(t.$value.fontFamily) !== JSON.stringify(value)) ops.push({ op: "set", file: BASE, path: `typography/${name}/font-family`, value });
      }
    }
    return ops;
  }
  const fonts = fontTokens(root, brand);
  // A picked font joins the palette once; roles point at it.
  const added = new Set();
  const inPalette = (family) => {
    const slug = fontSlug(family);
    const value = [family, generic(family)];
    if (JSON.stringify(fonts.palette[slug]) !== JSON.stringify(value) && !added.has(slug)) {
      ops.push({ op: "set", file: PRIMITIVES, path: `font/${slug}`, type: "fontFamily", value });
      added.add(slug);
    }
    return `{font.${slug}}`;
  };
  const point = (role, value) => { if (fonts.roles[role] !== value) ops.push({ op: "set", file: fonts.fileOf(role), path: `font/${role}`, type: "fontFamily", value }); };
  if (font !== undefined) {
    const family = checkFamily(font);
    point("body", inPalette(family));
    // Code follows the text font: Geist has its own mono; anything else gets JetBrains Mono.
    point("code", inPalette(/^geist$/i.test(family) ? "Geist Mono" : "JetBrains Mono"));
  }
  if (headingFont !== undefined) point("heading", headingFont === null || headingFont === "" ? "{font.body}" : inPalette(checkFamily(headingFont)));
  if (labelFont !== undefined) {
    if (!["body", "heading"].includes(labelFont)) throw new Error(`labelFont is "body" or "heading", not ${labelFont}`);
    point("label", `{font.${labelFont}}`);
  }
  return ops;
}

/**
 * Ops that point one color role at a palette step in one mode: { role: "primary", color: "blue.600", mode: "dark" }.
 * The other mode moves to the same family at the step it already uses, so the role stays one color in light and dark
 * (white, black and fixed values stay). A role with no dark value of its own follows the light one as before.
 */
export function roleColorOps(root, brand, { role, color, mode = "default" } = {}) {
  const file = brandFile(brand);
  if (!existsSync(join(root, file))) throw new Error(`no brand ${brand}`);
  const t = Object.fromEntries(colorRoles(root, brand))[role];
  if (!t) throw new Error(`no color role ${role}`);
  if (!["default", "dark"].includes(mode)) throw new Error(`no mode ${mode}`);
  const [fam, step] = String(color ?? "").replace(/^\{|\}$/g, "").replace(/^color\./, "").split(/[./-](?=[^./-]*$)/);
  const fams = families(root);
  const single = (f) => readJson(root, PRIMITIVES).color?.[f]?.$value !== undefined;
  const value = step && fams[fam]?.[step] ? `{color.${fam}.${step}}` : !step && single(fam) ? `{color.${fam}}` : null;
  if (!value) throw new Error(`no palette color ${color}`);
  const cur = { default: t.$value, dark: darkOf(t) };
  const ops = [];
  const set = (m, v) => {
    if ((m === "dark" ? cur.dark ?? cur.default : cur.default) === v) return;
    ops.push({ op: "set", file, path: `color/${role}`, ...(m === "dark" ? { mode: "dark" } : {}), value: v });
  };
  set(mode, value);
  const other = mode === "dark" ? "default" : "dark";
  const otherRef = ref(cur[other]);
  const otherFam = familyOf(otherRef);
  const otherStep = otherRef?.split(".")[2];
  if (cur[other] !== undefined && otherFam && otherStep && step && otherFam !== fam && fams[fam]?.[otherStep]) set(other, `{color.${fam}.${otherStep}}`);
  return ops;
}

const CORNER_NAMES = { square: "square", slight: "slightly rounded", round: "rounded", pill: "pill" };
/** A short title for a style change, in words the UI shows: "Main color: teal", "Corners: pill, font: Inter". */
export function styleTitle({ main, gray, corners, font, headingFont, labelFont } = {}) {
  const parts = [];
  if (main !== undefined) parts.push(`main color: ${main}`);
  if (gray !== undefined) parts.push(`grays: ${gray}`);
  if (corners !== undefined) parts.push(`corners: ${CORNER_NAMES[corners] ?? corners}`);
  if (font !== undefined) parts.push(`text font: ${font}`);
  if (headingFont !== undefined) parts.push(headingFont ? `headings: ${headingFont}` : "headings: same font as text");
  if (labelFont !== undefined) parts.push(`buttons and labels: like ${labelFont === "heading" ? "headings" : "text"}`);
  const s = parts.join(", ") || "style";
  return s[0].toUpperCase() + s.slice(1);
}
