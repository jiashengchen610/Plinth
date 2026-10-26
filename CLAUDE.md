# brandloom (product repo)

Read `PRD.md` first: it defines scope, inputs, outputs and the data boundary. `README.md` has the layout.

## Rules

- Data boundary: tool code (engine/, server/, app/) never enters the model context of a user session, and the user's
  repo (from template/) never contains tool code.
- `engine/` and `server/` are zero-dependency Node ESM. Keep them that way: the plugin must run without `npm install`.
- Prefer `process.exitCode` over `process.exit()` after `fetch` (Node 24 / Windows libuv assertion).
- Anything the model could guess but a program can compute (contrast, CSS output, YAML) is computed in `engine/`.
- After changing `app/src`, run `npm run build:app` and commit `app/dist`.
- After changing `engine/` or `server/`, run `npm test`.
- `template/` must stay installable and green: create a workspace from it, `npm ci`, `npm test` (39 story tests).

## Verified facts this code relies on (2026-10)

- Storybook 10.6.1: the components manifest takes the component description from the JSDoc above `const meta`;
  story iframes accept `globals=brand:<id>;mode:<light|dark>`.
- Claude Code sets `CLAUDE_PROJECT_DIR` for MCP server processes; the spawn cwd is not guaranteed.
- Google DESIGN.md spec (alpha): sections Overview, Colors, Typography, Layout, Elevation & Depth, Shapes,
  Components, Do's and Don'ts; no multi-brand or mode support, hence one composed file per brand.
