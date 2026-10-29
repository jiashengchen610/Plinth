// The Style step of the UI: main color, grays, corners and fonts turned into change ops. A choice never changes
// what is in the palette; it re-points roles (brands/<brand>/tokens.json) at other palette steps and the shape and
// font roles (tokens/base.tokens.json) at other scale steps or fonts. A font picked for the first time joins the
// palette. Which steps keep text readable is computed here.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio } from "./color.mjs";
import { glassRecipe, listBrands, resolveBrand } from "./tokens.mjs";

const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
/** Palette families used as grays. Picking one as the main color gives a black-and-white look. */
export const GRAYS = ["slate", "gray", "zinc", "neutral", "stone", "mauve", "olive", "mist", "taupe"];
/** Corner presets: radius roles → steps of the radius scale. "round" is the template's default. */
// multiline: fields with several lines take the controls' corners, except that a pill would cut into their text.
export const CORNERS = {
  square: { control: "none", container: "none", pill: "none", small: "none", multiline: "none" },
  slight: { control: "sm", container: "md", pill: "sm", small: "xs", multiline: "sm" },
  round: { control: "lg", container: "xl", pill: "full", small: "sm", multiline: "lg" },
  pill: { control: "full", container: "2xl", pill: "full", small: "md", multiline: "2xl" },
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
  const fit = radius["fit-inside"]?.$value;
  return {
    main, gray, corners, ...fonts,
    // Outer corners (cards, dialogs, menus) and inner ones (buttons, fields) as steps of the radius scale (null when
    // not a step), and whether parts inside a container fit its corners (null: a design system from before that).
    outer: step("container") ?? null, inner: step("control") ?? null, fitInside: fit === undefined ? null : Number(fit) !== 0,
    radiusSteps: radiusSteps(root),
    glass: readGlass(root),
    hues: Object.keys(fams).filter((f) => !GRAYS.includes(f)),
    grays: Object.keys(fams).filter((f) => GRAYS.includes(f)),
  };
}

