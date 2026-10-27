import type { Meta, StoryObj } from "@storybook/react-vite";
import { EllipsisIcon } from "@/icons";

import { Badge } from "@/components/badge/badge";
import { Button } from "@/components/button/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/card/card";

/**
 * Surface that groups related content and actions into a single unit. Compose it from `CardHeader`
 * (with `CardTitle`, `CardDescription`, optional `CardAction`), `CardContent` and `CardFooter`; spacing
 * is shared through the `size` prop. Use cards for scannable collections (dashboards, lists of entities)
 * and settings sections. Do not nest cards or use a card as the only container on a page.
 */
const meta = {
  title: "Components/Layout/Card",
  component: Card,
  subcomponents: { CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter },
  tags: ["autodocs"],
  args: {
    size: "default",
    className: "w-80",
  },
  argTypes: {
    size: {
      description: "Shared padding and gap for every section. `sm` for dense grids and sidebars.",
      control: "select",
      options: ["default", "sm"],
    },
    className: { table: { disable: true } },
  },
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>Team plan</CardTitle>
        <CardDescription>Billed yearly. Renews on 14 March.</CardDescription>
      </CardHeader>
      <CardContent>
        <p>12 seats in use out of 20. Add seats at any time; unused seats are prorated.</p>
      </CardContent>
    </Card>
  ),
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Header, description and content with default spacing. */
export const Default: Story = {};

/** Dense variant for grids and sidebars. */
export const Small: Story = {
  args: { size: "sm" },
};

/** Footer holds the card's actions; it gets a muted background and a top border automatically. */
export const WithFooter: Story = {
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>Invite teammates</CardTitle>
        <CardDescription>They will get an email with a link to join this workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Members can view and comment. Admins can also manage billing.</p>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline">Cancel</Button>
        <Button>Send invites</Button>
      </CardFooter>
    </Card>
  ),
};

/** `CardAction` pins a control to the top-right of the header. */
export const WithAction: Story = {
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>Production API key</CardTitle>
        <CardDescription>Created 3 weeks ago · last used today</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="More options">
            <EllipsisIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <Badge variant="outline">sk-live-••••-4f2a</Badge>
        <Badge>Active</Badge>
      </CardContent>
    </Card>
  ),
};

/** A leading image bleeds to the card edges and rounds its top corners. */
export const WithImage: Story = {
  render: (args) => (
    <Card {...args}>
      <img
        src="https://picsum.photos/seed/design-system/640/320"
        alt="Abstract gradient cover"
        className="aspect-video w-full object-cover"
      />
      <CardHeader>
        <CardTitle>Quarterly design review</CardTitle>
        <CardDescription>Recording and notes from 28 September</CardDescription>
      </CardHeader>
    </Card>
  ),
};

/** Content only, for simple stat tiles. */
export const ContentOnly: Story = {
  render: (args) => (
    <Card {...args} className="w-56">
      <CardContent>
        <p className="text-sm text-muted-foreground">Active users</p>
        <p className="font-heading text-2xl font-medium">4,812</p>
      </CardContent>
    </Card>
  ),
};
