# DTCG tokens as consumed by design-system-skills

`.design-system/tokens.json` is the code-side source of truth for design tokens. It follows the
W3C Design Tokens Community Group format (2025.10) with a small set of `$extensions`. `build-tokens.mjs`
reads it and regenerates the CSS variables inside a managed region of the project's CSS entry.

## Accepted input shapes

`build-tokens.mjs` normalizes these inputs into one token list:

| Source | Shape | Notes |
|---|---|---|
| `export-tokens-figma` (`convert-tokens.mjs --format dtcg`) | Nested groups, `$type`/`$value`, aliases `{Group.Token}`, non-primary modes under `$extensions["figma-console-mcp"].modes`, Figma identity under `$extensions["figma-console-mcp"].variableId/key` | Primary mode is the first of `light`/`default`/`value`/`base`, else the first mode |
| Tokens Studio (single or multi-file) | Sets as top-level groups; legacy `value`/`type` keys; aliases `{set.group.token}`; `$themes`, `$metadata` | `$themes`/`$metadata` are skipped; modes are expressed as separate files passed with `--mode <name>=<file>` |
| Hand-written / external spec ingest | Standard DTCG | `$extensions["ds-skills"].source = "external"` marks tokens that did not come from Figma |
| Multiple files | `--in base.json --in semantic.json` | Later files override earlier ones on the same path |

Group-level `$type` is inherited by children. Unknown `$type` values are emitted verbatim with a warning.

## Values

| `$type` | Accepted `$value` | CSS output |
|---|---|---|
| `color` | `#rrggbb`, `#rrggbbaa`, `rgb()/hsl()/oklch()` strings, DTCG object `{ colorSpace, components, alpha, hex }` | `srgb` → `#hex` (alpha → `rgb(r g b / a)`); `oklch` → `oklch(l c h / a)`; `hsl` → `hsl(h s% l% / a)`; other spaces → `color(<space> c1 c2 c3 / a)` |
| `dimension` | number (px), `"8px"`, `"0.5rem"`, `{ value, unit }` | `${value}${unit}`; bare numbers become `px` |
| `number` | number | as-is (opacity, line-height) |
| `fontFamily` | string or string[] | quoted list |
| `fontWeight` | number or name (`"semibold"`) | numeric |
| `duration` | `"150ms"` or `{ value, unit }` | as-is |
| alias | `"{path.to.token}"` or `"{path/to/token}"` | `var(--<mapped-name>)` when the target is emitted, else resolved literal |

### Composite types (the token layer is a superset of Figma Variables)

Figma Variables hold only color, number, string and boolean; shadows, gradients and type styles live in styles, and
motion, blur, 3D or shader parameters have no home there at all. The DTCG file is therefore the source of truth for
everything below; Figma receives only the subset it can represent.

| `$type` | `$value` | CSS output | Tailwind v4 `@theme` entry (`--theme`) |
|---|---|---|---|
| `shadow` (`shadow/card`) | one or a list of `{ color, offsetX, offsetY, blur, spread, inset? }`; color may be an alias | `--card-shadow: 0 1px 2px 0 var(--foreground)` (comma-joined list) | `--shadow-card: var(--card-shadow)` → `shadow-card` |
| `gradient` (`gradient/hero`) | DTCG stops `[{ color, position }]` or `{ angle, stops }` | `--gradient-hero: linear-gradient(<angle>, c1 0%, c2 100%)` | none; use `bg-[image:var(--gradient-hero)]` |
| `typography` (`typography/display`) | `{ fontFamily, fontSize, fontWeight, lineHeight, letterSpacing }` | shorthand `--display-font: 600 2rem/1.15 'Geist Variable', sans-serif` **plus** `--display-font-size`, `--display-line-height`, `--display-letter-spacing`, `--display-font-family`, `--display-font-weight` | `--text-display` + `--text-display--line-height` → `text-display`; `--tracking-display` |
| `cubicBezier` (`ease/snappy`) | `[x1, y1, x2, y2]` | `--snappy-ease: cubic-bezier(…)` | `--ease-snappy: var(--snappy-ease)` → `ease-snappy` |
| `transition` (`motion/fast`) | `{ duration, timingFunction (value or alias), delay? }` | `--motion-fast: 150ms var(--snappy-ease)` | none; use `[transition:var(--motion-fast)]` |
| `border` | `{ width, style, color }` | `--border-hairline: 1px solid var(--foreground)` | none |
| `fontFamily` (`font/sans`) | string or list | `--sans-font: 'Geist Variable', sans-serif` | `--font-sans: var(--sans-font)` → `font-sans` (skipped when shadcn already declares it) |
| custom (`blur`, `depth`, `shader-*`, …) | string or number | emitted verbatim as a variable | `--blur-<name>` when the path contains `blur` |

