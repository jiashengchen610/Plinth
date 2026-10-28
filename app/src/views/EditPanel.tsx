// The edit panel for a picked element (a part of the Style sample, or of a story in Components): what it uses, in
// plain words, each changeable on the spot, and a short request box (Claude turns the words into values). Before a
// change that would reach other components, it asks how far: only this part (a new color of its own, or its own
// corners) or everywhere. The reach is counted here from the tokens, not guessed. Problems a change causes (text that
// is hard to read) show in the panel with a fix.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ChangeResult, type Op, type QuickEdit, type State, type TokenRow } from "@/lib/api";
import { cssToOklch, hexToOklch, oklchToHex, type Oklch } from "@/lib/color";
import type { Pick } from "@/lib/inspect";
import { familyName, roleName, textStyleName } from "@/lib/plain";
import { componentOf, dependents, refOf, remindersByToken, targetIn, valueIn, type Graph, type Mode } from "@/lib/tokens";
import { ColorWheel } from "@/views/ColorWheel";
import { PaletteGrid } from "@/views/NodeGraph";

export type Selection = { title: string; picks: Pick[] };
/** One proposed change: to is a palette step ("violet.700"), a color ("#9e5e00"), one of your colors ("role:card"),
 * a radius step ("lg") or a text style ("label.sm"). */
type Change = { pick: Pick; to: string };
type Proposal = { changes: Change[]; by: "you" | "claude"; reply?: string };
type Props = {
  state: State; g: Graph; brand: string; mode: Mode; sel: Selection; onClose: () => void;
  onChanged: (r: Partial<ChangeResult> & { unchanged?: boolean; message?: string }, fallback: string) => void; onError: (m: string) => void;
  onAsk: (text: string) => void;
};

const CORNER_ROLES: Record<string, string> = { control: "Controls", container: "Containers", pill: "Pills", small: "Small marks" };
const PROP_ORDER = ["Background", "Text", "Hint text", "Border", "Icon", "Corners", "Text style"];
const keyOf = (p: Pick) => `${p.row.path}|${p.state ?? ""}`;
const isPart = (p: Pick) => componentOf(p.row) !== null;
/** "color/blue/600" → "Blue 600"; "color/white" → "White". */
const baseName = (b: TokenRow | null) => { if (!b) return null; const [, hue, step] = b.path.split("/"); return `${familyName(hue)}${step ? ` ${step}` : ""}`; };
const px = (v: string | null | undefined) => { const m = /^([\d.]+)(px|rem)$/.exec(v ?? ""); return m ? `${Math.round(Number(m[1]) * (m[2] === "rem" ? 16 : 1))}px` : v === "calc(infinity * 1px)" || /9999/.test(v ?? "") ? "round" : v ?? "?"; };
const toLabel = (c: Change) => {
  if (c.to.startsWith("role:")) return roleName(c.to.slice(5));
  if (c.pick.kind === "color") { const [f, s] = c.to.split("."); return s ? `${familyName(f)} ${s}` : c.to.startsWith("#") ? c.to : familyName(f); }
  if (c.pick.kind === "radius") return c.to.toUpperCase();
  return textStyleName(`typography/${c.to.replace(/\./g, "/")}`);
};

