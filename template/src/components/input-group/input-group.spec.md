# Input group

## Parts
- Group (role group): the field's frame
- Input or Textarea (data-slot input-group-control): what people type
- Addon: icons, text or buttons at the start, end, top or bottom
- Button: a small button inside the field
- Text: plain text beside the field, like a unit

## States
Default, focus-visible (the whole frame shows focus), invalid (aria-invalid on the control), disabled.

## Props
`InputGroupAddon`: `align` ("inline-start", "inline-end", "block-start", "block-end"). `InputGroupButton`: Button
props with `size` ("xs", "sm", "icon-xs", "icon-sm"), ghost by default. Input and textarea props on the controls.

## Tokens
input-group-radius, input-group-multiline-radius (several lines, or addons above or below),
input-group-button-radius (fits inside), input-group-field-background, -field-border, -addon-foreground, -addon-font,
-text-font, -control-foreground, -control-placeholder, -control-font; ring, destructive; duration-fast.

## Accessibility
Name the control (a Label, or aria-label). Clicking an addon puts the cursor in the field. Icon-only buttons inside
need aria-label.
