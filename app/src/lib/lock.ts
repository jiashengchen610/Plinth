// One edit at a time. While an edit of yours is written, the page is locked and the control that started it pulses;
// the edit counts as done once the page has reloaded and shows its result, so the next click never lands on a page
// that is out of date. (Claude's edits lock the page for the whole reply: see App.)
import { useEffect, useState, useSyncExternalStore } from "react";

export type Pending = { label: string; since: number } | null;
let pending: Pending = null;
let count = 0;
let reload: (() => Promise<unknown>) | null = null;
let pressed: { el: Element; at: number } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

// The control that started an edit: the last one pressed, just before the edit began.
if (typeof document !== "undefined") {
  const remember = (e: Event) => {
    const el = (e.target as Element | null)?.closest?.("button, a, label, input, select, [role=button]");
    if (el) pressed = { el, at: Date.now() };
  };
  document.addEventListener("pointerdown", remember, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") remember(e); }, true);
}

/** Runs one edit: the page stays locked until it is written and the page shows the result. */
export async function edit<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const el = pressed && Date.now() - pressed.at < 1500 ? pressed.el : null;
  el?.setAttribute("data-pending", "");
  count++;
  pending ??= { label, since: Date.now() };
  emit();
  try {
    const r = await fn();
    await reload?.().catch(() => {});
    return r;
  } finally {
    el?.removeAttribute("data-pending");
    count--;
    if (!count) pending = null;
    emit();
  }
}

/** The page's reload, awaited before an edit counts as done. */
export const setReload = (fn: () => Promise<unknown>) => { reload = fn; };

export const usePendingEdit = () => useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f); }; }, () => pending);

/** `value` once it has stayed truthy for `ms`, so an edit that is done at once doesn't flash a skeleton. */
export function useAfter<T>(value: T, ms: number): T | null {
  const [shown, setShown] = useState<T | null>(null);
  useEffect(() => {
    if (!value) { setShown(null); return; }
    const t = window.setTimeout(() => setShown(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return value ? shown : null;
}
