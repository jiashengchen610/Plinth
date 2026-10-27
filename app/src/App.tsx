import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type ChangeResult, type Op, type State } from "@/lib/api";
import { buildGraph, describeOp, type Mode } from "@/lib/tokens";
import { TokenGraph } from "@/views/TokenGraph";
import { ComponentsView } from "@/views/ComponentsView";
import { GuidelinesView } from "@/views/GuidelinesView";
import { ChecksView } from "@/views/ChecksView";
import { HistoryView } from "@/views/HistoryView";
import { ChatPanel } from "@/views/ChatPanel";
import { PublishDialog } from "@/views/PublishDialog";

const TABS = ["chat", "tokens", "components", "guidelines", "checks", "history"] as const;

/** One line about what a change's reminders say, or null. */
function remindersLine(r: ChangeResult["reminders"] | undefined) {
  if (!r) return null;
  const parts = [];
  if (r.contrastFailing.length) parts.push(`${r.contrastFailing.length} contrast pair${r.contrastFailing.length > 1 ? "s" : ""} below the minimum`);
  if (r.lookAlike.length) parts.push(`${r.lookAlike.map((l) => `${l.a} and ${l.b}`).slice(0, 2).join(", ")} look alike`);
  if (r.guidelineNotes.length) parts.push("the guidelines still describe the old color");
  return parts.length ? `Reminder: ${parts.join("; ")}. See Checks.` : null;
}
type Tab = (typeof TABS)[number];
const initialTab = (): Tab => (TABS as readonly string[]).includes(location.hash.slice(1)) ? (location.hash.slice(1) as Tab) : "tokens";

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [brand, setBrand] = useState<string>("");
  const [mode, setMode] = useState<"light" | "dark">("light");
  const [publishing, setPublishing] = useState(false);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const rev = useRef(0);
  // On wide screens the chat is a side panel, so the Chat tab does not exist there.
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const load = useCallback(async () => {
    try {
      const s = await api.state();
      rev.current = s.rev;
      setState(s);
      setError(null);
      setBrand((b) => (s.exists && (!b || !s.brands.includes(b)) ? s.config.defaultBrand ?? s.brands[0] : b));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Poll a cheap revision counter; reload the full state only when something changed.
  useEffect(() => {
    load();
    const t = setInterval(async () => {
      try {
        const { rev: r } = await api.rev();
        if (r !== rev.current) load();
      } catch { /* server restarting */ }
    }, 1000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => { history.replaceState(null, "", `#${tab}`); }, [tab]);
  useEffect(() => {
    const onHash = () => setTab(initialTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) setNotice(done);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const onError = useCallback((m: string) => setError(m), []);

  const graph = useMemo(() => (state?.exists && brand ? buildGraph(state, brand) : null), [state, brand]);
  const tokenMode: Mode = mode === "dark" ? "dark" : "default";
  // Edits in the UI are written at once, like any change; Undo takes the last one back.
  const edit = useCallback(async (ops: Op[]) => {
    if (!graph || !ops.length) return;
    try {
      const r = await api.change(ops.length === 1 ? describeOp(ops[0], graph) : `${ops.length} token edits`, ops);
      setError(null);
      setNotice(`${r.title}.${remindersLine(r.reminders) ? ` ${remindersLine(r.reminders)}` : ""}`);
      await load();
    } catch (e) { setError((e as Error).message); }
  }, [graph, load]);
  const openToken = useCallback((key: string | null) => { setSelectedToken(key); if (key) setTab("tokens"); }, []);

  if (!state) {
    return <main className="grid min-h-screen place-items-center p-6 text-sm text-muted-foreground">{error ? `Cannot reach the Plinth server: ${error}` : "Loading…"}</main>;
  }
  if (!state.exists) {
    // First run: the chat is the whole page, because the first message is the brief.
    return (
      <main className="mx-auto flex h-screen max-w-2xl flex-col gap-4 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-semibold">Plinth</h1>
          <p className="text-sm text-muted-foreground">
            Describe the product and how it should feel. Paste screenshots, mood boards or an existing site you like.
            Claude creates the design system in <code className="text-xs">{state.workspace}</code>. Every change applies at once; you can undo it, and you decide when to save a version.
          </p>
        </div>
        {error && <p role="status" className="text-sm text-destructive">{error}</p>}
        <ChatPanel chat={state.chat} onError={onError} className="min-h-0 flex-1" />
      </main>
    );
  }

  const gate = state.checks.gate;
  // Only broken token references block publishing; everything else is a reminder.
  const failing = state.checks.tokenIssues.length;
  const advisories = (state.checks.warnings ?? []).reduce((n, w) => n + w.count, 0);
  const deps = state.deps;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-b bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="font-semibold">Plinth</span>
          <span className="truncate text-sm text-muted-foreground">{state.config.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="brand" className="text-sm text-muted-foreground">Brand</label>
          <select id="brand" value={brand} onChange={(e) => setBrand(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm">
            {state.brands.map((b) => <option key={b} value={b}>{state.config.brands.find((x) => x.id === b)?.name ?? b}</option>)}
          </select>
          <div role="group" aria-label="Preview mode" className="flex rounded-md border p-0.5">
            {(["light", "dark"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`rounded px-2.5 py-1 text-xs capitalize ${mode === m ? "bg-secondary font-medium text-secondary-foreground" : "text-muted-foreground"}`}>{m}</button>
            ))}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setTab("checks")} className="rounded-full">
            <Badge variant={!gate ? "destructive" : advisories ? "warning" : "secondary"}>{!gate ? `${failing} token problem${failing === 1 ? "" : "s"}` : advisories ? `${advisories} reminder${advisories === 1 ? "" : "s"}` : "No reminders"}</Badge>
          </button>
          {state.publish.running && <Badge variant="outline">Publishing…</Badge>}
          {state.lastChange && <Button size="sm" variant="ghost" title={`Undo: ${state.lastChange.title}`} onClick={() => act(async () => { const r = await api.undo(); setNotice(`Undone: ${r.undone}.`); }, "")} disabled={busy}>Undo</Button>}
          <Button size="sm" variant={state.unsaved.length ? "outline" : "ghost"} onClick={() => setTab("history")} title="Unsaved changes: save them as a version in History">{state.unsaved.length ? `${state.unsaved.length} unsaved · Save…` : "All saved"}</Button>
          <Button size="sm" variant="ghost" className="hidden lg:inline-flex" onClick={() => setChatOpen(!chatOpen)} aria-pressed={chatOpen}>{chatOpen ? "Hide chat" : "Show chat"}</Button>
          <Button size="sm" onClick={() => setPublishing(true)} disabled={state.publish.running}>Publish</Button>
        </div>
      </header>

      {!deps.installed && (
        <div role="status" className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-2 text-sm sm:mx-6">
          <span className="min-w-0">
            {deps.installing ? "Installing dependencies (Storybook, the test browser)… a few minutes." : deps.error ? `Dependency install failed: ${deps.error}` : "Dependencies are not installed yet. Component previews and tests need them."}
          </span>
          {!deps.installing && <Button size="sm" variant="outline" onClick={() => act(() => api.install(), "Installing dependencies.")} disabled={busy}>{deps.error ? "Retry install" : "Install dependencies"}</Button>}
        </div>
      )}

      {state.upgradeAvailable && (
        <div role="status" className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/50 bg-info/10 px-4 py-3 text-sm sm:mx-6">
          <span className="min-w-0"><strong>Upgrade available: layered tokens.</strong> Adds Tailwind's palette at the bottom and component tokens on top, so you can change one component or one role without touching code. Your colors keep their values; edited components are left as they are. Undo takes it back.</span>
          <Button size="sm" onClick={() => act(() => api.upgrade(), "Upgraded to layered tokens. Undo takes it back; Save version keeps it.")} disabled={busy}>Upgrade</Button>
        </div>
      )}


      {(error || notice) && (
        <div role="status" className={`mx-4 mt-4 flex items-center justify-between gap-3 rounded-lg border px-4 py-2 text-sm sm:mx-6 ${error ? "border-destructive/40 text-destructive" : ""}`}>
          <span className="min-w-0">{error ?? notice}</span>
          <Button size="sm" variant="ghost" onClick={() => { setError(null); setNotice(null); }}>Dismiss</Button>
        </div>
      )}

      <main className={`grid gap-4 px-4 py-4 sm:px-6 ${chatOpen ? "lg:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
        <Tabs value={tab === "chat" && wide ? "tokens" : tab} onValueChange={(v) => setTab(v as Tab)} className="min-w-0 gap-4">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="chat" className="lg:hidden">Chat{state.chat?.working ? " · working" : ""}</TabsTrigger>
            <TabsTrigger value="tokens">Tokens</TabsTrigger>
            <TabsTrigger value="components">Components</TabsTrigger>
            <TabsTrigger value="guidelines">Guidelines</TabsTrigger>
            <TabsTrigger value="checks">Checks{failing ? ` (${failing})` : advisories ? ` (${advisories})` : ""}</TabsTrigger>
            <TabsTrigger value="history">History{state.unsaved.length ? ` (${state.unsaved.length} unsaved)` : ""}</TabsTrigger>
          </TabsList>
          <TabsContent value="chat" className="lg:hidden">
            <ChatPanel chat={state.chat} onError={onError} className="h-[75vh]" />
          </TabsContent>
          <TabsContent value="tokens">
            {graph && <TokenGraph state={state} brand={brand} mode={tokenMode} selected={selectedToken} onSelect={setSelectedToken} onEdit={edit} onDone={(m) => { setNotice(m); load(); }} onError={onError} />}
          </TabsContent>
          <TabsContent value="components">
            <ComponentsView state={state} brand={brand} mode={mode} busy={busy} graph={graph} onEdit={(op) => edit([op])} onOpenToken={openToken} onStartStorybook={() => act(async () => { const r = await api.startStorybook(); if (r.error) throw new Error(`${r.error} ${r.next ?? ""}`); }, "Storybook started.")} onInstall={() => act(() => api.install(), "Installing dependencies.")} />
          </TabsContent>
          <TabsContent value="guidelines">
            <GuidelinesView state={state} brand={brand} />
          </TabsContent>
          <TabsContent value="checks">
            <ChecksView
              state={state} busy={busy} onError={onError} onChanged={load}
              onFixContrast={() => act(() => api.fixContrast(), "Contrast fixed. Undo takes it back.")}
              onRunTests={() => act(() => api.runTests(), "Tests started. Results appear here in about a minute.")}
              onInstall={() => act(() => api.install(), "Installing dependencies.")}
            />
          </TabsContent>
          <TabsContent value="history">
            <HistoryView state={state} busy={busy}
              onRestore={(sha) => act(() => api.restore(sha), "Version restored as a new version.")}
              onSave={(message) => act(() => api.save(message), "Saved as a new version.")}
              onDiscard={() => act(() => api.discardUnsaved(), "Unsaved changes discarded.")} />
          </TabsContent>
        </Tabs>
        {/* Wide screens: the chat stays beside whatever tab is open. */}
        {chatOpen && <ChatPanel chat={state.chat} onError={onError} className="sticky top-20 hidden h-[calc(100vh-6rem)] lg:flex" />}
      </main>

      {publishing && <PublishDialog state={state} onClose={() => setPublishing(false)} onError={onError} />}
    </div>
  );
}
