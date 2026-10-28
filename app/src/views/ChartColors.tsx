// Chart colors on the Style page: the three sets Plinth made from the main color (categories, low to high, around a
// middle), seen with normal vision or with a color vision deficiency, on the page in light or dark mode, with how
// many series stay apart for everyone. Everything here is computed by the engine.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type ChangeResult, type ChartEntry, type ChartView, type State } from "@/lib/api";
import type { Mode } from "@/lib/tokens";

type Vision = "color" | "protan" | "deutan" | "tritan";
const VISIONS: [Vision, string][] = [["color", "Normal"], ["protan", "Red-blind (protan)"], ["deutan", "Green-blind (deutan)"], ["tritan", "Blue-blind (tritan)"]];

type Props = { state: State; brand: string; mode: Mode; page: string | undefined; onChanged: (r: Partial<ChangeResult> & { unchanged?: boolean; message?: string }, fallback: string) => void; onError: (m: string) => void };

export function ChartColors({ state, brand, mode, page, onChanged, onError }: Props) {
  const [view, setView] = useState<ChartView | null | undefined>(undefined);
  const [vision, setVision] = useState<Vision>("color");
  useEffect(() => { api.chart(brand).then((r) => setView(r.chart)).catch(() => setView(null)); }, [brand, state.rev]);
  const make = async () => { try { onChanged(await api.makeChart(brand), "Chart colors made from your palette."); } catch (e) { onError((e as Error).message); } };
  if (view === undefined) return null;

  const paint = (c: ChartEntry) => ((mode === "dark" ? c.dark : undefined) ?? c.default)[vision] ?? undefined;
  const failing = view?.failing ?? [];
  const series = view?.series ?? [];
  const label = (name: string) => `Series ${name.split("-").at(-1)}`;
  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-background p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-base font-semibold">Chart colors</h2><p className="text-sm text-muted-foreground">Made from your main color for the Chart component: categories, low to high values, and values around a middle.</p></div>
        <div role="group" aria-label="See it as" className="flex flex-wrap gap-1.5">
          {VISIONS.map(([id, name]) => (
            <button key={id} type="button" aria-pressed={vision === id} onClick={() => setVision(id)} className={`min-h-9 rounded-full border-2 px-3 text-sm ${vision === id ? "border-foreground" : "border-border"}`}>{name}</button>
          ))}
        </div>
      </div>
      {!view ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex-[1_1_240px] text-sm">This design system has no chart colors yet.</span>
          <Button onClick={make}>Make chart colors</Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-5">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Categories</span>
              <div className="flex h-28 items-end gap-1.5 rounded-xl border p-3" style={{ background: page }}>
                {series.map((s, i) => (
                  <span key={s.name} title={label(s.name)} className="w-7 rounded-t-md" style={{ background: paint(s), height: `${40 + ((i * 37) % 60)}%` }} />
                ))}
              </div>
              <div className="flex gap-1.5 px-3">{series.map((s) => <span key={s.name} className="w-7 text-center text-xs text-muted-foreground">{s.name.split("-").at(-1)}</span>)}</div>
            </div>
            <Ramp title="Low to high" colors={view.sequential.map(paint)} />
            <Ramp title="Around a middle" colors={view.diverging.map(paint)} />
          </div>
          <p role="status" className={`rounded-xl border px-3.5 py-2 text-sm ${failing.length ? "border-warning/50 bg-warning/10" : ""}`}>
            {!failing.length ? `All ${series.length} series stay apart for everyone, including the three common color vision deficiencies, and read on the page in light and dark mode.`
              : `Series 1 to ${view.safe} stay apart for everyone. ${failing.slice(0, 3).map((f) => (f.kind === "contrast" ? `${label(f.a)} is faint on the page${f.mode === "dark" ? " in dark mode" : ""}` : `${label(f.a)} and ${label(f.b!)} look alike${f.vision && f.vision !== "normal" ? ` for ${f.vision} vision` : ""}${f.mode === "dark" ? " in dark mode" : ""}`)).join("; ")}.`}
          </p>
          <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
            <span className="flex-[1_1_260px] text-muted-foreground">{view.madeBy === "plinth" ? "Plinth made these from your main color and the colors next to it; they follow it when you change it. Never use color alone: label your series."
              : view.madeBy === "older" ? "These were made the older way, from the most different colors in the palette. Plinth now makes them from your main color and the colors next to it."
              : "Some were picked by hand, so they stay when the main color changes. Make them again from your main color to replace them."}</span>
            {view.madeBy !== "plinth" && <Button variant="outline" className="min-h-10" onClick={make}>{view.madeBy === "older" ? "Use colors from my main color" : "Make from my main color"}</Button>}
          </div>
        </>
      )}
    </section>
  );
}

function Ramp({ title, colors }: { title: string; colors: (string | undefined)[] }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">{title}</span>
      <div className="flex overflow-hidden rounded-xl border">
        {colors.map((c, i) => <span key={i} className="h-12 w-8" style={{ background: c }} />)}
      </div>
    </div>
  );
}
