import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import { Label } from "@/components/label/label";
import { Slider } from "@/components/slider/slider";

/**
 * Picks a number, or a range, by dragging along a track: a spending limit, a price range. Show the value as text next
 * to it, and use a text field instead when people need an exact number.
 */
const meta = {
  title: "Components/Forms/Slider",
  component: Slider,
  tags: ["autodocs"],
  args: { defaultValue: [40], max: 100, step: 1, disabled: false, "aria-label": "Weekly spending limit", onValueChange: fn() },
  argTypes: { onValueChange: { table: { disable: true } }, disabled: { control: "boolean" } },
  render: (args) => <Slider className="w-72" {...args} />,
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Range: Story = { args: { defaultValue: [20, 80], "aria-label": "Price range" } };
export const Disabled: Story = { args: { disabled: true } };

/** With its value shown as text, as it should usually be. */
export const WithValue: Story = {
  render: function Render(args) {
    const [value, setValue] = useState([250]);
    return (
      <div className="flex w-72 flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <Label>Weekly spending limit</Label>
          <span className="type-label-md">${value[0]}</span>
        </div>
        <Slider {...args} value={value} onValueChange={setValue} min={50} max={1000} step={10} />
        <div className="flex justify-between type-body-sm text-muted-foreground">
          <span>$50</span>
          <span>$1,000</span>
        </div>
      </div>
    );
  },
};

/** Interaction test: the arrow key moves the thumb by one step. Hidden from the manifest. */
export const Keyboard: Story = {
  tags: ["!manifest"],
  play: async ({ args, canvasElement }) => {
    const thumb = within(canvasElement).getByRole("slider", { name: "Weekly spending limit" });
    thumb.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(thumb).toHaveAttribute("aria-valuenow", "41");
    await expect(args.onValueChange).toHaveBeenCalledWith([41]);
  },
};
