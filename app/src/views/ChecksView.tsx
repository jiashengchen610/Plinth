import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, exceptionKey, type CheckName, type ContrastResult, type DistinctResult, type Hardcoded, type State, type StructureResult } from "@/lib/api";
import { ratioLabel, timeAgo } from "@/lib/format";

type Props = {
  state: State; busy: boolean;
  onFixContrast: () => void;
  onRunTests: () => void;
  onInstall: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
};

const modeLabel = (m: string) => (m === "default" ? "light" : m);

/** One failing item with an inline "Accept as exception" flow: reason first, then confirm. */
function Failing({ title, detail, check, keyOf, acceptLabel = "Accept", onDone, onError }: { title: string; detail: string; check: CheckName; keyOf: string; acceptLabel?: string; onDone: () => void; onError: (m: string) => void }) {
  const [reason, setReason] = useState<string | null>(null);
  // Contrast and distinct keys are brand|mode|a|b; "everywhere" accepts the pair in every brand and mode.
  const canWiden = check !== "hardcoded";
  const [everywhere, setEverywhere] = useState(canWiden);
  const accept = async () => {
    const key = everywhere && canWiden ? keyOf.replace(/^[^|]+\|[^|]+\|/, "*|*|") : keyOf;
    try { await api.acceptException(check, key, reason ?? ""); setReason(null); onDone(); } catch (e) { onError((e as Error).message); }
  };
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm">
          <span className="font-medium">{title}</span>
          <span className="ml-2 text-muted-foreground">{detail}</span>
        </div>
        {reason === null && <Button size="sm" variant="outline" onClick={() => setReason("")}>{acceptLabel}…</Button>}
      </div>
      {reason !== null && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); accept(); }}>
          <label htmlFor={`reason-${keyOf}`} className="sr-only">Why this is acceptable</label>
          <input id={`reason-${keyOf}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={check === "contrast" ? "Why? e.g. decorative text, not read for information" : "Why? (recorded in design-system.json)"} className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" autoFocus />
          {canWiden && <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} />every brand and mode</label>}
          <Button size="sm" type="submit">{acceptLabel}</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setReason(null)}>Cancel</Button>
        </form>
      )}
    </li>
  );
}

function Section({ title, ok, advisory, count, children, action }: { title: string; ok: boolean; advisory?: boolean; count?: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <span aria-hidden="true" className={`size-2.5 rounded-full ${ok ? "bg-success" : advisory ? "bg-warning" : "bg-destructive"}`} />
          {title}
          {advisory && <Badge variant="outline">advisory</Badge>}
          {count && <span className="text-sm font-normal text-muted-foreground">{count}</span>}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function ChecksView({ state, busy, onFixContrast, onRunTests, onInstall, onChanged, onError }: Props) {
  const c = state.checks;
  const contrast = c.contrast.filter((r) => !r.pass && !r.accepted);
  const distinct = c.distinct.filter((r) => !r.pass && !r.accepted);
  const hardcoded = c.hardcoded.filter((f) => !f.accepted);
  const structure = (c.structure ?? []).filter((r) => !r.accepted);
  const tests = state.tests;
  const t = tests.last;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Design findings are reminders: they never stop publishing. Only a broken token reference (a token pointing at nothing) does, because the styles would break. Where the program can fix something it offers a fix; otherwise ask Claude, or mark the finding as intended.
      </p>

      <Section title="Contrast" advisory ok={contrast.length === 0} count={`${c.summary.contrast?.failing ?? 0} failing · ${c.summary.contrast?.accepted ?? 0} accepted · ${c.contrast.length} pairs`}
        action={contrast.length > 0 ? <Button size="sm" onClick={onFixContrast} disabled={busy}>Fix contrast</Button> : undefined}>
        {contrast.length > 0 && (
          <ul className="mt-3 divide-y">
            {contrast.map((r: ContrastResult) => (
              <Failing key={exceptionKey.contrast(r)} check="contrast" keyOf={exceptionKey.contrast(r)} title={`${r.fg} on ${r.bg}`} detail={`${r.brand} · ${modeLabel(r.mode)} · ${ratioLabel(r.ratio)}, needs ${r.min}`} onDone={onChanged} onError={onError} />
            ))}
          </ul>
        )}
        {contrast.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Every text and background pair meets WCAG AA in every brand and mode.</p>}
        <p className="mt-2 text-xs text-muted-foreground">Only text-on-surface pairs are checked (each <code>X</code> with its <code>X-foreground</code>); borders, rings and shadows are not. A text role that is purely decorative in your product can be accepted once for every brand and mode.</p>
      </Section>

      <Section title="Look-alike roles" ok={distinct.length === 0} advisory count={`${distinct.length} to look at · ${c.summary.distinct?.accepted ?? 0} intended`}>
        {distinct.length > 0 ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">These colors carry different meanings but look alike. Sharing a color can be a deliberate choice; this never blocks publishing. Ask Claude to move one (for example "move destructive back to red"), or mark the pair as intended.</p>
            <ul className="mt-1 divide-y">
              {distinct.map((r: DistinctResult) => (
                <Failing key={exceptionKey.distinct(r)} check="distinct" keyOf={exceptionKey.distinct(r)} title={`${r.a} and ${r.b}`} detail={`${r.brand} · ${modeLabel(r.mode)} · ${r.reason}${r.hueDiff !== null ? ` (hue ${r.hueDiff}° apart)` : ""}, distance ${r.deltaE}`} acceptLabel="Intended" onDone={onChanged} onError={onError} />
              ))}
            </ul>
          </>
        ) : <p className="mt-2 text-sm text-muted-foreground">Primary, destructive and status colors can be told apart in every brand and mode.</p>}
      </Section>

      <Section title="Layers" advisory ok={structure.length === 0} count={`${structure.length} to look at`}
        action={structure.some((s) => s.kind === "unlinked") ? <Button size="sm" onClick={() => api.linkPalette().then(onChanged).catch((e) => onError((e as Error).message))} disabled={busy}>Link colors to the palette</Button> : undefined}>
        {state.layers ? (
          structure.length > 0 ? (
            <ul className="mt-1 divide-y">
              {structure.slice(0, 40).map((r: StructureResult) => (
                <Failing key={exceptionKey.structure(r)} check="structure" keyOf={exceptionKey.structure(r)} title={r.kind === "unlinked" ? "Not on the palette" : "Points up a layer"} detail={`${r.detail} · ${r.brand}`} acceptLabel="Intended" onDone={onChanged} onError={onError} />
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-muted-foreground">Every role points at the palette and every component token at a role.</p>
        ) : <p className="mt-2 text-sm text-muted-foreground">This design system has no layers yet. Use the upgrade banner at the top of the page.</p>}
      </Section>

      <Section title="Hardcoded values" advisory ok={hardcoded.length === 0} count={`${hardcoded.length} in components`}>
        {hardcoded.length > 0 ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">Components must use tokens. Ask Claude to replace these with theme utilities, or accept a deliberate exception.</p>
            <ul className="mt-1 divide-y">
              {hardcoded.map((f: Hardcoded) => (
                <Failing key={exceptionKey.hardcoded(f) + f.line} check="hardcoded" keyOf={exceptionKey.hardcoded(f)} title={f.match} detail={`${f.file}:${f.line} · ${f.rule}`} onDone={onChanged} onError={onError} />
              ))}
            </ul>
          </>
        ) : <p className="mt-2 text-sm text-muted-foreground">No raw colors or pixel values in generated components.</p>}
      </Section>

      <Section title="Tokens" ok={c.tokenIssues.length === 0} count={c.tokenIssues.length ? `${c.tokenIssues.length} issues` : undefined}>
        {c.tokenIssues.length > 0 ? <ul className="mt-2 list-disc pl-5 text-sm">{c.tokenIssues.map((i) => <li key={i}>{i}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">Every brand defines the same tokens; all aliases resolve.</p>}
      </Section>

      <Section title="Tests" ok={!t || t.ok} count={t ? `last run ${timeAgo(t.at ?? new Date().toISOString())}` : "not run yet"}
        action={!state.deps.installed
          ? <Button size="sm" variant="outline" onClick={onInstall} disabled={busy || state.deps.installing}>{state.deps.installing ? "Installing…" : "Install dependencies"}</Button>
          : <Button size="sm" variant="outline" onClick={onRunTests} disabled={busy || tests.running}>{tests.running ? "Running…" : "Run tests"}</Button>}>
        <p className="mt-2 text-sm text-muted-foreground">TypeScript, and every story's interaction and accessibility tests in a real browser. About a minute. Publish runs them too, and GitHub Actions runs them again before deploying.</p>
        {t && (
          <div className="mt-3 flex flex-col gap-2 text-sm">
            {t.error && <p className="text-muted-foreground">{t.error} {t.next}</p>}
            {t.typecheck && <p><Badge variant={t.typecheck.ok ? "secondary" : "destructive"}>Types {t.typecheck.ok ? "ok" : "failed"}</Badge></p>}
            {t.tests && <p><Badge variant={t.tests.ok ? "secondary" : "destructive"}>Stories {t.tests.ok ? `${t.tests.passed} passed` : `${t.tests.failed ?? "some"} failed`}</Badge></p>}
            {t.tests && t.tests.failures.length > 0 && <ul className="list-disc pl-5">{t.tests.failures.map((f) => <li key={f}>{f}</li>)}</ul>}
            {(t.typecheck?.tail || t.tests?.tail) && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{t.typecheck?.tail ?? t.tests?.tail}</pre>}
          </div>
        )}
      </Section>

      {c.exceptions.length > 0 && (
        <section className="rounded-xl border p-5">
          <h2 className="font-medium">Accepted exceptions</h2>
          <p className="mt-1 text-sm text-muted-foreground">Recorded in design-system.json and listed when you publish.</p>
          <ul className="mt-2 divide-y text-sm">
            {c.exceptions.map((e) => (
              <li key={`${e.check}|${e.key}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0"><Badge variant="outline" className="mr-2">{e.check}</Badge><code className="text-xs">{e.key}</code>{e.reason && <span className="ml-2 text-muted-foreground">{e.reason}</span>}</span>
                <Button size="sm" variant="ghost" onClick={() => api.removeException(e.check, e.key).then(onChanged).catch((err) => onError((err as Error).message))}>Remove</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
