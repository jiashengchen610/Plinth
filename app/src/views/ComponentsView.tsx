import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type Op, type State, type StoryEntry, type TokenRow } from "@/lib/api";
import { chainDown, componentOf, isColor, label, remindersByToken, valueIn, type Graph, type Mode } from "@/lib/tokens";
import { TokenEditor } from "@/views/TokenEditor";

type Props = {
  state: State; brand: string; mode: "light" | "dark"; busy: boolean;
  graph: Graph | null; onEdit: (op: Op) => void; onOpenToken: (key: string) => void;
  onStartStorybook: () => void; onInstall: () => void;
};

/**
 * One component: its live preview, and its tokens as the place to start changing it. The order of the steps is the
 * order of impact: this component only (its token), every component on a role (the role), every role on a palette
 * step (the palette, changed by pointing roles elsewhere).
 */
function ComponentTokens({ g, state, brand, mode, component, onEdit, onOpenToken }: { g: Graph; state: State; brand: string; mode: Mode; component: string; onEdit: (op: Op) => void; onOpenToken: (key: string) => void }) {
  const tokens = g.rows.filter((r) => componentOf(r) === component);
  const reminders = useMemo(() => remindersByToken(state, brand, mode), [state, brand, mode]);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [component]);
  const row = picked ? g.byKey.get(picked) ?? null : null;
  const parts = [...new Set(tokens.map((t) => t.path.split("/").slice(1, -1).join(" ") || "all"))];

  if (!tokens.length) {
    return (
      <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        This component has no component tokens, so it uses roles directly. Ask Claude to give it its own tokens ("give the {component} component its own tokens"), then you can change it here without touching the others.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border bg-card p-4 text-sm">
        <h3 className="font-medium">Change this component</h3>
        <ol className="mt-1 flex list-decimal flex-col gap-0.5 pl-5 text-xs text-muted-foreground">
          <li>Pick a token below and point it at another role: only <strong>{component}</strong> changes.</li>
          <li>Or follow it to its <strong>role</strong> (the middle chip) to change every component on that role.</li>
          <li>Or follow it to the <strong>palette</strong> to see every role on that color.</li>
        </ol>
        <div className="mt-3 flex flex-col gap-3">
          {parts.map((part) => (
            <section key={part} className="flex flex-col gap-1">
              <h4 className="text-[11px] font-medium text-muted-foreground capitalize">{part}</h4>
              {tokens.filter((t) => (t.path.split("/").slice(1, -1).join(" ") || "all") === part).map((t) => {
                const chain = chainDown(g, t, mode);
                const r = reminders.get(t.name);
                return (
                  <div key={t.path} className={`flex min-w-0 flex-wrap items-center gap-1 rounded-md px-1.5 py-1 ${picked === t.path ? "bg-accent" : "hover:bg-muted"}`}>
                    <button type="button" onClick={() => setPicked(picked === t.path ? null : t.path)} className="min-w-0 truncate text-left font-mono text-xs font-medium" aria-pressed={picked === t.path}>
                      {t.path.split("/").at(-1)}
                    </button>
                    {r?.length ? <span title={r.map((x) => x.text).join("\n")} className={`size-2 rounded-full ${r.some((x) => x.kind === "contrast") ? "bg-destructive" : "bg-warning"}`} /> : null}
                    <span className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
                      {chain.slice(1).map((c, i) => (
                        <span key={c.path} className="flex items-center gap-1">
                          {i > 0 && <span aria-hidden="true" className="text-muted-foreground">→</span>}
                          <button type="button" title={`Open ${label(c)} in the token graph`} onClick={() => onOpenToken(c.path)} className="inline-flex items-center gap-1 rounded border bg-background px-1 font-mono text-[10px] hover:bg-muted">
                            {isColor(c) && <span className="size-2.5 rounded-sm border" style={{ background: valueIn(c, mode)?.resolved ?? "transparent" }} />}
                            {label(c)}
                          </button>
                        </span>
                      ))}
                    </span>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
      {row && <TokenEditor g={g} state={state} brand={brand} mode={mode} row={row} reminders={reminders} onEdit={onEdit} onSelect={(k) => (componentOf(g.byKey.get(k) as TokenRow) === component ? setPicked(k) : onOpenToken(k))} />}
      <p className="text-xs text-muted-foreground">Edits apply at once: the preview reloads with them. Undo takes the last one back.</p>
    </div>
  );
}

export function ComponentsView({ state, brand, mode, onStartStorybook, onInstall, busy, graph, onEdit, onOpenToken }: Props) {
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
      <nav aria-label="Components" className="flex min-w-0 flex-[1_1_160px] flex-col gap-1 md:max-w-48">
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
      <section aria-label="Component preview" className="flex min-w-0 flex-[999_1_420px] flex-col gap-3">
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
      {graph && component && (
        <aside aria-label="Component tokens" className="min-w-0 flex-[1_1_300px] xl:max-w-sm">
          <ComponentTokens g={graph} state={state} brand={brand} mode={mode === "dark" ? "dark" : "default"} component={component.id} onEdit={onEdit} onOpenToken={onOpenToken} />
        </aside>
      )}
    </div>
  );
}
