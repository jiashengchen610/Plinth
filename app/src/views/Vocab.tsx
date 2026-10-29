// The shared vocabulary in the UI: an illustration for each entry (a line icon for a component, a tiny button in the
// look's color and corners, swatches, a corner, the font's own letters, a glass tile), the search the chat's "/" menu
// and the Add panel share, and the list they show.
import { AppWindow, BadgeCheck, BellRing, Blend, ChartColumn, ChevronsUpDown, CircleDot, Columns3, Component, IdCard, List, LoaderCircle, MessageSquare, MessageSquareWarning, PackageOpen, PanelTop, Route, SeparatorHorizontal, SlidersHorizontal, SquareCheck, SquareMousePointer, Tag, TextCursorInput, TextSearch, TextWrap, ToggleRight, TriangleAlert, X, type LucideIcon } from "lucide-react";
import type { VocabEntry, VocabKind } from "@/lib/api";

const GLYPHS: Record<string, LucideIcon> = {
  button: SquareMousePointer, input: TextCursorInput, label: Tag, card: IdCard, badge: BadgeCheck, textarea: TextWrap, checkbox: SquareCheck, "radio-group": CircleDot, select: ChevronsUpDown, switch: ToggleRight,
  alert: TriangleAlert, toast: BellRing, tooltip: MessageSquare, tabs: PanelTop, dialog: AppWindow, separator: SeparatorHorizontal, glass: Blend, chart: ChartColumn, progress: LoaderCircle, slider: SlidersHorizontal,
  "input-group": TextSearch, "button-group": Columns3, "alert-dialog": MessageSquareWarning, item: List, breadcrumb: Route, empty: PackageOpen,
};

export const KIND_LABELS: Record<VocabKind, string> = { component: "Components", look: "Looks", color: "Colors", font: "Fonts", corners: "Corners", glass: "Glass" };
const KIND_ORDER: VocabKind[] = ["component", "look", "color", "font", "corners", "glass"];

/** What an entry looks like, in a small square. */
export function VocabArt({ entry, className = "" }: { entry: VocabEntry; className?: string }) {
  const a = entry.art;
  const base = `grid size-9 flex-none place-items-center overflow-hidden rounded-md border bg-muted/40 ${className}`;
  if (entry.kind === "component") {
    const Icon = GLYPHS[a.glyph ?? entry.key] ?? Component;
    return <span aria-hidden="true" className={base}><Icon className="size-5" strokeWidth={1.75} /></span>;
  }
  if (entry.kind === "look") {
    const [main, , light] = a.swatches ?? [];
    return (
      <span aria-hidden="true" className={base} style={{ background: light ?? undefined }}>
        <span className="grid h-5 w-7 place-items-center text-[10px] leading-none font-semibold text-white" style={{ background: main ?? "currentColor", borderRadius: a.corners ?? "4px", fontFamily: a.font ? `"${a.font}", sans-serif` : undefined, ...(a.glass ? { opacity: 0.85 } : {}) }}>Aa</span>
      </span>
    );
  }
  if (entry.kind === "color") {
    const [main, tint, light, mid, dark] = a.swatches ?? [];
    return (
      <span aria-hidden="true" className={`${base} grid-cols-2 gap-0 p-0`}>
        <span className="block h-full w-full" style={{ background: main ?? undefined }} />
        <span className="block h-full w-full" style={{ background: tint ?? undefined }} />
        <span className="block h-full w-full" style={{ background: mid ?? undefined }} />
        <span className="block h-full w-full" style={{ background: dark ?? light ?? undefined }} />
      </span>
    );
  }
  if (entry.kind === "font") {
    return <span aria-hidden="true" className={`${base} text-base leading-none`} style={{ fontFamily: `"${a.font ?? entry.name}", ${a.kind === "serif" ? "serif" : "sans-serif"}` }}>Ag</span>;
  }
  if (entry.kind === "corners") {
    return <span aria-hidden="true" className={base}><span className="block size-5 border-2 border-foreground/80" style={{ borderRadius: a.corners ?? 0 }} /></span>;
  }
  // Glass: a tinted, blurred panel over color.
  const g = a.glass;
  return (
    <span aria-hidden="true" className={base} style={{ background: "linear-gradient(135deg, #f97316 0%, #8b5cf6 55%, #0ea5e9 100%)" }}>
      <span className="block size-6 rounded-sm border border-white/60" style={{ background: `rgba(255,255,255,${g?.tintOpacity ?? 0.7})`, backdropFilter: `blur(${Math.min(g?.blur ?? 16, 6)}px) saturate(${g?.saturation ?? 1.6})` }} />
    </span>
  );
}