export function EditPanel({ state, g, brand, mode, sel, onClose, onChanged, onError, onAsk }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<QuickEdit | null>(null);
  const dark = mode === "dark" ? " in dark mode" : "";
  // A new pick starts fresh and brings the panel into view.
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    setOpen(null); setProposal(null); setAnswer(null); setName(null);
    box.current?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [sel.title]);

  const roleOf = (p: Pick): TokenRow | null => {
    if (!isPart(p)) return p.row.layerId === "primitives" ? null : p.row;
    const t = targetIn(g, p.row, mode);
    return t && t.layerId !== "primitives" && componentOf(t) === null ? t : null;
  };
  /** How far a change reaches when it is not only this part: the parts (in any component) using the same color or corners. */
  const reach = (p: Pick) => {
    const role = roleOf(p);
    if (!role) return null;
    const parts = dependents(g, role.path).filter((r) => componentOf(r) !== null);
    return { role, parts: parts.length, components: new Set(parts.map(componentOf)).size };
  };
  const shared = (c: Change) => {
    if (!isPart(c.pick) || c.pick.kind === "text" || c.to.startsWith("role:")) return null;
    const r = reach(c.pick);
    return r && r.parts > 1 ? r : null;
  };
  const describe = (p: Pick) => {
    const v = valueIn(p.row, mode);
    if (p.kind === "color") {
      const role = roleOf(p), base = targetIn(g, role ?? p.row, mode);
      return { swatch: v?.resolved ?? null, text: isPart(p) && role ? `${roleName(role.name)}${base ? ` (${baseName(base)})` : ""}` : baseName(base) ?? v?.resolved ?? "fixed" };
    }
    if (p.kind === "radius") {
      const role = roleOf(p);
      return { swatch: null, text: `${role && role !== p.row ? `${CORNER_ROLES[role.path.split("/").at(-1)!] ?? roleName(role.name)} · ` : ""}${px(v?.resolved ?? v?.css)}` };
    }
    const style = targetIn(g, p.row, mode);
    return { swatch: null, text: style ? textStyleName(style.path) : "its own" };
  };
  // The name a new color would get, the engine's way (newColorName in engine/style.mjs), free of names in use.
  const draftName = (c: Change | undefined) => {
    const r = c && shared(c);
    if (!r || !c) return "";
    const old = r.role.path.replace(/^color\//, ""), segs = c.pick.row.path.split("/"), comp = segs[0];
    const base = old === comp || old.startsWith(`${comp}-`) ? `${comp}-${segs.at(-1)}` : `${old}-${comp}`;
    let n = base;
    for (let i = 2; g.byName.has(n) || g.byKey.has(`color/${n}`); i++) n = `${base}-${i}`;
    return n;
  };

  const apply = async (changes: Change[], scope: "part" | "role") => {
    setBusy(true);
    try {
      for (const c of changes) {
        const p = c.pick;
        const title = `${sel.title}: ${p.prop.toLowerCase()}${p.state ? ` ${p.state}` : ""} → ${toLabel(c)}${shared(c) ? (scope === "part" ? " (only here)" : " (everywhere)") : ""}${dark}`;
        if (p.kind === "color" && c.to.startsWith("role:")) {
          const v = refOf(`color/${c.to.slice(5)}`);
          const ops: Op[] = [{ op: "set", file: p.row.source, path: p.row.path, ...(mode === "dark" ? { mode: "dark" } : {}), value: v }];
          if (mode === "default" && p.row.values.dark && p.row.values.dark.raw !== p.row.values.default?.raw && p.row.values.dark.raw === refOf(roleOf(p)?.path ?? "")) ops.push({ op: "set", file: p.row.source, path: p.row.path, mode: "dark", value: v });
          onChanged(await api.change(title, ops), title);
        } else if (p.kind === "color" && isPart(p)) {
          onChanged(await api.partColor({ brand, part: p.row.path, color: c.to, mode, scope: shared(c) ? scope : "role", ...(scope === "part" && shared(c) && name ? { name } : {}), title }), title);
        } else if (p.kind === "color") {
          const role = p.row.path.replace(/^color\//, "");
          if (c.to.startsWith("#")) onChanged(await api.addPaletteColor((await api.colorName(c.to)).name, c.to, { brand, role, mode, title: `${sel.title}: new color` }), title);
          else onChanged(await api.roleColor(brand, role, c.to, mode, title), title);
        } else if (p.kind === "radius") {
          const role = roleOf(p);
          const target = scope === "part" || !role ? p.row : role;
          onChanged(await api.change(title, [{ op: "set", file: target.source, path: target.path, value: `{radius.${c.to}}` }]), title);
        } else {
          onChanged(await api.change(title, [{ op: "set", file: p.row.source, path: p.row.path, value: `{typography.${c.to}}` }]), title);
        }
      }
      setProposal(null); setOpen(null); setName(null); setAnswer(null);
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  };
  /** A value picked by hand: applied at once unless it would reach other components; then the panel asks first. */
  const choose = (pick: Pick, to: string) => {
    const c = { pick, to };
    if (shared(c)) { setProposal({ changes: [c], by: "you" }); setName(null); } else apply([c], "role");
  };
  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || asking) return;
    setAsking(true); setAnswer(null); setProposal(null);
    try {
      const r = await api.quickEdit({ brand, mode, title: sel.title, text, picks: sel.picks.map((p) => ({ path: p.row.path, prop: p.prop, kind: p.kind, state: p.state })) });
      setAnswer(r);
      const changes = r.changes.map((c) => ({ pick: sel.picks.find((p) => p.row.path === c.path)!, to: c.to })).filter((c) => c.pick);
      if (changes.length) setProposal({ changes, by: "claude", reply: r.reply });
    } catch (err) { onError((err as Error).message); } finally { setAsking(false); }
  };

  const reminders = useMemo(() => remindersByToken(state, brand, mode), [state, brand, mode]);
  const names = new Set(sel.picks.flatMap((p) => [p.row.name, roleOf(p)?.name].filter(Boolean) as string[]));
  const problems = [...new Set([...names].flatMap((n) => (reminders.get(n) ?? []).filter((r) => r.kind === "contrast").map((r) => r.text)))];
  const order = (p: Pick) => { const i = PROP_ORDER.indexOf(p.prop); return i < 0 ? PROP_ORDER.length : i; };
  const plain = sel.picks.filter((p) => !p.state).sort((a, b) => order(a) - order(b)), states = sel.picks.filter((p) => p.state);
  const share = proposal?.changes.map(shared).find(Boolean) ?? null;

  const row = (p: Pick) => {
    const d = describe(p), k = keyOf(p), on = open === k;
    const fixedFit = p.kind === "radius" && p.row.fit?.on;
    return (
      <li key={k} className="flex flex-col gap-2 border-t py-2.5 first:border-t-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="w-32 flex-none text-sm font-medium">{p.prop}{p.state ? <span className="block text-xs font-normal text-muted-foreground">{p.state}</span> : null}</span>
          <span className="flex min-w-0 flex-[1_1_160px] items-center gap-2 text-sm">
            {d.swatch && <span className="size-5 flex-none rounded-md border" style={{ background: d.swatch }} />}
            <span className="truncate">{d.text}</span>
          </span>
          {fixedFit ? <span className="text-xs text-muted-foreground">Fits inside its container's corners</span>
            : p.row.layerId === "primitives" ? <span className="text-xs text-muted-foreground">Fixed</span>
            : <button type="button" aria-expanded={on} onClick={() => { setOpen(on ? null : k); setProposal(null); }} className="min-h-9 rounded-lg border px-3 text-sm font-medium">{on ? "Close" : "Change"}</button>}
        </div>
        {on && p.kind === "color" && <ColorEditor g={g} mode={mode} pick={p} current={targetIn(g, roleOf(p) ?? p.row, mode)} reach={isPart(p) ? null : reach(p)} onChoose={(to) => choose(p, to)} />}
        {on && p.kind === "radius" && (
          <div className="flex flex-wrap gap-1.5">
            {(state.style[brand]?.radiusSteps ?? []).map((s) => (
              <button key={s.step} type="button" disabled={busy} onClick={() => choose(p, s.step)} className="flex min-h-10 items-center gap-2 rounded-lg border px-2.5 text-sm">
                <span aria-hidden="true" className="block size-4 border-t-2 border-l-2 border-foreground" style={{ borderTopLeftRadius: Math.min(s.px, 14) }} />{s.step.toUpperCase()} <span className="text-xs text-muted-foreground">{s.px >= 9999 ? "round" : `${s.px}px`}</span>
              </button>
            ))}
          </div>
        )}
        {on && p.kind === "text" && (
          <div className="flex flex-wrap gap-1.5">
            {g.rows.filter((r) => r.type === "typography" && r.path.startsWith("typography/")).map((r) => (
              <button key={r.path} type="button" disabled={busy} aria-pressed={targetIn(g, p.row, mode) === r} onClick={() => apply([{ pick: p, to: r.path.slice("typography/".length).replace(/\//g, ".") }], "part")}
                className={`min-h-10 rounded-lg border-2 px-3 text-sm ${targetIn(g, p.row, mode) === r ? "border-foreground" : "border-border"}`}>{textStyleName(r.path)}</button>
            ))}
          </div>
        )}
      </li>
    );
  };

  return (
    <section ref={box} aria-label={`Change ${sel.title}`} className="flex flex-col gap-3 rounded-xl border-2 border-info/50 bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="truncate font-semibold">{sel.title}</h3><p className="text-xs text-muted-foreground">{dark ? "Dark mode. " : ""}Change any of these here, or say what you want below.</p></div>
        <button type="button" onClick={onClose} className="min-h-9 flex-none rounded-lg border px-3 text-sm font-medium">Done</button>
      </div>
      {!sel.picks.length ? <p className="text-sm text-muted-foreground">Nothing here comes from your design system's settings. Pick a part of a component: a button, a card, a field.</p> : (
        <>
          <ul className="flex flex-col">{plain.map(row)}</ul>
          {states.length > 0 && (
            <details className="text-sm"><summary className="min-h-9 cursor-pointer py-1.5 font-medium">{states.length} more in other states ({[...new Set(states.map((p) => p.state))].slice(0, 3).join(", ")})</summary><ul className="flex flex-col">{states.map(row)}</ul></details>
          )}
        </>
      )}

      {proposal && (
        <div role="group" aria-label="How far should it go?" className="flex flex-col gap-2.5 rounded-xl border bg-muted/40 p-3.5 text-sm">
          {proposal.by === "claude" && <p><strong>Claude:</strong> {proposal.reply || "Here is a change."}</p>}
          <ul className="flex flex-col gap-0.5">{proposal.changes.map((c) => <li key={keyOf(c.pick)}>{c.pick.prop}{c.pick.state ? ` (${c.pick.state})` : ""} → <strong>{toLabel(c)}</strong></li>)}</ul>
          {share ? (
            <>
              <p><strong>{share.role.type === "color" ? roleName(share.role.name) : `${CORNER_ROLES[share.role.path.split("/").at(-1)!] ?? roleName(share.role.name)} corners`}</strong> {share.role.type === "color" ? "is" : "are"} also used by {share.parts - 1} other part{share.parts - 1 === 1 ? "" : "s"}{share.components > 1 ? ` in ${share.components} components` : ""}. Change only this, or everywhere it is used?</p>
              {proposal.changes.some((c) => c.pick.kind === "color" && shared(c)) && (
                <label className="flex flex-col gap-1 font-medium">Name of the new color (only this)
                  <input value={name ?? draftName(proposal.changes.find((c) => c.pick.kind === "color" && shared(c)))} onChange={(e) => setName(e.target.value)} className="h-10 rounded-lg border bg-background px-3 font-mono text-sm font-normal" />
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => apply(proposal.changes, "part")} className="min-h-10 rounded-lg bg-foreground px-3.5 font-semibold text-background">Only {sel.title.split(" · ")[0]}{proposal.changes.length === 1 ? ` ${proposal.changes[0].pick.prop.toLowerCase()}` : ""}</button>
                <button type="button" disabled={busy} onClick={() => apply(proposal.changes, "role")} className="min-h-10 rounded-lg border bg-background px-3.5 font-medium">Everywhere ({share.parts} parts)</button>
                <button type="button" disabled={busy} onClick={() => setProposal(null)} className="min-h-10 rounded-lg px-3 font-medium text-muted-foreground">Cancel</button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => apply(proposal.changes, "role")} className="min-h-10 rounded-lg bg-foreground px-3.5 font-semibold text-background">Apply</button>
              <button type="button" disabled={busy} onClick={() => setProposal(null)} className="min-h-10 rounded-lg px-3 font-medium text-muted-foreground">Cancel</button>
            </div>
          )}
        </div>
      )}

      {problems.map((t) => (
        <div key={t} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/50 bg-warning/10 py-2 pr-2 pl-3.5 text-sm">
          <span className="flex-[1_1_200px]">Text here is hard to read{dark} ({t.split(":")[0].split(" on ").map((x) => roleName(x.trim().replace(/\/\d+$/, ""))).join(" on ")}).</span>
          <button type="button" disabled={busy} onClick={async () => { try { onChanged(await api.fixContrast(), "Contrast fixed."); } catch (e) { onError((e as Error).message); } }} className="min-h-10 rounded-lg bg-foreground px-3.5 font-semibold text-background">Fix it</button>
        </div>
      ))}

      {sel.picks.length > 0 && (
        <form onSubmit={ask} className="flex flex-col gap-1.5 border-t pt-3">
          <label htmlFor="quick-edit" className="text-sm font-medium">Or say what you want</label>
          <div className="flex gap-2">
            <input id="quick-edit" value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: a bit darker, rounder, warmer" className="h-10 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm" />
            <button type="submit" disabled={!text.trim() || asking} className="min-h-10 rounded-lg border px-3.5 text-sm font-semibold disabled:opacity-50">{asking ? "Thinking…" : "Ask"}</button>
          </div>
          {asking && <p role="status" className="text-xs text-muted-foreground">Claude is turning that into values (about 10 s).</p>}
          {answer && !asking && !proposal && (
            <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex-[1_1_200px]">{answer.error ? `Claude could not answer (${answer.error}). Try again, or change it by hand above.` : answer.reply || "Claude had no change for that."}</span>
              {answer.chat && <button type="button" onClick={() => onAsk(`About ${sel.title}: ${text}`)} className="min-h-9 rounded-lg border px-3 font-medium">Continue in the chat</button>}
            </div>
          )}
          {!asking && !answer && <p className="text-xs text-muted-foreground">Claude only suggests values; you confirm before anything changes. About US$0.004 each.</p>}
        </form>
      )}
    </section>
  );
}

/** Picking a color: one of your colors (only this part), the palette, or any color on the wheel. */
function ColorEditor({ g, mode, pick, current, reach, onChoose }: { g: Graph; mode: Mode; pick: Pick; current: TokenRow | null; reach: { parts: number; components: number } | null; onChoose: (to: string) => void }) {
  const part = isPart(pick);
  const [tab, setTab] = useState<"roles" | "palette" | "custom">("palette");
  const [color, setColor] = useState<Oklch>(cssToOklch(valueIn(pick.row, mode)?.resolved) ?? hexToOklch("#ca8a04")!);
  const roles = g.rows.filter((r) => r.layerId === "semantic" && r.type === "color" && r.source.startsWith("brands/") && !r.path.startsWith("color/chart/"));
  const tabs = ([["roles", "Your colors"], ["palette", "Palette"], ["custom", "Any color"]] as const).filter(([id]) => part || id !== "roles");
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border bg-muted/30 p-3">
      {reach && <p className="text-xs text-muted-foreground">This changes it in {reach.parts > 1 ? `all ${reach.parts} parts` : "the part"} that use it{reach.components > 1 ? `, in ${reach.components} components` : ""}.</p>}
      <div role="tablist" aria-label="Pick from" className="flex gap-1 self-start rounded-lg bg-muted p-1">
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`min-h-9 rounded-md px-3 text-sm font-medium ${tab === id ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{label}</button>)}
      </div>
      {tab === "roles" && (
        <div className="flex flex-wrap gap-1.5">
          {roles.map((r) => (
            <button key={r.path} type="button" onClick={() => onChoose(`role:${r.path.replace(/^color\//, "")}`)} className="flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-xs">
              <span className="size-3.5 rounded-full border" style={{ background: valueIn(r, mode)?.resolved ?? undefined }} />{roleName(r.name)}
            </button>
          ))}
        </div>
      )}
      {tab === "palette" && <PaletteGrid g={g} mode={mode} current={current} onPick={(c) => onChoose(c)} />}
      {tab === "custom" && (
        <div className="flex flex-col gap-2.5">
          <ColorWheel value={color} onChange={setColor} />
          <button type="button" onClick={() => onChoose(oklchToHex(color))} className="min-h-10 self-start rounded-lg bg-foreground px-3.5 text-sm font-semibold text-background">Use this color</button>
          <p className="text-xs text-muted-foreground">Plinth adds it to your palette with lighter and darker versions.</p>
        </div>
      )}
    </div>
  );
}
