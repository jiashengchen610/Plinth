import { useEffect, useState } from "react";
import { api, type ChangeResult } from "@/lib/api";
import { hexToOklch, oklchToHex, type Oklch } from "@/lib/color";
import { ColorWheel } from "@/views/ColorWheel";

type Added = ChangeResult & { name: string };
type Props = {
  hint: string; onAdded: (r: Added) => void; onError: (m: string) => void;
  /** Where the wheel starts, e.g. the color being replaced. */
  initial?: Oklch | null;
  /** Point one of your colors at the new one in the same change. */
  use?: { brand: string; role: string; mode: "default" | "dark"; label: string; title: string };
};

/** Adds a color of your own to the palette: Plinth names it after the picked color (until you type a name) and makes the scale. */
export function AddColor({ hint, onAdded, onError, initial, use }: Props) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<Oklch>(initial ?? hexToOklch("#ca8a04")!);
  const [ownName, setOwnName] = useState(false);
  const hex = oklchToHex(color);
  useEffect(() => {
    if (ownName) return;
    const t = window.setTimeout(() => { api.colorName(hex).then((r) => setName(r.name)).catch(() => {}); }, 150);
    return () => window.clearTimeout(t);
  }, [hex, ownName]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try { onAdded(await api.addPaletteColor(name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"), hex, use && { brand: use.brand, role: use.role, mode: use.mode, title: use.title })); } catch (err) { onError((err as Error).message); }
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={add}>
      <ColorWheel value={color} onChange={setColor} />
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-[1_1_160px] flex-col gap-1 text-sm font-semibold">Name<input value={name} onChange={(e) => { setName(e.target.value); setOwnName(true); }} placeholder="For example: terracotta" className="h-11 rounded-lg border bg-background px-3 font-normal" /></label>
        <button type="submit" disabled={!name.trim()} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{use ? `Add and use for ${use.label}` : "Add"}</button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </form>
  );
}
