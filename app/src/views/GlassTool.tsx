// The glass tuning tool on the Style page: sliders for the glass recipe, a live panel over several backdrops, and
// how its text reads over the darkest and the lightest backdrop (computed by the engine). Nothing is written until
// Save; then it is one change, undoable like any other.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type ChangeResult, type GlassRecipe, type Presets, type State, type TokenRow } from "@/lib/api";
import { roleName } from "@/lib/plain";
import { valueIn, type Mode } from "@/lib/tokens";

type Props = {
  state: State; presets: Presets | null; brand: string; mode: Mode; rows: TokenRow[];
  onChanged: (r: Partial<ChangeResult> & { unchanged?: boolean }, fallback: string) => void; onError: (m: string) => void;
};
type Draft = GlassRecipe & { tint: string };
type Check = { foreground: string; contrast: { mode: string; backdrop: string; ratio: number | null; pass: boolean }[]; minOpacity: number | null };

const TINTS = ["popover", "background", "card", "muted", "primary"];
const BACKDROPS = [["color", "Color"], ["text", "Text"], ["dark", "Black"], ["light", "White"]] as const;
const REGULAR: GlassRecipe = { tintOpacity: 0.7, blur: 16, saturation: 1.6, highlight: 0.6, distortion: 0 };
const chromium = () => Boolean((navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands?.some((b) => b.brand === "Chromium"));

export function GlassTool({ state, presets, brand, mode, rows, onChanged, onError }: Props) {
  const saved = state.style[brand]?.glass;
  const initial = useMemo<Draft>(() => ({ tint: saved?.tint ?? "popover", ...(saved?.recipe ?? REGULAR) }), [saved]);
  const [draft, setDraft] = useState<Draft>(initial);
  // Reset only when what is saved really changed, not on every reload of the page's state (which would drop edits).
  const initialKey = JSON.stringify(initial);
  useEffect(() => setDraft(JSON.parse(initialKey)), [initialKey]);
  const [backdrop, setBackdrop] = useState<(typeof BACKDROPS)[number][0]>("color");
  const [check, setCheck] = useState<Check | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  // How the text reads, from the engine, a moment after the sliders stop.
  useEffect(() => {
    const t = window.setTimeout(() => { api.glassCheck(brand, draft.tint, draft.tintOpacity).then(setCheck).catch(() => setCheck(null)); }, 200);
    return () => window.clearTimeout(t);
  }, [brand, draft.tint, draft.tintOpacity]);

  const color = (name: string) => { const r = rows.find((x) => x.path === `color/${name}`); return r ? valueIn(r, mode)?.resolved ?? undefined : undefined; };
  const tints = TINTS.filter((t) => color(t));
  const radius = rows.find((r) => r.path === "radius/container");
  const set = (k: keyof Draft, v: number | string) => setDraft((d) => ({ ...d, [k]: v }));
  const ripple = draft.distortion > 0 && chromium();
  const filter = `blur(${draft.blur}px) saturate(${draft.saturation})`;
  const panel: React.CSSProperties = {
    background: `color-mix(in oklab, ${color(draft.tint) ?? "white"} ${Math.round(draft.tintOpacity * 100)}%, transparent)`,
    backdropFilter: ripple ? `url(#plinth-glass-ripple) ${filter}` : filter,
    WebkitBackdropFilter: filter,
    boxShadow: `inset 0 1px 0 0 rgb(255 255 255 / ${draft.highlight * 0.7}), inset 0 0 0 1px rgb(255 255 255 / ${draft.highlight * 0.2})`,
    color: check ? color(check.foreground) : undefined,
    borderRadius: radius ? valueIn(radius, mode)?.resolved ?? undefined : undefined,
  };
  const failing = check?.contrast.filter((c) => !c.pass) ?? [];
  const save = async () => {
    try { onChanged(await api.glass(brand, draft), "Glass saved."); } catch (e) { onError((e as Error).message); }
  };

  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-background p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-base font-semibold">Glass</h2><p className="text-sm text-muted-foreground">Frosted panels over photos and color, like the Glass component. Tune it here; nothing changes until you save.</p></div>
        <div className="flex flex-wrap gap-2">
          {(presets?.glass ?? []).map((p) => (
            <button key={p.id} type="button" aria-pressed={JSON.stringify({ ...draft, tint: undefined }) === JSON.stringify({ ...p.recipe, tint: undefined })} onClick={() => setDraft((d) => ({ ...d, ...p.recipe }))} className="min-h-10 rounded-full border-2 px-3.5 text-sm font-medium aria-pressed:border-foreground">{p.name}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-5">
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">Color</span>
            <div role="group" aria-label="Glass color" className="flex flex-wrap gap-2">
              {tints.map((t) => (
                <button key={t} type="button" aria-pressed={draft.tint === t} onClick={() => set("tint", t)} className={`inline-flex min-h-10 items-center gap-2 rounded-full border-2 py-1 pr-3 pl-1.5 text-sm ${draft.tint === t ? "border-foreground" : "border-border"}`}>
                  <span className="size-6 rounded-full border" style={{ background: color(t) }} />{roleName(t)}
                </button>
              ))}
            </div>
          </div>
          <Slider label="How much color shows" value={draft.tintOpacity} min={0} max={1} step={0.01} show={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set("tintOpacity", v)} />
          <Slider label="Blur" value={draft.blur} min={0} max={48} step={1} show={(v) => `${v}px`} onChange={(v) => set("blur", v)} />
          <Slider label="Color behind it" hint="How vivid what shows through is" value={draft.saturation} min={1} max={2.5} step={0.05} show={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set("saturation", v)} />
          <Slider label="Edge light" value={draft.highlight} min={0} max={1} step={0.05} show={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set("highlight", v)} />
          <Slider label="Ripple" hint={chromium() ? "Bends what is behind it a little. Chrome and Edge only; others show plain glass." : "Bends what is behind it a little. Shows in Chrome and Edge only, so it is not visible here."} value={draft.distortion} min={0} max={1} step={0.05} show={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set("distortion", v)} />
        </div>
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-3">
          <div role="group" aria-label="Backdrop" className="flex flex-wrap gap-1.5">
            {BACKDROPS.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={backdrop === id} onClick={() => setBackdrop(id)} className={`min-h-9 rounded-full border-2 px-3 text-sm ${backdrop === id ? "border-foreground" : "border-border"}`}>{label}</button>
            ))}
          </div>
          <div className={`relative grid min-h-64 place-items-center overflow-hidden rounded-xl p-6 ${backdrop === "dark" ? "bg-black" : backdrop === "light" ? "bg-white" : "bg-[linear-gradient(135deg,#fda4af,#fde68a,#7dd3fc)]"}`} style={{ borderRadius: panel.borderRadius }}>
            {backdrop === "color" && (
              <>
                <span aria-hidden="true" className="absolute top-4 left-6 size-32 rounded-full bg-[#f43f5e]" />
                <span aria-hidden="true" className="absolute right-6 bottom-2 size-40 rounded-full bg-[#0ea5e9]" />
                <span aria-hidden="true" className="absolute top-16 left-1/2 size-24 rounded-full bg-[#f59e0b]" />
              </>
            )}
            {backdrop === "text" && <p aria-hidden="true" className="absolute inset-4 text-lg leading-snug text-black">Rent 1,200 · Groceries 310 · Transport 96 · Dining out 184 · Savings 400 · Utilities 142 · Phone 35 · Insurance 88 · Gym 45 · Books 27 · Rent 1,200 · Groceries 310 · Transport 96 · Dining out 184 · Savings 400 · Utilities 142 · Phone 35 · Insurance 88</p>}
            {ripple && (
              <svg aria-hidden="true" width="0" height="0" className="absolute">
                <filter id="plinth-glass-ripple" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
                  <feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves={1} seed={3} result="ripple" />
                  <feDisplacementMap in="SourceGraphic" in2="ripple" scale={Math.round(draft.distortion * 40)} xChannelSelector="R" yChannelSelector="G" />
                </filter>
              </svg>
            )}
            <div className="relative flex w-64 flex-col gap-2 p-5" style={panel}>
              <span className="text-base font-semibold">October budget</span>
              <span className="text-sm">1,240 of 2,000 spent. You are on track.</span>
            </div>
          </div>
          <div aria-live="polite" className="flex flex-col gap-1.5 text-sm">
            <span className="font-semibold">Text on this glass</span>
            {check ? (
              <ul className="grid grid-cols-2 gap-1.5">
                {check.contrast.map((c) => (
                  <li key={`${c.mode}-${c.backdrop}`} className={`rounded-lg border px-2.5 py-1.5 ${c.pass ? "" : "border-warning/60 bg-warning/10"}`}>
                    {c.mode === "dark" ? "Dark mode" : "Light mode"}, over {c.backdrop}: <strong>{c.ratio ?? "?"}:1</strong> {c.pass ? "reads well" : "hard to read"}
                  </li>
                ))}
              </ul>
            ) : <span className="text-muted-foreground">Checking…</span>}
            {failing.length > 0 && check?.minOpacity !== null && check?.minOpacity !== undefined && (
              <div className="flex flex-wrap items-center gap-2">
                <span>Text needs at least {Math.round(check.minOpacity * 100)}% color to read on every backdrop.</span>
                <Button variant="outline" className="min-h-9" onClick={() => set("tintOpacity", check.minOpacity!)}>Use {Math.round(check.minOpacity * 100)}%</Button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        <span className="mr-auto text-sm text-muted-foreground">{dirty ? "Not saved yet." : saved ? "Saved." : "Not set up yet: Save adds glass to your design system."}</span>
        <Button variant="outline" className="min-h-10" disabled={!dirty} onClick={() => setDraft(initial)}>Reset</Button>
        <Button className="min-h-10" disabled={!dirty && Boolean(saved)} onClick={save}>Save glass</Button>
      </div>
    </section>
  );
}

function Slider({ label, hint, value, min, max, step, show, onChange }: { label: string; hint?: string; value: number; min: number; max: number; step: number; show: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2 text-sm"><span className="font-semibold">{label}</span><span className="tabular-nums text-muted-foreground">{show(value)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-foreground" />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
