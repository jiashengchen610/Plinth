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
- Every component has `<name>.tsx`, `<name>.stories.tsx` and `<name>.spec.md` in `src/components/<name>/`, and its
  tokens in `tokens/components/<name>.tokens.json`. GitHub refuses to deploy a component without its tokens or story,
  or with hardcoded values.
- Before writing UI copy, read WRITING.md. Before making visual decisions, read DESIGN.md and the brand's DESIGN.md.
- A design that needs a value no token covers is a token gap: add the token with Plinth, never hardcode it.
