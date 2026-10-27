import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Op, State, TokenRow } from "@/lib/api";
import { buildGraph, chainDown, componentOf, dependents, isColor, label, paletteHues, remindersByToken, targetIn, valueIn, type Graph, type Mode } from "@/lib/tokens";
import { TokenEditor } from "@/views/TokenEditor";
import { AddLayerDialog, AddPaletteColorDialog, NewTokenDialog } from "@/views/TokenDialogs";

type Props = {
  state: State; brand: string; mode: Mode;
  selected: string | null; onSelect: (key: string | null) => void;
  draft: Op[]; onEdit: (op: Op) => void;
  onProposed: (message: string) => void; onError: (message: string) => void;
};

/** A swatch for a color token in a mode (checkerboard behind translucent colors). */
export function Swatch({ row, mode, className = "size-4" }: { row: TokenRow; mode: Mode; className?: string }) {
  const v = valueIn(row, mode);
  return (
    <span className={`relative shrink-0 overflow-hidden rounded border border-border bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:8px_8px] ${className}`}>
      <span className="absolute inset-0" style={{ background: v?.resolved ?? "transparent" }} />
    </span>
  );
}

const groupOf = (t: TokenRow) => componentOf(t) ?? t.path.split("/")[0];
// Colors first: they are what people change most.
const GROUP_ORDER = ["color", "colors", "radius", "shadow", "font", "typography"];
const groupRank = (g: string) => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? GROUP_ORDER.length : i; };

