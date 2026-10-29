import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { Button } from "@/components/button/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/empty/empty";
import { InboxIcon, LandmarkIcon } from "@/icons";

/**
 * What a page or panel shows when there is nothing in it yet: what is missing, why, and the one thing to do next.
 * Never leave an empty area blank, and never blame the person.
 */
const meta = {
  title: "Components/Feedback/Empty",
  component: Empty,
  tags: ["autodocs"],
  render: (args) => (
    <Empty className="w-96" {...args}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LandmarkIcon />
        </EmptyMedia>
        <EmptyTitle>No bank connected</EmptyTitle>
        <EmptyDescription>Connect a bank to see your spending here. It takes about two minutes.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>Connect a bank</Button>
      </EmptyContent>
    </Empty>
  ),
} satisfies Meta<typeof Empty>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** With a dashed outline, where the empty area needs edges. */
export const Outlined: Story = {
  render: (args) => (
    <Empty className="w-96 border border-dashed" {...args}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>No receipts yet</EmptyTitle>
        <EmptyDescription>Receipts you forward to your budget email show up here.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex gap-2">
          <Button>Copy the email address</Button>
          <Button variant="outline">Learn how</Button>
        </div>
      </EmptyContent>
    </Empty>
  ),
};

/** Interaction test: the empty state says what is missing and offers the next step. Hidden from the manifest. */
export const NextStep: Story = {
  tags: ["!manifest"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No bank connected")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Connect a bank" })).toBeEnabled();
  },
};
