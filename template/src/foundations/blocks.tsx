/**
 * Building blocks for the Foundations pages (Introduction, Colors, Typography, Shape, Guidelines).
 * Managed by Plinth: this folder is rewritten from the template, and tokens.generated.json is regenerated from
 * the token files on every change. Swatches and samples use the CSS variables, so they follow the brand and mode
 * chosen in the toolbar; the values and contrast numbers come from the generated data.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Markdown, Unstyled } from "@storybook/addon-docs/blocks";
import { Badge } from "@/components/badge/badge";
import { Button } from "@/components/button/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/card/card";
import { Input } from "@/components/input/input";
import { Label } from "@/components/label/label";
import { icons } from "@/icons";
import data from "./tokens.generated.json";

type Value = { raw: unknown; css: string | null; resolved: string | null; alpha?: number };
type Token = { name: string; path: string; group: string; type: string; description?: string; layer: string | null; refs: string[]; values: Record<string, Value> };
type Contrast = { mode: string; bg: string; fg: string; ratio: number | null; min: number; pass: boolean; accepted: boolean };
type Brand = { name: string; modes: string[]; tokens: Token[]; contrast: Contrast[] };
const foundations = data as unknown as { name: string; context: string; defaultBrand: string; layers: { id: string; name: string }[]; brands: Record<string, Brand> };
/** Semantic roles: everything that is neither the palette nor a component's own token. */
const isRole = (t: Token) => t.layer !== "primitives" && t.layer !== "components";

