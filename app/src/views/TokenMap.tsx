// The Style step's map of every token (PRD 下一版 item 20): base values (the ones in use; all on request), your colors
// and other shared settings, and the components that use them, in three columns joined by faint lines. Click
// anything and its whole chain lights up (what it points at, what uses it) while the rest fades. On the right, where
// it is used: the real components (the page of every component, narrowed to the ones that use it, the parts
// outlined), and below that the edit panel to change it. Quick picks (main color, grays, corners, fonts) open from
// the top of the map.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type ChangeResult, type State, type StoryEntry, type TokenRow } from "@/lib/api";
import type { Kind as PickKind, Pick } from "@/lib/inspect";
import { componentLabel, familyName, FONT_ROLE_NAMES, partName, roleName, textPartName, textStyleName } from "@/lib/plain";
import { chainDown, componentOf, dependents, remindersByToken, targetIn, valueIn, type Graph, type Mode } from "@/lib/tokens";
import { EditPanel } from "@/views/EditPanel";
import { ModeSwitch } from "@/views/ModeSwitch";

type Tab = "colors" | "text" | "corners" | "effects";
export type QuickKind = "look" | "main" | "gray" | "corners" | "fonts";
const TABS: [Tab, string][] = [["colors", "Colors"], ["text", "Text"], ["corners", "Corners"], ["effects", "Effects"]];
// Looks (a whole style in one pick) sit on every tab; the others belong to one kind of token.
const QUICK: Record<Tab, QuickKind[]> = { colors: ["look", "main", "gray"], text: ["look", "fonts"], corners: ["look", "corners"], effects: ["look"] };
const isRadius = (r: TokenRow) => r.type === "dimension" && (/^radius/.test(r.name) || /radius$/.test(r.name));
const tabOf = (r: TokenRow): Tab => (r.type === "color" ? "colors" : r.type === "typography" || r.type === "fontFamily" || r.type === "fontWeight" ? "text" : isRadius(r) || r.path === "radius/fit-inside" ? "corners" : "effects");
const COLUMN: Record<string, Record<Tab, string>> = {
  primitives: { colors: "Base colors", text: "Fonts", corners: "Corner steps", effects: "Base values" },
  semantic: { colors: "Your colors", text: "Fonts and text styles", corners: "Corner settings", effects: "Shared settings" },
  components: { colors: "Components", text: "Components", corners: "Components", effects: "Components" },
};
const CORNER_ROLES: Record<string, string> = { control: "Controls", container: "Containers", pill: "Pills", small: "Small marks", "fit-inside": "Parts inside fit their container" };
const COLOR_PREFIXES = ["bg", "text", "border", "ring", "outline", "fill", "stroke", "from", "via", "to", "placeholder", "decoration", "accent", "caret", "divide"];
const group = (id: string) => `group:${id}`;
/** Your settings that come as a set and stay folded in the map: the chart colors (22 of them). */
const SETS: Record<string, string> = { chart: "Chart colors" };
const setOf = (r: TokenRow) => (r.layerId !== "primitives" && r.path.startsWith("color/chart/") ? "chart" : null);

type Props = {
  state: State; g: Graph; brand: string; mode: "light" | "dark"; onMode: (m: "light" | "dark") => void; catalog?: { id: string; name: string }[];
  /** The quick pick panels (StyleView's), and the label of each button. */
  quick: (k: QuickKind) => ReactNode; quickLabel: (k: QuickKind) => string;
  /** What shows on the right while nothing is selected (things to look at). */
  idle: ReactNode;
  onChanged: (r: Partial<ChangeResult> & { unchanged?: boolean; message?: string }, fallback: string) => void; onError: (m: string) => void; onAsk: (text: string) => void;
};

