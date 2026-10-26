import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ContrastResult, State, TokenRow } from "@/lib/api";
import { groupTokens, ratioLabel, showValue } from "@/lib/format";

type Props = { state: State; brand: string; onFixContrast: () => void; busy: boolean };

function Swatch({ color, size = "sm" }: { color: string | null; size?: "sm" | "lg" }) {
  const cls = size === "lg" ? "h-20 w-full rounded-lg" : "size-4 shrink-0 rounded";
  // Checkerboard shows through translucent colors.
  return (
    <span className={`${cls} relative overflow-hidden border border-border bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:12px_12px]`}>
      <span className="absolute inset-0" style={{ background: color ?? "transparent" }} />
    </span>
  );
}

export function TokensView({ state, brand, onFixContrast, busy }: Props) {
  const data = state.tokens[brand];
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => !r.derived), [data]);
  const groups = useMemo(() => groupTokens(rows), [rows]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const current = rows.find((r) => r.path === selected) ?? groups[0]?.[1][0];
  const contrast = state.checks.contrast.filter((c) => c.brand === brand);
  const failing = contrast.filter((c) => !c.pass);
  const failingNames = new Set(failing.flatMap((c) => [c.fg, c.bg]));
  const q = query.trim().toLowerCase();

  return (
    <div className="flex flex-wrap items-start gap-4">
      <nav aria-label="Token tree" className="flex min-w-0 flex-[1_1_240px] flex-col gap-2 rounded-xl border bg-card p-2 md:max-w-xs">
        <label htmlFor="token-filter" className="sr-only">Filter tokens</label>
        <input
          id="token-filter"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter tokens"
          className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="max-h-[70vh] overflow-y-auto">
          <ul className="flex flex-col">
            {groups.map(([group, items]) => {
              const visible = items.filter((r) => !q || r.name.includes(q) || r.path.toLowerCase().includes(q));
              if (!visible.length) return null;
              const open = !collapsed[group] || Boolean(q);
              return (
                <li key={group}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setCollapsed((c) => ({ ...c, [group]: !c[group] }))}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                  >
                    <span>{group}</span>
                    <span className="tabular-nums">{visible.length}</span>
                  </button>
                  {open && (
                    <ul>
                      {visible.map((r) => {
                        const v = r.values.default;
                        const on = current?.path === r.path;
                        return (
                          <li key={r.path}>
                            <button
                              type="button"
                              aria-current={on}
                              onClick={() => setSelected(r.path)}
                              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${on ? "bg-accent font-medium text-accent-foreground" : ""}`}
                            >
                              {r.type === "color" ? <Swatch color={v?.resolved ?? null} /> : <span className="size-4 shrink-0 text-center font-mono text-[10px] leading-4 text-muted-foreground">{r.type.slice(0, 1).toUpperCase()}</span>}
                              <span className="min-w-0 truncate font-mono text-xs">{r.name}</span>
                              {failingNames.has(r.name) && <span className="ml-auto size-2 shrink-0 rounded-full bg-destructive" aria-label="contrast issue" />}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      <section aria-label="Token details" className="flex min-w-0 flex-[999_1_480px] flex-col gap-4">
        {failing.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <span className="min-w-0 flex-1">
              {failing.length} color pair{failing.length > 1 ? "s" : ""} below the required contrast in <strong>{brand}</strong>. A fix adjusts lightness only and keeps the hue.
            </span>
            <Button size="sm" onClick={onFixContrast} disabled={busy}>Propose fixes</Button>
          </div>
        )}
        {current && <TokenDetail token={current} modes={data.modes} contrast={contrast} />}
        {data.issues.length > 0 && (
          <div className="rounded-xl border p-4 text-sm">
            <h3 className="mb-2 font-medium">Token issues</h3>
            <ul className="list-disc pl-5 text-muted-foreground">{data.issues.map((i) => <li key={i}>{i}</li>)}</ul>
          </div>
        )}
      </section>
    </div>
  );
}

function TokenDetail({ token, modes, contrast }: { token: TokenRow; modes: string[]; contrast: ContrastResult[] }) {
  const related = contrast.filter((c) => c.fg === token.name || c.bg === token.name);
  return (
    <div className="flex flex-col gap-5 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-lg font-medium">--{token.name}</h2>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{token.type}</Badge>
          <Badge variant="outline">{token.source}</Badge>
        </div>
      </div>
      {token.description && <p className="text-sm text-muted-foreground">{token.description}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {modes.map((m) => {
          const v = token.values[m] ?? token.values.default;
          return (
            <div key={m} className="flex flex-col gap-2 rounded-lg border p-3">
              <span className="text-xs text-muted-foreground">{m === "default" ? "Light" : m[0].toUpperCase() + m.slice(1)}</span>
              {token.type === "color" && <Swatch color={v?.resolved ?? null} size="lg" />}
              <code className="break-all text-sm">{showValue(v?.raw, v?.css ?? null)}</code>
              {v?.css && v.css !== showValue(v.raw, null) && <code className="break-all text-xs text-muted-foreground">{v.css}</code>}
            </div>
          );
        })}
      </div>
      {related.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Contrast</h3>
          <ul className="flex flex-wrap gap-2">
            {related.map((c) => (
              <li key={`${c.mode}-${c.bg}-${c.fg}`}>
                <Badge variant={c.pass ? "secondary" : "destructive"} className="h-auto whitespace-normal text-left">
                  {c.fg} on {c.bg} · {c.mode === "default" ? "light" : c.mode} · {ratioLabel(c.ratio)}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Use it as <code>var(--{token.name})</code>{token.type === "color" ? <> or <code>bg-{token.name}</code> / <code>text-{token.name}</code></> : null}. Path <code>{token.path}</code>.
      </p>
    </div>
  );
}
