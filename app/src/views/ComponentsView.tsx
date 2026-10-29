import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type ChangeResult, type Op, type Presets, type State, type StoryEntry, type TokenRow, type VocabEntry } from "@/lib/api";
import { Cta } from "@/lib/cta";
import { matchVocab, VocabArt } from "@/views/Vocab";
import { componentOfChain, picksFromChain, type ChainLink } from "@/lib/inspect";
import { EditPanel } from "@/views/EditPanel";
import { StepIntro } from "@/views/StepIntro";
import { componentLabel, partName, roleName, variantOf } from "@/lib/plain";
import { buildGraph, componentOf, remindersByToken, targetIn, valueIn, type Mode } from "@/lib/tokens";
import { NodeGraph } from "@/views/NodeGraph";
import { TypeGraph } from "@/views/TypeGraph";
import { ModeSwitch } from "@/views/ModeSwitch";

type Props = {
  state: State; presets: Presets | null; vocab?: VocabEntry[]; brand: string; mode: "light" | "dark"; onMode: (m: "light" | "dark") => void;
  onEdit: (title: string, ops: Op[]) => void; onChanged: (r: Partial<ChangeResult>, fallback: string) => void; onError: (m: string) => void;
  onAsk: (text: string) => void; onBack: () => void; onNext: () => void;
};

