import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/alert-dialog/alert-dialog";
import { Button } from "@/components/button/button";
import { Trash2Icon } from "@/icons";

/**
 * Asks before something that cannot be undone, like deleting an account, and waits for the answer. Name the action
 * ("Delete account"), say what will be lost, and offer Cancel. For a task or form in a window, use a Dialog; for news
 * that needs no answer, an Alert or a Toast.
 */
const meta = {
  title: "Components/Overlays/Alert dialog",
  component: AlertDialog,
  tags: ["autodocs"],
  args: { defaultOpen: false },
  render: (args) => (
    <AlertDialog {...args}>
      <AlertDialogTrigger asChild>
        <Button variant="outline">Delete account</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>Your budgets, goals and 2 years of history are deleted for good. Download them first if you want a copy.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Delete account</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
} satisfies Meta<typeof AlertDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Open, to see it without clicking. Left off the All components page, where it would cover everything. */
export const Open: Story = { args: { defaultOpen: true } };

/** Small, with an icon: for short questions. */
export const SmallWithMedia: Story = {
  render: (args) => (
    <AlertDialog {...args}>
      <AlertDialogTrigger asChild>
        <Button variant="outline">Remove goal</Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>Remove this goal?</AlertDialogTitle>
          <AlertDialogDescription>The $1,240 you saved stays in your account.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
};

/** Interaction test: it opens as an alert dialog and Cancel closes it. Hidden from the manifest. */
export const OpenAndCancel: Story = {
  tags: ["!manifest"],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Delete account" }));
    const page = within(canvasElement.ownerDocument.body);
    const dialog = await page.findByRole("alertdialog", { name: "Delete your account?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(page.queryByRole("alertdialog")).not.toBeInTheDocument());
  },
};
