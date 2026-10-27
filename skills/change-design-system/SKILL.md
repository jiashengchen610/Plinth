---
name: change-design-system
description: "This skill should be used when the user asks to change an existing design system: \"make the primary warmer\", \"rounder corners\", \"rename this token\", \"use Inter\", \"add a dark mode tweak\", \"add a second brand\", \"update our writing guidelines\", \"fix the contrast\", \"these two colors look the same\", \"undo the last change\", \"go back to yesterday's version\". Applies every change as a reviewed proposal and a new version through the Plinth MCP tools."
version: 0.2.0
---

# Change a design system

Every change follows the same loop: read → propose → user reviews in the UI → apply → verify. Nothing is written
before `apply_change`, and every applied change is a commit the user can return to.

## Read first

- `status` for brands, pending changes and the gate.
- `get_tokens` (per brand) for exact token paths and current values.
- `get_guidelines` before changing anything visual or any copy. When a color changes hue, note the sentences that
  describe it: they change in the same proposal.
- If `status` reports `outsideEdits` (files changed by hand or by another tool), tell the user before proposing: a
  change to one of those files is refused until they record or discard the edit (banner in the UI, or
  `record_outside_edits` when they ask you to).

## Propose

Use `propose_change` with a short imperative `title` (it becomes the version name) and a one-line `rationale`.

| Request | Ops |
|---|---|
| Change a role (primary, muted …) | `set` it to another palette step, e.g. `{color.red.800}`; add `mode: "dark"` for the dark value. Change both modes unless asked otherwise. |
| A color that is not in the palette | `propose_palette_color` (name + color → a 50–950 scale), then point roles at it |
| Change one component only | `set` its component token in `tokens/components/<component>.tokens.json` (e.g. `button/default/background` → `{color.accent}`); opacity via `$extensions.plinth.alpha` |
| Change every component that uses a role | change the role, not the component tokens |
| A new layer between two others | `write` `tokens/layers/<id>.tokens.json` and `design-system.json` with the layer inserted in `layers`; tokens should point at their own layer or lower ones |
| Old design system without layers | `propose_upgrade`; afterwards `propose_link_to_palette` points fixed colors at the matching palette step |
| New role | `set` with `type` (and `description`), in **every** brand file: brands must define the same token names. Semantic names follow shadcn (`X` + `X-foreground`). |
| Rename / regroup | `rename` with `path` and `to`. Aliases in token files and utilities in components (`bg-old` → `bg-new`) are rewritten; the preview lists the component files touched. |
| Remove | `delete`; first check no component or alias uses it. |
| Change a font | `set` `font/sans` and the `fontFamily` of each `typography/*` token to the Google Fonts family name. The loader (`src/styles/fonts.css`) regenerates on apply; nothing else to do. |
| Guidelines | `write` the whole file (`DESIGN.md`, `brands/<id>/DESIGN.md`, `WRITING.md`). Keep sections in DESIGN.md order: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts. |
| New brand | `write` `brands/<id>/tokens.json` (copy an existing brand's structure: every token name, both modes), `write` `brands/<id>/DESIGN.md`, and `write` `design-system.json` with the brand appended to `brands`. |
| Fix contrast | `propose_contrast_fixes` (deterministic: a role on the palette moves to another step of the same hue; a fixed value keeps its hue and moves its lightness; the palette itself is never edited). |
| Two roles look alike | Decide with the user which role moves (usually the status color returns to its hue family: destructive red, success green, warning amber, info blue), then `set` it. |

Read the proposal's preview before telling the user about it:

- Everything in the preview is a reminder: nothing blocks applying or publishing except a broken reference
  (`issues`). Tell the user what it found and let them decide.
- `failingAfter` > 0: say which pairs fail and either adjust or plan `propose_contrast_fixes`.
- `distinctFailures`: two role colors would look alike; adjust one, or explain and let the user accept an exception
  in the Checks tab.
- `notes`: a DESIGN.md still describes the old hue. Discard, add a `write` op that rewrites those sentences, and
  propose again, so tokens and prose change together.

Then point the user to the Changes tab in the UI.

## Apply

Call `apply_change` only when the user approves (in the UI they can press Apply themselves; in chat, they say so).
Then `run_checks`. If the gate fails, explain and propose a fix. After component changes, `run_tests`.

## Direct edits

Design files (tokens, guidelines, components, `design-system.json`) cannot be written directly in this folder:
`.claude/settings.json` blocks it so every change is previewed and versioned. Do not try other ways around it
(shell commands, copying files). Files outside the design (`package.json`, configuration) may be edited when the
user asks and you have the tools; they appear as outside edits for the user to record.

## Undo

`list_versions`, then `restore_version` with the version the user picked. Restoring creates a new version, so it can
itself be undone. It waits while there are outside edits.

## Rules

- Values: roles and component tokens are references (`{color.red.700}`, `{radius.lg}`); only the palette holds
  fixed values (colors as `oklch(L C H)`, dimensions as `{ "value": n, "unit": "rem" }`).
- Brands share token names; only values differ. Components never reference a brand directly.
- A request that would break the guidelines (e.g. a 2:1 contrast) is proposed only with the conflict stated, and the
  user decides; accepted exceptions are recorded in `design-system.json` and shown at publish.
