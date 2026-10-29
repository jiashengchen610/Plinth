# Progress

## Parts
- Root (role progressbar): the track
- Indicator: the filled part

## States
Empty (0), partly filled, full (100).

## Props
Radix Progress props: `value` (0 to `max`), `max` (default 100), `getValueLabel`. Give it an `aria-label` or point
`aria-labelledby` at the text that names it.

## Tokens
progress-track, progress-indicator, progress-radius; duration-normal, ease-standard.

## Accessibility
Announced as a progress bar with its value. Always named; show the number as text too, since the bar alone is hard to
read precisely.
