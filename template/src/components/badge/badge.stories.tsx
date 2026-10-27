import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircleCheckIcon, Clock3Icon } from "@/icons";

import { Badge } from "@/components/badge/badge";

/**
 * Compact label for status, category or count, placed next to the thing it describes. Use `default`
 * for a single highlighted tag, `secondary` or `outline` for neutral metadata, `destructive` for errors
 * and blocked states, `success` / `warning` / `info` for status, `ghost` inside dense tables, and `link`
 * when the badge navigates (render with `asChild` and an anchor). Do not use a Badge as a button; it has
 * no pressed state.
 */
const meta = {
  title: "Components/Data display/Badge",
  component: Badge,
  tags: ["autodocs"],
  args: {
    children: "Active",
    variant: "default",
  },
  argTypes: {
    variant: {
      description: "Visual emphasis. Reserve `destructive` for errors and blocked states.",
      control: "select",
      options: ["default", "secondary", "destructive", "success", "warning", "info", "outline", "ghost", "link"],
    },
    asChild: {
      description: "Render the child element (e.g. an anchor) with badge styling instead of a `<span>`.",
      control: "boolean",
    },
    children: { control: "text" },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Single highlighted tag. */
export const Default: Story = {};

/** Neutral metadata on tinted surfaces. */
export const Secondary: Story = {
  args: { variant: "secondary", children: "Draft" },
};

/** Error or blocked state. */
export const Destructive: Story = {
  args: { variant: "destructive", children: "Failed" },
};

/** Completed or healthy state. */
export const Success: Story = {
  args: { variant: "success", children: "Paid" },
};

/** Needs attention, not yet an error. */
export const Warning: Story = {
  args: { variant: "warning", children: "Expires soon" },
};

/** Informational status. */
export const Info: Story = {
  args: { variant: "info", children: "Scheduled" },
};

/** Neutral metadata on plain surfaces. */
export const Outline: Story = {
  args: { variant: "outline", children: "v2.4.0" },
};

/** Lowest emphasis, for dense tables. */
export const Ghost: Story = {
  args: { variant: "ghost", children: "Archived" },
};

/** Badge that navigates. Pair with `asChild` and an anchor. */
export const Link: Story = {
  args: { variant: "link", asChild: true, children: <a href="#releases">12 releases</a> },
};

/** Leading icon reinforces the status. Icons are sized by the badge automatically. */
export const WithIcon: Story = {
  args: {
    children: (
      <>
        <CircleCheckIcon data-icon="inline-start" />
        Verified
      </>
    ),
  },
};

/** Status badges side by side, as they appear in a list header. */
export const StatusSet: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge>
        <CircleCheckIcon data-icon="inline-start" />
        Active
      </Badge>
      <Badge variant="secondary">
        <Clock3Icon data-icon="inline-start" />
        Pending
      </Badge>
      <Badge variant="success">Paid</Badge>
      <Badge variant="warning">Expires soon</Badge>
      <Badge variant="destructive">Failed</Badge>
      <Badge variant="outline">Archived</Badge>
    </div>
  ),
};
