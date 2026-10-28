// The top of every step: what you decide here, how to change it, and when the step is done (PRD 下一版 item 19).
import type { ReactNode } from "react";

type Props = { n: number; title: string; note?: string; decide: string; change: string; done: string; children?: ReactNode };

export function StepIntro({ n, title, note, decide, change, done, children }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-muted-foreground">Step {n} of 4{note ? ` · ${note}` : ""}</span>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <dl className="grid max-w-3xl grid-cols-1 gap-x-5 gap-y-1 text-sm sm:grid-cols-[7rem_1fr]">
        <dt className="font-semibold">You decide</dt><dd className="text-muted-foreground">{decide}</dd>
        <dt className="font-semibold">Change it</dt><dd className="text-muted-foreground">{change}</dd>
        <dt className="font-semibold">Done when</dt><dd className="text-muted-foreground">{done}</dd>
      </dl>
      {children}
    </div>
  );
}
