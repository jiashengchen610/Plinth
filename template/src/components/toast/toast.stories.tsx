import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Button } from "@/components/button/button";
import { Toast, ToastAction, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/toast/toast";

/**
 * A short message that confirms something just happened and goes away by itself: "Expense added". It can offer
 * one quick action (Undo). Never put anything people must act on in a toast; use an Alert or a Dialog for that.
 * Wrap the app once in `ToastProvider` with a `ToastViewport`, then render a `Toast` when something happens.
 */
const meta = {
  title: "Components/Feedback/Toast",
  component: Toast,
  tags: ["autodocs"],
  args: { variant: "default", duration: 5000 },
  argTypes: { variant: { control: "select", options: ["default", "destructive"] }, duration: { control: "number" } },
  render: function Render(args) {
    const [open, setOpen] = useState(false);
    return (
      <ToastProvider>
        <Button variant="outline" onClick={() => setOpen(true)}>Add expense</Button>
        <Toast {...args} open={open} onOpenChange={setOpen}>
          <div className="grid gap-1">
            <ToastTitle>{args.variant === "destructive" ? "Couldn't add the expense" : "Expense added"}</ToastTitle>
            <ToastDescription>{args.variant === "destructive" ? "Check your connection and try again." : "Corner Market, $86.40"}</ToastDescription>
          </div>
          <ToastAction altText="Undo adding the expense">Undo</ToastAction>
          <ToastClose />
        </Toast>
        <ToastViewport />
      </ToastProvider>
    );
  },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Destructive: Story = { args: { variant: "destructive" } };

/** Interaction test: the toast appears after the action and can be closed. Hidden from the manifest. */
export const ShowAndClose: Story = {
  tags: ["!manifest"],
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Add expense" }));
    await expect(await body.findByText("Expense added")).toBeVisible();
    await userEvent.click(body.getByRole("button", { name: "Close" }));
    // It animates out before it is removed.
    await waitFor(() => expect(body.queryByText("Expense added")).not.toBeInTheDocument());
  },
};
