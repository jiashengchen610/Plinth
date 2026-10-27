// Claude in the Plinth UI. Every chat message runs Claude Code headless (`claude -p`) in the workspace, with the
// Plinth plugin loaded from this install and only the Plinth tools plus read-only file tools allowed. Conversations
// resume by session id, so a thread keeps its context across messages and server restarts. The review at publish is
// one more headless run, with read-only tools. Nothing here calls a model API: Claude Code is the only driver, on the
// user's own plan.
//
// The chat changes the design system through the Plinth tools, which write at once; Write/Edit/Bash stay disallowed,
// so every change goes through the engine's validation and can be undone in the UI.
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

const SYSTEM_PROMPT = `You are working for someone using the Plinth UI, a local web page with four steps (Describe, Style, Components, Publish), a History page, Undo and a "Save" button at the top, and this chat on the right. They read your answers in that chat, not in a terminal, and they may not know design or code. Talk about colors, corners, fonts and components in plain words; token names only when they ask.

Rules:
- Use the Plinth tools for everything; you cannot edit files directly. When they ask for a change, make it with the change tool: it is written at once and they see it immediately. Read the guidelines first and keep the change consistent with them. Ask first only before deleting or renaming tokens or components, or restoring a version.
- Do not save versions or publish unless they ask; they press Save version and Publish themselves.
- Answer in a few plain sentences: what you changed, anything the tool reminded you of (contrast, look-alike colors, guideline prose), and that Undo takes it back. No code unless asked.
- When a change's reminders report contrast failures, look-alike roles or guideline notes, fix them in a follow-up change when that matches what they asked, and say so.
- If a message mentions an attached image path, Read it: it is an image the user attached.
- The user can install dependencies, start Storybook, run tests, accept exceptions and publish from the UI; you can also do these with the tools when asked.`;

const REVIEW_PROMPT = `You review a design system before it is published. You cannot change anything.

Call review_changes, then get_guidelines (get_tokens only if you need a value). Judge consistency: do the changes contradict each other, the guidelines (DESIGN.md, WRITING.md), or what a role is for (a destructive color on a default button, a success badge colored like a warning, controls rounder than containers…)? Contrast and look-alike numbers are already computed elsewhere; mention them only when they change what a role means.

Answer in the language the guidelines are written in, in plain sentences for someone who may not know design: at most five findings, each saying what changed and why it matters; or say the changes look consistent. Name things the way the Plinth UI does, not by token or file: "the main color", "text on the main color", "the corners of buttons and fields", "the corners of cards", "badge corners", "the font", "the Button's background", "the style guide". No token paths, CSS names or file names. Finish with one line: "Changes reviewed: N." where N is the number of token values and files that changed.`;

/** Tool restrictions of the UI chat: Plinth's tools and read-only file tools, nothing that writes files. */
export const RESTRICTED_TOOLS = [
  "--allowedTools", "mcp__plugin_plinth_plinth", "mcp__plinth", "Read", "Glob", "Grep",
  "--disallowedTools", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", "WebSearch",
];
// The review reads; it does not get the tools that write.
const READ_TOOLS = ["review_changes", "get_guidelines", "get_tokens", "list_components"];
const WRITE_TOOLS = ["change", "undo", "set_style", "add_component", "add_icons", "remove_component", "add_palette_color", "upgrade_to_layers", "link_to_palette", "fix_contrast", "save_version", "restore_version", "publish", "create_design_system", "install_dependencies"];
const REVIEW_TOOLS = [
  "--allowedTools", ...READ_TOOLS.flatMap((t) => [`mcp__plugin_plinth_plinth__${t}`, `mcp__plinth__${t}`]),
  "--disallowedTools", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", "WebSearch", ...WRITE_TOOLS.flatMap((t) => [`mcp__plugin_plinth_plinth__${t}`, `mcp__plinth__${t}`]),
];

/** The UI chat's conversation. */
export const sessionFile = (root) => join(root, ".ds", "claude-session.json");

/** "mcp__plugin_plinth_plinth__change" → "change". */
export const friendlyTool = (name) => name.replace(TOOL_PREFIX, "").replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").replace(/_/g, " ");

