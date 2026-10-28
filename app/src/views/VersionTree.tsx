// Saved versions as a tree, newest on top: one line down through every version, each publish as a milestone with
// what GitHub did with it, and a curve from each "went back to" version to the version it brought back.
import { Button } from "@/components/ui/button";
import type { Deploy, Version } from "@/lib/api";
import { timeAgo } from "@/lib/format";

type Props = {
  versions: Version[]; unsaved: boolean; deploy?: Deploy; limit?: number;
  /** History: going back to a version; `restoreBlocked` says why it can't right now. */
  onRestore?: (sha: string) => void; restoreBlocked?: string | null;
};

const ROW = 56, X = 44, GUTTER = 60;
export const isPublishCommit = (v: Version) => /^Publish: update exports$/.test(v.subject);
const RESTORE = /^Restore: (.*) \(([0-9a-f]{7,40})\)$/;
/** A version's title in plain words. */
export const versionTitle = (v: Version) => {
  const restored = RESTORE.exec(v.subject);
  return isPublishCommit(v) ? "Published to GitHub" : restored ? `Went back to “${restored[1]}”` : v.subject;
};

type Row = { kind: "unsaved" } | { kind: "publish" | "version"; v: Version };

export function VersionTree({ versions, unsaved, deploy, limit, onRestore, restoreBlocked }: Props) {
  const all: Row[] = [...(unsaved ? [{ kind: "unsaved" as const }] : []), ...versions.map((v) => ({ kind: isPublishCommit(v) ? ("publish" as const) : ("version" as const), v }))];
  const rows = limit ? all.slice(0, limit) : all;
  const y = (i: number) => i * ROW + ROW / 2;
  const indexOf = (sha: string) => rows.findIndex((r) => r.kind !== "unsaved" && r.v.sha.startsWith(sha));
  const arcs = rows.flatMap((r, i) => {
    if (r.kind !== "version") return [];
    const m = RESTORE.exec(r.v.subject);
    const j = m ? indexOf(m[2]) : -1;
    return j > i ? [{ from: i, to: j }] : [];
  });
  const firstVersion = rows.findIndex((r) => r.kind === "version");
  const h = rows.length * ROW;

  const badge = (r: Row) => {
    if (r.kind === "unsaved" || !deploy || !r.v.sha.startsWith(deploy.sha.slice(0, 7))) return null;
    if (deploy.status === "live") return <span className="rounded-full border border-success/50 bg-success/10 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap">Online now</span>;
    if (deploy.status === "failed") return <span className="rounded-full border border-destructive/40 bg-destructive/5 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap">Not online: a test failed</span>;
    if (deploy.status === "waiting" || deploy.status === "running") return <span className="rounded-full border border-info/40 bg-info/5 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap">Going online…</span>;
    return null;
  };

  return (
    <div className="relative" style={{ minHeight: h }}>
      <svg width={GUTTER} height={h} viewBox={`0 0 ${GUTTER} ${h}`} aria-hidden="true" className="absolute top-0 left-0">
        <defs><marker id="vt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="var(--info)" /></marker></defs>
        {rows.length > 1 && <line x1={X} y1={y(0)} x2={X} y2={y(rows.length - 1)} stroke="var(--border)" strokeWidth="2" />}
        {unsaved && rows.length > 1 && <line x1={X} y1={y(0)} x2={X} y2={y(1)} stroke="var(--muted-foreground)" strokeWidth="2" strokeDasharray="3 3" />}
        {arcs.map((a, k) => {
          const bx = Math.max(6, X - 18 - k * 8);
          return <path key={k} d={`M${X - 6} ${y(a.from)} C${bx} ${y(a.from)} ${bx} ${y(a.to)} ${X - 7} ${y(a.to)}`} fill="none" stroke="var(--info)" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#vt-arrow)" />;
        })}
        {rows.map((r, i) => r.kind === "unsaved"
          ? <circle key="unsaved" cx={X} cy={y(i)} r="6" fill="var(--background)" stroke="var(--muted-foreground)" strokeWidth="2" strokeDasharray="2 2" />
          : r.kind === "publish"
            ? <rect key={r.v.sha} x={X - 6} y={y(i) - 6} width="12" height="12" rx="2" transform={`rotate(45 ${X} ${y(i)})`} fill={badge(r) && deploy?.status === "live" ? "var(--success)" : "var(--background)"} stroke={deploy?.status === "failed" && badge(r) ? "var(--destructive)" : "var(--success)"} strokeWidth="2" />
            : <circle key={r.v.sha} cx={X} cy={y(i)} r="6" fill={i === firstVersion ? "var(--foreground)" : "var(--background)"} stroke="var(--foreground)" strokeWidth="2" />)}
      </svg>
      <ol className="flex flex-col" style={{ paddingLeft: GUTTER + 8 }}>
        {rows.map((r, i) => {
          if (r.kind === "unsaved") return (
            <li key="unsaved" className="flex items-center" style={{ height: ROW }}>
              <span className="flex min-w-0 flex-col leading-snug"><span className="font-semibold text-muted-foreground">Changes not in a version yet</span><span className="text-xs text-muted-foreground">Save them as a version to keep or publish them</span></span>
            </li>
          );
          const title = versionTitle(r.v);
          return (
            <li key={r.v.sha} className="flex items-center gap-3" style={{ height: ROW }}>
              <span className="flex min-w-0 flex-1 flex-col leading-snug">
                <span className={`truncate ${r.kind === "publish" ? "text-sm font-medium" : "font-semibold"}`} title={title}>{title}</span>
                <span className="text-xs text-muted-foreground">{timeAgo(r.v.date)}{r.kind === "version" ? ` · ${r.v.short}` : ""}</span>
              </span>
              {badge(r)}
              {i === firstVersion && <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap">Latest</span>}
              {onRestore && r.kind === "version" && i !== firstVersion && (
                <Button variant="outline" className="min-h-10" disabled={Boolean(restoreBlocked)} title={restoreBlocked ?? undefined} onClick={() => onRestore(r.v.sha)}>Go back to this version</Button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
