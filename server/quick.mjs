// One short headless Claude run without tools: a prompt in, text out. For the drafts the user confirms (answers
// suggested in Describe, the description of a version), so a cheap model is enough; the caller keeps a draft of its
// own for when Claude is not available.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { changesSinceSave, versionDraft } from "../engine/workspace.mjs";

/** Resolves to { text, cost, seconds, model, error }; never rejects. */
export function quickClaude(cwd, prompt, { bin = process.env.PLINTH_CLAUDE_BIN || "claude", model = "haiku", timeout = 90_000 } = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const [cmd, pre] = /\.(mjs|cjs|js)$/i.test(bin) ? [process.execPath, [bin]] : [bin, []];
    let proc;
    try {
      proc = spawn(cmd, [...pre, "-p", "--output-format", "stream-json", "--verbose", "--model", model,
        "--disallowedTools", "Read", "Glob", "Grep", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", "WebSearch", "Task"],
        { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) { resolve({ text: null, cost: null, seconds: 0, model, error: e.message }); return; }
    let text = null, cost = null, failed = null, settled = false;
    const timer = setTimeout(() => { failed = "timed out"; proc.kill(); }, timeout);
    proc.stdin.end(prompt);
    createInterface({ input: proc.stdout }).on("line", (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.type === "result") { cost = msg.total_cost_usd ?? null; if (msg.is_error) failed = msg.result || "error"; else text = msg.result ?? ""; }
    });
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ text, cost, seconds: Math.round((Date.now() - started) / 100) / 10, model, error: text === null ? failed ?? "Claude did not answer" : null });
    };
    proc.on("error", (e) => { failed = e.message; done(); });
    proc.on("close", done);
  });
}

const VERSION_PROMPT = ({ titles, files }) => `Describe a saved version of a design system in one line, for its history. Do not use any tools. Reply with the line only, no quotes.

Rules: at most 70 characters; plain words a designer understands (no file names, token names or code); the most important change first; sentence case, no period at the end.

Changes since the last version, oldest first:
${titles.length ? titles.map((t) => `- ${t}`).join("\n") : "- (made outside Plinth)"}
${files.length ? `Files that changed: ${files.slice(0, 30).join(", ")}` : ""}`;

/**
 * The description of the next version, written by Claude for the user to confirm or change. Falls back to the
 * engine's draft (the change titles). { text, by: "claude" | "plinth", seconds, cost } or { text: null } when
 * nothing changed.
 */
export async function draftVersionMessage(root, { model = process.env.PLINTH_DRAFT_MODEL || "haiku", ...opts } = {}) {
  const changes = changesSinceSave(root);
  const plinth = versionDraft(changes);
  if (!plinth) return { text: null, by: "none" };
  const r = await quickClaude(root, VERSION_PROMPT(changes), { model, ...opts });
  const line = r.text?.split("\n").map((s) => s.trim().replace(/^["'`]+|["'`.]+$/g, "")).find(Boolean);
  return line ? { text: line.slice(0, 100), by: "claude", seconds: r.seconds, cost: r.cost } : { text: plinth, by: "plinth", error: r.error };
}
