---
name: create-design-system
description: This skill should be used when the user asks to "create a design system", "make a design system for my app", "generate design tokens from this description", "start a brand", "turn this screenshot / mood board into a design system", or describes a product and its look and wants tokens, guidelines and components. Creates a multi-brand design system (DTCG tokens, DESIGN.md, WRITING.md, base components, Storybook) through the brandloom MCP tools, with every step reviewed by the user before it is written.
version: 0.1.0
---

# Create a design system

Turn a description (and any images the user pasted) into a working design system: tokens for light and dark,
design guidelines, writing guidelines and five base components, browsable in the local UI and Storybook.

Everything goes through the brandloom MCP tools. Never edit token, guideline or component files directly, and never
write `src/styles/tokens.css` (generated).

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
2. `create_design_system` with `name`, `brand` (lowercase kebab-case id), `context`. Naming stays `shadcn` for now:
   the base components use shadcn token names.
3. `install_dependencies` (takes a few minutes; continue while it runs only if your client allows parallel calls).
4. `open_ui` and give the user the URL: this is where they review every change.

## 3. Propose the brand tokens (one change)

Read `get_tokens` first so you use the exact paths. Then `propose_change` titled e.g. "Set Acme colors and type"
with `set` ops on `brands/<brand>/tokens.json` (colors) and `tokens/base.tokens.json` (radius, fonts, shadows, motion).

How to choose values:

- Write colors as `oklch(L C H)`. Work in OKLCH so lightness is predictable: light-mode surfaces L 0.97–1,
  text L 0.15–0.25; dark-mode surfaces L 0.13–0.22, text L 0.93–0.98.
- Start from one brand hue for `primary`. Derive `accent`, `secondary`, `muted` from it (same hue, low chroma) unless
  the brief asks for a second hue. `destructive` stays red (H 25–30) in every brand.
- Every `X` has an `X-foreground` that reads on it. Aim for ≥ 4.5:1; the engine checks and can repair it.
- Set a `dark` value for every color (`mode: "dark"`). Dark mode is not inverted light mode: lower chroma, lighter
  primaries, never pure black surfaces.
- Radius from personality: crisp 0.25–0.375rem, balanced 0.5–0.625rem, friendly 0.75–1rem.
- Fonts: one family, two at most. Pick for the subject, not the default; only fonts available via Fontsource /
  Google Fonts. If you change the font, the template's `@fontsource-variable/geist` import must change too: say so.
- Avoid the generated-design defaults: warm cream background with terracotta accent; near-black with one acid
  accent; every surface the same radius and the same grey shadow. Use one only if the brief asks for it.

Tell the user to review it in the UI (Changes tab) and call `apply_change` only after they approve. If the preview
shows contrast failures, `propose_contrast_fixes` after applying, or adjust values and propose again.

## 4. Propose the guidelines (one change)

`write` ops for:

- `brands/<brand>/DESIGN.md`: sections in this order, only those with real content — `## Overview` (personality, the
  one thing that makes this brand recognisable), `## Colors` (role of each color, when to use primary),
  `## Typography`, `## Shapes`, `## Do's and Don'ts` (brand-specific, at most 6 items).
- `DESIGN.md` (shared): keep the template's sections; adjust `## Layout` to the context (mobile: 44px touch targets,
  bottom navigation, one column).
- `WRITING.md`: replace the voice and tone table with the brand's voice; keep the interface copy rules; add
  terminology from the brief (the product's own nouns).

Don'ts must be short, specific and checkable. Ten generic "don'ts" get ignored; three precise ones get followed.

## 5. Verify and hand over

1. `run_checks` → the gate must pass. Fix contrast with `propose_contrast_fixes`.
2. `start_storybook` → components render in every brand × mode via the toolbar.
3. Summarise for the user: the brand in two sentences, the UI link, the Storybook link, and what to do next
   ("ask for a component", "add a second brand", "publish").

## Rules

- One theme per change; small changes are easier to review and to undo.
- Never apply a change the user has not approved.
- Every value comes from the brief or from these rules; never invent brand facts (claims, numbers, names).
