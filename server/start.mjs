// The Describe step of the UI. After the first answer, one short Claude run (no tools, a cheap model) suggests the
// rest: a name, the product type, four ways it could feel, a palette, corners, a font and extra components. Then
// "Create" does what a program can at once (scaffold, palette color, style, the brief) and asks Claude in the UI
// chat, where the user can watch, to write the guidelines and any extra components. Presets live here so the UI and
// the suggestion run read the same list.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { quickClaude } from "./quick.mjs";
import * as ws from "../engine/workspace.mjs";
import { loadConfig, listBrands } from "../engine/tokens.mjs";
import { paletteColorOps } from "../engine/palette.mjs";
import { CORNERS, fontPickFor, GLASS_PRESETS, styleOps, readStyle } from "../engine/style.mjs";
import { typographyUpgrade } from "../engine/upgrade.mjs";

export const KINDS = [
  { id: "mobile-app", label: "Mobile app" },
  { id: "saas-dashboard", label: "Web app or dashboard" },
  { id: "e-commerce", label: "Online store" },
  { id: "marketing-site", label: "Marketing website" },
];
export const PALETTES = [
  { id: "teal-stone", name: "Teal and warm gray", mood: "Calm and trustworthy", main: "teal", gray: "stone" },
  { id: "blue-slate", name: "Blue and cool gray", mood: "Clear and dependable", main: "blue", gray: "slate" },
  { id: "emerald-neutral", name: "Green and gray", mood: "Fresh and natural", main: "emerald", gray: "neutral" },
  { id: "orange-stone", name: "Orange and warm gray", mood: "Energetic and friendly", main: "orange", gray: "stone" },
  { id: "violet-slate", name: "Violet and cool gray", mood: "Creative and modern", main: "violet", gray: "slate" },
  { id: "zinc-zinc", name: "Black and white", mood: "Simple and serious", main: "zinc", gray: "zinc" },
];
/** Fonts the UI offers. A serif picked in Describe becomes the headings font (text stays a sans): fontPickFor. */
export const FONTS = [
  { family: "Inter", mood: "Clean and neutral", kind: "sans" },
  { family: "Nunito", mood: "Soft and friendly", kind: "sans" },
  { family: "Space Grotesk", mood: "Modern, a bit techy", kind: "sans" },
  { family: "Geist", mood: "Crisp and technical", kind: "sans" },
  { family: "Source Serif 4", mood: "Classic and calm", kind: "serif" },
  { family: "Playfair Display", mood: "Elegant, for headings", kind: "serif" },
  { family: "Fraunces", mood: "Warm, with character", kind: "serif" },
];
export const FEELS = ["Warm and trustworthy", "Calm and professional", "Bright and playful", "Simple and focused"];
/**
 * The component catalog: every one ships with the template, ready-made, styled by tokens. `core` ones are always
 * included (the component site's sample pages use them); the others are picked, and the rest stay out of the repo.
 * Anything not here Claude writes when asked (a few minutes each).
 */
export const COMPONENTS = [
  { id: "button", name: "Button", hint: "Main actions, like Save or Pay", ready: true, core: true },
  { id: "input", name: "Text field", hint: "One line of typing, like an email", ready: true, core: true },
  { id: "label", name: "Label", hint: "The name above a field", ready: true, core: true },
  { id: "card", name: "Card", hint: "A box that groups related things", ready: true, core: true },
  { id: "badge", name: "Badge", hint: "A small tag, like “New”", ready: true, core: true },
  { id: "textarea", name: "Text box", hint: "Several lines of typing", ready: true },
  { id: "checkbox", name: "Checkbox", hint: "Tick one or more options", ready: true },
  { id: "radio-group", name: "Radio buttons", hint: "Pick exactly one option", ready: true },
  { id: "select", name: "Dropdown", hint: "Pick from a list", ready: true },
  { id: "switch", name: "Switch", hint: "Turn a setting on or off", ready: true },
  { id: "alert", name: "Alert", hint: "A message that stays on the page", ready: true },
  { id: "toast", name: "Toast", hint: "A short message that goes away", ready: true },
  { id: "tooltip", name: "Tooltip", hint: "A hint when you point at something", ready: true },
  { id: "tabs", name: "Tabs", hint: "Switch between views", ready: true },
  { id: "dialog", name: "Dialog", hint: "A window that asks for a decision", ready: true },
  { id: "separator", name: "Divider", hint: "A line between sections", ready: true },
  { id: "glass", name: "Glass", hint: "A frosted panel over photos and color", ready: true },
];
/** What each kind of product usually needs beyond the core five; the starting selection in Describe. */
export const KIND_COMPONENTS = {
  "mobile-app": ["checkbox", "switch", "alert", "toast", "tabs", "dialog"],
  "saas-dashboard": ["textarea", "checkbox", "radio-group", "select", "switch", "alert", "toast", "tooltip", "tabs", "dialog", "separator"],
  "e-commerce": ["checkbox", "radio-group", "select", "alert", "toast", "tabs", "dialog"],
  "marketing-site": ["textarea", "tabs", "dialog", "separator"],
};

