// A confirmation before something that deletes work: it says exactly what goes and how to get it back. Focus starts on
// the safe choice; Esc and the backdrop cancel.
import { useEffect, useRef, type ReactNode } from "react";

type Props = { title: string; children: ReactNode; confirm: string; cancel: string; busy?: boolean; onConfirm: () => void; onCancel: () => void };

export function ConfirmDialog({ title, children, confirm, cancel, busy = false, onConfirm, onCancel }: Props) {
  const safe = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    safe.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body" onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-4 rounded-2xl border bg-background p-6 shadow-xl">
        <h2 id="confirm-title" className="text-lg font-semibold">{title}</h2>
        <div id="confirm-body" className="flex flex-col gap-2 text-sm">{children}</div>
        <div className="flex flex-wrap justify-end gap-2">
          <button ref={safe} type="button" onClick={onCancel} className="min-h-11 rounded-lg border px-4 text-sm font-semibold">{cancel}</button>
          <button type="button" disabled={busy} onClick={onConfirm} className="min-h-11 rounded-lg bg-destructive px-4 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Working…" : confirm}</button>
        </div>
      </div>
    </div>
  );
}
