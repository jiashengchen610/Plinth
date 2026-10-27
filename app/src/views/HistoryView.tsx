import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { State } from "@/lib/api";
import { timeAgo } from "@/lib/format";

type Props = { state: State; onRestore: (sha: string) => void; onSave: (message: string) => void; onDiscard: () => void; busy: boolean };

/** Unsaved work on top (save it as a version, or throw it away), then the saved versions. */
export function HistoryView({ state, onRestore, onSave, onDiscard, busy }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const unsaved = state.unsaved ?? [];
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Unsaved changes" className="rounded-xl border bg-card p-4">
        {unsaved.length === 0 ? (
          <p className="text-sm text-muted-foreground">No unsaved changes. Everything you change applies at once and shows up here until you save it as a version.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-medium">{unsaved.length} unsaved file{unsaved.length > 1 ? "s" : ""}</h2>
              <p className="text-xs text-muted-foreground">Already applied and checked. Save them as a version when you are happy; only saved versions can be published.</p>
            </div>
            <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto font-mono text-xs">
              {unsaved.map((u) => <li key={u.file} className="truncate"><span className="inline-block w-16 text-muted-foreground">{u.status}</span>{u.file}</li>)}
            </ul>
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (message.trim()) { onSave(message.trim()); setMessage(""); } }}>
              <label htmlFor="version-message" className="sr-only">What changed</label>
              <input id="version-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={state.lastChange?.title ?? "What changed"} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" />
              <Button size="sm" type="submit" disabled={busy || !message.trim()}>Save version</Button>
              {discarding ? (
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  Throw away every unsaved change?
                  <Button size="sm" variant="destructive" type="button" onClick={() => { setDiscarding(false); onDiscard(); }} disabled={busy}>Discard</Button>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setDiscarding(false)}>Cancel</Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" type="button" onClick={() => setDiscarding(true)} disabled={busy}>Discard…</Button>
              )}
            </form>
          </div>
        )}
      </section>

      <ol aria-label="Saved versions" className="flex flex-col divide-y rounded-xl border bg-card">
        {state.versions.map((v, i) => (
          <li key={v.sha} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{v.subject}{v.published && <span className="ml-2 rounded border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">published</span>}</p>
              <p className="text-xs text-muted-foreground"><code>{v.short}</code> · {timeAgo(v.date)}{i === 0 ? " · latest version" : ""}</p>
            </div>
            {(i > 0 || unsaved.length > 0) && (confirming === v.sha ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{unsaved.length ? "Save or discard the unsaved changes first." : "Restore this version? Later versions stay in the history."}</span>
                {!unsaved.length && <Button size="sm" onClick={() => { setConfirming(null); onRestore(v.short); }} disabled={busy}>Restore</Button>}
                <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
              </div>
            ) : (
              i > 0 && <Button size="sm" variant="outline" onClick={() => setConfirming(v.sha)}>Restore…</Button>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}
