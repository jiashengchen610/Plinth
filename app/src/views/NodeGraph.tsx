// How one component gets its colors: its parts → your colors (roles) → base colors (the whole palette), as three
// columns joined by lines. Click a part, then one of your colors, to connect them; click a base color to change the
// color the part's role uses (in every component). Each is a change written at once, like any other.
import { useMemo } from "react";
import type { Op, TokenRow } from "@/lib/api";
import { familyName, partName, roleName, TAILWIND_FAMILIES } from "@/lib/plain";
import { componentOf, dependents, paletteHues, refOf, targetIn, valueIn, type Graph, type Mode } from "@/lib/tokens";

type Props = {
  g: Graph; mode: Mode; parts: TokenRow[]; selected: string | null; onSelect: (path: string) => void; onEdit: (title: string, ops: Op[]) => void;
  /** Point a role at a palette step ("blue.600") in the mode shown. */
  onRoleColor: (role: TokenRow, color: string, title: string) => void;
};

const ROW = 52, TOP = 30, NODE = 44;
const CELL = 17, PROW = 22, LABEL = 56;
const STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const COL = { a: { x: 0, w: 190 }, b: { x: 240, w: 190 }, c: { x: 480, w: LABEL + STEPS.length * CELL } };
const curve = (x1: number, y1: number, x2: number, y2: number) => { const m = (x1 + x2) / 2; return `M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2} `; };
const mid = (i: number) => TOP + i * ROW + NODE / 2;
const pmid = (k: number) => TOP + k * PROW + PROW / 2;
const swatch = (t: TokenRow | null | undefined, mode: Mode) => (t ? valueIn(t, mode)?.resolved ?? "transparent" : "transparent");

