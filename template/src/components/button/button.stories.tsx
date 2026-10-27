import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ArrowRightIcon, LoaderCircleIcon, PlusIcon } from "@/icons";

import { Button } from "@/components/button/button";

/**
 * Triggers an action or navigation. Use `default` for the single primary action on a view,
 * `outline` or `secondary` for supporting actions, `ghost` inside toolbars and dense lists,
 * `destructive` for irreversible actions, and `link` when the action should read as inline text.
 * Do not use a Button for page navigation when a plain link is enough.
 */
const meta = {
  title: "Components/Actions/Button",
  component: Button,
  tags: ["autodocs"],
  args: {
    children: "Save changes",
    variant: "default",
    size: "default",
    disabled: false,
    onClick: fn(),
  },
  argTypes: {
    variant: {
      description: "Visual emphasis. One primary (`default`) button per view.",
      control: "select",
      options: ["default", "outline", "secondary", "ghost", "destructive", "link"],
    },
    size: {
      description: "Height and padding scale. `icon*` sizes render a square button for a single icon.",
      control: "select",
      options: ["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"],
    },
    asChild: {
      description: "Render the child element (e.g. an anchor) with button styling instead of a `<button>`.",
      control: "boolean",
    },
    disabled: { control: "boolean" },
    children: { control: "text" },
    onClick: { table: { disable: true } },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The canonical primary action. */
export const Default: Story = {};

/** Supporting action placed next to a primary button. */
export const Outline: Story = {
  args: { variant: "outline", children: "Cancel" },
};

/** Lower-emphasis alternative to `outline` on tinted surfaces. */
export const Secondary: Story = {
  args: { variant: "secondary", children: "Duplicate" },
};

/** Toolbar and dense-list action with no border until hovered. */
export const Ghost: Story = {
  args: { variant: "ghost", children: "Dismiss" },
};

/** Irreversible action. Pair with a confirmation dialog. */
export const Destructive: Story = {
  args: { variant: "destructive", children: "Delete project" },
};

/** Reads as inline text; use inside sentences or footers. */
export const Link: Story = {
  args: { variant: "link", children: "Learn more" },
};

export const ExtraSmall: Story = {
  args: { size: "xs", children: "Tag" },
};

export const Small: Story = {
  args: { size: "sm", children: "Add filter" },
};

export const Large: Story = {
  args: { size: "lg", children: "Get started" },
};

/** Icon-only button. Always provide an accessible name via `aria-label`. */
export const Icon: Story = {
  args: { size: "icon", "aria-label": "Add item", children: <PlusIcon /> },
};

/** Leading or trailing icon with text. Icons inherit the size scale automatically. */
export const WithIcon: Story = {
  args: {
    children: (
      <>
        Continue
        <ArrowRightIcon data-icon="inline-end" />
      </>
    ),
  },
};

/** Loading state: disable the button and swap in a spinner so the width does not jump. */
export const Loading: Story = {
  args: {
    disabled: true,
    "aria-busy": true,
    children: (
      <>
        <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
        Saving
      </>
    ),
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};

/** Renders an anchor with button styling. */
export const AsLink: Story = {
  args: { asChild: true, children: <a href="#docs">Open documentation</a> },
};

/** Interaction test: a click calls `onClick` once; a disabled button never does. */
export const Clickable: Story = {
  tags: ["!manifest"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save changes" }));
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};
