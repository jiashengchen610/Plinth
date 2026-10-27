import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { State } from "@/lib/api";
import { timeAgo } from "@/lib/format";

type Props = { state: State; onRestore: (sha: string) => void; busy: boolean };

export function HistoryView({ state, onRestore, busy }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <ol className="flex flex-col divide-y rounded-xl border bg-card">
      {state.versions.map((v, i) => (
        <li key={v.sha} className="flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{v.outside && <span className="mr-2 rounded border border-warning/60 bg-warning/10 px-1.5 py-0.5 text-xs font-normal">outside Plinth</span>}{v.subject}</p>
            <p className="text-xs text-muted-foreground"><code>{v.short}</code> · {timeAgo(v.date)}{i === 0 ? " · current" : ""}</p>
          </div>
          {i > 0 && (confirming === v.sha ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Restore this version? Later versions stay in the history.</span>
              <Button size="sm" onClick={() => { setConfirming(null); onRestore(v.short); }} disabled={busy}>Restore</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirming(v.sha)}>Restore…</Button>
          ))}
        </li>
      ))}
    </ol>
  );
}
