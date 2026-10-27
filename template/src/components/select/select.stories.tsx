import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { Label } from "@/components/label/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/select/select";

/**
 * Picks one option from a list that would take too much room as Radio buttons (more than five options). The list
 * opens over the page and works with the keyboard (arrows, type to jump, Enter to pick). Pair the trigger with a
 * `Label`.
 */
const meta = {
  title: "Components/Forms/Select",
  component: Select,
  tags: ["autodocs"],
  args: { onValueChange: fn(), disabled: false },
  argTypes: {
    disabled: { control: "boolean" },
    onValueChange: { table: { disable: true } },
  },
  render: (args) => (
    <div className="grid w-64 gap-2">
      <Label htmlFor="category">Category</Label>
      <Select {...args}>
        <SelectTrigger id="category" className="w-full">
          <SelectValue placeholder="Pick a category" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Everyday</SelectLabel>
            <SelectItem value="groceries">Groceries</SelectItem>
            <SelectItem value="transport">Transport</SelectItem>
            <SelectItem value="dining">Dining out</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Bills</SelectLabel>
            <SelectItem value="rent">Rent</SelectItem>
            <SelectItem value="utilities">Utilities</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  ),
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithValue: Story = { args: { defaultValue: "dining" } };
export const Disabled: Story = { args: { disabled: true, defaultValue: "rent" } };

/** Interaction test: open the list, pick an option, the trigger shows it. Hidden from the manifest. */
export const PickOption: Story = {
  tags: ["!manifest"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("combobox", { name: "Category" }));
    // The list renders in a portal on <body>.
    const option = await within(canvasElement.ownerDocument.body).findByRole("option", { name: "Transport" });
    await userEvent.click(option);
    await expect(args.onValueChange).toHaveBeenCalledWith("transport");
    // While the list closes, the page behind it is still hidden from assistive tech: wait until it is back.
    await waitFor(() => expect(canvas.getByRole("combobox", { name: "Category" })).toHaveTextContent("Transport"));
  },
};