export function TokenMap({ state, g, brand, mode, onMode, catalog, quick, quickLabel, idle, onChanged, onError, onAsk }: Props) {
  const tmode: Mode = mode === "dark" ? "dark" : "default";
  const [tab, setTab] = useState<Tab>("colors");
  const [sel, setSel] = useState<string | null>(null);
  const [allBase, setAllBase] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [quickOpen, setQuickOpen] = useState<QuickKind | null>(null);
  const reminders = useMemo(() => remindersByToken(state, brand, tmode), [state, brand, tmode]);

  // ---- names ----
  const nameOf = useCallback((r: TokenRow): string => {
    const comp = componentOf(r);
    if (comp) return `${componentLabel(comp, catalog)} · ${r.type === "typography" ? textPartName(r.path) : partName(r.path)}`;
    if (r.layerId === "primitives") { const [grp, a, b] = r.path.split("/"); return grp === "color" ? `${familyName(a)}${b ? ` ${b}` : ""}` : `${a ?? grp}${b ? ` ${b}` : ""}`; }
    if (r.type === "typography" && r.path.startsWith("typography/")) return textStyleName(r.path);
    if (r.type === "fontFamily" && r.path.startsWith("font/")) { const k = r.path.split("/")[1]; return `${FONT_ROLE_NAMES[k] ?? ({ sans: "Text", mono: "Code" } as Record<string, string>)[k] ?? k} font`; }
    if (r.path.startsWith("radius/")) return CORNER_ROLES[r.path.split("/")[1]] ?? roleName(r.name);
    return roleName(r.name);
  }, [catalog]);
  const typeText = (css: string) => {
    const m = /^(\d+)\s+([\d.]+)(rem|px)(?:\/([\d.]+\w*))?\s+var\(--(\w+)-font\)/.exec(css);
    return m ? `${Math.round(Number(m[2]) * (m[3] === "rem" ? 16 : 1))}px, weight ${m[1]}, ${FONT_ROLE_NAMES[m[5]] ?? m[5]} font` : css;
  };
  const valueText = (r: TokenRow) => {
    const v = valueIn(r, tmode), t = targetIn(g, r, tmode);
    if (t) return `→ ${nameOf(t)}`;
    if (r.type === "typography") return typeText(v?.css ?? "");
    return String(v?.resolved ?? v?.css ?? v?.raw ?? "");
  };

  // ---- what the map shows ----
  const rows = g.rows.filter((r) => tabOf(r) === tab);
  const layers = g.layers.length ? g.layers : [{ id: "primitives", name: "Palette" }, { id: "semantic", name: "Semantic" }, { id: "components", name: "Components" }];
  const used = (r: TokenRow) => (g.users.get(r.path) ?? []).length > 0;
  const selected = sel && !sel.startsWith("group:") && !sel.startsWith("set:") ? g.byKey.get(sel) ?? null : null;
  const selectedGroup = sel?.startsWith("group:") ? sel.slice(6) : null;
  const selectedSet = sel?.startsWith("set:") ? sel.slice(4) : null;
  // The rows a selection stands for: a token, a component's parts, or a set of your settings.
  const members = useMemo(() => (selectedGroup ? g.rows.filter((r) => componentOf(r) === selectedGroup && tabOf(r) === tab)
    : selectedSet ? g.rows.filter((r) => setOf(r) === selectedSet) : []), [g, selectedGroup, selectedSet, tab]);
  const related = useMemo(() => {
    const out = new Set<string>();
    const add = (r: TokenRow) => { for (const x of [...chainDown(g, r, tmode), ...dependents(g, r.path)]) out.add(x.path); };
    if (selected) add(selected);
    for (const r of members) { out.add(r.path); add(r); }
    return out;
  }, [g, selected, members, tmode]);
  const columns = layers.map((l) => ({ id: l.id, title: COLUMN[l.id]?.[tab] ?? l.name, rows: rows.filter((r) => (r.layerId ?? "semantic") === l.id) })).filter((c) => c.rows.length || c.id === "primitives");
  const visibleBase = (r: TokenRow) => allBase || used(r) || related.has(r.path);
  const groupsOf = (list: TokenRow[]) => {
    const by = new Map<string, TokenRow[]>();
    for (const r of list) { const c = componentOf(r) ?? "other"; by.set(c, [...(by.get(c) ?? []), r]); }
    return [...by].sort(([a], [b]) => componentLabel(a, catalog).localeCompare(componentLabel(b, catalog)));
  };
  const isOpen = (c: string) => open.has(c) || selectedGroup === c;
  /** The node a token is drawn as: itself, or its group (a component, the chart colors) while that is closed. */
  const nodeOf = (r: TokenRow) => {
    const c = componentOf(r);
    if (c) return isOpen(c) ? r.path : group(c);
    const s = setOf(r);
    return s && !isOpen(`set:${s}`) ? `set:${s}` : r.path;
  };
  const lit = (key: string) => key === sel || related.has(key)
    || (key.startsWith("group:") && (selectedGroup === key.slice(6) || [...related].some((k) => componentOf(g.byKey.get(k) ?? ({} as TokenRow)) === key.slice(6))))
    || (key.startsWith("set:") && [...related].some((k) => { const r = g.byKey.get(k); return r ? `set:${setOf(r)}` === key : false; }));

  // ---- lines: measured from the nodes after each render ----
  const box = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const reg = (key: string) => (el: HTMLElement | null) => { if (el) nodes.current.set(key, el); else nodes.current.delete(key); };
  const [lines, setLines] = useState<{ d: string; on: boolean; key: string }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const edges = useMemo(() => {
    const out = new Map<string, [string, string]>();
    for (const r of rows) for (const ref of r.refs ?? []) {
      const t = g.byKey.get(ref);
      if (!t || tabOf(t) !== tab) continue;
      const a = nodeOf(t), b = nodeOf(r);
      if (a !== b) out.set(`${a}>${b}`, [a, b]);
    }
    return [...out.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, tab, open, selectedGroup]);
  const measure = useCallback(() => {
    const c = box.current;
    if (!c) return;
    const base = c.getBoundingClientRect();
    const at = (k: string) => { const el = nodes.current.get(k); if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left - base.left, r: r.right - base.left, y: r.top - base.top + r.height / 2 }; };
    const out: { d: string; on: boolean; key: string }[] = [];
    for (const [a, b] of edges) {
      const p = at(a), q = at(b);
      if (!p || !q) continue;
      const on = lit(a) && lit(b);
      if (q.l > p.r - 4) { const m = (p.r + q.l) / 2; out.push({ key: `${a}>${b}`, on, d: `M${p.r} ${p.y} C${m} ${p.y} ${m} ${q.y} ${q.l} ${q.y}` }); }
      else { const x = Math.max(p.r, q.r) + 18; out.push({ key: `${a}>${b}`, on, d: `M${p.r} ${p.y} C${x} ${p.y} ${x} ${q.y} ${q.r} ${q.y}` }); }
    }
    setLines(out);
    setSize({ w: c.scrollWidth, h: c.scrollHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, sel, related]);
  useLayoutEffect(() => { measure(); }, [measure, tab, allBase, quickOpen, state.rev]);
  useEffect(() => {
    const c = box.current;
    if (!c) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(c);
    return () => ro.disconnect();
  }, [measure]);

  const pick = (key: string) => setSel(sel === key ? null : key);
  const warn = (r: TokenRow) => (reminders.get(r.name) ?? []).some((x) => x.kind === "contrast" || x.kind === "distinct");
  const fade = (key: string) => (sel && !lit(key) ? "opacity-40" : "");
  const node = (r: TokenRow, label = nameOf(r)) => {
    const on = sel === r.path, rel = !on && related.has(r.path);
    const v = valueIn(r, tmode);
    return (
      <button key={r.path} ref={reg(r.path)} type="button" aria-pressed={on} onClick={() => pick(r.path)}
        className={`relative flex min-h-9 w-full items-center gap-2 rounded-lg border bg-background px-2 py-1 text-left ${on ? "border-info ring-2 ring-info" : rel ? "border-info/60 bg-info/10" : "hover:bg-muted"} ${fade(r.path)}`}>
        {r.type === "color" ? <span className="size-4 flex-none rounded border" style={{ background: v?.resolved ?? undefined }} />
          : isRadius(r) ? <span aria-hidden="true" className="block size-4 flex-none border-t-2 border-l-2 border-foreground" style={{ borderTopLeftRadius: Math.min(parseFloat(v?.resolved ?? "0") * (/rem$/.test(v?.resolved ?? "") ? 16 : 1) || 0, 12) }} />
          : r.type === "typography" || r.type === "fontFamily" ? <span aria-hidden="true" className="w-4 flex-none text-center text-xs font-semibold">Aa</span> : null}
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[12px] font-semibold">{label}</span>
          <span className="truncate text-[10.5px] text-muted-foreground">{valueText(r)}</span>
        </span>
        {warn(r) && <span title="Something to look at" className="size-2 flex-none rounded-full bg-warning" />}
      </button>
    );
  };

  const baseColumn = (list: TokenRow[]) => {
    if (tab !== "colors") return <div className="flex flex-col gap-1">{list.filter(visibleBase).map((r) => node(r))}</div>;
    const families = new Map<string, TokenRow[]>();
    for (const r of list) if (visibleBase(r)) { const f = r.path.split("/")[1]; families.set(f, [...(families.get(f) ?? []), r]); }
    // Families in the order of the first of your colors that uses them, so the lines cross less.
    const order = new Map(rows.filter((r) => r.layerId !== "primitives" && !componentOf(r)).map((r, i) => [r.path, i]));
    const rank = (steps: TokenRow[]) => Math.min(...steps.flatMap((s) => (g.users.get(s.path) ?? []).map((u) => order.get(u) ?? 1e6)), 1e6);
    return (
      <div className="flex flex-col gap-1.5">
        {[...families].sort(([, a], [, b]) => rank(a) - rank(b)).map(([f, steps]) => (
          <div key={f} className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-muted-foreground">{familyName(f)}</span>
            <div className="flex flex-wrap gap-1">
              {steps.map((r) => {
                const on = sel === r.path, rel = !on && related.has(r.path);
                return <button key={r.path} ref={reg(r.path)} type="button" aria-pressed={on} title={nameOf(r)} aria-label={nameOf(r)} onClick={() => pick(r.path)}
                  className={`size-6 rounded border border-foreground/10 ${on ? "ring-2 ring-info ring-offset-1 ring-offset-background" : rel ? "ring-2 ring-info/60" : ""} ${fade(r.path)}`} style={{ background: valueIn(r, tmode)?.resolved ?? undefined }} />;
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };
  // Your settings: one node each, and the sets (chart colors) folded into one node until opened.
  const settingsColumn = (list: TokenRow[]) => {
    const sets = new Map<string, TokenRow[]>();
    for (const r of list) { const s = setOf(r); if (s) sets.set(s, [...(sets.get(s) ?? []), r]); }
    return (
      <div className="flex flex-col gap-1">
        {list.filter((r) => !setOf(r)).map((r) => node(r))}
        {[...sets].map(([s, members]) => {
          const k = `set:${s}`, opened = isOpen(k), on = sel === k;
          return (
            <div key={k} className="flex flex-col gap-1">
              <button ref={reg(k)} type="button" aria-expanded={opened} aria-pressed={on} onClick={() => { setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; }); pick(k); }}
                className={`flex min-h-9 w-full items-center gap-2 rounded-lg border bg-background px-2 text-left text-[12px] ${on ? "border-info ring-2 ring-info" : lit(k) && sel ? "border-info/60 bg-info/10" : "hover:bg-muted"} ${fade(k)}`}>
                <span aria-hidden="true" className="w-3 text-muted-foreground">{opened ? "▾" : "▸"}</span>
                <span className="flex-1 truncate font-semibold">{SETS[s] ?? s}</span>
                <span className="flex -space-x-1">{members.slice(0, 6).map((r) => <span key={r.path} className="size-3 rounded-full border border-background" style={{ background: valueIn(r, tmode)?.resolved ?? undefined }} />)}</span>
                <span className="text-[11px] text-muted-foreground">{members.length}</span>
              </button>
              {opened && <div className="ml-3 flex flex-col gap-1">{members.map((r) => node(r))}</div>}
            </div>
          );
        })}
      </div>
    );
  };
  const componentColumn = (list: TokenRow[]) => (
    <div className="flex flex-col gap-1">
      {groupsOf(list).map(([c, parts]) => {
        const k = group(c), opened = isOpen(c), on = sel === k;
        return (
          <div key={c} className="flex flex-col gap-1">
            <button ref={reg(k)} type="button" aria-expanded={opened} aria-pressed={on} onClick={() => { setOpen((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; }); pick(k); }}
              className={`flex min-h-9 w-full items-center gap-2 rounded-lg border bg-background px-2 text-left text-[12px] ${on ? "border-info ring-2 ring-info" : lit(k) && sel ? "border-info/60 bg-info/10" : "hover:bg-muted"} ${fade(k)}`}>
              <span aria-hidden="true" className="w-3 text-muted-foreground">{opened ? "▾" : "▸"}</span>
              <span className="flex-1 truncate font-semibold">{componentLabel(c, catalog)}</span>
              {tab === "colors" && <span className="flex -space-x-1">{parts.slice(0, 4).map((r) => <span key={r.path} className="size-3 rounded-full border border-background" style={{ background: valueIn(r, tmode)?.resolved ?? undefined }} />)}</span>}
              <span className="text-[11px] text-muted-foreground">{parts.length}</span>
            </button>
            {opened && <div className="ml-3 flex flex-col gap-1">{parts.map((r) => node(r, r.type === "typography" ? textPartName(r.path) : partName(r.path)))}</div>}
          </div>
        );
      })}
    </div>
  );

  // ---- the right side: where it is used, then change it ----
  const pickOf = (r: TokenRow): Pick | null => {
    const kind: PickKind | null = r.type === "color" ? "color" : isRadius(r) ? "radius" : r.type === "typography" && componentOf(r) ? "text" : null;
    if (!kind || r.layerId === "primitives" || r.fit?.on) return null;
    return { row: r, prop: kind === "color" ? "Color" : kind === "radius" ? "Corners" : "Text style", kind, state: null };
  };
  const usedParts = useMemo(() => {
    if (selectedGroup) return members;
    if (selectedSet) return [...new Set(members.flatMap((m) => dependents(g, m.path).filter((r) => componentOf(r))))];
    if (!selected) return [];
    return componentOf(selected) ? [selected] : dependents(g, selected.path).filter((r) => componentOf(r));
  }, [g, selected, selectedGroup, selectedSet, members]);
  const focus = useMemo(() => {
    if (!sel) return { sheets: null as string[] | null, classes: [] as string[] };
    const classes = new Set<string>();
    const add = (r: TokenRow) => {
      if (r.type === "color") for (const p of COLOR_PREFIXES) classes.add(`${p}-${r.name}`);
      else if (isRadius(r)) classes.add(`rounded-${r.name.replace(/^radius-/, "").replace(/-radius$/, "")}`);
      else if (r.type === "typography") classes.add(`type-${r.name.replace(/-font$/, "")}`);
    };
    usedParts.forEach(add);
    if (selected && !componentOf(selected) && selected.layerId !== "primitives") add(selected);
    return { sheets: [...new Set(usedParts.map((r) => componentOf(r)!).filter(Boolean))], classes: [...classes] };
  }, [sel, usedParts, selected]);
  const panelPick = selected ? pickOf(selected) : null;
  const selectionName = selected ? nameOf(selected) : selectedGroup ? componentLabel(selectedGroup, catalog) : selectedSet ? SETS[selectedSet] ?? selectedSet : "";

  return (
    <section aria-label="Everything in your style" className="flex flex-col gap-3 rounded-2xl border bg-background p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-base font-semibold">Everything in your style</h2><p className="text-sm text-muted-foreground">Every token you plan to use and how they connect: base values, your settings, and the components that use them. Click one to light up everything it touches.</p></div>
        <ModeSwitch mode={mode} onMode={onMode} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Kind" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setSel(null); setQuickOpen(null); }} className={`min-h-9 rounded-md px-3.5 text-sm font-medium ${tab === id ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{label}</button>)}
        </div>
        {QUICK[tab].map((k) => (
          <button key={k} type="button" aria-expanded={quickOpen === k} onClick={() => setQuickOpen(quickOpen === k ? null : k)} className={`min-h-9 rounded-full border-2 px-3 text-sm font-medium ${quickOpen === k ? "border-foreground" : "border-border"}`}>{quickLabel(k)} ▾</button>
        ))}
      </div>
      {quickOpen && <div className="rounded-xl border bg-muted/30 p-4">{quick(quickOpen)}</div>}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
        <div ref={box} className="relative grid grid-cols-3 gap-x-8 gap-y-2 overflow-x-auto rounded-xl border bg-muted/20 p-3">
          <svg aria-hidden="true" width={size.w} height={size.h} className="pointer-events-none absolute inset-0">
            {lines.filter((l) => !l.on).map((l) => <path key={l.key} d={l.d} fill="none" stroke="var(--muted-foreground)" strokeOpacity={sel ? 0.1 : 0.28} strokeWidth="1" />)}
            {lines.filter((l) => l.on).map((l) => <path key={l.key} d={l.d} fill="none" stroke="var(--info)" strokeWidth="2" />)}
          </svg>
          {columns.map((c) => (
            <div key={c.id} className="relative flex min-w-0 flex-col gap-2">
              <div className="flex items-center justify-between gap-1">
                <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{c.title}</h3>
                {c.id === "primitives" && <button type="button" onClick={() => setAllBase(!allBase)} className="text-[11px] font-medium text-info underline underline-offset-2">{allBase ? "In use" : `All ${c.rows.length}`}</button>}
              </div>
              {c.id === "primitives" ? baseColumn(c.rows) : c.id === "components" ? componentColumn(c.rows) : settingsColumn(c.rows)}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 xl:sticky xl:top-0">
          <UsageView state={state} brand={brand} mode={mode} focus={focus} title={sel ? selectionName : null} parts={usedParts.map((r) => nameOf(r))} />
          {!sel ? idle : selected && panelPick ? (
            <EditPanel key={selected.path} state={state} g={g} brand={brand} mode={tmode} sel={{ title: nameOf(selected), picks: [panelPick] }} onClose={() => setSel(null)} onChanged={onChanged} onError={onError} onAsk={onAsk} />
          ) : (
            <div className="flex flex-col gap-2 rounded-xl border-2 border-info/50 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="font-semibold">{selectionName}</h3>{selected && <p className="text-xs text-muted-foreground"><code>{selected.name}</code> · {valueText(selected)}</p>}</div>
                <button type="button" onClick={() => setSel(null)} className="min-h-9 rounded-lg border px-3 font-medium">Done</button>
              </div>
              <p className="text-muted-foreground">{selectedGroup ? "Its parts are open in the map: click one to change it, or change the component in Components." : selectedSet ? `Open it in the map to see each one. ${SETS[selectedSet] ?? ""} are made from your main color: change them in Chart colors below.` : selected?.layerId === "primitives" ? "Base values don't change. To use another one, change the setting that points at it." : selected?.fit?.on ? "It fits inside its container's corners: change those, or turn off Fit its corners." : selected?.type === "fontFamily" ? "Change fonts with the Fonts button above." : "Change it by telling Claude."}</p>
              {selected && selected.layerId !== "primitives" && <button type="button" onClick={() => onAsk(`Change ${nameOf(selected)} (${selected.name}): `)} className="min-h-9 self-start rounded-lg border px-3 font-medium">Ask Claude about it</button>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Where a token is used: the real components (the page of every component, narrowed), or a list without a preview. */
function UsageView({ state, brand, mode, focus, title, parts }: { state: State; brand: string; mode: "light" | "dark"; focus: { sheets: string[] | null; classes: string[] }; title: string | null; parts: string[] }) {
  const [entries, setEntries] = useState<StoryEntry[]>([]);
  // Read again until the page of every component is there (a Storybook that just started has no index yet).
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!state.storybook) return;
    let off = false;
    api.storyIndex().then((r) => { if (!off) setEntries(r.entries); }).catch(() => {});
    return () => { off = true; };
  }, [state.storybook, state.rev, tries]);
  const missing = Boolean(state.storybook) && !entries.some((e) => e.importPath.includes("/foundations/sticker-sheet"));
  useEffect(() => { if (!missing || tries > 20) return; const t = window.setTimeout(() => setTries((n) => n + 1), 3000); return () => window.clearTimeout(t); }, [missing, tries]);
  const sheet = entries.find((e) => e.type === "story" && e.importPath.includes("/foundations/sticker-sheet"));
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(0);
  const origin = state.storybook ? new URL(state.storybook).origin : null;
  useEffect(() => {
    if (!origin) return;
    const on = (e: MessageEvent) => { if (e.origin === origin && e.data?.source === "plinth-inspect" && e.data.type === "ready") setReady((n) => n + 1); };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [origin]);
  useEffect(() => {
    if (ready && origin) frame.current?.contentWindow?.postMessage({ source: "plinth-ui", type: "focus", sheets: focus.sheets, classes: focus.classes }, origin);
  }, [ready, origin, focus]);
  const src = state.storybook && sheet ? `${state.storybook}/iframe.html?id=${encodeURIComponent(sheet.id)}&viewMode=story&globals=${encodeURIComponent(`brand:${brand};mode:${mode}`)}&plinthInspect=${encodeURIComponent(location.origin)}` : null;
  const empty = title && focus.sheets && focus.sheets.length === 0;
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <div className="flex flex-col"><h3 className="text-sm font-semibold">{title ? `Where ${title} is used` : "Your components"}</h3>
        <p className="text-xs text-muted-foreground">{empty ? "No component uses it yet." : title ? "The real components that use it, with the parts outlined." : "Click a token on the left to see where it's used."}</p></div>
      {src ? <iframe ref={frame} title="Where it is used" src={src} className={`h-[360px] w-full rounded-lg border bg-white ${empty ? "opacity-40" : ""}`} />
        : title && parts.length ? <ul className="flex max-h-[360px] flex-col gap-0.5 overflow-y-auto text-sm">{parts.slice(0, 60).map((p) => <li key={p}>{p}</li>)}</ul>
        : <p className="text-xs text-muted-foreground">Start the preview in Components to see the real components here.</p>}
    </div>
  );
}
