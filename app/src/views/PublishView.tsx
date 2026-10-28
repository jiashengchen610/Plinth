import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, exceptionKey, type Deploy, type PublishDefaults, type State } from "@/lib/api";
import { Cta } from "@/lib/cta";
import { useVersionDraft, VersionField } from "@/lib/draft";
import { fileName, isGenerated, roleName } from "@/lib/plain";
import { Reply } from "@/views/ChatPanel";
import { isPublishCommit, versionTitle, VersionTree } from "@/views/VersionTree";

type Props = { state: State; onError: (m: string) => void; onAsk: (text: string) => void; onBack: () => void; onSaved: (m: string) => void; onNewRound: () => void };

const STEP_LABEL: Record<string, string> = { "unsaved changes": "Saved versions", unsaved: "Saved versions", checks: "Checks", exports: "Style guide for other tools", commit: "Version", tests: "Testing every component", "create repository": "Creating the GitHub repository", push: "Sending to GitHub", pages: "Building your component site" };

export function PublishView({ state, onError, onAsk, onBack, onSaved, onNewRound }: Props) {
  const [defaults, setDefaults] = useState<PublishDefaults | null>(null);
  const [repo, setRepo] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("public");
  const [started, setStarted] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [savedNow, setSavedNow] = useState(false);
  const [savedText, setSavedText] = useState("");
  const draft = useVersionDraft(state);
  const [saving, setSaving] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixed, setFixed] = useState<{ storybook: string | null; actions: string; note: string } | null>(null);
  const publish = state.publish;
  // This publish's result (not one left from an earlier publish).
  const result = started && !publish.running && publish.result?.at && Date.parse(publish.result.at) >= startedAt - 2000 ? publish.result : null;
  const login = state.github;
  const { deploy, retry } = useDeploy(`${result?.at ?? ""}${fixed ? "+fixed" : ""}`, Boolean(defaults?.remote || result?.published));
  // Publishing has one page while it works (here, then on GitHub) and a success page once the site is online with it.
  // A stop on this computer or on GitHub comes back to this page, with what stopped it at the top.
  const github = result?.published && deploy && result.version && deploy.sha.startsWith(result.version) ? deploy.status : null;
  const phase = !started ? "form" : !result ? "progress" : !result.published || result.pagesBlocked ? "form" : github === "live" ? "success" : github === "failed" ? "form" : "progress";
  useEffect(() => { document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" }); }, [phase]);

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
  // Unsaved changes are saved first, with the description Claude drafted (the user can change it): one click.
  const start = async () => {
    try {
      setStarted(true);
      setStartedAt(Date.now());
      setSavedNow(unsaved.length > 0);
      const text = draft.text.trim() || state.lastChange?.title || "Changes before publishing";
      setSavedText(unsaved.length ? text : "");
      if (unsaved.length) {
        setSaving(true);
        await api.save(text);
        setSaving(false);
        onSaved("Saved a version.");
      }
      await api.publish(defaults?.remote ? {} : { repo, visibility });
    } catch (e) { setSaving(false); setStarted(false); onError((e as Error).message); }
  };
  const makePublic = async () => { setFixing(true); try { setFixed(await api.makePublicAndDeploy()); refresh(); } catch (e) { onError((e as Error).message); } finally { setFixing(false); } };

  const connected = Boolean(defaults?.ghInstalled && defaults.ghAuthed && defaults.scopesOk);
  const privateBlocked = !defaults?.remote && visibility === "private" && defaults?.privatePagesAllowed === false;
  const contrast = state.checks.contrast.filter((c) => !c.pass && !c.accepted);
  const distinct = state.checks.distinct.filter((d) => !d.pass && !d.accepted);
  const brokenRefs = state.checks.tokenIssues;
  const published = state.versions.some((v) => v.published);
  const sinceLast = published ? state.versions.slice(0, state.versions.findIndex((v) => v.published)) : state.versions;
  const blocked = !connected ? "Connect GitHub first." : privateBlocked ? "Your GitHub plan can't put a private component site online." : brokenRefs.length ? "Some colors point at something that no longer exists. Ask Claude to fix it." : !defaults?.remote && !/^[\w.-]+\/[\w.-]+$/.test(repo) ? "Pick a repository name." : "";

  const latest = state.versions.find((v) => !isPublishCommit(v));
  const subject = savedText || (latest ? versionTitle(latest) : "your design system");
  if (phase === "progress") return <PublishProgress subject={subject} savedNow={savedNow} saving={saving} steps={publish.running || result ? publish.steps : []} github={github} deploy={deploy} startedAt={startedAt} onBack={onBack} />;
  if (phase === "success" && deploy) return <PublishSuccess subject={subject} deploy={deploy} state={state} onNewRound={onNewRound} />;
  // Nothing new since the live version: this round is done; the next one starts with more changes.
  const nothingNew = published && !sinceLast.filter((v) => !isPublishCommit(v)).length && !unsaved.length && (!deploy || deploy.status === "live");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-muted-foreground">Step 4 of 4 · optional</span>
        <h1 className="text-2xl font-semibold tracking-tight">Publish</h1>
        <p className="text-muted-foreground">Publishing puts your saved versions on GitHub and updates your component site, so your team can use them. You can skip it and keep working on your computer.</p>
      </div>

      <DeployStatus d={deploy} onAsk={onAsk} onError={onError} onRetry={retry} />

      {unsaved.length > 0 && !started && (
        <section className="flex flex-col gap-3 rounded-2xl border bg-background p-5">
          <div><h2 className="text-base font-semibold">Your changes are saved as a version first</h2><p className="text-sm text-muted-foreground">Changed since your last version: {[...new Set(unsaved.filter((u) => !isGenerated(u.file)).map((u) => fileName(u.file)))].join(", ")}.</p></div>
          <VersionField draft={draft} />
        </section>
      )}

      <section className="flex flex-col gap-2 rounded-2xl border bg-background p-5">
        <h2 className="text-base font-semibold">What's new since you last published</h2>
        {!sinceLast.length && !unsaved.length ? <p className="text-sm text-muted-foreground">Nothing new. Your team already sees the latest version.</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {!published && <li>Your whole design system (the first time you publish)</li>}
            {published && sinceLast.filter((v) => !isPublishCommit(v)).map((v) => <li key={v.sha}>• {versionTitle(v)}</li>)}
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
          <p className="text-sm">Sent to GitHub: <a className="underline" href={result.github} target="_blank" rel="noreferrer">{result.github}</a></p>
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
      {nothingNew ? <Cta back={{ label: "← Components", onClick: onBack }} status="Your site has the latest version" next={{ label: "Make more changes →", onClick: onNewRound }} />
        : <Cta back={{ label: "← Components", onClick: onBack }} status={publish.running ? "Publishing… about a minute" : blocked || (deploy?.status === "running" || deploy?.status === "waiting" ? "GitHub is testing, then putting it online" : deploy?.status === "failed" ? "GitHub stopped the last publish: see the top of the page" : deploy?.status === "live" ? "Your site is online" : "")}
        next={{ label: saving ? "Saving…" : publish.running ? "Publishing…" : `${unsaved.length ? "Save and " : ""}${defaults?.remote ? "publish" : "create the repository and publish"}`.replace(/^./, (c) => c.toUpperCase()), disabled: Boolean(blocked) || publish.running || saving, onClick: start }} />}
    </div>
  );
}

const STEP_PLAIN = (step: string) => /npm test|test/i.test(step) ? "testing every component" : /check/i.test(step) ? "Plinth's checks" : /typecheck|tsc/i.test(step) ? "checking the code" : /deploy|pages/i.test(step) ? "putting the site online" : /install|npm ci/i.test(step) ? "installing" : step;
/** "src/components/radio-group/radio-group.stories.tsx › Keyboard" → "Radio group › Keyboard" */
const testName = (f: string) => f.replace(/^src\/components\/([^/]+)\/\S+ › /, (_m, id: string) => `${id[0].toUpperCase()}${id.slice(1).replace(/-/g, " ")} › `);

/**
 * What GitHub did after the push: it tests every component, then puts the site online, or stops and leaves the
 * last good version online. Checked every 10 seconds while GitHub works; `retry` after starting it again.
 */
export function useDeploy(kick: string, on: boolean) {
  const [deploy, setDeploy] = useState<Deploy>(null);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (!on) return;
    let off = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const r = await api.deploy();
        if (off) return;
        setDeploy(r.deploy);
        if (r.deploy && ["waiting", "running", "unknown"].includes(r.deploy.status)) timer = window.setTimeout(tick, 10_000);
      } catch { if (!off) timer = window.setTimeout(tick, 15_000); }
    };
    tick();
    return () => { off = true; window.clearTimeout(timer); };
  }, [kick, again, on]);
  const retry = useCallback(() => { setDeploy((d) => (d ? { ...d, status: "waiting" } : d)); setAgain((n) => n + 1); }, []);
  return { deploy, retry };
}

