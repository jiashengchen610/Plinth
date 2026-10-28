import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type ChangeResult, type Op, type Presets, type State, type StoryEntry, type TokenRow } from "@/lib/api";
import { Cta } from "@/lib/cta";
import { componentLabel, partName, roleName, variantOf } from "@/lib/plain";
import { buildGraph, componentOf, remindersByToken, targetIn, type Mode } from "@/lib/tokens";
import { AddColor } from "@/views/AddColor";
import { NodeGraph } from "@/views/NodeGraph";
import { ModeSwitch } from "@/views/StyleView";

type Props = {
  state: State; presets: Presets | null; brand: string; mode: "light" | "dark"; onMode: (m: "light" | "dark") => void;
  onEdit: (title: string, ops: Op[]) => void; onChanged: (r: Partial<ChangeResult>, fallback: string) => void; onError: (m: string) => void;
  onAsk: (text: string) => void; onBack: () => void; onNext: () => void;
};

export function ComponentsView({ state, presets, brand, mode, onMode, onEdit, onChanged, onError, onAsk, onBack, onNext }: Props) {
  const g = useMemo(() => buildGraph(state, brand), [state, brand]);
  const tmode: Mode = mode === "dark" ? "dark" : "default";
  const [selected, setSelected] = useState<string | null>(state.components[0]?.id ?? null);
  const [part, setPart] = useState<string | null>(null);
  const [variant, setVariant] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [addingColor, setAddingColor] = useState(false);
  const [entries, setEntries] = useState<StoryEntry[]>([]);
  const catalog = presets?.components;

  useEffect(() => {
    if (!state.storybook) return;
    api.storyIndex().then((r) => setEntries(r.entries)).catch(() => setEntries([]));
  }, [state.storybook, state.rev]);

  const component = state.components.find((c) => c.id === selected) ?? state.components[0];
  useEffect(() => { setPart(null); setVariant(""); setConfirmRemove(false); }, [component?.id]);
  const reminders = useMemo(() => remindersByToken(state, brand, tmode), [state, brand, tmode]);
  if (!component) return <p className="text-muted-foreground">No components yet. Ask Claude to add one.</p>;

  const tokens = g.rows.filter((r) => componentOf(r) === component.id);
  const colorParts = tokens.filter((t) => t.type === "color");
  const variants = [...new Set(colorParts.map((t) => variantOf(t.path)))];
  const shown = variants.length > 1 ? colorParts.filter((t) => variantOf(t.path) === (variant || variants[0])) : colorParts;
  const radius = tokens.find((t) => t.path === `${component.id}/radius`);
  const roleNames = new Set(colorParts.map((p) => targetIn(g, p, tmode)?.name).filter(Boolean) as string[]);
  const warns = [...new Set([...colorParts.map((p) => p.name), ...roleNames].flatMap((n) => (reminders.get(n) ?? []).filter((r) => r.kind === "contrast").map((r) => r.text)))];
  const warnFor = (id: string) => g.rows.some((r) => componentOf(r) === id && (reminders.get(r.name) ?? []).some((x) => x.kind === "contrast"));

  const docs = entries.find((e) => e.type === "docs" && e.importPath.includes(`/components/${component.id}/`));
  const firstStory = entries.find((e) => e.type === "story" && e.importPath.includes(`/components/${component.id}/`));
  const target = docs ?? firstStory;
  const src = state.storybook && target ? `${state.storybook}/iframe.html?id=${encodeURIComponent(target.id)}&viewMode=${target.type === "docs" ? "docs" : "story"}&globals=${encodeURIComponent(`brand:${brand};mode:${mode}`)}` : null;
  const deps = state.deps;
  const name = componentLabel(component.id, catalog);
  const missing = (catalog ?? []).filter((c) => !state.components.some((x) => x.id === c.id));
  const protectedBy = component.usedBy.length > 0;

  const roleColor = async (role: TokenRow, color: string, title: string) => {
    try { onChanged(await api.roleColor(brand, role.path.replace(/^color\//, ""), color, tmode, title), title); } catch (e) { onError((e as Error).message); }
  };
  const remove = async () => {
    try { onChanged(await api.removeComponent(component.id), `Removed ${name}.`); setSelected(null); } catch (e) { onError((e as Error).message); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-muted-foreground">Step 3 of 4</span>
        <h1 className="text-2xl font-semibold tracking-tight">Components</h1>
        <p className="text-muted-foreground">Check each component and fine-tune its colors.</p>
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <nav aria-label="Your components" className="flex min-w-0 flex-[1_1_190px] flex-col gap-0.5 rounded-2xl border bg-background p-2 md:max-w-56">
          <span className="px-2.5 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Your components</span>
          {state.components.map((c) => (
            <button key={c.id} type="button" aria-current={c.id === component.id ? "page" : undefined} onClick={() => setSelected(c.id)} className={`flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-left text-sm hover:bg-muted ${c.id === component.id ? "bg-muted font-semibold" : ""}`}>
              <span className="flex-1">{componentLabel(c.id, catalog)}</span>
              {warnFor(c.id) && <span title="Something to look at" className="size-2 rounded-full bg-warning" />}
            </button>
          ))}
          <button type="button" onClick={() => setAdding(!adding)} className="mt-1.5 flex min-h-11 items-center gap-2 rounded-lg border border-dashed px-2.5 text-sm font-medium">+ Add a component</button>
        </nav>

        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
          {adding && (
            <section className="flex flex-col gap-3 rounded-2xl border-2 border-foreground bg-background p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-base font-semibold">Add a component</h2><p className="text-sm text-muted-foreground">Ready-made components come in your style at once: free, and Undo takes them back.</p></div>
                <Button variant="outline" onClick={() => setAdding(false)}>Close</Button>
              </div>
              {missing.length ? (
                <div className="flex flex-wrap gap-2">
                  {missing.map((c) => (
                    <div key={c.id} className="flex flex-[1_1_240px] items-center gap-3 rounded-xl border py-2 pr-2 pl-3">
                      <span className="flex flex-1 flex-col leading-tight"><span className="font-semibold">{c.name}</span><span className="text-sm text-muted-foreground">{c.hint}</span></span>
                      <Button variant="outline" className="min-h-10" onClick={async () => { try { onChanged(await api.addComponent(c.id), `Added ${c.name}.`); setSelected(c.id); setAdding(false); } catch (e) { onError((e as Error).message); } }}>Add</Button>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm">You have every ready-made component.</p>}
              <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                <span className="flex-[1_1_260px] text-sm">Something else? Describe it to Claude, or paste a screenshot of one you like. A new component takes a few minutes and about US$1.50.</span>
                <Button variant="outline" className="min-h-10" onClick={() => { onAsk("I need a component that "); setAdding(false); }}>Describe it in the chat</Button>
              </div>
            </section>
          )}

          <section className="flex flex-col gap-4 rounded-2xl border bg-background p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col"><h2 className="text-xl font-semibold">{name}</h2><p className="text-sm text-muted-foreground">{catalog?.find((c) => c.id === component.id)?.hint ?? component.spec?.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.slice(0, 120) ?? ""}</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <ModeSwitch mode={mode} onMode={onMode} />
                <Button variant="outline" className="min-h-10 text-destructive" disabled={protectedBy} title={protectedBy ? `Used by ${component.usedBy.join(", ")}` : `Remove ${name}`} onClick={() => setConfirmRemove(true)}>Remove</Button>
              </div>
            </div>
            {protectedBy && confirmRemove === false && <p className="-mt-2 text-xs text-muted-foreground">{name} can't be removed: the sample pages of your component site use it.</p>}
            {confirmRemove && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-destructive/40 bg-destructive/5 py-2 pr-2 pl-3.5 text-sm">
                <span className="flex-[1_1_260px]">Remove {name} from your design system? It leaves your component site the next time you publish. Undo brings it back.</span>
                <Button variant="destructive" className="min-h-10" onClick={remove}>Remove</Button>
                <Button variant="outline" className="min-h-10" onClick={() => setConfirmRemove(false)}>Keep it</Button>
              </div>
            )}
            {src ? (
              <iframe title={`${name} preview`} src={src} className="h-[420px] w-full rounded-xl border bg-white" />
            ) : (
              <div className="flex flex-col items-start gap-2.5 rounded-xl border border-dashed p-6">
                <h3 className="font-semibold">{deps.installing ? "Getting the preview ready…" : state.storybook ? "No preview for this component yet" : deps.installed ? "The preview isn't running" : "The preview tools aren't installed"}</h3>
                <p className="text-sm text-muted-foreground">{deps.installing ? "Installing the preview and tests; this takes a few minutes the first time." : state.storybook ? "Ask Claude to write a story for it." : "Components are previewed on your component site, running on this computer."}</p>
                {!state.storybook && deps.installed && <Button onClick={() => api.startStorybook().catch((e) => onError(e.message))}>Start the preview</Button>}
                {!deps.installed && !deps.installing && <Button onClick={() => api.install().catch((e) => onError(e.message))}>Install the preview tools</Button>}
              </div>
            )}
            {warns.map((w) => (
              <div key={w} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/50 bg-warning/10 py-2 pr-2 pl-3.5 text-sm">
                <span className="flex-[1_1_220px]">Text in {name} is hard to read here ({w.split(":")[0].split(" on ").map((x) => roleName(x.trim().replace(/\/\d+$/, ""))).join(" on ")}).</span>
                <Button className="min-h-10" onClick={async () => { try { onChanged(await api.fixContrast(), "Contrast fixed."); } catch (e) { onError((e as Error).message); } }}>Fix it</Button>
                <Button variant="outline" className="min-h-10" onClick={() => onAsk(`Make the text in ${name} easier to read, but keep it on brand.`)}>Ask Claude</Button>
              </div>
            ))}
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border bg-background p-5">
            <div>
              <h2 className="text-base font-semibold">How {name} gets its colors</h2>
              <p className="text-sm text-muted-foreground">Pick a part, then click one of your colors to connect it, or a base color to change that color itself. Light and dark mode each have their own: switch with Light and Dark above. Or tell Claude in the chat.</p>
            </div>
            {variants.length > 1 && (
              <div role="group" aria-label="Kind" className="flex flex-wrap gap-1.5">
                {variants.map((v) => (
                  <button key={v} type="button" aria-pressed={(variant || variants[0]) === v} onClick={() => { setVariant(v); setPart(null); }} className={`min-h-9 rounded-full border-2 px-3 text-sm font-medium capitalize ${(variant || variants[0]) === v ? "border-foreground" : "border-border"}`}>{v || "Shared"}</button>
                ))}
              </div>
            )}
            <NodeGraph g={g} mode={tmode} parts={shown} selected={part} onSelect={setPart} onEdit={onEdit} onRoleColor={roleColor} />
            {addingColor ? <AddColor hint="Plinth makes lighter and darker versions of it; they show up first in the base colors." onAdded={(r) => { onChanged(r, `Added ${r.name}.`); setAddingColor(false); }} onError={onError} />
              : <button type="button" onClick={() => setAddingColor(true)} className="min-h-10 self-start text-sm font-medium text-info underline underline-offset-2">Add your own base color</button>}
            {radius && <p className="text-sm text-muted-foreground">{partName(radius.path)} follow the corners you picked in Style.</p>}
          </section>
        </div>
      </div>
      <Cta back={{ label: "← Style", onClick: onBack }} status={warns.length ? `${warns.length} thing${warns.length > 1 ? "s" : ""} to look at here` : `${state.components.length} components`} next={{ label: "Next: Publish →", onClick: onNext }} />
    </div>
  );
}
