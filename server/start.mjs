// The Describe step of the UI. After the first answer, one short Claude run (no tools, a cheap model) suggests the
// rest: a name, the product type, four ways it could feel, a palette, corners, a font and extra components. Then
// "Create" does what a program can at once (scaffold, palette color, style, the brief) and asks Claude in the UI
// chat, where the user can watch, to write the guidelines and any extra components. Presets live here so the UI and
// the suggestion run read the same list.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import * as ws from "../engine/workspace.mjs";
import { loadConfig, listBrands } from "../engine/tokens.mjs";
import { paletteColorOps } from "../engine/palette.mjs";
import { CORNERS, styleOps, readStyle } from "../engine/style.mjs";

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
export const FONTS = [
  { family: "Inter", mood: "Clean and neutral" },
  { family: "Nunito", mood: "Soft and friendly" },
  { family: "Space Grotesk", mood: "Modern, a bit techy" },
  { family: "Source Serif 4", mood: "Classic and calm" },
  { family: "Geist", mood: "Crisp and technical" },
];
export const FEELS = ["Warm and trustworthy", "Calm and professional", "Bright and playful", "Simple and focused"];
/** Ready-made components ship with the template; the others Claude writes when asked (a few minutes each). */
export const COMPONENTS = [
  { id: "button", name: "Button", hint: "Main actions, like Save or Pay", ready: true },
  { id: "input", name: "Text field", hint: "One line of typing, like an email", ready: true },
  { id: "label", name: "Label", hint: "The name above a field", ready: true },
  { id: "card", name: "Card", hint: "A box that groups related things", ready: true },
  { id: "badge", name: "Badge", hint: "A small tag, like “New”", ready: true },
  { id: "textarea", name: "Text box", hint: "Several lines of typing" },
  { id: "checkbox", name: "Checkbox", hint: "Tick one or more options" },
  { id: "radio-group", name: "Radio buttons", hint: "Pick exactly one option" },
  { id: "select", name: "Dropdown", hint: "Pick from a list" },
  { id: "switch", name: "Switch", hint: "Turn a setting on or off" },
  { id: "alert", name: "Alert", hint: "A message that stays on the page" },
  { id: "toast", name: "Toast", hint: "A short message that goes away" },
  { id: "tooltip", name: "Tooltip", hint: "A hint when you point at something" },
  { id: "tabs", name: "Tabs", hint: "Switch between views" },
  { id: "dialog", name: "Dialog", hint: "A window that asks for a decision" },
  { id: "separator", name: "Divider", hint: "A line between sections" },
];

/** Presets with the colors and sizes they resolve to in the template, so the UI can preview them before a workspace exists. */
export function presets() {
  const prim = JSON.parse(readFileSync(join(ws.TEMPLATE_DIR, "tokens", "primitives.tokens.json"), "utf8"));
  const c = (fam, step) => prim.color?.[fam]?.[step]?.$value ?? null;
  const r = (step) => { const v = prim.radius?.[step]?.$value; return v && typeof v === "object" ? `${v.value}${v.unit}` : null; };
  return {
    kinds: KINDS, feels: FEELS, fonts: FONTS, components: COMPONENTS,
    palettes: PALETTES.map((p) => ({ ...p, swatches: [c(p.main, "700"), c(p.main, "100"), c(p.gray, "50"), c(p.gray, "400"), c(p.gray, "900")], main600: c(p.main, "700") })),
    corners: Object.entries(CORNERS).map(([id, s]) => ({ id, name: { square: "Square", slight: "Slightly rounded", round: "Rounded", pill: "Pill" }[id], control: r(s.control), container: r(s.container) })),
  };
}

