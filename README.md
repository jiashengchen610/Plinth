# Plinth

Create and maintain a multi-brand design system by talking to Claude. Answer a few questions (most are one click:
a palette, corners, a font), and get design tokens, design and writing guidelines, and shadcn/ui components. Every
change applies at once in a local UI and can be undone; you decide when to save a version, and you publish the result
as Storybook on GitHub Pages, with pages for the tokens and guidelines next to the components. The whole loop is four
steps in one UI, with Claude in a chat beside them: Describe → Style → Components → Publish.

See [PRD.md](PRD.md) for the product definition (in Traditional Chinese), including what is built and what is not.

> **Status: early (0.5).** Tested by `npm test` (22 tests), by the 42 story tests in a generated workspace, and
> end to end on Windows 11: brief → changes → publish to a new GitHub repository → Storybook live on GitHub Pages
> ([example](https://jiashengchen610.github.io/plinth-demo/)). Few people have used it yet, and macOS and Linux are
> untested. Expect rough edges; issues and pull requests are welcome.

## Contents

- [How it works](#how-it-works)
- [Use it](#use-it)
- [What you get](#what-you-get)
- [Checks and reminders](#checks-and-reminders)
- [What stays in sync](#what-stays-in-sync)
- [Data flow and privacy](#data-flow-and-privacy)
- [Reference: MCP tools, skills, configuration](#reference)
- [Limitations and known issues](#limitations-and-known-issues)
- [Develop](#develop)

## How it works

```
 you ──▶ Plinth UI (http://localhost:4319)            Claude Code in the folder (terminal, IDE)
           Describe → Style → Components → Publish           │ Plinth plugin
           chat · Undo · Save · History                      │
           │                                                 │ tool calls
           ▼                                                 ▼
       Plinth (one per folder) ◀──────────────────────────────┘
           │ ▲  spawns Claude Code headless for the chat and the review
           ▼ │
       your design-system repo (git) ──push──▶ GitHub: `plinth check`, tests, Storybook
```

Three rules shape everything:

1. **Changes apply at once, the program verifies, you save.** Claude changes the design through Plinth's tools, and
   so do the UI's editors. The engine checks each change before writing it: invalid edits and references to tokens
   that do not exist are refused. Everything else applies at once, with reminders (contrast before → after,
   look-alike role colors, guideline sentences that went stale) and an **Undo**. Nothing is committed until you
   press **Save version**, and nothing leaves your computer until you **Publish**.
2. **Anything a program can compute is computed, not guessed.** Contrast ratios and fixes, CSS output, font loading,
   the DESIGN.md YAML, and rename follow-through are deterministic code in `engine/`. Claude writes the parts that
   need judgement: values, prose, components.
3. **Tokens are the single source of truth, in layers.** The **palette** at the bottom is Tailwind's colors, radius
   and shadow scales, plus colors you add (one color becomes a 50–950 scale). Semantic **roles** (`primary`,
   `muted-foreground`, `radius/control`) point at palette steps, per brand and mode. **Component tokens**
   (`button/default/background`) point at roles, and components use only those. Change a palette step, a role or one
   component's token, and everything above it follows. You can add your own layers in between.

The chat runs **Claude Code** on your computer, once per message, with the Plinth plugin loaded. Only Plinth's
tools and read-only file tools (`Read`, `Glob`, `Grep`) are allowed; `Write`, `Edit` and `Bash` are disallowed, so
every change goes through the engine. Plinth has no model and no API key of its own, and usage counts against your
Claude plan. A thread resumes across messages and restarts; **New thread** starts over, and **Stop** interrupts a
running turn.

AI steps in at two moments only: when you talk to it, and when you press **Publish** (Claude reads everything since
the last publish and points out what contradicts the guidelines; suggestions only). Edits you make by hand get the
program's checks, which are instant and free.

## Use it

### Requirements

| Need | Why | Check |
|---|---|---|
| Node 20+ | runs Plinth | `node --version` |
| git | versions are commits | the launcher checks it and offers to install it |
| [Claude Code](https://claude.com/claude-code), signed in | drives the chat and the review | the launcher checks it and offers to install and sign in |
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

Then the UI opens at http://localhost:4319. Keep the terminal window open while you use it. Four steps, each with
its main button in the bar at the bottom of the screen:

1. **Describe.** Say what you're making ("a budgeting app for young professionals"). Claude reads that one answer
   (a few seconds, a cheap model) and suggests the rest: how it should feel, a palette, corners, a font and the
   components you'll likely need. Keep each suggestion with **Next**, pick another, say it your own way, or let Claude
   decide. **Create my design system** then sets up the repo, applies the colors, corners and font at once (no AI),
   and asks Claude in the chat to write the style guides and any extra components you picked. The result is saved as
   your first version. Dependencies for the preview install in the background (1–3 minutes, once).
2. **Style.** Main color, grays, corners and font, with a sample screen in light and dark. Each pick re-points the
   roles at palette steps the engine chooses for readable text. **Things to look at** lists text that is hard to read
   and colors that look alike, with **Fix it** or **That's on purpose**.
3. **Components.** The real component in Storybook, and a graph of how it gets its colors: its parts → your colors
   (roles) → base colors (palette). Click a part, then a color, to connect them. Add components (Claude writes them)
   or remove ones nothing else uses.
4. **Publish** (optional). Save your changes as a version first; Claude's review appears (suggestions only). The first
   time, press **Connect GitHub** (a GitHub page opens; enter the code shown and authorize), then choose the
   repository name and who can see the component site. On GitHub's free plan choose **Anyone with the link**: Pages
   does not work for private repositories there.

The chat with Claude stays on the right once the design system exists: "make the primary blue", "use Inter", "add a
kids brand", "make a pricing card from this screenshot" (attach or paste images). **Try asking** suggests sentences
for the page you're on. **Undo** at the top takes the last change back, whoever made it; **History** lists what isn't
in a version yet, saves a version, throws changes away, and restores any saved version.

Options: `npx -y github:jiashengchen610/Plinth <folder> --port 4400 --no-open --no-setup`. If Plinth already runs
for the folder, the command opens that one instead of starting a second.

### From Claude Code

Run Claude Code in the design-system folder with the plugin installed (`claude plugin install plinth@plinth` from the
`jiashengchen610/Plinth` marketplace), or from a checkout with `claude --plugin-dir <path>`. It uses the same Plinth
as the UI: if the UI is running, the session's tool calls go to it, so the UI shows its changes live and **Undo**
covers them; if not, the session starts one, and the UI is at the address `open_ui` returns. A session is a
separate conversation from the UI chat.

### Every edit is checked

Plinth does not try to stop edits from elsewhere. Whoever changes the files (Claude through the tools, you in the UI,
an editor, git, another tool), the result is checked the same way:

- **On your computer**: Plinth watches the folder. A token edited by hand regenerates the CSS, fonts and Foundations
  data, and the UI shows the checks for the new state. Editing directly skips what the tools do for you (a rename
  that follows every reference, contrast fixes), so the tools are still the easier way.
- **On GitHub**: the deploy workflow runs `plinth check` from a pinned Plinth release before building Storybook. A
  token reference to nothing, generated files that no longer match the tokens, and components outside the component
  format (no component tokens, no story, or hardcoded values) stop the deploy; the previous Storybook stays online.
  Design reminders are listed in the run summary. Run the same check locally with
  `npx -y github:jiashengchen610/Plinth check`.

## What you get

The folder becomes a normal git repository that you own. It contains no Plinth code.

```
my-design-system/
├── tokens/
│   ├── primitives.tokens.json     the palette: Tailwind's colors, radius and shadow scales, plus added colors
│   ├── base.tokens.json           shared roles: radius roles, fonts, typography, elevation, motion
│   ├── components/<name>.tokens.json   each component's tokens, pointing at roles
│   └── layers/<id>.tokens.json    layers you add between the others (optional)
├── brands/<id>/
│   ├── tokens.json                the brand's color roles, light and dark, pointing at the palette
│   └── DESIGN.md                  the brand's style, intent, do's and don'ts
├── DESIGN.md                      guidelines shared by all brands
├── WRITING.md                     voice, tone, interface copy rules, terminology
├── design-system.json             name, context, brands, accepted exceptions
├── CLAUDE.md                      Plinth-managed: how Claude Code works in this folder
├── src/
│   ├── styles/tokens.css          generated: CSS variables per brand × mode + Tailwind v4 @theme
│   ├── styles/fonts.css           generated: Google Fonts imports for the font tokens
│   └── components/<name>/         <name>.tsx, <name>.stories.tsx, <name>.spec.md
│   └── foundations/               Storybook pages: Introduction, Colors, Typography, Shape, Guidelines
├── exports/<brand>/DESIGN.md      written at publish: complete DESIGN.md per brand (Google format)
├── .storybook/                    brand and mode toolbar
└── .github/workflows/storybook.yml   plinth check, typecheck, story tests, then deploy to GitHub Pages
```

- **Starting point**: Button, Input, Card, Badge and Label from shadcn/ui; semantic colors from shadcn plus
  `success`, `warning` and `info` (each with a `-foreground`).
- **Modes**: a token's `$value` is light; other modes live in `$extensions.plinth.modes.<mode>`.
- **New components** are written spec first (`<name>.spec.md`: parts, states, props, tokens, accessibility); Claude
  summarises the spec and asks before writing the code. Each component has its tokens in
  `tokens/components/<name>.tokens.json` and a story. Supported: variants of existing components, compositions of
  them, and known accessible patterns on Radix (dialog, tabs, combobox, date picker …). Novel interactions are not
  supported yet.
- **DESIGN.md** follows Google's format. You write prose in two layers (shared + per brand); at publish the engine
  merges them and generates the YAML front matter from the tokens, one file per brand.
- `.ds/` holds Plinth's working state: the undo history, chat history, attached images, and the note that keeps one
  Plinth per folder. It is gitignored and never pushed.

## Checks and reminders

Design findings are reminders: shown with each change and in Checks, listed at publish, never blocking. What blocks
is what would break, or what skips the component format: a token reference to nothing (the styles would break), type
errors, failing interaction tests, and components without their tokens or a story, or with hardcoded values.

| Check | When | Blocks publish | Fix |
|---|---|---|---|
| Token references: aliases resolve, no cycles, every brand defines the same names | every change (refused), Publish, GitHub | **yes** | ask Claude |
| WCAG AA contrast (4.5:1) for every `X` / `X-foreground` and `…-background` / `…-foreground` pair, text on the page, translucent component surfaces composited over the page, in every brand × mode | every change | no | **Fix contrast**: a role on the palette moves to another step of the same hue; a fixed value moves its lightness. The palette itself is never edited |
| Layers: a token pointing at a higher layer; a role with a fixed value instead of a palette step | every change | no | **Link colors to the palette** (closest visually identical step) |
| Look-alike roles: primary, destructive, success, warning and info too close (ΔE_OK < 0.08 or < 20° of hue) | every change | no | move one, or mark the pair as intended |
| Component format: every component has `tokens/components/<name>.tokens.json` and a story | Publish, GitHub | **yes** | ask Claude |
| Hardcoded values in components: hex, color functions, Tailwind arbitrary values, magic px | every change (reminder) | **yes**, at Publish and on GitHub | ask Claude, or accept it as an exception |
| Generated files match the tokens (`tokens.css`, `fonts.css`, Foundations data) | GitHub | **yes** | open the folder in Plinth (it regenerates), save, push |
| TypeScript and every story's interaction tests (Vitest browser mode); accessibility (axe) reported as warnings | **Run tests**, Publish, GitHub | interaction and types: **yes** | ask Claude |

Only text-on-surface pairs are checked for contrast; borders, rings and shadows are decorative and are not. When
a pair is decorative in your product, or you accept a finding on purpose, **Accept** it in Checks with a reason.
The exception is recorded in `design-system.json` (`*` matches any brand or mode) and listed at publish.

Publish pushes saved versions: unsaved changes are saved first → the checks GitHub will run → `exports/<brand>/DESIGN.md`
→ commit → typecheck and story tests → push (creating the repo on first publish) → enable GitHub Pages. GitHub
Actions runs `plinth check` and the tests again and deploys Storybook only if they pass, so a failing push leaves the
previous Storybook online.

## What stays in sync

| You change | Updated automatically |
|---|---|
| any token (through Plinth, or in the file by hand while Plinth runs) | `src/styles/tokens.css` at once |
| a font token (any Google Fonts family) | `src/styles/fonts.css` at once |
| a token's name (`rename`) | aliases in all token files, and utilities in components (`bg-old` → `bg-new`, `text-old/80`, `var(--old)`) |
| a color's hue family (pink → blue) | the change's reminders list sentences in DESIGN.md that still name the old hue; Claude rewrites them in a follow-up change |
| tokens or brand prose | the DESIGN.md YAML at publish |
| tokens, DESIGN.md, WRITING.md | the Storybook Foundations and Guidelines pages (they read the files directly) |

## Data flow and privacy

| Step | Goes to | Leaves your computer? |
|---|---|---|
| Your messages, attached images, and the token / guideline / component content Claude reads through the tools | Anthropic, through your Claude Code sign-in | **Yes**, the same as any Claude Code session. Plinth's own code is never sent. |
| The review at publish: the changes since the last publish and the guidelines | Anthropic, through your Claude Code sign-in | **Yes** |
| Your first answer in Describe (what you're making), for the suggestions | Anthropic, through your Claude Code sign-in | **Yes**: only that text, no files |
| Plinth UI, engine, checks, tests | localhost (127.0.0.1 only, per-session token) | No |
| Install dependencies | the npm registry, and Playwright's browser download | Package requests only |
| Fonts | Google Fonts, from the browser showing Storybook, your app, or the font choices in the Plinth UI | Font requests only (no content) |
| Publish | GitHub (your account, private by default) | Yes, your design-system repo |

The UI accepts requests only from localhost, with a token issued per session, and refuses other host names to
block DNS rebinding. Images you attach are stored in `.ds/inbox/` and stay out of git.

## Reference

### MCP tools

| Tool | What it does |
|---|---|
| `status` | Brands, components, unsaved changes, the last change, versions, checks, dependencies, last test run, URLs |
| `create_design_system` | Scaffold from the template and make the first version |
| `install_dependencies` | `npm install` plus the Playwright browser |
| `get_tokens`, `get_guidelines`, `list_components` | Read the system (per brand) |
| `change` | Ops (`set`, `delete`, `rename`, `write`, `remove`), validated and written at once, with reminders |
| `undo` | Take back the newest change |
| `set_style` | Main color, grays, corners, font in one step (what the Style step does): roles re-pointed at readable palette steps |
| `remove_component` | A component's folder and token file as one undoable change; refused when other code imports it |
| `add_palette_color` | Add a color to the palette as a 50–950 scale |
| `upgrade_to_layers`, `link_to_palette` | Move a design system made before layers onto them; point fixed colors at the palette |
| `run_checks`, `fix_contrast` | Deterministic checks; computed contrast fixes, applied |
| `run_tests` | Typecheck and story tests in the workspace |
| `review_changes` | Everything since the last publish, token by token, for the review |
| `save_version`, `list_versions`, `restore_version` | Versions (the user decides when to save); a restore is a new version |
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
| `publish-design-system` | review, check and publish to GitHub and Pages |

`hooks/` adds a guardrail for Claude Code sessions: it flags hardcoded values in files Claude writes inside a
design-system folder.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PLINTH_PORT` | 4319 | UI port (the next free port is used if taken) |
| `PLINTH_WORKSPACE` | current folder | Design-system folder |
| `PLINTH_MODEL` | Claude Code's default | Model for the UI chat, e.g. `sonnet` |
| `PLINTH_REVIEW_MODEL` | `haiku` | Model for the review at publish |
| `PLINTH_SUGGEST_MODEL` | `haiku` | Model for the suggestions after the first answer in Describe (one run, no tools) |
| `PLINTH_NO_INSTALL` | unset | Set it to stop Create from installing dependencies (tests, CI) |
| `PLINTH_CLAUDE_BIN` | `claude` | Claude Code executable |

In `design-system.json`: `contrastPairs` (extra `[bg, fg, min]` pairs), `distinctRoles`, `distinctMin`,
`distinctHue`, `exceptions`, `hardcoded.allowFiles`.

## Limitations and known issues

- Token naming is shadcn only. Material 3 and Apple HIG naming are planned (see PRD).
- Decided but not built yet (PRD, "下一版"): a built-in catalog of about 16 ready-made components (today five come
  ready-made and Claude writes the others, about US$1.50 each), starting from something you have (a Storybook, a
  website, a GitHub repo; the Describe step shows the option as coming later), and a shadcn registry plus
  `plinth connect` so product repos get components and ask Plinth for new ones.
- The five template components can't be removed: the Foundations pages of the component site use them.
- Not built yet, although the PRD lists them: importing DTCG / Tokens Studio / DESIGN.md files, the token usage
  index ("used by these components"), screenshot previews, behavior that depends on the context (mobile vs
  dashboard), touch-target and same-radius checks, a CHANGELOG at publish, and publishing through a pull request.
- Fonts load from Google Fonts at runtime. Self-hosted fonts are not supported yet.
- One chat message runs at a time.
- Windows with Node 24: two runtime bugs abort Node without an error (`fs.cpSync` into `D:\<folder>`, and
  `process.exit()` right after `fetch`). Plinth avoids both, and a test keeps `cpSync` out. If you see
  "Connection closed" from Plinth's tools, please open an issue with the folder path and your Node version.

## Repository layout

| Path | What |
|---|---|
| `engine/` | Deterministic core, zero dependencies: color math and contrast repair, token build, font loader, checks and exceptions, prose staleness, DESIGN.md composition, workspace, changes and undo, versions, `plinth check` (`check.mjs`) |
| `server/` | MCP server (stdio), the UI's HTTP API, one Plinth per folder (`owner.mjs`), the headless Claude Code chat and review, the test runner, publish, the `plinth` launcher (`cli.mjs`). Zero dependencies |
| `app/` | The UI (React, shadcn/ui). `app/dist` is committed so nothing needs building at install |
| `template/` | Skeleton of a user's design-system repo (`gitignore` has no dot because npm drops dotted ones; the engine renames it) |
| `skills/`, `hooks/` | How Claude uses the tools; the hardcoded-value guardrail |
| `test/` | `npm test` |

## Develop

```bash
npm test                        # 22 tests: engine, checks, scaffold from an npx-style install, MCP end to end
                                #   (one Plinth per folder, UI edits), UI chat and review with a stand-in for `claude`
npm run build:app               # rebuild app/dist after changing app/src
npm run dev:app                 # UI with hot reload; proxies /api to a server on :4319
node server/cli.mjs <folder>    # the UI against a folder, from this checkout
node server/cli.mjs check <folder>   # the checks the deploy workflow runs
claude --plugin-dir .           # the plugin from this checkout in a Claude Code session
```

Before a release, also: create a workspace from `template/` and run `npm ci && npm run typecheck && npm test`
(42 story tests), and run one real brief through an `npx` install in a folder like `D:\demo`. Most bugs so far
showed up only in that setup. Then tag the release (`v<version>` from `package.json`) and push the tag: the deploy
workflow of every published design system runs `plinth check` from that tag.

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
