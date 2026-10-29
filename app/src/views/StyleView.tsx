import { useMemo, useState } from "react";
import { api, exceptionKey, type ChangeResult, type Presets, type State, type TokenRow, type VocabEntry } from "@/lib/api";
import { Cta, fontsHref } from "@/lib/cta";
import { CORNER_NAMES, TAILWIND_FAMILIES, familyName, roleName } from "@/lib/plain";
import { buildGraph, type Mode } from "@/lib/tokens";
import { AddColor } from "@/views/AddColor";
import { GlassTool } from "@/views/GlassTool";
import { GradientTool } from "@/views/GradientTool";
import { StepIntro } from "@/views/StepIntro";
import { TokenMap, type QuickKind } from "@/views/TokenMap";
import { ChartColors } from "@/views/ChartColors";
import { VocabArt, vocabFontsHref } from "@/views/Vocab";

type Props = {
  state: State; presets: Presets | null; vocab?: VocabEntry[]; brand: string; mode: "light" | "dark"; onMode: (m: "light" | "dark") => void;
  onChanged: (r: Partial<ChangeResult> & { unchanged?: boolean; message?: string }, fallback: string) => void; onError: (m: string) => void;
  onBack: () => void; onNext: () => void; onAsk: (text: string) => void;
};

const MAIN_FIRST = ["teal", "blue", "emerald", "orange", "violet", "rose", "zinc"];
const GRAY_FIRST = ["slate", "neutral", "stone"];
const GRAY_LABEL: Record<string, string> = { slate: "Cool", neutral: "Neutral", stone: "Warm" };
const ring = (on: boolean) => (on ? "border-foreground" : "border-border");

/** CSS variables for a brand and mode, from the values the engine resolved: the preview paints with them. */
export function previewVars(rows: TokenRow[], mode: Mode) {
  const vars: Record<string, string> = {};
  for (const r of rows) {
    if (r.layerId === "primitives") continue;
    const v = r.values[mode] ?? r.values.default;
    const val = v?.resolved ?? v?.css;
    if (val) vars[`--${r.name}`] = val;
  }
  return vars as React.CSSProperties;
}


