// Chat between the review UI and Claude: every message runs Claude Code headless (`claude -p`) in the
// workspace, with the Plinth plugin loaded from this install and only the Plinth tools plus read-only file
// tools allowed. Conversations resume by session id, so a thread keeps its context across messages and
// server restarts. Nothing here calls a model API: Claude Code is the only driver, on the user's own plan.
//
// Writes are impossible from the chat by construction: Write/Edit/Bash are disallowed, so every change
// still arrives as a proposal the user applies in the UI.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT = 20000;
const TOOL_PREFIX = /^mcp__plugin_plinth_plinth__|^mcp__plinth__/;

const SYSTEM_PROMPT = `You are working for someone using the Plinth UI, a local web page with these tabs: Tokens, Components, Guidelines, Changes, Checks, History, and a Publish button. They read your answers in that page's chat, not in a terminal, and they may not know design or code.

Rules:
- Use the Plinth tools for everything; you cannot edit files directly. Changes you propose wait in the Changes tab until the user presses Apply. Never call apply_change unless the user explicitly asks you to apply.
- Answer in a few plain sentences. Say what you proposed and where to look ("waiting in Changes", "see Checks"). No code unless asked.
- If a message mentions an attached image path, Read it: it is an image the user attached.
- When a proposal's preview reports contrast failures, distinct-color failures or prose notes, resolve them in the same or a follow-up proposal and tell the user.
- The user can install dependencies, start Storybook, run tests, accept exceptions and publish from the UI; you can also do these with the tools when asked.`;

const TERMINAL_PROMPT = `You are working with someone in a Claude Code terminal on a Plinth design system. The Plinth UI may also be open in their browser, showing the same pending changes (Changes tab), checks and history.

Rules:
- Change tokens, guidelines and components only through the Plinth tools (propose_change). Direct edits to those files are blocked in this folder.
- After proposing, show the user what changes (old → new values, contrast before → after, any look-alike roles or guideline notes) and ask. Call apply_change only when they say to apply (here, or by pressing Apply in the UI).
- Files changed outside Plinth are listed by status as outsideEdits; mention them, and record them only when the user asks.`;

/** Tool restrictions of the UI chat: Plinth's tools and read-only file tools, nothing that writes. */
export const RESTRICTED_TOOLS = [
  "--allowedTools", "mcp__plugin_plinth_plinth", "mcp__plinth", "Read", "Glob", "Grep",
  "--disallowedTools", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", "WebSearch",
];

/** The conversation the UI chat and `plinth --terminal` share. */
export const sessionFile = (root) => join(root, ".ds", "claude-session.json");
export const terminalLock = (root) => join(root, ".ds", "terminal.json");
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
/** A `plinth --terminal` session holding the conversation, or null. */
export function terminalHolder(root) {
  try { const l = JSON.parse(readFileSync(terminalLock(root), "utf8")); return pidAlive(l.pid) ? l : null; } catch { return null; }
}

/**
 * Arguments for an interactive Claude Code session in the terminal. Strict (default) has the UI chat's
 * restrictions; full keeps every tool, with the workspace's .claude/settings.json still blocking direct edits
 * to design files.
 */
export function terminalArgs({ full = false, resume = null } = {}) {
  const args = ["--plugin-dir", PLUGIN_ROOT, ...(full ? [] : RESTRICTED_TOOLS), "--append-system-prompt", TERMINAL_PROMPT];
  if (resume) args.push("--resume", resume);
  if (process.env.PLINTH_MODEL) args.push("--model", process.env.PLINTH_MODEL);
  return args;
}

/** "mcp__plugin_plinth_plinth__propose_change" → "propose change". */
export const friendlyTool = (name) => name.replace(TOOL_PREFIX, "").replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").replace(/_/g, " ");

