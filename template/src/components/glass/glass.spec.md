# Glass

## Parts
- Root: a panel that blurs and tints what is behind it, with a light edge

## States
Frosted (browsers that blur), solid (browsers that cannot blur, or the system asks for less transparency), with ripple
(Chromium, when the recipe's distortion is above 0).

## Props
Any `div` props; `className` for size and padding. Put content inside.

## Tokens
material-glass (base: the glass color, solid and as the tint) with its recipe: tint opacity, blur, saturation, edge
light, ripple; material-glass-foreground; glass-radius (radius.container); glass-panel-foreground; glass-text-font
(typography.body.md).

## Accessibility
No role of its own: it is a surface. Text on it is checked over the darkest and the lightest backdrop at the recipe's
opacity, in light and dark mode. Solid where the system asks for less transparency (`prefers-reduced-transparency`).
Do not rely on what shows through it to carry meaning.
