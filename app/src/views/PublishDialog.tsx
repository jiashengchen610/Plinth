import { useCallback, useEffect, useState } from "react";
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

  const refresh = useCallback(() => {
    api.publishDefaults().then((d) => {
      setDefaults(d);
      // Before sign-in the suggestion has no owner; replace it once the account is known, unless the user typed one.
      setRepo((r) => (!r || !r.includes("/") ? d.suggestedRepo : r));
      setVisibility(d.suggestedVisibility);
    }).catch((e) => onError(e.message));
  }, [onError]);
  useEffect(() => { refresh(); }, [refresh]);
  // The device login finishes in the browser; pick up the new account when it does.
  const login = state.github;
  useEffect(() => { if (login.status === "done") refresh(); }, [login.status, refresh]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const start = async () => {
    try { setStarted(true); await api.publish(defaults?.remote ? {} : { repo, visibility }); } catch (e) { setStarted(false); onError((e as Error).message); }
  };

  const connected = Boolean(defaults?.ghInstalled && defaults.ghAuthed && defaults.scopesOk);
  const ready = connected;
  const gate = state.checks.gate;
  const privateBlocked = visibility === "private" && defaults?.privatePagesAllowed === false;
  const [copied, setCopied] = useState(false);
  const copyCode = async () => { try { await navigator.clipboard.writeText(login.code ?? ""); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the code is selectable */ } };

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

        {/* Step 1: GitHub account */}
        {!started && (
          <section aria-labelledby="gh-step" className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
            <h3 id="gh-step" className="flex items-center gap-2 font-medium">
              <span aria-hidden="true" className={`size-2.5 rounded-full ${connected ? "bg-success" : "bg-muted-foreground/40"}`} />
              1. GitHub account
            </h3>
            {defaults === null ? <p className="text-muted-foreground">Checking GitHub…</p>
              : !defaults.ghInstalled ? (
                <>
                  <p>Publishing uses the GitHub CLI to create the repository on your account. Download and run the installer, then come back here.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" asChild><a href="https://cli.github.com" target="_blank" rel="noreferrer">Download GitHub CLI</a></Button>
                    <Button size="sm" variant="outline" onClick={refresh}>I installed it</Button>
                  </div>
                </>
              ) : connected ? (
                <p>Connected as <strong>{defaults.user}</strong>{defaults.plan ? <span className="text-muted-foreground"> · {defaults.plan} plan</span> : null}.</p>
              ) : login.status === "waiting" ? (
                <>
                  <p>A GitHub page opened in your browser. Enter this code there and press <strong>Authorize</strong>:</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="select-all rounded-md border bg-muted px-3 py-1.5 font-mono text-lg tracking-widest">{login.code}</code>
                    <Button size="sm" variant="outline" onClick={copyCode}>{copied ? "Copied" : "Copy code"}</Button>
                    <Button size="sm" variant="ghost" asChild><a href={login.url} target="_blank" rel="noreferrer">Open the page again</a></Button>
                  </div>
                  <p className="flex items-center gap-2 text-muted-foreground"><span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-primary" />Waiting for you to authorize… <button type="button" className="underline" onClick={() => api.githubCancel().catch((e) => onError(e.message))}>Cancel</button></p>
                </>
              ) : (
                <>
                  <p>{defaults.ghAuthed
                    ? <>Connected as <strong>{defaults.user}</strong>, but the sign-in cannot push the Storybook workflow yet (missing: {defaults.missingScopes.join(", ")}). Grant it once:</>
                    : "Connect your GitHub account. You sign in on github.com; Plinth never sees your password."}</p>
                  {login.status === "error" && <p className="text-destructive">{login.error}</p>}
                  <div><Button size="sm" onClick={() => api.githubLogin().catch((e) => onError(e.message))} disabled={login.status === "starting"}>{login.status === "starting" ? "Opening GitHub…" : defaults.ghAuthed ? "Grant permission" : "Connect GitHub"}</Button></div>
                </>
              )}
          </section>
        )}

        {/* Step 2: repository */}
        {!started && defaults && (
          <section aria-labelledby="repo-step" className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
            <h3 id="repo-step" className="font-medium">2. Repository</h3>
            {defaults.remote ? (
              <p>Pushes to <code>{defaults.repo ?? defaults.remote}</code>.</p>
            ) : (
              <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); start(); }}>
                <label className="flex flex-col gap-1">
                  <span>New repository (owner/name)</span>
                  <input value={repo} onChange={(e) => setRepo(e.target.value)} pattern="[\w.-]+/[\w.-]+" required placeholder="your-account/design-system" className="h-9 rounded-md border bg-background px-3 font-mono text-sm" />
                </label>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1">Visibility</legend>
                  <label className="flex items-start gap-2"><input type="radio" name="visibility" value="public" checked={visibility === "public"} onChange={() => setVisibility("public")} className="mt-1" /><span><strong>Public</strong>: anyone can see the code and the Storybook.</span></label>
                  <label className="flex items-start gap-2"><input type="radio" name="visibility" value="private" checked={visibility === "private"} onChange={() => setVisibility("private")} className="mt-1" /><span><strong>Private</strong>: only you and people you invite see the code.{defaults.privatePagesAllowed === false ? " Needs a paid GitHub plan for the Storybook site." : " The Storybook site is still public unless your organization restricts it."}</span></label>
                </fieldset>
                {privateBlocked && <p className="rounded-md border border-warning/60 bg-warning/10 p-2">Your account is on the free plan: GitHub Pages does not work for private repositories there. The code would be pushed, but Storybook would not go online. Choose Public, or upgrade the plan on GitHub.</p>}
              </form>
            )}
          </section>
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
              <Button onClick={start} disabled={!ready || privateBlocked || publish.running || (!defaults?.remote && !/^[\w.-]+\/[\w.-]+$/.test(repo))}>{publish.running ? "Publishing…" : defaults?.remote ? "Publish" : "Create repository and publish"}</Button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
