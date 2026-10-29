// The shared vocabulary: components, looks, colors, fonts, corners and glass as plain-word entries, with the words
// people might type for them (aliases, English and Chinese), what picking one means (an op Plinth can apply, or a
// line that tells Claude exactly what was meant) and whether the design system already has it. The chat's "/" menu,
// the Components step's Add panel and the Style step's suggestions all read this, so the three say the same words.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as ws from "../engine/workspace.mjs";
import { loadConfig, listBrands } from "../engine/tokens.mjs";
import { fontPickFor, GLASS_PRESETS, readGlass, readStyle } from "../engine/style.mjs";
import { COMPONENTS, FONTS, presets } from "./start.mjs";

// What people call each component, besides its name.
const COMPONENT_ALIASES = {
  button: ["btn", "cta", "按鈕"],
  input: ["text field", "field", "textbox", "輸入框", "文字欄位"],
  label: ["field label", "標籤", "欄位名稱"],
  card: ["panel", "box", "tile", "卡片"],
  badge: ["tag", "chip", "status", "標籤", "徽章"],
  textarea: ["text box", "multi-line", "multiline", "文字區", "多行"],
  checkbox: ["check box", "tick", "核取方塊", "勾選"],
  "radio-group": ["radio", "radio buttons", "options", "單選"],
  select: ["dropdown", "menu", "picker", "下拉", "選單"],
  switch: ["toggle", "開關"],
  alert: ["banner", "notice", "callout", "警示", "提示"],
  toast: ["snackbar", "notification", "通知"],
  tooltip: ["hint", "hover tip", "提示框"],
  tabs: ["tab bar", "segmented", "分頁", "頁籤"],
  dialog: ["modal", "popup", "window", "對話框", "彈窗"],
  separator: ["divider", "rule", "line", "分隔線"],
  glass: ["glassmorphism", "frosted glass", "blur", "毛玻璃", "玻璃"],
  chart: ["graph", "bar chart", "line chart", "donut", "圖表"],
  progress: ["progress bar", "loading bar", "進度條"],
  slider: ["range", "滑桿"],
  "input-group": ["search field", "field with icon", "icon input", "帶圖示的輸入框", "搜尋框"],
  "button-group": ["segmented control", "split button", "按鈕群組"],
  "alert-dialog": ["confirm", "confirmation", "are you sure", "確認視窗", "確認對話框"],
  item: ["list item", "row", "list row", "列表項目", "清單"],
  breadcrumb: ["breadcrumbs", "trail", "麵包屑"],
  empty: ["empty state", "blank state", "nothing here", "空狀態"],
};

const PALETTE_ALIASES = {
  "teal-stone": ["teal", "stone", "青", "藍綠"],
  "blue-slate": ["blue", "slate", "藍"],
  "emerald-neutral": ["green", "emerald", "綠"],
  "orange-stone": ["orange", "warm", "橘", "橙"],
  "violet-slate": ["violet", "purple", "紫"],
  "zinc-zinc": ["black", "white", "mono", "monochrome", "黑白"],
};

const CORNER_NAMES = { square: "Square corners", slight: "Slightly rounded corners", round: "Rounded corners", pill: "Pill corners" };
const CORNER_HINTS = { square: "No rounding anywhere", slight: "A little rounding on buttons, more on cards", round: "Rounded buttons and fields, rounder cards", pill: "Pill-shaped buttons and fields" };
const CORNER_ALIASES = { square: ["sharp", "no radius", "直角", "方角"], slight: ["slightly rounded", "subtle", "微圓"], round: ["rounded", "圓角"], pill: ["pill", "capsule", "fully rounded", "膠囊", "全圓"] };

const GLASS_NAMES = { clear: "Clear glass", regular: "Regular glass", frosted: "Frosted glass" };
const GLASS_HINTS = { clear: "Thin tint, what is behind shows through", regular: "The default: tinted and blurred", frosted: "Strong tint and blur; text reads easily" };

/**
 * Looks: a whole style in one pick. Each is set_style arguments (palette family, gray family, corner preset, fonts)
 * and sometimes a glass preset; applying one is free and undoable like any Style pick.
 */
