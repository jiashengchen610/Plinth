# Design system workspace

This repository is a design system maintained through the Plinth tools. Follow these rules.

- Change tokens, guidelines and components through the Plinth MCP tools (propose, then apply). Do not edit
  `src/styles/tokens.css`; it is generated.
- Components use semantic tokens only: theme utilities such as `bg-primary` and `text-muted-foreground`.
  No hex values, color functions, arbitrary Tailwind values or magic pixel values.
- Before writing UI copy, read WRITING.md. Before making visual decisions, read DESIGN.md and the brand's DESIGN.md.
- Every component has `<name>.tsx`, `<name>.stories.tsx` and `<name>.spec.md` in `src/components/<name>/`.
- A design that needs a value no token covers is a token gap: report it, never hardcode it.
