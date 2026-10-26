---
name: ds-component
description: This skill should be used when the user asks to "build this component", "make a component from this screenshot / mockup / spec", "implement this design with our design system", "turn this into a Storybook component", "照這張圖做元件", "把這個設計做成 Storybook component", gives a Figma link, or when `ds-migrate` processes a queued item. Input can be a screenshot, a written spec, a composition JSON from the panel, or (optionally, when the Figma MCP is authorized) a Figma node. Produces a component built from the existing design system and its tokens, with stories and tests, verified visually and functionally.
version: 0.2.0
---

# ds-component — from a design input to a verified design-system component

Build **with** the design system, not next to it. Whatever the input (a PNG, a paragraph of requirements, a
composition tree from the panel, a Figma node), the job is the same: express it with existing components and
tokens, write AI-readable stories, prove it with tests and a visual check, and record what was learned. Where the
design needs something the system does not have, stop and report; do not improvise.

Prerequisites: `.design-system/config.json` (run `ds-adopt`), tokens built (`ds-tokens`), Storybook running
(`npm run storybook -- --no-open --ci`).

## 0. Health check

- Storybook MCP reachable (`docs-list`) or `.design-system/manifest.index.json` present and fresh.
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-figma-map.mjs"` passes (the map doubles as the design-name → component map).
- Figma MCP only if the input is a Figma URL: `whoami`; if unauthorized, ask the user for a screenshot export instead of
  blocking on `/mcp`. Figma is an accelerator here, never a requirement.

## 1. Read the input and the system

Accepted inputs, in order of preference for a first pass:

| Input | How to read it | What it gives |
|---|---|---|
| Screenshot / mockup PNG | Read tool (image) | layout, hierarchy, states shown; save under `.design-system/.cache/design/<name>.png` as the visual target |
| Spec text / Markdown / PDF page | Read, pdf skill | required elements, copy, behaviors, constraints |
| Composition JSON (from the panel or a previous run) | Read | exact component tree with props and token refs; skip step 2 |
| Figma node URL (optional) | official `figma:figma-design-to-code` skill: `get_metadata`, `get_screenshot`, `get_design_context`, `get_variable_defs` | structure, variables; screenshot saved like a PNG input |

Then read what exists: `docs-list` + `docs-show` for every candidate component, or the manifest index. Read
`.design-system/figma-map.json` for design-name → component mappings (names from a spec or Figma both resolve here).
Collect **token gaps**: every value the design calls for that no token in `.design-system/tokens.json` covers
(colors, spacing, radii, shadows, gradients, type styles, motion). Composite tokens exist for shadow, gradient,
typography, easing and transition; check them before declaring a gap.

## 2. Decide what to build

| Input shows | Action |
|---|---|
| An existing component in a documented variant | Nothing to build; produce the usage snippet, add the story if the variant is undocumented |
| A composition of existing components (form, card layout, pricing table) | Build a **pattern** under `Patterns/<Name>`, composed from `@/components/ui/*` |
| Something close to an existing component | Reuse it and propose the mapping; extend the component only if a required variant truly has no equivalent |
| A genuinely new primitive | Confirm with the user first; build from Radix primitives and tokens under `src/components/ui/` |

Present one short table (design element → component / new) plus the token-gap list. Wait for the user when there are
pending mapping decisions, token gaps, or a new primitive. Never hardcode a value "for now".

## 3. Generate

1. Component: imports from `@/components/ui/*`, props typed from what varies in the design (variant, size, state, slots),
   theme utilities only (`bg-primary`, `shadow-card`, `text-display`), `data-slot` attributes like shadcn, no inline styles.
   Behavior stays in the primitives (focus, keyboard, ARIA).
2. Stories from `templates/component.stories.template.tsx` per `references/story-conventions.md`: JSDoc above `meta`,
   one story per variant and state shown in the design, realistic content from the input, static args, a `play` test for
   interactions, `tags: ["!manifest"]` on test-only stories.
3. If the input came from the panel, also write `composition.json` next to the story as the round-trip source.
4. Update `figma-map.json` only after the user confirmed a mapping (`source: "confirmed"`).

The PostToolUse hook runs `check-hardcoded.mjs` on each write; treat findings as failing tests.

## 4. Verify (producer side)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/check-hardcoded.mjs" src/components
node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-figma-map.mjs"
npx vitest run --project storybook src/components/**/<name>.stories.tsx      # or MCP test-run
node "${CLAUDE_PLUGIN_ROOT}/scripts/snapshot-manifest.mjs" --url http://localhost:6006
node "${CLAUDE_PLUGIN_ROOT}/scripts/visual-diff.mjs" --story <storyId> --figma .design-system/.cache/design/<name>.png
```

`visual-diff.mjs` takes any reference PNG (`--figma` is just the flag name): a Figma export, a mockup, a screenshot of
the old implementation. Look at `side-by-side.png` and `diff.png`. Fix implementation differences and re-run, at most
`verify.maxFixIterations` (default 3) times. Stop early when the remaining difference is token-level or a contradiction
in the input; those are findings. An a11y failure caused by the design system itself follows the finding procedure in
`references/story-conventions.md`.

## 5. Independent review

Hand off to the `ds-reviewer` agent with: the input (path or URL), the reference PNG path, story ids, files written, the
token-gap list and the decisions the user made. Apply `REVISE` items and re-run step 4. `BLOCK` goes to the user.

## 6. Report and review gate

Report: what was reused (component → design element), what was created and why, stories and test results, visual-diff
numbers with the side-by-side path, token gaps and design findings, mapping changes, and the Storybook URL. Do not commit;
the user reviews in Storybook first.

## Rules

- Reuse over rebuild; effort is never a reason to create a parallel component.
- Tokens only; gaps are reported, never filled with literals. Composite tokens (shadow, gradient, typography, motion)
  are first-class: use `shadow-card`, `bg-[image:var(--gradient-hero)]`, `text-display`, `ease-snappy`.
- Confirm before: a new primitive, a confirmed mapping, an a11y exception.
- Figma is optional input; never block on it, never store Figma credentials.

## Resources

- `references/story-conventions.md`, `references/figma-map-schema.md`, `references/dtcg-schema.md`, `references/adapters/shadcn.md`
- `templates/component.stories.template.tsx`
- `scripts/check-hardcoded.mjs`, `scripts/validate-figma-map.mjs`, `scripts/visual-diff.mjs`, `scripts/snapshot-manifest.mjs`
- `agents/ds-reviewer.md`
- Optional: `figma:figma-design-to-code` (Figma input), `ds-figma-map` (Code Connect publishing)
