---
name: create-design-system
description: "This skill should be used when the user asks to \"create a design system\", \"make a design system for my app\", \"generate design tokens from this description\", \"start a brand\", \"turn this screenshot / mood board into a design system\", or describes a product and its look and wants tokens, guidelines and components. Creates a multi-brand design system (DTCG tokens, DESIGN.md, WRITING.md, base components, Storybook) through the Plinth MCP tools. Each step is written at once and shows up in the UI; the user can undo it and decides when to save a version."
version: 0.3.0
---

# Create a design system

Turn a description (and any images the user attached) into a working design system: tokens for light and dark,
design guidelines, writing guidelines and five base components, browsable in the Plinth UI and Storybook.

Everything goes through the Plinth MCP tools: each change is validated, written at once and undoable. Never write
`src/styles/tokens.css` or `src/styles/fonts.css` (generated).

## 1. Understand the brief

Extract, from the text and images:

- **Product and audience**: what it is, who uses it, the one job of the main screen.
- **Context**: `mobile-app`, `saas-dashboard`, `e-commerce` or `marketing-site`. Ask only if it cannot be inferred.
- **Personality**: 3 adjectives the user would agree with (e.g. warm, trustworthy, calm).
- **Constraints**: existing brand colors or fonts, accessibility needs, things the user dislikes.
- **From images**: read colors as approximate values, note typography style (geometric, humanist, serif), density,
  corner style, use of shadow. Images are references, not specs: never copy logos, trademarks or a brand's identity.

State the brief back in 4–6 lines and continue unless the user corrects it.

## 2. Scaffold

1. `status` — if a design system already exists, switch to the change-design-system skill instead.
2. `create_design_system` with `name`, `brand` (lowercase kebab-case id), `context`.
3. `install_dependencies` (a few minutes; the UI shows progress). Continue with step 3 while it runs if your
   client allows parallel calls; otherwise call it after the first change.
4. `open_ui` and give the user the URL if they are not already in the UI.

## 3. The brand tokens (one change)

The tokens come in layers (`status` → `layers`): the **palette** (`tokens/primitives.tokens.json`, Tailwind's colors,
radius and shadow scales), semantic **roles** (`brands/<brand>/tokens.json`, `tokens/base.tokens.json`) that point at
the palette, and **component tokens** (`tokens/components/*.tokens.json`) that point at roles. Read `get_tokens` first
so you use the exact paths.

1. If the brand needs a hue Tailwind does not have, or a specific brand color, add it to the palette first:
   `add_palette_color` with a name (`lacquer-red`) and the color; the engine generates its 50–950 scale.
2. Then `change` titled e.g. "Set Acme colors and type" with `set` ops on `brands/<brand>/tokens.json`
   (roles) and `tokens/base.tokens.json` (radius roles, fonts, shadows, motion).

How to choose values:

- A role's value is a palette reference, e.g. `{color.red.700}` or `{color.lacquer-red.600}`, with `mode: "dark"` for
  the dark value. Not a fixed oklch value: a fixed value is flagged as not on the palette.
- Lightness guide (Tailwind steps): light-mode surfaces white / 50–100, text 900–950; dark-mode surfaces 900–950,
  text 50–200; primaries 600–700 in light mode, 300–400 in dark mode.
- Start from one brand hue for `primary`. Derive `accent`, `secondary`, `muted` from a near-grey family (`stone`,
  `zinc`, `neutral` …) or light steps of the brand hue. `destructive` stays red in every brand.
- Status colors exist in the template: `success` (green), `warning` (amber), `info` (blue), each with a `-foreground`.
  Tune their chroma and lightness to the brand; keep their hue families so they stay distinguishable from `primary`
  and from each other (the engine checks this: see `lookAlike` in the change's reminders).
- Every `X` has an `X-foreground` that reads on it. Aim for ≥ 4.5:1; the engine checks and can repair it.
- Set a `dark` value for every color (`mode: "dark"`). Dark mode is not inverted light mode: lower chroma, lighter
  primaries, never pure black surfaces.
- Radius from personality, through the radius roles in `tokens/base.tokens.json` (`radius/control`,
  `radius/container`, `radius/pill`): crisp `{radius.sm}`–`{radius.md}`, balanced `{radius.lg}`, friendly
  `{radius.xl}`–`{radius.2xl}`.
- Component tokens already point at the roles; change them only when one component should differ.
- Fonts: one family, two at most, chosen for the subject. Any Google Fonts family works: set `font/sans` and the
  `fontFamily` of `typography/*` to its name (e.g. `["Inter", "sans-serif"]`); the engine generates the loader.
  Families not on Google Fonts (system fonts) are fine too; anything else will not load.
- Avoid the generated-design defaults: warm cream background with terracotta accent; near-black with one acid
  accent; every surface the same radius and the same grey shadow. Use one only if the brief asks for it.

Read the change's reminders: `contrastFailing`, `lookAlike` (look-alike roles) and `guidelineNotes` (guideline
prose that still names an old hue). These are reminders, not blockers: fix them in a follow-up change (contrast: move
the role to a darker or lighter step of the same hue, or `fix_contrast`) and tell the user.

## 4. The guidelines (one change)

`write` ops for:

- `brands/<brand>/DESIGN.md`: sections in this order, only those with real content — `## Overview` (personality, the
  one thing that makes this brand recognisable), `## Colors` (role of each color, when to use primary, what the
  status colors mean here), `## Typography`, `## Shapes`, `## Do's and Don'ts` (brand-specific, at most 6 items).
- `DESIGN.md` (shared): keep the template's sections; adjust `## Layout` to the context (mobile: 44px touch targets,
  bottom navigation, one column).
- `WRITING.md`: replace the voice and tone table with the brand's voice; keep the interface copy rules; add
  terminology from the brief (the product's own nouns).

Name hues the way the tokens have them (a blue primary is "blue", not "ocean"): the engine compares prose with
token hues when colors change later. Don'ts must be short, specific and checkable.

## 5. Verify and hand over

1. `run_checks` → no broken references. Fix contrast with `fix_contrast`; fix look-alike roles by moving one of
   them; the user can also accept an exception in the Checks tab.
2. Once dependencies are installed: `run_tests` (types, interaction and accessibility for every story) and
   `start_storybook` (components render in every brand × mode via the toolbar and the Components tab).
3. Summarise for the user: the brand in two sentences, where to look in the UI, and what to do next
   ("ask for a component", "add a second brand", "press Save version, then Publish"). Do not save a version yourself.

## Rules

- One theme per change; small changes are easier to follow and to undo.
- Never save a version or publish unless the user asks.
- Every value comes from the brief or from these rules; never invent brand facts (claims, numbers, names).
