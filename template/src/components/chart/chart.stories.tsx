import type { Meta, StoryObj } from "@storybook/react-vite";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, PolarAngleAxis, PolarGrid, Radar, RadarChart, XAxis, YAxis } from "recharts";
import { expect, waitFor } from "storybook/test";

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/chart/chart";

const months = [
  { month: "Jan", groceries: 310, dining: 184, transport: 96 },
  { month: "Feb", groceries: 295, dining: 210, transport: 88 },
  { month: "Mar", groceries: 330, dining: 162, transport: 104 },
  { month: "Apr", groceries: 302, dining: 240, transport: 91 },
  { month: "May", groceries: 318, dining: 198, transport: 120 },
  { month: "Jun", groceries: 340, dining: 226, transport: 99 },
];
const spending = {
  groceries: { label: "Groceries", color: "var(--chart-1)" },
  dining: { label: "Dining out", color: "var(--chart-2)" },
  transport: { label: "Transport", color: "var(--chart-3)" },
} satisfies ChartConfig;

/** Wait until Recharts has measured the container and drawn its marks. */
const drawn = (canvas: HTMLElement, selector: string, count: number) =>
  waitFor(() => expect(canvas.querySelectorAll(selector).length).toBeGreaterThanOrEqual(count));

/**
 * Charts for numbers over time or across categories, on Recharts. Series take the design system's chart colors in
 * the config: `var(--chart-1)` to `var(--chart-8)` for categories (kept apart for color vision deficiencies and 3:1
 * on the page), `var(--chart-seq-1…7)` for low to high values, `var(--chart-div-1…7)` for values around a middle.
 * Grid, axes, tooltip and legend follow the system. Always label series; never rely on color alone.
 */
const meta = {
  title: "Components/Data/Chart",
  component: ChartContainer,
  tags: ["autodocs"],
  args: { config: spending, className: "min-h-64 w-full max-w-xl", children: <div /> },
  argTypes: { config: { table: { disable: true } }, className: { table: { disable: true } }, children: { table: { disable: true } } },
} satisfies Meta<typeof ChartContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Bars side by side: compare categories month by month. */
export const Bars: Story = {
  render: (args) => (
    <ChartContainer {...args} config={spending} aria-label="Spending by month">
      <BarChart accessibilityLayer data={months}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="groceries" fill="var(--color-groceries)" radius={4} />
        <Bar dataKey="dining" fill="var(--color-dining)" radius={4} />
        <Bar dataKey="transport" fill="var(--color-transport)" radius={4} />
      </BarChart>
    </ChartContainer>
  ),
  play: async ({ canvasElement }) => {
    await drawn(canvasElement, ".recharts-bar-rectangle", 18);
    await expect(canvasElement.querySelector(".recharts-legend-wrapper")?.textContent).toContain("Dining out");
  },
};

const totals = [
  { month: "May", total: 1820 },
  { month: "Jun", total: 2140 },
  { month: "Jul", total: 1960 },
  { month: "Aug", total: 2310 },
  { month: "Sep", total: 1880 },
  { month: "Oct", total: 1449 },
];

/** One series on a small card: totals by month, the current month strongest. */
export const Monthly: Story = {
  render: (args) => (
    <ChartContainer {...args} config={{ total: { label: "Spent", color: "var(--chart-1)" } }} aria-label="Spent per month">
      <BarChart accessibilityLayer data={totals} margin={{ top: 4 }}>
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator />} />
        <Bar dataKey="total" radius={6}>
          {totals.map((t, i) => <Cell key={t.month} fill="var(--color-total)" fillOpacity={0.45 + (0.55 * i) / (totals.length - 1)} />)}
        </Bar>
      </BarChart>
    </ChartContainer>
  ),
  play: async ({ canvasElement }) => drawn(canvasElement, ".recharts-bar-rectangle", 6),
};

