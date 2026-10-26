import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [
    "@chromatic-com/storybook",
    "@storybook/addon-vitest",
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@storybook/addon-mcp",
  ],
  framework: "@storybook/react-vite",
  // AI layer: component + docs manifests at /manifests/*.json, consumed by addon-mcp and
  // snapshotted into .design-system/ by design-system-skills/scripts/snapshot-manifest.mjs.
  features: {
    componentsManifest: true,
  },
  // react-docgen-typescript extracts union literals and JSDoc from the exported props types,
  // which is what the components manifest needs for agents to see real prop values.
  typescript: {
    reactDocgen: "react-docgen-typescript",
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      shouldRemoveUndefinedFromOptional: true,
      propFilter: (prop) => (prop.parent ? !/node_modules/.test(prop.parent.fileName) : true),
    },
  },
};
export default config;