const slug = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** Suggestions when Claude cannot run: a name from the first words, the first preset of everything. */
export function fallbackSuggestions(product) {
  const t = String(product ?? "").toLowerCase();
  const kind = /shop|store|sell|cart|commerce|購物|商店/.test(t) ? "e-commerce" : /dashboard|admin|internal|team|後台|管理/.test(t) ? "saas-dashboard" : /site|landing|marketing|官網|網站/.test(t) ? "marketing-site" : "mobile-app";
  return { name: null, kind, feels: FEELS, palette: PALETTES[0].id, corners: "round", font: "Inter", components: [], question: null, by: "fallback" };
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
- "components": ids this product will likely need beyond button, text field, label, card and badge, at most 4, from ${COMPONENTS.filter((c) => !c.ready).map((c) => `"${c.id}"`).join(", ")}
- "question": null, or one short follow-up question if the description is too vague to design for`;

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
    components: Array.isArray(raw?.components) ? raw.components.filter((c) => COMPONENTS.some((x) => x.id === c && !x.ready)).slice(0, 4) : [],
    question: typeof raw?.question === "string" && raw.question.trim() ? raw.question.trim().slice(0, 200) : null,
    by: "claude",
  };
}

/** One headless run without tools that answers with JSON. Resolves to suggestions; falls back when Claude is unavailable. */
export function suggest(ctx, product, { bin = process.env.PLINTH_CLAUDE_BIN || "claude", model = process.env.PLINTH_SUGGEST_MODEL || "haiku" } = {}) {
  const started = Date.now();
  return new Promise((resolveP) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const [cmd, pre] = /\.(mjs|cjs|js)$/i.test(bin) ? [process.execPath, [bin]] : [bin, []];
    let proc;
    try {
      proc = spawn(cmd, [...pre, "-p", "--output-format", "stream-json", "--verbose", "--model", model,
        "--disallowedTools", "Read", "Glob", "Grep", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", "WebSearch", "Task"],
        { cwd: ctx.root, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) { resolveP({ ...fallbackSuggestions(product), error: e.message }); return; }
    let text = null, cost = null, failed = null;
    const timer = setTimeout(() => { failed = "timed out"; proc.kill(); }, 90_000);
    proc.stdin.end(SUGGEST_PROMPT(product));
    createInterface({ input: proc.stdout }).on("line", (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.type === "result") { cost = msg.total_cost_usd ?? null; if (msg.is_error) failed = msg.result || "error"; else text = msg.result ?? ""; }
    });
    const done = () => {
      clearTimeout(timer);
      const seconds = Math.round((Date.now() - started) / 100) / 10;
      const json = text && /\{[\s\S]*\}/.exec(text)?.[0];
      let raw = null;
      try { raw = json ? JSON.parse(json) : null; } catch { /* not JSON: fall back */ }
      if (!raw) resolveP({ ...fallbackSuggestions(product), error: failed ?? "Claude did not answer with suggestions", seconds, cost });
      else resolveP({ ...cleanSuggestions(raw, product), seconds, cost, model });
    };
    proc.on("error", (e) => { failed = e.message; done(); });
    proc.on("close", done);
  });
}

const label = (list, id, key = "label") => list.find((x) => x.id === id)?.[key] ?? id;

/** What the user sees as their own message in the chat, and what Claude acts on. */
function setupPrompt(a, style, fresh) {
  const extras = (a.components ?? []).map((id) => label(COMPONENTS, id, "name"));
  const lines = [
    fresh ? "Set up my new design system from my answers:" : "I answered the questions again. Change my design system to match:",
    `- What it's for: ${a.product}`,
    `- How it should feel: ${a.feel || "you choose"}`,
    `- Built for: ${label(KINDS, a.kind)}`,
    `- Already applied by Plinth: main color ${style.main}, grays ${style.gray}, corners ${style.corners}, font ${style.font}.`,
  ];
  if (a.palette === "claude") lines.push("- Colors: I let you choose. If another main color or gray fits better, change it with set_style.");
  if (a.corners === "claude") lines.push("- Corners: I let you choose; change them with set_style if another preset fits better.");
  if (a.font === "claude") lines.push("- Font: I let you choose; change it with set_style if another family fits better.");
  lines.push("", "Please:", `1. ${fresh ? "Write" : "Rewrite"} the brand's DESIGN.md and the shared WRITING.md for this product and feel. Keep the applied style unless it contradicts the feel.`);
  if (extras.length || a.extraText?.trim()) lines.push(`2. Add ${[extras.join(", "), a.extraText?.trim()].filter(Boolean).join(", and: ")} as components the Plinth way (component tokens, a story, a spec).`);
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
    async start(a) {
      if (cur?.running) throw new Error("Already setting up. Wait for it to finish.");
      const product = String(a?.product ?? "").trim();
      if (!product) throw new Error("Say what you're making first.");
      const exists = existsSync(join(ctx.root, "design-system.json"));
      const extras = (a.components ?? []).filter((id) => COMPONENTS.some((c) => c.id === id && !c.ready));
      cur = {
        running: true, fresh: !exists, startedAt: new Date().toISOString(), finishedAt: null, error: null, cost: null,
        steps: [
          step("scaffold", exists ? "Keeping your components and history" : "Setting up your design system", "Automatic"),
          step("style", "Applying your colors, corners and font", "Automatic"),
          step("claude", extras.length || a.extraText?.trim() ? `Writing your style guide and ${extras.length + (a.extraText?.trim() ? 1 : 0)} new component${extras.length + (a.extraText?.trim() ? 1 : 0) === 1 ? "" : "s"}` : "Writing your style guide", "Claude"),
          step("deps", "Installing the preview and tests", "Automatic"),
        ],
      };
      bump();
      try {
        const name = String(a.name ?? "").trim() || product.split(/[.,;:\n]/)[0].split(/\s+/).slice(0, 3).join(" ") || "My design system";
        if (!exists) {
          set("scaffold", "active");
          ws.initWorkspace(ctx.root, { name, brand: slug(a.brandId ?? name) || "main", context: KINDS.some((k) => k.id === a.kind) ? a.kind : "saas-dashboard" });
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
        const ops = styleOps(ctx.root, brand, { main, gray, corners, font });
        const cfg = JSON.parse(readFileSync(join(ctx.root, "design-system.json"), "utf8"));
        const brief = { product, feel: a.feel ?? "", kind: a.kind, palette: a.palette, brandColor: a.palette === "brand" ? a.brandColor : undefined, corners: a.corners, font: a.font, components: extras, extraText: a.extraText?.trim() || undefined, answeredAt: new Date().toISOString() };
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