export function TokenGraph({ state, brand, mode, selected, onSelect, draft, onEdit, onProposed, onError }: Props) {
  const g: Graph = useMemo(() => buildGraph(state, brand), [state, brand]);
  const reminders = useMemo(() => remindersByToken(state, brand, mode), [state, brand, mode]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<null | "palette" | "layer" | { layer: string }>(null);
  const container = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = useState<{ d: string; key: string }[]>([]);

  const sel = selected ? g.byKey.get(selected) ?? null : null;
  // The path: down to the palette, up to everything that uses it.
  const lit = useMemo(() => {
    if (!sel) return null;
    return new Set([...chainDown(g, sel, mode), ...dependents(g, sel.path)].map((t) => t.path));
  }, [g, sel, mode]);
  const q = query.trim().toLowerCase();
  const matches = (t: TokenRow) => !q || label(t).toLowerCase().includes(q) || t.path.toLowerCase().includes(q);
  const drafted = useMemo(() => new Set(draft.map((o) => o.path).filter(Boolean) as string[]), [draft]);

  const columns = useMemo(() => g.layers.map((layer) => ({ layer, rows: g.rows.filter((r) => (r.layerId ?? "semantic") === layer.id) })), [g]);

  const register = useCallback((key: string) => (el: HTMLElement | null) => { if (el) nodes.current.set(key, el); else nodes.current.delete(key); }, []);

  // Lines along the lit path, from a token to what it points at (right to left), redrawn on layout changes.
  const redraw = useCallback(() => {
    const box = container.current?.getBoundingClientRect();
    if (!box || !lit) { setLines([]); return; }
    const out: { d: string; key: string }[] = [];
    for (const key of lit) {
      const t = g.byKey.get(key);
      const target = t && targetIn(g, t, mode);
      if (!t || !target || !lit.has(target.path)) continue;
      const a = nodes.current.get(t.path)?.getBoundingClientRect();
      const b = nodes.current.get(target.path)?.getBoundingClientRect();
      if (!a || !b) continue;
      const x1 = a.left - box.left, y1 = a.top + a.height / 2 - box.top;
      const x2 = b.right - box.left, y2 = b.top + b.height / 2 - box.top;
      const dx = Math.max(30, (x1 - x2) / 2);
      out.push({ key: `${t.path}->${target.path}`, d: `M ${x1} ${y1} C ${x1 - dx} ${y1}, ${x2 + dx} ${y2}, ${x2} ${y2}` });
    }
    setLines(out);
  }, [g, lit, mode]);
  useLayoutEffect(() => { redraw(); }, [redraw, open, query]);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(el);
    window.addEventListener("resize", redraw);
    return () => { ro.disconnect(); window.removeEventListener("resize", redraw); };
  }, [redraw]);

  const dim = (t: TokenRow) => (lit && !lit.has(t.path) ? "opacity-35" : "");
  const ring = (t: TokenRow) => (t.path === selected ? "ring-2 ring-ring" : lit?.has(t.path) ? "ring-1 ring-ring/60" : "");
  const dot = (t: TokenRow) => {
    const r = reminders.get(t.name);
    if (!r?.length) return null;
    return <span title={r.map((x) => x.text).join("\n")} aria-label={`${r.length} reminder${r.length > 1 ? "s" : ""}`} className={`ml-auto size-2 shrink-0 rounded-full ${r.some((x) => x.kind === "contrast") ? "bg-destructive" : "bg-warning"}`} />;
  };
  const pick = (t: TokenRow) => onSelect(t.path === selected ? null : t.path);

  const Card = ({ t }: { t: TokenRow }) => (
    <button
      ref={register(t.path)}
      type="button"
      onClick={() => pick(t)}
      aria-pressed={t.path === selected}
      className={`flex w-full min-w-0 items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-left text-xs transition-opacity hover:bg-muted ${dim(t)} ${ring(t)}`}
    >
      {isColor(t) ? <Swatch row={t} mode={mode} /> : <span className="w-4 shrink-0 text-center font-mono text-[10px] text-muted-foreground">{t.type.slice(0, 1).toUpperCase()}</span>}
      <span className="min-w-0 truncate font-mono">{label(t).replace(/^(button|badge|card|input|label)-/, "")}</span>
      {drafted.has(t.path) && <span className="rounded bg-info/15 px-1 text-[10px] text-info">draft</span>}
      {dot(t)}
    </button>
  );

  const PaletteColumn = ({ rows }: { rows: TokenRow[] }) => {
    const hues = paletteHues(g).filter((h) => !q || h.hue.includes(q) || h.steps.some((s) => matches(s.row)));
    const others = rows.filter((r) => !isColor(r) && matches(r));
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          {hues.map(({ hue, steps }) => (
            <div key={hue} className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-1">
              <span className="truncate text-[10px] text-muted-foreground">{hue}</span>
              <div className="flex gap-px">
                {steps.map(({ step, row }) => (
                  <button
                    key={row.path}
                    ref={register(row.path)}
                    type="button"
                    title={`${label(row)} · ${valueIn(row, mode)?.raw as string}${(g.users.get(row.path)?.length ?? 0) ? ` · used by ${g.users.get(row.path)!.length}` : ""}`}
                    onClick={() => pick(row)}
                    className={`relative h-5 min-w-0 rounded-sm transition-opacity ${steps.length === 1 ? "w-6 flex-none border" : "flex-1"} ${dim(row)} ${row.path === selected ? "ring-2 ring-ring ring-offset-1" : lit?.has(row.path) ? "ring-2 ring-ring/70" : ""}`}
                    style={{ background: valueIn(row, mode)?.resolved ?? "transparent" }}
                  >
                    <span className="sr-only">{hue} {step}</span>
                    {(g.users.get(row.path)?.length ?? 0) > 0 && <span aria-hidden="true" className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-white mix-blend-difference" />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {others.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase">Radius and shadow</span>
            <div className="flex flex-wrap gap-1">
              {others.map((t) => (
                <button key={t.path} ref={register(t.path)} type="button" onClick={() => pick(t)} title={String(valueIn(t, mode)?.resolved ?? "")}
                  className={`rounded border bg-card px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted ${dim(t)} ${ring(t)}`}>
                  {label(t).replace(/-(radius|shadow)$/, "")}<span className="text-muted-foreground">{t.type === "shadow" ? " ◫" : " ◜"}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const GroupedColumn = ({ rows, layerId }: { rows: TokenRow[]; layerId: string }) => {
    const groups = [...new Set(rows.map(groupOf))].sort((a, b) => (layerId === "components" ? 0 : groupRank(a) - groupRank(b)));
    return (
      <div className="flex flex-col gap-2">
        {groups.map((name) => {
          const items = rows.filter((r) => groupOf(r) === name && matches(r));
          if (!items.length) return null;
          const key = `${layerId}:${name}`;
          // Component groups start closed; any group on the lit path opens.
          const isOpen = open[key] ?? (layerId !== "components" || Boolean(lit && items.some((r) => lit.has(r.path))) || Boolean(q));
          const count = items.reduce((n, r) => n + (reminders.get(r.name)?.length ?? 0), 0);
          return (
            <section key={key} className="flex flex-col gap-1">
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [key]: !isOpen })} className="flex items-center gap-2 rounded px-1 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted">
                <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                <span className="capitalize">{name}</span>
                <span className="tabular-nums">{items.length}</span>
                {count > 0 && <span className="ml-auto rounded-full bg-warning/20 px-1.5 text-[10px] text-foreground">{count}</span>}
              </button>
              {isOpen && items.map((t) => <Card key={t.path} t={t} />)}
            </section>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="token-search" className="sr-only">Find a token</label>
        <input id="token-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a token" className="h-8 w-48 rounded-md border bg-background px-2 text-sm" />
        {/* A workspace made before layers has no palette or layer list yet: the upgrade comes first. */}
        <Button size="sm" variant="outline" onClick={() => setDialog("palette")} disabled={state.upgradeAvailable} title={state.upgradeAvailable ? "Upgrade to layered tokens first (banner above)" : undefined}>Add a color to the palette</Button>
        <Button size="sm" variant="outline" onClick={() => setDialog("layer")} disabled={state.upgradeAvailable} title={state.upgradeAvailable ? "Upgrade to layered tokens first (banner above)" : undefined}>Add a layer</Button>
        <span className="ml-auto text-xs text-muted-foreground">{sel ? <>Showing the path of <code>{label(sel)}</code>. <button type="button" className="underline" onClick={() => onSelect(null)}>Clear</button></> : "Click a token to see where it comes from and what uses it."}</span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div ref={container} className="relative overflow-x-auto rounded-xl border bg-muted/30 p-3">
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible">
            {lines.map((l) => <path key={l.key} d={l.d} fill="none" stroke="var(--ring)" strokeWidth={1.5} />)}
          </svg>
          <div className="grid min-w-[44rem] gap-5" style={{ gridTemplateColumns: columns.map((c) => (c.layer.id === "primitives" ? "minmax(17rem,1.2fr)" : "minmax(11rem,1fr)")).join(" ") }}>
            {columns.map(({ layer, rows }, i) => (
              <div key={layer.id} className="flex min-w-0 flex-col gap-2">
                <header className="flex items-center justify-between gap-2 border-b pb-1">
                  <span className="text-xs font-semibold">{i + 1}. {layer.name}</span>
                  <span className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground tabular-nums">{rows.filter((r) => !r.derived).length}</span>
                    {layer.id !== "primitives" && layer.id !== "components" && (
                      <button type="button" className="rounded px-1 text-xs text-muted-foreground hover:bg-muted" title={`New token in ${layer.name}`} onClick={() => setDialog({ layer: layer.id })}>+</button>
                    )}
                  </span>
                </header>
                {layer.id === "primitives" ? <PaletteColumn rows={rows} /> : <GroupedColumn rows={rows} layerId={layer.id} />}
              </div>
            ))}
          </div>
        </div>

        <aside aria-label="Token details" className="min-w-0 xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:self-start xl:overflow-y-auto">
          {sel ? (
            <TokenEditor g={g} state={state} brand={brand} mode={mode} row={sel} reminders={reminders} draft={draft} onEdit={onEdit} onSelect={onSelect} />
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm">
              <h2 className="font-medium">Layers, bottom up</h2>
              <ol className="flex list-decimal flex-col gap-2 pl-5 text-muted-foreground">
                <li><strong className="text-foreground">Palette</strong>: fixed colors, radius and shadow. Tailwind's, plus colors you add.</li>
                <li><strong className="text-foreground">Roles</strong>: what a color is for (primary, muted, border). Each points at a palette step, per brand and mode.</li>
                <li><strong className="text-foreground">Components</strong>: what each component uses. Each points at a role.</li>
              </ol>
              <p className="text-muted-foreground">Change the lowest layer that matches what you want: a palette step changes every role on it; a role changes every component using it; a component token changes only that component. Edits collect in a draft; send it to Changes to review and apply.</p>
              <p className="text-muted-foreground">Dots on tokens are reminders (red: contrast, amber: other). They never block anything.</p>
            </div>
          )}
        </aside>
      </div>

      {dialog === "palette" && <AddPaletteColorDialog onClose={() => setDialog(null)} onDone={(m) => { setDialog(null); onProposed(m); }} onError={onError} />}
      {dialog === "layer" && <AddLayerDialog state={state} onClose={() => setDialog(null)} onDone={(m) => { setDialog(null); onProposed(m); }} onError={onError} />}
      {dialog && typeof dialog === "object" && <NewTokenDialog g={g} state={state} layerId={dialog.layer} mode={mode} onClose={() => setDialog(null)} onEdit={(ops) => { ops.forEach(onEdit); setDialog(null); }} />}
    </div>
  );
}

