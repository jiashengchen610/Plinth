# Select

## Parts
- Trigger (role combobox) with Value and chevron icon
- Content (portal, listbox) with scroll buttons
- Group, Label, Item (role option) with check indicator, Separator

## States
Closed, open, placeholder, item highlighted, item selected, disabled, invalid.

## Props
Radix Select props: `value`, `defaultValue`, `onValueChange`, `open`, `onOpenChange`, `disabled`, `name`, `required`. Trigger `size`: default, sm.

## Tokens
select-trigger-background, -foreground, -border, -placeholder; select-content-background, -foreground, -border; select-item-highlight-background, -highlight-foreground, -label; select-radius; select-shadow; layer-dropdown; duration-normal; ease-enter.

## Accessibility
Opens with Enter, Space or arrows; type to jump; Escape closes and returns focus. Trigger labelled by a Label (`htmlFor`).