export function NodeGraph({ g, mode, parts, selected, onSelect, onEdit, onRoleColor }: Props) {
  const roles = useMemo(() => g.rows.filter((r) => r.layerId === "semantic" && r.type === "color" && r.source.startsWith("brands/")), [g]);
  // The whole palette, one row per color: your own colors first, then Tailwind's, then white and black.
  const palette = useMemo(() => {
    const hues = paletteHues(g);
    const scales = hues.filter((h) => h.steps.length > 1);
    const singles = hues.filter((h) => h.steps.length === 1).map((h) => ({ step: "", row: h.steps[0].row, hue: h.hue }));
    const own = scales.filter((h) => !TAILWIND_FAMILIES.has(h.hue));
    return { rows: [...own, ...scales.filter((h) => TAILWIND_FAMILIES.has(h.hue))], singles };
  }, [g]);
  const part = parts.find((p) => p.path === selected) ?? parts[0];
  const roleOf = (p: TokenRow) => { const t = targetIn(g, p, mode); return t && t.layerId === "semantic" ? t : null; };
  const baseOf = (r: TokenRow) => targetIn(g, r, mode);
  if (!part) return <p className="text-sm text-muted-foreground">This component has no colors of its own.</p>;

  const curRole = roleOf(part);
  const curBase = curRole ? baseOf(curRole) : null;
  const used = new Set(parts.map((p) => roleOf(p)?.path).filter(Boolean));
  const usedBases = new Set(parts.map((p) => { const r = roleOf(p); return r ? baseOf(r)?.path : null; }).filter(Boolean));
  const rowOf = (b: TokenRow | null) => {
    if (!b) return -1;
    const hue = b.path.split("/")[1];
    const k = palette.rows.findIndex((h) => h.hue === hue);
    const single = palette.singles.findIndex((s) => s.row === b);
    return k >= 0 ? k : single >= 0 ? palette.rows.length + single : -1;
  };
  let hl = "", comp = "", dim = "";
  parts.forEach((p, i) => {
    const r = roleOf(p);
    const j = r ? roles.indexOf(r) : -1;
    if (j < 0) return;
    const d = curve(COL.a.x + COL.a.w, mid(i), COL.b.x, mid(j));
    if (p === part) hl += d; else comp += d;
  });
  roles.forEach((r, j) => {
    const k = rowOf(baseOf(r));
    if (k < 0) return;
    const d = curve(COL.b.x + COL.b.w, mid(j), COL.c.x - 4, pmid(k));
    if (r === curRole) hl += d; else if (used.has(r.path)) comp += d; else dim += d;
  });
  const w = COL.c.x + COL.c.w;
  const h = TOP + Math.max(parts.length * ROW, roles.length * ROW, (palette.rows.length + palette.singles.length) * PROW);

  // Re-linking a part to a role: the part's light value, and its dark value too when it differs (both follow the role).
  const connect = (role: TokenRow) => {
    if (role === curRole) return;
    const v = refOf(role.path);
    const ops: Op[] = [{ op: "set", file: part.source, path: part.path, value: v }];
    const dark = part.values.dark;
    if (dark && dark.raw !== part.values.default?.raw) ops.push({ op: "set", file: part.source, path: part.path, mode: "dark", value: v });
    onEdit(`${partName(part.path)}: ${curRole ? roleName(curRole.name) : "fixed color"} → ${roleName(role.name)}`, ops);
  };
  const shared = curRole ? new Set(dependents(g, curRole.path).map(componentOf).filter(Boolean)).size : 0;
  const pickBase = (b: TokenRow, hue: string, step: string) => {
    if (!curRole || b === curBase) return;
    const name = `${familyName(hue)}${step ? ` ${step}` : ""}`;
    onRoleColor(curRole, step ? `${hue}.${step}` : hue, `${roleName(curRole.name)}: ${name}${mode === "dark" ? " in dark mode" : ""}`);
  };

  const node = "absolute flex h-11 items-center gap-2 rounded-[10px] bg-background px-2.5 text-left";
  const mono = "truncate font-mono text-[11px] text-muted-foreground";
  const cell = (b: TokenRow, hue: string, step: string, x: number, y: number) => {
    const on = b === curBase;
    const name = `${familyName(hue)}${step ? ` ${step}` : ""}`;
    return (
      <button key={b.path} type="button" aria-pressed={on} disabled={!curRole} onClick={() => pickBase(b, hue, step)}
        title={on ? `${roleName(curRole!.name)} uses ${name}` : curRole ? `Use ${name} for ${roleName(curRole.name)}` : name}
        aria-label={curRole ? `Use ${name} for ${roleName(curRole.name)}` : name}
        className={`absolute rounded-[4px] border border-foreground/10 enabled:hover:scale-125 enabled:hover:shadow disabled:cursor-default ${on ? "z-10 ring-2 ring-info ring-offset-1 ring-offset-background" : usedBases.has(b.path) ? "ring-1 ring-muted-foreground ring-offset-1 ring-offset-background" : ""}`}
        style={{ left: x, top: y, width: CELL - 3, height: CELL - 3, background: swatch(b, mode) }} />
    );
  };
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-muted/40">
      <p className="border-b bg-background/60 px-4 py-2.5 text-sm">
        {curRole ? <>Click a base color to change <strong>{roleName(curRole.name)}</strong>{mode === "dark" ? " in dark mode" : ""}. {shared > 2 ? `It changes in all ${shared} components that use it.` : shared === 2 ? "It changes in both components that use it." : "Only this component uses it."}</>
          : <>{partName(part.path)} has a fixed color. Connect it to one of your colors first, then you can pick its base color.</>}
      </p>
      <div className="overflow-x-auto">
        <div className="relative m-4" style={{ width: w, height: h }}>
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="absolute inset-0">
            <path d={dim || "M0 0"} fill="none" stroke="var(--border)" strokeWidth="1.5" />
            <path d={comp || "M0 0"} fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" />
            <path d={hl || "M0 0"} fill="none" stroke="var(--info)" strokeWidth="2.5" />
          </svg>
          {[["Parts", COL.a.x], ["Your colors", COL.b.x], ["Base colors", COL.c.x]].map(([t, x]) => (
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
            return (
              <button key={r.path} type="button" aria-pressed={on} onClick={() => connect(r)} title={on ? `${partName(part.path)} uses this color` : `Connect ${partName(part.path)} to ${roleName(r.name)}`}
                className={`${node} ${on ? "border-2 border-info bg-info/10" : used.has(r.path) ? "border border-muted-foreground" : "border"}`} style={{ left: COL.b.x, top: TOP + j * ROW, width: COL.b.w }}>
                <span className="size-5 flex-none rounded-full border" style={{ background: swatch(r, mode) }} />
                <span className="flex min-w-0 flex-col leading-tight"><span className={`truncate text-[13px] font-semibold ${used.has(r.path) || on ? "" : "text-muted-foreground"}`}>{roleName(r.name)}</span><span className={mono}>{r.name}</span></span>
              </button>
            );
          })}
          {palette.rows.map((hue, k) => {
            const y = TOP + k * PROW;
            const active = curBase?.path.split("/")[1] === hue.hue;
            return (
              <div key={hue.hue}>
                <span className={`absolute truncate text-[11px] leading-[18px] ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`} style={{ left: COL.c.x, top: y, width: LABEL - 6 }}>{familyName(hue.hue)}</span>
                {STEPS.map((s, n) => { const st = hue.steps.find((x) => x.step === s); return st ? cell(st.row, hue.hue, s, COL.c.x + LABEL + n * CELL, y + 1) : null; })}
              </div>
            );
          })}
          {palette.singles.map((s, n) => {
            const y = TOP + (palette.rows.length + n) * PROW;
            return (
              <div key={s.hue}>
                <span className={`absolute truncate text-[11px] leading-[18px] ${curBase === s.row ? "font-semibold text-foreground" : "text-muted-foreground"}`} style={{ left: COL.c.x, top: y, width: LABEL - 6 }}>{familyName(s.hue)}</span>
                {cell(s.row, s.hue, "", COL.c.x + LABEL, y + 1)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
