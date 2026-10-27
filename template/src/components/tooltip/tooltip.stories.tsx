import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { Button } from "@/components/button/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/tooltip/tooltip";
import { InfoIcon } from "@/icons";

/**
 * A short hint that appears when someone points at or tabs to something: what an icon button does, what a number
 * means. A few words, never anything people must read to finish a task (touch screens may never show it). For
 * longer help, put the text on the page.
 */
const meta = {
  title: "Components/Feedback/Tooltip",
  component: TooltipContent,
  tags: ["autodocs"],
  args: { side: "top", children: "Money left after bills" },
  argTypes: { side: { control: "select", options: ["top", "right", "bottom", "left"] }, children: { control: "text" } },
  render: (args) => (
    <div className="flex h-32 items-center justify-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" aria-label="What is safe to spend?"><InfoIcon /></Button>
        </TooltipTrigger>
        <TooltipContent {...args} />
      </Tooltip>
    </div>
  ),
} satisfies Meta<typeof TooltipContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Bottom: Story = { args: { side: "bottom" } };

/** Interaction test: focusing the trigger shows the hint. Hidden from the manifest. */
export const OnFocus: Story = {
  tags: ["!manifest"],
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(within(canvasElement).getByRole("button", { name: "What is safe to spend?" })).toHaveFocus();
    const tip = await within(canvasElement.ownerDocument.body).findByRole("tooltip");
    await expect(tip).toHaveTextContent("Money left after bills");
  },
};
