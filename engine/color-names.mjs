// A name for a color the user adds to the palette, so they confirm a suggestion instead of inventing one. Names are
// everyday color words that are not Tailwind family names (those are already in the palette); the nearest one by
// perceived difference (OKLab ΔE) that the palette does not use yet.
import { deltaE, parseColor, rgbToOklch } from "./color.mjs";

const NAMES = {
  coral: "#ff7f50", salmon: "#fa8072", peach: "#ffcba4", apricot: "#fbceb1", tangerine: "#f28500", marigold: "#eaa221",
  mustard: "#e1ad01", honey: "#d9a441", lemon: "#fff44f", sand: "#c2b280", khaki: "#c3b091", olive: "#808000",
  moss: "#8a9a5b", sage: "#9caf88", mint: "#98ff98", jade: "#00a86b", forest: "#228b22", pine: "#01796f",
  seafoam: "#93e9be", turquoise: "#40e0d0", aqua: "#00e5ee", lagoon: "#017c8a", ocean: "#0077be", denim: "#1560bd",
  navy: "#000080", cobalt: "#0047ab", azure: "#007fff", periwinkle: "#ccccff", lavender: "#b57edc", lilac: "#c8a2c8",
  plum: "#8e4585", grape: "#6f2da8", orchid: "#da70d6", magenta: "#ff00ff", berry: "#990f4b", raspberry: "#e30b5c",
  ruby: "#e0115f", cherry: "#d2042d", crimson: "#dc143c", scarlet: "#ff2400", brick: "#b22222", rust: "#b7410e",
  terracotta: "#e2725b", copper: "#b87333", bronze: "#cd7f32", caramel: "#af6e4d", cocoa: "#875f42", chocolate: "#7b3f00",
  mocha: "#967969", espresso: "#4b3832", charcoal: "#36454f", graphite: "#41424c", ink: "#1b1b2f", pearl: "#eae0c8",
  ivory: "#fffff0", cream: "#fffdd0", blush: "#de5d83", bubblegum: "#ffc1cc", evergreen: "#1f4d3f", hunter: "#355e3b",
  petrol: "#005f6a", midnight: "#191970", wine: "#722f37", oxblood: "#4a0000", aubergine: "#3b0910", smoke: "#848884",
  pewter: "#8e9294", steel: "#71797e", fog: "#d6d6d6", dove: "#b5b5b5",
};
// Below this chroma a color reads as a gray: grays get gray names, colors get color names.
const GRAYISH = 0.035;
const chroma = (v) => rgbToOklch(parseColor(v)).c;

/** The nearest unused name for a color ("#e2725b" → "terracotta"). Palette colors are named for how they look, not their role. */
export function colorName(value, taken = []) {
  const used = new Set(taken.map((t) => String(t).toLowerCase()));
  const gray = chroma(value) < GRAYISH;
  const ranked = Object.entries(NAMES).filter(([, hex]) => (chroma(hex) < GRAYISH) === gray).map(([name, hex]) => [name, deltaE(value, hex)]).sort((a, b) => a[1] - b[1]);
  const free = ranked.find(([name]) => !used.has(name));
  if (free) return free[0];
  let n = 2;
  while (used.has(`${ranked[0][0]}-${n}`)) n++;
  return `${ranked[0][0]}-${n}`;
}
