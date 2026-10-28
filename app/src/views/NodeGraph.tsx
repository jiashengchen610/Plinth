// How one component gets its colors: its parts → your colors (roles), as two columns joined by lines, each of your
// colors labelled with the base color it uses. Click a part, then one of your colors, to connect them. The base colors
// (the whole palette) stay out of the way until you change one of your colors: then a picker opens with the palette
// and a color wheel for a color of your own. Each is a change written at once, like any other.
import { useEffect, useMemo, useState } from "react";
import type { ChangeResult, Op, TokenRow } from "@/lib/api";
import { cssToOklch } from "@/lib/color";
import { familyName, partName, roleName, TAILWIND_FAMILIES } from "@/lib/plain";
import { componentOf, dependents, paletteHues, refOf, targetIn, valueIn, type Graph, type Mode } from "@/lib/tokens";
import { AddColor } from "@/views/AddColor";

type Props = {
  g: Graph; mode: Mode; brand: string; parts: TokenRow[]; selected: string | null; onSelect: (path: string) => void; onEdit: (title: string, ops: Op[]) => void;
  /** Point a role at a palette step ("blue.600") in the mode shown. */
  onRoleColor: (role: TokenRow, color: string, title: string) => void;
  /** A color of your own was added (and the role points at it). */
  onAdded: (r: ChangeResult & { name: string }, title: string) => void;
  onError: (m: string) => void;
};

const ROW = 52, TOP = 30, NODE = 44;
const STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const COL = { a: { x: 0, w: 200 }, b: { x: 250, w: 240 } };
const curve = (x1: number, y1: number, x2: number, y2: number) => { const m = (x1 + x2) / 2; return `M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2} `; };
const mid = (i: number) => TOP + i * ROW + NODE / 2;
const swatch = (t: TokenRow | null | undefined, mode: Mode) => (t ? valueIn(t, mode)?.resolved ?? "transparent" : "transparent");
/** "color/blue/600" → "Blue 600", "color/white" → "White". */
const baseName = (b: TokenRow | null | undefined) => { if (!b) return null; const [, hue, step] = b.path.split("/"); return `${familyName(hue)}${step ? ` ${step}` : ""}`; };