export function createChat(ctx, { bump = () => {}, bin = process.env.PLINTH_CLAUDE_BIN || "claude" } = {}) {
  const dir = join(ctx.root, ".ds");
  const logPath = join(dir, "chat.jsonl");
  const sessionPath = sessionFile(ctx.root);
  const messages = existsSync(logPath)
    ? readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    : [];
  let session = existsSync(sessionPath) ? JSON.parse(readFileSync(sessionPath, "utf8")) : {};
  let child = null;
  let activity = null; // { since, tool, tools: [] } while Claude works
  let lastError = null;

  const persist = (m) => { mkdirSync(dir, { recursive: true }); appendFileSync(logPath, JSON.stringify(m) + "\n"); };
  const push = (m) => { messages.push(m); persist(m); bump(); return m; };
  const assistant = (text, extra = {}) => push({ id: randomUUID().slice(0, 8), role: "assistant", text: String(text).slice(0, MAX_TEXT), at: new Date().toISOString(), ...extra });
  const saveSession = (id) => { if (!id || id === session.id) return; session = { id, at: new Date().toISOString() }; mkdirSync(dir, { recursive: true }); writeFileSync(sessionPath, JSON.stringify(session) + "\n"); };

  function spawnClaude(prompt, { fresh = false } = {}) {
    const args = [
      "-p", "--output-format", "stream-json", "--verbose",
      "--plugin-dir", PLUGIN_ROOT,
      ...RESTRICTED_TOOLS,
      "--append-system-prompt", SYSTEM_PROMPT,
    ];
    if (session.id && !fresh) args.push("--resume", session.id);
    if (process.env.PLINTH_MODEL) args.push("--model", process.env.PLINTH_MODEL);
    // The nested session gets its own Plinth server for the tools; long-lived processes stay with this one.
    const env = { ...process.env, PLINTH_CHILD: "1", PLINTH_WORKSPACE: ctx.root, PLINTH_PARENT_URL: ctx.ui.url ?? "", PLINTH_PARENT_TOKEN: ctx.ui.token ?? "" };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    // A JavaScript file as the binary (tests, or a wrapper) runs through this node.
    const [cmd, pre] = /\.(mjs|cjs|js)$/i.test(bin) ? [process.execPath, [bin]] : [bin, []];
    const proc = spawn(cmd, [...pre, ...args], { cwd: ctx.root, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    proc.stdin.end(prompt);
    return proc;
  }

  function runTurn(prompt) {
    let fresh = !session.id;
    const attempt = () => new Promise((done) => {
      const proc = spawnClaude(prompt, { fresh });
      child = proc;
      let stderr = "";
      let gotResult = false;
      const texts = [];
      proc.stderr.on("data", (d) => (stderr += d));
      createInterface({ input: proc.stdout }).on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.type === "system" && msg.subtype === "init") saveSession(msg.session_id);
        if (msg.type === "assistant") {
          for (const block of msg.message?.content ?? []) {
            if (block.type === "tool_use") { activity.tool = friendlyTool(block.name); activity.tools.push(activity.tool); bump(); }
            if (block.type === "text" && block.text?.trim()) texts.push(block.text.trim());
          }
        }
        if (msg.type === "result") {
          gotResult = true;
          saveSession(msg.session_id);
          const text = msg.is_error ? `Claude Code reported an error: ${msg.result || msg.error || "unknown"}` : (texts.at(-1) || msg.result || "(no reply)");
          assistant(text, { cost: msg.total_cost_usd, turns: msg.num_turns, tools: [...new Set(activity.tools)] });
          if (msg.is_error) lastError = text;
        }
      });
      proc.on("error", (e) => done({ error: `Could not start Claude Code (${bin}): ${e.message}. Install Claude Code and sign in, then try again.` }));
      proc.on("close", (code) => done({ code, stderr, gotResult }));
    });
    return (async () => {
      let r = await attempt();
      // A session that no longer exists (deleted, other machine): start a fresh one once.
      if (!r.error && !r.gotResult && /No conversation found|session/i.test(r.stderr) && !fresh) { fresh = true; r = await attempt(); }
      if (r.error) { lastError = r.error; assistant(r.error, { error: true }); }
      else if (!r.gotResult) {
        const tail = r.stderr.trim().split("\n").slice(-5).join("\n");
        lastError = r.code === null ? "Stopped." : `Claude Code exited (${r.code}). ${tail}`;
        assistant(lastError, { error: true });
      }
    })();
  }

  return {
    /** A message from the UI. Resolves when Claude's turn is complete. */
    async send({ text, images = [] }) {
      if (child) throw new Error("Claude is still working on the previous message. Wait or press Stop.");
      if (terminalHolder(ctx.root)) throw new Error("This conversation is open in a terminal (plinth --terminal). Continue there, or close it to chat here.");
      // The terminal may have moved the conversation on; pick up its latest session.
      try { session = JSON.parse(readFileSync(sessionPath, "utf8")); } catch { /* none yet */ }
      const body = String(text ?? "").trim().slice(0, MAX_TEXT);
      if (!body && !images.length) throw new Error("Write a message or attach an image.");
      const id = randomUUID().slice(0, 8);
      const saved = [];
      for (const img of images.slice(0, 4)) {
        const ext = IMAGE_TYPES[img.type];
        if (!ext) throw new Error(`Unsupported image type ${img.type}. Use PNG, JPEG, WebP or GIF.`);
        const bytes = Buffer.from(String(img.data ?? ""), "base64");
        if (bytes.length > MAX_IMAGE_BYTES) throw new Error("Images must be 8 MB or smaller.");
        mkdirSync(join(dir, "inbox"), { recursive: true });
        const file = join(dir, "inbox", `${id}-${saved.length + 1}.${ext}`);
        writeFileSync(file, bytes);
        saved.push(file);
      }
      push({ id, role: "user", text: body, images: saved.map((f) => f.split(/[\\/]/).slice(-2).join("/")), at: new Date().toISOString() });
      const prompt = [body || "(see the attached image)", ...saved.map((f, i) => `Attached image ${i + 1}: ${f}`)].join("\n");
      activity = { since: Date.now(), tool: null, tools: [] };
      lastError = null;
      bump();
      const turn = runTurn(prompt).finally(() => { child = null; activity = null; bump(); });
      this.current = turn;
      return { id, done: turn };
    },

    /** Stop the running turn. The session is kept; the next message resumes it. */
    stop() {
      if (!child) return { stopped: false };
      const p = child;
      child = null;
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true });
      else p.kill("SIGTERM");
      return { stopped: true };
    },

    /** Forget the thread: the next message starts a new Claude Code session. Messages stay visible. */
    reset() { session = {}; if (existsSync(sessionPath)) writeFileSync(sessionPath, "{}\n"); bump(); return { reset: true }; },

    state() {
      return {
        messages: messages.slice(-200),
        working: Boolean(child),
        terminal: Boolean(terminalHolder(ctx.root)),
        activity: activity ? { since: activity.since, tool: activity.tool, steps: activity.tools.length } : null,
        session: session.id ?? null,
        error: lastError,
      };
    },
  };
}