/** Lines: how each series moves over time. */
export const Lines: Story = {
  render: (args) => (
    <ChartContainer {...args} config={spending} aria-label="Spending trend">
      <LineChart accessibilityLayer data={months} margin={{ left: 12, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Line dataKey="groceries" type="monotone" stroke="var(--color-groceries)" strokeWidth={2} dot={false} />
        <Line dataKey="dining" type="monotone" stroke="var(--color-dining)" strokeWidth={2} dot={false} />
        <Line dataKey="transport" type="monotone" stroke="var(--color-transport)" strokeWidth={2} dot={false} />
      </LineChart>
    </ChartContainer>
  ),
  play: async ({ canvasElement }) => drawn(canvasElement, ".recharts-line-curve", 3),
};

/** Stacked areas: a total and what makes it up. */
export const StackedAreas: Story = {
  render: (args) => (
    <ChartContainer {...args} config={spending} aria-label="Total spending">
      <AreaChart accessibilityLayer data={months} margin={{ left: 12, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
        <Area dataKey="transport" type="natural" stackId="a" fill="var(--color-transport)" fillOpacity={0.4} stroke="var(--color-transport)" />
        <Area dataKey="dining" type="natural" stackId="a" fill="var(--color-dining)" fillOpacity={0.4} stroke="var(--color-dining)" />
        <Area dataKey="groceries" type="natural" stackId="a" fill="var(--color-groceries)" fillOpacity={0.4} stroke="var(--color-groceries)" />
      </AreaChart>
    </ChartContainer>
  ),
  play: async ({ canvasElement }) => drawn(canvasElement, ".recharts-area-area", 3),
};

const shares = [
  { name: "rent", value: 1200, fill: "var(--color-rent)" },
  { name: "groceries", value: 310, fill: "var(--color-groceries)" },
  { name: "dining", value: 184, fill: "var(--color-dining)" },
  { name: "transport", value: 96, fill: "var(--color-transport)" },
  { name: "savings", value: 400, fill: "var(--color-savings)" },
];
const shareConfig = {
  rent: { label: "Rent", color: "var(--chart-1)" },
  groceries: { label: "Groceries", color: "var(--chart-2)" },
  dining: { label: "Dining out", color: "var(--chart-3)" },
  transport: { label: "Transport", color: "var(--chart-4)" },
  savings: { label: "Savings", color: "var(--chart-5)" },
} satisfies ChartConfig;

/** A donut: parts of one whole. Keep it to a few slices. */
export const Donut: Story = {
  render: (args) => (
    <ChartContainer {...args} config={shareConfig} className="aspect-square w-72 max-w-full" aria-label="Where the money went">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
        <Pie data={shares} dataKey="value" nameKey="name" innerRadius={60} strokeWidth={4} />
        <ChartLegend content={<ChartLegendContent nameKey="name" />} />
      </PieChart>
    </ChartContainer>
  ),
  play: async ({ canvasElement }) => drawn(canvasElement, ".recharts-pie-sector", 5),
};

const habits = [
  { habit: "Groceries", thisYear: 86, lastYear: 72 },
  { habit: "Dining", thisYear: 64, lastYear: 80 },
  { habit: "Transport", thisYear: 70, lastYear: 66 },
  { habit: "Savings", thisYear: 92, lastYear: 58 },
  { habit: "Fun", thisYear: 48, lastYear: 60 },
];
const habitConfig = { thisYear: { label: "This year", color: "var(--chart-1)" }, lastYear: { label: "Last year", color: "var(--chart-2)" } } satisfies ChartConfig;

/** Radar: a few measures for two or three things side by side. */
export const RadarCompare: Story = {
  render: (args) => (
    <ChartContainer {...args} config={habitConfig} className="aspect-square w-80 max-w-full" aria-label="Habits this year and last">
      <RadarChart data={habits}>
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <PolarGrid />
        <PolarAngleAxis dataKey="habit" />
        <Radar dataKey="lastYear" fill="var(--color-lastYear)" fillOpacity={0.3} stroke="var(--color-lastYear)" />
        <Radar dataKey="thisYear" fill="var(--color-thisYear)" fillOpacity={0.5} stroke="var(--color-thisYear)" />
        <ChartLegend content={<ChartLegendContent />} />
      </RadarChart>
    </ChartContainer>
  ),
  play: async ({ canvasElement }) => drawn(canvasElement, ".recharts-radar-polygon", 2),
};

const weeks = [12, 30, 48, 66, 84, 102, 120].map((value, i) => ({ week: `W${i + 1}`, value }));

/** Sequential colors: one hue from light to strong as values grow (a heat scale). */
export const Sequential: Story = {
  render: (args) => (
    <ChartContainer {...args} config={{ value: { label: "Hours" } }} aria-label="Hours per week">
      <BarChart accessibilityLayer data={weeks}>
        <XAxis dataKey="week" tickLine={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent hideIndicator />} />
        <Bar dataKey="value" radius={4}>
          {weeks.map((w, i) => <Cell key={w.week} fill={`var(--chart-seq-${i + 1})`} />)}
        </Bar>
      </BarChart>
    </ChartContainer>
  ),
  play: async ({ canvasElement }) => drawn(canvasElement, ".recharts-bar-rectangle", 7),
};

const change = [-30, -18, -6, 0, 8, 20, 34].map((value, i) => ({ team: `Team ${i + 1}`, value }));

/** Diverging colors: below the middle in one hue, above it in another, the middle neutral. */
export const Diverging: Story = {
  render: (args) => (
    <ChartContainer {...args} config={{ value: { label: "Change (%)" } }} aria-label="Change since last month">
      <BarChart accessibilityLayer data={change}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="team" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={32} />
        <ChartTooltip content={<ChartTooltipContent hideIndicator />} />
        <Bar dataKey="value" radius={4}>
          {change.map((c, i) => <Cell key={c.team} fill={`var(--chart-div-${i + 1})`} />)}
        </Bar>
      </BarChart>
    </ChartContainer>
  ),
  play: async ({ canvasElement }) => drawn(canvasElement, ".recharts-bar-rectangle", 6),
};