export function NodeGraph({ g, mode, brand, parts, selected, onSelect, onEdit, onRoleColor, onAdded, onError }: Props) {
  const [picking, setPicking] = useState<"palette" | "custom" | null>(null);
  // Chart colors are a set of their own (Style → Chart colors), not parts' colors.
  const roles = useMemo(() => g.rows.filter((r) => r.layerId === "semantic" && r.type === "color" && r.source.startsWith("brands/") && !r.path.startsWith("color/chart/")), [g]);
  const part = parts.find((p) => p.path === selected) ?? parts[0];
  const roleOf = (p: TokenRow) => { const t = targetIn(g, p, mode); return t && t.layerId === "semantic" ? t : null; };
  const curRole = part ? roleOf(part) : null;
  // A different part, color or mode closes the picker.
  useEffect(() => setPicking(null), [part?.path, curRole?.path, mode]);
  if (!part) return <p className="text-sm text-muted-foreground">This component has no colors of its own.</p>;

  const baseOf = (r: TokenRow) => targetIn(g, r, mode);
  const curBase = curRole ? baseOf(curRole) : null;
  const used = new Set(parts.map((p) => roleOf(p)?.path).filter(Boolean));
  let hl = "", comp = "";
  parts.forEach((p, i) => {
    const r = roleOf(p);
    const j = r ? roles.indexOf(r) : -1;
    if (j < 0) return;
    const d = curve(COL.a.x + COL.a.w, mid(i), COL.b.x, mid(j));
    if (p === part) hl += d; else comp += d;
  });
  const w = COL.b.x + COL.b.w;
  const h = TOP + Math.max(parts.length, roles.length) * ROW;

  // Re-linking a part to a role: the part's light value, and its dark value too when it differs (both follow the role).
  const connect = (role: TokenRow) => {
    if (role === curRole) { setPicking(picking ? null : "palette"); return; }
    const v = refOf(role.path);
    const ops: Op[] = [{ op: "set", file: part.source, path: part.path, value: v }];
    const dark = part.values.dark;
    if (dark && dark.raw !== part.values.default?.raw) ops.push({ op: "set", file: part.source, path: part.path, mode: "dark", value: v });
    onEdit(`${partName(part.path)}: ${curRole ? roleName(curRole.name) : "fixed color"} → ${roleName(role.name)}`, ops);
  };
  const shared = curRole ? new Set(dependents(g, curRole.path).map(componentOf).filter(Boolean)).size : 0;
  const reach = shared > 2 ? `It changes in all ${shared} components that use it.` : shared === 2 ? "It changes in both components that use it." : "Only this component uses it.";
  const dark = mode === "dark" ? " in dark mode" : "";

  const node = "absolute flex h-11 items-center gap-2 rounded-[10px] bg-background px-2.5 text-left";
  const mono = "truncate font-mono text-[11px] text-muted-foreground";
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-muted/40">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background/60 px-4 py-2.5 text-sm">
        {curRole ? <>
          <span className="flex-[1_1_260px]"><strong>{partName(part.path)}</strong> uses <strong>{roleName(curRole.name)}</strong>{curBase ? ` (${baseName(curBase)})` : ""}{dark}. Click another of your colors to connect it instead.</span>
          <button type="button" aria-expanded={!!picking} onClick={() => setPicking(picking ? null : "palette")} className="min-h-10 rounded-lg border bg-background px-3 font-medium">{picking ? "Close" : `Change ${roleName(curRole.name)}`}</button>
        </> : <span>{partName(part.path)} has a fixed color. Connect it to one of your colors first, then you can change that color.</span>}
      </div>
      {picking && curRole && (
        <section aria-label={`Change ${roleName(curRole.name)}`} className="flex flex-col gap-3 border-b bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm"><strong>Change {roleName(curRole.name)}{dark}.</strong> {reach}</p>
            <div role="tablist" aria-label="Pick from" className="flex gap-1 rounded-lg bg-muted p-1">
              {([["palette", "Your palette"], ["custom", "Any color"]] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={picking === id} onClick={() => setPicking(id)} className={`min-h-9 rounded-md px-3 text-sm font-medium ${picking === id ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{label}</button>
              ))}
            </div>
          </div>
          {picking === "palette" ? <PaletteGrid g={g} mode={mode} current={curBase} onPick={(color, name) => onRoleColor(curRole, color, `${roleName(curRole.name)}: ${name}${dark}`)} />
            : <AddColor key={`${curRole.path}:${mode}`} initial={cssToOklch(swatch(curRole, mode))} use={{ brand, role: curRole.path.replace(/^color\//, ""), mode, label: roleName(curRole.name), title: `${roleName(curRole.name)}${dark}: new color` }}
              hint="Plinth makes lighter and darker versions of it and adds them to your palette, then points this color at the one you picked."
              onAdded={(r) => onAdded(r, `${roleName(curRole.name)}: new color ${r.name}${dark}`)} onError={onError} />}
        </section>
      )}
      <div className="overflow-x-auto">
        <div className="relative m-4" style={{ width: w, height: h }}>
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="absolute inset-0">
            <path d={comp || "M0 0"} fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" />
            <path d={hl || "M0 0"} fill="none" stroke="var(--info)" strokeWidth="2.5" />
          </svg>
          {[["Parts", COL.a.x], ["Your colors", COL.b.x]].map(([t, x]) => (
            <span key={t as string} className="absolute top-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase" style={{ left: x as number }}>{t}</span>
          ))}
          {parts.map((p, i) => {
            const on = p === part;
            return (
              <button key={p.path} type="button" aria-pressed={on} onClick={() => onSelect(p.path)} className={`${node} ${on ? "border-2 border-info bg-info/10" : "border"}`} style={{ left: COL.a.x, top: TOP + i * ROW, width: COL.a.w }}>
                <span className="size-5 flex-none rounded-md border" style={{ background: swatch(p, mode) }} />
                <span className="flex min-w-0 flex-col leading-tight"><span className="truncate text-[13px] font-semibold">{partName(p.path)}</span><span className={mono}>{p.name}</span></span>
              </button>
            );
          })}
          {roles.map((r, j) => {
            const on = r === curRole;
            const base = baseName(baseOf(r));
            return (
              <button key={r.path} type="button" aria-pressed={on} aria-expanded={on ? !!picking : undefined} onClick={() => connect(r)} title={on ? `Change ${roleName(r.name)}` : `Connect ${partName(part.path)} to ${roleName(r.name)}`}
                className={`${node} ${on ? "border-2 border-info bg-info/10" : used.has(r.path) ? "border border-muted-foreground" : "border"}`} style={{ left: COL.b.x, top: TOP + j * ROW, width: COL.b.w }}>
                <span className="size-5 flex-none rounded-full border" style={{ background: swatch(r, mode) }} />
                <span className="flex min-w-0 flex-1 flex-col leading-tight"><span className={`truncate text-[13px] font-semibold ${used.has(r.path) || on ? "" : "text-muted-foreground"}`}>{roleName(r.name)}</span><span className={mono}>{r.name}</span></span>
                {base && <span className="flex-none text-[11px] text-muted-foreground">{base}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** The whole palette, one row per color: your own colors first, then Tailwind's, then white and black. */
function PaletteGrid({ g, mode, current, onPick }: { g: Graph; mode: Mode; current: TokenRow | null; onPick: (color: string, name: string) => void }) {
  const rows = useMemo(() => {
    const hues = paletteHues(g);
    const scales = hues.filter((h) => h.steps.length > 1);
    const singles = hues.filter((h) => h.steps.length === 1);
    return [...scales.filter((h) => !TAILWIND_FAMILIES.has(h.hue)), ...scales.filter((h) => TAILWIND_FAMILIES.has(h.hue)), ...singles];
  }, [g]);
  return (
    <div className="flex max-h-[420px] flex-col gap-1 overflow-y-auto pr-1">
      {rows.map((hue) => {
        const active = current?.path.split("/")[1] === hue.hue;
        return (
          <div key={hue.hue} className="flex items-center gap-2">
            <span className={`w-16 flex-none truncate text-xs ${active ? "font-semibold" : "text-muted-foreground"}`}>{familyName(hue.hue)}</span>
            <div className="flex gap-0.5">
              {(hue.steps.length > 1 ? STEPS.map((s) => hue.steps.find((x) => x.step === s)) : hue.steps).map((st, n) => {
                if (!st) return <span key={n} className="size-[22px]" />;
                const on = st.row === current;
                const name = `${familyName(hue.hue)}${st.step ? ` ${st.step}` : ""}`;
                return (
                  <button key={st.row.path} type="button" aria-pressed={on} title={name} aria-label={`Use ${name}`} onClick={() => { if (!on) onPick(st.step ? `${hue.hue}.${st.step}` : hue.hue, name); }}
                    className={`size-[22px] rounded-[5px] border border-foreground/10 hover:scale-125 hover:shadow ${on ? "z-10 ring-2 ring-info ring-offset-1 ring-offset-background" : ""}`}
                    style={{ background: swatch(st.row, mode) }} />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
