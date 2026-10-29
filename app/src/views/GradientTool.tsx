// The gradient tool on the Style page: each gradient is color stops that are your colors (so it follows the brand and
// light or dark mode), an angle, and the color of text on it. A live panel shows it; the engine says how the text reads
// against every stop. Nothing is written until Save; then it is one change, undoable like any other.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type ChangeResult, type Gradient, type GradientContrast, type GradientStop, type State, type TokenRow } from "@/lib/api";
import { roleName } from "@/lib/plain";
import { valueIn, type Mode } from "@/lib/tokens";

type Props = {
  state: State; brand: string; mode: Mode; rows: TokenRow[];
  onChanged: (r: Partial<ChangeResult> & { unchanged?: boolean }, fallback: string) => void; onError: (m: string) => void;
};
type Draft = { name: string; stops: GradientStop[]; angle: number; foreground: string };

// Colors a gradient can be made of, strongest first; text colors and lines are left out.
const ROLE_ORDER = ["primary", "secondary", "accent", "muted", "background", "card", "popover", "destructive", "info", "success", "warning", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6", "chart-7", "chart-8"];
const DIRECTIONS: [number, string, string][] = [[0, "↑", "Up"], [45, "↗", "Up and right"], [90, "→", "Right"], [135, "↘", "Down and right"], [180, "↓", "Down"], [225, "↙", "Down and left"], [270, "←", "Left"], [315, "↖", "Up and left"]];
const NEW_NAMES = ["hero", "accent", "band", "card", "footer"];

export function GradientTool({ state, brand, mode, rows, onChanged, onError }: Props) {
  const gradients = useMemo(() => state.style[brand]?.gradients ?? [], [state.style, brand]);
  const roleRows = useMemo(() => rows.filter((r) => r.type === "color" && r.path.startsWith("color/") && !r.path.endsWith("-foreground") && r.layerId === "semantic"), [rows]);
  const roleOf = (r: TokenRow) => r.path.replace(/^color\//, "").replace(/\//g, "-");
  const roles = useMemo(() => {
    const names = new Set(roleRows.map(roleOf));
    return [...ROLE_ORDER.filter((n) => names.has(n)), ...[...names].filter((n) => !ROLE_ORDER.includes(n) && !/^chart-(seq|div)/.test(n))];
  }, [roleRows]);
  const textRoles = useMemo(() => rows.filter((r) => r.type === "color" && r.path.startsWith("color/") && r.layerId === "semantic").map(roleOf).filter((n) => n.endsWith("-foreground") || n === "foreground"), [rows]);
  const has = (role: string) => rows.some((r) => r.path === `color/${role.replace(/-(\d)$/, "/$1")}` || r.path === `color/${role}`);
  const color = (role: string) => { const r = rows.find((x) => x.path === `color/${role}` || x.path === `color/${role.replace(/^chart-/, "chart/")}`); return r ? valueIn(r, mode)?.resolved ?? undefined : undefined; };

  const fresh = (name: string): Draft => ({ name, stops: [{ color: "primary", position: 0 }, { color: has("chart-2") ? "chart-2" : "primary", position: 1 }], angle: 135, foreground: has("primary-foreground") ? "primary-foreground" : "foreground" });
  const [name, setName] = useState(gradients[0]?.name ?? "brand");
  const saved = gradients.find((g) => g.name === name) ?? null;
  const initial = useMemo<Draft>(() => (saved ? { name: saved.name, stops: saved.stops, angle: saved.angle, foreground: saved.foreground ?? "foreground" } : fresh(name)), [saved, name]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<Draft>(initial);
  // Reset only when what is saved really changed, not on every reload of the page's state (which would drop edits).
  const initialKey = JSON.stringify(initial);
  useEffect(() => setDraft(JSON.parse(initialKey)), [initialKey]);
  const [check, setCheck] = useState<GradientContrast[] | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  // How the text reads against each stop, from the engine, a moment after the controls stop.
  useEffect(() => {
    const t = window.setTimeout(() => { api.gradientCheck(brand, draft.stops, draft.foreground).then((r) => setCheck(r.contrast)).catch(() => setCheck(null)); }, 200);
    return () => window.clearTimeout(t);
  }, [brand, draft.stops, draft.foreground]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setStop = (i: number, patch: Partial<GradientStop>) => set({ stops: draft.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const sorted = [...draft.stops].sort((a, b) => a.position - b.position);
  const radius = rows.find((r) => r.path === "radius/container");
  const panel: React.CSSProperties = {
    backgroundImage: `linear-gradient(${draft.angle}deg, ${sorted.map((s) => `${color(s.color) ?? "transparent"} ${Math.round(s.position * 100)}%`).join(", ")})`,
    color: color(draft.foreground),
    borderRadius: radius ? valueIn(radius, mode)?.resolved ?? undefined : undefined,
  };
  const failing = check?.filter((c) => !c.pass) ?? [];
  const save = async () => {
    try { onChanged(await api.gradient(brand, draft), "Gradient saved."); } catch (e) { onError((e as Error).message); }
  };
  const startNew = () => {
    const n = NEW_NAMES.find((x) => !gradients.some((g) => g.name === x)) ?? `gradient-${gradients.length + 1}`;
    setName(n);
  };
  const modeWord = (m: string) => (m === "dark" ? "Dark mode" : "Light mode");

  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-background p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-base font-semibold">Gradients</h2><p className="text-sm text-muted-foreground">Made of your colors, so they follow the brand and light or dark mode. For hero bands, featured cards and the top bar. Nothing changes until you save.</p></div>
        <div role="group" aria-label="Which gradient" className="flex flex-wrap gap-2">
          {gradients.map((g: Gradient) => (
            <button key={g.name} type="button" aria-pressed={name === g.name} onClick={() => setName(g.name)} className={`inline-flex min-h-10 items-center gap-2 rounded-full border-2 py-1 pr-3.5 pl-1.5 text-sm font-medium ${name === g.name ? "border-foreground" : "border-border"}`}>
              <span aria-hidden="true" className="size-6 rounded-full border" style={{ backgroundImage: `linear-gradient(${g.angle}deg, ${g.stops.map((s) => `${color(s.color) ?? "transparent"} ${Math.round(s.position * 100)}%`).join(", ")})` }} />{roleName(g.name)}
            </button>
          ))}
          {!saved && <span className="inline-flex min-h-10 items-center rounded-full border-2 border-foreground px-3.5 text-sm font-medium">New: {roleName(name)}</span>}
          {saved && <Button variant="outline" className="min-h-10 rounded-full" onClick={startNew}>New gradient</Button>}
        </div>
      </div>
      <div className="flex flex-wrap gap-5">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5">
          {!saved && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">Name</span>
              <input value={draft.name} onChange={(e) => set({ name: e.target.value })} className="h-10 w-56 rounded-lg border bg-background px-3" />
            </label>
          )}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Colors, from start to end</span>
            {draft.stops.map((s, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border px-2.5 py-2">
                <span aria-hidden="true" className="size-6 flex-none rounded-full border" style={{ background: color(s.color) }} />
                <select aria-label={`Color ${i + 1}`} value={s.color} onChange={(e) => setStop(i, { color: e.target.value })} className="h-9 min-w-36 rounded-lg border bg-background px-2 text-sm">
                  {roles.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
                </select>
                <label className="flex flex-1 items-center gap-2 text-sm">
                  <span className="sr-only">Where color {i + 1} sits</span>
                  <input type="range" min={0} max={100} step={1} value={Math.round(s.position * 100)} onChange={(e) => setStop(i, { position: Number(e.target.value) / 100 })} className="min-w-24 flex-1 accent-foreground" />
                  <span className="w-10 text-right tabular-nums text-muted-foreground">{Math.round(s.position * 100)}%</span>
                </label>
                {draft.stops.length > 2 && <button type="button" aria-label={`Remove color ${i + 1}`} onClick={() => set({ stops: draft.stops.filter((_, j) => j !== i) })} className="grid size-8 place-items-center rounded-full border text-sm hover:bg-muted">×</button>}
              </div>
            ))}
            {draft.stops.length < 5 && <button type="button" onClick={() => set({ stops: [...draft.stops, { color: roles[0] ?? "primary", position: 0.5 }] })} className="min-h-9 self-start text-sm font-medium text-info underline underline-offset-2">Add a color</button>}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="flex items-baseline justify-between text-sm"><span className="font-semibold">Direction</span><span className="tabular-nums text-muted-foreground">{draft.angle}°</span></span>
            <div role="group" aria-label="Direction" className="flex flex-wrap gap-1.5">
              {DIRECTIONS.map(([deg, arrow, label]) => <button key={deg} type="button" aria-pressed={draft.angle === deg} aria-label={label} title={label} onClick={() => set({ angle: deg })} className={`grid size-9 place-items-center rounded-full border-2 text-base ${draft.angle === deg ? "border-foreground" : "border-border"}`}>{arrow}</button>)}
            </div>
            <input type="range" aria-label="Angle" min={0} max={359} step={1} value={draft.angle} onChange={(e) => set({ angle: Number(e.target.value) })} className="w-full accent-foreground" />
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Text on it</span>
            <select value={draft.foreground} onChange={(e) => set({ foreground: e.target.value })} className="h-10 w-56 rounded-lg border bg-background px-2">
              {textRoles.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
            </select>
          </label>
        </div>
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-3">
          <div className="flex min-h-56 flex-col justify-end gap-1 p-6" style={panel}>
            <span className="text-xs font-medium uppercase opacity-80">October</span>
            <span className="text-2xl font-semibold">1,240 of 2,000 spent</span>
            <span className="text-sm">You are on track for the month.</span>
          </div>
          <div aria-live="polite" className="flex flex-col gap-1.5 text-sm">
            <span className="font-semibold">Text on this gradient</span>
            {check ? (
              <ul className="grid grid-cols-2 gap-1.5">
                {check.map((c) => (
                  <li key={`${c.mode}-${c.percent}`} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${c.pass ? "" : "border-warning/60 bg-warning/10"}`}>
                    <span aria-hidden="true" className="size-4 flex-none rounded border" style={{ background: c.color ?? undefined }} />
                    <span>{modeWord(c.mode)}, at {c.percent}%: <strong>{c.ratio ?? "?"}:1</strong> {c.pass ? "reads well" : "hard to read"}</span>
                  </li>
                ))}
              </ul>
            ) : <span className="text-muted-foreground">Checking…</span>}
            {failing.length > 0 && <span className="text-muted-foreground">Pick a darker or lighter color where it is hard to read, or another text color.</span>}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        <span className="mr-auto text-sm text-muted-foreground">{dirty ? "Not saved yet." : saved ? "Saved." : "Not set up yet: Save adds this gradient to your design system."}</span>
        <Button variant="outline" className="min-h-10" disabled={!dirty} onClick={() => setDraft(initial)}>Reset</Button>
        <Button className="min-h-10" disabled={!dirty && Boolean(saved)} onClick={save}>Save gradient</Button>
      </div>
    </section>
  );
}
