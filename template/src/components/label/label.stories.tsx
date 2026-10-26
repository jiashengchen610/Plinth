import type { Meta, StoryObj } from "@storybook/react-vite";

import { Input } from "@/components/input/input";
import { Label } from "@/components/label/label";

/**
 * Accessible caption for a form control, built on Radix Label. Associate it with `htmlFor` (or wrap the
 * control) so clicking the text focuses the field and screen readers announce it. It dims automatically
 * when a sibling `peer` control is disabled. Use it for every Input, Select, Checkbox and Switch; do not
 * use it for headings or helper text.
 */
const meta = {
  title: "Components/Forms/Label",
  component: Label,
  tags: ["autodocs"],
  args: {
    children: "Display name",
    htmlFor: "display-name",
  },
  argTypes: {
    htmlFor: { description: "Id of the control this label describes.", control: "text" },
    children: { control: "text" },
  },
  render: (args) => (
    <div className="grid w-72 gap-2">
      <Label {...args} />
      <Input id="display-name" placeholder="Ada Lovelace" />
    </div>
  ),
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Label above its field. */
export const Default: Story = {};

/** Required marker as a child; announce the requirement on the control with `required` or `aria-required`. */
export const Required: Story = {
  args: {
    children: (
      <>
        Display name
        <span aria-hidden="true" className="text-destructive">
          *
        </span>
      </>
    ),
  },
  render: (args) => (
    <div className="grid w-72 gap-2">
      <Label {...args} />
      <Input id="display-name" placeholder="Ada Lovelace" required />
    </div>
  ),
};

/** The label dims when its `peer` control is disabled. Put the control before the label for the `peer-*` classes to apply. */
export const DisabledPeer: Story = {
  args: { htmlFor: "api-key", children: "API key (managed by your admin)" },
  render: (args) => (
    <div className="flex w-72 flex-col-reverse gap-2">
      <Input id="api-key" className="peer" disabled defaultValue="sk-live-••••-4f2a" />
      <Label {...args} />
    </div>
  ),
};