/** Presets with the colors and sizes they resolve to in the template, so the UI can preview them before a workspace exists. */
export function presets() {
  const prim = JSON.parse(readFileSync(join(ws.TEMPLATE_DIR, "tokens", "primitives.tokens.json"), "utf8"));
  const c = (fam, step) => prim.color?.[fam]?.[step]?.$value ?? null;
  const r = (step) => { const v = prim.radius?.[step]?.$value; return v && typeof v === "object" ? `${v.value}${v.unit}` : null; };
  return {
    kinds: KINDS, feels: FEELS, fonts: FONTS, components: COMPONENTS, kindComponents: KIND_COMPONENTS,
    palettes: PALETTES.map((p) => ({ ...p, swatches: [c(p.main, "700"), c(p.main, "100"), c(p.gray, "50"), c(p.gray, "400"), c(p.gray, "900")], main600: c(p.main, "700") })),
    corners: Object.entries(CORNERS).map(([id, s]) => ({ id, name: { square: "Square", slight: "Slightly rounded", round: "Rounded", pill: "Pill" }[id], control: r(s.control), container: r(s.container) })),
    glass: Object.entries(GLASS_PRESETS).map(([id, recipe]) => ({ id, name: { clear: "Clear", regular: "Regular", frosted: "Frosted" }[id] ?? id, recipe })),
  };
}

const slug = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** Suggestions when Claude cannot run: a name from the first words, the first preset of everything. */
export function fallbackSuggestions(product) {
  const t = String(product ?? "").toLowerCase();
  const kind = /shop|store|sell|cart|commerce|購物|商店/.test(t) ? "e-commerce" : /dashboard|admin|internal|team|後台|管理/.test(t) ? "saas-dashboard" : /site|landing|marketing|官網|網站/.test(t) ? "marketing-site" : "mobile-app";
  return { name: null, kind, feels: FEELS, palette: PALETTES[0].id, corners: "round", font: "Inter", components: KIND_COMPONENTS[kind], question: null, answers: [], by: "fallback" };
}

const SUGGEST_PROMPT = (product) => `Suggest starting answers for a design system interview. Do not use any tools. Reply with one JSON object and nothing else.

The product, in the user's words: """${String(product).slice(0, 2000)}"""

JSON fields:
- "name": the product's name if the description gives one, else a short working name (1-2 words, e.g. "Budget" for a budgeting app)
- "kind": one of ${KINDS.map((k) => `"${k.id}"`).join(", ")}
- "feels": 4 short phrases (2-4 words, English) for how it could feel, best fit first
- "palette": one of ${PALETTES.map((p) => `"${p.id}" (${p.mood})`).join(", ")}
- "corners": one of "square", "slight", "round", "pill"
- "font": one of ${FONTS.map((f) => `"${f.family}" (${f.mood})`).join(", ")}
- "components": ids this product will likely need beyond button, text field, label, card and badge, from ${COMPONENTS.filter((c) => !c.core).map((c) => `"${c.id}"`).join(", ")}
- "question": null, or one short follow-up question if the description is too vague to design for
- "answers": when you ask a question, 2 or 3 likely short answers to it (a few words each), else []`;

function cleanSuggestions(raw, product) {
  const base = fallbackSuggestions(product);
  const pick = (v, list) => (list.includes(v) ? v : undefined);
  const feels = Array.isArray(raw?.feels) ? raw.feels.filter((f) => typeof f === "string" && f.trim()).map((f) => f.trim().slice(0, 40)).map((f) => f[0].toUpperCase() + f.slice(1)).slice(0, 4) : [];
  return {
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 40) : base.name,
    kind: pick(raw?.kind, KINDS.map((k) => k.id)) ?? base.kind,
    feels: feels.length >= 2 ? feels : base.feels,
    palette: pick(raw?.palette, PALETTES.map((p) => p.id)) ?? base.palette,
    corners: pick(raw?.corners, Object.keys(CORNERS)) ?? base.corners,
    font: pick(raw?.font, FONTS.map((f) => f.family)) ?? base.font,
    components: Array.isArray(raw?.components) ? raw.components.filter((c) => COMPONENTS.some((x) => x.id === c && !x.core)) : [],
    question: typeof raw?.question === "string" && raw.question.trim() ? raw.question.trim().slice(0, 200) : null,
    answers: typeof raw?.question === "string" && Array.isArray(raw?.answers) ? raw.answers.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, 3) : [],
    by: "claude",
  };
}