function DeployStatus({ d, onAsk, onError, onRetry }: { d: Deploy; onAsk: (text: string) => void; onError: (m: string) => void; onRetry: () => void }) {
  if (!d) return null;
  const details = <a className="underline" href={d.run ?? d.actions} target="_blank" rel="noreferrer">Details on GitHub</a>;
  if (d.status === "waiting" || d.status === "running") {
    return (
      <div role="status" className="flex flex-col gap-1 rounded-xl border border-info/40 bg-info/5 p-3.5 text-sm">
        <span className="flex items-center gap-2 font-semibold"><span aria-hidden="true" className="size-2.5 animate-pulse rounded-full bg-info" />GitHub is testing every component, then putting your site online</span>
        <span className="text-muted-foreground">Usually 2 to 3 minutes. Your team keeps seeing the last version until then. {details}</span>
      </div>
    );
  }
  if (d.status === "live") {
    return (
      <div role="status" className="flex flex-col gap-1 rounded-xl border border-success/50 bg-success/10 p-3.5 text-sm">
        <strong>Your component site is online with your last publish.</strong>
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          {d.site && <a className="underline" href={d.site} target="_blank" rel="noreferrer">{d.site}</a>}
          {d.github && <a className="underline" href={d.github} target="_blank" rel="noreferrer">Repository on GitHub</a>}
        </span>
      </div>
    );
  }
  if (d.status === "failed") {
    const what = d.failures?.length ? d.failures.map(testName) : d.errors?.length ? d.errors : [];
    const ask = `GitHub stopped before putting my component site online, at ${d.step ? STEP_PLAIN(d.step) : "one of its steps"}.${what.length ? ` What failed: ${what.join("; ")}.` : ""} Find out why and fix it, then tell me when I can publish again.`;
    return (
      <div role="status" className="flex flex-col gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3.5 text-sm">
        <strong>GitHub stopped before putting your site online{d.step ? `, while ${STEP_PLAIN(d.step)}` : ""}.</strong>
        {what.length > 0 && <ul className="list-disc pl-5">{what.map((w) => <li key={w}>{w}</li>)}</ul>}
        <span className="text-muted-foreground">Nothing new went online. {details}</span>
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-10" onClick={() => onAsk(ask)}>Ask Claude to fix it</Button>
          <Button variant="outline" className="min-h-10" onClick={async () => { try { await api.redeploy(); onRetry(); } catch (e) { onError((e as Error).message); } }}>Try again</Button>
        </div>
      </div>
    );
  }
  return <p className="text-sm text-muted-foreground">Couldn't check what GitHub did{d.error ? `: ${d.error}` : ""}. {details}</p>;
}

