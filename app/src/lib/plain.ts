// Plain names for what the engine calls roles, tokens and files, so the UI never has to show "primary-foreground".
// Token names still appear, small, where a designer or engineer needs them (the node graph).

const ROLE_NAMES: Record<string, [string, string]> = {
  primary: ["Main", "Buttons, links and selected things"],
  "primary-foreground": ["Text on main", "Text on main-colored buttons"],
  secondary: ["Secondary", "Quieter buttons and surfaces"],
  "secondary-foreground": ["Text on secondary", "Text on quieter buttons"],
  muted: ["Soft background", "Tinted areas and hover"],
  "muted-foreground": ["Secondary text", "Less important text"],
  accent: ["Highlight", "Hover and selected rows"],
  "accent-foreground": ["Text on highlight", "Text on highlighted rows"],
  background: ["Background", "Behind everything"],
  foreground: ["Text", "Most text"],
  card: ["Card", "Cards and panels"],
  "card-foreground": ["Text on cards", "Text inside cards"],
  popover: ["Pop-up", "Menus and pop-ups"],
  "popover-foreground": ["Text on pop-ups", "Text in menus and pop-ups"],
  destructive: ["Danger", "Errors and deleting"],
  border: ["Border", "Lines and outlines"],
  input: ["Field border", "Outlines of fields"],
  ring: ["Focus ring", "The outline when you tab to something"],
  success: ["Success", "Done, paid, saved"],
  "success-foreground": ["Text on success", "Text on success badges"],
  warning: ["Warning", "Needs attention"],
  "warning-foreground": ["Text on warning", "Text on warning badges"],
  info: ["Info", "Tips and neutral news"],
  "info-foreground": ["Text on info", "Text on info badges"],
};

const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** "primary-foreground" → "Text on main"; unknown roles become "Brand accent" from "brand-accent". */
export const roleName = (name: string) => ROLE_NAMES[name]?.[0] ?? titleCase(name);
export const roleHint = (name: string) => ROLE_NAMES[name]?.[1] ?? "Your own color";

const PART_WORDS: Record<string, string> = { "background-hover": "Background on hover", foreground: "Text", background: "Background", border: "Border", placeholder: "Hint text", radius: "Corners" };
/** "button/default/background-hover" → "Default · Background on hover"; "label/text/foreground" → "Text". */
export function partName(path: string) {
  const segs = path.split("/").slice(1);
  const last = segs.at(-1) ?? "";
  const word = PART_WORDS[last] ?? titleCase(last);
  const group = segs.slice(0, -1).filter((s) => !["container", "field", "text"].includes(s)).map(titleCase).join(" ");
  return group ? `${group} · ${word}` : word;
}
const TEXT_PARTS: Record<string, string> = { container: "Text", text: "Text", field: "What people type", file: "File button", item: "Options", "group-label": "Group names", trigger: "Trigger" };
/** A component's text part: "button/label/font" → "Label", "card/title-small/font" → "Title (small)". */
export function textPartName(path: string) {
  const part = path.split("/").slice(1, -1).join("-");
  return TEXT_PARTS[part] ?? titleCase(part.replace(/-small$/, "")) + (part.endsWith("-small") ? " (small)" : "");
}
const SIZES: Record<string, string> = { xs: "XS", sm: "S", md: "M", lg: "L", xl: "XL" };
const STYLE_WORDS: Record<string, string> = { body: "Text", heading: "Heading", label: "Label", code: "Code", display: "Display" };
/** A text style as people say it: "typography/heading/lg" → "Heading L", "typography/body/md" → "Text M". */
export function textStyleName(path: string) {
  const [kind = "", size] = path.replace(/^typography\//, "").split("/");
  const word = STYLE_WORDS[kind] ?? titleCase(kind);
  return kind === "code" ? word : size ? `${word} ${SIZES[size] ?? size.toUpperCase()}` : word;
}
/** Font roles: which font each kind of text uses. */
export const FONT_ROLE_NAMES: Record<string, string> = { heading: "Headings", body: "Text", label: "Buttons and labels", code: "Code" };

/** The variant a component token belongs to, for the graph's filter: "default", "outline" … or "" for shared ones. */
export const variantOf = (path: string) => (path.split("/").length > 2 ? path.split("/")[1] : "");

/** A palette family as people say it. */
const FAMILY: Record<string, string> = { zinc: "Black and white", neutral: "Neutral gray", slate: "Cool gray", stone: "Warm gray", gray: "Gray", mauve: "Mauve gray", olive: "Olive gray", mist: "Mist gray", taupe: "Taupe gray" };
export const familyName = (f: string) => FAMILY[f] ?? titleCase(f);
/** Palette families that come with Tailwind; anything else in the palette was added for this design system. */
export const TAILWIND_FAMILIES = new Set(["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose", "slate", "gray", "zinc", "neutral", "stone", "mauve", "olive", "mist", "taupe"]);

export const CORNER_NAMES: Record<string, string> = { square: "Square", slight: "Slightly rounded", round: "Rounded", pill: "Pill", custom: "Custom" };

/** Files Plinth regenerates from the tokens: they follow every change, so lists of changes leave them out. */
export const isGenerated = (file: string) => /^src\/(styles|foundations)\/|^exports\//.test(file);

/** A changed file as people would describe it. */
export function fileName(file: string) {
  if (/^brands\/[^/]+\/tokens\.json$/.test(file)) return "Colors";
  if (file === "tokens/base.tokens.json") return "Corners, fonts and shadows";
  if (file === "tokens/primitives.tokens.json") return "Base colors and fonts";
  let m = /^tokens\/components\/([^.]+)\.tokens\.json$/.exec(file);
  if (m) return `${titleCase(m[1])} colors and text`;
  m = /^src\/components\/([^/]+)\//.exec(file);
  if (m) return `${titleCase(m[1])} component`;
  if (/DESIGN\.md$/.test(file)) return "Style guide";
  if (/WRITING\.md$/.test(file)) return "Writing guide";
  if (file === "design-system.json") return "Settings and answers";
  if (file === "package-lock.json" || file === "package.json") return "Installed packages";
  return file;
}

export const componentLabel = (id: string, catalog?: { id: string; name: string }[]) => catalog?.find((c) => c.id === id)?.name ?? titleCase(id);
