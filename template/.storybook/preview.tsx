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

// The Plinth UI on this computer can pick an element in a story to change its tokens: it opens the story with
// plinthInspect=<its own address>, and the picker loads from there. Only for a Storybook on this computer, so the
// published component site never loads it.
const plinth = new URLSearchParams(location.search).get("plinthInspect");
const local = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
if (plinth && local(location.hostname) && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(plinth)) {
  const script = document.createElement("script");
  script.src = `${plinth}/inspect.js`;
  document.head.append(script);
}

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
    // A component sits in the middle of its canvas and of its docs preview, not against the top left edge. Pages
    // that fill the screen (All components) set "fullscreen" themselves.
    layout: "centered",
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    // Accessibility findings are reported as warnings in Storybook and in the tests, not failures: design problems
    // are reminders in Plinth. Interaction tests still fail on errors.
    a11y: { test: "todo" },
    options: {
      // The site opens on the first entry: the example screen, then the introduction.
      storySort: { order: ["Showcase", "Introduction", "All components", "Foundations", ["Palette", "Colors", "Typography", "Shape and elevation", "Icons", "Component tokens"], "Guidelines", ["Design", "Writing"], "Components", "Patterns"] },
    },
  },
};

export default preview;
