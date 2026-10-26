# Adapter: shadcn/ui (vendored)

shadcn/ui is not a dependency; `npx shadcn add <component>` copies React + Tailwind source into the project.
The agent therefore owns every component file, which is what makes Figma-driven changes possible. What shadcn
contributes is Radix behavior (`radix-ui`), `class-variance-authority` variant definitions, and a token
vocabulary that the shadcn Figma kit mirrors one-to-one.

Verified against `shadcn@4.21.1`, preset `nova`, base `radix`, Tailwind `4.3.x` (2026-10).

## File layout

| What | Where |
|---|---|
| Components | `src/components/ui/<name>.tsx` (kebab-case file, PascalCase export, sub-components in the same file: `Card`, `CardHeader`, …) |
| Stories (added by this plugin) | `src/components/ui/<name>.stories.tsx` |
| Utilities | `src/lib/utils.ts` (`cn`) — nova imports `cn` from the `cn` package instead |
| Token source | `src/index.css`: `@theme inline { … }` maps Tailwind utilities to CSS variables; `:root { … }` and `.dark { … }` hold the values (oklch) |
| Config | `components.json` (`style`, `tailwind.css`, `aliases`, `iconLibrary`) |

## Token vocabulary (semantic layer)

`background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `primary`, `primary-foreground`,
`secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`, `accent-foreground`, `destructive`, `border`,
`input`, `ring`, `chart-1..5`, `sidebar*`, `radius` (+ derived `radius-sm..4xl`), fonts `--font-sans`, `--font-heading`.

Utilities to use in generated code: `bg-primary text-primary-foreground`, `bg-muted text-muted-foreground`,
`border-border`, `ring-ring`, `rounded-lg` (= `--radius`), spacing scale `p-2 … p-6`, text scale `text-xs … text-lg`.
Opacity modifiers are allowed (`bg-destructive/10`); arbitrary values are not.

**Figma kit mapping**: the shadcn Figma kits name variables the same way (`primary`, `primary-foreground`, …) with
`light` / `dark` modes. `ds-tokens` therefore maps Figma variable `primary` → CSS `--primary` with no renaming;
unknown names are token gaps.

## Extracting variants for stories

Each component defines variants with `cva`:

```ts
const buttonVariants = cva("base classes", {
  variants: {
    variant: { default: "...", outline: "...", secondary: "...", ghost: "...", destructive: "...", link: "..." },
    size:    { default: "...", xs: "...", sm: "...", lg: "...", icon: "...", "icon-xs": "...", "icon-sm": "...", "icon-lg": "..." },
  },
  defaultVariants: { variant: "default", size: "default" },
});
```

Read the keys of each axis and emit one story per key (skip `default` for axes other than the first; the `Default` story
covers it). Props are typed as `React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }`,
so docgen yields `variant`, `size`, `asChild` with literal unions but no descriptions: describe them in `argTypes`.

Components without `cva` (`Card`, `Input`, `Label`) have no variant axis; write `Default`, content/state stories
(`WithFooter`, `Invalid`, `Disabled`, `WithDescription`) and a composition story.

## What the manifest shows for vendored components (Storybook 10.6.1)

- `description`: from the JSDoc above `const meta` in the stories file.
- `reactDocgenTypescript.props`: `variant`, `size`, `asChild` with union types; `description` empty.
- `import`: Storybook derives `from '<package name>'`, which is wrong here; `snapshot-manifest.mjs` rewrites it to
  `@/components/ui/<name>` in `manifest.index.json`. Agents must use the alias import.

## Guardrail exceptions

Nova sources contain `ring-[3px]`, `text-[0.8rem]`, `rounded-[min(var(--radius-md),10px)]`. The vendored files are
listed in `.design-system/config.json → hardcoded.allowFiles` by `storybook-ai-ready.mjs`. New components written by the
agent get no such exception: compose shadcn components and theme utilities instead of copying those patterns.

## Updating vendored components

`npx shadcn@latest add <name> --overwrite` replaces the file. Stories, `figma-map.json` entries and `argTypes` survive
because they live outside the component file. After an update, re-run `snapshot-manifest.mjs` and the Vitest project.

## Known limitations

- `asChild` stories need a real child element (`<a href>`); docgen cannot show that.
- `Input` is a plain `<input>` wrapper; its states come from attributes (`aria-invalid`, `disabled`), not variants.
- The nova preset imports `@fontsource-variable/geist`; Storybook inherits it through `src/index.css`.
