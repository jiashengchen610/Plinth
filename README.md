# Plinth

Create and maintain a multi-brand design system by talking to Claude. Describe the product, paste a screenshot,
and get design tokens, design and writing guidelines, and shadcn/ui components, reviewed change by change in a
local UI and published as Storybook on GitHub Pages. One UI does the whole loop: describe → review → apply → check
→ publish.

See [PRD.md](PRD.md) for the product definition.

> **Status: early.** The engine, server, UI and template are tested (`npm test`, plus the story tests in a generated
> workspace). Few people have used it end to end yet. Expect rough edges; issues and pull requests are welcome.

## How it works

```
 you ──▶ Plinth UI (http://localhost:4319)
           chat · Tokens · Components · Guidelines · Changes · Checks · History · Publish
           │
           ▼
       Plinth server ──spawns──▶ Claude Code (headless, your plan, Plinth tools only)
           │                         │ propose_change, run_checks, …
           │◀────────────────────────┘
           ▼
       your design-system repo (git): tokens/, brands/<id>/, DESIGN.md, WRITING.md,
                                      src/components/<name>/, .storybook/, .github/workflows/
```

- The chat runs **Claude Code** on your computer for each message, with the Plinth plugin loaded and only Plinth's
  tools plus read-only file tools allowed. Plinth has no model of its own and no API key; usage counts on your
  Claude plan. The thread resumes across messages and restarts.
- Claude never writes files directly. It **proposes** a change; you review it in **Changes** (old → new values,
  contrast before → after, look-alike role colors, guideline sentences that would go stale) and press **Apply**.
  Every applied change is a git commit; **History** restores any version.
- Tokens are DTCG. Each brand has its own semantic values for light and dark; all brands share the same components.
  Fonts named in tokens load automatically (Google Fonts); the CSS is generated from the tokens on every change.
- **Checks** run on every change: WCAG contrast for every brand × mode (with deterministic fixes that keep the hue),
  role colors that must stay distinguishable, token consistency across brands, no hardcoded values in components.
  A finding you accept on purpose is recorded as an exception and listed at publish.
- **Publish** runs the checks and the workspace's own tests (TypeScript, every story's interaction and
  accessibility tests), writes a complete DESIGN.md per brand (Google's DESIGN.md format), pushes to GitHub and
  deploys Storybook with GitHub Actions, which runs the tests again before deploying.

## Use it

Requirements: Node 20+, git, [Claude Code](https://claude.com/claude-code) installed and signed in (run `claude`
once). For publishing: the GitHub CLI (`gh auth login --web`).

**From the UI** (recommended), in an empty folder for your design system:

```bash
npx -y github:jiashengchen610/Plinth
```

The Plinth UI opens at http://localhost:4319. Type the brief in the chat:

> Create a design system for a budgeting app for young professionals. Warm and trustworthy, dark mode matters.

Claude scaffolds the repo and proposes tokens and guidelines; review them in **Changes** and press Apply. Then:
"make a pricing card from this screenshot", "add a kids brand", "use Inter", and **Publish**. Keep the terminal
window open while you use the UI.

**From the Claude Code terminal** (plugin), if you prefer to talk in the terminal and use the UI for review:

```bash
claude plugin marketplace add jiashengchen610/Plinth
claude plugin install plinth@plinth
cd my-design-system && claude
```

The plugin starts the same UI; ask Claude for the link or open http://localhost:4319. Both ways can be used on the
same folder.

## Repository layout

| Path | What |
|---|---|
| `engine/` | Deterministic core, zero dependencies: color math and contrast repair, token build (multi-brand × mode CSS, Tailwind v4 `@theme`), font loader, checks (contrast, distinct roles, hardcoded values, exceptions), DESIGN.md composition, workspace and versioning |
| `server/` | MCP server (stdio, zero dependencies), the UI's HTTP API, the headless Claude Code chat, tests runner, publish |
| `app/` | The UI (React, shadcn/ui). `app/dist` is committed so the plugin needs no build step |
| `template/` | Skeleton of a user's design-system repo |
| `skills/` | How Claude uses the tools: create, change, create a component, publish |
| `hooks/` | Guardrail for terminal sessions: flags hardcoded values Claude writes into a design-system workspace |
| `test/` | `npm test`: engine unit tests, MCP end-to-end, chat end-to-end (with a stand-in for `claude`) |

## Develop

```bash
npm test              # engine + MCP + chat end to end (no install needed)
npm run build:app     # rebuild app/dist after UI changes
npm run dev:app       # UI with hot reload; proxies /api to a running server on :4319
node server/cli.mjs <folder>                 # run the UI against a folder
claude --plugin-dir . # load the plugin from this checkout in a Claude Code session
```

## Contributing

Issues and pull requests are welcome. Before opening a pull request:

- Read [PRD.md](PRD.md); changes outside its scope (Figma sync, non-React frameworks, other model providers) belong
  in a separate project.
- Keep `engine/` and `server/` free of dependencies; the plugin must run without `npm install`.
- Run `npm test`. If you change `app/src`, run `npm run build:app` and commit `app/dist`.
- If you change `template/`, create a workspace from it and run its tests (`npm ci && npm run typecheck && npm test`).

## License

[MIT](LICENSE).

The components in `template/` and `app/` start from [shadcn/ui](https://ui.shadcn.com) (MIT). The token format
follows the [W3C Design Tokens Community Group](https://www.designtokens.org) specification, and exported guidelines
follow Google's [DESIGN.md](https://github.com/google-labs-code/design.md) format.
