import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type State } from "@/lib/api";
import { TokensView } from "@/views/TokensView";
import { ComponentsView } from "@/views/ComponentsView";
import { GuidelinesView } from "@/views/GuidelinesView";
import { ChangesView } from "@/views/ChangesView";
import { HistoryView } from "@/views/HistoryView";

const TABS = ["tokens", "components", "guidelines", "changes", "history"] as const;
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
  const rev = useRef(0);

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
    }, 1500);
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
      setNotice(done);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return <main className="grid min-h-screen place-items-center p-6 text-sm text-muted-foreground">{error ? `Cannot reach the Plinth server: ${error}` : "Loading…"}</main>;
  }
  if (!state.exists) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-3 p-6">
        <h1 className="text-xl font-semibold">No design system here yet</h1>
        <p className="text-sm text-muted-foreground">Ask Claude to create one, for example: "Create a design system for a budgeting app for young professionals, warm and trustworthy."</p>
        <code className="text-xs text-muted-foreground">{state.workspace}</code>
      </main>
    );
  }

  const gate = state.checks.gate;
  const failing = state.checks.contrast.filter((c) => !c.pass).length;

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
          <Badge variant={gate ? "secondary" : "destructive"}>{gate ? "Ready to publish" : `Not ready${failing ? ` · ${failing} contrast` : ""}`}</Badge>
          <Badge variant="outline">{state.storybook ? "Storybook running" : "Storybook stopped"}</Badge>
        </div>
      </header>

      {(error || notice) && (
        <div role="status" className={`mx-4 mt-4 flex items-center justify-between gap-3 rounded-lg border px-4 py-2 text-sm sm:mx-6 ${error ? "border-destructive/40 text-destructive" : ""}`}>
          <span className="min-w-0">{error ?? notice}</span>
          <Button size="sm" variant="ghost" onClick={() => { setError(null); setNotice(null); }}>Dismiss</Button>
        </div>
      )}

      <main className="px-4 py-4 sm:px-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-4">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="tokens">Tokens</TabsTrigger>
            <TabsTrigger value="components">Components</TabsTrigger>
            <TabsTrigger value="guidelines">Guidelines</TabsTrigger>
            <TabsTrigger value="changes">Changes{state.pending.length ? ` (${state.pending.length})` : ""}</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="tokens">
            <TokensView state={state} brand={brand} busy={busy} onFixContrast={() => act(async () => { await api.fixContrast(); setTab("changes"); }, "Contrast fixes proposed. Review them in Changes.")} />
          </TabsContent>
          <TabsContent value="components">
            <ComponentsView state={state} brand={brand} mode={mode} busy={busy} onStartStorybook={() => act(async () => { const r = await api.startStorybook(); if (r.error) throw new Error(`${r.error} ${r.next ?? ""}`); }, "Storybook started.")} />
          </TabsContent>
          <TabsContent value="guidelines">
            <GuidelinesView state={state} brand={brand} />
          </TabsContent>
          <TabsContent value="changes">
            <ChangesView state={state} brand={brand} busy={busy} onApply={(id) => act(() => api.apply(id), "Change applied and saved as a new version.")} onDiscard={(id) => act(() => api.discard(id), "Change discarded.")} />
          </TabsContent>
          <TabsContent value="history">
            <HistoryView state={state} busy={busy} onRestore={(sha) => act(() => api.restore(sha), "Version restored as a new version.")} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
