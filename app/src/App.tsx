import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type Answers, type ChangeResult, type Op, type Presets, type State, type VocabEntry } from "@/lib/api";
import { CtaSlot } from "@/lib/cta";
import { setReload, useAfter, usePendingEdit } from "@/lib/lock";
import { componentLabel, roleName } from "@/lib/plain";
import { activityLabel, ChatPanel } from "@/views/ChatPanel";
import { DescribeView } from "@/views/DescribeView";
import { CreatingView } from "@/views/CreatingView";
import { StyleView } from "@/views/StyleView";
import { ComponentsView } from "@/views/ComponentsView";
import { PublishView, useDeploy } from "@/views/PublishView";
import { HistoryView } from "@/views/HistoryView";

const SCREENS = ["describe", "creating", "style", "components", "publish", "history"] as const;
type Screen = (typeof SCREENS)[number];
const STEPS: { id: Screen; label: string }[] = [{ id: "describe", label: "Describe" }, { id: "style", label: "Style" }, { id: "components", label: "Components" }, { id: "publish", label: "Publish" }];
const fromHash = (): Screen | null => ((SCREENS as readonly string[]).includes(location.hash.slice(1)) ? (location.hash.slice(1) as Screen) : null);

/** One line about what a change's reminders say, in plain words, or null. */
function remindersLine(r: ChangeResult["reminders"] | undefined) {
  if (!r) return null;
  const parts = [];
  if (r.contrastFailing.length) parts.push(`${r.contrastFailing.length === 1 ? `${roleName(r.contrastFailing[0].fg)} is` : `${r.contrastFailing.length} text colors are`} hard to read now`);
  if (r.lookAlike.length) parts.push(`${roleName(r.lookAlike[0].a)} and ${roleName(r.lookAlike[0].b)} look alike`);
  if (r.guidelineNotes.length) parts.push("the style guide still describes the old color (ask Claude to update it)");
  return parts.length ? `Heads-up: ${parts.join("; ")}.` : null;
}

