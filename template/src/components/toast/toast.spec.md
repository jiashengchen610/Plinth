# Toast

## Parts
- Provider (once per app)
- Viewport (fixed corner region)
- Toast with Title, Description, Action, Close (x icon)

## States
Hidden, open, closing, swiping; variants: default, destructive.

## Props
Radix Toast props: `open`, `onOpenChange`, `duration`, `type` (foreground or background). Action needs `altText`.

## Tokens
toast-<variant>-background, -foreground, -border, -description; toast-radius; toast-shadow; layer-toast; duration-normal; ease-enter.

## Accessibility
Announced politely; F8 moves focus to the viewport; it pauses while hovered or focused. Never the only place for something people must act on: the Action's `altText` says how else to do it.
