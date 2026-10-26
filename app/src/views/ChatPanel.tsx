import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { Button } from "@/components/ui/button";
import { api, inboxUrl, type ChatImage, type ChatState } from "@/lib/api";
import { timeAgo } from "@/lib/format";

type Props = { chat: ChatState | null; onError: (message: string) => void; className?: string };

const START_COMMAND = "claude --dangerously-load-development-channels plugin:plinth@plinth";
const QUIET_MS = 25000;

function readImage(file: File): Promise<ChatImage> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ type: file.type, name: file.name || "pasted image", data: String(r.result).split(",")[1] ?? "" });
    r.onerror = () => reject(new Error(`Could not read ${file.name}`));
    r.readAsDataURL(file);
  });
}

/** "mcp__plugin_plinth_plinth__install_dependencies" → "install dependencies"; "Bash" → "run a command". */
function friendlyTool(name: string): string {
  const builtIn: Record<string, string> = { Bash: "run a command", Write: "write a file", Edit: "edit a file", Read: "read a file", WebFetch: "open a web page" };
  if (builtIn[name]) return builtIn[name];
  return name.replace(/^mcp__(?:plugin_)?plinth(?:_plinth)?__/, "").replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").replace(/_/g, " ");
}

function Reply({ text }: { text: string }) {
  // Claude's replies are rendered as Markdown with raw HTML escaped.
  const html = useMemo(() => (marked.parse(text.replace(/</g, "&lt;"), { async: false }) as string), [text]);
  return <div className="text-sm leading-relaxed [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function ChatPanel({ chat, onError, className = "" }: Props) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<ChatImage[]>([]);
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const messages = chat?.messages ?? [];
  const permissions = chat?.permissions ?? [];

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 2000); return () => clearInterval(t); }, []);
  useEffect(() => { listRef.current?.lastElementChild?.scrollIntoView({ block: "end" }); }, [messages.length, permissions.length]);

  // No sign of Claude a while after a message: the session is probably not running with the channel enabled.
  const quiet = Boolean(chat?.waitingSince && !chat.working && now - chat.waitingSince > QUIET_MS);

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

  const copyCommand = async () => {
    try { await navigator.clipboard.writeText(START_COMMAND); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* selectable text remains */ }
  };

  return (
    <section aria-label="Chat with Claude" className={`flex min-h-0 flex-col rounded-xl border bg-card ${className}`}>
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">Chat</h2>
        <p className="text-xs text-muted-foreground">Describe what you want. Claude proposes changes; you review them in Changes.</p>
      </header>

      <ol ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 && (
          <li className="text-sm text-muted-foreground">
            Try: "Create a design system for a budgeting app for young professionals. Warm and trustworthy, dark mode matters." Paste a screenshot to show the look you want.
          </li>
        )}
        {messages.map((m) => (
          <li key={m.id} className={m.role === "user" ? "ml-8 self-end rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground" : "mr-4 rounded-xl bg-muted px-3 py-2"}>
            {m.role === "user" ? <p className="whitespace-pre-wrap">{m.text}</p> : <Reply text={m.text} />}
            {m.images && m.images.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {m.images.map((img) => <img key={img} src={inboxUrl(img)} alt="Attached image" className="h-20 rounded-md border object-cover" />)}
              </div>
            )}
            <span className={`mt-1 block text-[11px] ${m.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{timeAgo(m.at)}</span>
          </li>
        ))}
        {permissions.map((p) => (
          <li key={p.request_id} className="rounded-xl border border-ring p-3 text-sm">
            <p className="font-medium">Claude wants to {friendlyTool(p.tool_name)}</p>
            <p className="mt-1 text-muted-foreground">{p.description}</p>
            {p.input_preview && <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{p.input_preview}</pre>}
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => api.decide(p.request_id, "allow").catch((e) => onError(e.message))}>Allow</Button>
              <Button size="sm" variant="outline" onClick={() => api.decide(p.request_id, "deny").catch((e) => onError(e.message))}>Deny</Button>
            </div>
          </li>
        ))}
        {chat?.working && <li className="text-xs text-muted-foreground">Claude is working…</li>}
      </ol>

      {quiet && (
        <div className="mx-4 mb-3 rounded-lg border border-dashed p-3 text-xs">
          <p className="font-medium">No response from Claude yet.</p>
          <p className="mt-1 text-muted-foreground">Messages reach Claude only when Claude Code runs with the Plinth channel. Start it in this folder with:</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 select-all break-all rounded bg-muted px-2 py-1">{START_COMMAND}</code>
            <Button size="sm" variant="outline" onClick={copyCommand}>{copied ? "Copied" : "Copy"}</Button>
          </div>
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
        <label htmlFor="chat-input" className="sr-only">Message</label>
        <textarea
          id="chat-input"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          placeholder="Ask for a change, or paste a screenshot"
          className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center justify-between gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          <Button type="button" size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={images.length >= 4}>Attach image</Button>
          <Button type="submit" size="sm" disabled={sending || (!text.trim() && !images.length)}>{sending ? "Sending…" : "Send"}</Button>
        </div>
      </form>
    </section>
  );
}
