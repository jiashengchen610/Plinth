import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type State, type StoryEntry } from "@/lib/api";

type Props = { state: State; brand: string; mode: "light" | "dark"; onStartStorybook: () => void; onInstall: () => void; busy: boolean };

export function ComponentsView({ state, brand, mode, onStartStorybook, onInstall, busy }: Props) {
  const [entries, setEntries] = useState<StoryEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(state.components[0]?.id ?? null);
  const [view, setView] = useState<"preview" | "spec">("preview");

  useEffect(() => {
    if (!state.storybook) return;
    api.storyIndex().then((r) => setEntries(r.entries)).catch(() => setEntries([]));
  }, [state.storybook, state.rev]);

  const component = state.components.find((c) => c.id === selected) ?? state.components[0];
  const docs = entries.find((e) => e.type === "docs" && e.importPath.includes(`/components/${component?.id}/`));
  const firstStory = entries.find((e) => e.type === "story" && e.importPath.includes(`/components/${component?.id}/`));
  const target = docs ?? firstStory;
  // Storybook renders the user's components in its own page: nothing from this UI leaks into it.
  const src = state.storybook && target
    ? `${state.storybook}/iframe.html?id=${encodeURIComponent(target.id)}&viewMode=${target.type === "docs" ? "docs" : "story"}&globals=${encodeURIComponent(`brand:${brand};mode:${mode}`)}`
    : null;
  const deps = state.deps;

  return (
    <div className="flex flex-wrap items-start gap-4">
      <nav aria-label="Components" className="flex min-w-0 flex-[1_1_200px] flex-col gap-1 md:max-w-56">
        {state.components.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-current={c.id === component?.id}
            onClick={() => setSelected(c.id)}
            className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted ${c.id === component?.id ? "bg-accent font-medium text-accent-foreground" : ""}`}
          >
            <span className="capitalize">{c.id}</span>
            {!c.spec && <span className="text-xs text-muted-foreground">no spec</span>}
          </button>
        ))}
        <p className="mt-2 px-3 text-xs text-muted-foreground">Want another one? Ask in the chat: "make a pricing card from this screenshot".</p>
      </nav>
      <section aria-label="Component preview" className="flex min-w-0 flex-[999_1_480px] flex-col gap-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Preview or spec">
          {(["preview", "spec"] as const).map((v) => (
            <Button key={v} size="sm" variant={view === v ? "secondary" : "ghost"} role="tab" aria-selected={view === v} onClick={() => setView(v)}>
              {v === "preview" ? "Preview" : "Spec"}
            </Button>
          ))}
        </div>
        {view === "spec" ? (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border bg-card p-5 text-sm">{component?.spec ?? "This component has no spec yet."}</pre>
        ) : src ? (
          <iframe title={`${component?.id} in Storybook`} src={src} className="h-[70vh] w-full rounded-xl border bg-white" />
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-8">
            <h2 className="font-medium">{state.storybook ? "No stories for this component yet" : deps.installed ? "Storybook is not running" : "Dependencies are not installed"}</h2>
            <p className="text-sm text-muted-foreground">
              {state.storybook ? "Ask Claude to write stories for it." : deps.installed ? "Components are previewed in your design system's Storybook, in an isolated frame." : deps.installing ? "Installing now; this takes a few minutes. The preview starts after that." : "Previews and tests need the design system's dependencies (Storybook, the test browser)."}
            </p>
            {!state.storybook && deps.installed && <Button onClick={onStartStorybook} disabled={busy}>Start Storybook</Button>}
            {!deps.installed && !deps.installing && <Button onClick={onInstall} disabled={busy}>Install dependencies</Button>}
          </div>
        )}
      </section>
    </div>
  );
}