/**
 * Run Claude Code headless in the workspace and stream its JSON lines to `onLine`. The session's Plinth server
 * finds this one through .ds/server.json and forwards its tool calls here (owner.mjs).
 */
function spawnHeadless(root, bin, args, prompt) {
  const env = { ...process.env, PLINTH_WORKSPACE: root };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  // A JavaScript file as the binary (tests, or a wrapper) runs through this node.
  const [cmd, pre] = /\.(mjs|cjs|js)$/i.test(bin) ? [process.execPath, [bin]] : [bin, []];
  const proc = spawn(cmd, [...pre, "-p", "--output-format", "stream-json", "--verbose", "--plugin-dir", PLUGIN_ROOT, ...args], { cwd: root, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  proc.stdin.end(prompt);
  return proc;
}

const killTree = (p) => {
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true });
  else p.kill("SIGTERM");
};

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
    const args = [...RESTRICTED_TOOLS, "--append-system-prompt", SYSTEM_PROMPT];
    if (session.id && !fresh) args.push("--resume", session.id);
    if (process.env.PLINTH_MODEL) args.push("--model", process.env.PLINTH_MODEL);
    return spawnHeadless(ctx.root, bin, args, prompt);
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
      killTree(p);
      return { stopped: true };
    },

    /** Forget the thread: the next message starts a new Claude Code session. Messages stay visible. */
    reset() { session = {}; if (existsSync(sessionPath)) writeFileSync(sessionPath, "{}\n"); bump(); return { reset: true }; },

    state() {
      return {
        messages: messages.slice(-200),
        working: Boolean(child),
        activity: activity ? { since: activity.since, tool: activity.tool, steps: activity.tools.length } : null,
        session: session.id ?? null,
        error: lastError,
      };
    },
  };
}

/**
 * The review at publish: one headless run that reads everything changed since the last publish and the guidelines
 * and reports what does not fit. Suggestions only; it never blocks publishing. A cheap model is enough for this
 * (PLINTH_REVIEW_MODEL, default haiku): on a test cart with three planted problems it found all three.
 */
export function createReview(ctx, { bump = () => {}, bin = process.env.PLINTH_CLAUDE_BIN || "claude", model = process.env.PLINTH_REVIEW_MODEL || "haiku" } = {}) {
  let running = null;
  let last = null;
  return {
    state() { return { running: Boolean(running), since: running?.since ?? null, result: last }; },
    start() {
      if (running) return { started: false, running: true };
      const since = Date.now();
      const proc = spawnHeadless(ctx.root, bin, [...REVIEW_TOOLS, "--model", model, "--append-system-prompt", REVIEW_PROMPT], "Review the changes since the last publish.");
      running = { proc, since };
      bump();
      let stderr = "", text = null, cost = null, isError = false;
      const texts = [];
      proc.stderr.on("data", (d) => (stderr += d));
      createInterface({ input: proc.stdout }).on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.type === "assistant") for (const b of msg.message?.content ?? []) if (b.type === "text" && b.text?.trim()) texts.push(b.text.trim());
        if (msg.type === "result") { isError = Boolean(msg.is_error); text = isError ? (msg.result || msg.error || "unknown error") : (texts.at(-1) || msg.result || ""); cost = msg.total_cost_usd ?? null; }
      });
      const finish = (r) => { last = { ...r, model, at: new Date().toISOString(), seconds: Math.round((Date.now() - since) / 1000) }; running = null; bump(); };
      proc.on("error", (e) => finish({ ok: false, error: `Could not start Claude Code (${bin}): ${e.message}` }));
      proc.on("close", (code) => {
        if (text !== null && !isError) finish({ ok: true, text: text.slice(0, MAX_TEXT), cost });
        else finish({ ok: false, error: text ?? `Claude Code exited (${code}). ${stderr.trim().split("\n").slice(-3).join(" ")}` });
      });
      return { started: true };
    },
    stop() { if (running) { killTree(running.proc); running = null; } },
  };
}
