# Slider

## Parts
- Root
- Track
- Range: the filled part
- Thumb (role slider): one per value

## States
Default, hover, focus-visible, dragging, disabled; one thumb or two (a range); horizontal or vertical.

## Props
Radix Slider props: `value` / `defaultValue` (an array: one number, or two for a range), `onValueChange`,
`onValueCommit`, `min`, `max`, `step`, `orientation`, `disabled`, `name`. `aria-label` names every thumb.

## Tokens
slider-track, slider-range, slider-thumb-background, slider-thumb-border, slider-radius, slider-thumb-radius; ring;
duration-fast.

## Accessibility
Arrow keys move by one step, Page Up and Page Down by ten, Home and End to the ends. Each thumb is announced with its
name and value. Show the value as text too: dragging to an exact number is hard.
