import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { api, type Op, type State } from "@/lib/api";
import { refOf, type Graph, type Mode } from "@/lib/tokens";
import { PalettePicker } from "@/views/TokenEditor";

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-30 grid place-items-center bg-foreground/30 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border bg-background p-5 shadow-lg">
        <header className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </header>
        {children}
      </div>
    </div>
  );
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** One color becomes a 50–950 scale in the palette (computed by the engine), queued as a change. */
export function AddPaletteColorDialog({ onClose, onDone, onError }: { onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#2f5d50");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { const r = await api.addPaletteColor(slug(name), color); onDone(`${r.name} proposed: ${color} sits on step ${r.anchor}. Review it in Changes.`); }
    catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Add a color to the palette" onClose={onClose}>
      <p className="text-sm text-muted-foreground">Give one color; it becomes a full 50–950 scale shaped like Tailwind's, with your color on its nearest step. Then point roles at its steps.</p>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="flex flex-col gap-1 text-sm">Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="lacquer-red" required className="h-9 rounded-md border bg-background px-2 font-mono" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Color
          <span className="flex items-center gap-2">
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#000000"} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 rounded border" aria-label="Pick a color" />
            <input value={color} onChange={(e) => setColor(e.target.value)} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono" aria-label="Color value (hex, rgb or oklch)" />
          </span>
        </label>
        <div className="flex justify-end"><Button type="submit" disabled={busy || !slug(name)}>{busy ? "Proposing…" : "Propose"}</Button></div>
      </form>
    </Dialog>
  );
}

/** A new layer between two others: its own token file, and its place in design-system.json. */
export function AddLayerDialog({ state, onClose, onDone, onError }: { state: State; onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const layers = (state.layers ?? []) as { id: string; name?: string; files: string[] }[];
  const [name, setName] = useState("");
  const [after, setAfter] = useState(layers.find((l) => l.id === "semantic")?.id ?? layers[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  if (!layers.length) {
    return <Dialog title="Add a layer" onClose={onClose}><p className="text-sm">This design system has no layers yet. Use the upgrade banner at the top of the page first.</p></Dialog>;
  }
  const submit = async () => {
    const id = slug(name);
    if (layers.some((l) => l.id === id)) { onError(`There is already a layer called ${id}.`); return; }
    const file = `tokens/layers/${id}.tokens.json`;
    const at = layers.findIndex((l) => l.id === after) + 1;
    const next = [...layers.slice(0, at), { id, name: name.trim(), files: [file] }, ...layers.slice(at)];
    const config = { ...state.config, layers: next };
    const ops: Op[] = [
      { op: "write", file, content: "{}\n" },
      { op: "write", file: "design-system.json", content: JSON.stringify(config, null, 2) + "\n" },
    ];
    setBusy(true);
    try { await api.createChange(`Add the ${name.trim()} layer`, ops, `A layer between ${layers[at - 1]?.name ?? layers[at - 1]?.id} and ${layers[at]?.name ?? layers[at]?.id ?? "the top"}. Tokens in it should point at its own layer or lower ones.`); onDone("Layer proposed. Review it in Changes; after applying, add tokens with + in its column."); }
    catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Add a layer" onClose={onClose}>
      <p className="text-sm text-muted-foreground">A layer between two others, for example "surface" between roles and components. Tokens should point at their own layer or lower ones; anything else shows as a reminder.</p>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="flex flex-col gap-1 text-sm">Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Surface" required className="h-9 rounded-md border bg-background px-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Place it after
          <select value={after} onChange={(e) => setAfter(e.target.value)} className="h-9 rounded-md border bg-background px-2">
            {layers.slice(0, -1).map((l) => <option key={l.id} value={l.id}>{l.name ?? l.id}</option>)}
          </select>
        </label>
        <div className="flex justify-end"><Button type="submit" disabled={busy || !slug(name)}>{busy ? "Proposing…" : "Propose"}</Button></div>
      </form>
    </Dialog>
  );
}

/** A new color token in a layer, pointing at the palette. Roles are added to every brand. */
export function NewTokenDialog({ g, state, layerId, mode, onClose, onEdit }: { g: Graph; state: State; layerId: string; mode: Mode; onClose: () => void; onEdit: (ops: Op[]) => void }) {
  const layer = g.layers.find((l) => l.id === layerId);
  const [name, setName] = useState("");
  const [light, setLight] = useState<string | null>(null);
  const [dark, setDark] = useState<string | null>(null);
  const [which, setWhich] = useState<Mode>(mode);
  const files = layerId === "semantic"
    ? state.brands.map((b) => `brands/${b}/tokens.json`)
    : ((state.layers ?? []) as { id: string; files: string[] }[]).find((l) => l.id === layerId)?.files.filter((f) => !f.includes("*") && !f.includes("{brand}")) ?? [];
  const submit = () => {
    const path = `color/${slug(name)}`;
    const ops: Op[] = files.flatMap((file) => [
      { op: "set" as const, file, path, type: "color", value: light! },
      ...(dark && dark !== light ? [{ op: "set" as const, file, path, mode: "dark", value: dark }] : []),
    ]);
    onEdit(ops);
  };
  return (
    <Dialog title={`New color in ${layer?.name ?? layerId}`} onClose={onClose}>
      <p className="text-sm text-muted-foreground">{layerId === "semantic" ? `Added to every brand (${state.brands.join(", ")}) so components can use it everywhere.` : `Stored in ${files[0] ?? "this layer"}.`} It goes into the draft.</p>
      <label className="flex flex-col gap-1 text-sm">Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="highlight" className="h-9 rounded-md border bg-background px-2 font-mono" />
      </label>
      <div className="flex gap-1" role="group" aria-label="Which value">
        {(["default", "dark"] as Mode[]).map((m) => <Button key={m} size="sm" variant={which === m ? "secondary" : "ghost"} onClick={() => setWhich(m)}>{m === "default" ? "Light" : "Dark"}{(m === "default" ? light : dark) ? " ✓" : ""}</Button>)}
      </div>
      <PalettePicker g={g} mode={which} current={((which === "default" ? light : dark) ?? "").replace(/[{}]/g, "").replace(/\./g, "/") || null} onPick={(t) => (which === "default" ? setLight(refOf(t.path)) : setDark(refOf(t.path)))} />
      <div className="flex justify-end"><Button onClick={submit} disabled={!slug(name) || !light || !files.length}>Add to draft</Button></div>
    </Dialog>
  );
}