export function ComponentsView({ state, presets, vocab = [], brand, mode, onMode, onEdit, onChanged, onError, onAsk, onBack, onNext }: Props) {
  const g = useMemo(() => buildGraph(state, brand), [state, brand]);
  const tmode: Mode = mode === "dark" ? "dark" : "default";
  const [selected, setSelected] = useState<string | null>(state.components[0]?.id ?? null);
  const [part, setPart] = useState<string | null>(null);
  const [textPart, setTextPart] = useState<string | null>(null);
  const [variant, setVariant] = useState("");
  const [adding, setAdding] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [entries, setEntries] = useState<StoryEntry[]>([]);
  const [view, setView] = useState<"sheet" | "showcase">("sheet");
  const catalog = presets?.components;

  useEffect(() => {
    if (!state.storybook) return;
    api.storyIndex().then((r) => setEntries(r.entries)).catch(() => setEntries([]));
  }, [state.storybook, state.rev]);

  const component = state.components.find((c) => c.id === selected) ?? state.components[0];
  // Picking in the preview: the story runs Plinth's picker (server/inspect.js), which says when it is ready and
  // reports a click as the classes of the element and its parents.
  const frame = useRef<HTMLIFrameElement>(null);
  const srcRef = useRef<string | null>(null);
  const [readyFor, setReadyFor] = useState<{ src: string | null; at: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<{ chain: ChainLink[]; text: string; sheet: string | null } | null>(null);
  const sbOrigin = state.storybook ? new URL(state.storybook).origin : null;
  useEffect(() => {
    if (!sbOrigin) return;
    const on = (e: MessageEvent) => {
      if (e.origin !== sbOrigin || e.data?.source !== "plinth-inspect") return;
      if (e.data.type === "ready") setReadyFor({ src: srcRef.current, at: Date.now() });
      else if (e.data.type === "pick" && Array.isArray(e.data.chain)) setPicked({ chain: e.data.chain, text: String(e.data.text ?? ""), sheet: typeof e.data.sheet === "string" ? e.data.sheet : null });
      else if (e.data.type === "cancel") setPicking(false);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [sbOrigin]);
  useEffect(() => {
    if (!sbOrigin || !readyFor || readyFor.src !== srcRef.current) return;
    frame.current?.contentWindow?.postMessage({ source: "plinth-ui", type: "inspect", on: picking }, sbOrigin);
  }, [picking, readyFor, sbOrigin]);
  // Esc stops picking here too (the picker hears it only while the preview has focus).
  useEffect(() => {
    if (!picking) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPicking(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [picking]);
  useEffect(() => { setPart(null); setTextPart(null); setVariant(""); setConfirmRemove(false); }, [component?.id]);
  // A pick on the page of every component opens that component below (its section, else the part's component).
  useEffect(() => {
    if (!picked) return;
    const ids = state.components.map((c) => c.id);
    const id = picked.sheet && ids.includes(picked.sheet) ? picked.sheet : componentOfChain(picked.chain, ids);
    if (id) setSelected(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);
  // A picked color part of this component is also selected in the graph below.
  useEffect(() => {
    if (!picked || !component) return;
    const p = picksFromChain(g, picked.chain, state.components.map((c) => c.id)).find((x) => x.kind === "color" && !x.state && componentOf(x.row) === component.id);
    if (p) { setVariant(variantOf(p.row.path)); setPart(p.row.path); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, component?.id]);
  const reminders = useMemo(() => remindersByToken(state, brand, tmode), [state, brand, tmode]);
  if (!component) return <p className="text-muted-foreground">No components yet. Ask Claude to add one.</p>;

  const tokens = g.rows.filter((r) => componentOf(r) === component.id);
  const colorParts = tokens.filter((t) => t.type === "color");
  const textParts = tokens.filter((t) => t.type === "typography");
  const fitted = tokens.filter((t) => t.fit);
  // "tabs/trigger/radius" → "Trigger corners"; lengths in px.
  const cornersOf = (path: string) => `${partName(path).replace(/ · Corners$/, "")} corners`;
  const px = (s: string | null | undefined) => { const m = /^([\d.]+)(px|rem)$/.exec(s ?? ""); return m ? `${Number(m[1]) * (m[2] === "rem" ? 16 : 1)}px` : s ?? "?"; };
  const variants = [...new Set(colorParts.map((t) => variantOf(t.path)))];
  const shown = variants.length > 1 ? colorParts.filter((t) => variantOf(t.path) === (variant || variants[0])) : colorParts;
  const radius = tokens.find((t) => t.path === `${component.id}/radius`);
  const roleNames = new Set(colorParts.map((p) => targetIn(g, p, tmode)?.name).filter(Boolean) as string[]);
  const warns = [...new Set([...colorParts.map((p) => p.name), ...roleNames].flatMap((n) => (reminders.get(n) ?? []).filter((r) => r.kind === "contrast").map((r) => r.text)))];
  const warnFor = (id: string) => g.rows.some((r) => componentOf(r) === id && (reminders.get(r.name) ?? []).some((x) => x.kind === "contrast"));

  const docs = entries.find((e) => e.type === "docs" && e.importPath.includes(`/components/${component.id}/`));
  const firstStory = entries.find((e) => e.type === "story" && e.importPath.includes(`/components/${component.id}/`));
  // Every component on one page (the template's sticker sheet); a design system without it shows one at a time.
  const sheet = entries.find((e) => e.type === "story" && e.importPath.includes("/foundations/sticker-sheet"));
  // An example screen made of the same components (the template's showcase), when the design system has it.
  const showcase = entries.find((e) => e.type === "story" && e.importPath.includes("/foundations/showcase"));
  const onShowcase = view === "showcase" && !!showcase;
  const target = (onShowcase ? showcase : sheet) ?? docs ?? firstStory;
  const src = state.storybook && target ? `${state.storybook}/iframe.html?id=${encodeURIComponent(target.id)}&viewMode=${target.type === "docs" ? "docs" : "story"}&globals=${encodeURIComponent(`brand:${brand};mode:${mode}`)}&plinthInspect=${encodeURIComponent(location.origin)}` : null;
  const pageOf = docs ?? firstStory;
  const reveal = (id: string) => {
    // A component picked in the list is shown on the page of every component.
    if (onShowcase) { setView("sheet"); return; }
    if (sheet && sbOrigin) frame.current?.contentWindow?.postMessage({ source: "plinth-ui", type: "reveal", sheet: id }, sbOrigin);
  };
  srcRef.current = src;
  const ready = !!src && readyFor?.src === src;
  const ids = state.components.map((c) => c.id);
  const said = picked?.text.split("\n").map((s) => s.trim()).find(Boolean) ?? "";
  const sel = picked ? { title: `${componentLabel(componentOfChain(picked.chain, ids) ?? component.id, catalog)}${said ? ` · “${said.length > 28 ? `${said.slice(0, 27)}…` : said}”` : ""}`, picks: picksFromChain(g, picked.chain, ids) } : null;
  const deps = state.deps;
  const name = componentLabel(component.id, catalog);
  // What can still be added: the vocabulary's components not in the system (the catalog, before the vocabulary loads).
  const missing = useMemo<VocabEntry[]>(() => (vocab.length
    ? vocab.filter((e) => e.kind === "component" && !e.inSystem)
    : (catalog ?? []).filter((c) => !state.components.some((x) => x.id === c.id)).map((c) => ({ id: `component:${c.id}`, kind: "component" as const, key: c.id, name: c.name, hint: c.hint, aliases: [c.id], inSystem: false, current: false, apply: c.ready === false ? null : [{ tool: "add_component", args: { name: c.id } }], art: { glyph: c.id } }))), [vocab, catalog, state.components]);
  const addable = useMemo(() => matchVocab(missing, addQuery), [missing, addQuery]);
  const protectedBy = component.usedBy.length > 0;

  const roleColor = async (role: TokenRow, color: string, title: string) => {
    try { onChanged(await api.roleColor(brand, role.path.replace(/^color\//, ""), color, tmode, title), title); } catch (e) { onError((e as Error).message); }
  };
  const remove = async () => {
    try { onChanged(await api.removeComponent(component.id), `Removed ${name}.`); setSelected(null); } catch (e) { onError((e as Error).message); }
  };

  return (
    <div className="flex flex-col gap-4">
      <StepIntro n={3} title="Components" decide="How each component uses your style: which of your colors, corners and text styles each part takes, and which components you have."
        change="Pick any part on the page of every component, or a component in the list for all its parts. Or tell Claude in the chat." done="Every component looks right in light and dark mode, and passes its tests when you publish." />

      <section aria-label="All your components" className="flex flex-col gap-3 rounded-2xl border bg-background p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-base font-semibold">{onShowcase ? "An example screen" : sheet ? "All your components" : name}</h2><p className="text-sm text-muted-foreground">{onShowcase ? "Your components put together in a budgeting dashboard, in your style." : sheet ? "The real components, every one on one page." : "The real component."}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            {showcase && sheet && (
              <div role="group" aria-label="What to show" className="flex rounded-lg border p-0.5">
                {([["sheet", "Every component"], ["showcase", "Example screen"]] as const).map(([v, label]) => (
                  <button key={v} type="button" aria-pressed={view === v} onClick={() => { setView(v); setPicked(null); }} className={`min-h-9 rounded-md px-3 text-sm ${view === v ? "bg-muted font-semibold" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
                ))}
              </div>
            )}
            <ModeSwitch mode={mode} onMode={onMode} />
          </div>
        </div>
        {src ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <button type="button" aria-pressed={picking} disabled={!ready} onClick={() => setPicking(!picking)} className={`min-h-10 rounded-lg border-2 px-3.5 text-sm font-semibold disabled:opacity-50 ${picking ? "border-info bg-info/10" : "border-border"}`}>{picking ? "Stop picking" : "Pick something to change"}</button>
              <span className="flex-[1_1_220px] text-xs text-muted-foreground">{!ready ? "Getting the preview ready for picking…" : picking ? "Click a part: a button, a card, a field. Esc stops." : "Then click a part to change its colors, corners or text."}</span>
            </div>
            <iframe ref={frame} title="Components preview" src={src} className={`h-[560px] w-full rounded-xl border bg-white ${picking ? "ring-2 ring-info" : ""}`} />
            {sel && <EditPanel state={state} g={g} brand={brand} mode={tmode} sel={sel} onClose={() => setPicked(null)} onChanged={onChanged} onError={onError} onAsk={onAsk} />}
          </>
        ) : (
          <div className="flex flex-col items-start gap-2.5 rounded-xl border border-dashed p-6">
            <h3 className="font-semibold">{deps.installing ? "Getting the preview ready…" : state.storybook ? "No preview yet" : deps.installed ? "The preview isn't running" : "The preview tools aren't installed"}</h3>
            <p className="text-sm text-muted-foreground">{deps.installing ? "Installing the preview and tests; this takes a few minutes the first time." : state.storybook ? "Ask Claude to write stories for your components." : "Components are previewed on your component site, running on this computer."}</p>
            {!state.storybook && deps.installed && <Button onClick={() => api.startStorybook().catch((e) => onError(e.message))}>Start the preview</Button>}
            {!deps.installed && !deps.installing && <Button onClick={() => api.install().catch((e) => onError(e.message))}>Install the preview tools</Button>}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <nav aria-label="Your components" className="flex min-w-0 flex-[1_1_190px] flex-col gap-0.5 rounded-2xl border bg-background p-2 md:max-w-56">
          <span className="px-2.5 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Your components</span>
          {state.components.map((c) => (
            <button key={c.id} type="button" aria-current={c.id === component.id ? "page" : undefined} onClick={() => { setSelected(c.id); setPicked(null); reveal(c.id); }} className={`flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-left text-sm hover:bg-muted ${c.id === component.id ? "bg-muted font-semibold" : ""}`}>
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
                <div className="flex items-center gap-2">
                  {missing.length > 6 && <input type="search" value={addQuery} onChange={(e) => setAddQuery(e.target.value)} placeholder="Find: dropdown, toggle, 進度條…" aria-label="Find a component" className="h-10 w-64 rounded-lg border bg-background px-3 text-sm" />}
                  <Button variant="outline" onClick={() => setAdding(false)}>Close</Button>
                </div>
              </div>
              {missing.length ? addable.length ? (
                <div className="flex flex-wrap gap-2">
                  {addable.map((c) => (
                    <div key={c.id} className="flex flex-[1_1_260px] items-center gap-3 rounded-xl border py-2 pr-2 pl-2.5">
                      <VocabArt entry={c} />
                      <span className="flex min-w-0 flex-1 flex-col leading-tight"><span className="font-semibold">{c.name}</span><span className="text-sm text-muted-foreground">{c.hint}</span></span>
                      {c.apply
                        ? <Button variant="outline" className="min-h-10" onClick={async () => { try { onChanged(await api.addComponent(c.key), `Added ${c.name}.`); setSelected(c.key); setAdding(false); } catch (e) { onError((e as Error).message); } }}>Add</Button>
                        : <Button variant="outline" className="min-h-10" onClick={() => { onAsk(`Add a ${c.name} component: ${c.hint}.`); setAdding(false); }}>Ask Claude</Button>}
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">Nothing ready-made by that name. Describe it to Claude below.</p> : <p className="text-sm">You have every ready-made component.</p>}
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
                {state.storybook && pageOf && <Button asChild variant="outline" className="min-h-10"><a href={`${state.storybook}/?path=/${pageOf.type === "docs" ? "docs" : "story"}/${pageOf.id}`} target="_blank" rel="noreferrer">Open its page</a></Button>}
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
            {state.storybook && !docs && !firstStory && <p className="text-sm text-muted-foreground">{name} has no stories yet: ask Claude to write them, so it shows on the page of every component.</p>}
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
              <p className="text-sm text-muted-foreground">Pick a part, then click one of your colors to connect it. To change the color itself, click it again or use Change: pick from your palette or any color on the wheel. Light and dark mode each have their own: switch with Light and Dark above. Or tell Claude in the chat.</p>
            </div>
            {variants.length > 1 && (
              <div role="group" aria-label="Kind" className="flex flex-wrap gap-1.5">
                {variants.map((v) => (
                  <button key={v} type="button" aria-pressed={(variant || variants[0]) === v} onClick={() => { setVariant(v); setPart(null); }} className={`min-h-9 rounded-full border-2 px-3 text-sm font-medium capitalize ${(variant || variants[0]) === v ? "border-foreground" : "border-border"}`}>{v || "Shared"}</button>
                ))}
              </div>
            )}
            <NodeGraph g={g} mode={tmode} brand={brand} parts={shown} selected={part} onSelect={setPart} onEdit={onEdit} onRoleColor={roleColor} onAdded={(r, title) => onChanged(r, title)} onError={onError} />
            {radius && <p className="text-sm text-muted-foreground">{partName(radius.path)} follow the corners you picked in Style.</p>}
            {fitted.map((f) => (
              <p key={f.path} className="text-sm text-muted-foreground">{cornersOf(f.path)}: {px(valueIn(f, tmode)?.resolved)}, {f.fit!.on ? <>fitting inside {f.fit!.outer === `${component.id}/radius` ? `the corners of ${name}` : `the ${cornersOf(f.fit!.outer).toLowerCase()}`} ({px(g.byKey.get(f.fit!.outer) ? valueIn(g.byKey.get(f.fit!.outer)!, tmode)?.resolved : null)}) so the gap stays even.</> : <>its own. Turn on "Fit its corners" in Style to keep the gap to its container even.</>}</p>
            ))}
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border bg-background p-5">
            <div>
              <h2 className="text-base font-semibold">How {name} sets its text</h2>
              <p className="text-sm text-muted-foreground">Pick a part, then click a text style to use it, or a font to change that style's font. Or tell Claude in the chat.</p>
            </div>
            {textParts.length || !state.upgradeAvailable ? <TypeGraph g={g} mode={tmode} parts={textParts} selected={textPart} onSelect={setTextPart} onEdit={onEdit} />
              : <p className="text-sm text-muted-foreground">{name}'s text sizes are written in its code. Upgrade this design system (at the top) to give its text its own settings.</p>}
          </section>
        </div>
      </div>
      <Cta back={{ label: "← Style", onClick: onBack }} status={warns.length ? `${warns.length} thing${warns.length > 1 ? "s" : ""} to look at here` : `${state.components.length} components`} next={{ label: "Next: Publish →", onClick: onNext }} />
    </div>
  );
}
