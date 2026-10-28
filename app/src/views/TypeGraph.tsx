// How one component sets its text: its text parts → text styles → fonts (font roles), as three columns joined by
// lines, like the color graph. Click a part, then a text style, to connect them; click a font to change the font of
// the part's text style (in every component that uses that style). Which font each role is comes from Style.
import { useMemo } from "react";
import type { Op, TokenRow } from "@/lib/api";
import { fontsHref } from "@/lib/cta";
import { FONT_ROLE_NAMES, textPartName, textStyleName } from "@/lib/plain";
import { componentOf, dependents, refOf, targetIn, valueIn, type Graph, type Mode } from "@/lib/tokens";

type Props = { g: Graph; mode: Mode; parts: TokenRow[]; selected: string | null; onSelect: (path: string) => void; onEdit: (title: string, ops: Op[]) => void };
type Style = { fontFamily?: unknown; fontSize?: { value: number; unit: string } | string; fontWeight?: number | string };

const ROW = 52, TOP = 30, NODE = 44;
const COL = { a: { x: 0, w: 190 }, b: { x: 240, w: 210 }, c: { x: 500, w: 210 } };
const ROLES = ["heading", "body", "label", "code"];
const WEIGHTS: Record<string, string> = { "300": "light", "400": "regular", "500": "medium", "600": "semibold", "700": "bold", "800": "extra bold" };
const curve = (x1: number, y1: number, x2: number, y2: number) => { const m = (x1 + x2) / 2; return `M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2} `; };
const mid = (i: number) => TOP + i * ROW + NODE / 2;
const aliasKey = (v: unknown) => (typeof v === "string" && /^\{[^}]+\}$/.test(v) ? v.slice(1, -1).replace(/\./g, "/") : null);
const familyOf = (css: string | null | undefined) => (css ?? "").split(",")[0].trim().replace(/^['"]|['"]$/g, "");
const size = (s: Style) => (s.fontSize && typeof s.fontSize === "object" ? `${Math.round(s.fontSize.value * (s.fontSize.unit === "rem" ? 16 : 1))} px` : "");

export function TypeGraph({ g, mode, parts, selected, onSelect, onEdit }: Props) {
  const styles = useMemo(() => g.rows.filter((r) => r.type === "typography" && r.layerId === "semantic" && valueIn(r, mode)?.raw && typeof valueIn(r, mode)?.raw === "object"), [g, mode]);
  const roles = useMemo(() => ROLES.map((r) => g.byKey.get(`font/${r}`)).filter((r): r is TokenRow => Boolean(r)), [g]);
  const href = fontsHref(roles.map((r) => familyOf(valueIn(r, mode)?.resolved)));
  const part = parts.find((p) => p.path === selected) ?? parts[0];
  if (!part) return <p className="text-sm text-muted-foreground">This component has no text of its own.</p>;

  const styleOf = (p: TokenRow) => { const t = targetIn(g, p, mode); return t && styles.includes(t) ? t : null; };
  const roleOf = (s: TokenRow) => { const k = aliasKey((valueIn(s, mode)?.raw as Style).fontFamily); return k ? roles.find((r) => r.path === k) ?? null : null; };
  const curStyle = styleOf(part);
  const curRole = curStyle ? roleOf(curStyle) : null;
  const used = new Set(parts.map((p) => styleOf(p)?.path).filter(Boolean));
  let hl = "", comp = "", dim = "";
  parts.forEach((p, i) => {
    const j = styles.indexOf(styleOf(p) as TokenRow);
    if (j < 0) return;
    const d = curve(COL.a.x + COL.a.w, mid(i), COL.b.x, mid(j));
    if (p === part) hl += d; else comp += d;
  });
  styles.forEach((s, j) => {
    const k = roles.indexOf(roleOf(s) as TokenRow);
    if (k < 0) return;
    const d = curve(COL.b.x + COL.b.w, mid(j), COL.c.x, mid(k));
    if (s === curStyle) hl += d; else if (used.has(s.path)) comp += d; else dim += d;
  });
  const w = COL.c.x + COL.c.w;
  const h = TOP + Math.max(parts.length, styles.length, roles.length) * ROW;

  const connect = (s: TokenRow) => {
    if (s === curStyle) return;
    onEdit(`${textPartName(part.path)} text: ${curStyle ? textStyleName(curStyle.path) : "own style"} → ${textStyleName(s.path)}`, [{ op: "set", file: part.source, path: part.path, value: refOf(s.path) }]);
  };
  const shared = curStyle ? new Set(dependents(g, curStyle.path).map(componentOf).filter(Boolean)).size : 0;
  const pickRole = (r: TokenRow) => {
    if (!curStyle || r === curRole) return;
    const name = r.path.split("/")[1];
    onEdit(`${textStyleName(curStyle.path)}: ${FONT_ROLE_NAMES[name] ?? name} font`, [{ op: "set", file: curStyle.source, path: `${curStyle.path}/font-family`, value: refOf(r.path) }]);
  };

  const node = "absolute flex h-11 items-center gap-2 rounded-[10px] bg-background px-2.5 text-left";
  const mono = "truncate font-mono text-[11px] text-muted-foreground";
  // The style's weight and family at one size. Not the font shorthand: React updates only what changed, and a new
  // shorthand would reset the size set next to it.
  const sample = (t: TokenRow) => {
    const m = /^(\S+)\s+\S+\s+(.+)$/.exec(valueIn(t, mode)?.resolved ?? "");
    return { fontWeight: m?.[1], fontFamily: m?.[2], fontSize: "18px", lineHeight: "1" };
  };
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-muted/40">
      {href && <link rel="stylesheet" href={href} precedence="default" />}
      <p className="border-b bg-background/60 px-4 py-2.5 text-sm">
        {curStyle ? <>Click a font to change it for <strong>{textStyleName(curStyle.path)}</strong>. {shared > 2 ? `It changes in all ${shared} components that use this style.` : shared === 2 ? "It changes in both components that use this style." : "Only this component uses this style."} Which font is which is set in Style.</>
          : <>{textPartName(part.path)} has its own text style. Connect it to one of the text styles first.</>}
      </p>
      <div className="overflow-x-auto">
        <div className="relative m-4" style={{ width: w, height: h }}>
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="absolute inset-0">
            <path d={dim || "M0 0"} fill="none" stroke="var(--border)" strokeWidth="1.5" />
            <path d={comp || "M0 0"} fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" />
            <path d={hl || "M0 0"} fill="none" stroke="var(--info)" strokeWidth="2.5" />
          </svg>
          {[["Text parts", COL.a.x], ["Text styles", COL.b.x], ["Fonts", COL.c.x]].map(([t, x]) => (
            <span key={t as string} className="absolute top-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase" style={{ left: x as number }}>{t}</span>
          ))}
          {parts.map((p, i) => {
            const on = p === part;
            return (
              <button key={p.path} type="button" aria-pressed={on} onClick={() => onSelect(p.path)} className={`${node} ${on ? "border-2 border-info bg-info/10" : "border"}`} style={{ left: COL.a.x, top: TOP + i * ROW, width: COL.a.w }}>
                <span className="w-7 flex-none text-center" style={sample(p)}>Aa</span>
                <span className="flex min-w-0 flex-col leading-tight"><span className="truncate text-[13px] font-semibold">{textPartName(p.path)}</span><span className={mono}>{p.name}</span></span>
              </button>
            );
          })}
          {styles.map((s, j) => {
            const on = s === curStyle;
            const v = valueIn(s, mode)?.raw as Style;
            return (
              <button key={s.path} type="button" aria-pressed={on} onClick={() => connect(s)} title={on ? `${textPartName(part.path)} uses this style` : `Use ${textStyleName(s.path)} for ${textPartName(part.path)}`}
                className={`${node} ${on ? "border-2 border-info bg-info/10" : used.has(s.path) ? "border border-muted-foreground" : "border"}`} style={{ left: COL.b.x, top: TOP + j * ROW, width: COL.b.w }}>
                <span className="w-7 flex-none text-center" style={sample(s)}>Aa</span>
                <span className="flex min-w-0 flex-col leading-tight"><span className={`truncate text-[13px] font-semibold ${used.has(s.path) || on ? "" : "text-muted-foreground"}`}>{textStyleName(s.path)}</span><span className="truncate text-[11px] text-muted-foreground">{[size(v), WEIGHTS[String(v.fontWeight)] ?? v.fontWeight].filter(Boolean).join(", ")}</span></span>
              </button>
            );
          })}
          {roles.map((r, k) => {
            const on = r === curRole;
            const family = familyOf(valueIn(r, mode)?.resolved);
            const name = r.path.split("/")[1];
            return (
              <button key={r.path} type="button" aria-pressed={on} disabled={!curStyle} onClick={() => pickRole(r)} title={on ? `${textStyleName(curStyle!.path)} uses this font` : curStyle ? `Use the ${(FONT_ROLE_NAMES[name] ?? name).toLowerCase()} font for ${textStyleName(curStyle.path)}` : family}
                className={`${node} ${on ? "border-2 border-info bg-info/10" : "border"}`} style={{ left: COL.c.x, top: TOP + k * ROW, width: COL.c.w }}>
                <span className="w-7 flex-none text-center text-lg leading-none" style={{ fontFamily: valueIn(r, mode)?.resolved ?? undefined }}>Aa</span>
                <span className="flex min-w-0 flex-col leading-tight"><span className="truncate text-[13px] font-semibold">{FONT_ROLE_NAMES[name] ?? name}</span><span className="truncate text-[11px] text-muted-foreground">{family}</span></span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