export const LOOKS = [
  { key: "soft-rounded", name: "Soft and rounded", hint: "Teal and warm gray, pill buttons, Nunito", aliases: ["soft", "rounded", "friendly", "圓潤", "柔和", "親切"], style: { main: "teal", gray: "stone", corners: "pill", font: "Nunito", headingFont: "" } },
  { key: "sharp-editorial", name: "Sharp and editorial", hint: "Black and white, square corners, Playfair Display headings over Inter", aliases: ["editorial", "magazine", "serif", "sharp", "雜誌", "編輯"], style: { main: "zinc", gray: "zinc", corners: "square", font: "Inter", headingFont: "Playfair Display" } },
  { key: "frosted-glass", name: "Frosted glass look", hint: "Blue and cool gray, rounded, Geist, frosted glass panels", aliases: ["glassmorphism", "glass", "blur", "毛玻璃", "玻璃風"], style: { main: "blue", gray: "slate", corners: "round", font: "Geist", headingFont: "" }, glass: "frosted" },
  { key: "neo-brutalist", name: "Neo-brutalist", hint: "Black buttons, square corners, Space Grotesk; add a loud accent color in Style", aliases: ["brutalist", "brutalism", "bold", "raw", "粗野", "新粗野"], style: { main: "zinc", gray: "neutral", corners: "square", font: "Space Grotesk", headingFont: "" } },
  { key: "quiet-technical", name: "Quiet and technical", hint: "Neutral grays, slightly rounded, Geist", aliases: ["technical", "developer", "minimal", "tool", "工程", "極簡"], style: { main: "zinc", gray: "zinc", corners: "slight", font: "Geist", headingFont: "" } },
  { key: "warm-paper", name: "Warm paper", hint: "Orange and warm gray, rounded, Source Serif 4 headings over Nunito", aliases: ["paper", "warm", "cozy", "溫暖", "紙感"], style: { main: "orange", gray: "stone", corners: "round", font: "Nunito", headingFont: "Source Serif 4" } },
  { key: "playful", name: "Playful", hint: "Rose and cool gray, pill buttons, Nunito", aliases: ["fun", "colorful", "bright", "活潑", "可愛"], style: { main: "rose", gray: "slate", corners: "pill", font: "Nunito", headingFont: "" } },
  { key: "black-white", name: "Black and white", hint: "No brand color, slightly rounded, Inter", aliases: ["monochrome", "mono", "serious", "黑白", "單色"], style: { main: "zinc", gray: "zinc", corners: "slight", font: "Inter", headingFont: "" } },
];

const lower = (list) => [...new Set(list.map((s) => String(s).toLowerCase()))];

// Swatches for any family pair from the template's palette (looks use pairs the palette presets do not offer).
let primitives = null;
function swatchesFor(main, gray) {
  primitives ??= JSON.parse(readFileSync(join(ws.TEMPLATE_DIR, "tokens", "primitives.tokens.json"), "utf8"));
  const c = (fam, step) => primitives.color?.[fam]?.[step]?.$value ?? null;
  return [c(main, "700"), c(main, "100"), c(gray, "50"), c(gray, "400"), c(gray, "900")];
}

/**
 * Every entry, for one workspace (or the template, before a design system exists):
 * { id, kind, key, name, hint, aliases, apply, inSystem, current, art }.
 * apply: what picking it does, as ops Plinth can run ({ tool, args }[]); null for a component already present.
 * art: what the UI draws beside it (swatches, corner sizes, a font family, a glass recipe).
 */
