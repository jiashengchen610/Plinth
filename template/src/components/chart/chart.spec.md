# Chart

## Parts
- ChartContainer: sizes the chart, sets each series' color from the config (`--color-<key>`), styles grid and axes
- ChartTooltip, ChartTooltipContent: the box with values under the pointer
- ChartLegend, ChartLegendContent: the series names with their color keys
- Recharts charts inside: BarChart, LineChart, AreaChart, PieChart (donut), RadarChart, with Cell for per-bar colors

## States
Resting; pointer over a point or bar (tooltip and cursor band); keyboard focus with `accessibilityLayer` (arrow keys
move between points).

## Props
ChartContainer: `config` (per series: `label`, `color` such as `var(--chart-1)`, optional `icon`), `className` for
size, `aria-label`. ChartTooltipContent: `indicator` (dot, line, dashed), `hideLabel`, `hideIndicator`, `nameKey`,
`labelKey`, `formatter`. ChartLegendContent: `nameKey`, `hideIcon`.

## Tokens
Series: chart-1…8 (categories), chart-seq-1…7 (low to high), chart-div-1…7 (around a middle), made by Plinth from the
palette. chart-grid, chart-surface, chart-cursor, chart-axis-foreground, chart-axis-font (typography.body.sm),
chart-legend-foreground, chart-legend-font, chart-tooltip-background, -foreground, -border, -label, chart-tooltip-font,
chart-tooltip-title-font, chart-tooltip-value-font (typography.label.sm), chart-tooltip-radius (radius.control), chart-key-radius
(radius.small), shadow-overlay.

## Accessibility
Give every chart an `aria-label` that says what it shows, and add `accessibilityLayer` to cartesian charts for
keyboard reading. Series colors stay apart for protan, deutan and tritan vision and read 3:1 on the page, but never
carry meaning by color alone: label series in a legend or on the marks.
