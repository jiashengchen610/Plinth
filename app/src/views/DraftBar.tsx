import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type Change, type Op } from "@/lib/api";
import { describeOp, type Graph } from "@/lib/tokens";

type Props = { draft: Op[]; g: Graph; onRemove: (index: number) => void; onDiscard: () => void; onSend: (title: string) => Promise<void> };

/**
 * Edits made in the token graph or a component's token panel, not written yet. The engine previews them live
 * (contrast before → after, look-alike roles, guideline notes); "Send to Changes" turns them into one proposal.
 */
export function DraftBar({ draft, g, onRemove, onDiscard, onSend }: Props) {
  const [preview, setPreview] = useState<Change["preview"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!draft.length) { setPreview(null); return; }
    const t = setTimeout(() => {
      api.previewDraft(draft).then((p) => { setPreview(p); setError(null); }).catch((e) => setError((e as Error).message));
    }, 350);
    return () => clearTimeout(t);
  }, [draft]);

  if (!draft.length) return null;
  const worse = (preview?.contrastChanges ?? []).filter((c) => !c.pass && !c.accepted);
  const better = (preview?.contrastChanges ?? []).filter((c) => c.pass && c.before !== null && c.before < c.min);
  const send = async () => {
    setSending(true);
    try { await onSend(title.trim() || (draft.length === 1 ? describeOp(draft[0], g) : `${draft.length} token edits`)); setTitle(""); } finally { setSending(false); }
  };

  return (
    <div role="region" aria-label="Draft" className="sticky top-[57px] z-[9] mx-4 mt-3 flex flex-col gap-2 rounded-lg border border-info/50 bg-background/95 px-4 py-2 text-sm shadow-sm backdrop-blur sm:mx-6">
      <div className="flex flex-wrap items-center gap-2">
        <strong>Draft</strong>
        <span className="text-muted-foreground">{draft.length} edit{draft.length > 1 ? "s" : ""}, not written yet</span>
        {preview && (
          <span className="flex flex-wrap gap-1">
            {worse.length > 0 && <Badge variant="destructive">{worse.length} contrast reminder{worse.length > 1 ? "s" : ""}</Badge>}
            {better.length > 0 && <Badge variant="success">{better.length} contrast fixed</Badge>}
            {(preview.distinctFailures?.length ?? 0) > 0 && <Badge variant="warning">{preview.distinctFailures!.length} look-alike</Badge>}
            {(preview.notes?.length ?? 0) > 0 && <Badge variant="warning">{preview.notes!.length} guideline note{preview.notes!.length > 1 ? "s" : ""}</Badge>}
            {preview.issues.length > 0 && <Badge variant="destructive">{preview.issues.length} broken reference{preview.issues.length > 1 ? "s" : ""}</Badge>}
            {!worse.length && !preview.distinctFailures?.length && !preview.notes?.length && !preview.issues.length && <Badge variant="secondary">No reminders</Badge>}
          </span>
        )}
        {error && <span className="text-destructive">{error}</span>}
        <span className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Details"}</Button>
          <Button size="sm" variant="ghost" onClick={onDiscard}>Discard</Button>
        </span>
      </div>
      {open && (
        <div className="flex flex-col gap-2 border-t pt-2">
          <ul className="flex flex-col gap-0.5">
            {draft.map((op, i) => (
              <li key={i} className="flex items-center gap-2 font-mono text-xs">
                <span className="min-w-0 truncate">{describeOp(op, g)}</span>
                <button type="button" className="ml-auto text-muted-foreground underline" onClick={() => onRemove(i)}>remove</button>
              </li>
            ))}
          </ul>
          {worse.length > 0 && <ul className="list-disc pl-5 text-xs">{worse.slice(0, 8).map((c) => <li key={`${c.brand}${c.mode}${c.bg}${c.fg}`}>{c.fg} on {c.bg} ({c.brand}, {c.mode === "default" ? "light" : c.mode}): {c.before ?? "–"} → {c.ratio}, needs {c.min}</li>)}</ul>}
          {(preview?.notes ?? []).length > 0 && <ul className="list-disc pl-5 text-xs">{preview!.notes!.map((n) => <li key={n}>{n}</li>)}</ul>}
          {(preview?.issues ?? []).length > 0 && <ul className="list-disc pl-5 text-xs text-destructive">{preview!.issues.map((n) => <li key={n}>{n}</li>)}</ul>}
        </div>
      )}
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label htmlFor="draft-title" className="sr-only">Name of this change</label>
        <input id="draft-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={draft.length === 1 ? describeOp(draft[0], g) : `${draft.length} token edits`} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" />
        <Button size="sm" type="submit" disabled={sending}>{sending ? "Sending…" : "Send to Changes"}</Button>
      </form>
    </div>
  );
}
