# Plinth

Create and maintain a multi-brand design system by talking to Claude Code. Describe the product, paste a screenshot,
and get design tokens, design and writing guidelines, and shadcn/ui components, reviewed change by change in a
local UI and published as Storybook on GitHub Pages.

See [PRD.md](PRD.md) for the product definition.

> **Status: early.** The engine, MCP server, review UI and template are tested (`npm test`, plus 39 Storybook tests
> in a generated workspace). Using it end to end inside a real Claude Code session and publishing to GitHub have not
> been exercised by many people yet. Expect rough edges; issues and pull requests are welcome.

## How it works

```
 you ──▶ Plinth UI (http://localhost:4319)          chat · Tokens · Components · Guidelines · Changes · History
           │  ▲
   channel │  │ reply tool, permission prompts
           ▼  │
       Claude Code ──MCP tools──▶ Plinth server ──▶ your design-system repo (git)
                                                      tokens/, brands/<id>/, DESIGN.md, WRITING.md,
                                                      src/components/<name>/, .storybook/
```

- You can talk to Claude either in the Plinth UI's chat or in the Claude Code terminal. UI messages reach the
  session through a Claude Code [channel](https://code.claude.com/docs/en/channels); Claude answers in the UI, and
  permission prompts appear there with Allow / Deny.
- Claude never writes files directly. It **proposes** a change; you review it in the UI (old → new values, contrast
  before → after) and press **Apply**. Every applied change is a git commit; **History** restores any version.
- Tokens are DTCG. Each brand has its own semantic values for light and dark; all brands share the same components.
- Checks run on every change: WCAG contrast for every brand × mode (with deterministic fixes that keep the hue),
  token consistency across brands, and no hardcoded values in components.
- **Publish** writes a complete DESIGN.md per brand (Google's DESIGN.md format), pushes to GitHub and deploys
  Storybook with GitHub Actions.

## Use it

Requirements: Node 20+, git, Claude Code signed in with a claude.ai account or a Console API key. For publishing:
the GitHub CLI (`gh auth login --web`).

**1. Install** (once):

```bash
claude plugin marketplace add jiashengchen610/Plinth
claude plugin install plinth@plinth
```

**2. Start** in an empty folder for your design system, with the chat channel enabled:

```bash
claude --dangerously-load-development-channels plugin:plinth@plinth
```

Claude Code shows a warning that you are loading a development channel; choose *I am using this for local
development*. Channels are a Claude Code research preview, and only Anthropic-approved channels load without this
flag. On claude.ai Team and Enterprise plans an admin must enable channels first. Without the flag, everything
still works from the terminal; only the UI chat is off.

**3. Talk**, in the terminal or in the UI chat (ask Claude for the UI link, or open http://localhost:4319):

> Create a design system for a budgeting app for young professionals. Warm and trustworthy, dark mode matters.

Claude scaffolds the repo and proposes tokens and guidelines for you to review in **Changes**. Then:
"make a pricing card from this screenshot", "add a kids brand", "publish".

Keep the Claude Code session open while you use the UI: it is the engine behind the chat.

## Repository layout

| Path | What |
|---|---|
| `engine/` | Deterministic core, zero dependencies: color math and contrast repair, token build (multi-brand × mode CSS, Tailwind v4 `@theme`), checks, DESIGN.md composition, workspace and versioning |
| `server/` | MCP server (stdio, zero dependencies) and the local UI's HTTP API |
| `app/` | Review UI (React, shadcn/ui). `app/dist` is committed so the plugin needs no build step |
| `template/` | Skeleton of a user's design-system repo |
| `skills/` | How Claude uses the tools: create, change, create a component, publish |
| `hooks/` | Guardrail: flags hardcoded values Claude writes into a design-system workspace |
| `test/` | `npm test`: engine unit tests and an end-to-end MCP test |
| `legacy/` | The earlier plugin prototype, kept for reference |

## Develop

```bash
npm test              # engine + MCP end-to-end (no install needed)
npm run build:app     # rebuild app/dist after UI changes
npm run dev:app       # UI with hot reload; proxies /api to a running server on :4319
```

## Contributing

Issues and pull requests are welcome. Before opening a pull request:

- Read [PRD.md](PRD.md); changes outside its scope (Figma sync, non-React frameworks, other model providers) belong
  in a separate project.
- Keep `engine/` and `server/` free of dependencies; the plugin must run without `npm install`.
- Run `npm test`. If you change `app/src`, run `npm run build:app` and commit `app/dist`.
- If you change `template/`, create a workspace from it and run its Storybook tests (`npm ci && npm test`).

## License

[MIT](LICENSE).

The components in `template/` and `app/` start from [shadcn/ui](https://ui.shadcn.com) (MIT). The token format
follows the [W3C Design Tokens Community Group](https://www.designtokens.org) specification, and exported guidelines
follow Google's [DESIGN.md](https://github.com/google-labs-code/design.md) format.
