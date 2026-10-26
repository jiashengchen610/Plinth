import type { Decorator, Preview } from "@storybook/react-vite";
import "../src/index.css";
import system from "../design-system.json";

type Brand = { id: string; name?: string };
const brands: Brand[] = (system.brands as Brand[]) ?? [{ id: "default" }];

/** Applies the selected brand and mode to <html>, where the generated token CSS expects them. */
const withBrandAndMode: Decorator = (Story, context) => {
  const root = document.documentElement;
  root.dataset.brand = context.globals.brand ?? system.defaultBrand ?? brands[0].id;
  root.classList.toggle("dark", context.globals.mode === "dark");
  return Story();
};

const preview: Preview = {
  decorators: [withBrandAndMode],
  globalTypes: {
    brand: {
      description: "Brand",
      toolbar: { title: "Brand", icon: "paintbrush", items: brands.map((b) => ({ value: b.id, title: b.name ?? b.id })), dynamicTitle: true },
    },
    mode: {
      description: "Color mode",
      toolbar: { title: "Mode", icon: "mirror", items: [{ value: "light", title: "Light" }, { value: "dark", title: "Dark" }], dynamicTitle: true },
    },
  },
  initialGlobals: { brand: system.defaultBrand ?? brands[0].id, mode: "light" },
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: { test: "error" },
  },
};

export default preview;