type StepState = "done" | "active" | "waiting";
const StepIcon = ({ s }: { s: StepState }) => (
  s === "done" ? <span aria-hidden="true" className="grid size-6 flex-none place-items-center rounded-full bg-success text-xs font-bold text-white">✓</span>
    : s === "active" ? <span aria-hidden="true" className="grid size-6 flex-none place-items-center rounded-full border-2 border-info"><span className="size-2.5 animate-pulse rounded-full bg-info" /></span>
    : <span aria-hidden="true" className="size-6 flex-none rounded-full border-2 border-border" />
);
const duration = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);

/** The page while a publish works: here (save, check, test, send), then on GitHub (test again, build, online). */
function PublishProgress({ subject, savedNow, saving, steps, github, deploy, startedAt, onBack }: {
  subject: string; savedNow: boolean; saving: boolean; steps: { name: string; ok: boolean }[];
  github: string | null; deploy: Deploy; startedAt: number; onBack: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const pushed = steps.some((s) => s.name === "push" && s.ok);
  const sending = steps.some((s) => ["tests", "create repository", "pages"].includes(s.name));
  const rows: { label: string; hint?: string; s: StepState }[] = [
    ...(savedNow ? [{ label: "Saving your changes as a version", s: (saving ? "active" : "done") as StepState }] : []),
    { label: "Checking and testing every component on this computer", hint: "So a broken component never reaches your team.", s: saving ? "waiting" : sending || pushed ? "done" : "active" },
    { label: "Sending it to GitHub", s: pushed ? "done" : sending ? "active" : "waiting" },
    { label: "GitHub tests every component again and builds your site", hint: github === "unknown" ? "Couldn't reach GitHub just now; trying again." : "Usually 2 to 3 minutes.", s: !pushed ? "waiting" : github === "live" ? "done" : "active" },
    { label: "Your component site is online", s: github === "live" ? "done" : "waiting" },
  ];
  const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-muted-foreground">Step 4 of 4</span>
        <h1 className="text-2xl font-semibold tracking-tight">Publishing</h1>
        <p className="text-muted-foreground">“{subject}” is on its way to your team. You can keep working meanwhile: what you change now goes out with your next publish.</p>
      </div>
      <section aria-live="polite" className="flex flex-col gap-4 rounded-2xl border bg-background p-5">
        <ol className="flex flex-col gap-3.5">
          {rows.map((r) => (
            <li key={r.label} className="flex items-start gap-3">
              <StepIcon s={r.s} />
              <span className="flex flex-col leading-snug"><span className={r.s === "waiting" ? "text-muted-foreground" : r.s === "active" ? "font-semibold" : ""}>{r.label}</span>{r.hint && r.s === "active" && <span className="text-sm text-muted-foreground">{r.hint}</span>}</span>
            </li>
          ))}
        </ol>
        {pushed && deploy && <a className="self-start text-sm underline" href={deploy.run ?? deploy.actions} target="_blank" rel="noreferrer">Watch it on GitHub</a>}
      </section>
      <Cta back={{ label: "← Keep working", onClick: onBack }} status={`Publishing · ${duration(elapsed)}`} next={{ label: "Publishing…", disabled: true, onClick: () => {} }} />
    </div>
  );
}

