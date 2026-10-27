import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, exceptionKey, type PublishDefaults, type State } from "@/lib/api";
import { Cta } from "@/lib/cta";
import { fileName, isGenerated, roleName } from "@/lib/plain";
import { Reply } from "@/views/ChatPanel";

type Props = { state: State; onError: (m: string) => void; onAsk: (text: string) => void; onBack: () => void; onSaved: (m: string) => void };

const STEP_LABEL: Record<string, string> = { "unsaved changes": "Saved versions", unsaved: "Saved versions", checks: "Checks", exports: "Style guide for other tools", commit: "Version", tests: "Testing every component", "create repository": "Creating the GitHub repository", push: "Sending to GitHub", pages: "Building your component site" };

export function PublishView({ state, onError, onAsk, onBack, onSaved }: Props) {
  const [defaults, setDefaults] = useState<PublishDefaults | null>(null);
  const [repo, setRepo] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("public");
  const [started, setStarted] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixed, setFixed] = useState<{ storybook: string | null; actions: string; note: string } | null>(null);
  const publish = state.publish;
  const result = started && !publish.running ? publish.result : null;
  const login = state.github;

  const refresh = useCallback(() => {
    api.publishDefaults().then((d) => { setDefaults(d); setRepo((r) => (!r || !r.includes("/") ? d.suggestedRepo : r)); setVisibility(d.suggestedVisibility); }).catch((e) => onError(e.message));
  }, [onError]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (login.status === "done") refresh(); }, [login.status, refresh]);

  // Claude reads everything since the last publish once, when this page opens. Suggestions only.
  const review = state.review;
  const [asked, setAsked] = useState(false);
  const ask = useCallback(() => { setAsked(true); api.review().catch((e) => onError(e.message)); }, [onError]);
  useEffect(() => { if (!asked && review && !review.running) ask(); }, [asked, review, ask]);

  const unsaved = state.unsaved ?? [];
  const save = async () => {
    setSaving(true);
    try { await api.save(message.trim() || state.lastChange?.title || "Changes before publishing"); setMessage(""); onSaved("Saved a version."); } catch (e) { onError((e as Error).message); } finally { setSaving(false); }
  };
  const start = async () => {
    try { setStarted(true); await api.publish(defaults?.remote ? {} : { repo, visibility }); } catch (e) { setStarted(false); onError((e as Error).message); }
  };
  const makePublic = async () => { setFixing(true); try { setFixed(await api.makePublicAndDeploy()); refresh(); } catch (e) { onError((e as Error).message); } finally { setFixing(false); } };

  const connected = Boolean(defaults?.ghInstalled && defaults.ghAuthed && defaults.scopesOk);
  const privateBlocked = !defaults?.remote && visibility === "private" && defaults?.privatePagesAllowed === false;
  const contrast = state.checks.contrast.filter((c) => !c.pass && !c.accepted);
  const distinct = state.checks.distinct.filter((d) => !d.pass && !d.accepted);
  const brokenRefs = state.checks.tokenIssues;
  const published = state.versions.some((v) => v.published);
  const sinceLast = published ? state.versions.slice(0, state.versions.findIndex((v) => v.published)) : state.versions;
  const blocked = !connected ? "Connect GitHub first." : unsaved.length ? "Save your changes as a version first." : privateBlocked ? "Your GitHub plan can't put a private component site online." : brokenRefs.length ? "Some colors point at something that no longer exists. Ask Claude to fix it." : !defaults?.remote && !/^[\w.-]+\/[\w.-]+$/.test(repo) ? "Pick a repository name." : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-muted-foreground">Step 4 of 4 · optional</span>
        <h1 className="text-2xl font-semibold tracking-tight">Publish</h1>
        <p className="text-muted-foreground">Publishing puts your saved versions on GitHub and updates your component site, so your team can use them. You can skip it and keep working on your computer.</p>
      </div>

      {unsaved.length > 0 && !started && (
        <section className="flex flex-col gap-3 rounded-2xl border border-warning/60 bg-warning/10 p-5">
          <div><h2 className="text-base font-semibold">Save your changes first</h2><p className="text-sm">{unsaved.length} file{unsaved.length > 1 ? "s" : ""} changed since your last version: {[...new Set(unsaved.filter((u) => !isGenerated(u.file)).map((u) => fileName(u.file)))].join(", ")}. Only saved versions can be published.</p></div>
          <form className="flex flex-wrap items-end gap-2.5" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <label className="flex flex-[1_1_260px] flex-col gap-1 text-sm font-semibold">Describe this version<input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={state.lastChange?.title ?? "For example: softer corners"} className="h-11 rounded-lg border bg-background px-3 font-normal" /></label>
            <Button type="submit" className="min-h-11" disabled={saving}>{saving ? "Saving…" : "Save version"}</Button>
          </form>
        </section>
      )}

      <section className="flex flex-col gap-2 rounded-2xl border bg-background p-5">
        <h2 className="text-base font-semibold">What's new since you last published</h2>
        {!sinceLast.length && !unsaved.length ? <p className="text-sm text-muted-foreground">Nothing new. Your team already sees the latest version.</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {!published && <li>Your whole design system (the first time you publish)</li>}
            {published && sinceLast.map((v) => <li key={v.sha}>• {v.subject}</li>)}
            {unsaved.length > 0 && <li className="text-muted-foreground">• Changes not saved yet</li>}
          </ul>
        )}
      </section>

      {review && (
        <section className="flex flex-col gap-2 rounded-2xl border bg-background p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">Claude's suggestions</h2><span className="text-sm text-muted-foreground">Suggestions only. You can publish anyway.</span></div>
          {review.running ? <p role="status" className="text-sm text-muted-foreground">Claude is reading your changes and your style guide. Usually under half a minute.</p>
            : review.result?.ok ? <Reply text={review.result.text ?? ""} />
            : review.result ? <p className="text-sm text-muted-foreground">Claude couldn't read the changes: {review.result.error}</p> : null}
          {!review.running && review.result && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="min-h-10" onClick={() => onAsk("Fix what you suggested before I publish.")}>Ask Claude to fix these</Button>
              <Button variant="outline" className="min-h-10" onClick={ask}>Read again</Button>
              {review.result.ok && <span className="text-xs text-muted-foreground">Took {review.result.seconds} s{review.result.cost != null ? ` · US$${review.result.cost.toFixed(3)}` : ""}</span>}
            </div>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2 rounded-2xl border bg-background p-5">
        <div><h2 className="text-base font-semibold">Things to look at</h2><p className="text-sm text-muted-foreground">Found automatically. They don't stop you from publishing.</p></div>
        {!contrast.length && !distinct.length && <p className="text-sm">Nothing to look at.</p>}
        {contrast.map((c) => <p key={exceptionKey.contrast(c)} className="rounded-xl border border-warning/50 bg-warning/10 px-3.5 py-2 text-sm">{roleName(c.fg)} is hard to read on {roleName(c.bg.replace(/\/\d+$/, ""))}{c.mode === "dark" ? " in dark mode" : ""}.</p>)}
        {distinct.map((d) => <p key={exceptionKey.distinct(d)} className="rounded-xl border border-warning/50 bg-warning/10 px-3.5 py-2 text-sm">{roleName(d.a)} and {roleName(d.b)} look almost the same{d.mode === "dark" ? " in dark mode" : ""}.</p>)}
        {(contrast.length > 0 || distinct.length > 0) && <p className="text-xs text-muted-foreground">Fix these in Style, or ask Claude.</p>}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border bg-background p-5">
        <h2 className="text-base font-semibold">Where it goes</h2>
        {defaults === null ? <p className="text-sm text-muted-foreground">Checking GitHub…</p> : !defaults.ghInstalled ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>Publishing uses the GitHub CLI to create the repository on your account. Install it, then come back.</p>
            <div className="flex flex-wrap gap-2"><Button asChild><a href="https://cli.github.com" target="_blank" rel="noreferrer">Download GitHub CLI</a></Button><Button variant="outline" onClick={refresh}>I installed it</Button></div>
          </div>
        ) : connected ? (
          <p className="text-sm">GitHub account: <strong>{defaults.user}</strong>{defaults.plan ? <span className="text-muted-foreground"> · {defaults.plan} plan</span> : null}</p>
        ) : login.status === "waiting" ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>A GitHub page opened in your browser. Enter this code there and press <strong>Authorize</strong>:</p>
            <code className="self-start rounded-md border bg-muted px-3 py-1.5 font-mono text-lg tracking-widest select-all">{login.code}</code>
            <p className="text-muted-foreground">Waiting for you to authorize… <button type="button" className="underline" onClick={() => api.githubCancel().catch((e) => onError(e.message))}>Cancel</button></p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <p>{defaults.ghAuthed ? `Connected as ${defaults.user}, but the sign-in can't deploy your component site yet. Grant it once:` : "Connect your GitHub account. You sign in on github.com; Plinth never sees your password."}</p>
            {login.status === "error" && <p className="text-destructive">{login.error}</p>}
            <Button className="self-start" onClick={() => api.githubLogin().catch((e) => onError(e.message))} disabled={login.status === "starting"}>{login.status === "starting" ? "Opening GitHub…" : defaults.ghAuthed ? "Grant permission" : "Connect GitHub"}</Button>
          </div>
        )}
        {defaults && (defaults.remote ? (
          <p className="text-sm">Repository: <code>{defaults.repo ?? defaults.remote}</code>{defaults.visibility ? <span className="text-muted-foreground"> · {defaults.visibility === "PUBLIC" ? "anyone with the link can see it" : "only people you invite"}</span> : null}</p>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm font-semibold">New repository (your-account/name)<input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="your-account/design-system" className="h-11 rounded-lg border bg-background px-3 font-mono font-normal" /></label>
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="mb-1.5 font-semibold">Who can see your component site</legend>
              {(["public", "private"] as const).map((v) => (
                <label key={v} className={`flex items-start gap-2.5 rounded-xl border-[1.5px] px-3 py-2.5 ${visibility === v ? "border-foreground" : ""}`}>
                  <input type="radio" name="visibility" checked={visibility === v} onChange={() => setVisibility(v)} className="mt-1 accent-foreground" />
                  <span className="flex flex-col"><strong>{v === "public" ? "Anyone with the link" : "Only people you invite"}</strong><span className="text-muted-foreground">{v === "public" ? "Free on every GitHub plan." : defaults.privatePagesAllowed === false ? "Your GitHub plan can't put a private component site online." : "The code stays private."}</span></span>
                </label>
              ))}
            </fieldset>
          </>
        ))}
        <p className="text-sm text-muted-foreground">Before anything goes online, every component is tested. If a test fails, nothing changes online and your team keeps seeing the last version.</p>

        {started && publish.steps.length > 0 && (
          <ol className="flex flex-col gap-1.5 border-t pt-3 text-sm">
            {publish.steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2"><span aria-hidden="true" className={`size-2.5 rounded-full ${s.ok ? "bg-success" : "bg-destructive"}`} />{STEP_LABEL[s.name] ?? s.name}{typeof s.detail === "string" && !s.ok && <span className="text-muted-foreground">· {s.detail}</span>}</li>
            ))}
            {publish.running && <li className="flex items-center gap-2 text-muted-foreground"><span aria-hidden="true" className="size-2.5 animate-pulse rounded-full bg-primary" />Working…</li>}
          </ol>
        )}
        {result?.published && (
          <div className="flex flex-col gap-1 rounded-xl border border-success/50 bg-success/10 p-3.5 text-sm">
            <strong>Published. Your team can see it now.</strong>
            {result.storybook && <span>Component site: <a className="underline" href={result.storybook} target="_blank" rel="noreferrer">{result.storybook}</a></span>}
            <span>On GitHub: <a className="underline" href={result.github} target="_blank" rel="noreferrer">{result.github}</a></span>
            <span className="text-muted-foreground">{result.note}</span>
          </div>
        )}
        {result?.published && result.pagesBlocked === "plan" && !fixed && (
          <div className="flex flex-col gap-2 rounded-xl border border-warning/60 bg-warning/10 p-3.5 text-sm">
            <p>Your component site isn't online: your GitHub plan doesn't serve sites for private repositories. Make it public to put the site online, or keep it private without one.</p>
            <Button className="self-start" onClick={makePublic} disabled={fixing}>{fixing ? "Making it public…" : "Make it public"}</Button>
          </div>
        )}
        {fixed && <p className="text-sm">Deploying. {fixed.storybook && <a className="underline" href={fixed.storybook} target="_blank" rel="noreferrer">{fixed.storybook}</a>}</p>}
        {result && !result.published && !result.dryRun && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-destructive/40 bg-destructive/5 p-3.5 text-sm">
            <strong>Stopped at {STEP_LABEL[result.stoppedAt ?? ""] ?? result.stoppedAt}.</strong>
            {result.error && <p>{result.error}</p>}
            {result.next && <p className="text-muted-foreground">{result.next}</p>}
            {result.blocking?.length ? <ul className="list-disc pl-5">{result.blocking.map((b) => <li key={b.detail}>{b.detail}</li>)}</ul> : null}
            {result.tests?.tests?.failures?.length ? <ul className="list-disc pl-5">{result.tests.tests.failures.map((f) => <li key={f}>{f}</li>)}</ul> : null}
            <Button variant="outline" className="self-start" onClick={() => onAsk(`Publishing stopped at ${result.stoppedAt}. Help me fix it.`)}>Ask Claude</Button>
          </div>
        )}
      </section>
      <Cta back={{ label: "← Components", onClick: onBack }} status={publish.running ? "Publishing… about a minute" : result?.published ? "Published" : blocked}
        next={{ label: publish.running ? "Publishing…" : defaults?.remote ? "Publish" : "Create the repository and publish", disabled: Boolean(blocked) || publish.running, onClick: start }} />
    </div>
  );
}
