import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { Separator } from "@/components/separator/separator";

/**
 * A thin line between groups of content: rows of a list, sections of a card, items of a toolbar (`vertical`). It is
 * decorative by default; set `decorative={false}` when the split carries meaning for screen readers.
 */
const meta = {
  title: "Components/Layout/Separator",
  component: Separator,
  tags: ["autodocs"],
  args: { orientation: "horizontal", decorative: true },
  argTypes: { orientation: { control: "select", options: ["horizontal", "vertical"] }, decorative: { control: "boolean" } },
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="w-72 type-body-md">
      <div className="py-2">Groceries</div>
      <Separator {...args} />
      <div className="py-2">Dining out</div>
    </div>
  ),
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
  render: (args) => (
    <div className="flex h-5 items-center gap-3 type-body-md">
      <span>Edit</span>
      <Separator {...args} />
      <span>Share</span>
    </div>
  ),
};

/** Accessibility test: a meaningful separator is exposed to screen readers; a decorative one is not. Hidden from the manifest. */
export const Semantic: Story = {
  tags: ["!manifest"],
  args: { decorative: false, orientation: "vertical" },
  render: (args) => <div className="flex h-5 items-center gap-3"><Separator {...args} /><Separator /></div>,
  play: async ({ canvasElement }) => {
    const found = within(canvasElement).getAllByRole("separator");
    await expect(found).toHaveLength(1);
    await expect(found[0]).toHaveAttribute("aria-orientation", "vertical");
  },
};