export function vocabulary(root) {
  const exists = Boolean(root && existsSync(join(root, "design-system.json")));
  const p = presets();
  let have = new Set(), style = null, glass = null;
  if (exists) {
    try {
      have = new Set(ws.listComponents(root).map((c) => c.id));
      const config = loadConfig(root);
      const brand = config.defaultBrand ?? listBrands(root, config)[0];
      style = readStyle(root, brand);
      glass = readGlass(root);
    } catch { /* an unreadable workspace reads as empty */ }
  }
  const entries = [];
  for (const c of COMPONENTS) {
    const inSystem = have.has(c.id);
    entries.push({
      id: `component:${c.id}`, kind: "component", key: c.id, name: c.name, hint: c.hint,
      aliases: lower([c.id, ...(COMPONENT_ALIASES[c.id] ?? [])]), inSystem, current: false,
      apply: inSystem || c.ready === false ? null : [{ tool: "add_component", args: { name: c.id } }], art: { glyph: c.id },
    });
  }
  for (const l of LOOKS) {
    const current = Boolean(style && style.main === l.style.main && style.gray === l.style.gray && style.corners === l.style.corners && style.font === l.style.font && (style.headingFont ?? "") === l.style.headingFont);
    entries.push({
      id: `look:${l.key}`, kind: "look", key: l.key, name: l.name, hint: l.hint, aliases: lower(l.aliases), inSystem: false, current,
      apply: [{ tool: "set_style", args: { ...l.style } }, ...(l.glass ? [{ tool: "set_glass", args: { preset: l.glass } }] : [])],
      art: { swatches: swatchesFor(l.style.main, l.style.gray), corners: p.corners.find((c) => c.id === l.style.corners)?.control ?? null, font: l.style.headingFont || l.style.font, glass: l.glass ? GLASS_PRESETS[l.glass] : null },
    });
  }
  for (const pal of p.palettes) {
    entries.push({
      id: `color:${pal.id}`, kind: "color", key: pal.id, name: pal.name, hint: pal.mood, aliases: lower([pal.main, pal.gray, ...(PALETTE_ALIASES[pal.id] ?? [])]),
      inSystem: false, current: Boolean(style && style.main === pal.main && style.gray === pal.gray),
      apply: [{ tool: "set_style", args: { main: pal.main, gray: pal.gray } }], art: { swatches: pal.swatches },
    });
  }
  for (const f of FONTS) {
    const pick = fontPickFor(f.family);
    const current = Boolean(style && (pick.font ? style.font === f.family : style.headingFont === f.family));
    entries.push({
      id: `font:${f.family.toLowerCase().replace(/\s+/g, "-")}`, kind: "font", key: f.family, name: f.family, hint: `${f.mood}${pick.headingFont ? " (for headings)" : ""}`,
      aliases: lower([f.kind, f.kind === "serif" ? "serif" : "sans-serif", "font", "字型", "字體"]), inSystem: false, current,
      apply: [{ tool: "set_style", args: pick }], art: { font: f.family, kind: f.kind },
    });
  }
  for (const c of p.corners) {
    entries.push({
      id: `corners:${c.id}`, kind: "corners", key: c.id, name: CORNER_NAMES[c.id] ?? c.name, hint: CORNER_HINTS[c.id] ?? "", aliases: lower([c.id, "corners", "radius", "圓角", ...(CORNER_ALIASES[c.id] ?? [])]),
      inSystem: false, current: Boolean(style && style.corners === c.id),
      apply: [{ tool: "set_style", args: { corners: c.id } }], art: { corners: c.control, container: c.container },
    });
  }
  for (const [id, recipe] of Object.entries(GLASS_PRESETS)) {
    const current = Boolean(glass?.recipe && Object.entries(recipe).every(([k, v]) => glass.recipe[k] === v));
    entries.push({
      id: `glass:${id}`, kind: "glass", key: id, name: GLASS_NAMES[id] ?? id, hint: GLASS_HINTS[id] ?? "", aliases: lower([id, "glass", "blur", "frosted", "玻璃", "毛玻璃"]),
      inSystem: false, current, apply: [{ tool: "set_glass", args: { preset: id } }], art: { glass: recipe },
    });
  }
  return entries;
}

const KIND_LABEL = { component: "Component", look: "Look", color: "Palette", font: "Font", corners: "Corners", glass: "Glass" };

/** One line for Claude about a picked entry: what it is, where it lives, and the exact ops that apply it. */
export function describeMention(entry) {
  const ops = (entry.apply ?? []).map((a) => `${a.tool} ${JSON.stringify(a.args)}`).join(", then ");
  if (entry.kind === "component") {
    return entry.inSystem
      ? `${KIND_LABEL.component} "${entry.name}" (${entry.key}): already in this design system at src/components/${entry.key} with tokens in tokens/components/${entry.key}.tokens.json.`
      : entry.apply
        ? `${KIND_LABEL.component} "${entry.name}" (${entry.key}): not in this design system yet; add it with ${ops} (ready-made, free).`
        : `${KIND_LABEL.component} "${entry.name}" (${entry.key}): not in this design system and not in the catalog; write it if asked.`;
  }
  return `${KIND_LABEL[entry.kind] ?? entry.kind} "${entry.name}": ${entry.hint}. ${entry.current ? "Already the current setting. " : ""}Apply with ${ops}.`;
}

/**
 * The block appended to a chat prompt for the entries the user picked from the menu (unknown ids are dropped).
 * Returns { block, mentions } where mentions are the entries as the UI shows them.
 */
export function mentionBlock(root, ids) {
  const wanted = new Set((Array.isArray(ids) ? ids : []).map(String).slice(0, 12));
  if (!wanted.size) return { block: "", mentions: [] };
  const picked = vocabulary(root).filter((e) => wanted.has(e.id));
  if (!picked.length) return { block: "", mentions: [] };
  const block = "\n\n" + ["Picked from Plinth's menu (exact names and ids; prefer these over guessing from the words above):", ...picked.map((e) => `- ${describeMention(e)}`)].join("\n");
  return { block, mentions: picked.map((e) => ({ id: e.id, kind: e.kind, name: e.name })) };
}
