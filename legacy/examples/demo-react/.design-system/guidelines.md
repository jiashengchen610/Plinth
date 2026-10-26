# Design guidelines

## Principles

## Color

### Findings

- **DS-001 (resolved 2026-10-02, option a)** — `destructive` tint fails WCAG AA text contrast. shadcn nova renders `variant="destructive"`
  on Button and Badge as `text-destructive` over `bg-destructive/10`: measured 3.98:1 (fg #e7000b on #fde5e7),
  required 4.5:1. Found by Storybook a11y (axe color-contrast) on 2026-10-02.
  Options: (a) darken `--destructive` in `src/index.css` (affects every destructive use); (b) change the variant
  to solid `bg-destructive text-white`; (c) accept as-is for AA-large only. Decision owner: design.
  Resolution: `--destructive` darkened to `oklch(0.5 0.22 27)` (light) in `.design-system/tokens.json`; the 10% tint now passes
  axe color-contrast and the story exceptions were removed. Dark mode keeps `oklch(0.704 0.191 22.216)`.

## Typography

## Spacing

## Components

## Accessibility
