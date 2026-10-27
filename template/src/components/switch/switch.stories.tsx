import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { Label } from "@/components/label/label";
import { Switch } from "@/components/switch/switch";

/**
 * Turns a setting on or off right away, like a light switch: no Save button needed. Pair it with a `Label`. For an
 * option that is only applied when a form is submitted, use a Checkbox.
 */
const meta = {
  title: "Components/Forms/Switch",
  component: Switch,
  tags: ["autodocs"],
  args: { disabled: false, onCheckedChange: fn() },
  argTypes: {
    checked: { control: "boolean" },
    disabled: { control: "boolean" },
    onCheckedChange: { table: { disable: true } },
  },
  render: (args) => (
    <div className="flex items-center gap-2">
      <Switch id="summary" {...args} />
      <Label htmlFor="summary">Weekly summary</Label>
    </div>
  ),
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const On: Story = { args: { defaultChecked: true } };
export const Disabled: Story = { args: { disabled: true, defaultChecked: true } };

/** Interaction test: clicking turns it on and reports it. Hidden from the manifest. */
export const Toggle: Story = {
  tags: ["!manifest"],
  play: async ({ args, canvasElement }) => {
    const control = within(canvasElement).getByRole("switch", { name: "Weekly summary" });
    await userEvent.click(control);
    await expect(control).toHaveAttribute("data-state", "checked");
    await expect(args.onCheckedChange).toHaveBeenCalledWith(true);
  },
};