/** One headless run without tools that answers with JSON. Resolves to suggestions; falls back when Claude is unavailable. */
export async function suggest(ctx, product, { bin = process.env.PLINTH_CLAUDE_BIN || "claude", model = process.env.PLINTH_SUGGEST_MODEL || "haiku" } = {}) {
  const r = await quickClaude(ctx.root, SUGGEST_PROMPT(product), { bin, model });
  const json = r.text && /\{[\s\S]*\}/.exec(r.text)?.[0];
  let raw = null;
  try { raw = json ? JSON.parse(json) : null; } catch { /* not JSON: fall back */ }
  if (!raw) return { ...fallbackSuggestions(product), error: r.error ?? "Claude did not answer with suggestions", seconds: r.seconds, cost: r.cost };
  return { ...cleanSuggestions(raw, product), seconds: r.seconds, cost: r.cost, model };
}

const label = (list, id, key = "label") => list.find((x) => x.id === id)?.[key] ?? id;

/** What the user sees as their own message in the chat, and what Claude acts on. */
function setupPrompt(a, style, fresh) {
  const lines = [
    fresh ? "Set up my new design system from my answers:" : "I answered the questions again. Change my design system to match:",
    `- What it's for: ${a.product}`,
    `- How it should feel: ${a.feel || "you choose"}`,
    `- Built for: ${label(KINDS, a.kind)}`,
    `- Already applied by Plinth: main color ${style.main}, grays ${style.gray}, corners ${style.corners}, text font ${style.font}${style.headingFont ? `, headings font ${style.headingFont}` : ""}.`,
  ];
  if (a.palette === "claude") lines.push("- Colors: I let you choose. If another main color or gray fits better, change it with set_style.");
  if (a.corners === "claude") lines.push("- Corners: I let you choose; change them with set_style if another preset fits better.");
  if (a.font === "claude") lines.push("- Fonts: I let you choose; change them with set_style (font, headingFont, labelFont) if others fit better.");
  lines.push("", "Please:", `1. ${fresh ? "Write" : "Rewrite"} the brand's DESIGN.md and the shared WRITING.md for this product and feel. Keep the applied style unless it contradicts the feel.`);
  if (a.extraText?.trim()) lines.push(`2. The ready-made components I picked are already there. Also add this, which the catalog doesn't have, as a component the Plinth way (component tokens, a story, a spec): ${a.extraText.trim()}`);
  lines.push(fresh ? "Don't save a version: Plinth saves it when you're done." : "Don't save a version: I'll decide when.");
  return lines.join("\n");
}

/**
 * Creating (or re-answering) the design system. State is polled by the UI: { running, fresh, steps[], error, … }.
 * Steps: scaffold and style (instant, the engine), the guidelines and extra components (Claude, in the chat),
 * dependencies (npm, in the background; the preview needs them, the next step does not wait).
 */
