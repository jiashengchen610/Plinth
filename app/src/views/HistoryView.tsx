import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { State } from "@/lib/api";
import { Cta } from "@/lib/cta";
import { timeAgo } from "@/lib/format";
import { fileName, isGenerated } from "@/lib/plain";

type Props = {
  state: State; busy: boolean; backLabel: string; onBack: () => void;
  onSave: (message: string) => void; onDiscard: () => void; onRestore: (sha: string) => void;
};

/** What changed, what's saved, and going back. Saving a version is a git commit; nothing here goes online. */
export function HistoryView({ state, busy, backLabel, onBack, onSave, onDiscard, onRestore }: Props) {
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState(false);
  const unsaved = state.unsaved ?? [];
  const groups = [...new Set(unsaved.filter((u) => !isGenerated(u.file)).map((u) => fileName(u.file)))];
  const live = state.versions.find((v) => v.published);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <p className="text-muted-foreground">Every change is kept on your computer as soon as you make it. A version is a snapshot you can come back to, and it's what you publish.</p>
      </div>
      <section className="flex flex-col gap-3 rounded-2xl border bg-background p-5">
        <h2 className="text-base font-semibold">Not in a version yet</h2>
        {!unsaved.length ? <p className="text-sm text-muted-foreground">Everything is in a version.</p> : (
          <>
            <p className="text-sm">{groups.join(", ")}{state.lastChange ? <span className="text-muted-foreground"> · last change: {state.lastChange.title}</span> : null}</p>
            <label className="flex flex-col gap-1 text-sm font-semibold">Describe this version<input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={state.lastChange?.title ?? "For example: softer corners"} className="h-11 rounded-lg border bg-background px-3 font-normal" /></label>
            {!confirm ? <button type="button" onClick={() => setConfirm(true)} className="min-h-11 self-start rounded-lg border px-3.5 text-sm font-medium text-destructive">Throw away these changes</button> : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-destructive/40 bg-destructive/5 py-2 pr-2 pl-3.5 text-sm">
                <span className="flex-[1_1_240px]">Throw away the changes since your last version? You can't get them back.</span>
                <Button variant="destructive" className="min-h-10" disabled={busy} onClick={() => { onDiscard(); setConfirm(false); }}>Throw away</Button>
                <Button variant="outline" className="min-h-10" onClick={() => setConfirm(false)}>Keep them</Button>
              </div>
            )}
          </>
        )}
      </section>
      <section className="flex flex-col rounded-2xl border bg-background p-5">
        <h2 className="mb-2 text-base font-semibold">Saved versions</h2>
        {state.versions.map((v, i) => (
          <div key={v.sha} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-muted py-2.5">
            <span className="flex min-w-0 flex-[1_1_260px] flex-col leading-snug"><span className="font-semibold">{v.subject}</span><span className="text-xs text-muted-foreground">{timeAgo(v.date)} · {v.short}</span></span>
            {live && v.sha === live.sha && <span className="rounded-full border border-success/50 bg-success/10 px-2.5 py-0.5 text-xs font-semibold">Your team sees this</span>}
            {i === 0 ? <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold">Latest</span> : (
              <Button variant="outline" className="min-h-10" disabled={busy || unsaved.length > 0} title={unsaved.length ? "Save or throw away your changes first" : undefined} onClick={() => onRestore(v.sha)}>Go back to this version</Button>
            )}
          </div>
        ))}
        {unsaved.length > 0 && state.versions.length > 1 && <p className="mt-2 text-xs text-muted-foreground">Save or throw away your changes before going back to an older version.</p>}
      </section>
      <Cta back={{ label: `← Back to ${backLabel}`, onClick: onBack }} status={unsaved.length ? `${groups.length} kind${groups.length > 1 ? "s" : ""} of change not in a version yet` : "Everything is saved"}
        next={unsaved.length ? { label: "Save version", disabled: busy, onClick: () => { onSave(message.trim() || state.lastChange?.title || "Changes"); setMessage(""); } } : undefined} />
    </div>
  );
}
