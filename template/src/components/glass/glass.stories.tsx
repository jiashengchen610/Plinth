import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { expect, within } from "storybook/test";

import { Button } from "@/components/button/button";
import { Glass } from "@/components/glass/glass";

/** Something busy to put glass on: soft shapes in palette colors, or a page of text. */
function Backdrop({ kind, children }: { kind: "color" | "text" | "dark" | "light"; children: ReactNode }) {
  return (
    <div className={`relative grid min-h-80 w-xl max-w-full place-items-center overflow-hidden rounded-glass p-8 ${kind === "dark" ? "bg-black" : kind === "light" ? "bg-white ring-1 ring-black/10 ring-inset" : "bg-linear-to-br from-rose-300 via-amber-200 to-sky-300"}`}>
      {kind === "color" && (
        <>
          <span aria-hidden="true" className="absolute top-6 left-10 size-40 rounded-full bg-rose-500" />
          <span aria-hidden="true" className="absolute right-8 bottom-4 size-48 rounded-full bg-sky-500" />
          <span aria-hidden="true" className="absolute top-24 left-1/2 size-28 rounded-full bg-amber-400" />
        </>
      )}
      {kind === "text" && (
        <p aria-hidden="true" className="absolute inset-6 type-body-lg text-black">
          Glass keeps what is behind it soft but present. Rent 1,200 · Groceries 310 · Transport 96 · Dining out 184 ·
          Savings 400 · Utilities 142 · Phone 35 · Insurance 88 · Gym 45 · Books 27 · Rent 1,200 · Groceries 310 ·
          Transport 96 · Dining out 184 · Savings 400 · Utilities 142 · Phone 35 · Insurance 88 · Gym 45 · Books 27.
        </p>
      )}
      {children}
    </div>
  );
}

function Panel() {
  return (
    <div className="flex flex-col gap-3 p-5">
      <span className="type-heading-sm">October budget</span>
      <span>1,240 of 2,000 spent. You are on track.</span>
      <Button className="self-start">See details</Button>
    </div>
  );
}

/**
 * A frosted panel over photos, artwork or busy color: what is behind it shows through, blurred and tinted with the
 * glass color, with a light edge. Use it for floating bars and panels over imagery; on plain backgrounds use a Card.
 * Text on it is checked over the darkest and the lightest backdrop. Where the browser cannot blur, or the system asks
 * for less transparency, the glass is solid.
 */
const meta = {
  title: "Components/Layout/Glass",
  component: Glass,
  tags: ["autodocs"],
  args: { className: "w-80" },
  argTypes: { className: { table: { disable: true } } },
  render: (args) => (
    <Backdrop kind="color">
      <Glass {...args}>
        <Panel />
      </Glass>
    </Backdrop>
  ),
} satisfies Meta<typeof Glass>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Over color: the shapes behind it blur and tint; the glass blurs what is behind it. */
export const OverColor: Story = {
  play: async ({ canvasElement }) => {
    const glass = canvasElement.querySelector<HTMLElement>("[data-slot=glass]");
    await expect(glass).not.toBeNull();
    await expect(getComputedStyle(glass!).backdropFilter).toMatch(/blur/);
    await expect(within(canvasElement).getByRole("button", { name: "See details" })).toBeVisible();
  },
};

/** Over text: what is behind it stays soft, so the panel's own text reads first. */
export const OverText: Story = {
  render: (args) => (
    <Backdrop kind="text">
      <Glass {...args}>
        <Panel />
      </Glass>
    </Backdrop>
  ),
};

/** On black and on white: the two extremes its text is checked against. */
export const Extremes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      <Backdrop kind="dark">
        <Glass {...args}>
          <Panel />
        </Glass>
      </Backdrop>
      <Backdrop kind="light">
        <Glass {...args}>
          <Panel />
        </Glass>
      </Backdrop>
    </div>
  ),
};