/** The radius scale in the palette, smallest first: [{ step: "none", px: 0 }, { step: "xs", px: 2 }, …]. */
export function radiusSteps(root) {
  const scale = readJson(root, PRIMITIVES).radius ?? {};
  return Object.entries(scale).filter(([k, v]) => !k.startsWith("$") && v?.$value && typeof v.$value === "object")
    .map(([step, v]) => ({ step, px: v.$value.unit === "rem" ? v.$value.value * 16 : Number(v.$value.value) }))
    .sort((a, b) => a.px - b.px);
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
export function styleOps(root, brand, { main, gray, corners, outer, inner, fitInside, font, headingFont, labelFont } = {}) {
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
  // Fine-tuning after a preset: outer corners (cards, dialogs, menus) and inner ones (buttons, fields) separately.
  // Multi-line fields follow the inner corners, unless those are a pill.
  const multiline = inner !== undefined && inner !== "full" && (readJson(root, BASE).radius ?? {}).multiline ? inner : undefined;
  for (const [role, s] of [["container", outer], ["control", inner], ["multiline", multiline]]) {
    if (s === undefined) continue;
    if (!radiusSteps(root).some((x) => x.step === s)) throw new Error(`no radius step ${s}`);
    const radius = readJson(root, BASE).radius ?? {};
    // This setting replaces the preset's for the same role (one op per role); none when the file already has it.
    const i = ops.findIndex((o) => o.path === `radius/${role}`);
    if (i >= 0) ops.splice(i, 1);
    if (ref(radius[role]?.$value) !== `radius.${s}`) ops.push({ op: "set", file: BASE, path: `radius/${role}`, value: `{radius.${s}}` });
  }
  if (fitInside !== undefined) {
    const cur = (readJson(root, BASE).radius ?? {})["fit-inside"];
    if (!cur || (Number(cur.$value) !== 0) !== Boolean(fitInside)) ops.push({ op: "set", file: BASE, path: "radius/fit-inside", type: "number", value: fitInside ? 1 : 0, ...(cur ? {} : { description: FIT_DESCRIPTION }) });
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
 * added: a palette color being added in the same change ({ name, shades }), so the role can point at it already;
 * node: the role's values when it is being made in the same change.
 */
export function roleColorOps(root, brand, { role, color, mode = "default", added, node } = {}) {
  const file = brandFile(brand);
  if (!existsSync(join(root, file))) throw new Error(`no brand ${brand}`);
  const t = node ?? Object.fromEntries(colorRoles(root, brand))[role];
  if (!t) throw new Error(`no color role ${role}`);
  if (!["default", "dark"].includes(mode)) throw new Error(`no mode ${mode}`);
  const [fam, step] = String(color ?? "").replace(/^\{|\}$/g, "").replace(/^color\./, "").split(/[./-](?=[^./-]*$)/);
  const fams = { ...families(root), ...(added ? { [added.name]: added.shades } : {}) };
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

/**
 * The name a part's own color gets: the old color plus the component ("primary-button"), or the component plus what
 * the part is when the color is already named after the component ("card-background", not "card-card").
 * The UI drafts the same name (app/src/views/EditPanel.tsx).
 */
export function newColorName(old, part) {
  const segs = part.split("/");
  const component = segs[0];
  return old === component || old.startsWith(`${component}-`) ? `${component}-${segs.at(-1)}` : `${old}-${component}`;
}

/** Which of the brand's colors a component part uses in a mode, from its token: "card" for {color.card}; else null. */
export function partRole(root, brand, part, mode = "default") {
  const t = resolveBrand(root, brand).tokens.find((x) => x.key === part);
  if (!t) throw new Error(`no token ${part}`);
  if (t.type !== "color") throw new Error(`${part} is not a color`);
  const role = ref((t.values[mode] ?? t.values.default)?.raw)?.replace(/^color\./, "") ?? null;
  return role && Object.fromEntries(colorRoles(root, brand))[role] ? role : null;
}

/**
 * Ops that change the color of one component part ("button/default/background") in one mode, the way the UI's edit
 * panel does. scope "role": the color the part uses changes, in every component that uses it (roleColorOps). scope
 * "part": only this part changes: a new color (named `name`, else the old color's name plus the component's) is made
 * in every brand as a copy of the old one, set to `color` in this brand and mode, and the part points at it.
 * color: a palette step ("violet.600"); added: a palette color being added in the same change ({ name, shades }).
 * @returns {{ ops: object[], role: string, made: boolean }} role: the color the part uses afterwards.
 */
export function partColorOps(root, brand, { part, color, mode = "default", scope = "role", name, added } = {}) {
  const old = partRole(root, brand, part, mode);
  if (!old) throw new Error(`${part} does not use one of your colors in ${mode === "dark" ? "dark" : "light"} mode`);
  if (scope === "role") return { ops: roleColorOps(root, brand, { role: old, color, mode, added }), role: old, made: false };
  if (scope !== "part") throw new Error(`no scope ${scope}`);
  const brands = listBrands(root);
  const taken = new Set([...brands.flatMap((b) => colorRoles(root, b).map(([k]) => k)), ...resolveBrand(root, brand).tokens.map((t) => t.name)]);
  const asked = String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (asked && taken.has(asked)) throw new Error(`${asked} is already a color or token name`);
  const draft = newColorName(old, part);
  let fresh = asked || draft;
  for (let i = 2; taken.has(fresh); i++) fresh = `${draft}-${i}`;
  const ops = [];
  const mine = Object.fromEntries(colorRoles(root, brand))[old];
  for (const b of brands) {
    // A brand without the old color gets this brand's, so the part never points at nothing.
    const node = Object.fromEntries(colorRoles(root, b))[old] ?? mine;
    ops.push({ op: "set", file: brandFile(b), path: `color/${fresh}`, type: "color", value: node.$value, description: `${part.replaceAll("/", " ")} only (made from ${old})` });
    if (darkOf(node) !== undefined) ops.push({ op: "set", file: brandFile(b), path: `color/${fresh}`, mode: "dark", value: darkOf(node) });
  }
  ops.push(...roleColorOps(root, brand, { role: fresh, color, mode, added, node: mine }));
  // The part points at the new color in the mode changed, and in the other mode too while it uses the old one there.
  const file = resolveBrand(root, brand).tokens.find((x) => x.key === part).source;
  const own = part.split("/").reduce((n, k) => n?.[k], readJson(root, file));
  const v = `{color.${fresh}}`, was = `{color.${old}}`;
  // In dark mode only the dark value moves (light keeps the old color).
  ops.push({ op: "set", file, path: part, ...(mode === "dark" ? { mode: "dark" } : {}), value: v });
  if (mode === "default" && darkOf(own) === was) ops.push({ op: "set", file, path: part, mode: "dark", value: v });
  return { ops, role: fresh, made: true };
}

// ---------------- glass ----------------
const MATERIAL_GLASS = "material/glass";
/** Glass presets the tuning tool starts from; the user adjusts from there. */
export const GLASS_PRESETS = {
  clear: { tintOpacity: 0.45, blur: 10, saturation: 1.8, highlight: 0.8, distortion: 0 },
  regular: { tintOpacity: 0.7, blur: 16, saturation: 1.6, highlight: 0.6, distortion: 0 },
  frosted: { tintOpacity: 0.82, blur: 28, saturation: 1.3, highlight: 0.4, distortion: 0 },
};

/** The glass as stored: { tint: role, foreground: role, recipe }, or null when the design system has none yet. */
export function readGlass(root) {
  const m = readJson(root, BASE).material ?? {};
  if (!m.glass) return null;
  const role = (v) => ref(v)?.replace(/^color\./, "") ?? null;
  return { tint: role(m.glass.$value), foreground: role(m["glass-foreground"]?.$value), recipe: glassRecipe(m.glass.$extensions?.plinth?.glass) };
}

/**
 * Ops for the glass: { tint: a color role, tintOpacity, blur, saturation, highlight, distortion }, any subset. Text
 * on glass follows the tint (its -foreground role, or foreground for background). Creates the material when missing.
 */
export function glassOps(root, brand, change = {}) {
  const roles = Object.fromEntries(colorRoles(root, brand));
  const cur = readGlass(root);
  const tint = change.tint ?? cur?.tint ?? "popover";
  if (!roles[tint]) throw new Error(`no color role ${tint}`);
  const foreground = roles[`${tint}-foreground`] ? `${tint}-foreground` : tint === "background" ? "foreground" : cur?.foreground ?? "foreground";
  const recipe = glassRecipe({ ...(cur?.recipe ?? GLASS_PRESETS.regular), ...Object.fromEntries(Object.entries(change).filter(([k]) => k !== "tint")) });
  const ops = [];
  if (!cur || cur.tint !== tint || JSON.stringify(cur.recipe) !== JSON.stringify(recipe)) {
    ops.push({ op: "set", file: BASE, path: MATERIAL_GLASS, type: "color", value: `{color.${tint}}`, glass: recipe, ...(cur ? {} : { description: "Glass: the color it tints what is behind it with, and shows solid where the browser cannot blur or the system asks for less transparency" }) });
  }
  if (!cur || cur.foreground !== foreground) ops.push({ op: "set", file: BASE, path: `${MATERIAL_GLASS}-foreground`, type: "color", value: `{color.${foreground}}`, ...(cur ? {} : { description: "Text on glass" }) });
  return ops;
}

export const FIT_DESCRIPTION ="1: parts inside a rounded container (tabs in the tab bar, options in a menu, close buttons in a corner) take its corners minus the gap, so the space between stays even. 0: they keep their own corners.";

const CORNER_NAMES = { square: "square", slight: "slightly rounded", round: "rounded", pill: "pill" };
/** A short title for a style change, in words the UI shows: "Main color: teal", "Corners: pill, font: Inter". */
export function styleTitle({ main, gray, corners, outer, inner, fitInside, font, headingFont, labelFont } = {}) {
  const parts = [];
  if (main !== undefined) parts.push(`main color: ${main}`);
  if (gray !== undefined) parts.push(`grays: ${gray}`);
  if (corners !== undefined) parts.push(`corners: ${CORNER_NAMES[corners] ?? corners}`);
  if (outer !== undefined) parts.push(`outer corners: ${outer}`);
  if (inner !== undefined) parts.push(`inner corners: ${inner}`);
  if (fitInside !== undefined) parts.push(fitInside ? "parts inside fit their container" : "parts inside keep their own corners");
  if (font !== undefined) parts.push(`text font: ${font}`);
  if (headingFont !== undefined) parts.push(headingFont ? `headings: ${headingFont}` : "headings: same font as text");
  if (labelFont !== undefined) parts.push(`buttons and labels: like ${labelFont === "heading" ? "headings" : "text"}`);
  const s = parts.join(", ") || "style";
  return s[0].toUpperCase() + s.slice(1);
}
