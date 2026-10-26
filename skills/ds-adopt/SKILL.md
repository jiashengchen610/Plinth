---
name: ds-adopt
description: This skill should be used when the user asks to "adopt a design system", "set up shadcn with Storybook", "make Storybook AI-ready", "set up Storybook MCP", "onboard the design system for AI", "導入 design system", "讓 AI 能讀我們的元件庫", or when another ds-* skill finds no `.design-system/config.json` in the project. Installs or verifies shadcn/ui (vendored), Storybook 10.6+ with component manifests and the MCP addon, backfills AI-readable stories, and writes the project's design-system rules.
version: 0.1.0
---

# ds-adopt — make a design system consumable by AI agents

Turn a React + TypeScript project into one where an agent can discover components through Storybook's
manifests and MCP server, build only with design tokens, and verify its work with `test-run`. The
first supported adapter is **shadcn/ui** (vendored sources, Radix base). Reuse existing tooling at every
step; this skill orchestrates, it does not reimplement Storybook or shadcn setup.

## Health check first

Run these checks before changing anything and report the results in one short table:

1. **Project**: `package.json` exists, React 18+/19 and TypeScript present, package manager (lockfile), git status clean enough to review a diff.
2. **Adapter state**: `components.json` (shadcn), `tailwindcss` v4 (`@import "tailwindcss"` in the CSS entry), path alias `@/` in `tsconfig` and `vite.config`.
3. **Storybook state**: version in `package.json` (manifests + MCP need **10.6+**), `.storybook/main.*`, addons present.
4. **Figma MCP** (optional at this stage): if the `figma` MCP server is available, call `whoami` and record the plan; if it reports unauthorized, tell the user to run `/mcp` in an interactive session. Do not ask for tokens.
5. **Model endpoint** (data-flow transparency): read `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX` and state where prompts go (Anthropic direct / Bedrock / Vertex / other).

Stop and ask only if the project is not React, or if Storybook exists on a version below 10 and upgrading would be a breaking change the user has not asked for.

## Step 1 — shadcn/ui (vendored)

If `components.json` is missing:

```bash
npx shadcn@latest init -p nova -b radix -y        # preset: nova (Lucide + Geist). Ask only if the user names a preset.
npx shadcn@latest add button card badge input label -y
```

Tailwind v4 wiring that shadcn expects (verify, patch if missing): `@tailwindcss/vite` plugin in `vite.config.ts`,
`resolve.alias["@"] = ./src`, `baseUrl` + `paths["@/*"]` in `tsconfig.json` **and** `tsconfig.app.json`, and the CSS
entry starting with `@import "tailwindcss";`. The generated `src/index.css` is the token source: its `:root` and
`.dark` blocks define the CSS variables every component must use.

Never edit vendored files under `src/components/ui/*.tsx` except to add a sibling `*.stories.tsx`. Record them in
`.design-system/config.json → hardcoded.allowFiles` (the setup script does this) so the guardrail ignores shadcn's own
`ring-[3px]`-style values while still checking everything the agent writes.

## Step 2 — Storybook 10.6+ with manifests and MCP

If Storybook is missing:

```bash
npx storybook@latest init --yes --no-dev --no-agent --features docs test a11y ai --disable-telemetry
```

(`ai` installs `@storybook/addon-mcp`; `test` installs `@storybook/addon-vitest` + Playwright, which `test-run` needs.)
If Storybook is below 10.6, propose `npx storybook@latest upgrade` and wait for confirmation.

Then run the idempotent setup script from the plugin root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/storybook-ai-ready.mjs" --project . --css src/index.css --remove-examples
```

It enables `features.componentsManifest`, switches docgen to `react-docgen-typescript` (union literals and JSDoc
reach the manifest), imports the project CSS into `preview`, writes `.design-system/config.json`, registers the Storybook
MCP server in the project's `.mcp.json`, removes Storybook's example stories (they hardcode colors), and lists anything
it could not patch. Apply its "To do" lines by hand.

Set a11y to fail tests: in `.storybook/preview.*`, `parameters.a11y.test = "error"`. Install the browser once:
`npx playwright install chromium`.

## Step 3 — backfill AI-readable stories

For every component in `src/components/ui/` without a `*.stories.tsx`, create one from
`${CLAUDE_PLUGIN_ROOT}/templates/component.stories.template.tsx` following `references/story-conventions.md`. Non-obvious
facts verified on Storybook 10.6.1:

- The **JSDoc block above `const meta`** becomes the manifest's component `description`. This is the only place to
  describe a vendored component without touching its source. Write what it is, when to use it, when not to.
- Prop descriptions come from docgen only; for vendored components they are empty. Put prop guidance in
  `argTypes[*].description` and list every `cva` variant value in `options`.
- Read the component's `cva(...)` definition and create **one story per variant value and per size value**, plus the
  states it supports (`Disabled`, `Loading`, `Invalid`, `WithIcon`). Use static, realistic args so snippets render.
- Add a `play` test for interactive components and tag it `['!manifest']`.
- `title`: `Components/<Group>/<Name>` (Actions, Forms, Data display, Feedback, Navigation, Overlay, Layout).

Do not write stories for `lib/utils.ts` or non-component modules.

## Step 4 — run, snapshot, verify

```bash
npm run storybook -- --no-open --ci          # background
node "${CLAUDE_PLUGIN_ROOT}/scripts/snapshot-manifest.mjs" --url http://localhost:6006
npx vitest run --project storybook           # or the MCP tool test-run once the server is registered
```

`snapshot-manifest.mjs` writes `.design-system/manifest.json` and `manifest.index.json` and prints an AI-readiness
report (missing descriptions, single-story components, props without docs). Fix `error`-level items; mention `warn`
items in the final report. Then confirm the MCP server answers: with the project's `.mcp.json` registered, call
`docs-list` and check every backfilled component appears with its description.

## Step 5 — project rules

Append `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.design-system.md` to the project's `CLAUDE.md` between its marker
comments (replace `__ADAPTER__`, `__CSS_OUTPUT__`), creating the file if needed. Create `.design-system/guidelines.md`
with headings only (Principles, Color, Typography, Spacing, Components, Accessibility) for the user or `ds-tokens` to fill.

## Report

End with: a readiness table (component, stories, description ✓/✗, props documented), the data-flow line from the
health check, the list of vendored files allowlisted, and the next step: run `ds-tokens` to connect Figma variables
or an external spec to `src/index.css`.

## Rules

- Reuse: never reimplement what `storybook init`, `shadcn init` or the scripts do; call them.
- Tokens only in anything this skill writes; the PostToolUse hook will flag violations.
- Do not commit; leave the diff for the user to review.
- Record anything not patchable automatically as an explicit to-do rather than silently skipping it.

## Resources

- `references/story-conventions.md` — what the manifest extracts and the story checklist
- `references/adapters/shadcn.md` — adapter specifics (token names, variant extraction, file layout)
- `scripts/storybook-ai-ready.mjs`, `scripts/snapshot-manifest.mjs`, `scripts/check-hardcoded.mjs`
- `templates/component.stories.template.tsx`, `templates/CLAUDE.design-system.md`, `templates/design-system.config.schema.json`
- Reference implementation: `examples/demo-react/` (Vite + React 19 + Tailwind v4 + shadcn nova + Storybook 10.6.1)
