// Text the user would otherwise have to write is drafted for them and only confirmed (or changed). Here: the
// description of the next version. The engine's line comes at once; Claude's replaces it when it arrives, unless the
// user has started typing. Drafted again whenever the unsaved changes change.
import { useEffect, useRef, useState } from "react";
import { api, type State } from "@/lib/api";

export function useVersionDraft(state: State) {
  const [text, setText] = useState("");
  const [by, setBy] = useState<"writing" | "claude" | "plinth" | "you">("writing");
  const edited = useRef(false);
  const has = (state.unsaved?.length ?? 0) > 0;
  const key = JSON.stringify([state.unsaved?.map((u) => u.file), state.lastChange?.at]);
  useEffect(() => {
    if (!has) return;
    let off = false;
    edited.current = false;
    setBy("writing");
    api.versionDraft().then((d) => { if (!off && !edited.current && d.text) setText(d.text); }).catch(() => {});
    api.versionDraftByClaude()
      .then((d) => { if (off || edited.current) return; if (d.text) setText(d.text); setBy(d.by === "claude" ? "claude" : "plinth"); })
      .catch(() => { if (!off && !edited.current) setBy("plinth"); });
    return () => { off = true; };
  }, [key, has]);
  return {
    text,
    writing: by === "writing",
    change: (t: string) => { edited.current = true; setBy("you"); setText(t); },
    note: by === "writing" ? "Claude is describing your changes…" : by === "claude" ? "Written by Claude from your changes. Change it if you like." : by === "plinth" ? "Made from your changes. Change it if you like." : "",
  };
}

export function VersionField({ draft, className = "" }: { draft: ReturnType<typeof useVersionDraft>; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-sm font-semibold ${className}`}>
      Description of this version
      <input value={draft.text} onChange={(e) => draft.change(e.target.value)} placeholder={draft.writing ? "Writing…" : "What changed"} className="h-11 rounded-lg border bg-background px-3 font-normal" />
      <span role="status" className="min-h-4 text-xs font-normal text-muted-foreground">{draft.note}</span>
    </label>
  );
}
