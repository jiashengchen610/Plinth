# design-system-skills

Claude Code plugin that lets an AI agent build **Storybook components from Figma or external design
specs on top of an existing design system**, instead of inventing a parallel one.

```
Ingest ──► Normalize ──► Generate ──► Verify ──► Sync
Figma /     DTCG tokens   component    story renders  figma-map.json
open-source manifest      + stories    test-run       Code Connect (optional)
DS / spec   figma-map     + tests      visual diff    drift report
```

Status: **Phases 0–4 written and locally tested** (`npm test` → all green; 6 skills, 1 agent, 11 scripts, reference
project with 5 AI-ready components and 39 passing story tests). **Figma is shelved** (decision 2026-10-07): the token
layer in the repo is a superset of what Figma Variables can hold (shadows, gradients, typography, motion), so the
primary inputs are screenshots, specs, composition JSON and DTCG token files. Figma's role is a **discussion mirror of
the code**: finished components get batch-published to Figma at release time (`storysync` or the official
`generate_figma_design`; no Code Connect required), and feedback from Figma comes back as screenshots or natural
language. The Figma-reading paths (`ds-figma-map`, `ds-tokens` direction A) stay as optional accelerators and are not
exercised end-to-end.

## What it adds on top of existing tools

| Already exists (reused) | This plugin adds |
|---|---|
| Storybook 10.6 component manifests + `@storybook/addon-mcp` | Making a shadcn/ui Storybook *AI-ready* (descriptions, stories per variant, docs MDX) and snapshotting manifests into the repo |
| Official Figma plugin skills (`figma-design-to-code`, `figma-code-connect`, `figma-use`) | Mapping Figma nodes to **existing** design-system components via `figma-map.json`, with Code Connect as an optional publish target |
| `southleft/skills-for-figma` (`export-tokens-figma` → DTCG on any Figma plan) | Token build into shadcn's CSS variables (Style Dictionary), token-gap reporting, hardcoded-value guardrail |
| `storysync` (code → Figma, drift diff) | Verification loop: test-run + a11y + visual diff against the Figma screenshot, plus an audit report |

## Skills (planned)

| Skill | Purpose |
|---|---|
| `ds-adopt` | Vendor shadcn/ui, set up Storybook 10.6 with manifests + MCP, write story conventions and CLAUDE.md rules |
| `ds-tokens` | DTCG (`.design-system/tokens.json`) → CSS variables + Tailwind `@theme` entries, including composite tokens (shadow, gradient, typography, easing, transition); inputs: a dropped DTCG / Tokens Studio file, existing CSS, an external spec, or (optional) Figma variables |
| `ds-component` | Screenshot / spec / composition JSON / optional Figma node → map to existing components → component + stories + tests → visual diff → review gate |
| `ds-figma-map` | Optional: maintain `figma-map.json` (design names ↔ components); publish Code Connect when the Figma plan allows |
| `ds-audit` | Drift between design inputs, tokens and code; story coverage; hardcoded values |
| `ds-migrate` | Batch a queue of design items through `ds-component` with resumable state |

## Prerequisites

- Node 18+ (tested on Node 24, Windows 11).
- A React + TypeScript project. Storybook 10.6+ is installed by `ds-adopt` if missing.
- **Figma MCP**: the official `figma` Claude Code plugin. Authorize once in an interactive session with `/mcp`.
  Credentials are stored by Claude Code; this plugin never stores Figma tokens.
- **skills-for-figma**: `claude plugin marketplace add southleft/skills-for-figma` then install `skills-for-figma`.
- Optional: `storysync` (`npx storysync`) for code → Figma sync and drift diff.

## Install (development)

```bash
claude --plugin-dir "D:/design system skills"
```

The plugin registers a Storybook MCP server at `http://localhost:6006/mcp` (`.mcp.json`). Start Storybook
in the target project before using the docs / test tools.

## Scripts

