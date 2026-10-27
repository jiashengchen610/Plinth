# Tooltip

## Parts
- Provider
- Root
- Trigger
- Content (portal) with arrow

## States
Closed, open (hover or focus), side: top, right, bottom, left.

## Props
Radix Tooltip props: `open`, `defaultOpen`, `onOpenChange`, `delayDuration`. Content: `side`, `sideOffset`, `align`.

## Tokens
tooltip-background, tooltip-foreground; tooltip-radius (radius.small); layer-tooltip; duration-normal; ease-enter.

## Accessibility
Opens on hover and keyboard focus; Escape closes. The trigger keeps its own accessible name; the tooltip only adds a hint. Not shown on touch: never put required information in it.
