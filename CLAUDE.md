# Plinth (product repo)

Read `PRD.md` first: it defines scope, inputs, outputs and the data boundary. `README.md` has the layout.

## Rules

- Data boundary: tool code (engine/, server/, app/) never enters the model context of a user session, and the user's
  repo (from template/) never contains tool code.
- `engine/` and `server/` are zero-dependency Node ESM. Keep them that way: the plugin must run without `npm install`.
- Node 24 / Windows aborts the process without an error in two cases we hit: `process.exit()` right after `fetch`, and
  `fs.cpSync` into an existing folder directly under a drive root (`D:\demo`). So: no `fetch` in `server/` (use
  `httpJson`), no `cpSync` (use `copyDir`; a test enforces it), and verify through an npx install in a `D:\` folder.
- Anything the model could guess but a program can compute (contrast, CSS output, YAML, palette scales, contrast fixes)
  is computed in `engine/`.
- Tokens are layered (design-system.json → layers): palette (Tailwind, regenerate with `scripts/tailwind-primitives.mjs`),
  roles, component tokens. Template components use only component tokens. Fixes never edit the palette.
- After changing `app/src`, run `npm run build:app` and commit `app/dist`.
- After changing `engine/` or `server/`, run `npm test` (18 tests).
- `template/` must stay installable and green: create a workspace from it, `npm ci`, `npm run typecheck`, `npm test`
  (42 story tests).
- Writing files from Bash heredocs mangles backslashes here (`\\b` became a backspace); write code files with the
  Write/Edit tools.

## Verified facts this code relies on (2026-10)

- Storybook 10.6.1: the components manifest takes the component description from the JSDoc above `const meta`;
  story iframes accept `globals=brand:<id>;mode:<light|dark>`.
- Claude Code sets `CLAUDE_PROJECT_DIR` for MCP server processes; the spawn cwd is not guaranteed.
- Claude Code 2.1.x headless: `claude -p --output-format stream-json --verbose --plugin-dir <root>` loads the plugin
  from a checkout; its tools are named `mcp__plugin_plinth_plinth__<tool>` and `--allowedTools mcp__plugin_plinth_plinth`
  allows them all; the prompt can come from stdin; a nested run works after deleting `CLAUDECODE` from the env;
  `--resume <session_id>` continues a session. On Windows `claude` is a native exe (spawn without a shell).
- Google DESIGN.md spec (alpha): sections Overview, Colors, Typography, Layout, Elevation & Depth, Shapes,
  Components, Do's and Don'ts; no multi-brand or mode support, hence one composed file per brand.
