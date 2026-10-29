import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { Button } from "@/components/button/button";
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from "@/components/button-group/button-group";
import { Input } from "@/components/input/input";
import { ChevronDownIcon, MinusIcon, PlusIcon } from "@/icons";

/**
 * Related actions joined into one control: a period switcher, a split button with more options, a field with its
 * unit. Keep a group to a few actions of the same weight; for one main action and a few others, use separate buttons.
 */
const meta = {
  title: "Components/Actions/Button group",
  component: ButtonGroup,
  tags: ["autodocs"],
  args: { orientation: "horizontal", "aria-label": "Period" },
  argTypes: { orientation: { control: "inline-radio", options: ["horizontal", "vertical"] } },
  render: (args) => (
    <ButtonGroup {...args}>
      <Button variant="outline">Day</Button>
      <Button variant="outline">Week</Button>
      <Button variant="outline">Month</Button>
    </ButtonGroup>
  ),
} satisfies Meta<typeof ButtonGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Vertical: Story = { args: { orientation: "vertical" } };

/** A split button: the main action, and a menu of the others. */
export const Split: Story = {
  args: { "aria-label": "Save" },
  render: (args) => (
    <ButtonGroup {...args}>
      <Button>Save changes</Button>
      <ButtonGroupSeparator />
      <Button size="icon" aria-label="More ways to save">
        <ChevronDownIcon />
      </Button>
    </ButtonGroup>
  ),
};

/** A field with its unit. */
export const WithText: Story = {
  args: { "aria-label": "Amount" },
  render: (args) => (
    <ButtonGroup {...args}>
      <ButtonGroupText>$</ButtonGroupText>
      <Input placeholder="0.00" aria-label="Amount" className="w-32" />
      <ButtonGroupText>USD</ButtonGroupText>
    </ButtonGroup>
  ),
};

/** Groups side by side. */
export const Nested: Story = {
  args: { "aria-label": "Quantity" },
  render: (args) => (
    <ButtonGroup {...args}>
      <ButtonGroup>
        <Button variant="outline" size="icon" aria-label="One fewer"><MinusIcon /></Button>
        <Button variant="outline" size="icon" aria-label="One more"><PlusIcon /></Button>
      </ButtonGroup>
      <ButtonGroup>
        <Button variant="outline">Reset</Button>
      </ButtonGroup>
    </ButtonGroup>
  ),
};

/** Interaction test: one named group holding its buttons. Hidden from the manifest. */
export const Grouped: Story = {
  tags: ["!manifest"],
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole("group", { name: "Period" });
    await expect(within(group).getAllByRole("button")).toHaveLength(3);
  },
};
