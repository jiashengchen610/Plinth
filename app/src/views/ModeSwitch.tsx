/** Light or dark: which mode the previews and values show (and edits change). */
export function ModeSwitch({ mode, onMode }: { mode: "light" | "dark"; onMode: (m: "light" | "dark") => void }) {
  return (
    <div role="group" aria-label="Preview in light or dark mode" className="inline-flex rounded-xl bg-muted p-1">
      {(["light", "dark"] as const).map((m) => (
        <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)} className={`min-h-9 rounded-lg px-3.5 text-sm font-medium capitalize ${mode === m ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{m}</button>
      ))}
    </div>
  );
}
