# Story conventions for AI-readable Storybooks

Storybook 10.6+ turns CSF files into `manifests/components.json` and MDX into `manifests/docs.json`.
Agents consume those manifests through `@storybook/addon-mcp` (`docs-list`, `docs-show`,
`docs-show-story`) or through the committed snapshot `.design-system/manifest.index.json`. Everything
below exists to make those manifests complete, so an agent never has to open component source or
guess a prop.

## What the manifest extracts

| Manifest field | Comes from | Convention |
|---|---|---|
| `description` | **The JSDoc block directly above `const meta` in the stories file** (verified on Storybook 10.6.1). Component-source JSDoc lands in `reactDocgenTypescript.description` instead. | 1–3 sentences: what it is, when to use it, when not to. For vendored components this is the only place to write it without touching vendor source. |
| `reactDocgenTypescript.props[*]` | Exported props type via `react-docgen-typescript` | Union literals come through automatically (`"default" \| "outline" \| …`). Prop `description` is empty for vendored shadcn sources; put prop guidance in `argTypes[*].description` (shown in docs pages and `docs-show-story`). For owned components, add JSDoc on each prop. |
| `stories[*].snippet`, `stories[*].description` | Static story `args`; JSDoc above each `export const` | Keep args static JSON-like values so a snippet renders. One-line JSDoc per story becomes `stories[*].description`. |
| `jsDocTags` | `@see`, `@figma`, `@deprecated` tags in the meta JSDoc | Use `@figma <url>` to point at the Figma component (consumed by `ds-figma-map`) |
| `import` | Story file `component` import path | Import from the public entry (`@/components/ui/button`), never a deep internal path |

Stories and docs pages carry the implicit `manifest` tag. Hide internal fixtures with `tags: ['!manifest']`.

## File layout (shadcn adapter)

```
src/components/ui/button.tsx            # component (vendored shadcn source)
src/components/ui/button.stories.tsx    # one CSF file per component, same folder
src/components/ui/button.mdx            # optional: usage guidelines → docs manifest
```

`title` follows `Components/<Group>/<Name>` for primitives (`Components/Forms/Input`) and
`Patterns/<Name>` for compositions. Keep titles stable: Figma mappings and Code Connect reference them.

## Required stories per component

1. **Default** — the canonical appearance with realistic content (no "Lorem ipsum", no "Button").
2. **One story per variant axis value** that changes appearance: each `variant`, each `size`.
   Name them after the value (`Destructive`, `Small`), not `Variant1`.
3. **States**: `Disabled`, `Loading`, `Error`/`Invalid`, `WithIcon` where the component supports them.
4. **Playground** — all controls enabled, used by humans; tag it `['!manifest']` if its args are dynamic.
5. **Composition** story for components that only make sense together (`Card` with header/content/footer).

Each story gets a one-line `parameters.docs.description.story` when its purpose is not obvious from the name.

## argTypes

- Declare `argTypes` only where docgen cannot infer: `control: 'select'` with explicit `options` for unions
  coming from `cva` variants, `action` handlers, and anything that should be hidden (`table: { disable: true }`).
- Do not duplicate descriptions that already exist as JSDoc on the props type.

## Tokens

- Story and component code use theme utilities and CSS variables only (`bg-primary`, `text-muted-foreground`,
  `rounded-lg`). No hex, rgb/hsl/oklch literals, Tailwind arbitrary values, or magic `px`.
  `scripts/check-hardcoded.mjs` enforces this; the PostToolUse hook runs it on every write.
- When a design needs a value no token covers, the story documents the gap in a `// TOKEN GAP:` comment
  and the agent reports it instead of hardcoding.

## Interaction and accessibility

- Components with behavior get at least one `play` function (open a dialog, submit a form, toggle a state)
  so `test-run` from the Storybook MCP exercises them.
- Keep `@storybook/addon-a11y` enabled with `parameters.a11y.test = "error"` in `preview` so violations fail
  `test-run`. A story must not ship with violations.
- When a violation comes from the design system itself (a token or vendored variant, not the story), do not
  silently disable the rule and do not "fix" it by hardcoding a color. Instead: (1) record a numbered finding
  in `.design-system/guidelines.md` with the measured values and the options; (2) add a per-story exception
  `parameters.a11y.config.rules: [{ id: "<rule>", enabled: false }]` with a comment naming the finding;
  (3) report it to the user. Worked example: DS-001 in `examples/demo-react/.design-system/guidelines.md` (shadcn nova
  `destructive` tint measured 3.98:1; resolved by darkening the `--destructive` token through `ds-tokens`, after which the
  exceptions were removed again). Exceptions are temporary; the token fix is the real resolution.

## Docs pages (MDX → docs manifest)

For each component group, one MDX page with these headings in this order, because `docs-show` returns
the page verbatim and agents read top-down:

1. **When to use / When not to use**
2. **Anatomy** (named parts, mapped to props or sub-components)
3. **Variants and states** (link to stories with `<Canvas of={...} />`)
4. **Content guidelines** (labels, lengths, casing)
5. **Accessibility** (keyboard, focus, ARIA handled by the component vs by the consumer)
6. **Figma** (link to the component in Figma; properties ↔ props table)

## Checklist before a component is "AI-ready"

- [ ] Component has a JSDoc description and every prop is documented
- [ ] `manifest.index.json` shows ≥ 3 stories and all stories have snippets
- [ ] No `check-hardcoded.mjs` warnings in component or stories
- [ ] a11y passes in `test-run`
- [ ] `@figma` tag or `figma-map.json` entry links the component to its Figma source
