---
name: ds-figma-map
description: This skill should be used when the user asks to "map Figma components to code", "connect Figma to our components", "set up Code Connect", "which code component is this Figma component", "sync the figma map", "Figma 元件對應", or when `ds-component` finds an unmapped Figma component. Maintains `.design-system/figma-map.json` (works on every Figma plan) and publishes Code Connect from it when the plan allows.
version: 0.1.0
---

# ds-figma-map — keep Figma components and code components mapped

The mapping between Figma components (and their properties) and design-system components (and their props)
lives in `.design-system/figma-map.json`. It is the reason an agent builds a Figma design with the existing
`Button` instead of inventing one. Code Connect is the official way to publish the same mapping into Figma;
this skill treats it as an optional output of the local map, because Code Connect requires an Organization or
Enterprise plan and the map must work everywhere.

Schema and rules: `references/figma-map-schema.md`, `templates/figma-map.schema.json`.

## Detect the plan once per session

Call the Figma MCP `whoami`. Record the plan in the report. Decide the Code Connect route:

| `whoami` result | `figma.codeConnect` in config | Route |
|---|---|---|
| Organization / Enterprise | `auto` or `on` | local map **and** publish via `add_code_connect_map` |
| Starter / Professional | `auto` | local map only; say that Code Connect is unavailable on this plan |
| any | `off` | local map only |
| unauthorized | — | stop; ask the user to run `/mcp` in an interactive session. Do not ask for tokens |

## A. Map one component (interactive)

Given a Figma component URL or a name:

1. Parse `fileKey` and `nodeId` (URL `node-id=12-345` → `12:345`). Call `get_metadata` to confirm it is a component or
   component set, and `get_screenshot` for the visual reference.
2. Read its properties: `get_context_for_code_connect` (TEXT / BOOLEAN / VARIANT with values / INSTANCE_SWAP / SLOT).
   On plans where that tool is unavailable, use `get_design_context` on one variant plus `search_design_system` to read
   the component set's variant axes.
3. Find the code candidate: read `.design-system/manifest.index.json` (or MCP `docs-list`). Match by name first, then by
   props (a Figma `Variant` axis whose values look like the code `variant` union). If `get_code_connect_suggestions` is
   available, use its suggestion as one more signal.
4. Draft the entry as `source: "suggested"` with explicit `values` for every variant label. Show the user the Figma
   property → code prop table and ask them to confirm or correct. Never guess a variant value: if a Figma label has no
   obvious code value, list it as a question.
5. On confirmation, write the entry with `source: "confirmed"`, `confidence: 1`, `code.storyId` from the manifest, and
   remove any matching `unmapped` row. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-figma-map.mjs"`.

Rules for props: visual states (`Hover`, `Focus`, `Pressed`) map to `null` under a `state` transform; booleans that
toggle an icon map to `leading-icon` / `trailing-icon` transforms, not to invented boolean props; text layers map to
`children` or a string prop; nested instances go under `children` as slots.

## B. Bulk map a library

For a whole file or library (also used by `ds-migrate`):

1. `get_libraries` → `search_design_system` (components) or `design-system-inventory-figma` (skills-for-figma) to list all
   component sets with their variant axes.
2. For every set, draft a suggestion against the manifest as in A.3–A.4. Present one table; let the user confirm in bulk
   and flag the ones to revisit.
3. Anything with no plausible code counterpart goes into `unmapped` with `decision: "pending"` and a reason. Do not create
   components here; that is `ds-component`'s job once the user decides.

## C. Publish Code Connect (Organization / Enterprise only)

1. Generate templates deterministically from the confirmed entries:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/figma-map-to-code-connect.mjs" --component Button --write-map
   ```
   This writes `<component>.figma.ts` next to the component in the **parserless** format and records
   `codeConnect.templatePath`. It leaves `// TODO(code-connect):` lines where it cannot know the answer (nested icon
   instances, custom transforms).
2. Load the official `figma:figma-code-connect` skill and resolve each TODO with its APIs (`findInstance`,
   `executeTemplate`, exhaustive `getEnum`). Keep the file as `.figma.ts`; never switch to `.figma.tsx` / `figma.connect()`.
3. Publish through the MCP: `add_code_connect_map` with the template (or `send_code_connect_mappings` for several). This needs
   no personal access token. On success set `codeConnect.status = "published"` and `publishedAt`; on failure record
   `status: "failed"` with the error and tell the user. The CLI alternative (`npx figma connect publish`) needs
   `FIGMA_ACCESS_TOKEN` in `.env.local`; only use it if the user prefers it.
4. Pull back what Figma has: `get_code_connect_map` for the file, merge entries that exist only in Figma as
   `source: "code-connect"`, and report conflicts (Figma says `Button → ui/Button`, map says `Button → LegacyButton`).

## D. Refresh after changes

Run after shadcn updates, story renames, or a Figma library release:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/snapshot-manifest.mjs" --url http://localhost:6006
node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-figma-map.mjs"
```

Fix errors (renamed props, stale `storyId`s) in the map, not in the components. If the Figma plan allows, re-publish
affected templates (C). `ds-audit` runs the same checks and also compares variant values against the live Figma file.

## Report

Plan detected and route taken; table of mappings added/changed (Figma name → code component, props covered / total);
unmapped queue with pending decisions; Code Connect status per component; validator output.

## Rules

- The map is the source of truth; Code Connect is derived from it. Never edit a `.figma.ts` without updating the map.
- Confirm before writing `source: "confirmed"`. Suggested entries are never used to generate code.
- Store identifiers only (keys, node ids, urls). No tokens, no user ids.
- Do not commit.

## Resources

- `references/figma-map-schema.md`, `templates/figma-map.schema.json`
- `scripts/validate-figma-map.mjs`, `scripts/figma-map-to-code-connect.mjs`, `scripts/snapshot-manifest.mjs`
- Official skills: `figma:figma-code-connect` (template APIs, publish), `figma:figma-use` (when reading variant axes by script)
- `examples/demo-react/.design-system/figma-map.json` — Button and Badge mappings with fixture ids
