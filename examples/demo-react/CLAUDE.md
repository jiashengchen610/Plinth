# demo-react

Reference project for the design-system-skills plugin: Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui (radix, nova) + Storybook 10.6.

<!-- design-system-skills:start -->
## Design system rules

This project uses a design system (adapter: `shadcn`). The AI-readable knowledge layer lives in
`.design-system/` and in Storybook's MCP server.

**Before writing any UI:**
1. Check what exists. If Storybook is running, call the MCP tools `docs-list` then `docs-show <id>`.
   Otherwise read `.design-system/manifest.index.json`. Never infer props from memory or from source files.
2. Reuse an existing component whenever it can express the design, even if it needs wiring or extra
   styling. Create a new component only when nothing in the manifest fits, and say so explicitly.
3. Use design tokens only: theme utilities and CSS variables defined in `src/index.css`. Never write hex,
   `rgb()` / `hsl()` / `oklch()` literals, Tailwind arbitrary values, or magic `px`. If the design needs a value no
   token covers, stop and report a **token gap** instead of hardcoding; the user decides whether to add a token.
4. Import components through the path alias (`@/components/ui/<name>`), never through package self-references
   or deep internal paths.

**Every component ships with:**
- `<name>.stories.tsx` next to it, following `references/story-conventions.md` from the design-system-skills
  plugin: JSDoc description above `const meta`, one story per variant value and state, static args, a `play`
  test for interactive behavior.
- Passing `test-run` (Storybook MCP) or `npx vitest run --project storybook`: interaction tests and a11y.

**Figma:**
- Figma components map to code components through `.design-system/figma-map.json`. Look there first; if the
  node is unmapped, propose a mapping and let the user confirm before generating a parallel component.
- Figma variables map to tokens through `.design-system/tokens.json` (DTCG). Values that resolve to no token
  are reported as `HARD` and never written into code.

**Guardrail:** a PostToolUse hook runs `check-hardcoded.mjs` on every write. Treat its findings as a failing
test: fix them before continuing, unless the user explicitly accepted an exception.
<!-- design-system-skills:end -->
