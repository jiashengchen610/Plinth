import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Change, Op, State } from "@/lib/api";
import { ratioLabel, showValue, timeAgo } from "@/lib/format";

type Props = { state: State; brand: string; onApply: (id: string) => void; onDiscard: (id: string) => void; busy: boolean };

/** Current raw value of a token for the diff, looked up across brands by file. */
function currentValue(state: State, op: Op): unknown {
  const brand = op.file.match(/^brands\/([^/]+)\//)?.[1] ?? state.config.defaultBrand;
  const row = state.tokens[brand]?.rows.find((r) => r.path === op.path);
  const mode = !op.mode || op.mode === "light" ? "default" : op.mode;
  return row?.values[mode]?.raw;
}

function Chip({ value }: { value: unknown }) {
  const text = showValue(value, null);
  const color = typeof value === "string" && /^(#|oklch|rgb|hsl)/.test(value) ? value : null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs">
      {color && <span className="size-3 shrink-0 rounded-sm border" style={{ background: color }} />}
      <span className="truncate">{text || "—"}</span>
    </span>
  );
}

function OpRow({ state, op }: { state: State; op: Op }) {
  if (op.op === "set") {
    return (
      <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
        <code className="text-xs">{op.path}</code>
        {op.mode && op.mode !== "default" && <Badge variant="outline">{op.mode}</Badge>}
        <span className="text-xs text-muted-foreground">{op.file}</span>
        <span className="flex min-w-0 basis-full items-center gap-2">
          <Chip value={currentValue(state, op)} />
          <span aria-hidden="true" className="text-muted-foreground">→</span>
          <span className="sr-only">changes to</span>
          <Chip value={op.value} />
        </span>
      </li>
    );
  }
  const label = { write: "Write file", delete: "Delete token", rename: "Rename token" }[op.op];
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <Badge variant="secondary">{label}</Badge>
      <code className="text-xs">{op.op === "write" ? op.file : `${op.path}${op.to ? ` → ${op.to}` : ""}`}</code>
      {op.op === "write" && <span className="text-xs text-muted-foreground">{(op.content ?? "").split("\n").length} lines</span>}
    </li>
  );
}

function ChangeCard({ change, state, onApply, onDiscard, busy }: { change: Change } & Omit<Props, "brand">) {
  const cc = change.preview.contrastChanges;
  return (
    <article className="flex flex-col gap-4 rounded-xl border bg-card p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-medium">{change.title}</h2>
          <p className="text-xs text-muted-foreground">Proposed by {change.by} · {timeAgo(change.createdAt)}</p>
        </div>
        {change.preview.failingAfter > 0 ? (
          <Badge variant="destructive">{change.preview.failingAfter} contrast failure{change.preview.failingAfter > 1 ? "s" : ""} after</Badge>
        ) : (
          <Badge variant="secondary">All checks pass after</Badge>
        )}
      </header>
      {change.rationale && <p className="text-sm text-muted-foreground">{change.rationale}</p>}
      <ul className="divide-y">{change.ops.map((op, i) => <OpRow key={i} state={state} op={op} />)}</ul>
      {cc.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Contrast changes</h3>
          <ul className="flex flex-wrap gap-2">
            {cc.slice(0, 12).map((c) => (
              <li key={`${c.brand}-${c.mode}-${c.bg}-${c.fg}`}>
                <Badge variant={c.pass ? "secondary" : "destructive"} className="h-auto whitespace-normal text-left">
                  {c.fg} on {c.bg} · {c.brand} {c.mode === "default" ? "light" : c.mode} · {ratioLabel(c.before)} → {ratioLabel(c.ratio)}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      {change.preview.issues.length > 0 && <ul className="list-disc pl-5 text-sm text-destructive">{change.preview.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onApply(change.id)} disabled={busy}>Apply</Button>
        <Button variant="outline" onClick={() => onDiscard(change.id)} disabled={busy}>Discard</Button>
      </div>
    </article>
  );
}

export function ChangesView(props: Props) {
  const { state } = props;
  if (!state.pending.length) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <h2 className="font-medium">No changes waiting</h2>
        <p className="mt-1 text-sm text-muted-foreground">Ask Claude for a change, for example "make the primary color warmer". It appears here for you to review before anything is written.</p>
      </div>
    );
  }
  return <div className="flex flex-col gap-4">{state.pending.map((c) => <ChangeCard key={c.id} change={c} {...props} />)}</div>;
}
