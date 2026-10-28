# Design system workspace

This repository is a design system maintained with Plinth. Follow these rules.

- Change tokens, guidelines and components with the Plinth MCP tools (`change`, `add_palette_color`, …). A change is
  written at once, after the engine validates it: renames follow every reference, CSS and fonts regenerate, and the
  user can undo it in the Plinth UI. Read the guidelines before a change and keep it consistent with them.
- If the Plinth tools are not available in this session, say so: start Claude Code with the Plinth plugin. Editing the
  files directly also works, but nothing follows a rename for you, and every edit is checked the same way: in the
  Plinth UI, and by `plinth check` before GitHub deploys Storybook.
- The user decides when to save a version and when to publish. Do not commit, save or publish unless they ask.
- Never edit generated files: `src/styles/tokens.css`, `src/styles/fonts.css`, `src/foundations/tokens.generated.json`,
  `exports/`. Files under `src/foundations/`, `.storybook/preview.tsx`, `.github/workflows/storybook.yml` and this
  file are managed by Plinth and replaced on update.
- Components use their component tokens only: utilities such as `bg-button-default-background` defined in
  `tokens/components/<name>.tokens.json`. No hex values, color functions, arbitrary Tailwind values or magic pixel
  values.
- Text too: every part with text has a text token (`<part>.font`, `$type` typography, pointing at a text style such as
  `{typography.label.md}`), used as `type-<name>-<part>` (size, weight, line height and font in one class). No
  `text-sm`, `font-medium`, `leading-*` or `tracking-*` in components; fields add `max-md:text-base` so phones do not
  zoom. Text styles (`typography.*`) use font roles (`font.heading`, `font.body`, `font.label`, `font.code`), which
  point at fonts in the palette; change fonts with `set_style`.
- Glass: a surface over imagery or busy color uses `material-glass` (base token `material.glass`: its color, solid
  where the browser cannot blur, with a recipe tuned by `set_glass`), text on it the glass's foreground; or the Glass
  component. Never write `backdrop-filter` or translucent colors by hand: the engine checks glass text over black and
  white and falls back to solid for `prefers-reduced-transparency`.
- Charts: the Chart component (Recharts). Series colors come from the chart roles Plinth makes from the palette,
  passed in the config: `var(--chart-1)` … `var(--chart-8)` for categories (in order: the first ones stay apart best),
  `var(--chart-seq-1…7)` for low to high, `var(--chart-div-1…7)` around a middle. Never pick series colors by hand;
  `make_chart_colors` remakes them. Give every chart an `aria-label`, and label series (legend or marks).
- Corners inside corners: a part that sits inside a rounded container near its corner (tabs in a bar, options in a
  list, a close button in a corner) gets its own radius token with
  `"$extensions": { "plinth": { "fit": { "outer": "{<name>.radius}", "spacing": <padding steps>, "border": <px> } } }`
  and uses `rounded-<name>-<part>`: its corners become the container's minus the gap, so the gap stays even
  (`radius.fit-inside` switches this for the whole system). Never put the container's own `rounded-<name>` on it.
- Every component has `<name>.tsx`, `<name>.stories.tsx` and `<name>.spec.md` in `src/components/<name>/`, and its
  tokens in `tokens/components/<name>.tokens.json`. GitHub refuses to deploy a component without its tokens or story,
  or with hardcoded values.
- Before writing UI copy, read WRITING.md. Before making visual decisions, read DESIGN.md and the brand's DESIGN.md.
- A design that needs a value no token covers is a token gap: add the token with Plinth, never hardcode it.
