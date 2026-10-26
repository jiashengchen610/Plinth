# Button

## Parts
- Root: native `<button>` (or the child element with `asChild`)
- Optional leading or trailing icon (`data-icon="inline-start" | "inline-end"`)

## States
Default, hover, focus-visible, active, disabled, loading (disabled + spinner + `aria-busy`), invalid (`aria-invalid`).

## Props
- `variant`: default | outline | secondary | ghost | destructive | link
- `size`: default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg
- `asChild`: boolean

## Tokens
primary, primary-foreground, secondary, secondary-foreground, destructive, muted, foreground, background, border, input, ring, radius

## Accessibility
Keyboard: Enter and Space activate. Icon-only buttons require `aria-label`. Focus ring uses `ring`. Text meets 4.5:1 in every brand and mode.
