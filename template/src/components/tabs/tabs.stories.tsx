import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/tabs/tabs";

/**
 * Switches between views of the same thing (this month / last month / this year) without leaving the page. Keep
 * labels to one or two words and the number of tabs small. Arrow keys move between tabs. For moving between pages,
 * use navigation links instead.
 */
const meta = {
  title: "Components/Navigation/Tabs",
  component: Tabs,
  tags: ["autodocs"],
  args: { defaultValue: "month", onValueChange: fn() },
  argTypes: { onValueChange: { table: { disable: true } } },
  render: (args) => (
    <Tabs {...args} className="w-96">
      <TabsList>
        <TabsTrigger value="month">This month</TabsTrigger>
        <TabsTrigger value="last">Last month</TabsTrigger>
        <TabsTrigger value="year">This year</TabsTrigger>
      </TabsList>
      <TabsContent value="month">Spent $1,240 of $2,000.</TabsContent>
      <TabsContent value="last">Spent $1,890 of $2,000.</TabsContent>
      <TabsContent value="year">Spent $18,300 so far.</TabsContent>
    </Tabs>
  ),
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Interaction test: choosing a tab shows its panel. Hidden from the manifest. */
export const ChooseTab: Story = {
  tags: ["!manifest"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("tab", { name: "This year" }));
    await expect(canvas.getByRole("tab", { name: "This year" })).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByRole("tabpanel")).toHaveTextContent("Spent $18,300 so far.");
    await expect(args.onValueChange).toHaveBeenCalledWith("year");
  },
};
