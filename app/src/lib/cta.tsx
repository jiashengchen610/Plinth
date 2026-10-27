// The bar at the bottom of the screen with a page's main action. The App owns the place (below the scrolling
// content, beside the chat); each page fills it with <Cta>, which renders there through a portal.
import { createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

export const CtaSlot = createContext<HTMLElement | null>(null);

type Action = { label: string; onClick: () => void; disabled?: boolean };
export type CtaProps = { back?: Action; alt?: Action & { danger?: boolean }; status?: string; next?: Action };

export function Cta({ back, alt, status, next }: CtaProps) {
  const slot = useContext(CtaSlot);
  if (!slot) return null;
  return createPortal(
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-background px-4 py-3">
      {back && <Button variant="outline" size="lg" onClick={back.onClick} disabled={back.disabled}>{back.label}</Button>}
      {alt && <button type="button" onClick={alt.onClick} disabled={alt.disabled} className={`min-h-11 px-1 text-sm font-medium underline underline-offset-2 disabled:opacity-50 ${alt.danger ? "text-destructive" : "text-info"}`}>{alt.label}</button>}
      <span role="status" className="min-w-0 flex-[1_1_160px] text-right text-sm text-muted-foreground">{status}</span>
      {next && <Button size="lg" onClick={next.onClick} disabled={next.disabled} className="min-h-11 px-5">{next.label}</Button>}
    </div>,
    slot,
  );
}

/** Loads Google Fonts families for previews in this UI (the design system itself loads its fonts the same way). */
export function fontsHref(families: (string | null | undefined)[]) {
  const list = [...new Set(families.filter((f): f is string => Boolean(f)))];
  if (!list.length) return null;
  return `https://fonts.googleapis.com/css2?${list.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;600;700`).join("&")}&display=swap`;
}
