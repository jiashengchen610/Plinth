import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { Label } from "@/components/label/label";
import { Textarea } from "@/components/textarea/textarea";

/**
 * Multi-line text field for notes, messages and descriptions. It grows with its content. Accepts every native
 * `<textarea>` attribute; `aria-invalid` turns on the error styling. Pair it with a `Label`. Use an Input for a
 * single line.
 */
const meta = {
  title: "Components/Forms/Textarea",
  component: Textarea,
  tags: ["autodocs"],
  args: { placeholder: "What was this for?", "aria-label": "Note", disabled: false },
  argTypes: {
    placeholder: { control: "text" },
    disabled: { control: "boolean" },
    "aria-invalid": { description: "Marks the field invalid: destructive border and ring.", control: "boolean" },
    "aria-label": { table: { disable: true } },
    onChange: { table: { disable: true } },
  },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** With a visible label: prefer this over `aria-label` whenever there is room. */
export const WithLabel: Story = {
  args: { id: "note", "aria-label": undefined },
  render: (args) => (
    <div className="grid w-80 gap-2">
      <Label htmlFor="note">Note</Label>
      <Textarea {...args} />
    </div>
  ),
};

export const Invalid: Story = { args: { "aria-invalid": true, defaultValue: "Too short" } };
export const Disabled: Story = { args: { disabled: true, defaultValue: "Locked after approval" } };

/** Interaction test: typing several lines keeps them and fires `onChange`. Hidden from the manifest. */
export const Typing: Story = {
  tags: ["!manifest"],
  args: { onChange: fn() },
  play: async ({ args, canvasElement }) => {
    const field = within(canvasElement).getByRole("textbox", { name: "Note" });
    await userEvent.type(field, "Groceries{enter}for the week");
    await expect(field).toHaveValue("Groceries\nfor the week");
    await expect(args.onChange).toHaveBeenCalled();
  },
};
