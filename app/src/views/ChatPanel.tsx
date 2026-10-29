import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, inboxUrl, type ChangeResult, type ChatImage, type ChatState, type VocabEntry } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { matchVocab, VocabChip, VocabList, vocabFontsHref } from "@/views/Vocab";

type Props = {
  chat: ChatState | null; onError: (message: string) => void; className?: string;
  /** The message box is controlled by the page, so "Ask Claude" buttons elsewhere can fill it in. */
  text: string; onText: (text: string) => void;
  tips?: string[]; placeholder?: string;
  /** The shared vocabulary for the "/" menu: picked names go with the message as exact ids. */
  vocab?: VocabEntry[]; brand?: string;
  /** A pick applied without Claude (one entry, no text) reports its change here. */
  onChanged?: (r: Partial<ChangeResult> & { unchanged?: boolean }, fallback: string) => void;
};

/** The "/word" being typed before the caret (at the start or after a space), or null. */
function slashToken(text: string, caret: number) {
  const m = /(^|\s)\/([^\s/]*)$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null;
}

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

export function ChatPanel({ chat, onError, className = "", text, onText: setText, tips = [], placeholder, vocab = [], brand = "", onChanged }: Props) {
  const [images, setImages] = useState<ChatImage[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Names picked from the "/" menu. The menu follows the caret: it opens on "/" and lists what matches the word after
  // it; Enter or Tab takes the highlighted entry, Esc hides it until the text changes.
  const [mentions, setMentions] = useState<VocabEntry[]>([]);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const token = hiddenFor === text ? null : slashToken(text, caret);
  // The list renders a step behind the typing, so keystrokes are never held up by it.
  const query = useDeferredValue(token?.query ?? null);
  const matches = useMemo(() => (query === null ? [] : matchVocab(vocab.filter((e) => !mentions.some((m) => m.id === e.id)), query).slice(0, query ? 8 : 60)), [query, vocab, mentions]);
  useEffect(() => { setActive(0); }, [query]);
  const fontsHref = useMemo(() => (token ? vocabFontsHref(matches) : null), [token, matches]);
  // The caret as the browser reports it after React has restored it (right after a keystroke it reads 0 for a moment).
  const syncCaret = () => requestAnimationFrame(() => { if (inputRef.current) setCaret(inputRef.current.selectionStart ?? 0); });
  useEffect(() => {
    const on = () => { if (document.activeElement === inputRef.current) syncCaret(); };
    document.addEventListener("selectionchange", on);
    return () => document.removeEventListener("selectionchange", on);
  }, []);
  const pick = (e: VocabEntry) => {
    if (!token) return;
    // The "/word" goes; the chip takes its place above the box. No double space is left behind.
    const before = text.slice(0, token.start);
    const after = text.slice(caret).replace(/^ /, before.endsWith(" ") || !before ? "" : " ").replace(/^ (?=\S)/, before ? " " : "");
    setText(before + after);
    setMentions([...mentions, e]);
    setHiddenFor(null);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(token.start, token.start); setCaret(token.start); });
  };
  const openMenu = () => {
    const el = inputRef.current;
    const at = el?.selectionStart ?? text.length;
    const before = text.slice(0, at);
    const insert = (before && !/\s$/.test(before) ? " " : "") + "/";
    setText(before + insert + text.slice(at));
    setHiddenFor(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + insert.length, at + insert.length); setCaret(at + insert.length); });
  };
  // One pick and nothing else: Plinth can apply it itself, free and undoable, instead of asking Claude.
  const direct = !text.trim() && !images.length && mentions.length === 1 && mentions[0].apply ? mentions[0] : null;
  const applyDirect = async () => {
    if (!direct || !onChanged) return;
    setSending(true);
    try { onChanged(await api.applyVocab(brand, direct.id), `Applied ${direct.name}.`); setMentions([]); } catch (e) { onError((e as Error).message); } finally { setSending(false); }
  };
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
    if (!text.trim() && !images.length && !mentions.length) return;
    setSending(true);
    try {
      await api.sendChat(text, images, mentions.map((m) => m.id));
      setText("");
      setImages([]);
      setMentions([]);
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
            Tell Claude what you'd like to change, in your own words, for example "make the buttons rounder" or "remove the toast". Paste a screenshot to show a look you like. Type <kbd className="rounded border bg-background px-1 font-mono text-[11px] text-foreground">/</kbd> to pick a component or a style by name.
          </li>
        )}
        {messages.map((m) => (
          <li key={m.id} className={m.role === "user" ? "ml-8 self-end rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground" : `mr-4 rounded-xl px-3 py-2 ${m.error ? "border border-destructive/40 bg-destructive/5" : "bg-muted"}`}>
            {m.role === "user" ? <p className="whitespace-pre-wrap">{m.text}</p> : <Reply text={m.text} />}
            {m.mentions && m.mentions.length > 0 && (
              <div className={`flex flex-wrap gap-1 text-foreground ${m.text ? "mt-1.5" : ""}`}>
                {m.mentions.map((v) => <VocabChip key={v.id} entry={vocab.find((e) => e.id === v.id) ?? v} />)}
              </div>
            )}
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
        {mentions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {mentions.map((m) => <VocabChip key={m.id} entry={m} onRemove={() => setMentions(mentions.filter((x) => x.id !== m.id))} />)}
          </div>
        )}
        <label htmlFor="chat-input" className="sr-only">Message to Claude</label>
        <div className="relative">
          {token && (
            <div className="absolute inset-x-0 bottom-full z-20 mb-1 rounded-lg border bg-popover text-popover-foreground shadow-md">
              {fontsHref && <link rel="stylesheet" href={fontsHref} precedence="default" />}
              <div className="flex items-center justify-between border-b px-2.5 py-1.5 text-[11px] text-muted-foreground"><span>{query ? `Matching “${query}”` : "Components and styles"}</span><span>↑↓ then Enter · Esc closes</span></div>
              <VocabList id="chat-vocab" matches={matches} active={active} onActive={setActive} onPick={pick} grouped={!query} />
            </div>
          )}
          <textarea
            ref={inputRef}
            id="chat-input"
            rows={3}
            value={text}
            role={token ? "combobox" : undefined}
            aria-expanded={token ? true : undefined}
            aria-controls={token ? "chat-vocab" : undefined}
            aria-activedescendant={token && matches[active] ? `chat-vocab-${active}` : undefined}
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); }}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (token) {
                if (e.key === "ArrowDown" && matches.length) { e.preventDefault(); setActive((active + 1) % matches.length); return; }
                if (e.key === "ArrowUp" && matches.length) { e.preventDefault(); setActive((active + matches.length - 1) % matches.length); return; }
                if ((e.key === "Enter" || e.key === "Tab") && matches[active]) { e.preventDefault(); pick(matches[active]); return; }
                if (e.key === "Escape") { e.preventDefault(); setHiddenFor(text); return; }
              }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (direct && onChanged) applyDirect(); else submit(); }
            }}
            placeholder={working ? "Claude is working; you can type the next message" : placeholder ?? "Tell Claude what to change"}
            className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          <div className="flex items-center gap-1">
            {vocab.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={openMenu} title="Pick a component, a look, colors, a font or corners by name (or type / in the message)"><Plus /> Component or style</Button>}
            <Button type="button" size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={images.length >= 4}>Add a picture</Button>
          </div>
          <span className="flex-1 text-right text-[11px] text-muted-foreground">{direct ? "Applying it yourself is free" : "About 30 s and US$0.30 per change"}</span>
          {direct && onChanged && <Button type="button" disabled={sending || working} onClick={applyDirect}>{sending ? "Applying…" : direct.kind === "component" ? "Add it now" : "Apply now"}</Button>}
          <Button type="submit" variant={direct && onChanged ? "outline" : "default"} disabled={sending || working || (!text.trim() && !images.length && !mentions.length)}>{sending && !direct ? "Sending…" : working ? "Working…" : direct && onChanged ? "Ask Claude" : "Send"}</Button>
        </div>
      </form>
    </section>
  );
}