| Script | What it does |
|---|---|
| `scripts/check-hardcoded.mjs` | Flags hex / color-function / Tailwind-arbitrary / magic-px values and leaked `figd_` tokens. Runs as a PostToolUse hook on every Write/Edit. |
| `scripts/snapshot-manifest.mjs` | Copies `manifests/components.json` + `docs.json` into `.design-system/` (full + slim index with corrected alias imports) and prints an AI-readiness report. |
| `scripts/storybook-ai-ready.mjs` | Idempotently enables `componentsManifest`, `react-docgen-typescript`, addon-mcp, CSS import in preview, writes `.design-system/config.json` and the project `.mcp.json`. |
| `scripts/build-tokens.mjs` | DTCG (`.design-system/tokens.json`) → CSS variables in a managed region of the CSS entry, with modes, aliases, `@theme inline` entries, drift `--check` and a token-gap report. Zero dependencies. |
| `scripts/css-to-dtcg.mjs` | Reverse: extracts `:root` / `.dark` variables into DTCG so they can be pushed to Figma with `import-tokens-figma`. |
| `scripts/validate-figma-map.mjs` | Structural checks on `figma-map.json` plus cross-checks against the manifest (component, props, story id, import). |
| `scripts/visual-diff.mjs` | Screenshots a story at the Figma PNG's scale, compares with pixelmatch, writes `diff.png` and `side-by-side.png` for the reviewer. Exit 1 = pixel mismatch, 2 = layout/size mismatch. |
| `scripts/figma-map-to-code-connect.mjs` | Generates parserless `<name>.figma.ts` Code Connect templates from confirmed mappings, leaving `TODO(code-connect)` markers for what only the Figma file can tell. |
| `scripts/ds-audit.mjs` | One report: AI-readiness, hardcoded values, mapping validity, variant story coverage, token drift and freshness, pending decisions. |

## Testing

Four layers, from cheapest to most complete:

| Layer | Command | What it proves |
|---|---|---|
| 1. Plugin selftest (offline, ~10 s) | `npm test` | every script parses; guardrail rules; Storybook setup patching is idempotent; migration queue; demo knowledge layer is consistent (map ↔ manifest, tokens ↔ CSS, audit clean) |
| 2. Live Storybook | `npm run demo:storybook` then `npm run test:live` | manifests are served, the Storybook MCP answers `tools/list`, visual-diff runs end to end |
| 3. Story tests | `npm run test:all` (or `npm run demo:vitest`) | the 5 demo components pass interaction + a11y tests (`a11y.test = "error"`) |
| 4. Skills in Claude Code | `claude --plugin-dir "<this repo>"` then ask e.g. *"make this Storybook AI-ready"* | the right skill triggers; the PostToolUse hook flags hardcoded values when a `.tsx` is written |

Figma-dependent paths (`ds-component` reading a node, `ds-tokens` direction A, Code Connect publish) can only be
tested after `/mcp` authorization in an interactive session; run `ds-component` on one real Button node and check
the six acceptance items: story renders, tests pass, no a11y violations, visual diff within threshold, no hardcoded
values, `figma-map.json` updated.

First-time setup for layers 2–3: `npm run demo:install`, then `npx playwright install chromium` inside `examples/demo-react`.

## Data flow and privacy

| Step | Data goes to | Code leaves the machine? |
|---|---|---|
| Figma MCP | Figma cloud → agent (design data already lives in Figma) | No. Only Code Connect *publish* uploads snippet templates; skip it to avoid that. |
| Storybook MCP | localhost | No. Chromatic hosting is optional. |
| Scripts | local | No. |
| The model | prompt | **Yes — the only egress.** Run Claude through your own AWS Bedrock / Google Vertex / Azure tenant if code must not reach Anthropic directly. |

## Credentials

| Need | Credential | Where it lives |
|---|---|---|
| All Figma MCP tools | OAuth via `/mcp` | Claude Code's credential store |
| Code Connect CLI publish (optional) | `FIGMA_ACCESS_TOKEN` personal access token | `.env.local` (gitignored). Prefer MCP `add_code_connect_map`, which needs no PAT. |

Never commit `.env.local` or `.claude/settings.local.json`; the hook blocks any file containing a `figd_` token.

## Layout

```
.claude-plugin/plugin.json   hooks/hooks.json   agents/   .mcp.json
skills/ds-*/                 scripts/           templates/   references/
examples/demo-react/         Vite + React + TS + Tailwind v4 + shadcn/ui (radix, nova) + Storybook 10.6
```

`skills/`, `scripts/`, `templates/`, `references/` stay agent-agnostic. `hooks/`, `agents/`, `.claude-plugin/`
are the Claude Code layer.
