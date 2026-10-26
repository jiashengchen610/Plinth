---
name: change-design-system
description: "This skill should be used when the user asks to change an existing design system: \"make the primary warmer\", \"rounder corners\", \"rename this token\", \"add a dark mode tweak\", \"add a second brand\", \"update our writing guidelines\", \"fix the contrast\", \"undo the last change\", \"go back to yesterday's version\". Applies every change as a reviewed proposal and a new version through the Plinth MCP tools."
version: 0.1.0
---

# Change a design system

Every change follows the same loop: read → propose → user reviews in the UI → apply → verify. Nothing is written
before `apply_change`, and every applied change is a commit the user can return to.

## Read first

- `status` for brands, pending changes and the gate.
- `get_tokens` (per brand) for exact token paths and current values.
- `get_guidelines` before changing anything visual or any copy.

## Propose

Use `propose_change` with a short imperative `title` (it becomes the version name) and a one-line `rationale`.

| Request | Ops |
|---|---|
| Change a value | `set` on the token's file and path; add `mode: "dark"` for the dark value. Change both modes unless asked otherwise. |
| New token | `set` with `type` (and `description`). Semantic names follow the system's naming (`design-system.json → naming`). |
| Rename / regroup | `rename` with `path` and `to`; aliases in every token file are rewritten. Then `list_components` and propose component edits for any utility that used the old name. |
| Remove | `delete`; first check no component or alias uses it. |
| Guidelines | `write` the whole file (`DESIGN.md`, `brands/<id>/DESIGN.md`, `WRITING.md`). Keep sections in DESIGN.md order: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts. |
| New brand | `write` `brands/<id>/tokens.json` (copy an existing brand's structure: every brand must define the same token names), `write` `brands/<id>/DESIGN.md`, and `write` `design-system.json` with the brand appended to `brands`. |
| Fix contrast | `propose_contrast_fixes` (deterministic; keeps hue, moves lightness). |

Read the proposal's `preview`: if `failingAfter` > 0, say which pairs fail and either adjust or plan the contrast fix.
Then point the user to the Changes tab in the UI.

## Apply

Call `apply_change` only when the user approves (in the UI they can press Apply themselves; in chat, they say so).
Then `run_checks`. If the gate fails, explain and propose a fix.

## Undo

`list_versions`, then `restore_version` with the version the user picked. Restoring creates a new version, so it can
itself be undone.

## Rules

- Values: colors as `oklch(L C H)`; dimensions as `{ "value": n, "unit": "rem" }`.
- Brands share token names; only values differ. Components never reference a brand directly.
- A request that would break the guidelines (e.g. a 2:1 contrast) is proposed only with the conflict stated, and the
  user decides.
