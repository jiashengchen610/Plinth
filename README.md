# Plinth

Create and maintain a multi-brand design system by talking to Claude. Describe the product, paste a screenshot,
and get design tokens, design and writing guidelines, and shadcn/ui components. You review every change in a local
UI before it is written, and publish the result as Storybook on GitHub Pages, with pages for the tokens and guidelines next to the components. The whole loop happens in one UI:
describe → review → apply → check → publish.

See [PRD.md](PRD.md) for the product definition (in Traditional Chinese), including what is built and what is not.

> **Status: early (0.3).** Tested by `npm test` (13 tests), by the 42 story tests in a generated workspace, and
> end to end on Windows 11 from an `npx` install: brief → proposals → apply → publish to a new GitHub repository →
> Storybook live on GitHub Pages ([example](https://jiashengchen610.github.io/plinth-demo/)). Few people have used
> it yet, and macOS and Linux are untested. Expect rough edges; issues and pull requests are welcome.

## Contents

- [How it works](#how-it-works)
- [Use it](#use-it)
- [What you get](#what-you-get)
- [Checks and the publish gate](#checks-and-the-publish-gate)
- [What stays in sync](#what-stays-in-sync)
- [Data flow and privacy](#data-flow-and-privacy)
- [Reference: MCP tools, skills, configuration](#reference)
- [Limitations and known issues](#limitations-and-known-issues)
- [Develop](#develop)

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
       your design-system repo (git)
```

Three rules shape everything:

1. **Claude proposes, the program verifies, you apply.** Claude cannot write files. It calls `propose_change`; the
   engine dry-runs the change and attaches a preview (old → new values, contrast before → after, look-alike role
   colors, guideline sentences that would go stale). Nothing is written until you press **Apply**, and every applied
   change is a git commit you can restore from **History**.
2. **Anything a program can compute is computed, not guessed.** Contrast ratios and fixes, CSS output, font loading,
   the DESIGN.md YAML, and rename follow-through are deterministic code in `engine/`. Claude writes the parts that
   need judgement: values, prose, components.
3. **Tokens are the single source of truth.** Components use semantic token names only (`bg-primary`,
   `text-muted-foreground`), so the same components render every brand in light and dark.

The chat runs **Claude Code** on your computer, once per message, with the Plinth plugin loaded. Only Plinth's
tools and read-only file tools (`Read`, `Glob`, `Grep`) are allowed; `Write`, `Edit` and `Bash` are disallowed.
Plinth has no model and no API key of its own, and usage counts against your Claude plan. A thread resumes across
messages and restarts; **New thread** starts over, and **Stop** interrupts a running turn.

## Use it

### Requirements

| Need | Why | Check |
|---|---|---|
| Node 20+ | runs Plinth | `node --version` |
| git | every applied change is a commit | the launcher checks it and offers to install it |
| [Claude Code](https://claude.com/claude-code), signed in | drives the chat | the launcher checks it and offers to install and sign in |
| [GitHub CLI](https://cli.github.com) (publishing only) | creates the repo, enables Pages | the launcher offers to install it and sign in; or **Connect GitHub** in the Publish dialog |

Tested on Windows 11 with Node 24. macOS and Linux should work, but nobody has tested them yet.

### From the UI (recommended)

In an empty folder for your design system:

```bash
npx -y github:jiashengchen610/Plinth
```

First it checks what Plinth needs and offers to fix what is missing, right in the terminal:

```
Checking what Plinth needs…

  ✔ Node 24.11.1
  ✔ git
  ✔ Claude Code, signed in
  ✖ GitHub is not connected (only needed to publish).
    Connect GitHub now? A browser window opens; enter the code shown here. [Y/n]
```

Missing tools are installed with winget (Windows) or Homebrew (macOS) when you agree; Claude Code installs with
npm. Sign-ins (Claude Code, GitHub) open the browser. GitHub is optional at this point: you can also connect it
later from the Publish dialog. Skip the checks with `--no-setup`.

Then the UI opens at http://localhost:4319. Keep the terminal window open while you use it. Type the brief in the chat,
for example:

> Create a design system for a budgeting app for young professionals. Warm and trustworthy, dark mode matters.

Claude scaffolds the repo (about 20 seconds) and proposes tokens and guidelines (about a minute). Then:

1. **Changes**: read each proposal and press **Apply** (or **Discard**).
2. **Install dependencies** (banner at the top, 1–3 minutes, once): Storybook and the test browser.
3. **Components**: start Storybook, switch brand and light/dark in the header.
4. Keep talking: "make the primary blue", "use Inter", "add a kids brand", "make a pricing card from this
   screenshot" (attach or paste images in the chat).
5. **Checks**: fix or accept what fails; **Run tests**.
6. **Publish**: the first time, press **Connect GitHub** (a GitHub page opens; enter the code shown and authorize),
   then choose the repository name and visibility. On GitHub's free plan choose **Public**: Pages does not work for
   private repositories there, so Storybook would not go online.

Options: `npx -y github:jiashengchen610/Plinth <folder> --port 4400 --no-open --no-setup` (and `--terminal`, `--full`, below).

### From the terminal

Same pipeline, without the browser:

```bash
npx -y github:jiashengchen610/Plinth --terminal   # Claude Code here, with the UI chat's tools and conversation
npx -y github:jiashengchen610/Plinth --full       # every Claude Code tool (each asks first)
```

Both continue the UI chat's conversation, and proposals still wait in the queue: Claude shows you old → new and
applies when you say so (or you press Apply in the UI, which keeps running at the printed address). The UI chat
waits while a terminal holds the conversation. Use `--full` for work outside the design files, such as adding a
package; those edits show up as outside edits for you to record.

A plain `claude` session in the folder with the plugin installed (`claude plugin install plinth@plinth` from the
`jiashengchen610/Plinth` marketplace) works too, as a separate conversation.

### One way to change the design

Design files change only through Plinth, so every change is previewed, checked and saved as its own version:

- **Claude Code sessions** in a design-system folder cannot write tokens, guidelines, components, generated or
  Plinth-managed files: the folder's `.claude/settings.json` (managed by Plinth) denies it, whatever the mode.
- **Edits from anywhere else** (an editor, git, another tool, `--full`) are not blocked, but they are caught:
  the UI shows them as *outside edits* with **Save as a version** or **Discard**, History marks such versions,
  a Plinth change never includes them, and Publish and Restore wait until they are handled.

## What you get

The folder becomes a normal git repository that you own. It contains no Plinth code.

```
my-design-system/
├── tokens/base.tokens.json        shared scales: radius, fonts, typography, shadows, motion (DTCG)
├── brands/<id>/
│   ├── tokens.json                the brand's semantic colors, light and dark (DTCG)
│   └── DESIGN.md                  the brand's style, intent, do's and don'ts
├── DESIGN.md                      guidelines shared by all brands
├── WRITING.md                     voice, tone, interface copy rules, terminology
├── design-system.json             name, context, brands, accepted exceptions
├── .claude/settings.json          Plinth-managed: Claude Code may change design files only through Plinth
├── src/
│   ├── styles/tokens.css          generated: CSS variables per brand × mode + Tailwind v4 @theme
│   ├── styles/fonts.css           generated: Google Fonts imports for the font tokens
│   └── components/<name>/         <name>.tsx, <name>.stories.tsx, <name>.spec.md
│   └── foundations/               Storybook pages: Introduction, Colors, Typography, Shape, Guidelines
├── exports/<brand>/DESIGN.md      written at publish: complete DESIGN.md per brand (Google format)
├── .storybook/                    brand and mode toolbar
└── .github/workflows/storybook.yml   typecheck + story tests, then deploy to GitHub Pages
```

- **Starting point**: Button, Input, Card, Badge and Label from shadcn/ui; semantic colors from shadcn plus
  `success`, `warning` and `info` (each with a `-foreground`).
- **Modes**: a token's `$value` is light; other modes live in `$extensions.plinth.modes.<mode>`.
- **New components** are written spec first (`<name>.spec.md`: parts, states, props, tokens, accessibility), and
  the code follows after you approve the spec. Supported: variants of existing components, compositions of them,
  and known accessible patterns on Radix (dialog, tabs, combobox, date picker …). Novel interactions are not
  supported yet.
- **DESIGN.md** follows Google's format. You write prose in two layers (shared + per brand); at publish the engine
  merges them and generates the YAML front matter from the tokens, one file per brand.
- `.ds/` holds Plinth's working state: pending changes, chat history, attached images. It is gitignored and never
  pushed.

## Checks and the publish gate

| Check | When | Blocks publish | Fix |
|---|---|---|---|
| Token consistency: every brand defines the same names, aliases resolve | every change | yes | ask Claude |
| WCAG AA contrast (4.5:1) for every `X` / `X-foreground` pair, `foreground` and `muted-foreground` on `background`, in every brand × mode | every change, and in the proposal preview | yes | **Propose fixes**: moves the foreground's OKLCH lightness, keeps the hue |
| No hardcoded values in components: hex, color functions, Tailwind arbitrary values, magic px | every change | yes | ask Claude |
| Look-alike roles: primary, destructive, success, warning and info too close (ΔE_OK < 0.08 or < 20° of hue) | every change, and in the preview | **no**, advisory | move one, or mark the pair as intended |
| TypeScript and every story's interaction + accessibility tests (Vitest browser mode, axe) | **Run tests**, publish, GitHub Actions | yes | ask Claude |

Only text-on-surface pairs are checked for contrast; borders, rings and shadows are decorative and are not. When
a pair is decorative in your product, or you accept a finding on purpose, **Accept** it in Checks with a reason.
The exception is recorded in `design-system.json` (`*` matches any brand or mode) and listed at publish.

Publish runs: checks → `exports/<brand>/DESIGN.md` → commit → typecheck and story tests → push (creating the repo
on first publish) → enable GitHub Pages. GitHub Actions runs the tests again and deploys Storybook only if they
pass, so a failing push leaves the previous Storybook online.

## What stays in sync

| You change | Updated automatically |
|---|---|
| any token | `src/styles/tokens.css` on apply |
| a font token (any Google Fonts family) | `src/styles/fonts.css` on apply |
| a token's name (`rename`) | aliases in all token files, and utilities in components (`bg-old` → `bg-new`, `text-old/80`, `var(--old)`) |
| a color's hue family (pink → blue) | the preview lists sentences in DESIGN.md that still name the old hue; Claude rewrites them in the same change |
| tokens or brand prose | the DESIGN.md YAML at publish |
| tokens, DESIGN.md, WRITING.md | the Storybook Foundations and Guidelines pages (they read the files directly) |

## Data flow and privacy

| Step | Goes to | Leaves your computer? |
|---|---|---|
| Your messages, attached images, and the token / guideline / component content Claude reads through the tools | Anthropic, through your Claude Code sign-in | **Yes**, the same as any Claude Code session. Plinth's own code is never sent. |
| Plinth UI, engine, checks, tests | localhost (127.0.0.1 only, per-session token) | No |
| Install dependencies | the npm registry, and Playwright's browser download | Package requests only |
| Fonts | Google Fonts, from the browser showing Storybook or your app | Font requests only (no content) |
| Publish | GitHub (your account, private by default) | Yes, your design-system repo |

The UI accepts requests only from localhost, with a token issued per session, and refuses other host names to
block DNS rebinding. Images you attach are stored in `.ds/inbox/` and stay out of git.

## Reference

### MCP tools

| Tool | What it does |
|---|---|
| `status` | Brands, components, pending changes, versions, gate, dependencies, last test run, URLs |
| `create_design_system` | Scaffold from the template and make the first commit |
| `install_dependencies` | `npm install` plus the Playwright browser |
| `get_tokens`, `get_guidelines`, `list_components` | Read the system (per brand) |
| `propose_change` | Queue ops (`set`, `delete`, `rename`, `write`) with a preview; nothing is written |
| `list_pending_changes`, `apply_change`, `discard_change` | Review queue |
| `run_checks`, `propose_contrast_fixes` | Deterministic checks; computed contrast fixes as a proposal |
| `run_tests` | Typecheck and story tests in the workspace |
| `list_versions`, `restore_version` | History; a restore is a new commit |
| `record_outside_edits` | Save files changed outside Plinth as one version (when the user asks) |
| `export_design_md` | The complete DESIGN.md for one brand, with lint |
| `start_storybook`, `open_ui` | Previews and the UI link |
| `publish` | The full publish (or `dryRun`) |

Changes may only touch token files, guideline files, `design-system.json` and `src/components/`. Everything else
is refused.

### Skills

| Skill | Used when you ask to |
|---|---|
| `create-design-system` | create a design system from a description or images |
| `change-design-system` | change values, fonts, names, brands, guidelines; undo |
| `create-component` | make or change a component (spec → code → checks → tests) |
| `publish-design-system` | publish to GitHub and Pages |

`hooks/` adds a guardrail for terminal sessions: it flags hardcoded values in files Claude writes inside a
design-system folder.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PLINTH_PORT` | 4319 | UI port (the next free port is used if taken) |
| `PLINTH_WORKSPACE` | current folder | Design-system folder |
| `PLINTH_MODEL` | Claude Code's default | Model for the UI chat, e.g. `sonnet` |
| `PLINTH_CLAUDE_BIN` | `claude` | Claude Code executable |

In `design-system.json`: `contrastPairs` (extra `[bg, fg, min]` pairs), `distinctRoles`, `distinctMin`,
`distinctHue`, `exceptions`, `hardcoded.allowFiles`.

## Limitations and known issues

- Token naming is shadcn only. Material 3 and Apple HIG naming are planned (see PRD).
- Not built yet, although the PRD lists them: importing DTCG / Tokens Studio / DESIGN.md files, the token usage
  index ("used by these components"), screenshot previews, behavior that depends on the context (mobile vs
  dashboard), touch-target and same-radius checks, a CHANGELOG at publish, and publishing through a pull request.
- Fonts load from Google Fonts at runtime. Self-hosted fonts are not supported yet.
- A plain `claude` session (plugin installed) is a separate conversation from the UI chat; `--terminal` shares it.
- One chat message runs at a time.
- Windows with Node 24: two runtime bugs abort Node without an error (`fs.cpSync` into `D:\<folder>`, and
  `process.exit()` right after `fetch`). Plinth avoids both, and a test keeps `cpSync` out. If you see
  "Connection closed" from Plinth's tools, please open an issue with the folder path and your Node version.

## Repository layout

| Path | What |
|---|---|
| `engine/` | Deterministic core, zero dependencies: color math and contrast repair, token build, font loader, checks and exceptions, prose staleness, DESIGN.md composition, workspace and versioning |
| `server/` | MCP server (stdio), the UI's HTTP API, the headless Claude Code chat, the test runner, publish, the `plinth` launcher (`cli.mjs`). Zero dependencies |
| `app/` | The UI (React, shadcn/ui). `app/dist` is committed so nothing needs building at install |
| `template/` | Skeleton of a user's design-system repo (`gitignore` has no dot because npm drops dotted ones; the engine renames it) |
| `skills/`, `hooks/` | How Claude uses the tools; the hardcoded-value guardrail |
| `test/` | `npm test` |

## Develop

```bash
npm test                        # 12 tests: engine, scaffold from an npx-style install, MCP end to end
                                #   (parent and child server), UI chat end to end with a stand-in for `claude`
npm run build:app               # rebuild app/dist after changing app/src
npm run dev:app                 # UI with hot reload; proxies /api to a server on :4319
node server/cli.mjs <folder>    # the UI against a folder, from this checkout
claude --plugin-dir .           # the plugin from this checkout in a Claude Code session
```

Before a release, also: create a workspace from `template/` and run `npm ci && npm run typecheck && npm test`
(42 story tests), and run one real brief through an `npx` install in a folder like `D:\demo`. Most bugs so far
showed up only in that setup.

## Contributing

Issues and pull requests are welcome. Before opening a pull request:

- Read [PRD.md](PRD.md). Changes outside its scope (Figma sync, non-React frameworks, other model providers)
  belong in a separate project.
- Keep `engine/` and `server/` free of dependencies, `fetch` and `fs.cpSync` (see [CLAUDE.md](CLAUDE.md)).
- Run `npm test`. If you change `app/src`, run `npm run build:app` and commit `app/dist`.
- If you change `template/`, run its tests as described above.

## License

[MIT](LICENSE).

The components in `template/` and `app/` start from [shadcn/ui](https://ui.shadcn.com) (MIT). The token format
follows the [W3C Design Tokens Community Group](https://www.designtokens.org) specification, and exported guidelines
follow Google's [DESIGN.md](https://github.com/google-labs-code/design.md) format.
