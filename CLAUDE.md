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
  roles, component tokens. Template components use only component tokens, and icons only from `@/icons` (SVGs in
  `icons/`; the shipped Lucide set is `engine/icon-sets/lucide.json`, regenerate with `scripts/lucide-icons.mjs`).
  Catalog components may import only the five core ones (a test enforces it). Fixes never edit the palette.
  Fonts are layered the same way: fonts in the palette (`primitives → font`), font roles (`font.heading`, `body`,
  `label`, `code`), text styles (`typography.*`, whose family is a role), and a text token per component part
  (`<part>.font` → a style) used as `type-<component>-<part>` (one `@utility` per typography token, from `buildCss`).
  Template components never use `text-sm`, `font-medium`, `leading-*` or `tracking-*` (the `tw-type` check, a
  reminder only). Corners inside corners: a nested part's radius token carries `$extensions.plinth.fit` (outer radius,
  gap in spacing steps, border px, min); `buildCss` emits container radius minus the gap while `radius.fit-inside`
  is not 0 (the `nested-radius` check reminds when a component reuses its container's `rounded-<name>`).
  `componentRefresh` (engine/upgrade.mjs) brings older design systems what newer template components use.
- One Plinth per folder (`server/owner.mjs`): whichever process starts first serves the UI and runs every write;
  others forward tool calls to it. Writes go through `engine/workspace.mjs` `change` (validated, undoable); the user
  saves versions. Nothing restricts direct edits: checks run on the state, and `plinth check` (`engine/check.mjs`)
  runs in the user's deploy workflow.
- Releases: bump `version` in `package.json` and `.claude-plugin/plugin.json`, then tag `v<version>` and push the tag.
  The managed deploy workflow runs `npx -y github:jiashengchen610/Plinth#v<version> check`, so the tag must exist
  before any workspace publishes with that version.
- After changing `app/src`, run `npm run build:app` and commit `app/dist`.
- The UI is four steps (Describe, Style, Components, Publish) in plain words: no token names in UI copy except the
  small labels in the node graph. Presets the UI offers (palettes, fonts, corners, the component list) live in
  `server/start.mjs`; style picks become ops in `engine/style.mjs`. Every page's main action goes in `<Cta>`.
- AI drafts, the user confirms: text the user would otherwise write is drafted and shown in an editable field (prose
  by Claude through `server/quick.mjs`, names and values by the engine), never left empty. Status tells the truth: after
  a push the UI reads what GitHub did (`deployStatus`) instead of saying it is published.
- One edit at a time: UI calls that write go through `edit()` in `app/src/lib/lock.ts` (`api.ts` wraps them), which
  locks the page until the write is done and the page has reloaded; a Claude reply locks it for the whole reply.
- Every step opens with `<StepIntro>`: what you decide, how to change it, when it is done (PRD 下一版 item 19). Style
  has no sample screen: its main view is `TokenMap` (every layer in three columns joined by lines measured from the
  nodes; a click lights the chain; base values only when used; components and the chart colors folded; quick picks
  open from the top; on the right the sticker sheet narrowed to where the token is used, via the picker's `focus`).
  Components shows the managed sticker sheet (`src/foundations/sticker-sheet.stories.tsx`: every component's stories
  on one page, loaded when the page renders, never imported eagerly, and skipping stories that open an overlay).
- Picking to edit: a story in Components loads `server/inspect.js` from the Plinth UI (the managed
  `.storybook/preview.tsx` adds it only for a localhost Storybook opened with `plinthInspect=<UI origin>`), which
  reports clicked classes by `postMessage` and scrolls to a component on request (`reveal`); `app/src/lib/inspect.ts`
  maps them to tokens. The edit panel (also opened from any node of the Style sheet) counts the reach itself and asks
  "only this / everywhere" before a shared change (`set_part_color`); the request box is one Haiku run that returns
  values only (`quickEdit`), checked by the server and confirmed by the user.
- Before a release that changes template component files, run `node scripts/shipped-hashes.mjs` (the previous
  release committed): upgrades replace a user's component file only while it matches a version recorded there.
- A template file shipped with a bug gets an entry in `TEMPLATE_FIXES` (`engine/workspace.mjs`): workspaces whose copy
  is still exactly the shipped one get the fix as an undoable change when Plinth starts.
- After changing `engine/` or `server/`, run `npm test` (44 tests).
- `template/` must stay installable and green: create a workspace from it, `npm ci`, `npm run typecheck`, `npm test`
  (93 story tests).
- Writing files from Bash heredocs mangles backslashes here (`\\b` became a backspace); write code files with the
  Write/Edit tools. Never pass text with backticks inside double quotes to Bash (`node -e "…"`): the shell runs the
  backticked words as commands, and Windows has a `label` command that renames drives. Edit docs with Edit.

## Verified facts this code relies on (2026-10)

- Storybook 10.6.1: the components manifest takes the component description from the JSDoc above `const meta`;
  story iframes accept `globals=brand:<id>;mode:<light|dark>`.
- Claude Code sets `CLAUDE_PROJECT_DIR` for MCP server processes; the spawn cwd is not guaranteed.
- Claude Code 2.1.x headless: `claude -p --output-format stream-json --verbose --plugin-dir <root>` loads the plugin
  from a checkout; its tools are named `mcp__plugin_plinth_plinth__<tool>` and `--allowedTools mcp__plugin_plinth_plinth`
  allows them all; the prompt can come from stdin; a nested run works after deleting `CLAUDECODE` from the env;
  `--resume <session_id>` continues a session. On Windows `claude` is a native exe (spawn without a shell).
  `--allowedTools` with single tool names (`mcp__plugin_plinth_plinth__review_changes`) plus `--disallowedTools` for
  the writing tools gives a read-only run (the review at publish). Without `--plugin-dir` and with the file tools
  disallowed, `claude -p --model haiku` answers a JSON-only prompt in about 9 s for about US$0.004 (Describe's
  suggestions).
- Storybook 10 moves to another port by itself when the one passed with `-p` is taken, and listens on `::`; a free-port
  check on 127.0.0.1 alone passes on a port another Storybook holds (Windows). Read the URL from its "Local:" line.
- `gh run view --log-failed` prints "job<TAB>step<TAB>timestamp text" lines; on Windows the color codes arrive written out
  as "^[[31m". Story tests that check visibility during a fade-in pass on Windows and fail on GitHub's Linux runner:
  wait for it (`waitFor`) or check the text.
- Version descriptions by Haiku (one run, no tools): about 7 s, US$0.004. The edit panel's request box (Haiku, one
  run, values only): 6.8–8.3 s, US$0.0035–0.0041; five requests on a button gave sensible values and sent "add a
  shadow when hovered" to the chat.
- Storybook 10.6.1 dev: a story iframe keeps extra query parameters (`plinthInspect`), `.storybook/preview.tsx` can
  add a script from another localhost port, and `postMessage` to the parent page works (tested from a page on another
  port). `composeStories` comes from `@storybook/react-vite`. Under the vitest addon every stories file is a test
  file: a stories file that imports the others eagerly (`import.meta.glob(..., { eager: true })`) breaks their tests
  ("Vitest failed to find the current suite"), even with its own stories tagged `!test`; load them lazily at render.
  A story that opens a dialog (`defaultOpen`) covers a page that renders it among others, and blocks clicks there.
- shadcn CLI 4.21.1 (in the template): `build`, `search`, `view`, `docs` and an `mcp` server; registry items carry
  `cssVars` (theme/light/dark), `css`, `dependencies` and `registryDependencies`.
- Tailwind v4 + Vite: imports are inlined where they stand, and the optimizer drops an `@import url()` that is not
  the first rule ("@import rules must precede all rules aside from @charset and @layer statements", a build
  warning only), so `src/index.css` imports `fonts.css` before `tailwindcss`. Storybook's default `layout`
  ("padded") puts a component against the top left; the template sets "centered" in preview parameters.
- Google DESIGN.md spec (alpha): sections Overview, Colors, Typography, Layout, Elevation & Depth, Shapes,
  Components, Do's and Don'ts; no multi-brand or mode support, hence one composed file per brand.
