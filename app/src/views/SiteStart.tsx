import type { MainPick, SitePicks, SiteRead } from "@/lib/api";

type Props = {
  url: string; onUrl: (v: string) => void; onRead: () => void;
  reading: boolean; read: SiteRead | null;
  /** The picks as the user has them now (they can switch the main color and the fonts). */
  picks: SitePicks | null; onPicks: (p: SitePicks) => void;
};

const host = (u: string) => { try { return new URL(/^https?:/.test(u) ? u : `https://${u}`).hostname; } catch { return u; } };
const px = (v: number | "pill" | null | undefined) => (v === "pill" ? "pill-shaped" : v == null ? "not found" : `${v} px`);
const radius = (v: number | "pill" | null | undefined) => (v === "pill" ? "9999px" : v == null ? undefined : `${v}px`);

function Swatch({ color, big }: { color: string; big?: boolean }) {
  return <span className={`inline-block flex-none rounded-md border ${big ? "size-9" : "size-6"}`} style={{ background: color }} />;
}

/** Describe's "Start from a website": the address, then what Plinth read, checked and adjusted before it is used. */
export function SiteStart({ url, onUrl, onRead, reading, read, picks, onPicks }: Props) {
  const found = read?.look.found;
  const mainOptions: [string, MainPick, string][] = [];
  if (read?.look.picks.main && found?.main) mainOptions.push(["buttons", read.look.picks.main, found.main.from === "buttons" ? "Its main buttons" : found.main.from === "logo" ? "Its logo" : "The page"]);
  if (read?.accent && found?.accent) mainOptions.push(["accent", read.accent, "Its second brand color"]);
  const fonts = picks?.fonts;
  const setFonts = (patch: Partial<NonNullable<SitePicks["fonts"]>>) => picks && fonts && onPicks({ ...picks, fonts: { ...fonts, ...patch } });
  // "MonzoSansText" → "Monzo Sans Text", as the family is read out loud.
  const spaced = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1 $2");
  const standIn = (f: { family: string; from: string; free: boolean } | null | undefined) =>
    f && !f.free ? <span className="text-xs text-muted-foreground">Instead of {spaced(f.from)}, the site's own font, which isn't free to use.</span> : null;

  return (
    <section aria-label="Start from a website" className="flex flex-col gap-4 rounded-2xl border bg-background p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Start from a website</h2>
        <p className="text-sm text-muted-foreground">Paste the address of a site whose look you like. Plinth opens it in a hidden browser on this computer and reads its colors, corners and fonts. You check what it found, then answer the other questions as usual. Only these values are used: no text, pictures or logos.</p>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (url.trim() && !reading) onRead(); }} className="flex flex-wrap gap-2">
        <label htmlFor="site-url" className="sr-only">Website address</label>
        <input id="site-url" value={url} onChange={(e) => onUrl(e.target.value)} disabled={reading} placeholder="For example: monzo.com" inputMode="url" autoComplete="url"
          className="h-11 flex-[1_1_240px] rounded-lg border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" />
        <button type="submit" disabled={reading || !url.trim()} className="min-h-11 rounded-lg border-2 border-border px-3.5 text-sm font-semibold disabled:opacity-50">{read ? "Read again" : "Read the site"}</button>
      </form>
      {reading && <p role="status" className="text-sm text-muted-foreground">Reading {host(url)} in a hidden browser… usually 20 to 40 seconds.</p>}

      {read && found && picks && !reading && (
        <div className="flex flex-col gap-4 rounded-xl border p-4">
          <div className="flex items-center gap-2.5">
            {read.favicon && <img src={read.favicon} alt="" className="size-6 rounded" />}
            <span className="font-semibold">{found.name ?? host(read.url)}</span>
            <a href={read.url} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground underline underline-offset-2">{host(read.url)}</a>
            <span className="ml-auto text-xs text-muted-foreground">Read in {read.seconds} s</span>
          </div>

          <dl className="grid gap-x-4 gap-y-3.5 sm:grid-cols-[9rem_1fr]">
            <dt className="text-sm font-semibold">Main color</dt>
            <dd className="flex flex-wrap gap-2">
              {mainOptions.length === 0 && <span className="text-sm text-muted-foreground">Not found: you pick it in the palette question.</span>}
              {mainOptions.map(([id, m, from]) => {
                const on = picks.main?.color === m.color;
                return (
                  <button key={id} type="button" aria-pressed={on} onClick={() => onPicks({ ...picks, main: m })}
                    className={`flex min-h-11 items-center gap-2.5 rounded-lg border-2 px-3 py-1.5 text-left ${on ? "border-foreground" : "border-border"}`}>
                    <Swatch color={m.color} big />
                    <span className="flex flex-col"><span className="font-mono text-sm">{m.color}</span><span className="text-xs text-muted-foreground">{from}</span></span>
                  </button>
                );
              })}
            </dd>

            <dt className="text-sm font-semibold">Grays</dt>
            <dd className="flex flex-wrap items-center gap-1" title={found.gray}>
              {read.swatches.gray.map((c) => <Swatch key={c} color={c} />)}
              {found.background && <span className="ml-2 text-xs text-muted-foreground">Page background {found.background}{picks.background ? "" : " (the design system starts on white)"}</span>}
            </dd>

            <dt className="text-sm font-semibold">Corners</dt>
            <dd className="flex flex-wrap items-center gap-3">
              <span className="px-4 py-2 text-sm font-semibold text-white" style={{ background: picks.main?.color ?? "#111", borderRadius: radius(found.corners.buttons) }}>Button</span>
              <span className="block h-10 w-28 border-[1.5px]" style={{ borderRadius: radius(found.corners.cards) }} />
              <span className="text-sm text-muted-foreground">Buttons {px(found.corners.buttons)} · cards {px(found.corners.cards)}</span>
            </dd>

            <dt className="text-sm font-semibold">Fonts</dt>
            <dd className="flex flex-col gap-2.5">
              {fonts ? (
                <>
                  <label className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-20 text-muted-foreground">Text</span>
                    <input value={fonts.font} onChange={(e) => setFonts({ font: e.target.value })} aria-label="Text font" className="h-10 w-48 rounded-lg border bg-background px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ fontFamily: `'${fonts.font}', sans-serif` }} />
                    {standIn(found.fonts.body)}
                  </label>
                  <label className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-20 text-muted-foreground">Headings</span>
                    <input value={fonts.headingFont} onChange={(e) => setFonts({ headingFont: e.target.value })} placeholder="Same as text" aria-label="Headings font" className="h-10 w-48 rounded-lg border bg-background px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ fontFamily: `'${fonts.headingFont || fonts.font}', sans-serif` }} />
                    {found.fonts.heading && found.fonts.heading.from !== found.fonts.body?.from && standIn(found.fonts.heading)}
                  </label>
                  <span className="text-xs text-muted-foreground">Any family on Google Fonts works; you can change them later in Style.</span>
                </>
              ) : <span className="text-sm text-muted-foreground">Not found: you pick one in the font question.</span>}
            </dd>
          </dl>

          {read.look.notes.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
              {read.look.notes.filter((n) => !/isn't free|not free/.test(n)).map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
