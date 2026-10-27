import type { State } from "@/lib/api";
import { Cta } from "@/lib/cta";

const ACTIVITY: Record<string, string> = {
  "get guidelines": "reading the guidelines", "get tokens": "reading the colors", change: "writing", "set style": "adjusting the style",
  "list components": "looking at the components", "run checks": "checking", status: "looking around",
};

/** The design system being made: the engine's steps are instant, Claude's run in the chat beside this page. */
export function CreatingView({ state, onNext }: { state: State; onNext: () => void }) {
  const setup = state.setup;
  if (!setup) return null;
  const running = setup.running;
  const chat = state.chat;
  const tool = chat?.activity?.tool;
  const seconds = setup.finishedAt ? Math.round((Date.parse(setup.finishedAt) - Date.parse(setup.startedAt)) / 1000) : null;
  const claudeFailed = setup.steps.some((s) => s.id === "claude" && s.status === "error");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-muted-foreground">Step 1 of 4</span>
        <h1 className="text-2xl font-semibold tracking-tight">{running ? (setup.fresh ? "Making your design system" : "Applying your new answers") : setup.error ? "Something went wrong" : "Your design system is ready"}</h1>
        <p className="text-muted-foreground">{running ? "This takes a few minutes. Claude's part shows up in the chat as it works." : "Next, check the overall style, then each component. Nothing is published until you choose to."}</p>
      </div>
      <section className="flex flex-col gap-3.5 rounded-2xl border bg-background p-5">
        {setup.steps.map((s) => (
          <div key={s.id} className="flex items-start gap-3">
            <span aria-hidden="true" className={`mt-0.5 grid size-6 flex-none place-items-center rounded-full text-xs font-bold ${s.status === "done" ? "bg-success text-white" : s.status === "error" ? "bg-destructive text-white" : s.status === "active" ? "border-2 border-foreground" : "border-2 border-border"}`}>
              {s.status === "done" ? "✓" : s.status === "error" ? "!" : s.status === "active" ? <span className="size-2 animate-pulse rounded-full bg-foreground" /> : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={s.status === "active" ? "font-semibold" : s.status === "waiting" ? "text-muted-foreground" : ""}>{s.label}</span>
              {s.id === "claude" && s.status === "active" && <span className="text-sm text-muted-foreground">Claude is {tool ? ACTIVITY[tool] ?? tool : "thinking"}…</span>}
              {s.id === "deps" && s.status === "active" && <span className="text-sm text-muted-foreground">You can continue while this finishes; the component previews need it.</span>}
              {s.detail && <span className={`text-sm ${s.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{s.detail}</span>}
            </span>
            <span className="text-xs text-muted-foreground">{s.who}</span>
          </div>
        ))}
        {setup.error && <p className="text-sm text-destructive">{setup.error}</p>}
        {claudeFailed && <p className="text-sm">Your colors, corners and font are applied. Ask Claude in the chat to write the style guide again when it's available.</p>}
      </section>
      <Cta
        status={running ? "Working…" : `${seconds !== null ? `Took ${seconds < 90 ? `${seconds} seconds` : `${Math.round(seconds / 60)} minutes`}` : ""}${setup.cost != null ? ` · US$${setup.cost.toFixed(2)} of Claude usage` : ""}`}
        next={{ label: running ? "Making it…" : "Next: check the style →", disabled: running || !state.exists, onClick: onNext }}
      />
    </div>
  );
}
