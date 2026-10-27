// How one component gets its colors: its parts → your colors (roles) → base colors (palette), as three columns
// joined by lines. Click a part, then one of your colors, to connect them: a change written at once, like any other.
import { useMemo } from "react";
import type { Op, TokenRow } from "@/lib/api";
import { partName, roleName } from "@/lib/plain";
import { refOf, targetIn, valueIn, type Graph, type Mode } from "@/lib/tokens";

type Props = { g: Graph; mode: Mode; parts: TokenRow[]; selected: string | null; onSelect: (path: string) => void; onEdit: (title: string, ops: Op[]) => void };

const ROW = 52, TOP = 30, NODE = 44;
const COL = { a: { x: 0, w: 230 }, b: { x: 320, w: 240 }, c: { x: 650, w: 220 } };
const curve = (x1: number, y1: number, x2: number, y2: number) => { const m = (x1 + x2) / 2; return `M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2} `; };
const mid = (i: number) => TOP + i * ROW + NODE / 2;
const swatch = (t: TokenRow | null | undefined, mode: Mode) => (t ? valueIn(t, mode)?.resolved ?? "transparent" : "transparent");

export function NodeGraph({ g, mode, parts, selected, onSelect, onEdit }: Props) {
  const roles = useMemo(() => g.rows.filter((r) => r.layerId === "semantic" && r.type === "color" && r.source.startsWith("brands/")), [g]);
  const part = parts.find((p) => p.path === selected) ?? parts[0];
  const roleOf = (p: TokenRow) => { const t = targetIn(g, p, mode); return t && t.layerId === "semantic" ? t : null; };
  const baseOf = (r: TokenRow) => targetIn(g, r, mode);
  const bases = useMemo(() => {
    const seen = new Map<string, TokenRow>();
    for (const r of roles) { const b = baseOf(r); if (b && !seen.has(b.path)) seen.set(b.path, b); }
    return [...seen.values()];
  }, [roles, mode, g]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!part) return <p className="text-sm text-muted-foreground">This component has no colors of its own.</p>;

  const curRole = roleOf(part);
  const used = new Set(parts.map((p) => roleOf(p)?.path).filter(Boolean));
  let hl = "", comp = "", dim = "";
  parts.forEach((p, i) => {
    const r = roleOf(p);
    const j = r ? roles.indexOf(r) : -1;
    if (j < 0) return;
    const d = curve(COL.a.x + COL.a.w, mid(i), COL.b.x, mid(j));
    if (p === part) hl += d; else comp += d;
  });
  roles.forEach((r, j) => {
    const b = baseOf(r);
    const k = b ? bases.indexOf(b) : -1;
    if (k < 0) return;
    const d = curve(COL.b.x + COL.b.w, mid(j), COL.c.x, mid(k));
    if (r === curRole) hl += d; else if (used.has(r.path)) comp += d; else dim += d;
  });
  const w = COL.c.x + COL.c.w;
  const h = TOP + Math.max(parts.length, roles.length, bases.length) * ROW;

  // Re-linking a part to a role: the part's light value, and its dark value too when it differs (both follow the role).
  const connect = (role: TokenRow) => {
    if (role === curRole) return;
    const v = refOf(role.path);
    const ops: Op[] = [{ op: "set", file: part.source, path: part.path, value: v }];
    const dark = part.values.dark;
    if (dark && dark.raw !== part.values.default?.raw) ops.push({ op: "set", file: part.source, path: part.path, mode: "dark", value: v });
    onEdit(`${partName(part.path)}: ${curRole ? roleName(curRole.name) : "fixed color"} → ${roleName(role.name)}`, ops);
  };

  const node = "absolute flex h-11 items-center gap-2 rounded-[10px] bg-background px-2.5 text-left";
  const mono = "truncate font-mono text-[11px] text-muted-foreground";
  return (
    <div className="overflow-x-auto rounded-xl border bg-muted/40">
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
        {bases.map((b, k) => {
          const on = curRole ? baseOf(curRole) === b : false;
          return (
            <div key={b.path} className={`${node} ${on ? "border-2 border-info bg-info/10" : "border"}`} style={{ left: COL.c.x, top: TOP + k * ROW, width: COL.c.w }}>
              <span className="size-5 flex-none rounded border" style={{ background: swatch(b, mode) }} />
              <span className="flex min-w-0 flex-col leading-tight"><span className="truncate text-[13px] font-semibold">{b.path.replace(/^color\//, "").replace("/", " ")}</span><span className={mono}>{b.name}</span></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
