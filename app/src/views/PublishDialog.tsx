import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type PublishDefaults, type PublishState, type State } from "@/lib/api";

type Props = { state: State; onClose: () => void; onError: (message: string) => void };

const STEP_LABEL: Record<string, string> = { checks: "Checks", exports: "DESIGN.md exports", commit: "Commit", tests: "Tests", "create repository": "Create GitHub repository", push: "Push to GitHub", pages: "GitHub Pages" };

function Steps({ publish }: { publish: PublishState }) {
  if (!publish.steps.length) return null;
  return (
    <ol className="flex flex-col gap-1 text-sm">
      {publish.steps.map((s, i) => (
        <li key={i} className="flex items-center gap-2">
          <span aria-hidden="true" className={`size-2.5 rounded-full ${s.ok ? "bg-success" : "bg-destructive"}`} />
          <span>{STEP_LABEL[s.name] ?? s.name}</span>
          {typeof s.detail === "string" && !s.ok && <span className="text-muted-foreground">· {s.detail}</span>}
          {s.name === "tests" && s.ok && typeof s.detail === "object" && s.detail && "stories" in s.detail && <span className="text-muted-foreground">· {String((s.detail as { stories: string }).stories)}</span>}
        </li>
      ))}
      {publish.running && <li className="flex items-center gap-2 text-muted-foreground"><span aria-hidden="true" className="size-2.5 animate-pulse rounded-full bg-primary" />Working…</li>}
    </ol>
  );
}

export function PublishDialog({ state, onClose, onError }: Props) {
  const [defaults, setDefaults] = useState<PublishDefaults | null>(null);
  const [repo, setRepo] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [started, setStarted] = useState(false);
  const publish = state.publish;
  const result = started && !publish.running ? publish.result : null;

  useEffect(() => {
    api.publishDefaults().then((d) => { setDefaults(d); setRepo((r) => r || d.suggestedRepo); }).catch((e) => onError(e.message));
  }, [onError]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const start = async () => {
    try { setStarted(true); await api.publish(defaults?.remote ? {} : { repo, visibility }); } catch (e) { setStarted(false); onError((e as Error).message); }
  };

  const ready = defaults?.ghInstalled && defaults.ghAuthed;
  const gate = state.checks.gate;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="publish-title" className="fixed inset-0 z-20 grid place-items-center bg-foreground/30 p-4" onClick={(e) => { if (e.target === e.currentTarget && !publish.running) onClose(); }}>
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-xl border bg-background p-6 shadow-overlay">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="publish-title" className="text-lg font-semibold">Publish</h2>
            <p className="text-sm text-muted-foreground">Runs the checks and tests, writes a complete DESIGN.md per brand, pushes to GitHub and deploys Storybook to GitHub Pages.</p>
          </div>
          {!publish.running && <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>}
        </header>

        {!gate && !started && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">The checks are not passing. Fix or accept the findings in <strong>Checks</strong> first; publish stops at the first failing check.</p>
        )}

        {defaults === null ? <p className="text-sm text-muted-foreground">Checking GitHub…</p> : !defaults.ghInstalled ? (
          <p className="text-sm">Publishing needs the GitHub CLI. Install it from <code>https://cli.github.com</code>, then run <code>gh auth login --web</code> in a terminal and reopen this dialog.</p>
        ) : !defaults.ghAuthed ? (
          <p className="text-sm">GitHub is not connected (or the sign-in expired). Run <code>gh auth login --web</code> in a terminal, finish in the browser, then reopen this dialog. Nothing local is lost.</p>
        ) : defaults.remote ? (
          <p className="text-sm">Pushes to <code>{defaults.repo ?? defaults.remote}</code> as <strong>{defaults.user}</strong>.</p>
        ) : !started && (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); start(); }}>
            <label className="flex flex-col gap-1 text-sm">
              <span>New repository (owner/name), created on your GitHub account as <strong>{defaults.user}</strong></span>
              <input value={repo} onChange={(e) => setRepo(e.target.value)} pattern="[\w.-]+/[\w.-]+" required className="h-9 rounded-md border bg-background px-3 font-mono text-sm" />
            </label>
            <fieldset className="flex gap-4 text-sm">
              <legend className="sr-only">Visibility</legend>
              {(["private", "public"] as const).map((v) => (
                <label key={v} className="flex items-center gap-1.5 capitalize"><input type="radio" name="visibility" value={v} checked={visibility === v} onChange={() => setVisibility(v)} />{v}</label>
              ))}
            </fieldset>
          </form>
        )}

        {started && <Steps publish={publish} />}

        {result && result.published && (
          <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
            <p className="font-medium">Published version {result.version}.</p>
            <p><a className="underline" href={result.github} target="_blank" rel="noreferrer">{result.github}</a></p>
            {result.storybook && <p>Storybook: <a className="underline" href={result.storybook} target="_blank" rel="noreferrer">{result.storybook}</a></p>}
            <p className="text-muted-foreground">{result.note} Progress: <a className="underline" href={result.actions} target="_blank" rel="noreferrer">GitHub Actions</a>.</p>
          </div>
        )}
        {result && !result.published && !result.dryRun && (
          <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="font-medium">Stopped at {STEP_LABEL[result.stoppedAt ?? ""] ?? result.stoppedAt}.</p>
            {result.error && <p>{result.error}</p>}
            {result.next && <p className="text-muted-foreground">{result.next}</p>}
            {result.stoppedAt === "checks" && <p className="text-muted-foreground">See the <strong>Checks</strong> tab.</p>}
            {result.tests?.tests?.failures?.length ? <ul className="list-disc pl-5">{result.tests.tests.failures.map((f) => <li key={f}>{f}</li>)}</ul> : null}
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-end gap-2">
          {result ? <Button onClick={onClose}>Done</Button> : (
            <>
              <Badge variant="outline">{state.brands.length} brand{state.brands.length === 1 ? "" : "s"} · {state.components.length} components</Badge>
              <Button onClick={start} disabled={!ready || publish.running || (!defaults?.remote && !/^[\w.-]+\/[\w.-]+$/.test(repo))}>{publish.running ? "Publishing…" : defaults?.remote ? "Publish" : "Create repository and publish"}</Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
