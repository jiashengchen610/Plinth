import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { Button } from "@/components/button/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "@/components/item/item";
import { CalendarClockIcon, ChevronRightIcon, RepeatIcon, ShieldIcon } from "@/icons";

/**
 * One row of a list: an icon or image, a title with a line of description, and actions at the end. Use it for
 * settings, accounts, files and menu-like lists; for rows of numbers compared across columns, use a table.
 */
const meta = {
  title: "Components/Data display/Item",
  component: Item,
  tags: ["autodocs"],
  args: { variant: "outline", size: "default" },
  argTypes: {
    variant: { control: "inline-radio", options: ["default", "outline", "muted"] },
    size: { control: "inline-radio", options: ["default", "sm", "xs"] },
  },
  render: (args) => (
    <Item className="w-96" {...args}>
      <ItemMedia variant="icon">
        <ShieldIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>Two-step sign-in</ItemTitle>
        <ItemDescription>A code from your phone each time you sign in on a new device.</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="outline" size="sm">Turn on</Button>
      </ItemActions>
    </Item>
  ),
} satisfies Meta<typeof Item>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Muted: Story = { args: { variant: "muted" } };
export const Plain: Story = { args: { variant: "default" } };
export const Small: Story = { args: { size: "sm" } };

/** Items that are links, in a group with a separator. */
export const LinkList: Story = {
  render: (args) => (
    <ItemGroup className="w-96">
      <div role="listitem">
        <Item asChild size="sm" variant={args.variant}>
          <a href="#transfers">
            <ItemMedia variant="icon">
              <CalendarClockIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Scheduled transfers</ItemTitle>
              <ItemDescription>Send money on a date you pick.</ItemDescription>
            </ItemContent>
            <ChevronRightIcon className="size-4" />
          </a>
        </Item>
      </div>
      <ItemSeparator />
      <div role="listitem">
        <Item asChild size="sm" variant={args.variant}>
          <a href="#recurring">
            <ItemMedia variant="icon">
              <RepeatIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Recurring payments</ItemTitle>
              <ItemDescription>Rent, subscriptions and other bills that repeat.</ItemDescription>
            </ItemContent>
            <ChevronRightIcon className="size-4" />
          </a>
        </Item>
      </div>
    </ItemGroup>
  ),
  args: { variant: "default" },
};

/** Interaction test: a link item is named by its title. Hidden from the manifest. */
export const LinkName: Story = {
  tags: ["!manifest"],
  render: LinkList.render,
  args: { variant: "default" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("list")).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: /Scheduled transfers/ })).toHaveAttribute("href", "#transfers");
  },
};