export function StyleView({ state, presets, vocab = [], brand, mode, onMode, onChanged, onError, onBack, onNext, onAsk }: Props) {
  const st = state.style?.[brand];
  const looks = vocab.filter((e) => e.kind === "look");
  const currentLook = looks.find((e) => e.current);
  const rows = useMemo(() => state.tokens[brand]?.rows ?? [], [state.tokens, brand]);
  const g = useMemo(() => buildGraph(state, brand), [state, brand]);
  const tmode: Mode = mode === "dark" ? "dark" : "default";
  const [busy, setBusy] = useState(false);
  const [moreMain, setMoreMain] = useState(false);
  const [moreGray, setMoreGray] = useState(false);
  const [adding, setAdding] = useState(false);

  const swatch = (fam: string, step: string) => rows.find((r) => r.path === `color/${fam}/${step}`)?.values.default?.resolved ?? null;
  const pick = async (p: { main?: string; gray?: string; corners?: string; outer?: string; inner?: string; fitInside?: boolean; font?: string; headingFont?: string; labelFont?: "body" | "heading" }, label: string) => {
    setBusy(true);
    try { onChanged(await api.style(brand, p), label); } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  };
  if (!st) return <p className="text-muted-foreground">Loading the style…</p>;

  const custom = st.hues.filter((h) => !TAILWIND_FAMILIES.has(h));
  const mains = [...new Set([...custom, ...(moreMain ? [...st.hues, ...st.grays] : MAIN_FIRST), st.main])].filter((f) => st.hues.includes(f) || st.grays.includes(f));
  const grays = [...new Set([...(moreGray ? st.grays : GRAY_FIRST), st.gray])].filter((f) => st.grays.includes(f));
  // Text fonts: the sans presets first; headings: the serifs first, then the other sans ones.
  const preset = presets?.fonts ?? [];
  const fonts = [...new Set([...preset.filter((f) => f.kind !== "serif").map((f) => f.family), ...preset.filter((f) => f.kind === "serif").map((f) => f.family), ...(st.font ? [st.font] : [])])];
  const headingFonts = [...new Set([...preset.filter((f) => f.kind === "serif").map((f) => f.family), ...(st.headingFont ? [st.headingFont] : []), ...preset.filter((f) => f.kind !== "serif").map((f) => f.family)])].filter((f) => f !== st.font);
  const moodOf = (f: string) => preset.find((x) => x.family === f)?.mood ?? "Your font";
  const href = fontsHref([...fonts, ...headingFonts]);
  const roleRows = rows.filter((r) => r.layerId === "semantic" && r.type === "color" && r.source.startsWith("brands/") && !r.path.startsWith("color/chart/"));
  const famUsed = (fam: string) => roleRows.some((r) => Object.values(r.values).some((v) => typeof v.raw === "string" && v.raw.includes(`{color.${fam}.`)));
  const vars = previewVars(rows, tmode);

  const contrast = state.checks.contrast.filter((c) => c.brand === brand && !c.pass && !c.accepted);
  const distinct = state.checks.distinct.filter((d) => d.brand === brand && !d.pass && !d.accepted);
  const nWarn = contrast.length + distinct.length;
  const modeWord = (m: string) => (m === "dark" ? " in dark mode" : m === "default" || m === "light" ? " in light mode" : ` (${m})`);
  const accept = async (check: "contrast" | "distinct", key: string) => {
    try { await api.acceptException(check, key, "Marked as on purpose in the Style step"); onChanged({ title: "Marked as on purpose" }, "Marked as on purpose."); } catch (e) { onError((e as Error).message); }
  };

  // The quick picks, opened from the top of the map (looks on every tab, then one for each kind: colors, text, corners).
  const quickLabel = (k: QuickKind) => (k === "look" ? (currentLook ? `Look: ${currentLook.name}` : "Looks") : k === "main" ? `Main color: ${familyName(st.main)}` : k === "gray" ? `Grays: ${GRAY_LABEL[st.gray] ?? familyName(st.gray)}` : k === "corners" ? `Corners: ${CORNER_NAMES[st.corners] ?? st.corners}` : `Fonts: ${st.font ?? ""}${st.headingFont ? ` + ${st.headingFont}` : ""}`);
  const applyLook = async (e: VocabEntry) => {
    setBusy(true);
    try { onChanged(await api.applyVocab(brand, e.id), `${e.name}.`); } catch (err) { onError((err as Error).message); } finally { setBusy(false); }
  };
  const lookFonts = vocabFontsHref(looks);
  const quickPanel = (k: QuickKind): React.ReactNode => {
    if (k === "look") return (
      <div className="flex flex-col gap-3">
        {lookFonts && <link rel="stylesheet" href={lookFonts} precedence="default" />}
        <div><h3 className="text-base font-semibold">Looks</h3><p className="text-sm text-muted-foreground">A whole style in one pick: colors, corners and fonts together. Fine-tune anything after; Undo takes it back.</p></div>
        {looks.length === 0 ? <p className="text-sm text-muted-foreground">Loading the looks…</p> : (
          <div className="flex flex-wrap gap-2">
            {looks.map((e) => (
              <button key={e.id} type="button" disabled={busy} aria-pressed={e.current} onClick={() => applyLook(e)} className={`flex flex-[1_1_220px] items-center gap-3 rounded-xl border-2 bg-background py-2 pr-3 pl-2 text-left ${ring(e.current)}`}>
                <VocabArt entry={e} className="size-11 rounded-lg [&>span]:h-6 [&>span]:w-9 [&>span]:text-xs" />
                <span className="flex min-w-0 flex-col leading-tight"><span className="text-sm font-semibold">{e.name}{e.current && <span className="ml-1.5 text-xs font-normal text-muted-foreground">current</span>}</span><span className="text-xs text-muted-foreground">{e.hint}</span></span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
    if (k === "main") return (
      <div className="flex flex-col gap-3">
        <div><h3 className="text-base font-semibold">Main color</h3><p className="text-sm text-muted-foreground">For buttons, links and anything people should notice.</p></div>
        <div className="flex flex-wrap gap-2">
          {mains.map((f) => (
            <button key={f} type="button" disabled={busy} aria-pressed={st.main === f} onClick={() => pick({ main: f }, `Main color: ${familyName(f)}.`)} className={`inline-flex min-h-11 items-center gap-2 rounded-full border-2 bg-background py-1 pr-3.5 pl-1.5 text-sm font-medium ${ring(st.main === f)}`}>
              <span className="size-7 rounded-full border" style={{ background: swatch(f, GRAYS_SET.has(f) ? "900" : "600") ?? undefined }} />{familyName(f)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button type="button" onClick={() => setMoreMain(!moreMain)} className="min-h-10 text-sm font-medium text-info underline underline-offset-2">{moreMain ? "Fewer colors" : "More colors"}</button>
          <button type="button" onClick={() => setAdding(!adding)} className="min-h-10 text-sm font-medium text-info underline underline-offset-2">Add your brand color</button>
        </div>
        {adding && <AddColor hint="Plinth makes lighter and darker versions of it. Then pick it above as your main color." onAdded={(r) => { onChanged(r, `Added ${r.name}.`); setAdding(false); }} onError={onError} />}
        {custom.length > 0 && (
          <div className="flex flex-wrap gap-2 text-sm">
            {custom.map((f) => (
              <span key={f} className="inline-flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1">
                <span className="size-4 rounded" style={{ background: swatch(f, "600") ?? undefined }} />{familyName(f)}
                {famUsed(f) ? <span className="text-xs text-muted-foreground">in use</span> : (
                  <button type="button" className="min-h-9 text-xs font-medium text-destructive underline" onClick={async () => { try { onChanged(await api.change(`Remove ${f} from the palette`, [{ op: "delete", file: "tokens/primitives.tokens.json", path: `color/${f}` }]), `Removed ${f}.`); } catch (e) { onError((e as Error).message); } }}>Remove</button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    );
    if (k === "gray") return (
      <div className="flex flex-col gap-3">
        <div><h3 className="text-base font-semibold">Grays</h3><p className="text-sm text-muted-foreground">For backgrounds, lines and quieter text.</p></div>
        <div className="flex flex-wrap gap-2">
          {grays.map((f) => (
            <button key={f} type="button" disabled={busy} aria-pressed={st.gray === f} onClick={() => pick({ gray: f }, `Grays: ${familyName(f)}.`)} className={`flex flex-[1_1_110px] flex-col items-start gap-2 rounded-xl border-2 bg-background px-3 py-2.5 text-sm font-semibold ${ring(st.gray === f)}`}>
              <span className="flex gap-1">{["50", "400", "900"].map((s) => <span key={s} className="size-5 rounded-md border" style={{ background: swatch(f, s) ?? undefined }} />)}</span>
              {GRAY_LABEL[f] ?? familyName(f)}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setMoreGray(!moreGray)} className="min-h-10 self-start text-sm font-medium text-info underline underline-offset-2">{moreGray ? "Fewer grays" : "More grays"}</button>
      </div>
    );
    if (k === "corners") return (
      <div className="flex flex-col gap-3">
        <div><h3 className="text-base font-semibold">Corners</h3><p className="text-sm text-muted-foreground">How round buttons, fields and cards are.</p></div>
        <div className="flex flex-wrap gap-2">
          {(presets?.corners ?? []).map((c) => (
            <button key={c.id} type="button" disabled={busy} aria-pressed={st.corners === c.id} onClick={() => pick({ corners: c.id }, `Corners: ${c.name}.`)} className={`flex flex-[1_1_100px] flex-col items-center gap-2 rounded-xl border-2 bg-background px-2 py-3 text-sm font-semibold ${ring(st.corners === c.id)}`}>
              <span className="px-3.5 py-1.5 text-xs font-semibold" style={{ background: "var(--primary)", color: "var(--primary-foreground)", borderRadius: c.control ?? undefined, ...vars }}>Button</span>
              {c.name}
            </button>
          ))}
        </div>
        {st.corners === "custom" && <p className="text-sm text-muted-foreground">Your corners are fine-tuned. Picking a preset replaces them.</p>}
        {st.outer !== null && st.inner !== null && (
          <div className="flex flex-col gap-3 border-t pt-3">
            <h4 className="text-sm font-semibold">Fine-tune</h4>
            <RadiusSteps label="Outer: cards, dialogs, menus" steps={st.radiusSteps.filter((s) => s.step !== "full")} value={st.outer} disabled={busy} onPick={(s) => pick({ outer: s }, `Outer corners: ${s}.`)} />
            <RadiusSteps label="Inner: buttons, fields, the tab bar" steps={st.radiusSteps} value={st.inner} disabled={busy} onPick={(s) => pick({ inner: s }, `Inner corners: ${s}.`)} />
          </div>
        )}
        {st.fitInside !== null && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <div><h4 className="text-sm font-semibold">Parts inside a container</h4><p className="text-sm text-muted-foreground">Tabs in the tab bar, options in a menu, close buttons in a corner.</p></div>
            <div role="group" aria-label="Parts inside a container" className="flex flex-wrap gap-2">
              {([true, false] as const).map((on) => (
                <button key={String(on)} type="button" disabled={busy} aria-pressed={st.fitInside === on} onClick={() => pick({ fitInside: on }, on ? "Parts inside fit their container." : "Parts inside keep their own corners.")} className={`flex flex-[1_1_200px] items-center gap-3 rounded-xl border-2 bg-background p-3 text-left ${ring(st.fitInside === on)}`}>
                  <svg width="44" height="32" viewBox="0 0 44 32" aria-hidden="true" className="flex-none">
                    <rect x="1" y="1" width="42" height="30" rx="12" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" />
                    <rect x="6" y="6" width="22" height="20" rx={on ? 7 : 12} fill="currentColor" fillOpacity="0.85" />
                  </svg>
                  <span className="flex flex-col leading-tight"><span className="text-sm font-semibold">{on ? "Fit its corners" : "Keep their own corners"}</span><span className="text-sm text-muted-foreground">{on ? "The gap between stays even" : "Inner corners as set above"}</span></span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
    return st.fontRoles ? (
      <div className="flex flex-col gap-4">
        <div><h3 className="text-base font-semibold">Fonts</h3><p className="text-sm text-muted-foreground">One font for text, and another for headings if you like. Buttons and labels follow either.</p></div>
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">Text</h4>
          <div className="flex flex-wrap gap-2">
            {fonts.map((f) => <FontChoice key={f} family={f} mood={moodOf(f)} on={st.font === f} disabled={busy} onPick={() => pick({ font: f }, `Text font: ${f}.`)} />)}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">Headings</h4>
          <div className="flex flex-wrap gap-2">
            <FontChoice family={st.font ?? "inherit"} name="Same as text" mood={st.font ?? ""} on={!st.headingFont} disabled={busy} onPick={() => pick({ headingFont: "" }, "Headings: same font as text.")} />
            {headingFonts.map((f) => <FontChoice key={f} family={f} mood={moodOf(f)} on={st.headingFont === f} disabled={busy} onPick={() => pick({ headingFont: f }, `Headings: ${f}.`)} />)}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">Buttons and labels</h4>
          <div role="group" aria-label="Buttons and labels" className="flex flex-wrap gap-2">
            {(["body", "heading"] as const).map((k) => {
              const family = k === "heading" ? st.headingFont ?? st.font : st.font;
              return (
                <button key={k} type="button" disabled={busy} aria-pressed={st.labelFont === k} onClick={() => pick({ labelFont: k }, `Buttons and labels: like ${k === "heading" ? "headings" : "text"}.`)} className={`flex flex-[1_1_160px] items-center gap-3 rounded-xl border-2 bg-background p-3 text-left ${ring(st.labelFont === k)}`}>
                  <span className="rounded-md bg-foreground px-2.5 py-1 text-sm font-medium text-background" style={{ fontFamily: `'${family}', sans-serif` }}>Save</span>
                  <span className="flex flex-col leading-tight"><span className="text-sm font-semibold">Like {k === "heading" ? "headings" : "text"}</span><span className="text-sm text-muted-foreground">{family}</span></span>
                </button>
              );
            })}
          </div>
          {!st.headingFont && <p className="text-xs text-muted-foreground">Headings use the text font now, so both look the same until you pick a headings font.</p>}
        </div>
      </div>
    ) : (
      <div className="flex flex-col gap-3">
        <div><h3 className="text-base font-semibold">Font</h3><p className="text-sm text-muted-foreground">Used for headings and text. Upgrade this design system (at the top) to pick a font for headings and buttons too.</p></div>
        <div className="flex flex-wrap gap-2">
          {fonts.map((f) => <FontChoice key={f} family={f} mood={moodOf(f)} on={st.font === f} disabled={busy} onPick={() => pick({ font: f }, `Font: ${f}.`)} />)}
        </div>
      </div>
    );
  };
  const lookAt = (
    <section className="flex flex-col gap-2 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">Things to look at</h3>
      {!nWarn && <p className="text-sm text-muted-foreground">Nothing right now. Plinth checks every change for text that's hard to read and colors that look alike.</p>}
      {contrast.map((c) => (
        <div key={exceptionKey.contrast(c)} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/50 bg-warning/10 py-2 pr-2 pl-3.5 text-sm">
          <span className="flex-[1_1_200px]">{roleName(c.fg)} is hard to read on {roleName(c.bg.replace(/\/\d+$/, ""))}{modeWord(c.mode)}.</span>
          <button type="button" onClick={async () => { try { onChanged(await api.fixContrast(), "Contrast fixed."); } catch (e) { onError((e as Error).message); } }} className="min-h-10 rounded-lg bg-foreground px-3.5 text-sm font-semibold text-background">Fix it</button>
          <button type="button" onClick={() => accept("contrast", exceptionKey.contrast(c))} className="min-h-10 rounded-lg border px-3 text-sm font-medium">That's on purpose</button>
        </div>
      ))}
      {distinct.map((d) => (
        <div key={exceptionKey.distinct(d)} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/50 bg-warning/10 py-2 pr-2 pl-3.5 text-sm">
          <span className="flex-[1_1_200px]">{roleName(d.a)} and {roleName(d.b)} look almost the same{modeWord(d.mode)}, so people may mix them up.</span>
          <button type="button" onClick={() => onAsk(`${roleName(d.a)} and ${roleName(d.b)} look too similar. Make them easier to tell apart.`)} className="min-h-10 rounded-lg bg-foreground px-3.5 text-sm font-semibold text-background">Ask Claude</button>
          <button type="button" onClick={() => accept("distinct", exceptionKey.distinct(d))} className="min-h-10 rounded-lg border px-3 text-sm font-medium">That's on purpose</button>
        </div>
      ))}
    </section>
  );

  return (
    <div className="flex flex-col gap-4">
      {href && <link rel="stylesheet" href={href} precedence="default" />}
      <StepIntro n={2} title="Style" decide="The values every component shares: colors, text, corners and effects, from the base values up to the parts that use them."
        change="Click any token in the map to light up what it connects to and see where it is used; change it on the right, or with the quick picks at the top. Or tell Claude in the chat. Undo takes changes back."
        done="Nothing blocks publishing, and each thing to look at is fixed or marked as on purpose." />
      <TokenMap state={state} g={g} brand={brand} mode={mode} onMode={onMode} catalog={presets?.components} quick={quickPanel} quickLabel={quickLabel} idle={lookAt} onChanged={onChanged} onError={onError} onAsk={onAsk} />
      {state.brands.length === 1 && (
        <section className="flex flex-wrap items-center gap-3 rounded-2xl border bg-background px-5 py-4">
          <span className="flex-[1_1_240px] text-sm"><strong>More than one brand?</strong> Same components, different colors and fonts.</span>
          <button type="button" onClick={() => onAsk("Add a second brand called ")} className="min-h-11 rounded-lg border px-3.5 text-sm font-medium">Ask Claude to add a brand</button>
        </section>
      )}
      <GlassTool state={state} presets={presets} brand={brand} mode={tmode} rows={rows} onChanged={onChanged} onError={onError} />
      <GradientTool state={state} brand={brand} mode={tmode} rows={rows} onChanged={onChanged} onError={onError} />
      <ChartColors state={state} brand={brand} mode={tmode} page={(vars as Record<string, string>)["--background"]} onChanged={onChanged} onError={onError} />
      <Cta back={{ label: "← Describe", onClick: onBack }} status={nWarn ? `${nWarn} thing${nWarn > 1 ? "s" : ""} to look at` : `${familyName(st.main)} · ${familyName(st.gray)} · ${CORNER_NAMES[st.corners] ?? st.corners} · ${st.font ?? ""}${st.headingFont ? ` + ${st.headingFont}` : ""}`} next={{ label: "Next: Components →", onClick: onNext }} />
    </div>
  );
}

const GRAYS_SET = new Set(["slate", "gray", "zinc", "neutral", "stone", "mauve", "olive", "mist", "taupe"]);

/** A row of radius steps to pick from, each drawn as a corner at that size. */
function RadiusSteps({ label, steps, value, disabled, onPick }: { label: string; steps: { step: string; px: number }[]; value: string; disabled: boolean; onPick: (step: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {steps.map((s) => (
          <button key={s.step} type="button" disabled={disabled} aria-pressed={value === s.step} title={`${s.step}: ${s.step === "full" ? "fully round" : `${s.px}px`}`} onClick={() => onPick(s.step)}
            className={`flex min-h-11 w-12 flex-col items-center justify-center gap-1 rounded-lg border-2 text-xs ${ring(value === s.step)}`}>
            <span aria-hidden="true" className="block size-5 border-t-2 border-l-2 border-foreground" style={{ borderTopLeftRadius: Math.min(s.px, 20) }} />
            {s.step === "full" ? "Full" : s.px}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One font to pick: "Aa" in the font, its name and what it feels like. */
function FontChoice({ family, name, mood, on, disabled, onPick }: { family: string; name?: string; mood: string; on: boolean; disabled: boolean; onPick: () => void }) {
  return (
    <button type="button" disabled={disabled} aria-pressed={on} onClick={onPick} className={`flex flex-[1_1_130px] flex-col items-start gap-0.5 rounded-xl border-2 p-3 text-left ${ring(on)}`}>
      <span className="text-2xl leading-tight font-bold" style={{ fontFamily: `'${family}', sans-serif` }}>Aa</span>
      <span className="text-sm font-semibold">{name ?? family}</span>
      <span className="text-sm text-muted-foreground">{mood}</span>
    </button>
  );
}
