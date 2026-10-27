// Managed by Plinth: rewritten from the template so fixes reach existing design systems. Edits here are replaced.
import type { Decorator, Preview } from "@storybook/react-vite";
import { addons } from "storybook/preview-api";
import "../src/index.css";
import system from "../design-system.json";

type Brand = { id: string; name?: string };
const brands: Brand[] = (system.brands as Brand[]) ?? [{ id: "default" }];
const defaultBrand = system.defaultBrand ?? brands[0].id;

/** The generated token CSS expects the brand and mode on <html>. */
function apply(globals: Record<string, unknown> = {}) {
  const root = document.documentElement;
  root.dataset.brand = (globals.brand as string) ?? defaultBrand;
  root.classList.toggle("dark", globals.mode === "dark");
}
apply({ brand: defaultBrand, mode: "light" });

// Docs pages without stories (Introduction, Foundations, Guidelines) render no decorators; follow the toolbar here.
const channel = addons.getChannel();
channel.on("globalsUpdated", ({ globals }: { globals: Record<string, unknown> }) => apply(globals));
channel.on("setGlobals", ({ globals }: { globals: Record<string, unknown> }) => apply(globals));

const withBrandAndMode: Decorator = (Story, context) => {
  apply(context.globals);
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
  initialGlobals: { brand: defaultBrand, mode: "light" },
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    // Accessibility findings are reported as warnings in Storybook and in the tests, not failures: design problems
    // are reminders in Plinth. Interaction tests still fail on errors.
    a11y: { test: "todo" },
    options: {
      storySort: { order: ["Introduction", "Foundations", ["Palette", "Colors", "Typography", "Shape and elevation", "Icons", "Component tokens"], "Guidelines", ["Design", "Writing"], "Components", "Patterns"] },
    },
  },
};

export default preview;
