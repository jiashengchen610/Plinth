// Token graph helpers: references per mode, the chain down to the palette, what depends on a token, and which
// reminders touch it. Pure functions over the state the server sends; the engine stays the source of truth.
import type { ContrastResult, DistinctResult, Op, State, StructureResult, TokenRow } from "@/lib/api";

export type Mode = "default" | "dark";
export type Graph = {
  rows: TokenRow[];
  byKey: Map<string, TokenRow>;
  byName: Map<string, TokenRow>;
  layers: { id: string; name: string }[];
  /** key → keys that reference it (any mode) */
  users: Map<string, string[]>;
};

const aliasKey = (v: unknown) => (typeof v === "string" && /^\{[^}]+\}$/.test(v.trim()) ? v.trim().slice(1, -1).replace(/\./g, "/") : null);
export const refOf = (key: string) => `{${key.replace(/\//g, ".")}}`;
export const valueIn = (t: TokenRow, mode: Mode) => t.values[mode] ?? t.values.default;

export function buildGraph(state: State, brand: string): Graph {
  const data = state.tokens[brand];
  const rows = (data?.rows ?? []).filter((r) => !r.derived);
  const byKey = new Map(rows.map((r) => [r.path, r]));
  const byName = new Map(rows.map((r) => [r.name, r]));
  const users = new Map<string, string[]>();
  for (const r of rows) for (const ref of r.refs ?? []) users.set(ref, [...(users.get(ref) ?? []), r.path]);
  const layers = data?.layers?.length ? data.layers : [{ id: "semantic", name: "Semantic" }];
  return { rows, byKey, byName, layers, users };
}

/** The token this one points at in a mode, or null for a fixed value. */
export const targetIn = (g: Graph, t: TokenRow, mode: Mode) => {
  const k = aliasKey(valueIn(t, mode)?.raw);
  return k ? g.byKey.get(k) ?? null : null;
};

/** From a token down to its fixed value: [token, role, …, palette step]. */
export function chainDown(g: Graph, t: TokenRow, mode: Mode): TokenRow[] {
  const out = [t];
  let cur: TokenRow | null = t;
  for (let i = 0; i < 12 && cur; i++) {
    cur = targetIn(g, cur, mode);
    if (cur && !out.includes(cur)) out.push(cur);
  }
  return out;
}

/** Everything that depends on a token, transitively (component tokens on a role on a palette step …). */
export function dependents(g: Graph, key: string): TokenRow[] {
  const seen = new Set<string>();
  const walk = (k: string) => {
    for (const u of g.users.get(k) ?? []) if (!seen.has(u)) { seen.add(u); walk(u); }
  };
  walk(key);
  return [...seen].map((k) => g.byKey.get(k)!).filter(Boolean);
}

/** Component name of a component token: "button" for button/default/background. */
export const componentOf = (t: TokenRow) => (t.layerId === "components" ? t.path.split("/")[0] : null);
export const isPalette = (t: TokenRow) => t.layerId === "primitives";
export const isColor = (t: TokenRow) => t.type === "color";

/** Palette colors by hue: { hue, steps: [{ step, row }] }; white and black as one-step hues. */
export function paletteHues(g: Graph) {
  const hues = new Map<string, { step: string; row: TokenRow }[]>();
  for (const r of g.rows) {
    if (!isPalette(r) || !isColor(r)) continue;
    const [, hue, step] = r.path.split("/");
    hues.set(hue, [...(hues.get(hue) ?? []), { step: step ?? "", row: r }]);
  }
  return [...hues.entries()].map(([hue, steps]) => ({ hue, steps: steps.sort((a, b) => Number(a.step) - Number(b.step)) }));
}

export type Reminder = { kind: "contrast" | "distinct" | "structure"; text: string };
/** Open reminders per token name, in a brand and mode. */
export function remindersByToken(state: State, brand: string, mode: Mode): Map<string, Reminder[]> {
  const out = new Map<string, Reminder[]>();
  const add = (name: string, r: Reminder) => out.set(name, [...(out.get(name) ?? []), r]);
  for (const c of state.checks.contrast as ContrastResult[]) {
    if (c.brand !== brand || c.mode !== mode || c.pass || c.accepted) continue;
    const text = `${c.fg} on ${c.bg}: ${c.ratio ?? "n/a"}:1, needs ${c.min}`;
    add(c.fg, { kind: "contrast", text });
    add(c.bg.replace(/\/\d+$/, ""), { kind: "contrast", text });
  }
  for (const d of state.checks.distinct as DistinctResult[]) {
    if (d.brand !== brand || d.mode !== mode || d.pass || d.accepted) continue;
    add(d.a, { kind: "distinct", text: `${d.a} and ${d.b} look alike (${d.reason})` });
    add(d.b, { kind: "distinct", text: `${d.a} and ${d.b} look alike (${d.reason})` });
  }
  for (const s of (state.checks.structure ?? []) as StructureResult[]) {
    if (s.brand !== brand || s.accepted) continue;
    const row = state.tokens[brand]?.rows.find((r) => r.path === s.token);
    if (row) add(row.name, { kind: "structure", text: s.detail });
  }
  return out;
}

/** Display name: palette steps as "red-500", the rest as their CSS name. */
export const label = (t: TokenRow) => (isPalette(t) && t.path.startsWith("color/") ? t.path.slice(6).replace(/\//g, "-") : t.name);

/** A short, human summary of an op for the draft bar. */
export function describeOp(op: Op, g: Graph): string {
  const t = op.path ? g.byKey.get(op.path) : undefined;
  const name = t ? label(t) : op.path ?? op.file;
  const mode = op.mode && op.mode !== "default" ? ` (${op.mode})` : "";
  if (op.op === "set" && op.value !== undefined) {
    const k = aliasKey(op.value);
    const target = k ? g.byKey.get(k) : null;
    return `${name}${mode} → ${target ? label(target) : String(op.value)}`;
  }
  if (op.op === "set" && op.alpha !== undefined) return `${name}${mode} opacity → ${Math.round(op.alpha * 100)}%`;
  if (op.op === "write") return `write ${op.file}`;
  return `${op.op} ${name}`;
}

/** Add or replace an op in a draft: the latest edit of the same token, mode and field wins. */
export function mergeOp(draft: Op[], op: Op): Op[] {
  const same = (a: Op) => a.op === op.op && a.file === op.file && a.path === op.path && (a.mode ?? "default") === (op.mode ?? "default") && (a.value !== undefined) === (op.value !== undefined) && (a.alpha !== undefined) === (op.alpha !== undefined);
  return [...draft.filter((a) => !same(a)), op];
}
