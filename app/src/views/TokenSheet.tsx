// Everything in the style, every layer laid out side by side (PRD 下一版 item 19): the base values (only the ones in
// use; the whole palette when you ask for it), your colors and other shared settings, and the component parts that
// use them, grouped by component. Click anything to see what it points at and what uses it (highlighted across the
// columns), and change it in the edit panel; base values never change, things point at other ones instead.
import { useMemo, useState } from "react";
import type { ChangeResult, State, TokenRow } from "@/lib/api";
import type { Kind as PickKind, Pick } from "@/lib/inspect";
import { componentLabel, familyName, FONT_ROLE_NAMES, partName, roleName, textPartName, textStyleName } from "@/lib/plain";
import { chainDown, componentOf, dependents, remindersByToken, targetIn, valueIn, type Graph, type Mode } from "@/lib/tokens";
import { EditPanel } from "@/views/EditPanel";
import { ModeSwitch } from "@/views/ModeSwitch";
import { PaletteGrid } from "@/views/NodeGraph";

type Tab = "colors" | "text" | "corners" | "effects";
const TABS: [Tab, string][] = [["colors", "Colors"], ["text", "Text"], ["corners", "Corners"], ["effects", "Effects"]];
const isRadius = (r: TokenRow) => r.type === "dimension" && (/^radius/.test(r.name) || /radius$/.test(r.name));
const tabOf = (r: TokenRow): Tab => (r.type === "color" ? "colors" : r.type === "typography" || r.type === "fontFamily" || r.type === "fontWeight" ? "text" : isRadius(r) || r.path === "radius/fit-inside" ? "corners" : "effects");
const COLUMN: Record<string, Record<Tab, string>> = {
  primitives: { colors: "Base colors", text: "Fonts", corners: "Corner steps", effects: "Base values" },
  semantic: { colors: "Your colors", text: "Fonts and text styles", corners: "Corner settings", effects: "Shared settings" },
  components: { colors: "In components", text: "In components", corners: "In components", effects: "In components" },
};
const CORNER_ROLES: Record<string, string> = { control: "Controls", container: "Containers", pill: "Pills", small: "Small marks", "fit-inside": "Parts inside fit their container" };

type Props = {
  state: State; g: Graph; brand: string; mode: "light" | "dark"; onMode: (m: "light" | "dark") => void; catalog?: { id: string; name: string }[];
  onChanged: (r: Partial<ChangeResult> & { unchanged?: boolean; message?: string }, fallback: string) => void; onError: (m: string) => void; onAsk: (text: string) => void;
};

