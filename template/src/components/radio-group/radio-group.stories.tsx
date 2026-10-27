import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { Label } from "@/components/label/label";
import { RadioGroup, RadioGroupItem } from "@/components/radio-group/radio-group";

/**
 * Picks exactly one option from a short list that should all stay visible (two to five options). Arrow keys move
 * between options. For longer lists use a Select; for on/off use a Switch or Checkbox.
 */
const meta = {
  title: "Components/Forms/Radio group",
  component: RadioGroup,
  tags: ["autodocs"],
  args: { defaultValue: "monthly", disabled: false, onValueChange: fn(), "aria-label": "Budget period" },
  argTypes: {
    disabled: { control: "boolean" },
    onValueChange: { table: { disable: true } },
  },
  render: (args) => (
    <RadioGroup {...args}>
      {["weekly", "monthly", "yearly"].map((v) => (
        <div key={v} className="flex items-center gap-2">
          <RadioGroupItem value={v} id={`period-${v}`} />
          <Label htmlFor={`period-${v}`} className="capitalize">{v}</Label>
        </div>
      ))}
    </RadioGroup>
  ),
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };

/** Interaction test: picking another option selects it and reports the value. Hidden from the manifest. */
export const Pick: Story = {
  tags: ["!manifest"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("radio", { name: "yearly" }));
    await expect(canvas.getByRole("radio", { name: "yearly" })).toBeChecked();
    await expect(args.onValueChange).toHaveBeenCalledWith("yearly");
  },
};
