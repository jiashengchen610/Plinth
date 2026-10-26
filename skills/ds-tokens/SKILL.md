---
name: ds-tokens
description: This skill should be used when the user asks to "sync design tokens", "pull Figma variables into code", "update tokens from Figma", "export tokens to CSS", "import a brand guideline / style guide / design spec into tokens", "設計 token 同步", "把 Figma 變數接到 Tailwind", or when `ds-figma-component` reports token gaps. Maintains `.design-system/tokens.json` (DTCG) as the code-side source of truth and regenerates the CSS variables that shadcn/Tailwind consume, in both directions (Figma → code, code → Figma).
version: 0.1.0
---

# ds-tokens — one token source of truth for Figma, code and the agent

Tokens flow **Figma Variables → DTCG (`.design-system/tokens.json`) → CSS variables (managed region in
`src/index.css`) → Tailwind utilities**. The reverse direction (existing CSS → DTCG → Figma) exists so a
codebase without Figma variables can seed them. Every component the agent writes references the CSS
variables or Tailwind utilities, never raw values; `check-hardcoded.mjs` enforces that.

Formats and naming rules: `references/dtcg-schema.md`. Requires `.design-system/config.json` (run `ds-adopt` first).

## Decide the direction

The DTCG file is deliberately a **superset of Figma Variables**: shadows, gradients, typography, easing, transitions
and custom effect parameters are first-class here and have no variable equivalent in Figma. Prefer inputs that need no
Figma connection; use the Figma MCP only as an accelerator when it is already authorized.

| Situation | Direction | Steps |
|---|---|---|
| A DTCG / Tokens Studio export file exists (designer pushed it, or exported by hand) | file → code | C with the file as `--in` (**default path, no Figma connection**) |
| Code already has CSS variables and no tokens.json yet | code → DTCG | B, then C |
| Non-Figma spec (brand PDF, web style guide, Markdown) | spec → code | D then C |
| Tokens that Figma cannot hold (shadow, gradient, typography, motion, blur, 3D/effect params) | hand-edit `tokens.json` | add them as DTCG composites (`references/dtcg-schema.md`), then C |
| Figma file has Variables and the MCP is authorized | Figma → code (optional) | A then C |

Always finish with **E (verify and report)**.

## A. Export Figma variables (any Figma plan)

Use the `export-tokens-figma` skill from `southleft/skills-for-figma`; do not hand-convert.

1. Confirm the Figma MCP is authorized: call `whoami`. If unauthorized, stop and tell the user to run `/mcp` in an
   interactive session.
2. Load `figma-use`, then run `export-tokens-figma`'s `scripts/read-variables.js` through `use_figma` on the design-system
   file. Save the result as `.design-system/.cache/variables.json`.
3. Convert deterministically to DTCG:
   ```bash
   node <skills-for-figma>/skills/export-tokens-figma/scripts/convert-tokens.mjs .design-system/.cache/variables.json --format dtcg --out .design-system/.cache/
   ```
   It writes `tokens.tokens.json` with modes under `$extensions["figma-console-mcp"].modes` and Figma ids for round-trips.
4. Copy or merge it into `.design-system/tokens.json`. Stamp the root with `$extensions["ds-skills"] = { exportedAt, exporter,
   figmaFileKey }` (take the file key from the URL). If the project already has a `tokens.json` with `source: "external"`
   or `"code"` tokens, keep them: Figma wins on identical paths, everything else is preserved.

If the Figma MCP is unavailable and the user has a `variables.json` or any DTCG file, skip to C with `--in <file>`.