export function TokenSheet({ state, g, brand, mode, onMode, catalog, onChanged, onError, onAsk }: Props) {
  const tmode: Mode = mode === "dark" ? "dark" : "default";
  const [tab, setTab] = useState<Tab>("colors");
  const [sel, setSel] = useState<string | null>(null);
  const [allBase, setAllBase] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const reminders = useMemo(() => remindersByToken(state, brand, tmode), [state, brand, tmode]);

  // Plain names: base values by family and step, your colors and corner settings by role, parts by component.
  const nameOf = (r: TokenRow): string => {
    const comp = componentOf(r);
    if (comp) return `${componentLabel(comp, catalog)} · ${r.type === "typography" ? textPartName(r.path) : partName(r.path)}`;
    if (r.layerId === "primitives") { const [group, a, b] = r.path.split("/"); return group === "color" ? `${familyName(a)}${b ? ` ${b}` : ""}` : `${a ?? group}${b ? ` ${b}` : ""}`; }
    if (r.type === "typography" && r.path.startsWith("typography/")) return textStyleName(r.path);
    if (r.type === "fontFamily" && r.path.startsWith("font/")) { const k = r.path.split("/")[1]; return `${FONT_ROLE_NAMES[k] ?? ({ sans: "Text", mono: "Code" } as Record<string, string>)[k] ?? k} font`; }
    if (r.path.startsWith("radius/")) return CORNER_ROLES[r.path.split("/")[1]] ?? roleName(r.name);
    return roleName(r.name);
  };
  // "600 2rem/1.15 var(--heading-font)" → "32px, weight 600, Headings font".
  const typeText = (css: string) => {
    const m = /^(\d+)\s+([\d.]+)(rem|px)(?:\/([\d.]+\w*))?\s+var\(--(\w+)-font\)/.exec(css);
    if (!m) return css;
    const px = Math.round(Number(m[2]) * (m[3] === "rem" ? 16 : 1));
    return `${px}px, weight ${m[1]}, ${FONT_ROLE_NAMES[m[5]] ?? m[5]} font`;
  };
  const valueText = (r: TokenRow) => {
    const v = valueIn(r, tmode);
    const t = targetIn(g, r, tmode);
    if (t) return `→ ${nameOf(t)}`;
    if (r.type === "typography") return typeText(v?.css ?? "");
    return String(v?.resolved ?? v?.css ?? v?.raw ?? "");
  };

  const rows = g.rows.filter((r) => tabOf(r) === tab);
  const layers = g.layers.length ? g.layers : [{ id: "primitives", name: "Palette" }, { id: "semantic", name: "Semantic" }, { id: "components", name: "Components" }];
  const columns = layers.map((l) => ({ id: l.id, title: COLUMN[l.id]?.[tab] ?? l.name, rows: rows.filter((r) => (r.layerId ?? "semantic") === l.id) })).filter((c) => c.rows.length || c.id === "primitives");
  const used = (r: TokenRow) => (g.users.get(r.path) ?? []).length > 0;

  const selected = sel ? g.byKey.get(sel) ?? null : null;
  const related = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set([...chainDown(g, selected, tmode), ...dependents(g, selected.path)].map((r) => r.path));
  }, [g, selected, tmode]);
  const pick = (r: TokenRow) => setSel(sel === r.path ? null : r.path);
  const warn = (r: TokenRow) => (reminders.get(r.name) ?? []).some((x) => x.kind === "contrast" || x.kind === "distinct");

  const rowButton = (r: TokenRow, label = nameOf(r)) => {
    const on = sel === r.path, rel = !on && related.has(r.path);
    const v = valueIn(r, tmode);
    const n = r.layerId !== "components" ? dependents(g, r.path).filter((d) => componentOf(d)).length : 0;
    return (
      <button key={r.path} type="button" aria-pressed={on} onClick={() => pick(r)}
        className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${on ? "bg-info/15 ring-2 ring-info" : rel ? "bg-info/10" : "hover:bg-muted"} ${selected && !on && !rel ? "opacity-55" : ""}`}>
        {r.type === "color" ? <span className="size-5 flex-none rounded-md border" style={{ background: v?.resolved ?? undefined }} />
          : isRadius(r) ? <span aria-hidden="true" className="block size-5 flex-none border-t-2 border-l-2 border-foreground" style={{ borderTopLeftRadius: Math.min(parseFloat(v?.resolved ?? "0") * (/rem$/.test(v?.resolved ?? "") ? 16 : 1) || 0, 14) }} />
          : r.type === "typography" || r.type === "fontFamily" ? <span aria-hidden="true" className="w-5 flex-none text-center text-sm font-semibold" style={{ fontFamily: r.type === "fontFamily" ? (v?.css ?? undefined) : undefined }}>Aa</span> : null}
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-semibold">{label}</span>
          <span className="truncate text-[11px] text-muted-foreground">{valueText(r)}{n ? ` · ${n} part${n > 1 ? "s" : ""}` : ""}</span>
        </span>
        {warn(r) && <span title="Something to look at" className="size-2 flex-none rounded-full bg-warning" />}
      </button>
    );
  };

  const baseColumn = (rowsHere: TokenRow[]) => {
    if (tab !== "colors") return <div className="flex flex-col">{rowsHere.filter((r) => allBase || used(r) || related.has(r.path)).map((r) => rowButton(r))}</div>;
    if (allBase) return <PaletteGrid g={g} mode={tmode} current={selected?.layerId === "primitives" ? selected : null} onPick={(c) => setSel(`color/${c.replace(".", "/")}`)} />;
    const families = new Map<string, TokenRow[]>();
    for (const r of rowsHere) if (used(r) || related.has(r.path)) { const f = r.path.split("/")[1]; families.set(f, [...(families.get(f) ?? []), r]); }
    return (
      <div className="flex flex-col gap-2">
        {[...families].map(([f, steps]) => (
          <div key={f} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{familyName(f)}</span>
            <div className="flex flex-wrap gap-1">
              {steps.map((r) => {
                const on = sel === r.path, rel = !on && related.has(r.path);
                return <button key={r.path} type="button" aria-pressed={on} title={nameOf(r)} aria-label={nameOf(r)} onClick={() => pick(r)}
                  className={`size-8 rounded-md border border-foreground/10 ${on ? "ring-2 ring-info ring-offset-1 ring-offset-background" : rel ? "ring-2 ring-info/50" : ""} ${selected && !on && !rel ? "opacity-55" : ""}`} style={{ background: valueIn(r, tmode)?.resolved ?? undefined }} />;
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const componentColumn = (rowsHere: TokenRow[]) => {
    const byComp = new Map<string, TokenRow[]>();
    for (const r of rowsHere) { const c = componentOf(r) ?? "other"; byComp.set(c, [...(byComp.get(c) ?? []), r]); }
    return (
      <div className="flex flex-col gap-1">
        {[...byComp].sort(([a], [b]) => componentLabel(a, catalog).localeCompare(componentLabel(b, catalog))).map(([c, parts]) => {
          const hot = parts.some((r) => related.has(r.path) || sel === r.path);
          const isOpen = open.has(c) || hot;
          return (
            <div key={c} className={`rounded-lg border ${hot ? "border-info/60" : ""}`}>
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; })} className="flex min-h-10 w-full items-center gap-2 px-2.5 text-left text-sm">
                <span aria-hidden="true" className="w-3 text-muted-foreground">{isOpen ? "▾" : "▸"}</span>
                <span className="flex-1 font-semibold">{componentLabel(c, catalog)}</span>
                {tab === "colors" && <span className="flex -space-x-1">{parts.slice(0, 5).map((r) => <span key={r.path} className="size-3.5 rounded-full border border-background" style={{ background: valueIn(r, tmode)?.resolved ?? undefined }} />)}</span>}
                <span className="text-xs text-muted-foreground">{parts.length}</span>
              </button>
              {isOpen && <div className="flex flex-col border-t p-1">{parts.map((r) => rowButton(r, r.type === "typography" ? textPartName(r.path) : partName(r.path)))}</div>}
            </div>
          );
        })}
      </div>
    );
  };

  // The panel: the edit panel for what can change here, else what it is and what uses it.
  const pickOf = (r: TokenRow): Pick | null => {
    const kind: PickKind | null = r.type === "color" ? "color" : isRadius(r) ? "radius" : r.type === "typography" && componentOf(r) ? "text" : null;
    if (!kind || r.layerId === "primitives" || r.fit?.on) return null;
    return { row: r, prop: kind === "color" ? "Color" : kind === "radius" ? "Corners" : "Text style", kind, state: null };
  };
  const panelPick = selected ? pickOf(selected) : null;
  const users = selected ? dependents(g, selected.path) : [];
  const userText = (list: TokenRow[]) => {
    const roles = list.filter((r) => !componentOf(r) && r.layerId !== "primitives");
    const comps = new Set(list.map(componentOf).filter(Boolean));
    return [roles.length ? `${roles.length} of your settings (${roles.slice(0, 4).map(nameOf).join(", ")}${roles.length > 4 ? ", …" : ""})` : null, comps.size ? `${comps.size} component${comps.size > 1 ? "s" : ""}` : null].filter(Boolean).join(" and ") || "nothing yet";
  };

  return (
    <section aria-label="Everything in your style" className="flex flex-col gap-3 rounded-2xl border bg-background p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-base font-semibold">Everything in your style</h2><p className="text-sm text-muted-foreground">Every layer side by side: base values, your settings, and the parts of components that use them. Click anything to see what it connects to and to change it.</p></div>
        <ModeSwitch mode={mode} onMode={onMode} />
      </div>
      <div role="tablist" aria-label="Kind" className="flex flex-wrap gap-1 self-start rounded-lg bg-muted p-1">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setSel(null); }} className={`min-h-9 rounded-md px-3.5 text-sm font-medium ${tab === id ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{label}</button>)}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {columns.map((c) => (
          <div key={c.id} className="flex min-w-0 flex-col gap-2 rounded-xl border bg-muted/30 p-2.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{c.title}</h3>
              {c.id === "primitives" && <button type="button" onClick={() => setAllBase(!allBase)} className="min-h-8 text-xs font-medium text-info underline underline-offset-2">{allBase ? "Only the ones in use" : `All ${c.rows.length}`}</button>}
            </div>
            <div className="max-h-[520px] overflow-y-auto pr-0.5">
              {c.id === "primitives" ? baseColumn(c.rows) : c.id === "components" ? componentColumn(c.rows) : <div className="flex flex-col">{c.rows.map((r) => rowButton(r))}</div>}
            </div>
          </div>
        ))}
      </div>
      {selected && (panelPick ? (
        <EditPanel key={selected.path} state={state} g={g} brand={brand} mode={tmode} sel={{ title: nameOf(selected), picks: [panelPick] }} onClose={() => setSel(null)} onChanged={onChanged} onError={onError} onAsk={onAsk} />
      ) : (
        <div className="flex flex-col gap-2 rounded-xl border-2 border-info/50 p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="font-semibold">{nameOf(selected)}</h3><p className="text-xs text-muted-foreground"><code>{selected.name}</code> · {valueText(selected)}</p></div>
            <button type="button" onClick={() => setSel(null)} className="min-h-9 rounded-lg border px-3 font-medium">Done</button>
          </div>
          <p>Used by {userText(users)}.</p>
          <p className="text-muted-foreground">{selected.layerId === "primitives" ? "Base values don't change. To use another one, change the setting that points at it." : selected.fit?.on ? "It fits inside its container's corners: change those, or turn off Fit its corners above." : selected.type === "fontFamily" ? "Change fonts with Fonts above." : "Change it by telling Claude in the chat."}</p>
          {selected.layerId !== "primitives" && <button type="button" onClick={() => onAsk(`Change ${nameOf(selected)} (${selected.name}): `)} className="min-h-9 self-start rounded-lg border px-3 font-medium">Ask Claude about it</button>}
        </div>
      ))}
    </section>
  );
}
