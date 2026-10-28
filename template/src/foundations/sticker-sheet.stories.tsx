/**
 * Every component on one page, each with all of its stories side by side, grouped like the sidebar: a sticker sheet
 * for checking the whole system at once. Managed by Plinth (this folder is rewritten from the template); the Plinth
 * UI shows this page in its Components step and lets you pick any part of it to change. It is not a component: it is
 * left out of the components manifest and of the tests (each component's own stories are tested).
 */
import { useEffect, useState, type ComponentType } from "react";
import { composeStories, type Meta, type StoryObj } from "@storybook/react-vite";

type StoriesModule = { default: { title?: string } } & Record<string, unknown>;
// Loaded when the page shows, not when this file is imported: the story tests import every stories file as a test
// file, and one stories file importing the others there would break their tests.
const loaders = import.meta.glob<StoriesModule>("../components/*/*.stories.tsx");

type Composed = ComponentType & { storyName?: string; args?: Record<string, unknown>; tags?: string[] };
type Sticker = { id: string; group: string; name: string; stories: [string, Composed][] };
// A story that opens an overlay on its own (a dialog with open or defaultOpen) would cover the whole page, and one
// tagged "!sheet" asks to stay off it: both are left out here (their component's own page still shows them).
const onSheet = ([, story]: [string, Composed]) => !story.args?.open && !story.args?.defaultOpen && !story.tags?.includes("!sheet");
const toSticker = (path: string, mod: StoriesModule): Sticker => {
  const id = path.split("/").at(-2) ?? path;
  const title = (mod.default?.title ?? id).split("/");
  return {
    id,
    group: title.length > 2 ? title[1] : title[0],
    name: title.at(-1) ?? id,
    stories: (Object.entries(composeStories(mod as Parameters<typeof composeStories>[0])) as Sticker["stories"]).filter(onSheet),
  };
};

function StickerSheet() {
  const [stickers, setStickers] = useState<Sticker[] | null>(null);
  useEffect(() => {
    let off = false;
    Promise.all(Object.entries(loaders).map(async ([path, load]) => toSticker(path, await load())))
      .then((all) => { if (!off) setStickers(all.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))); });
    return () => { off = true; };
  }, []);
  if (!stickers) return <p className="type-body-md p-8 text-muted-foreground">Loading every component…</p>;
  const groups = [...new Set(stickers.map((s) => s.group))];
  return (
    <div className="flex flex-col gap-10 bg-background p-8 text-foreground">
      {groups.map((group) => (
        <section key={group} data-sheet-group={group} className="flex flex-col gap-6">
          <h2 className="type-heading-sm border-b pb-2">{group}</h2>
          {stickers.filter((s) => s.group === group).map((s) => (
            <section key={s.id} data-sheet={s.id} aria-label={s.name} className="flex scroll-mt-4 flex-col gap-3">
              <h3 className="type-label-md">{s.name}</h3>
              <div className="flex flex-wrap items-start gap-x-8 gap-y-6">
                {s.stories.map(([key, Story]) => (
                  <figure key={key} className="flex max-w-full min-w-0 flex-col gap-2">
                    <Story />
                    <figcaption className="type-label-sm text-muted-foreground">{Story.storyName ?? key}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ))}
        </section>
      ))}
    </div>
  );
}

const meta = {
  title: "All components",
  component: StickerSheet,
  tags: ["!test", "!manifest", "!autodocs"],
  parameters: { layout: "fullscreen", controls: { disable: true }, actions: { disable: true } },
} satisfies Meta<typeof StickerSheet>;

export default meta;
export const AllComponents: StoryObj<typeof meta> = { name: "All components" };
