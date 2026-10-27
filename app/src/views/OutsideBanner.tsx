import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type OutsideChange } from "@/lib/api";

type Props = { outside: OutsideChange[]; busy: boolean; onDone: (message: string) => void; onError: (message: string) => void };

/**
 * Files changed outside Plinth (by hand, another tool, or Claude Code with full permissions). They are not part of
 * any version yet; publishing and restoring wait until the user records or discards them.
 */
export function OutsideBanner({ outside, busy, onDone, onError }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [note, setNote] = useState("");
  if (!outside.length) return null;
  const record = async () => {
    try { await api.recordOutside(note); setNote(""); onDone("Outside edits saved as a version. Checks ran on them."); } catch (e) { onError((e as Error).message); }
  };
  const discard = async () => {
    try { const r = await api.discardOutside(); setConfirmDiscard(false); onDone(`Discarded changes to ${r.discarded.length} file(s).`); } catch (e) { onError((e as Error).message); }
  };
  return (
    <div role="status" className="mx-4 mt-4 flex flex-col gap-3 rounded-lg border border-warning/60 bg-warning/10 px-4 py-3 text-sm sm:mx-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0">
          <strong>{outside.length} file{outside.length === 1 ? "" : "s"} changed outside Plinth.</strong>{" "}
          They are not in any version yet. Save them as a version (checks run on them) or discard them; Publish and Restore wait until you do.{" "}
          <button type="button" className="underline" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide files" : "Show files"}</button>
        </p>
      </div>
      {open && (
        <ul className="max-h-40 overflow-auto rounded-md bg-background/60 p-2 font-mono text-xs">
          {outside.map((o) => <li key={o.file}><span className="inline-block w-16 text-muted-foreground">{o.status}</span>{o.file}</li>)}
        </ul>
      )}
      {confirmDiscard ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>Discard these changes? Files go back to the last version; new files are deleted. This cannot be undone.</span>
          <Button size="sm" variant="destructive" onClick={discard} disabled={busy}>Discard changes</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(false)}>Cancel</Button>
        </div>
      ) : (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); record(); }}>
          <label htmlFor="outside-note" className="sr-only">What changed</label>
          <input id="outside-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed (optional)" className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2" />
          <Button size="sm" type="submit" disabled={busy}>Save as a version</Button>
          <Button size="sm" type="button" variant="outline" onClick={() => setConfirmDiscard(true)} disabled={busy}>Discard…</Button>
        </form>
      )}
    </div>
  );
}
