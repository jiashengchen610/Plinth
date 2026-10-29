# Button group

## Parts
- Group (role group): buttons, fields or selects joined edge to edge
- Text: a label joined to them, like a currency sign or a unit
- Separator: a thin line between two filled buttons (a split button)

## States
Horizontal or vertical; groups side by side (nested groups get a gap). Each button keeps its own states.

## Props
`orientation`: "horizontal" (default) or "vertical". `ButtonGroupText` takes `asChild`; `ButtonGroupSeparator` takes
`orientation`.

## Tokens
button-group-radius (the outer corners), button-group-separator, button-group-text-background,
-text-foreground, -text-border, -text-font. Buttons inside use their own tokens.

## Accessibility
A group; give it an aria-label when the buttons do not explain themselves together. Tab moves through each button.