export function createSetup(ctx, { bump = () => {} } = {}) {
  let cur = null;
  const step = (id, label, who, status = "waiting") => ({ id, label, who, status });
  const set = (id, status, detail) => { const s = cur.steps.find((x) => x.id === id); if (s) { s.status = status; if (detail) s.detail = detail; } bump(); };
  return {
    state() { return cur; },
    /** Checks the answers and returns at once (a second click while it runs is not an error); the work runs after. */
    start(a) {
      if (cur?.running) return Promise.resolve(cur);
      const product = String(a?.product ?? "").trim();
      if (!product) throw new Error("Say what you're making first.");
      const exists = existsSync(join(ctx.root, "design-system.json"));
      const picked = (a.components ?? []).filter((id) => COMPONENTS.some((c) => c.id === id && !c.core));
      const skipComponents = COMPONENTS.filter((c) => !c.core && !picked.includes(c.id)).map((c) => c.id);
      const custom = a.extraText?.trim() ? 1 : 0;
      cur = {
        running: true, fresh: !exists, startedAt: new Date().toISOString(), finishedAt: null, error: null, cost: null,
        steps: [
          step("scaffold", exists ? "Keeping your components and history" : "Setting up your design system", "Automatic"),
          step("style", "Applying your colors, corners and font", "Automatic"),
          step("claude", custom ? "Writing your style guide and your new component" : "Writing your style guide", "Claude"),
          step("deps", "Installing the preview and tests", "Automatic"),
        ],
      };
      bump();
      return this.run(a, { product, exists, picked, skipComponents });
    },
    async run(a, { product, exists, picked, skipComponents }) {
      // Let the request that started it answer first: scaffolding blocks for a few seconds.
      await new Promise((r) => setImmediate(r));
      try {
        const name = String(a.name ?? "").trim() || product.split(/[.,;:\n]/)[0].split(/\s+/).slice(0, 3).join(" ") || "My design system";
        if (!exists) {
          set("scaffold", "active");
          ws.initWorkspace(ctx.root, { name, brand: slug(a.brandId ?? name) || "main", context: KINDS.some((k) => k.id === a.kind) ? a.kind : "saas-dashboard", skipComponents });
        } else {
          // Answering again adds picked components that are missing; it never removes any (Remove does that).
          const have = new Set(ws.listComponents(ctx.root).map((c) => c.id));
          const add = picked.filter((id) => !have.has(id));
          // Catalog components take their text from text styles: an older design system gets them first.
          const fonts = add.length ? typographyUpgrade(ctx.root, ws.TEMPLATE_DIR) : null;
          if (fonts) ws.change(ctx.root, { title: fonts.title, ops: fonts.ops, by: "engine" });
          if (add.length) ws.change(ctx.root, { title: `Add ${add.map((id) => COMPONENTS.find((c) => c.id === id)?.name ?? id).join(", ")}`, ops: add.flatMap((id) => ws.catalogComponentOps(ctx.root, id)), by: "engine" });
        }
        set("scaffold", "done");
        set("style", "active");
        const config = loadConfig(ctx.root);
        const brand = config.defaultBrand ?? listBrands(ctx.root, config)[0];
        const preset = PALETTES.find((p) => p.id === a.palette) ?? PALETTES[0];
        let main = preset.main, gray = preset.gray;
        if (a.palette === "brand" && a.brandColor) {
          const p = paletteColorOps(ctx.root, { name: "brand", value: a.brandColor, templateDir: ws.TEMPLATE_DIR });
          ws.change(ctx.root, { title: "Add your brand color to the palette", ops: p.ops, by: "engine" });
          main = p.name; gray = "neutral";
        }
        const corners = CORNERS[a.corners] ? a.corners : "round";
        const font = FONTS.some((f) => f.family === a.font) ? a.font : "Inter";
        // A serif becomes the headings font; a sans is the text font, with headings in it too. Before font roles: one font.
        const fonts = readStyle(ctx.root, brand).fontRoles ? { headingFont: "", ...fontPickFor(font) } : { font };
        const ops = styleOps(ctx.root, brand, { main, gray, corners, ...fonts });
        const cfg = JSON.parse(readFileSync(join(ctx.root, "design-system.json"), "utf8"));
        const brief = { product, feel: a.feel ?? "", kind: a.kind, palette: a.palette, brandColor: a.palette === "brand" ? a.brandColor : undefined, corners: a.corners, font: a.font, components: picked, extraText: a.extraText?.trim() || undefined, answeredAt: new Date().toISOString() };
        cfg.brief = brief;
        if (!exists) cfg.context = KINDS.some((k) => k.id === a.kind) ? a.kind : cfg.context;
        ops.push({ op: "write", file: "design-system.json", content: JSON.stringify(cfg, null, 2) + "\n" });
        ws.change(ctx.root, { title: exists ? "Style from your new answers" : "Style from your answers", ops, by: "engine" });
        ctx.notify?.();
        set("style", "done");

        // PLINTH_NO_INSTALL: tests and CI, where npm install would only fetch the network.
        if (process.env.PLINTH_NO_INSTALL) set("deps", "waiting", "Skipped here; install from the Components step.");
        else if (!ctx.deps.installed) {
          set("deps", "active");
          ctx.deps.install().then((r) => {
            set("deps", r.installed ? "done" : "error", r.installed ? undefined : "The install failed; retry from the Components step.");
            if (r.installed) ctx.storybook.start().catch(() => {});
          });
        } else set("deps", "done");

        set("claude", "active");
        const style = readStyle(ctx.root, brand);
        const before = ctx.chat.state().messages.length;
        const { done } = await ctx.chat.send({ text: setupPrompt({ ...a, product }, style, !exists) });
        await done.catch(() => {});
        const reply = ctx.chat.state().messages.slice(before).filter((m) => m.role === "assistant").at(-1);
        if (!reply || reply.error) set("claude", "error", reply?.text ?? ctx.chat.state().error ?? "Claude did not answer.");
        else set("claude", "done");
        cur.cost = reply?.cost ?? null;
        if (!exists) { try { ws.saveVersion(ctx.root, `Style and guidelines for ${name}`); } catch { /* nothing left to save */ } }
      } catch (e) {
        cur.error = e.message;
        const active = cur.steps.find((s) => s.status === "active");
        if (active) { active.status = "error"; active.detail = e.message; }
      } finally {
        cur.running = false;
        cur.finishedAt = new Date().toISOString();
        bump();
      }
      return cur;
    },
  };
}
