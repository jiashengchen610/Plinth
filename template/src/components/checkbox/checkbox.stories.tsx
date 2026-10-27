import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { Checkbox } from "@/components/checkbox/checkbox";
import { Label } from "@/components/label/label";

/**
 * Turns one option on or off, or picks several options from a list. Always pair it with a `Label` (click the label
 * to toggle). Use `checked="indeterminate"` for a parent whose children are partly checked. For an instant setting
 * that takes effect at once, prefer a Switch; for exactly one choice, use Radio buttons.
 */
const meta = {
  title: "Components/Forms/Checkbox",
  component: Checkbox,
  tags: ["autodocs"],
  args: { disabled: false, onCheckedChange: fn() },
  argTypes: {
    checked: { control: "select", options: [true, false, "indeterminate"] },
    disabled: { control: "boolean" },
    onCheckedChange: { table: { disable: true } },
  },
  render: (args) => (
    <div className="flex items-center gap-2">
      <Checkbox id="terms" {...args} />
      <Label htmlFor="terms">Remind me when bills are due</Label>
    </div>
  ),
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Checked: Story = { args: { defaultChecked: true } };
/** A parent option whose children are partly checked. */
export const Indeterminate: Story = { args: { checked: "indeterminate" } };
export const Disabled: Story = { args: { disabled: true, defaultChecked: true } };

/** Interaction test: clicking the label checks the box and reports it. Hidden from the manifest. */
export const ClickLabel: Story = {
  tags: ["!manifest"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByRole("checkbox", { name: "Remind me when bills are due" });
    await userEvent.click(canvas.getByText("Remind me when bills are due"));
    await expect(box).toHaveAttribute("data-state", "checked");
    await expect(args.onCheckedChange).toHaveBeenCalledWith(true);
  },
};