/** The Google Fonts stylesheet for the fonts in the list, so the font entries show in their own letters. */
export const vocabFontsHref = (entries: VocabEntry[]) => {
  const families = [...new Set(entries.flatMap((e) => (e.kind === "font" || e.kind === "look") && e.art.font ? [e.art.font] : []))];
  return families.length ? `https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;600`).join("&")}&display=swap` : null;
};

/** The entries that match what was typed, best first; everything (in kind order) when nothing was typed. */
export function matchVocab(entries: VocabEntry[], query: string) {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const score = (e: VocabEntry) => {
    if (!words.length) return 1;
    const name = e.name.toLowerCase();
    let total = 0;
    for (const w of words) {
      const s = name.startsWith(w) ? 4 : name.split(/\s+/).some((n) => n.startsWith(w)) ? 3 : e.aliases.some((a) => a.startsWith(w)) ? 3 : name.includes(w) || e.aliases.some((a) => a.includes(w)) ? 2 : e.hint.toLowerCase().includes(w) ? 1 : 0;
      if (!s) return 0;
      total += s;
    }
    return total;
  };
  return entries.map((e, i) => ({ e, s: score(e), i })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || KIND_ORDER.indexOf(a.e.kind) - KIND_ORDER.indexOf(b.e.kind) || a.i - b.i).map((x) => x.e);
}

/** A picked entry as a small removable chip (or a plain one in a sent message). */
export function VocabChip({ entry, onRemove }: { entry: Pick<VocabEntry, "name" | "kind"> & Partial<VocabEntry>; onRemove?: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background py-0.5 pr-1 pl-1 text-xs">
      {entry.art && <VocabArt entry={entry as VocabEntry} className="size-5 rounded-full [&_svg]:size-3 text-[9px]" />}
      <span className="truncate">{entry.name}</span>
      <span className="text-muted-foreground">{KIND_LABELS[entry.kind].replace(/s$/, "").toLowerCase()}</span>
      {onRemove ? <button type="button" aria-label={`Remove ${entry.name}`} onClick={onRemove} className="grid size-5 place-items-center rounded-full hover:bg-muted"><X className="size-3" /></button> : <span className="w-1" />}
    </span>
  );
}

type ListProps = { matches: VocabEntry[]; active: number; onActive: (i: number) => void; onPick: (e: VocabEntry) => void; id: string; grouped?: boolean };

/** The list under a "/" or in the Add panel: an illustration, the name, a hint, and whether it is already in use. */
export function VocabList({ matches, active, onActive, onPick, id, grouped = false }: ListProps) {
  let lastKind: VocabKind | null = null;
  return (
    <ul id={id} role="listbox" aria-label="Components and styles" className="flex max-h-72 flex-col overflow-y-auto p-1">
      {matches.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">Nothing by that name. Send the message and Claude will work it out.</li>}
      {matches.map((e, i) => {
        const header = grouped && e.kind !== lastKind ? KIND_LABELS[e.kind] : null;
        lastKind = e.kind;
        return (
          <li key={e.id} className="contents">
            {header && <span aria-hidden="true" className="px-2 pt-2 pb-0.5 text-[11px] font-medium text-muted-foreground first:pt-1">{header}</span>}
            <button type="button" role="option" id={`${id}-${i}`} aria-selected={i === active} onMouseEnter={() => onActive(i)} onMouseDown={(ev) => ev.preventDefault()} onClick={() => onPick(e)}
              className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${i === active ? "bg-muted" : ""}`}>
              <VocabArt entry={e} />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-sm font-medium">{e.name}{e.inSystem ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">in your system</span> : e.current ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">current</span> : null}</span>
                <span className="truncate text-xs text-muted-foreground">{e.hint}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
