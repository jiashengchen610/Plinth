import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { Input } from "@/components/input/input";
import { Label } from "@/components/label/label";

/**
 * Single-line text field. Accepts every native `<input>` attribute; type, placeholder and validation
 * state come from attributes, not variants (`aria-invalid` turns on the error styling). Always pair it
 * with a `Label` or an `aria-label`. Use a Textarea for multi-line text and a Select for closed choices.
 */
const meta = {
  title: "Components/Forms/Input",
  component: Input,
  tags: ["autodocs"],
  args: {
    type: "text",
    placeholder: "name@company.com",
    "aria-label": "Email",
    disabled: false,
  },
  argTypes: {
    type: {
      description: "Native input type. File inputs get their own styling.",
      control: "select",
      options: ["text", "email", "password", "number", "search", "file"],
    },
    placeholder: { control: "text" },
    disabled: { control: "boolean" },
    "aria-invalid": {
      description: "Marks the field invalid and switches to destructive border and ring.",
      control: "boolean",
    },
    "aria-label": { table: { disable: true } },
    onChange: { table: { disable: true } },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty field with placeholder. */
export const Default: Story = {};

/** Field with a visible label. Prefer this over `aria-label` whenever there is room. */
export const WithLabel: Story = {
  args: { id: "email", "aria-label": undefined },
  render: (args) => (
    <div className="grid w-72 gap-2">
      <Label htmlFor="email">Work email</Label>
      <Input {...args} />
    </div>
  ),
};

/** Invalid state. Pair with an error message referenced by `aria-describedby`. */
export const Invalid: Story = {
  args: { "aria-invalid": true, defaultValue: "name@company", "aria-describedby": "email-error" },
  render: (args) => (
    <div className="grid w-72 gap-2">
      <Input {...args} />
      <p id="email-error" className="type-body-md text-destructive">
        Enter a complete email address.
      </p>
    </div>
  ),
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: "ops@company.com" },
};

/** Password fields hide their value; browsers add their own reveal control. */
export const Password: Story = {
  args: { type: "password", placeholder: "At least 12 characters", "aria-label": "Password" },
};

/** File inputs style the native button to match the text scale. */
export const File: Story = {
  args: { type: "file", "aria-label": "Attachment", placeholder: undefined },
};

/** Interaction test: typing updates the value and fires `onChange`. Hidden from the manifest. */
export const Typing: Story = {
  tags: ["!manifest"],
  args: { onChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole("textbox", { name: "Email" });
    await userEvent.type(field, "ada@company.com");
    await expect(field).toHaveValue("ada@company.com");
    await expect(args.onChange).toHaveBeenCalled();
  },
};
