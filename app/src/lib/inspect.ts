// What a picked element uses: the classes the Storybook picker reports (server/inspect.js) or the token names the
// Style sample lists, mapped to token rows. Theme utilities come from token names (engine/tokens.mjs themeEntries):
// bg-<color>, text-<color>, border-<color>, rounded-<radius without "radius">, type-<text token without "-font">.
import type { TokenRow } from "@/lib/api";
import type { Graph } from "@/lib/tokens";

export type Kind = "color" | "radius" | "text";
/** One thing a picked element uses: the token, what it does there, and in which state ("on hover"), if any. */
export type Pick = { row: TokenRow; prop: string; kind: Kind; state: string | null };
export type ChainLink = { slot: string | null; tag: string; classes: string };

const COLOR_PROPS: Record<string, string> = { bg: "Background", text: "Text", border: "Border", ring: "Focus ring", outline: "Outline", fill: "Icon", stroke: "Icon", placeholder: "Hint text", from: "Gradient", via: "Gradient", to: "Gradient", accent: "Accent", caret: "Cursor", decoration: "Underline", divide: "Dividers" };
const STATES: [RegExp, string][] = [
  [/^hover$/, "on hover"], [/^focus-visible$/, "with keyboard focus"], [/^focus$/, "when focused"], [/^active$/, "when pressed"],
  [/^disabled$/, "when turned off"], [/state=(active|on|open)/, "when selected"], [/state=checked/, "when checked"], [/aria-invalid/, "when invalid"],
  [/aria-selected|selected/, "when selected"], [/^placeholder$/, "hint text"], [/^dark$/, "in dark mode"],
];
const stateOf = (variants: string[]) => {
  if (!variants.length) return null;
  const v = variants.at(-1)!;
  return STATES.find(([re]) => re.test(v))?.[1] ?? v.replace(/^data-\[|\]$/g, "");
};

/** "hover:bg-x/50" → { variants: ["hover"], util: "bg-x" }; colons inside [ ] belong to the variant. */
function parse(cls: string) {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of cls) {
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === ":" && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  return { variants: parts, util: cur.replace(/^!/, "").replace(/\/[\w.[\]]+$/, "") };
}

/** Lookups from utility names to token rows. */
function lookups(g: Graph) {
  const color = new Map<string, TokenRow>(), radius = new Map<string, TokenRow>(), text = new Map<string, TokenRow>();
  for (const r of g.rows) {
    if (r.type === "color") color.set(r.name, r);
    else if (r.type === "dimension" && (/^radius/.test(r.name) || /radius$/.test(r.name))) radius.set(r.name.replace(/^radius-/, "").replace(/-radius$/, ""), r);
    else if (r.type === "typography") text.set(r.name.replace(/-font$/, ""), r);
  }
  return { color, radius, text };
}

function pickOf(util: string, maps: ReturnType<typeof lookups>): Omit<Pick, "state"> | null {
  let m = /^([a-z]+)-(.+)$/.exec(util);
  if (m && COLOR_PROPS[m[1]] && maps.color.has(m[2])) return { row: maps.color.get(m[2])!, prop: COLOR_PROPS[m[1]], kind: "color" };
  if ((m = /^border-[xytrbl]-(.+)$/.exec(util)) && maps.color.has(m[1])) return { row: maps.color.get(m[1])!, prop: "Border", kind: "color" };
  if ((m = /^rounded(?:-(?:[trbl]{1,2}|[se]{1,2}))?-(.+)$/.exec(util)) && maps.radius.has(m[1])) return { row: maps.radius.get(m[1])!, prop: "Corners", kind: "radius" };
  if ((m = /^type-(.+)$/.exec(util)) && maps.text.has(m[1])) return { row: maps.text.get(m[1])!, prop: "Text style", kind: "text" };
  return null;
}

/**
 * The tokens a picked element uses, nearest first: its own classes, then its parents' (text color and backgrounds
 * come from parents), up to the component it belongs to. The first token per property and state wins, as it does on
 * screen. Plain states first.
 */
export function picksFromChain(g: Graph, chain: ChainLink[], components: string[]): Pick[] {
  const maps = lookups(g);
  const out: Pick[] = [];
  const seen = new Set<string>();
  for (const link of chain) {
    for (const cls of link.classes.split(/\s+/).filter(Boolean)) {
      const { variants, util } = parse(cls);
      const p = pickOf(util, maps);
      if (!p) continue;
      const state = stateOf(variants);
      const key = `${p.prop}|${state ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...p, state });
    }
    if (link.slot && components.includes(link.slot)) break;
  }
  return out.sort((a, b) => Number(a.state !== null) - Number(b.state !== null));
}

/** The component a picked element belongs to: the nearest part or component named in the chain ("card-title" → card). */
export function componentOfChain(chain: ChainLink[], components: string[]) {
  for (const link of chain) {
    const slot = link.slot;
    if (!slot) continue;
    const id = components.filter((c) => slot === c || slot.startsWith(`${c}-`)).sort((a, b) => b.length - a.length)[0];
    if (id) return id;
  }
  return null;
}

/** The Style sample's elements list "Prop=token-name" pairs (data-pick); this maps them to token rows. */
export function picksFromNames(g: Graph, pairs: string): Pick[] {
  return pairs.split(/\s+/).filter(Boolean).flatMap((pair) => {
    const [prop, name] = pair.split("=");
    const row = g.byName.get(name);
    if (!row) return [];
    const kind: Kind = row.type === "color" ? "color" : row.type === "typography" ? "text" : "radius";
    return [{ row, prop: prop.replace(/_/g, " "), kind, state: null }];
  });
}