## B. Seed tokens from existing CSS (code → DTCG)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/css-to-dtcg.mjs" --css src/index.css --out .design-system/tokens.json [--merge]
```

Reads `:root` and `.dark` (configurable `--selector`), skips the managed region and `@theme`, writes colors under
`color/*` with `source: "code"`. `calc()`-style values stay in CSS and are listed as skipped. To push these into Figma,
run the `import-tokens-figma` skill on the resulting file after the user confirms the collection and mode names.

## C. Build CSS from DTCG

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/build-tokens.mjs" --theme            # writes the managed region
node "${CLAUDE_PLUGIN_ROOT}/scripts/build-tokens.mjs" --theme --check    # CI / drift: exit 1 if out of date
```

What it does, and what to do with its report:

- Emits one `:root` / `.dark` (or `[data-theme="…"]`) block inside `/* design-system-skills:tokens:start … end */` at the
  end of the CSS entry. Existing shadcn declarations stay as fallbacks; the region wins the cascade.
- **new** variables (token exists, CSS did not declare it): fine; with `--theme` they also get `@theme inline` entries so
  `bg-<name>` / `text-<name>` utilities exist. Mention them in the report.
- **code-only** variables (CSS declares it, no token): these are token gaps on the Figma side. Offer to push them with
  `import-tokens-figma` (direction B) or confirm they are intentionally code-only.
- **composite** tokens (shadow, typography): not emitted. Map them by hand into the relevant utilities and say so.
- **unresolved aliases** / **name collisions**: fix in `tokens.json` (usually a renamed Figma variable) before continuing.
- Names: `color/primary/foreground` → `--primary-foreground` by stripping namespace groups; use `tokens.rename` in
  `.design-system/config.json` for exceptions such as `radius/base → radius`. Never rename tokens in the JSON to make them
  fit; configure the mapping instead so Figma round-trips keep working.

## D. Ingest an external spec (PDF, web page, Markdown, Sketch export)

1. Read the source (PDF via the pdf skill, page via WebFetch, file via Read). Extract only values stated as rules: palette
   with roles (primary, surface, text…), type scale, spacing scale, radii, shadows.
2. Map roles onto the adapter vocabulary (`references/adapters/shadcn.md` → `primary`, `primary-foreground`, `muted`, …).
   Ask when a role is ambiguous (which gray is `muted-foreground`?). Values with no role go under `brand/*` or `palette/*`
   as primitives, not into semantic names.
3. Write them into `.design-system/tokens.json` as DTCG with `$extensions["ds-skills"].source = "external"` and a
   `$description` quoting the spec ("Brand guide v3 p.12"). Keep `light` values in `$value`; put `dark` under
   `$extensions["ds-skills"].modes` only if the spec defines them. Never invent a dark mode.
4. Run C. Then propose `import-tokens-figma` so Figma becomes the design-side source going forward.

## E. Verify and report

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-hardcoded.mjs" src` — the token build must not introduce raw values outside
   allowlisted files.
2. Restart or let Storybook reload, then run story tests (`npx vitest run --project storybook` or MCP `test-run`): token
   changes can flip accessibility results (contrast). A newly failing contrast check is a **design finding**, handled as in
   `references/story-conventions.md` (record in `.design-system/guidelines.md`, exception with reason, report).
3. Report: counts (tokens, modes, overridden, new, code-only), the files written, open gaps, and the recommended follow-up
   (`import-tokens-figma` for code-only tokens; `ds-audit` for drift once both sides exist).

## Designers' workflow (what to tell the team)

Designers change values in Figma Variables only. Either Tokens Studio pushes a DTCG file into the repo, or an engineer
runs this skill. The resulting PR shows the `tokens.json` diff, the regenerated managed region, and the Storybook test
results. Renaming or adding a variable needs engineering review because component code references the name; changing a
value does not.

## Resources

- `references/dtcg-schema.md` — accepted inputs, value conversion, name mapping, managed region, `$extensions`
- `references/adapters/shadcn.md` — token vocabulary the names must land on
- `scripts/build-tokens.mjs`, `scripts/css-to-dtcg.mjs`, `scripts/check-hardcoded.mjs`
- External: `export-tokens-figma`, `import-tokens-figma` (southleft/skills-for-figma); `figma-use` (official)
- Fixture: `examples/demo-react/.design-system/tokens.json` simulates an export with a `dark` mode, an alias, a new brand
  color (DTCG color object), a renamed radius and a composite shadow
