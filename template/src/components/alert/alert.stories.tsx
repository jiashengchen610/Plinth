import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { Alert, AlertDescription, AlertTitle } from "@/components/alert/alert";
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "@/icons";

/**
 * A message that stays on the page until the situation changes: a problem with the form, an account notice, a
 * reminder. Lead with a short title; put the detail and what to do next in the description. Use `destructive` for
 * errors, `warning` for something that needs attention soon, `success` to confirm, `info` for neutral news. For a
 * short confirmation that goes away by itself, use a Toast.
 */
const meta = {
  title: "Components/Feedback/Alert",
  component: Alert,
  tags: ["autodocs"],
  args: { variant: "default" },
  argTypes: { variant: { control: "select", options: ["default", "destructive", "success", "warning", "info"] } },
  render: (args) => (
    <Alert {...args} className="w-96">
      {args.variant === "destructive" ? <CircleAlertIcon /> : args.variant === "success" ? <CircleCheckIcon /> : args.variant === "warning" ? <TriangleAlertIcon /> : <InfoIcon />}
      <AlertTitle>Dining out is at 90%</AlertTitle>
      <AlertDescription>You have $20 left for October. It resets on the 1st.</AlertDescription>
    </Alert>
  ),
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Destructive: Story = { args: { variant: "destructive" } };
export const Success: Story = { args: { variant: "success" } };
export const Warning: Story = { args: { variant: "warning" } };
export const Info: Story = { args: { variant: "info" } };

/** Accessibility test: the alert is announced and its title and text are readable. Hidden from the manifest. */
export const Announced: Story = {
  tags: ["!manifest"],
  args: { variant: "warning" },
  play: async ({ canvasElement }) => {
    const alert = within(canvasElement).getByRole("alert");
    await expect(alert).toHaveTextContent("Dining out is at 90%");
    await expect(alert).toHaveTextContent("You have $20 left");
  },
};
