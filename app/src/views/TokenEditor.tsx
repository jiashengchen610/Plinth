import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { Op, State, TokenRow } from "@/lib/api";
import { chainDown, componentOf, dependents, isColor, isPalette, label, paletteHues, refOf, targetIn, valueIn, type Graph, type Mode, type Reminder } from "@/lib/tokens";

type Props = {
  g: Graph; state: State; brand: string; mode: Mode; row: TokenRow;
  reminders: Map<string, Reminder[]>; draft: Op[];
  onEdit: (op: Op) => void; onSelect: (key: string) => void;
};

const modeLabel = (m: Mode) => (m === "default" ? "Light" : "Dark");

function Chip({ t, mode, onClick, current }: { t: TokenRow; mode: Mode; onClick: () => void; current?: boolean }) {
  const v = valueIn(t, mode);
  return (
    <button type="button" onClick={onClick} className={`inline-flex min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted ${current ? "bg-accent" : "bg-background"}`}>
      {isColor(t) && <span className="size-3 shrink-0 rounded-sm border" style={{ background: v?.resolved ?? "transparent" }} />}
      <span className="truncate">{label(t)}</span>
    </button>
  );
}

/** Every palette color as a grid; the current one is marked. */
export function PalettePicker({ g, mode, current, onPick }: { g: Graph; mode: Mode; current: string | null; onPick: (t: TokenRow) => void }) {
  return (
    <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto pr-1">
      {paletteHues(g).map(({ hue, steps }) => (
        <div key={hue} className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-1">
          <span className="truncate text-[10px] text-muted-foreground">{hue}</span>
          <div className="flex gap-px">
            {steps.map(({ step, row }) => (
              <button key={row.path} type="button" title={label(row)} onClick={() => onPick(row)}
                className={`h-5 min-w-0 rounded-sm ${steps.length === 1 ? "w-6 flex-none border" : "flex-1"} ${current === row.path ? "ring-2 ring-ring ring-offset-1" : "hover:ring-1 hover:ring-ring"}`}
                style={{ background: valueIn(row, mode)?.resolved ?? "transparent" }}>
                <span className="sr-only">{hue} {step}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TokenEditor({ g, state, brand, mode, row, reminders, draft, onEdit, onSelect }: Props) {
  const [editMode, setEditMode] = useState<Mode>(mode);
  useEffect(() => setEditMode(mode), [mode, row.path]);
  const layerIndex = g.layers.findIndex((l) => l.id === (row.layerId ?? "semantic"));
  const layerName = g.layers[layerIndex]?.name ?? "Semantic";
  const chain = chainDown(g, row, editMode);
  const deps = useMemo(() => dependents(g, row.path), [g, row.path]);
  const direct = (g.users.get(row.path) ?? []).map((k) => g.byKey.get(k)!).filter(Boolean);
  const components = [...new Set(deps.map(componentOf).filter(Boolean))] as string[];
  const roleUsers = deps.filter((d) => !isPalette(d) && !componentOf(d));
  const mine = reminders.get(row.name) ?? [];
  const target = targetIn(g, row, editMode);
  const modeOp = editMode === "default" ? undefined : editMode;
  const inDraft = draft.filter((o) => o.path === row.path && (o.mode ?? "default") === (modeOp ?? "default"));
  const alpha = Math.round((valueIn(row, editMode)?.alpha ?? 1) * 100);
  const [opacity, setOpacity] = useState(alpha);
  useEffect(() => setOpacity(alpha), [alpha, row.path, editMode]);
  const shared = row.source?.startsWith("tokens/") && !row.source.startsWith("tokens/primitives");
  const brands = state.brands.length;

  const set = (value: string) => onEdit({ op: "set", file: row.source, path: row.path, mode: modeOp, value });
  // Same-type tokens in lower layers (or the same layer) this one may point at.
  const options = g.rows.filter((t) => t.type === row.type && t.path !== row.path && !t.derived && !isPalette(t) && g.layers.findIndex((l) => l.id === (t.layerId ?? "semantic")) <= layerIndex && (t.layerId ?? "semantic") !== "components");
  const paletteOptions = g.rows.filter((t) => isPalette(t) && t.type === row.type);
  const [tab, setTab] = useState<"roles" | "palette">(row.layerId === "components" ? "roles" : "palette");
  useEffect(() => setTab(row.layerId === "components" ? "roles" : "palette"), [row.path, row.layerId]);

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 text-sm">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {isColor(row) && <span className="size-6 rounded border" style={{ background: valueIn(row, editMode)?.resolved ?? "transparent" }} />}
          <h2 className="min-w-0 truncate font-mono text-base font-medium">{label(row)}</h2>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary">{layerIndex + 1}. {layerName}</Badge>
          <Badge variant="outline">{row.type}</Badge>
          <code className="truncate text-[11px] text-muted-foreground">{row.source}</code>
        </div>
        {row.description && <p className="text-xs text-muted-foreground">{row.description}</p>}
      </header>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">Comes from ({modeLabel(editMode).toLowerCase()})</h3>
        <div className="flex flex-wrap items-center gap-1">
          {chain.map((t, i) => (
            <span key={t.path} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true" className="text-muted-foreground">→</span>}
              <Chip t={t} mode={editMode} current={t.path === row.path} onClick={() => onSelect(t.path)} />
            </span>
          ))}
          {!target && !isPalette(row) && <span className="text-xs text-muted-foreground">fixed value <code>{String(valueIn(row, editMode)?.raw)}</code></span>}
        </div>
        {alpha < 100 && <p className="text-xs text-muted-foreground">Drawn at {alpha}% opacity.</p>}
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">Used by</h3>
        {direct.length ? (
          <>
            <div className="flex flex-wrap gap-1">{direct.slice(0, 16).map((t) => <Chip key={t.path} t={t} mode={editMode} onClick={() => onSelect(t.path)} />)}{direct.length > 16 && <span className="text-xs text-muted-foreground">+{direct.length - 16}</span>}</div>
            <p className="text-xs text-muted-foreground">
              Changing it affects {roleUsers.length ? `${roleUsers.length} role${roleUsers.length > 1 ? "s" : ""}` : "no roles"}{components.length ? ` and ${components.length} component${components.length > 1 ? "s" : ""} (${components.join(", ")})` : ""}
              {shared && brands > 1 ? `, in all ${brands} brands` : row.source?.startsWith("brands/") && brands > 1 ? `, in ${brand} only` : ""}.
            </p>
          </>
        ) : <p className="text-xs text-muted-foreground">Nothing points at it{componentOf(row) ? `; the ${componentOf(row)} component uses it directly` : ""}.</p>}
      </section>

      {mine.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">Reminders</h3>
          <ul className="flex flex-col gap-1 text-xs">{mine.map((r, i) => <li key={i} className={`rounded-md border px-2 py-1 ${r.kind === "contrast" ? "border-destructive/40 bg-destructive/5" : "border-warning/50 bg-warning/10"}`}>{r.text}</li>)}</ul>
        </section>
      )}

      {isPalette(row) ? (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          Palette colors are fixed, so a step means the same thing everywhere. To change something that uses this step, select it and point it at another step. To bring a new hue, use <strong>Add a color to the palette</strong>.
        </p>
      ) : (
        <section className="flex flex-col gap-2 border-t pt-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium">Change it</h3>
            {isColor(row) && (
              <div role="group" aria-label="Which value" className="flex rounded-md border p-0.5">
                {(["default", "dark"] as Mode[]).map((m) => (
                  <button key={m} type="button" aria-pressed={editMode === m} onClick={() => setEditMode(m)} className={`rounded px-2 py-0.5 text-xs ${editMode === m ? "bg-secondary font-medium" : "text-muted-foreground"}`}>{modeLabel(m)}</button>
                ))}
              </div>
            )}
          </div>
          {inDraft.length > 0 && <p className="text-xs text-info">In the draft: {inDraft.map((o) => (o.value !== undefined ? `→ ${String(o.value).replace(/[{}]/g, "").replace(/^color\./, "").replace(/\./g, "-")}` : `opacity ${Math.round((o.alpha ?? 1) * 100)}%`)).join(", ")}</p>}

          <div role="tablist" className="flex gap-1">
            {options.length > 0 && <button type="button" role="tab" aria-selected={tab === "roles"} onClick={() => setTab("roles")} className={`rounded px-2 py-0.5 text-xs ${tab === "roles" ? "bg-secondary font-medium" : "text-muted-foreground"}`}>Point at a role</button>}
            <button type="button" role="tab" aria-selected={tab === "palette"} onClick={() => setTab("palette")} className={`rounded px-2 py-0.5 text-xs ${tab === "palette" ? "bg-secondary font-medium" : "text-muted-foreground"}`}>Point at the palette</button>
          </div>

          {tab === "roles" && options.length > 0 ? (
            <div className="flex max-h-60 flex-col gap-0.5 overflow-y-auto pr-1">
              {options.map((t) => (
                <button key={t.path} type="button" onClick={() => set(refOf(t.path))} className={`flex items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted ${target?.path === t.path ? "bg-accent font-medium" : ""}`}>
                  {isColor(t) && <span className="size-3.5 shrink-0 rounded-sm border" style={{ background: valueIn(t, editMode)?.resolved ?? "transparent" }} />}
                  <span className="truncate font-mono">{label(t)}</span>
                  {!isColor(t) && <span className="ml-auto text-muted-foreground">{String(valueIn(t, editMode)?.resolved ?? "")}</span>}
                </button>
              ))}
            </div>
          ) : isColor(row) && !paletteOptions.length ? (
            <p className="text-xs text-muted-foreground">There is no palette yet. Use <strong>Review the upgrade</strong> at the top of the page; afterwards roles point at palette colors, and "Link colors to the palette" in Checks connects the colors you have.</p>
          ) : isColor(row) ? (
            <PalettePicker g={g} mode={editMode} current={target?.path ?? null} onPick={(t) => set(refOf(t.path))} />
          ) : (
            <div className="flex flex-wrap gap-1">
              {paletteOptions.map((t) => (
                <button key={t.path} type="button" onClick={() => set(refOf(t.path))} className={`rounded-md border px-2 py-1 font-mono text-xs hover:bg-muted ${target?.path === t.path ? "bg-accent" : ""}`}>
                  {label(t).replace(/^(radius|shadow)\//, "")} <span className="text-muted-foreground">{String(valueIn(t, editMode)?.resolved ?? "").slice(0, 24)}</span>
                </button>
              ))}
            </div>
          )}

          {isColor(row) && (
            <label className="flex items-center gap-2 text-xs">
              <span className="w-14 shrink-0 text-muted-foreground">Opacity</span>
              <input type="range" min={0} max={100} step={5} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))}
                onPointerUp={() => opacity !== alpha && onEdit({ op: "set", file: row.source, path: row.path, mode: modeOp, alpha: opacity / 100 })}
                onKeyUp={() => opacity !== alpha && onEdit({ op: "set", file: row.source, path: row.path, mode: modeOp, alpha: opacity / 100 })}
                className="min-w-0 flex-1" />
              <span className="w-9 text-right tabular-nums">{opacity}%</span>
            </label>
          )}
          <p className="text-[11px] text-muted-foreground">Edits go into the draft at the top of the page. Nothing is written until you send the draft to Changes and apply it.</p>
        </section>
      )}
    </div>
  );
}