/** Once GitHub put the site online: where to look, and the versions so far. */
function PublishSuccess({ subject, deploy, state, onNewRound }: { subject: string; deploy: NonNullable<Deploy>; state: State; onNewRound: () => void }) {
  const [copied, setCopied] = useState(false);
  const site = deploy.site;
  const copy = async () => {
    if (!site) return;
    try { await navigator.clipboard.writeText(site); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* no clipboard access */ }
  };
  const docs = deploy.github ? state.brands.map((b) => ({ name: state.config.brands.find((x) => x.id === b)?.name ?? b, url: `${deploy.github}/blob/${deploy.sha}/exports/${b}/DESIGN.md` })) : [];
  const places: { title: string; text: string; links: { label: string; url: string }[] }[] = [
    { title: "Your component site", text: "Every component in light and dark mode, in each brand, with how to use it. Send this link to your team.", links: site ? [{ label: "Open the site", url: site }] : [] },
    { title: "Style guide for AI tools", text: "DESIGN.md: give it to Claude, Cursor or v0, and what they build matches your design system.", links: docs.map((d) => ({ label: docs.length > 1 ? `DESIGN.md for ${d.name}` : "Open DESIGN.md", url: d.url })) },
    { title: "Repository on GitHub", text: "Your colors, components and every saved version, for developers.", links: deploy.github ? [{ label: "Open on GitHub", url: deploy.github }] : [] },
    { title: "Test results", text: "What GitHub checked before putting it online.", links: [{ label: "See the results", url: deploy.run ?? deploy.actions }] },
  ];
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col items-start gap-3 rounded-2xl border border-success/50 bg-success/10 p-6">
        <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-success text-2xl font-bold text-white">✓</span>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Your design system is online</h1>
          <p className="text-muted-foreground">Your team now sees “{subject}”. GitHub tested every component before putting it online.</p>
        </div>
        {site && (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild className="min-h-11"><a href={site} target="_blank" rel="noreferrer">Open your component site</a></Button>
            <Button variant="outline" className="min-h-11" onClick={copy}>{copied ? "Link copied" : "Copy the link"}</Button>
            <code className="text-sm break-all text-muted-foreground">{site}</code>
          </div>
        )}
      </section>
      <section className="flex flex-col rounded-2xl border bg-background p-5">
        <h2 className="mb-1 text-base font-semibold">Where to check it</h2>
        {places.map((p) => (
          <div key={p.title} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-muted py-3 first-of-type:border-0">
            <span className="flex min-w-0 flex-[1_1_280px] flex-col leading-snug"><span className="font-semibold">{p.title}</span><span className="text-sm text-muted-foreground">{p.text}</span></span>
            <span className="flex flex-wrap gap-x-4 gap-y-1">{p.links.map((l) => <a key={l.url} className="text-sm font-medium underline" href={l.url} target="_blank" rel="noreferrer">{l.label}</a>)}</span>
          </div>
        ))}
      </section>
      <section className="flex flex-col gap-2 rounded-2xl border bg-background p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-base font-semibold">Your versions</h2><span className="text-sm text-muted-foreground">Newest on top. History has all of them.</span></div>
        <VersionTree versions={state.versions} unsaved={(state.unsaved?.length ?? 0) > 0} deploy={deploy} limit={8} />
      </section>
      <Cta status="Online · the steps start over for your next changes" next={{ label: "Make more changes →", onClick: onNewRound }} />
    </div>
  );
}
