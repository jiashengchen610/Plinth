# Item

## Parts
- Group (role list), Separator
- Item: default, outline or muted; default, small or extra small
- Media: an icon or an image
- Content: Title and Description
- Actions: buttons at the end
- Header, Footer: a full-width row above or below

## States
Default; hover and focus-visible when the item is a link or a button (`asChild`).

## Props
`Item`: `variant`, `size`, `asChild`. `ItemMedia`: `variant` ("default", "icon", "image").

## Tokens
item-radius, item-border, item-muted-background, item-hover-background, item-separator, item-title-font,
item-description-font, -description-small-font, -description-foreground, item-media-radius; ring; duration-fast.

## Accessibility
A group is a list: wrap each item in an element with `role="listitem"` (not the item itself, so a link stays a
link). An item that does something is a real link or button (`asChild`), with its title as its name.
