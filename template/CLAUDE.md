# Design system workspace

This repository is a design system maintained through the Plinth tools. Follow these rules.

- Change tokens, guidelines and components only through the Plinth MCP tools: `propose_change`, then the user
  approves and the change is applied. `.claude/settings.json` blocks direct edits to those files (and to
  generated and Plinth-managed files) so every change is previewed, checked and saved as its own version.
- If the Plinth tools are not available in this session, say so and stop: start Claude Code with the Plinth plugin
  (`npx -y github:jiashengchen610/Plinth --terminal` in this folder). Do not work around the blocked paths.
- Other files (`package.json`, configuration) may be edited when the user asks; Plinth shows such edits as
  "outside edits" for the user to record or discard.
- Components use semantic tokens only: theme utilities such as `bg-primary` and `text-muted-foreground`.
  No hex values, color functions, arbitrary Tailwind values or magic pixel values.
- Before writing UI copy, read WRITING.md. Before making visual decisions, read DESIGN.md and the brand's DESIGN.md.
- Every component has `<name>.tsx`, `<name>.stories.tsx` and `<name>.spec.md` in `src/components/<name>/`.
- A design that needs a value no token covers is a token gap: report it, never hardcode it.
