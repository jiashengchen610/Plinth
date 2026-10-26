---
name: create-component
description: This skill should be used when the user asks to "make a component", "add a pricing card", "build this from the screenshot", "create a date picker", "turn this design into a component", or wants a new or changed component in their design system. Writes a spec first, then the component, stories and tests using only the system's tokens and existing components, through the brandloom MCP tools.
version: 0.1.0
---

# Create a component

A component is three files in `src/components/<name>/`: `<name>.spec.md`, `<name>.tsx`, `<name>.stories.tsx`.
The spec is written and approved before any code.

## 1. Classify the request

`list_components`, `get_tokens`, `get_guidelines`. Then decide the tier:

| Tier | Meaning | Approach |
|---|---|---|
| 1. Exists | An existing component in a new variant or state | Extend it (new variant in its cva, new story) |
| 2. Composition | Built from existing components (pricing card, login form, stat tile) | New component that imports `@/components/<x>/<x>` only |
| 3. Known pattern | Has an established accessible behavior (date picker, combobox, tree, slider, tabs, dialog) | Build on a Radix primitive from `radix-ui`; follow the WAI-ARIA pattern for keyboard and roles |
| 4. Novel | No established pattern (custom visualisation, timeline scrubber) | Not supported yet: say so, and offer the closest tier 2–3 version |

## 2. Spec (one proposal)

`propose_change` with one `write` op for `src/components/<name>/<name>.spec.md`, sections:
`## Parts`, `## States`, `## Props` (each with allowed values), `## Tokens` (every token it uses),
`## Accessibility` (roles, keyboard, what is announced). Add `## Token gaps` when the design needs a value no token
covers: name the value and the closest token. Do not invent tokens inside a component proposal.

Ask the user to approve the spec in the UI. Apply it.

## 3. Component and stories (one proposal)

`propose_change` with `write` ops for `<name>.tsx` and `<name>.stories.tsx`.

Component rules:
- Imports: `@/components/<x>/<x>`, `@/lib/utils` (`cn`), `radix-ui`, `class-variance-authority`, `lucide-react`.
- Styling: theme utilities from token names only (`bg-primary`, `text-muted-foreground`, `rounded-lg`, `shadow-card`,
  `text-display`). No hex, `oklch()`, arbitrary values (`p-[13px]`), inline styles or magic pixel values.
- Variants with `cva`; `data-slot` on the root; forward `className`; type props explicitly.
- Copy follows WRITING.md (verbs on buttons, sentence case, specific errors).

Story rules:
- JSDoc above `const meta`: what it is, when to use it, when not to (this becomes the Storybook description).
- `title: "Components/<Group>/<Name>"` (or `Patterns/<Name>` for tier 2).
- One story per variant and per state in the spec, with realistic content; static args.
- A `play` test for any interaction; tag it `["!manifest"]`.

## 4. Verify

1. `run_checks`: hardcoded values must be zero.
2. Ask the user to run `npm test` in the design system folder, or run it yourself if you have a shell: every story
   passes interaction and accessibility checks in Storybook's test runner.
3. `start_storybook`; in the UI (Components tab) the user switches brand and mode and checks it.
Fix and propose again until all pass. Report what was reused, what was new, and any token gaps.
