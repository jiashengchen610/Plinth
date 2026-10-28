import { useEffect, useMemo, useState } from "react";
import { api, type Answers, type Presets, type State, type Suggestions } from "@/lib/api";
import { Cta, fontsHref } from "@/lib/cta";
import { CORNER_NAMES } from "@/lib/plain";
import { StepIntro } from "@/views/StepIntro";

type Props = {
  state: State; presets: Presets | null;
  /** True while answering again after the design system exists ("Start over with new answers"). */
  redo: boolean; onRedo: (on: boolean) => void;
  /** True from the click on Create until the server answers: the button cannot be pressed twice. */
  sending?: boolean;
  onCreate: (answers: Answers) => void; onNext: () => void; onAsk: (text: string) => void; onError: (m: string) => void;
};

type StepId = "product" | "followup" | "feel" | "palette" | "corners" | "font" | "components" | "summary";
type Draft = Answers & { followup: string; feelOwn: string };

const KEY = "plinth-answers";
const empty: Draft = { product: "", followup: "", name: "", feel: "", feelOwn: "", kind: "mobile-app", palette: "", corners: "", font: "", components: [], extraText: "" };
const load = (): Draft => { try { return { ...empty, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return empty; } };

const QUESTIONS: Record<Exclude<StepId, "summary">, [string, string]> = {
  product: ["What are you making, and who is it for?", "A sentence is enough. Claude reads it and suggests the rest."],
  followup: ["", "Optional: answer it to get a better fit, or press Next."],
  feel: ["How should it feel to use?", "Claude suggested these from your answer. Keep the first, pick another, or say it your own way."],
  palette: ["Pick a starting palette.", "You can fine-tune every color later in Style."],
  corners: ["How round should buttons, fields and cards be?", "You can change this later in Style."],
  font: ["Which font fits best?", "Used for headings and text."],
  components: ["Which components do you need?", "All of these are ready-made and free. I picked the usual ones for what you're making."],
};

function Bubble({ who, children }: { who: "claude" | "you"; children: React.ReactNode }) {
  if (who === "you") return <div className="max-w-[85%] self-end rounded-2xl bg-primary px-3.5 py-2.5 text-primary-foreground">{children}</div>;
  return (
    <div className="flex max-w-[90%] gap-2.5 self-start">
      <span aria-hidden="true" className="grid size-8 flex-none place-items-center rounded-full border bg-background text-xs font-bold">C</span>
      <div className="rounded-2xl border bg-background px-3.5 py-2.5">{children}</div>
    </div>
  );
}

const ring = (on: boolean) => (on ? "border-foreground" : "border-border");

export function DescribeView({ state, presets, redo, onRedo, sending = false, onCreate, onNext, onAsk, onError }: Props) {
  const created = state.exists;
  const editable = !created || redo;
  const [mode, setMode] = useState<"questions" | "import">("questions");
  const [a, setA] = useState<Draft>(() => {
    const brief = state.config?.brief;
    return created && brief ? { ...empty, ...brief, components: brief.components ?? [], extraText: brief.extraText ?? "", feel: brief.feel ?? "", kind: brief.kind ?? "mobile-app", palette: brief.palette ?? "", corners: brief.corners ?? "", font: brief.font ?? "" } : load();
  });
  const [sugg, setSugg] = useState<Suggestions | null>(null);
  const [thinking, setThinking] = useState(false);
  const steps = useMemo<StepId[]>(() => ["product", ...(sugg?.question ? ["followup" as const] : []), "feel", "palette", "corners", "font", "components", "summary"], [sugg?.question]);
  const [at, setAt] = useState(() => (created ? steps.length - 1 : 0));
  const [reached, setReached] = useState(at);
  const step = steps[Math.min(at, steps.length - 1)];

  useEffect(() => { if (!created) try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* private window */ } }, [a, created]);
  const set = (patch: Partial<Draft>) => setA((x) => ({ ...x, ...patch }));
  const go = (i: number) => { setAt(i); setReached((r) => Math.max(r, i)); };
  const next = () => go(reached >= steps.length - 1 ? steps.length - 1 : at + 1);

  const palettes = presets?.palettes ?? [];
  const fonts = presets?.fonts ?? [];
  const href = fontsHref(fonts.map((f) => f.family));
  const extras = (presets?.components ?? []).filter((c) => !c.core);
  const ready = (presets?.components ?? []).filter((c) => c.core);
  const kindPreset = (kind: string, s: Suggestions | null) => [...new Set([...(presets?.kindComponents[kind] ?? []), ...(s?.components ?? [])])];
  const main = palettes.find((p) => p.id === a.palette)?.main600 ?? (a.palette === "brand" ? a.brandColor : null) ?? palettes[0]?.main600 ?? "#0f766e";

  const answerProduct = async () => {
    if (!a.product.trim()) return;
    setThinking(true);
    try {
      const s = await api.suggest(a.product);
      setSugg(s);
      setA((x) => ({
        ...x, name: x.name || s.name || "", kind: s.kind,
        feel: x.feel || s.feels[0] || "", palette: x.palette || s.palette, corners: x.corners || s.corners, font: x.font || s.font,
        components: x.components.length ? x.components : kindPreset(s.kind, s),
      }));
      go(1);
    } catch (e) { onError((e as Error).message); } finally { setThinking(false); }
  };
  const skipRest = () => {
    setA((x) => ({ ...x, feel: x.feel || "claude", palette: x.palette || "claude", corners: x.corners || "claude", font: x.font || "claude" }));
    go(steps.length - 1);
  };

  const answerText = (id: StepId): string => {
    if (id === "product") return a.product;
    if (id === "followup") return a.followup.trim() || "(skipped)";
    if (id === "feel") return !a.feel || a.feel === "claude" ? "Let Claude choose" : a.feel;
    if (id === "palette") return a.palette === "brand" ? `My brand color, ${a.brandColor ?? ""}` : palettes.find((p) => p.id === a.palette)?.name ?? "Let Claude choose";
    if (id === "corners") return !a.corners || a.corners === "claude" ? "Let Claude choose" : CORNER_NAMES[a.corners] ?? a.corners;
    if (id === "font") return !a.font || a.font === "claude" ? "Let Claude choose" : a.font;
    if (id === "components") {
      const names = [...ready, ...extras.filter((c) => a.components.includes(c.id))].map((c) => c.name);
      return `${names.join(", ")}${a.extraText.trim() ? `; plus one Claude writes: ${a.extraText.trim()}` : ""}`;
    }
    return "";
  };
  const newCount = a.extraText.trim() ? 1 : 0;
  const finalAnswers = (): Answers => ({
    product: [a.product.trim(), a.followup.trim()].filter(Boolean).join("\n"), name: a.name || undefined,
    feel: a.feel === "claude" ? "" : a.feel, kind: a.kind, palette: a.palette || "claude", brandColor: a.palette === "brand" ? a.brandColor : undefined,
    corners: a.corners || "claude", font: a.font || "claude", components: a.components, extraText: a.extraText,
  });

  const past = steps.slice(0, created && !redo ? steps.length - 1 : Math.min(at, steps.length - 1)).filter((s) => s !== "summary");
  const questionOf = (id: Exclude<StepId, "summary">) => (id === "followup" ? sugg?.question ?? "" : QUESTIONS[id][0]);

  const cta = () => {
    if (created && !redo) return <Cta alt={{ label: "Start over with new answers", onClick: () => { onRedo(true); go(0); } }} status="These answers made your design system." next={{ label: "Next: Style →", onClick: onNext }} />;
    if (mode === "import") return <Cta status="Starting from what you have comes in a later version." next={{ label: "Answer the questions instead", onClick: () => setMode("questions") }} />;
    if (step === "summary") {
      return <Cta back={{ label: "← Back", onClick: () => setAt(steps.length - 2) }} alt={redo ? { label: "Cancel", onClick: () => onRedo(false) } : undefined}
        status={`About a minute${newCount ? ` plus a few for your new component` : ""} · about US$${(0.35 + newCount * 1.5).toFixed(2)} of Claude usage`}
        next={{ label: sending ? "Starting…" : redo ? "Apply my new answers" : "Create my design system", disabled: sending, onClick: () => onCreate(finalAnswers()) }} />;
    }
    const n = steps.length - 1;
    return <Cta back={at > 0 ? { label: "← Back", onClick: () => setAt(at - 1) } : undefined}
      alt={at > 0 ? { label: "Skip the rest and let Claude decide", onClick: skipRest } : redo ? { label: "Cancel", onClick: () => onRedo(false) } : undefined}
      status={thinking ? "Claude is reading your answer…" : `Question ${at + 1} of ${n}`}
      next={{ label: step === "components" ? "Looks good" : "Next", disabled: thinking || (step === "product" && !a.product.trim()), onClick: step === "product" ? answerProduct : next }} />;
  };

  return (
    <div className="flex flex-col gap-4">
      {href && <link rel="stylesheet" href={href} precedence="default" />}
      <StepIntro n={1} title={created && !redo ? "Your answers" : redo ? "Answer again" : "Describe your design system"}
        decide="What you're making and how it should feel. Your answers set the colors, corners, fonts and components to start from."
        change={redo ? "Change any answer. Your components and history stay; Claude rewrites the style guide to match." : "Claude suggests an answer to each question, with why. Keep it, pick another, or say it in your own words."}
        done={created && !redo ? "Done: your design system was made from these answers. Answer again to change them." : "Create makes your style, your style guide and the ready-made components you picked."} />

      {!created && (
        <div role="group" aria-label="How do you want to start?" className="inline-flex flex-wrap self-start rounded-xl bg-muted p-1">
          {([["questions", "Answer a few questions"], ["import", "Start from something you have"]] as const).map(([m, l]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`min-h-10 rounded-lg px-3.5 text-sm font-medium ${mode === m ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{l}</button>
          ))}
        </div>
      )}

      {mode === "import" && !created ? (
        <section className="flex flex-col gap-3 rounded-2xl border bg-background p-5">
          <h2 className="text-base font-semibold">Start from something you have</h2>
          <p className="text-sm text-muted-foreground">Plinth will read a Storybook, a website, a GitHub repo or a design file, show what it found and rebuild the components the Plinth way. This comes in a later version.</p>
          <div className="flex flex-wrap gap-2">
            {["A Storybook", "A website", "A GitHub repo", "A file (DESIGN.md or tokens)"].map((k) => (
              <span key={k} className="flex-[1_1_160px] rounded-xl border border-dashed px-3.5 py-3 text-sm text-muted-foreground">{k}</span>
            ))}
          </div>
          <p className="text-sm">For now: answer the questions, then paste a screenshot of what you have into the chat and ask Claude to match it.</p>
        </section>
      ) : (
        <div className="flex flex-col gap-4">
          {past.map((id) => (
            <div key={id} className="flex flex-col gap-2">
              <Bubble who="claude">{questionOf(id as Exclude<StepId, "summary">)}</Bubble>
              <div className="flex flex-col items-end self-end">
                <Bubble who="you"><span className="whitespace-pre-wrap">{answerText(id)}</span></Bubble>
                {editable && <button type="button" onClick={() => setAt(steps.indexOf(id))} className="min-h-9 px-1 text-sm font-medium text-info underline underline-offset-2">Change</button>}
              </div>
            </div>
          ))}

          {thinking && <Bubble who="claude"><span role="status" className="text-muted-foreground">Reading your answer and picking suggestions… usually a few seconds.</span></Bubble>}

          {editable && !thinking && step !== "summary" && (
            <div className="flex flex-col gap-2.5">
              <Bubble who="claude">
                <span className="block font-semibold">{questionOf(step)}</span>
                <span className="block text-sm text-muted-foreground">{QUESTIONS[step][1]}</span>
                {sugg?.why?.[step as keyof NonNullable<Suggestions["why"]>] && <span className="mt-1.5 block text-sm"><strong>Why the suggestion:</strong> {sugg.why[step as keyof NonNullable<Suggestions["why"]>]}</span>}
              </Bubble>
              <div className="flex flex-col gap-3.5 rounded-2xl border bg-background p-4">
                {step === "product" && (
                  <>
                    <label htmlFor="iv-product" className="text-sm font-semibold">Your answer</label>
                    <textarea id="iv-product" rows={2} value={a.product} onChange={(e) => set({ product: e.target.value })} placeholder="For example: a budgeting app for young professionals" className="w-full resize-y rounded-lg border bg-background px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm text-muted-foreground">Examples:</span>
                      {["A budgeting app for young professionals", "An online shop for handmade jewelry", "A dashboard for a small support team"].map((t) => (
                        <button key={t} type="button" onClick={() => set({ product: t })} className="min-h-9 rounded-full border bg-muted/50 px-3 text-sm hover:bg-muted">{t}</button>
                      ))}
                    </div>
                  </>
                )}
                {step === "followup" && (
                  <>
                    {(sugg?.answers?.length ?? 0) > 0 && (
                      <div role="group" aria-label="Likely answers" className="flex flex-wrap gap-2">
                        {sugg!.answers!.map((x) => (
                          <button key={x} type="button" aria-pressed={a.followup === x} onClick={() => set({ followup: x })} className={`min-h-11 rounded-full border-[1.5px] px-4 text-sm font-medium ${a.followup === x ? "border-foreground bg-foreground text-background" : "border-border bg-background"}`}>{x}</button>
                        ))}
                      </div>
                    )}
                    <label htmlFor="iv-followup" className="text-sm font-semibold">{(sugg?.answers?.length ?? 0) > 0 ? "Or in your own words" : "Your answer"}</label>
                    <input id="iv-followup" value={a.followup} onChange={(e) => set({ followup: e.target.value })} className="h-11 w-full rounded-lg border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  </>
                )}
                {step === "feel" && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {(sugg?.feels ?? presets?.feels ?? []).map((t, i) => (
                        <button key={t} type="button" aria-pressed={a.feel === t && !a.feelOwn} onClick={() => set({ feel: t, feelOwn: "" })} className={`inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 text-sm font-medium ${ring(a.feel === t && !a.feelOwn)}`}>
                          {t}{i === 0 && sugg?.by === "claude" && <span className="rounded-full bg-info/10 px-2 text-[11px] font-semibold text-info">Suggested</span>}
                        </button>
                      ))}
                      <button type="button" aria-pressed={a.feel === "claude"} onClick={() => set({ feel: "claude", feelOwn: "" })} className={`min-h-11 rounded-full border-2 px-4 text-sm font-medium ${ring(a.feel === "claude")}`}>Let Claude choose</button>
                    </div>
                    <label htmlFor="iv-feel" className="text-sm font-semibold">Or say it your own way</label>
                    <input id="iv-feel" value={a.feelOwn} onChange={(e) => set({ feelOwn: e.target.value, feel: e.target.value.trim() ? e.target.value : sugg?.feels[0] ?? "" })} placeholder="For example: like a friendly bank" className="h-11 w-full rounded-lg border bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  </>
                )}
                {step === "palette" && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {palettes.map((p) => (
                        <button key={p.id} type="button" aria-pressed={a.palette === p.id} onClick={() => set({ palette: p.id })} className={`flex flex-[1_1_200px] flex-col gap-2 rounded-xl border-2 p-3 text-left ${ring(a.palette === p.id)}`}>
                          <span className="flex h-8 w-full overflow-hidden rounded-lg border">
                            {p.swatches.map((c, i) => <span key={i} className={i === 0 ? "flex-[3]" : "flex-1"} style={{ background: c ?? "transparent" }} />)}
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">{p.name}{sugg?.palette === p.id && sugg.by === "claude" && <span className="rounded-full bg-info/10 px-2 text-[11px] font-semibold text-info">Suggested</span>}</span>
                          <span className="text-sm text-muted-foreground">{p.mood}</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" aria-pressed={a.palette === "claude"} onClick={() => set({ palette: "claude" })} className={`min-h-11 rounded-lg border-2 px-3.5 text-sm font-medium ${ring(a.palette === "claude")}`}>Let Claude choose</button>
                      <button type="button" aria-pressed={a.palette === "brand"} onClick={() => set({ palette: "brand", brandColor: a.brandColor ?? "#2f5d50" })} className={`min-h-11 rounded-lg border-2 px-3.5 text-sm font-medium ${ring(a.palette === "brand")}`}>Use my brand color</button>
                      {a.palette === "brand" && (
                        <label className="flex items-center gap-2 text-sm">
                          <span className="font-semibold">Brand color</span>
                          <input type="color" value={a.brandColor ?? "#2f5d50"} onChange={(e) => set({ brandColor: e.target.value })} className="h-11 w-16 rounded-lg border bg-background p-0.5" />
                          <span className="font-mono">{a.brandColor}</span>
                        </label>
                      )}
                    </div>
                    {a.palette === "brand" && <p className="text-sm text-muted-foreground">Plinth makes lighter and darker versions from it, plus dark mode.</p>}
                  </>
                )}
                {step === "corners" && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {(presets?.corners ?? []).map((c) => (
                        <button key={c.id} type="button" aria-pressed={a.corners === c.id} onClick={() => set({ corners: c.id })} className={`flex flex-[1_1_140px] flex-col items-center gap-2.5 rounded-xl border-2 px-2.5 py-3.5 ${ring(a.corners === c.id)}`}>
                          <span className="px-4 py-2 text-sm font-semibold text-white" style={{ background: main ?? undefined, borderRadius: c.control ?? undefined }}>Button</span>
                          <span className="block h-8 w-full max-w-32 border-[1.5px]" style={{ borderRadius: c.control ?? undefined }} />
                          <span className="text-sm font-semibold">{c.name}{sugg?.corners === c.id && sugg.by === "claude" ? " · suggested" : ""}</span>
                        </button>
                      ))}
                    </div>
                    <button type="button" aria-pressed={a.corners === "claude"} onClick={() => set({ corners: "claude" })} className={`min-h-11 self-start rounded-lg border-2 px-3.5 text-sm font-medium ${ring(a.corners === "claude")}`}>Let Claude choose</button>
                  </>
                )}
                {step === "font" && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {fonts.map((f) => (
                        <button key={f.family} type="button" aria-pressed={a.font === f.family} onClick={() => set({ font: f.family })} className={`flex flex-[1_1_150px] flex-col items-start gap-0.5 rounded-xl border-2 p-3 text-left ${ring(a.font === f.family)}`}>
                          <span className="text-2xl font-bold leading-tight" style={{ fontFamily: `'${f.family}', sans-serif` }}>Aa</span>
                          <span className="text-sm" style={{ fontFamily: `'${f.family}', sans-serif` }}>Spent $1,240 of $2,000</span>
                          <span className="mt-1.5 text-sm font-semibold">{f.family}{sugg?.font === f.family && sugg.by === "claude" ? " · suggested" : ""}</span>
                          <span className="text-sm text-muted-foreground">{f.mood}</span>
                        </button>
                      ))}
                    </div>
                    <button type="button" aria-pressed={a.font === "claude"} onClick={() => set({ font: "claude" })} className={`min-h-11 self-start rounded-lg border-2 px-3.5 text-sm font-medium ${ring(a.font === "claude")}`}>Let Claude choose</button>
                  </>
                )}
                {step === "components" && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-sm font-semibold">Built for</span>
                      <div className="flex flex-wrap gap-1.5">
                        {(presets?.kinds ?? []).map((k) => (
                          <button key={k.id} type="button" aria-pressed={a.kind === k.id} onClick={() => set({ kind: k.id, components: kindPreset(k.id, sugg) })} className={`min-h-10 rounded-full border-2 px-3.5 text-sm font-medium ${ring(a.kind === k.id)}`}>{k.label}</button>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-sm font-semibold">Always included</span>
                      <div className="flex flex-wrap gap-1.5">
                        {ready.map((c) => <span key={c.id} title={c.hint} className="inline-flex min-h-10 items-center rounded-full border bg-muted/50 px-3.5 text-sm">✓&nbsp;{c.name}</span>)}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-sm font-semibold">Pick what you need <span className="font-normal text-muted-foreground">· all ready-made and free; you can add or remove them later</span></span>
                      <div className="flex flex-wrap gap-1.5">
                        {extras.map((c) => {
                          const on = a.components.includes(c.id);
                          return (
                            <label key={c.id} title={c.hint} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-3.5 text-sm ${on ? "border-foreground bg-muted/50" : ""}`}>
                              <input type="checkbox" checked={on} onChange={() => set({ components: on ? a.components.filter((x) => x !== c.id) : [...a.components, c.id] })} className="size-4 accent-foreground" />
                              {c.name}{sugg?.components.includes(c.id) && <span className="rounded-full bg-info/10 px-2 text-[11px] font-semibold text-info">Suggested</span>}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <label htmlFor="iv-extra" className="text-sm font-semibold">Need something that isn't here?</label>
                    <textarea id="iv-extra" rows={2} value={a.extraText} onChange={(e) => set({ extraText: e.target.value })} placeholder="Describe it, for example: a chart of spending by month" className="w-full resize-y rounded-lg border bg-background px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  </>
                )}
              </div>
              {sugg && step === "feel" && (
                <p className="text-xs text-muted-foreground">{sugg.by === "claude" ? `Claude suggested these in ${sugg.seconds ?? "?"} s${sugg.cost != null ? ` · US$${sugg.cost.toFixed(3)}` : ""}.` : `Claude couldn't make suggestions (${sugg.error ?? "not available"}), so these are the usual starting points.`}</p>
              )}
            </div>
          )}

          {editable && step === "summary" && (
            <>
              <Bubble who="claude">That's all I need. You can still change any answer above.</Bubble>
              <section className="flex flex-col gap-2.5 rounded-2xl border-2 border-foreground bg-background p-5">
                <h2 className="text-base font-semibold">{redo ? "Ready to apply" : "Ready to create"}</h2>
                <div className="flex flex-col gap-1.5 text-sm">
                  <div className="flex flex-wrap justify-between gap-x-3"><span>{ready.length + a.components.length} ready-made components, in your style</span><span className="text-muted-foreground">Free · instant</span></div>
                  <div className="flex flex-wrap justify-between gap-x-3"><span>Your colors, corners and font</span><span className="text-muted-foreground">Free · instant</span></div>
                  <div className="flex flex-wrap justify-between gap-x-3"><span>Your style guide, written by Claude</span><span className="text-muted-foreground">About a minute · about US$0.35</span></div>
                  {newCount > 0 && <div className="flex flex-wrap justify-between gap-x-3"><span>Your new component, written by Claude</span><span className="text-muted-foreground">A few minutes · about US$1.50</span></div>}
                </div>
                <p className="text-xs text-muted-foreground">Claude usage comes from your own Claude plan. Nothing leaves your computer until you publish.</p>
              </section>
            </>
          )}
          {created && !redo && (
            <p className="text-sm text-muted-foreground">
              Want a different direction without answering again?{" "}
              <button type="button" onClick={() => onAsk("I'd like to change the direction: ")} className="min-h-9 font-medium text-info underline underline-offset-2">Tell Claude in the chat</button>
            </p>
          )}
        </div>
      )}
      {cta()}
    </div>
  );
}
