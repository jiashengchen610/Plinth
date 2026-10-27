---
name: create-component
description: "This skill should be used when the user asks to \"make a component\", \"add a pricing card\", \"build this from the screenshot\", \"create a date picker\", \"turn this design into a component\", or wants a new or changed component in their design system. Writes a spec first, then the component, stories and tests using only the system's tokens and existing components, through the Plinth MCP tools."
version: 0.4.0
---

# Create a component

A component is three files in `src/components/<name>/`: `<name>.spec.md`, `<name>.tsx`, `<name>.stories.tsx`, plus its
tokens in `tokens/components/<name>.tokens.json`. GitHub refuses to deploy a component without its tokens or story, or
with hardcoded values or an icon package (`plinth check`). The spec comes before any code.

## 0. Ready-made first

Plinth ships a catalog: button, input, textarea, label, checkbox, radio-group, select, switch, alert, badge, toast,
tooltip, card, tabs, dialog, separator. If the user asks for one of these and `list_components` does not have it,
call `add_component` (free, instant, one undoable change, in the system's style at once) instead of writing it. Then
adjust it like any existing component (tier 1).

## 1. Classify the request

`list_components`, `get_tokens`, `get_guidelines`. Then decide the tier:

| Tier | Meaning | Approach |
|---|---|---|
| 1. Exists | An existing component in a new variant or state | Extend it (new variant in its cva, new story) |
| 2. Composition | Built from existing components (pricing card, login form, stat tile) | New component that imports `@/components/<x>/<x>` only |
| 3. Known pattern | Has an established accessible behavior (date picker, combobox, tree, slider, popover) | Build on a Radix primitive from `radix-ui`; follow the WAI-ARIA pattern for keyboard and roles |
| 4. Novel | No established pattern (custom visualisation, timeline scrubber) | Not supported yet: say so, and offer the closest tier 2–3 version |

## 2. Spec (one change)

`change` with one `write` op for `src/components/<name>/<name>.spec.md`, sections:
`## Parts`, `## States`, `## Props` (each with allowed values), `## Tokens` (every token it uses),
`## Accessibility` (roles, keyboard, what is announced). Add `## Token gaps` when the design needs a value no token
covers: name the value and the closest token. Do not invent roles or palette colors inside a component change
(its own component tokens are fine); add those first with the change-design-system skill (roles in every brand) if
the user agrees.

Summarize the spec for the user (parts, states, props, token gaps) and ask whether to build it, unless they already
asked you to go ahead without checking.

## 3. Component tokens, component and stories (one change)

`change` with `write` ops for `tokens/components/<name>.tokens.json`, `<name>.tsx` and `<name>.stories.tsx`.

Component tokens first: one per part and property the component styles, pointing at roles, e.g.
`{ "<name>": { "$type": "color", "container": { "background": { "$value": "{color.card}" }, "foreground": … } } }`
and `"radius": { "$type": "dimension", "$value": "{radius.container}" }`. Name color parts `<part>/background`,
`<part>/foreground`, `<part>/border`, `<part>/background-hover` (background and foreground pairs are checked for
contrast automatically). Opacity: `"$extensions": { "plinth": { "alpha": 0.1 } }`. A composition (tier 2) reuses
the inner components' tokens and adds tokens only for what it styles itself.

Component rules:
- Imports: `@/components/<x>/<x>`, `@/lib/utils` (`cn`), `radix-ui`, `class-variance-authority`, and icons from
  `@/icons` only (`icons/check.svg` → `CheckIcon`). Missing icons: `find_icons`, then `add_icons`. Never import an
  icon package (`lucide-react` and the like): the deploy refuses it.
- Styling: the component's own tokens as theme utilities (`bg-<name>-container-background`,
  `text-<name>-container-foreground`, `rounded-<name>`), spacing from Tailwind's scale (`p-4`, `gap-2`). Focus rings
  and invalid states may use roles (`ring-ring`, `border-destructive`). Elevation, motion and stacking come from the
  base roles: `shadow-card`, `shadow-overlay`, `duration-(--duration-fast)`, `ease-enter`, `ease-exit`,
  `z-(--layer-dialog)` (layers: sticky, dropdown, dialog, toast, tooltip). No hex, `oklch()`, arbitrary values
  (`p-[13px]`), inline styles or magic pixel values.
- Variants with `cva`; `data-slot` on the root; forward `className`; type props explicitly.
- Copy follows WRITING.md (verbs on buttons, sentence case, specific errors).

Story rules:
- JSDoc above `const meta`: what it is, when to use it, when not to (this becomes the Storybook description).
- `title: "Components/<Group>/<Name>"` (or `Patterns/<Name>` for tier 2).
- One story per variant and per state in the spec, with realistic content; static args.
- A `play` test for any interaction; tag it `["!manifest"]`.

## 4. Verify

1. `run_checks`: hardcoded values in the component must be zero (GitHub refuses to deploy otherwise); fix them in a
   follow-up change.
2. `run_tests`: TypeScript plus every story's interaction and accessibility tests. Fix failures in follow-up
   changes until green. If dependencies are not installed, call `install_dependencies` first.
3. `start_storybook` if it is not running; the user checks the component in every brand and mode in the
   Components tab.
Report what was reused, what was new, and any token gaps.
