import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { Button } from "@/components/ui/button";
import { api, inboxUrl, type ChatImage, type ChatState } from "@/lib/api";
import { timeAgo } from "@/lib/format";

type Props = {
  chat: ChatState | null; onError: (message: string) => void; className?: string;
  /** The message box is controlled by the page, so "Ask Claude" buttons elsewhere can fill it in. */
  text: string; onText: (text: string) => void;
  tips?: string[]; placeholder?: string;
};

function readImage(file: File): Promise<ChatImage> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ type: file.type, name: file.name || "pasted image", data: String(r.result).split(",")[1] ?? "" });
    r.onerror = () => reject(new Error(`Could not read ${file.name}`));
    r.readAsDataURL(file);
  });
}

/** "change" → "Making a change"; keeps the UI's language plain. */
const ACTIVITY: Record<string, string> = {
  status: "Looking at the design system", "get tokens": "Reading the tokens", "get guidelines": "Reading the guidelines", "list components": "Listing the components",
  change: "Making a change", "set style": "Changing the style", "set role color": "Changing a color", "add component": "Adding a component", "remove component": "Removing a component", undo: "Undoing the last change", "run checks": "Running the checks", "run tests": "Running the tests",
  "fix contrast": "Fixing contrast", "add palette color": "Adding a palette color", "review changes": "Reading the changes", "save version": "Saving a version", "create design system": "Creating the design system", "install dependencies": "Installing dependencies (a few minutes)",
  "start storybook": "Starting Storybook", publish: "Publishing", "export design md": "Composing DESIGN.md", Read: "Looking at your image", Glob: "Looking through files", Grep: "Searching the files",
};

/** What Claude is doing right now, in plain words. */
export const activityLabel = (chat: ChatState | null) => (chat?.activity?.tool ? ACTIVITY[chat.activity.tool] ?? `Working: ${chat.activity.tool}` : "Thinking");

export function Reply({ text }: { text: string }) {
  // Claude's replies are rendered as Markdown with raw HTML escaped.
  const html = useMemo(() => (marked.parse(text.replace(/</g, "&lt;"), { async: false }) as string), [text]);
  return <div className="text-sm leading-relaxed [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function ChatPanel({ chat, onError, className = "", text, onText: setText, tips = [], placeholder }: Props) {
  const [images, setImages] = useState<ChatImage[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // A page filled the box in (an "Ask Claude" button): put the cursor at the end so they can finish the sentence.
  useEffect(() => { if (text && document.activeElement !== inputRef.current) { inputRef.current?.focus(); inputRef.current?.setSelectionRange(text.length, text.length); } }, [text]);
  const [sending, setSending] = useState(false);
  const [, setTick] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const messages = chat?.messages ?? [];
  const working = Boolean(chat?.working);

  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 2000); return () => clearInterval(t); }, []);
  useEffect(() => { listRef.current?.lastElementChild?.scrollIntoView({ block: "end" }); }, [messages.length, working, chat?.activity?.tool]);

  const addFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith("image/")).slice(0, 4 - images.length);
    try { setImages([...images, ...(await Promise.all(list.map(readImage)))]); } catch (e) { onError((e as Error).message); }
  };

  const submit = async () => {
    if (!text.trim() && !images.length) return;
    setSending(true);
    try {
      await api.sendChat(text, images);
      setText("");
      setImages([]);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const elapsed = chat?.activity ? Math.round((Date.now() - chat.activity.since) / 1000) : 0;
  const activity = activityLabel(chat);
  const cannotStart = chat?.error && /Could not start Claude Code/.test(chat.error);

  return (
    <section aria-label="Chat with Claude" className={`flex min-h-0 flex-col bg-card ${className}`}>
      <header className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Chat with Claude</h2>
          <p className="text-xs text-muted-foreground">Say what to change. Claude changes it right away; Undo at the top takes it back.</p>
        </div>
        {messages.length > 0 && !working && (
          <Button size="sm" variant="ghost" onClick={() => api.resetChat().catch((e) => onError(e.message))} title="Start a new conversation. Earlier messages stay visible.">New thread</Button>
        )}
      </header>

      <ol ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 && (
          <li className="text-sm text-muted-foreground">
            Tell Claude what you'd like to change, in your own words, for example "make the buttons rounder" or "remove the toast". Paste a screenshot to show a look you like.
          </li>
        )}
        {messages.map((m) => (
          <li key={m.id} className={m.role === "user" ? "ml-8 self-end rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground" : `mr-4 rounded-xl px-3 py-2 ${m.error ? "border border-destructive/40 bg-destructive/5" : "bg-muted"}`}>
            {m.role === "user" ? <p className="whitespace-pre-wrap">{m.text}</p> : <Reply text={m.text} />}
            {m.images && m.images.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {m.images.map((img) => <img key={img} src={inboxUrl(img)} alt="Attached image" className="h-20 rounded-md border object-cover" />)}
              </div>
            )}
            <span className={`mt-1 block text-[11px] ${m.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
              {timeAgo(m.at)}{m.tools && m.tools.length > 0 ? ` · used ${m.tools.join(", ")}` : ""}
            </span>
          </li>
        ))}
        {working && (
          <li className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-2"><span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-primary" />{activity}…{elapsed > 5 ? ` ${elapsed}s` : ""}</span>
            <Button size="sm" variant="ghost" onClick={() => api.stopChat().catch((e) => onError(e.message))}>Stop</Button>
          </li>
        )}
      </ol>


      {cannotStart && (
        <div className="mx-4 mb-3 rounded-lg border border-dashed p-3 text-xs">
          <p className="font-medium">Claude Code is not available.</p>
          <p className="mt-1 text-muted-foreground">The chat runs Claude Code on this computer. Install it from <code>https://claude.com/claude-code</code>, sign in once with <code>claude</code>, then send your message again.</p>
        </div>
      )}

      <form
        className="flex flex-col gap-2 border-t p-3"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
      >
        {images.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {images.map((img, i) => (
              <li key={i} className="relative">
                <img src={`data:${img.type};base64,${img.data}`} alt={img.name} className="h-14 rounded-md border object-cover" />
                <button type="button" aria-label={`Remove ${img.name}`} onClick={() => setImages(images.filter((_, j) => j !== i))} className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full border bg-background text-xs">×</button>
              </li>
            ))}
          </ul>
        )}
        {tips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Try asking:</span>
            {tips.map((t) => (
              <button key={t} type="button" onClick={() => setText(t)} className="min-h-8 rounded-full border bg-muted/50 px-2.5 py-1 text-left text-xs hover:bg-muted">{t}</button>
            ))}
          </div>
        )}
        <label htmlFor="chat-input" className="sr-only">Message to Claude</label>
        <textarea
          ref={inputRef}
          id="chat-input"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          placeholder={working ? "Claude is working; you can type the next message" : placeholder ?? "Tell Claude what to change"}
          className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center justify-between gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          <Button type="button" size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={images.length >= 4}>Add a picture</Button>
          <span className="flex-1 text-right text-[11px] text-muted-foreground">About 30 s and US$0.30 per change</span>
          <Button type="submit" disabled={sending || working || (!text.trim() && !images.length)}>{sending ? "Sending…" : working ? "Working…" : "Send"}</Button>
        </div>
      </form>
    </section>
  );
}
