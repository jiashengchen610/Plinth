# design-system-skills (plugin repo)

Claude Code plugin: skills, scripts and templates that let an agent build Storybook components from Figma on top of an
existing design system (shadcn/ui first). Read `README.md` for the architecture and status.

## Layout rules

- `skills/`, `scripts/`, `templates/`, `references/` must stay agent-agnostic (no Claude-specific concepts).
- `hooks/`, `agents/`, `.claude-plugin/`, `.mcp.json` are the Claude Code layer.
- Scripts are zero-dependency Node ESM (`.mjs`), run from the **target project's** cwd; `visual-diff.mjs` resolves
  `playwright`, `pixelmatch`, `pngjs` from the target project's `node_modules`.
- Prefer `process.exitCode` over `process.exit()` after `fetch` (Node 24 / Windows libuv assertion).

## Reference project

`examples/demo-react/`: Vite + React 19 + TS + Tailwind v4 + shadcn/ui (radix, nova) + Storybook 10.6.1.

```bash
cd examples/demo-react
npm run storybook -- --no-open --ci            # dev server + manifests + MCP at http://localhost:6006/mcp
npx vitest run --project storybook             # 39 story tests (interaction + a11y, a11y.test = "error")
node ../../scripts/snapshot-manifest.mjs --url http://localhost:6006
node ../../scripts/build-tokens.mjs --theme --check
node ../../scripts/ds-audit.mjs
```

## Testing the plugin

```bash
claude --plugin-dir "D:/design system skills"
```

Figma MCP must be authorized once with `/mcp` in an interactive session; nothing in this repo stores Figma credentials.

## Conventions when editing

- Skill descriptions: third person with trigger phrases (English + Traditional Chinese). Bodies in imperative form,
  1,500–2,000 words, details in `references/`.
- Any claim about Storybook / Figma behavior that was verified goes with the version it was verified on.
- Run `scripts/check-hardcoded.mjs` on anything you write into `examples/`.
