import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { Button } from "@/components/button/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/dialog/dialog";

/**
 * A window over the page that asks for one decision or a short task, and blocks the page until it is done: confirm
 * a delete, name a new budget. Keep it short, with one primary action and a way out (Cancel, Escape, the close
 * button). For information that does not need a decision, use an Alert or a Toast.
 */
const meta = {
  title: "Components/Overlays/Dialog",
  component: Dialog,
  tags: ["autodocs"],
  args: { onOpenChange: fn() },
  argTypes: { onOpenChange: { table: { disable: true } }, open: { control: "boolean" } },
  render: (args) => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button variant="outline">Delete expense</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this expense?</DialogTitle>
          <DialogDescription>"Corner Market, $86.40" will be removed from October. You can't undo this.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <DialogClose asChild><Button variant="destructive">Delete</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Open from the start, to see the window and its backdrop. */
export const Open: Story = { args: { defaultOpen: true } };

/** Interaction test: open, read the title, close with Escape. Hidden from the manifest. */
export const OpenAndEscape: Story = {
  tags: ["!manifest"],
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Delete expense" }));
    // It fades in, so check what it says rather than how opaque it is yet.
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Delete this expense?" });
    await expect(dialog).toHaveTextContent("You can't undo this.");
    await userEvent.keyboard("{Escape}");
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(false);
  },
};
