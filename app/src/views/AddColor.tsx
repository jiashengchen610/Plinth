import { useEffect, useState } from "react";
import { api, type ChangeResult } from "@/lib/api";

type Added = ChangeResult & { name: string };

/** Adds a color of your own to the palette: Plinth names it after the picked color (until you type a name) and makes the scale. */
export function AddColor({ hint, onAdded, onError }: { hint: string; onAdded: (r: Added) => void; onError: (m: string) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#ca8a04");
  const [ownName, setOwnName] = useState(false);
  useEffect(() => {
    if (ownName) return;
    const t = window.setTimeout(() => { api.colorName(color).then((r) => setName(r.name)).catch(() => {}); }, 150);
    return () => window.clearTimeout(t);
  }, [color, ownName]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try { onAdded(await api.addPaletteColor(name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"), color)); } catch (err) { onError((err as Error).message); }
  };
  return (
    <form className="flex flex-wrap items-end gap-2.5" onSubmit={add}>
      <label className="flex flex-[1_1_160px] flex-col gap-1 text-sm font-semibold">Name<input value={name} onChange={(e) => { setName(e.target.value); setOwnName(true); }} placeholder="For example: terracotta" className="h-11 rounded-lg border bg-background px-3 font-normal" /></label>
      <label className="flex flex-col gap-1 text-sm font-semibold">Color<input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-11 w-16 rounded-lg border bg-background p-0.5" /></label>
      <button type="submit" disabled={!name.trim()} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">Add</button>
      <p className="basis-full text-xs text-muted-foreground">{hint}</p>
    </form>
  );
}