const TIPS: Record<string, string[]> = {
  describe: ["Why did you pick these colors?", "Make the whole thing feel more premium"],
  creating: ["What are you doing right now?"],
  style: ["Make it feel more premium", "Use the colors from our logo", "Make the grays a bit warmer"],
  publish: ["Fix the things to look at", "What changed since the last publish?"],
  history: ["What changed in the last version?"],
};

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [presets, setPresets] = useState<Presets | null>(null);
  const [vocab, setVocab] = useState<VocabEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [screen, setScreen] = useState<Screen>(() => fromHash() ?? "style");
  const [lastStep, setLastStep] = useState<Screen>("style");
  const [brand, setBrand] = useState("");
  const [mode, setMode] = useState<"light" | "dark">("light");
  const [redo, setRedo] = useState(false);
  const [sending, setSending] = useState(false);
  const [chatText, setChatText] = useState("");
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const rev = useRef(0);

  const load = useCallback(async () => {
    try {
      const s = await api.state();
      rev.current = s.rev;
      setState(s);
      setBrand((b) => (s.exists && (!b || !s.brands.includes(b)) ? s.config.defaultBrand ?? s.brands[0] : b));
      // The vocabulary follows the state: which components are in, which style is current.
      api.vocab().then((v) => setVocab(v.entries)).catch(() => {});
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { setReload(load); }, [load]);
  useEffect(() => {
    load();
    api.presets().then(setPresets).catch(() => {});
    const t = setInterval(async () => { try { const { rev: r } = await api.rev(); if (r !== rev.current) load(); } catch { /* server restarting */ } }, 1000);
    return () => clearInterval(t);
  }, [load]);

  const go = useCallback((s: Screen) => {
    setScreen(s);
    if (STEPS.some((x) => x.id === s)) setLastStep(s);
    document.querySelector("main")?.scrollTo({ top: 0 });
  }, []);
  useEffect(() => { history.replaceState(null, "", `#${screen}`); }, [screen]);

  // A step is checked once the user went through it with its Next button in this round of work: until the next
  // publish. Remembered per design system and round (a new one in the same folder, new answers, or a publish start
  // unchecked), in this browser only.
  const stepsKey = state?.exists ? `plinth-steps:${state.workspace}:${state.config.brief?.answeredAt ?? ""}:${state.round?.published ?? "new"}` : null;
  const { deploy: live } = useDeploy(state?.round?.published ?? "", Boolean(state?.exists && state?.round?.published));
  const [confirmed, setConfirmed] = useState<Set<Screen>>(new Set());
  useEffect(() => {
    try { setConfirmed(new Set(stepsKey ? JSON.parse(localStorage.getItem(stepsKey) ?? "[]") : [])); } catch { setConfirmed(new Set()); }
  }, [stepsKey]);
  const confirmStep = useCallback((s: Screen) => {
    setConfirmed((c) => { const n = new Set(c).add(s); try { if (stepsKey) localStorage.setItem(stepsKey, JSON.stringify([...n])); } catch { /* private window */ } return n; });
  }, [stepsKey]);

  // Before a design system exists the only page is Describe; while one is being made, the progress page.
  const effective: Screen = !state ? screen : state.setup?.running ? "creating" : !state.exists ? "describe" : screen === "creating" && !state.setup ? "style" : screen;

  const onError = useCallback((m: string) => { setError(m); setNotice(null); }, []);
  const onChanged = useCallback((r: Partial<ChangeResult> & { unchanged?: boolean; message?: string }, fallback: string) => {
    setError(null);
    setNotice(r.unchanged ? "Nothing to change: it's already like that." : [r.message ?? (r.title ? `${r.title}.` : fallback), remindersLine(r.reminders)].filter(Boolean).join(" "));
    load();
  }, [load]);
  const edit = useCallback(async (title: string, ops: Op[]) => {
    try { onChanged(await api.change(title, ops), title); } catch (e) { onError((e as Error).message); }
  }, [onChanged, onError]);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); setError(null); if (done) setNotice(done); await load(); } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  };
  const ask = useCallback((text: string) => {
    setChatText(text);
    document.getElementById("chat-input")?.scrollIntoView({ block: "nearest" });
  }, []);
  const create = async (answers: Answers) => {
    if (sending) return;
    setSending(true);
    try { await api.setup(answers); setRedo(false); setScreen("creating"); await load(); } catch (e) { onError((e as Error).message); } finally { setSending(false); }
  };

  // One edit at a time: while yours is written, or while Claude works on a message, the page is locked (it still
  // scrolls). Cards turn into a moving skeleton; for your own edits only when they take a moment.
  const pendingEdit = usePendingEdit();
  const lockBy = pendingEdit ? "you" : state?.exists && state.chat?.working ? "claude" : null;
  const skeleton = useAfter(lockBy, lockBy === "you" ? 200 : 0);

  // Ctrl+Z (⌘Z on a Mac) takes back the newest change, as Undo does; in a text field it undoes the typing instead.
  const undoRef = useRef<() => void>(() => {});
  undoRef.current = () => {
    if (!state?.exists || busy || lockBy || !state.lastChange) return;
    act(async () => { const r = await api.undo(); setNotice(`Undid: ${r.undone}.`); }, "");
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      undoRef.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const scratch = async () => {
    try {
      const r = await api.startFromScratch();
      try { localStorage.removeItem("plinth-answers"); } catch { /* private window */ }
      setRedo(false);
      setNotice(r.unchanged ? "It is already a fresh design system." : `Started from scratch. What you had is saved as a version${r.version ? ` (${r.version})` : ""}: History brings it back. Answer the questions for the new design system.`);
      await load();
      go("describe");
    } catch (e) { onError((e as Error).message); }
  };

  if (!state) return <main className="grid min-h-dvh place-items-center p-6 text-sm text-muted-foreground">{error ? `Cannot reach the Plinth server: ${error}` : "Loading…"}</main>;

  const exists = state.exists;
  const chatOn = exists;
  const unsaved = state.unsaved?.length ?? 0;
  // This round: Publish is checked only while the live version is what you have; Style and Components show a dot when
  // this round changed something there, or when there is something to look at.
  const round = state.round ?? { published: null };
  const deploying = state.publish?.running || (live && (live.status === "waiting" || live.status === "running"));
  const stopped = live?.status === "failed";
  const upToDate = Boolean(round.published) && round.files === 0 && !deploying && !stopped;
  const done = (id: Screen) => (id === "describe" ? exists : id === "publish" ? upToDate : confirmed.has(id));
  const toLook: Partial<Record<Screen, number>> = exists ? {
    style: state.checks.contrast.filter((c) => !c.pass && !c.accepted).length + state.checks.distinct.filter((d) => !d.pass && !d.accepted).length + state.checks.tokenIssues.length,
    components: state.checks.hardcoded.filter((h) => !h.accepted).length,
  } : {};
  const changed = (id: Screen) => (id === "style" || id === "components" ? Boolean(round.steps?.[id]) : false);
  const status = !exists ? { text: "Not created yet", tone: "" } : deploying ? { text: "Publishing · GitHub is testing", tone: "bg-info" }
    : stopped ? { text: "Last publish stopped", tone: "bg-destructive" } : !round.published ? { text: "Not published yet", tone: "bg-muted-foreground" }
    : upToDate ? { text: "Live · nothing changed since", tone: "bg-success" }
    : { text: `Changed since it went live${round.versions ? ` · ${round.versions} saved version${round.versions > 1 ? "s" : ""} to publish` : ""}`, tone: "bg-warning" };
  const compName = componentLabel(state.components?.[0]?.id ?? "button", presets?.components);
  // What to ask Claude, led by what needs attention right now (then the usual examples).
  const firstContrast = exists ? state.checks.contrast.find((c) => c.brand === brand && !c.pass && !c.accepted) : undefined;
  const firstDistinct = exists ? state.checks.distinct.find((d) => d.brand === brand && !d.pass && !d.accepted) : undefined;
  const firstHardcoded = exists ? state.checks.hardcoded.find((h) => !h.accepted && /^src\/components\//.test(h.file)) : undefined;
  const now = effective === "style" ? [
    firstContrast && `Make ${roleName(firstContrast.fg)} easier to read on ${roleName(firstContrast.bg.replace(/\/\d+$/, ""))}`,
    firstDistinct && `Make ${roleName(firstDistinct.a)} and ${roleName(firstDistinct.b)} easier to tell apart`,
  ] : effective === "components" ? [
    firstHardcoded && `Use tokens instead of the fixed values in ${componentLabel(firstHardcoded.file.split("/")[2] ?? "", presets?.components)}`,
  ] : effective === "publish" ? [
    state.review?.result?.ok && "Fix what you suggested before I publish",
  ] : [];
  const usual = effective === "components" ? [`Make the ${compName.toLowerCase()} a bit bigger`, "Add a loading state to Button", "Add a date picker"] : TIPS[effective] ?? [];
  const tips = [...now.filter((t): t is string => Boolean(t)), ...usual].slice(0, 3);
  const placeholder = effective === "style" ? "Tell Claude how the style should change" : effective === "components" ? "Tell Claude what to change in a component" : effective === "publish" ? "Ask Claude about your changes" : "Tell Claude what to change";

  return (
    <div className="flex min-h-dvh flex-col bg-muted/40 text-foreground lg:h-dvh lg:overflow-hidden">
      <header className="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background px-4 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><rect x="3" y="17" width="22" height="7" rx="2" fill="currentColor" /><rect x="8" y="5" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
          <div className="flex min-w-0 flex-col leading-tight">
            <strong className="truncate text-[15px]">{exists ? state.config.name : "New design system"}</strong>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{status.tone && <span aria-hidden="true" className={`size-2 flex-none rounded-full ${status.tone}`} />}{status.text}</span>
          </div>
          {exists && state.brands.length > 1 && (
            <select aria-label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} className="h-10 rounded-lg border bg-background px-2 text-sm">
              {state.brands.map((b) => <option key={b} value={b}>{state.config.brands.find((x) => x.id === b)?.name ?? b}</option>)}
            </select>
          )}
        </div>
        <nav aria-label="Steps" className="flex flex-[1_1_440px] flex-wrap items-center justify-center gap-1">
          {STEPS.map((s, i) => {
            const current = effective === s.id || (s.id === "describe" && effective === "creating");
            const locked = !exists && s.id !== "describe";
            const isDone = !current && done(s.id);
            const look = toLook[s.id] ?? 0;
            const note = locked ? "Available after you create your design system" : look ? `${look} thing${look > 1 ? "s" : ""} to look at` : changed(s.id) ? "Changed since it went live" : s.id === "publish" && upToDate ? "Your site has the latest version" : undefined;
            return (
              <span key={s.id} className="inline-flex items-center gap-1">
                {i > 0 && <span aria-hidden="true" className="block h-px w-4 bg-border" />}
                <button type="button" disabled={locked || state.setup?.running} aria-current={current ? "step" : undefined} title={note} aria-label={note && !locked ? `${s.label}: ${note}` : undefined} onClick={() => go(s.id)}
                  className={`inline-flex h-11 items-center gap-2 rounded-full pr-3.5 pl-2 text-sm font-medium disabled:cursor-not-allowed ${current ? "bg-primary text-primary-foreground" : locked ? "text-muted-foreground" : "hover:bg-muted"}`}>
                  <span className={`relative grid size-6 place-items-center rounded-full text-xs font-semibold ${isDone ? "bg-success text-white" : current ? "border-[1.5px] border-primary-foreground" : "border-[1.5px] border-muted-foreground/60"}`}>
                    {isDone ? "✓" : i + 1}
                    {!locked && (look > 0 || changed(s.id)) && <span aria-hidden="true" className={`absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background ${look ? "bg-warning" : "bg-info"}`} />}
                  </span>
                  {s.label}
                </button>
              </span>
            );
          })}
        </nav>
        {exists && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="min-h-10" disabled={busy || Boolean(lockBy) || !state.lastChange} title={state.lastChange ? `Undo (Ctrl+Z): ${state.lastChange.title}` : "Nothing to undo"} onClick={() => act(async () => { const r = await api.undo(); setNotice(`Undid: ${r.undone}.`); }, "")}>Undo</Button>
            <Button variant="outline" className={`min-h-10 ${unsaved ? "border-warning/60 bg-warning/10" : ""}`} onClick={() => go("history")}>{unsaved ? `Not saved · Save` : "All saved"}</Button>
            <Button variant={effective === "history" ? "secondary" : "ghost"} className="min-h-10" aria-current={effective === "history" ? "page" : undefined} onClick={() => go("history")}>History</Button>
          </div>
        )}
      </header>

      {(error || notice) && (
        <div role="status" className={`flex flex-none items-center gap-3 border-b px-4 text-sm ${error ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-info/30 bg-info/5"}`}>
          <span className="min-w-0 flex-1 py-2.5">{error ?? notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => { setError(null); setNotice(null); }} className="grid size-11 place-items-center">×</button>
        </div>
      )}
      {exists && state.upgradeAvailable && (
        <div role="status" className="flex flex-none flex-wrap items-center gap-3 border-b bg-info/5 px-4 py-2 text-sm">
          <span className="min-w-0 flex-1">This design system was made by an older Plinth. {state.upgradeAvailable === "layers" ? "Upgrade it so each component gets its own colors and fonts." : state.upgradeAvailable === "typography" ? "Upgrade it so headings, text and buttons can each have their own font." : "Newer versions of its components are ready, for example corners that fit inside their containers."} Components you or Claude changed stay as they are. Undo takes it back.</span>
          <Button onClick={() => act(() => api.upgrade(), "Upgraded. Undo takes it back.")} disabled={busy}>Upgrade</Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-locked={skeleton ?? undefined} aria-busy={Boolean(lockBy)}>
          {skeleton && <LockBar by={skeleton} label={skeleton === "claude" ? activityLabel(state.chat) : pendingEdit?.label ?? "Making your change"} since={skeleton === "claude" ? state.chat?.activity?.since ?? null : pendingEdit?.since ?? null} onError={onError} />}
          <main className="min-h-0 flex-1 px-4 py-5 lg:overflow-y-auto">
            <CtaSlot.Provider value={slot}>
              <div inert={Boolean(lockBy)} className={`mx-auto ${effective === "describe" || effective === "creating" ? "max-w-3xl" : effective === "publish" || effective === "history" ? "max-w-4xl" : "max-w-6xl"}`}>
                {effective === "describe" && <DescribeView key={`${exists}-${Boolean(state.config?.brief)}-${redo}`} state={state} presets={presets} redo={redo} onRedo={setRedo} sending={sending} onCreate={create} onNext={() => go("style")} onAsk={ask} onError={onError} onScratch={scratch} />}
                {effective === "creating" && <CreatingView state={state} onNext={() => go("style")} />}
                {effective === "style" && exists && <StyleView state={state} presets={presets} vocab={vocab} brand={brand} mode={mode} onMode={setMode} onChanged={onChanged} onError={onError} onBack={() => go("describe")} onNext={() => { confirmStep("style"); go("components"); }} onAsk={ask} />}
                {effective === "components" && exists && <ComponentsView state={state} presets={presets} vocab={vocab} brand={brand} mode={mode} onMode={setMode} onEdit={edit} onChanged={onChanged} onError={onError} onAsk={ask} onBack={() => go("style")} onNext={() => { confirmStep("components"); go("publish"); }} />}
                {effective === "publish" && exists && <PublishView state={state} onError={onError} onAsk={ask} onBack={() => go("components")} onSaved={(m) => { setNotice(m); load(); }} onNewRound={() => go("style")} />}
                {effective === "history" && exists && (
                  <HistoryView state={state} busy={busy} backLabel={STEPS.find((s) => s.id === lastStep)?.label ?? "Style"} onBack={() => go(lastStep)}
                    onSave={(m) => act(() => api.save(m), "Saved a version.")} onDiscard={() => act(() => api.discardUnsaved(), "Threw away the changes.")}
                    onRestore={(sha) => act(() => api.restore(sha), "Went back to that version. Your newer versions are still in History.")} />
                )}
              </div>
            </CtaSlot.Provider>
          </main>
          <div ref={setSlot} inert={Boolean(lockBy)} className="sticky bottom-0 z-10 flex-none lg:static" />
        </div>
        {chatOn && (
          <aside className="flex min-h-[520px] flex-none flex-col border-t lg:h-auto lg:min-h-0 lg:w-[380px] lg:border-t-0 lg:border-l">
            <ChatPanel chat={state.chat} onError={onError} className="min-h-0 flex-1" text={chatText} onText={setChatText} tips={tips} placeholder={placeholder} vocab={vocab} brand={brand} onChanged={onChanged} />
          </aside>
        )}
      </div>
    </div>
  );
}

/** What is being changed while the page is locked. Claude's reply can be stopped from here. */
function LockBar({ by, label, since, onError }: { by: "you" | "claude"; label: string; since: number | null; onError: (m: string) => void }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const s = since ? Math.max(0, Math.round((Date.now() - since) / 1000)) : 0;
  return (
    <div role="status" className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-info/30 bg-info/5 px-4 py-2 text-sm">
      <span aria-hidden="true" className="size-2.5 flex-none animate-pulse rounded-full bg-info" />
      {by === "claude" ? (
        <span className="min-w-0 flex-1"><strong>Claude is working on your message:</strong> {label.toLowerCase()}…{s > 3 ? ` ${s} s.` : ""} <span className="text-muted-foreground">The page is paused so nothing changes under your hands; you can edit again when it's done.</span></span>
      ) : (
        <span className="min-w-0 flex-1"><strong>{label}…</strong> <span className="text-muted-foreground">One moment.</span></span>
      )}
      {by === "claude" && <Button variant="outline" className="min-h-9" onClick={() => api.stopChat().catch((e) => onError((e as Error).message))}>Stop</Button>}
    </div>
  );
}
