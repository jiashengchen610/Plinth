---
name: ds-migrate
description: This skill should be used when the user asks to "migrate our Figma library to code", "build components for the whole design system", "batch import Figma components into Storybook", "把整個 Figma design system 搬進 code", "一次把所有元件做出來", or wants a resumable, reviewable pipeline over many Figma components. Orchestrates ds-tokens, ds-figma-map and ds-component over a whole Figma file in dependency order with a persisted queue and per-batch review gates.
version: 0.1.0
---

# ds-migrate — whole-library migration, in batches, resumable

A migration is many `ds-component` runs with shared state: tokens first, atoms before compositions, a
mapping that grows as components land, and a human review after every batch. The queue lives in
`.design-system/migration-state.json` so a session can stop at any point and another can continue.

Where it runs: on a workstation or a self-hosted runner with an authorized Figma MCP session. The MCP's OAuth cannot be
completed headless, so this is not a GitHub Actions job. The code repository can live anywhere git can clone from.

## 0. Preconditions

- `ds-adopt` done (Storybook 10.6+, manifests, `.design-system/config.json`), Storybook running.
- Figma MCP authorized (`whoami`); note the plan for Code Connect.
- A clean git branch for the migration (`migration/<library-name>`); the user owns commits and PRs.

## 1. Inventory and plan (one time)

1. Tokens first: run `ds-tokens` direction A on the library file. Nothing else starts until `build-tokens.mjs --check` passes.
2. Inventory components: `get_libraries` → `search_design_system` / `design-system-inventory-figma` to list component sets
   with node ids, names, and nested-instance relationships. Classify `kind`: `component` (no nested DS instances) or
   `pattern` (composes others). Derive `dependsOn` from nested instances.
3. Run `ds-figma-map` B to pre-map everything that already exists in code; those items are marked `skipped` with the
   note "already in code" unless the user wants their stories backfilled.
4. Write the inventory as `items.json` and initialise the queue:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/migration-state.mjs" init --file-key <key> --name "<library>" items.json
   node "${CLAUDE_PLUGIN_ROOT}/scripts/migration-state.mjs" summary
   ```
5. Show the user the plan: counts per kind, the first batch, estimated batches (3 components per batch by default), and
   the review gate rule. Wait for a go.

## 2. Batch loop

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/migration-state.mjs" next --batch 3
```

For each item in `next`:

1. `migration-state.mjs start <id>`.
2. Run `ds-component` on the item's URL. Give it the item's name and `kind`, and tell it that mapping confirmations
   for this batch were pre-approved by the user in step 1.5 only for items the user explicitly listed; otherwise it must
   still ask.
3. On success (tests pass, visual check within threshold, `ds-reviewer` returned APPROVE or REVISE items were applied):
   `migration-state.mjs review <id> --story <ids> --files <paths>`.
4. On a blocking problem (token gap, missing primitive, Figma inconsistency): `migration-state.mjs fail <id> --note "<why>"`.
   Continue with the next item; do not stall the batch on one component.
5. Respect Figma rate limits: if a Figma MCP call returns a rate-limit error, wait 60 seconds and retry once; on the second
   failure mark the item `failed` with note `rate-limited` and stop the batch early with a summary.

After the batch: run `ds-audit.mjs`, write a batch summary (built / failed with reasons / token gaps collected), and stop
for the **review gate**: the user opens Storybook, reviews, and either approves (items move `review` → `done` via
`migration-state.mjs done <id>`) or asks for changes. Then the user commits the batch (one PR per batch keeps reviews small).

Resume at any time with `next`; it skips `done`, `review`, `skipped`, retries `failed` up to 3 attempts, and holds items
whose dependencies are not built yet (`blocked`).

## 3. Finish

When `next` returns nothing pending and nothing blocked:

1. `ds-figma-map` C to publish Code Connect for everything confirmed (if the plan allows).
2. `ds-audit.mjs --out .design-system/audit-report.md` and the Figma-side comparison.
3. Final summary: components built, patterns built, skipped (already existed), failed with reasons grouped (token gaps,
   missing primitives, Figma inconsistencies), total token gaps for design to resolve, and the follow-ups.

## Rules

- Never auto-merge or commit; the review gate is the point of the batch design.
- One component at a time per batch item; parallel Figma reads only within one component (official skill rule for sparse nodes).
- Failures are data: keep the note specific enough that a designer can act on it ("Toast uses color #FF6B35 with no variable").
- Keep `.design-system/migration-state.json` in git so progress survives machines and people.

## Resources

- `scripts/migration-state.mjs`, `scripts/ds-audit.mjs`
- Skills: `ds-tokens`, `ds-figma-map`, `ds-component`, `ds-audit`; agent `ds-reviewer`
- External: `design-system-inventory-figma` (skills-for-figma), official `figma-design-to-code`
