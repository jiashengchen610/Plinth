import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { Progress } from "@/components/progress/progress";

/**
 * How far something is along: a savings goal, an upload, steps of a setup. Name it and show the number as text next
 * to it; the bar alone is hard to read exactly. For work with no known end, use a spinner instead.
 */
const meta = {
  title: "Components/Feedback/Progress",
  component: Progress,
  tags: ["autodocs"],
  args: { value: 64, "aria-label": "Emergency fund saved" },
  argTypes: { value: { control: { type: "range", min: 0, max: 100 } } },
  render: (args) => (
    <div className="flex w-72 flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="type-label-md">Emergency fund</span>
        <span className="type-body-sm text-muted-foreground">{args.value}%</span>
      </div>
      <Progress {...args} />
    </div>
  ),
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { value: 0 } };
export const Full: Story = { args: { value: 100 } };
export const Thick: Story = { args: { className: "h-2" } };

/** Interaction test: the bar reports its value. Hidden from the manifest. */
export const ReportsValue: Story = {
  tags: ["!manifest"],
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole("progressbar", { name: "Emergency fund saved" });
    await expect(bar).toHaveAttribute("aria-valuenow", "64");
  },
};