**Naming rule for Tailwind-namespaced groups.** Tailwind v4 reads `--shadow-*`, `--ease-*`, `--font-*`, `--text-*`,
`--blur-*` inside `@theme`. If the base variable carried the same name, the generated `@theme inline` entry would be
circular (`--shadow-card: var(--shadow-card)`). So for the groups `shadow`, `ease`, `blur`, `font` / `typography` the base
variable takes the group as a **suffix** (`--card-shadow`, `--snappy-ease`, `--sans-font`, `--display-font`) and the
`@theme` entry carries the Tailwind name. Typography sub-properties drop the group (`--display-font-size`). Colors keep
shadcn's convention (group stripped: `--primary` → `--color-primary`). Other groups (`gradient`, `motion`, `border`) keep
the group as a prefix because Tailwind has no namespace for them.

Per-mode values for composites go under `$extensions["ds-skills"].modes.<mode>` as whole objects. Unknown object-valued
types are reported as "composite tokens not emitted" and skipped.

## Modes

Modes become selector blocks. Default mapping (override in `.design-system/config.json → tokens.modeSelectors`):

```json
{ "light": ":root", "default": ":root", "dark": ".dark" }
```

Any other mode name becomes `[data-theme="<mode>"]`. A token present in only some modes is emitted only in those.

## Name mapping (Figma / DTCG path → CSS variable)

Goal: Figma variables named like the shadcn kit map onto shadcn's existing variables without renaming.

1. Split the path on `/` or `.`, lowercase, slugify each segment (`Primary Foreground` → `primary-foreground`).
2. Drop leading **namespace groups** listed in `tokens.stripGroups` (default: `color`, `colors`, `semantic`, `tokens`,
   `shadcn`, `sds`). `color/primary/foreground` → `primary-foreground`.
3. Join the remaining segments with `-` and apply `tokens.prefix` (default empty).
4. Explicit overrides win: `tokens.rename` maps a full source path to a CSS name, e.g.
   `{ "radius/base": "radius", "color/text/muted": "muted-foreground" }`.

A token whose mapped name is **not** declared anywhere in the target CSS file is still emitted, and reported as
**new**. A CSS variable declared in the file that no token maps onto is reported as **code-only** (a candidate for
`import-tokens-figma`, so Figma learns about it). These two lists are the token-gap report that `ds-tokens` surfaces.

## Tailwind v4 utilities for new tokens

shadcn exposes variables to Tailwind through `@theme inline { --color-primary: var(--primary); … }`. For every emitted
**color** token with no matching `--color-<name>` entry, `build-tokens.mjs --theme` adds `--color-<name>: var(--<name>);`
to a second `@theme inline` block inside the managed region, so `bg-<name>` / `text-<name>` utilities exist immediately.
Radius tokens map to `--radius-<name>`, spacing to `--spacing-<name>`, font families to `--font-<name>`.

## Managed region

```css
/* design-system-skills:tokens:start | source: .design-system/tokens.json | 2026-10-02T05:10:00.000Z | do not edit by hand */
:root {
  --primary: oklch(0.205 0 0);
}
.dark {
  --primary: oklch(0.922 0 0);
}
@theme inline {
  --color-brand: var(--brand);
}
/* design-system-skills:tokens:end */
```

The region is appended at the end of the CSS file on first run and replaced in place afterwards. Because it comes
after shadcn's own `:root` / `.dark` blocks, its declarations win the cascade; the original declarations stay as
fallbacks and are never edited. `--check` exits 1 when the region would change (CI drift detection).

## `$extensions` used by this plugin

```jsonc
{
  "$extensions": {
    "ds-skills": {
      "exportedAt": "2026-10-02T05:10:00.000Z",   // document root
      "exporter": "export-tokens-figma@1.0.0",      // document root
      "figmaFileKey": "abc123",                     // document root
      "source": "figma" | "external" | "code"       // per token
    },
    "figma-console-mcp": { "variableId": "VariableID:3:4", "key": "…", "modes": { "Dark": "#…" } }  // from export-tokens-figma
  }
}
```

`ds-audit` compares `exportedAt` with the Figma file's `lastModified` to flag stale tokens.
