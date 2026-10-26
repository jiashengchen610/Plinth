// Template for an AI-readable CSF story file. Replace every __PLACEHOLDER__ and delete this header.
// Conventions: references/story-conventions.md. Verified field mapping (Storybook 10.6.1):
//   JSDoc above `const meta`        -> manifest component.description
//   JSDoc above each `export const` -> manifest stories[*].description
//   static args                     -> manifest stories[*].snippet
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { __COMPONENT__ } from "__IMPORT_PATH__";

/**
 * __DESCRIPTION__
 *
 * When to use: __WHEN_TO_USE__
 * When not to use: __WHEN_NOT_TO_USE__
 *
 * Figma: __FIGMA_COMPONENT_NAME__ — __FIGMA_PROP_MAPPING__ (e.g. `Variant` ↔ `variant`, `Size` ↔ `size`)
 */
const meta = {
  title: "__TITLE__", // Components/<Group>/<Name> for primitives, Patterns/<Name> for compositions
  component: __COMPONENT__,
  tags: ["autodocs"],
  args: {
    // Realistic default content. No "Lorem ipsum", no "Button".
    __DEFAULT_ARGS__
  },
  argTypes: {
    // Only what docgen cannot infer: cva unions, hidden handlers, descriptions for vendored props.
    __ARG_TYPES__
  },
} satisfies Meta<typeof __COMPONENT__>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The canonical appearance. */
export const Default: Story = {};

// One story per variant value that changes appearance. Name it after the value.
/** __VARIANT_DESCRIPTION__ */
export const __VariantName__: Story = {
  args: { variant: "__variant-value__" },
};

// One story per size value.
export const __SizeName__: Story = {
  args: { size: "__size-value__" },
};

// States the component supports: Disabled, Loading, Invalid, WithIcon, Empty, ...
export const Disabled: Story = {
  args: { disabled: true },
};

/** Interaction test exercised by Storybook MCP `test-run`. Hidden from the manifest. */
export const __InteractionName__: Story = {
  tags: ["!manifest"],
  args: { __HANDLER__: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("__role__", { name: "__accessible-name__" }));
    await expect(args.__HANDLER__).toHaveBeenCalledTimes(1);
  },
};
