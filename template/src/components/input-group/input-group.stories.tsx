import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/input-group/input-group";
import { ArrowUpIcon, CopyIcon, PlusIcon, SearchIcon } from "@/icons";

/**
 * A text field with what belongs to it inside the same frame: a search icon, a unit, a copy button, or the buttons
 * of a message box. Keep addons small and few; anything people must read goes outside, in a Label.
 */
const meta = {
  title: "Components/Forms/Input group",
  component: InputGroup,
  tags: ["autodocs"],
  render: (args) => (
    <InputGroup className="w-72" {...args}>
      <InputGroupInput placeholder="Search transactions" aria-label="Search transactions" />
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
    </InputGroup>
  ),
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A unit before and after the number. */
export const WithText: Story = {
  render: (args) => (
    <InputGroup className="w-56" {...args}>
      <InputGroupAddon>
        <InputGroupText>$</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="0.00" aria-label="Amount" inputMode="decimal" />
      <InputGroupAddon align="inline-end">
        <InputGroupText>USD</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  ),
};

/** A button inside the field. */
export const WithButton: Story = {
  render: (args) => (
    <InputGroup className="w-80" {...args}>
      <InputGroupInput readOnly defaultValue="https://pay.example.com/r/4f2a" aria-label="Payment link" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton aria-label="Copy link">
          <CopyIcon />
          Copy
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

/** A message box: several lines, with its buttons below. */
export const Message: Story = {
  render: (args) => (
    <InputGroup className="w-96" {...args}>
      <InputGroupTextarea placeholder="Ask about your spending…" aria-label="Message" />
      <InputGroupAddon align="block-end">
        <InputGroupButton variant="outline" size="icon-xs" className="rounded-full" aria-label="Add a file">
          <PlusIcon />
        </InputGroupButton>
        <InputGroupButton variant="default" size="icon-xs" className="ml-auto rounded-full" aria-label="Send">
          <ArrowUpIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const Invalid: Story = {
  render: (args) => (
    <InputGroup className="w-56" {...args}>
      <InputGroupAddon>
        <InputGroupText>$</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput defaultValue="12,5,0" aria-label="Amount" aria-invalid />
    </InputGroup>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <InputGroup className="w-72" {...args}>
      <InputGroupInput placeholder="Search transactions" aria-label="Search transactions" disabled />
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
    </InputGroup>
  ),
};

/** Interaction test: clicking the icon puts the cursor in the field. Hidden from the manifest. */
export const ClickAddon: Story = {
  tags: ["!manifest"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole("textbox", { name: "Search transactions" });
    const addon = canvasElement.querySelector<HTMLElement>("[data-slot=input-group-addon]");
    await userEvent.click(addon!);
    await expect(field).toHaveFocus();
  },
};
