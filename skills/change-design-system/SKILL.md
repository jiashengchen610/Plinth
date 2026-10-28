---
name: change-design-system
description: "This skill should be used when the user asks to change an existing design system: \"make the primary warmer\", \"rounder corners\", \"rename this token\", \"use Inter\", \"add a dark mode tweak\", \"add a second brand\", \"update our writing guidelines\", \"fix the contrast\", \"these two colors look the same\", \"undo the last change\", \"go back to yesterday's version\". Makes each change at once through the Plinth MCP tools, after reading the guidelines; the user can undo it and decides when to save a version."
version: 0.3.1
---

# Change a design system

Every change follows the same loop: read → change → tell the user what happened. A change is written at once (the
engine validates it first, and the user sees it in the UI immediately); Undo takes it back. The user decides when to
save a version and when to publish.

## Read first

- `status` for brands, unsaved changes, the last change and the checks.
- `get_tokens` (per brand) for exact token paths and current values.
- `get_guidelines` before changing anything visual or any copy, and keep the change consistent with them. When a
  color changes hue, note the sentences that describe it: they change in the same change.

## Change

Use `change` with a short imperative `title` (shown in the UI and on the Undo button).

| Request | Ops |
|---|---|
| Change a role (primary, muted …) | `set` it to another palette step, e.g. `{color.red.800}`; add `mode: "dark"` for the dark value. Change both modes unless asked otherwise. |
| A color that is not in the palette | `add_palette_color` (name + color → a 50–950 scale), then point roles at it |
| Change one component only | `set` its component token in `tokens/components/<component>.tokens.json` (e.g. `button/default/background` → `{color.accent}`); opacity with `alpha` |
| One part's color, when other parts share its color | ask the user: only this part or everywhere? Then `set_part_color` with `scope: "part"` (a new color of its own, copied into every brand) or `scope: "role"`; any CSS color joins the palette in the same change |
| Change every component that uses a role | change the role, not the component tokens |
| A new layer between two others | `write` `tokens/layers/<id>.tokens.json` and `design-system.json` with the layer inserted in `layers`; tokens should point at their own layer or lower ones |
| Old design system without layers | `upgrade_to_layers`; afterwards `link_to_palette` points fixed colors at the matching palette step |
| New role | `set` with `type` (and `description`), in **every** brand file: brands must define the same token names. Semantic names follow shadcn (`X` + `X-foreground`). |
| Rename / regroup | `rename` with `path` and `to`. Aliases in token files and utilities in components (`bg-old` → `bg-new`) are rewritten; the result lists every file touched. |
| Remove | `delete`; first check no component or alias uses it. |
| Change a font | `set` `font/sans` and the `fontFamily` of each `typography/*` token to the Google Fonts family name. The loader (`src/styles/fonts.css`) regenerates; nothing else to do. |
| Guidelines | `write` the whole file (`DESIGN.md`, `brands/<id>/DESIGN.md`, `WRITING.md`). Keep sections in DESIGN.md order: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts. |
| New brand | `write` `brands/<id>/tokens.json` (copy an existing brand's structure: every token name, both modes), `write` `brands/<id>/DESIGN.md`, and `write` `design-system.json` with the brand appended to `brands`. |
| Fix contrast | `fix_contrast` (deterministic: a role on the palette moves to another step of the same hue; a fixed value keeps its hue and moves its lightness; the palette itself is never edited). |
| Two roles look alike | Decide with the user which role moves (usually the status color returns to its hue family: destructive red, success green, warning amber, info blue), then `set` it. |

Ask before deleting or renaming tokens or components, or restoring a version; make everything else directly.

Nothing is written when an op is invalid or the change would break a token reference: fix the ops and try again.
Read the result's `reminders` before answering; none of them stopped the change:

- `contrastFailing`: say which pairs now fail and fix them in a follow-up change (`fix_contrast`, or another step),
  unless the user asked for exactly that.
- `lookAlike`: two role colors look alike; adjust one, or explain and let the user accept an exception in Checks.
- `guidelineNotes`: a DESIGN.md still describes the old hue. Rewrite those sentences in a follow-up `write`, so tokens
  and prose agree.

Then tell the user in plain words what changed, what the reminders said, and that Undo takes it back. After component
changes, `run_tests`.

## Undo and versions

- `undo` takes back the newest change (from you, the UI or the engine). It refuses when one of its files was edited
  since.
- `save_version` only when the user asks; they usually press Save version in the UI.
- `list_versions`, then `restore_version` with the version the user picked. Restoring creates a new version, so it
  can itself be undone; it waits until unsaved changes are saved or discarded.

## Rules

- Values: roles and component tokens are references (`{color.red.700}`, `{radius.lg}`); only the palette holds
  fixed values (colors as `oklch(L C H)`, dimensions as `{ "value": n, "unit": "rem" }`).
- Brands share token names; only values differ. Components never reference a brand directly.
- A request that would break the guidelines (e.g. a 2:1 contrast) is made only after stating the conflict, and the
  user decides; accepted exceptions are recorded in `design-system.json` and shown at publish.
