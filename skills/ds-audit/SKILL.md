---
name: ds-audit
description: This skill should be used when the user asks to "audit the design system", "check for design drift", "is our Storybook still in sync with Figma", "find hardcoded colors", "design system health check", "檢查設計系統有沒有漂移", or on a schedule / before a release. Produces one report covering AI-readiness of stories, hardcoded values, Figma mapping validity, variant story coverage, token drift and freshness, and Code Connect status, with optional live comparison against the Figma file.
version: 0.1.0
---

# ds-audit — detect drift between Figma, tokens, components and stories

Drift is silent: a renamed Figma variant, a shadcn update that changed a prop, a token edited by hand in CSS, a
component added without stories. This skill runs the deterministic checks in one pass, adds the Figma-side
comparisons that need the MCP, and writes a report the team can act on.

## 1. Local audit (no Figma needed)

With Storybook running (so the manifest is fresh):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ds-audit.mjs" --out .design-system/audit-report.md
```

Sections and what each finding means:

| Section | Finding | Meaning / fix |
|---|---|---|
| AI-readiness | no description, < 3 stories | the agent cannot discover or use the component; `ds-adopt` step 3 |
| Hardcoded values | hex / px / arbitrary values outside allowlisted files | replace with tokens; or add a token via `ds-tokens` |
| Mapping | validator errors, pending decisions, unconfirmed suggestions | `ds-figma-map` A (confirm) / D (refresh) |
| Variant coverage | a Figma variant value with no story | add the story; the manifest is the agent's only view of variants |
| Tokens | managed region out of date; unresolved alias; stale export | `build-tokens.mjs --theme`; fix alias in tokens.json; re-export from Figma |
| Code Connect | failed publishes, local-only on a publishing plan | `ds-figma-map` C |

`--strict` turns warnings into a non-zero exit for CI. `--json` for machines.

## 2. Figma-side comparison (Figma MCP authorized)

Add these when the user wants to know whether **Figma** moved:

1. **Tokens**: run `export-tokens-figma` (skills-for-figma) into `.design-system/.cache/figma-tokens.json`, then compare with
   `.design-system/tokens.json`: changed values, new variables, deleted variables, renamed collections. Report as a table;
   do not overwrite `tokens.json` here (that is `ds-tokens`).
2. **Components**: for each `figma-map.json` entry, `get_context_for_code_connect` (or `get_design_context` on the set) and
   compare variant axes and labels with the stored `values`. Added labels → coverage gaps; removed labels → stale map.
3. **Parity**: run `check-design-parity-figma` (skills-for-figma) for components the user names, to compare design specs
   with the rendered component. Optionally `storysync diff --storybook <url>` for a code-vs-Figma token/component diff.
4. **Visual spot check**: for the N most used components, `get_screenshot` of the Figma default variant and
   `scripts/visual-diff.mjs` against the `Default` story. Look at the side-by-side images before reporting numbers.

## 3. Report

Write `.design-system/audit-report.md` (the script does the local part; append the Figma part under
`## Figma comparison`). Structure:

1. Summary line: errors / warnings, Figma file + last modified, tokens exported at.
2. **Act now** (errors): each with the command or skill that fixes it.
3. **Plan** (warnings): grouped by owner — design (Figma-side changes, token decisions), engineering (stories, mappings).
4. Tables from sections 1–2.

Do not fix things inside the audit unless the user asked for an audit *and fix*; then run the owning skill per item and
re-audit at the end.

## Scheduling

Local audit in CI: `node scripts/ds-audit.mjs --strict` after Storybook build, with `--storybook` pointing to a static
build served locally (or rely on the committed snapshot). Figma-side comparison cannot run headless (MCP OAuth); run it
from a workstation or a Claude Code scheduled routine with an authorized session.

## Resources

- `scripts/ds-audit.mjs` (orchestrates `snapshot-manifest.mjs`, `check-hardcoded.mjs`, `validate-figma-map.mjs`, `build-tokens.mjs --check`)
- `scripts/visual-diff.mjs`
- External: `export-tokens-figma`, `check-design-parity-figma`, `design-system-inventory-figma` (skills-for-figma); `storysync diff` (optional)
- `references/figma-map-schema.md`, `references/dtcg-schema.md`, `references/story-conventions.md`
