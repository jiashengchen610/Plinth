# figma-map.json — Figma components ↔ code components

`.design-system/figma-map.json` is the local, plan-independent record of how Figma components and their
properties map onto design-system components and props. It is the first thing `ds-component` reads
when a Figma node arrives, and the thing it updates when a mapping is confirmed. When the Figma plan allows
Code Connect, `ds-figma-map` publishes the same entries through `add_code_connect_map`; the file stays the
source of truth either way, so nothing is lost when a team is on Professional.

Formal schema: `templates/figma-map.schema.json`. Validator: `scripts/validate-figma-map.mjs` (checks the
schema and cross-checks against `manifest.index.json`).

## Shape

```jsonc
{
  "$schema": "https://design-system-skills/schemas/figma-map.json",
  "version": 1,
  "figma": { "fileKey": "AbC123", "libraryName": "shadcn/ui kit", "lastSyncedAt": "2026-10-02T05:00:00.000Z" },
  "components": [
    {
      "figma": {
        "name": "Button",                 // component or component-set name as shown in Figma
        "componentKey": "9f2c…",          // stable across files for published library components (preferred id)
        "nodeId": "12:345",               // node id in fileKey (MCP form with ':'; URLs use '-')
        "url": "https://www.figma.com/design/AbC123/Kit?node-id=12-345"
      },
      "code": {
        "component": "Button",            // exported name
        "import": "@/components/ui/button",
        "path": "src/components/ui/button.tsx",
        "storyId": "components-actions-button"   // manifest id; lets the agent jump to docs-show
      },
      "props": [
        { "figma": { "name": "Variant", "type": "VARIANT" }, "code": { "prop": "variant" },
          "values": { "Default": "default", "Outline": "outline", "Secondary": "secondary", "Ghost": "ghost", "Destructive": "destructive", "Link": "link" } },
        { "figma": { "name": "Size", "type": "VARIANT" }, "code": { "prop": "size" },
          "values": { "Default": "default", "Small": "sm", "Large": "lg", "Icon": "icon" } },
        { "figma": { "name": "Label", "type": "TEXT" }, "code": { "prop": "children" } },
        { "figma": { "name": "Icon", "type": "BOOLEAN" }, "code": { "prop": "children", "transform": "leading-icon" } },
        { "figma": { "name": "State", "type": "VARIANT" }, "code": { "prop": null, "transform": "state" },
          "values": { "Default": {}, "Hover": null, "Focus": null, "Disabled": { "disabled": true } } }
      ],
      "children": [                        // nested instances → sub-components or slots
        { "figma": { "name": "Icon" }, "code": { "slot": "children", "component": "lucide-react/*" } }
      ],
      "codeConnect": { "status": "local", "templatePath": null, "publishedAt": null },
      "source": "confirmed",               // confirmed | suggested | code-connect
      "confidence": 1,
      "notes": "Figma 'Icon' boolean adds a leading lucide icon; no `icon` prop in code."
    }
  ],
  "unmapped": [
    { "figma": { "name": "Toast", "nodeId": "40:1" }, "reason": "no equivalent in code", "decision": "pending", "seenAt": "2026-10-02T05:00:00.000Z" }
  ]
}
```

## Rules

- **Identity**: prefer `componentKey` (stable); fall back to `fileKey + nodeId`. Store both when known.
- **Variant values** map Figma option labels to code prop values verbatim; missing labels are errors, not guesses.
- **State variants** (`Hover`, `Focus`, `Pressed`) have no prop; map them to `null` so the agent knows to ignore them
  and never emits a `state` prop. `Disabled` maps to `{ "disabled": true }`.
- **Booleans** that toggle a child (icon, avatar) map to a `transform` (`leading-icon`, `trailing-icon`, `slot:<name>`),
  not to a boolean prop that does not exist.
- **Unmapped** entries are written whenever `ds-component` meets a Figma component with no mapping. They carry a
  `decision`: `pending` (ask the user), `create` (a new component is justified), `skip` (decorative / not a component).
- `source: "suggested"` entries come from name matching or `get_code_connect_suggestions`; they must be confirmed by the
  user before the agent builds on them. Confirmed entries have `confidence: 1`.
- Never store Figma access tokens, user ids or anything but design identifiers in this file.

## How skills use it

| Skill | Reads | Writes |
|---|---|---|
| `ds-component` | component + props mapping for every instance in the target node | new `unmapped` entries; confirmed mappings after the user agrees |
| `ds-figma-map` | whole file | adds / fixes entries; publishes Code Connect; records `codeConnect.status` |
| `ds-audit` | whole file + `manifest.index.json` | nothing; reports stale `storyId`s, props that no longer exist, pending decisions |
| `ds-migrate` | `unmapped` queue | drives batch work from it |

## Code Connect (when the plan allows)

Each component entry with full `props` can be turned into a parserless Code Connect template (see the official
`figma-code-connect` skill). `values` become `figma.enum`, `TEXT` → `figma.string`, `BOOLEAN` with `transform` →
`figma.boolean` wrapped in the icon child, `children` → `figma.instance`. `ds-figma-map` writes the template to
`codeConnect.templatePath` and publishes with `add_code_connect_map`; on success it records `publishedAt`.
`get_code_connect_map` results are merged back with `source: "code-connect"`.