// Guidelines are read straight from the repository, so the pages always show the current text.
const sharedDesign = import.meta.glob("../../DESIGN.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const writing = import.meta.glob("../../WRITING.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const brandDesign = import.meta.glob("../../brands/*/DESIGN.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** The brand and mode the toolbar applied to <html> (see .storybook/preview.tsx). */
export function useBrandMode() {
  const read = () => {
    const el = document.documentElement;
    const id = el.dataset.brand && foundations.brands[el.dataset.brand] ? el.dataset.brand : foundations.defaultBrand;
    return { id, brand: foundations.brands[id], mode: el.classList.contains("dark") ? "dark" : "light" };
  };
  const [state, setState] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setState(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-brand"] });
    return () => obs.disconnect();
  }, []);
  return state;
}

const valueIn = (t: Token, mode: string) => t.values[mode] ?? t.values.light;
const show = (v: Value | undefined) => {
  if (!v) return "";
  if (typeof v.raw === "string" || typeof v.raw === "number") return String(v.raw);
  return v.css ?? JSON.stringify(v.raw);
};

/**
 * A panel in the current brand and mode, so dark mode shows on dark surfaces. Unstyled keeps Storybook's docs
 * typography (heading colors, code font) out, so what shows is the design system's own styling.
 */
export function Surface({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <Unstyled>
      <div className={`mb-8 rounded-xl border bg-background p-6 font-sans text-foreground ${className}`}>{children}</div>
    </Unstyled>
  );
}

/**
 * Guideline Markdown inside a page: headings move one level down under the page's own sections, and a literal
 * "<" outside code (e.g. brands/<id>/DESIGN.md) stays text instead of becoming an HTML tag.
 */
const embedMarkdown = (md: string) =>
  md.replace(/^# .*\n+/, "").replace(/^(#{2,5}) /gm, "#$1 ").replace(/`[^`\n]*`|</g, (m) => (m === "<" ? "&lt;" : m));

function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

// ---------------------------------------------------------------- colors

function ContrastBadge({ c }: { c?: Contrast }) {
  if (!c) return null;
  const label = c.ratio === null ? "n/a" : `${c.ratio.toFixed(2)}:1`;
  return <Badge variant={c.pass ? "secondary" : c.accepted ? "outline" : "destructive"}>{c.pass ? `AA ${label}` : c.accepted ? `${label} accepted` : `${label} below ${c.min}`}</Badge>;
}

/** Every color: pairs (X with X-foreground) as surfaces with text on them, the rest as swatches. */
export function ColorPalette() {
  const { brand, mode } = useBrandMode();
  const colors = brand.tokens.filter((t) => t.type === "color" && isRole(t));
  const names = new Set(colors.map((t) => t.name));
  const pairs = colors.filter((t) => names.has(`${t.name}-foreground`));
  const paired = new Set(pairs.flatMap((t) => [t.name, `${t.name}-foreground`]));
  const singles = colors.filter((t) => !paired.has(t.name));
  const contrastOf = (bg: string, fg: string) => brand.contrast.find((c) => c.mode === mode && c.bg === bg && c.fg === fg);
  return (
    <Surface className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Surfaces and the text on them</h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
          {pairs.map((t) => {
            const fg = colors.find((x) => x.name === `${t.name}-foreground`)!;
            return (
              <div key={t.name} className="flex flex-col overflow-hidden rounded-lg border">
                <div className="flex h-24 items-end p-3" style={{ background: `var(--${t.name})`, color: `var(--${fg.name})` }}>
                  <span className="text-lg font-semibold">Aa {t.name}</span>
                </div>
                <div className="flex flex-col gap-1.5 p-3 text-xs">
                  <code>--{t.name}: {show(valueIn(t, mode))}</code>
                  <code>--{fg.name}: {show(valueIn(fg, mode))}</code>
                  <div><ContrastBadge c={contrastOf(t.name, fg.name)} /></div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Page, borders and focus</h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-4">
          {singles.map((t) => (
            <div key={t.name} className="flex flex-col gap-2">
              <div className="h-14 rounded-lg border" style={{ background: `var(--${t.name})` }} />
              <code className="text-xs font-semibold">{t.name}</code>
              <code className="text-xs text-muted-foreground">{show(valueIn(t, mode))}</code>
              {t.name === "foreground" && <div><ContrastBadge c={contrastOf("background", "foreground")} /></div>}
              {t.name === "muted-foreground" && <div><ContrastBadge c={contrastOf("background", "muted-foreground")} /></div>}
            </div>
          ))}
        </div>
      </section>
      <Note>Showing <strong>{brand.name}</strong> in <strong>{mode}</strong> mode. Switch brand and mode in the toolbar. Contrast is WCAG 2 for text (4.5:1).</Note>
    </Surface>
  );
}

// ---------------------------------------------------------------- typography

const SAMPLE = "The quick brown fox jumps over the lazy dog. 0123456789";

const FONT_ROLES: Record<string, string> = { heading: "Headings", body: "Text", label: "Buttons and labels", code: "Code" };
type Style = { fontFamily?: unknown; fontSize?: { value: number; unit: string }; fontWeight?: number; lineHeight?: number };
const aliasOf = (v: unknown) => (typeof v === "string" && /^\{.+\}$/.test(v) ? v.slice(1, -1) : null);
const familyName = (v: Value | undefined) => (v?.resolved ?? "").split(",")[0].trim().replace(/^['"]|['"]$/g, "");

/** Three layers of text: fonts in the palette, font roles and text styles, and each component's text tokens. */
export function TypeScale() {
  const { brand, mode } = useBrandMode();
  const roles = brand.tokens.filter((t) => t.type === "fontFamily" && t.layer !== "primitives" && FONT_ROLES[t.path.split("/").at(-1) ?? ""]);
  const loaded = brand.tokens.filter((t) => t.type === "fontFamily" && t.layer === "primitives");
  const styles = brand.tokens.filter((t) => t.type === "typography" && t.layer !== "components" && typeof valueIn(t, mode).raw === "object");
  const parts = brand.tokens.filter((t) => t.type === "typography" && t.layer === "components");
  const styleLabel = (path: string) => path.replace(/^typography\//, "").replace(/\//g, " ");
  return (
    <Surface className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Fonts</h3>
        <p className="text-sm text-muted-foreground">Each kind of text uses a font role; the roles point at the fonts this design system loads ({loaded.map((t) => familyName(valueIn(t, mode))).join(", ")}).</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {roles.map((t) => (
            <div key={t.name} className="flex flex-col gap-1 rounded-lg border p-4">
              <span className="text-xs text-muted-foreground">{FONT_ROLES[t.path.split("/").at(-1) ?? ""]} · <code>font-{t.name.replace(/-font$/, "")}</code></span>
              <p className="text-2xl" style={{ fontFamily: `var(--${t.name})` }}>{familyName(valueIn(t, mode))}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-4">
        <h3 className="text-base font-semibold">Text styles</h3>
        {styles.map((t) => {
          const v = valueIn(t, mode).raw as Style;
          const role = aliasOf(v.fontFamily)?.split(".").at(-1);
          return (
            <div key={t.name} className="flex flex-col gap-1 border-b pb-4 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                <code className="font-semibold text-foreground">{styleLabel(t.path)}</code>
                {role && <span>{FONT_ROLES[role] ?? role} font</span>}
                {v.fontSize && <span>{v.fontSize.value}{v.fontSize.unit}</span>}
                {v.fontWeight && <span>weight {v.fontWeight}</span>}
                {v.lineHeight && <span>line height {v.lineHeight}</span>}
                <code>type-{t.name.replace(/-font$/, "")}</code>
              </div>
              <p style={{ font: `var(--${t.name})` }}>{SAMPLE}</p>
            </div>
          );
        })}
      </section>
      {parts.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-base font-semibold">Text in components</h3>
          <p className="text-sm text-muted-foreground">Each component's text points at a text style, so changing a style changes every component that uses it.</p>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {parts.map((t) => {
              const target = aliasOf(valueIn(t, mode).raw);
              return (
                <div key={t.name} className="flex items-baseline justify-between gap-3 border-b py-1.5">
                  <span style={{ font: `var(--${t.name})` }}>{t.path.split("/").slice(0, -1).join(" ")}</span>
                  <code className="text-xs text-muted-foreground">{target ? styleLabel(target.replace(/\./g, "/")) : show(valueIn(t, mode))}</code>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </Surface>
  );
}

// ---------------------------------------------------------------- shape, elevation, motion

const RADII = ["sm", "md", "lg", "xl", "2xl"] as const;

export function ShapeScale() {
  const { brand, mode } = useBrandMode();
  const shadows = brand.tokens.filter((t) => t.type === "shadow");
  const motion = brand.tokens.filter((t) => t.type === "transition" || t.type === "cubicBezier" || t.type === "duration");
  const radius = brand.tokens.find((t) => t.name === "radius");
  return (
    <Surface className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Corner radius</h3>
        <Note>Base radius {radius ? <code>{show(valueIn(radius, mode))}</code> : null}; the scale derives from it.</Note>
        <div className="flex flex-wrap gap-4">
          {RADII.map((r) => (
            <div key={r} className="flex flex-col items-center gap-2">
              <div className="size-20 border-2 border-primary bg-muted" style={{ borderRadius: `var(--radius-${r})` }} />
              <code className="text-xs">rounded-{r}</code>
            </div>
          ))}
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Elevation</h3>
        <div className="flex flex-wrap gap-6">
          {shadows.map((t) => (
            <div key={t.name} className="flex flex-col gap-2">
              <div className="h-24 w-40 rounded-lg bg-card" style={{ boxShadow: `var(--${t.name})` }} />
              <code className="text-xs">shadow-{t.name.replace(/-shadow$/, "")}</code>
            </div>
          ))}
        </div>
      </section>
      {motion.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">Motion</h3>
          {motion.map((t) => <code key={t.name} className="text-xs">--{t.name}: {valueIn(t, mode).resolved ?? show(valueIn(t, mode))}</code>)}
        </section>
      )}
    </Surface>
  );
}

// ---------------------------------------------------------------- icons

/** Every icon in icons/, by the name components import it under (check.svg → CheckIcon from "@/icons"). */
export function IconGallery() {
  const list = Object.entries(icons);
  const pascal = (n: string) => n.split("-").map((s) => s[0].toUpperCase() + s.slice(1)).join("") + "Icon";
  return (
    <Surface className="flex flex-col gap-4">
      <Note>{list.length} icons. They inherit the text color and scale with the text; add more by asking Plinth, or put your own SVG files in <code>icons/</code>.</Note>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {list.map(([name, Icon]) => (
          <div key={name} className="flex flex-col items-center gap-2 rounded-lg border p-4 text-center">
            <Icon className="size-6" />
            <code className="text-xs break-all">{pascal(name)}</code>
          </div>
        ))}
      </div>
    </Surface>
  );
}

// ---------------------------------------------------------------- palette and component tokens

const SHADE_ORDER = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const refName = (key: string) => key.split("/").slice(key.startsWith("color/") ? 1 : 0).join("-");

/** The bottom layer: every palette hue as a row of steps, and which semantic roles use each step. */
export function Palette() {
  const { brand, mode } = useBrandMode();
  const palette = brand.tokens.filter((t) => t.layer === "primitives" && t.type === "color");
  const usedBy = new Map<string, string[]>();
  for (const t of brand.tokens) if (isRole(t)) for (const r of t.refs) usedBy.set(r, [...(usedBy.get(r) ?? []), t.name]);
  const hues = [...new Set(palette.map((t) => t.path.split("/")[1]))];
  if (!palette.length) return <Surface><Note>This design system has no palette layer yet.</Note></Surface>;
  return (
    <Surface className="flex flex-col gap-2 overflow-x-auto">
      <div className="grid min-w-[44rem] grid-cols-[6rem_repeat(11,minmax(0,1fr))] gap-1 text-xs">
        <span />
        {SHADE_ORDER.map((s) => <span key={s} className="text-center text-muted-foreground">{s}</span>)}
        {hues.map((hue) => {
          const steps = palette.filter((t) => t.path.split("/")[1] === hue);
          if (steps.length === 1) return null;
          return [
            <span key={hue} className="self-center font-medium">{hue}</span>,
            ...SHADE_ORDER.map((s) => {
              const t = steps.find((x) => x.path.endsWith(`/${s}`));
              const users = t ? usedBy.get(t.path) ?? [] : [];
              return (
                <div key={`${hue}-${s}`} title={t ? `${hue}-${s}: ${show(valueIn(t, mode))}${users.length ? `\nused by ${users.join(", ")}` : ""}` : ""} className="relative h-9 rounded-md border" style={{ background: t ? `var(--${t.name})` : "transparent" }}>
                  {users.length > 0 && <span className="absolute inset-x-0 bottom-0.5 text-center text-[10px] font-semibold text-white mix-blend-difference">{users.length}</span>}
                </div>
              );
            }),
          ];
        })}
      </div>
      <Note>A number on a step: how many semantic roles use it in <strong>{brand.name}</strong> ({mode}). Hover for names.</Note>
    </Surface>
  );
}

/** Each component's own tokens, what they point at, and the color they end up as. */
export function ComponentTokens() {
  const { brand, mode } = useBrandMode();
  const tokens = brand.tokens.filter((t) => t.layer === "components");
  const components = [...new Set(tokens.map((t) => t.path.split("/")[0]))];
  if (!tokens.length) return <Surface><Note>This design system has no component tokens yet.</Note></Surface>;
  return (
    <Surface className="flex flex-col gap-6">
      {components.map((c) => (
        <section key={c} className="flex flex-col gap-2">
          <h3 className="text-base font-semibold capitalize">{c}</h3>
          <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_2rem] gap-x-3 gap-y-1.5 text-xs">
            {tokens.filter((t) => t.path.split("/")[0] === c).map((t) => {
              const v = valueIn(t, mode);
              return [
                <code key={`${t.name}-n`} className="truncate">{t.name}</code>,
                <code key={`${t.name}-r`} className="truncate text-muted-foreground">{t.refs.length ? `→ ${t.refs.map(refName).join(", ")}${(v?.alpha ?? 1) < 1 ? ` · ${Math.round((v.alpha ?? 1) * 100)}%` : ""}` : show(v)}</code>,
                t.type === "color" ? <span key={`${t.name}-s`} className="h-4 w-8 rounded border" style={{ background: `var(--${t.name})` }} /> : <span key={`${t.name}-s`} />,
              ];
            })}
          </div>
        </section>
      ))}
      <Note>Change a component's look by pointing its tokens at other roles, or change the role for every component that uses it.</Note>
    </Surface>
  );
}

// ---------------------------------------------------------------- guidelines

const one = (files: Record<string, string>) => Object.values(files)[0] ?? "";
/** Markdown files as written in the repository; the brand's own DESIGN.md follows the toolbar. */
export function Guideline({ doc }: { doc: "brand" | "shared" | "writing" }) {
  const { id } = useBrandMode();
  const text = doc === "shared" ? one(sharedDesign) : doc === "writing" ? one(writing) : brandDesign[`../../brands/${id}/DESIGN.md`] ?? "";
  return text ? <Markdown>{embedMarkdown(text)}</Markdown> : <Note>This file does not exist yet.</Note>;
}

/** The brand's one-line description: the first paragraph of its DESIGN.md. */
export function BrandSummary() {
  const { id, brand } = useBrandMode();
  const md = brandDesign[`../../brands/${id}/DESIGN.md`] ?? "";
  const intro = md.split(/\n## /)[0].replace(/^# .*\n+/, "").trim();
  const overview = md.match(/\n## Overview\s*\n+([\s\S]*?)(\n## |$)/)?.[1]?.trim();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-lg"><strong>{brand.name}</strong>{intro ? ` · ${intro.split("\n")[0]}` : ""}</p>
      {overview && <Markdown>{embedMarkdown(overview)}</Markdown>}
    </div>
  );
}

// ---------------------------------------------------------------- showcase

/** The base components working together, in the current brand and mode. */
export function Showcase() {
  const { brand, mode } = useBrandMode();
  const [sent, setSent] = useState(false);
  return (
    <Surface className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Stay in the loop</CardTitle>
          <CardDescription>News and offers from {foundations.name}, twice a month.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="showcase-email">Email</Label>
          <Input id="showcase-email" type="email" placeholder="you@example.com" />
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button onClick={() => setSent(true)}>{sent ? "Subscribed" : "Subscribe"}</Button>
          <Button variant="ghost" onClick={() => setSent(false)}>Not now</Button>
        </CardFooter>
      </Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge>New</Badge>
          <Badge variant="success">Confirmed</Badge>
          <Badge variant="warning">Few left</Badge>
          <Badge variant="info">Tomorrow</Badge>
          <Badge variant="destructive">Sold out</Badge>
          <Badge variant="outline">Draft</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="destructive">Delete</Button>
        </div>
        <p className="text-sm text-muted-foreground">{brand.name} · {mode} mode. Use the toolbar to compare brands and modes.</p>
      </div>
    </Surface>
  );
}

export const meta = { name: foundations.name, context: foundations.context, brandCount: Object.keys(foundations.brands).length };
