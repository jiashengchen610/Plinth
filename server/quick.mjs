// One short headless Claude run without tools: a prompt in, text out. For the drafts the user confirms (answers
// suggested in Describe, the description of a version), so a cheap model is enough; the caller keeps a draft of its
// own for when Claude is not available.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { changesSinceSave, versionDraft } from "../engine/workspace.mjs";
import { resolveBrand } from "../engine/tokens.mjs";
import { radiusSteps } from "../engine/style.mjs";

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

const QUICK_PROMPT = ({ title, mode, items, text, families, radius, styles }) => `You turn a request about one picked element of a design system into token changes. Do not use any tools. Reply with JSON only: no prose around it, no code fence.

The element: ${title} (${mode === "dark" ? "dark" : "light"} mode).
What it uses (path: what · now):
${items.map((i) => `- ${i.path}: ${i.what} · ${i.now}`).join("\n")}

Request: ${JSON.stringify(text)}

Allowed values for "to":
- Colors: a palette step "<family>.<step>" (families: ${families.join(", ")}; steps 50 100 200 300 400 500 600 700 800 900 950), "white", "black", or "#rrggbb" for a color the palette does not have.
- Corners: a radius step: ${radius.map((r) => `${r.step} (${r.px >= 9999 ? "round" : `${r.px}px`})`).join(", ")}.
- Text style: one of ${styles.join(", ")}.

Answer: {"changes":[{"path":"<a path from the list>","to":"<an allowed value>"}],"reply":"<one short sentence for the user in plain words, without token names or paths, describing what the suggested change does; nothing is changed until the user confirms, so never say it is done>","chat":false}
Rules: change only what the request asks for; colors go with the kind of path (a color path gets a color); keep text readable on its background. "changes" may be empty. If the request needs more than these values (layout, size or spacing, animation, a new variant, other elements), set "chat" to true and say in "reply" that Claude in the chat can do it.`;

/**
 * A short request about a picked element ("a bit darker") turned into values by Claude (one run, no tools), checked
 * here: only the picked paths, only values the palette, the radius scale and the text styles have. The UI shows the
 * proposal and asks how far it should reach before anything is written.
 * picks: [{ path, prop, kind: "color" | "radius" | "text", state }].
 * @returns {Promise<{ changes: { path: string, kind: string, to: string }[], reply: string, chat: boolean, seconds, cost, error }>}
 */
export async function quickEdit(root, { brand, mode = "default", title = "an element", picks = [], text = "" }, { model = process.env.PLINTH_QUICK_MODEL || "haiku", ...opts } = {}) {
  if (!String(text).trim()) throw new Error("say what to change");
  const r = resolveBrand(root, brand);
  const byKey = new Map(r.tokens.map((t) => [t.key, t]));
  const at = (t) => t.values[mode] ?? t.values.default;
  const refKey = (raw) => (typeof raw === "string" && /^\{[^}]+\}$/.test(raw.trim()) ? raw.trim().slice(1, -1).replace(/\./g, "/") : null);
  const chain = (t) => { const out = [t.key]; for (let cur = t, i = 0; i < 8; i++) { const k = refKey(at(cur)?.raw); cur = k ? byKey.get(k) : null; if (!cur) break; out.push(cur.key); } return out; };
  const kinds = new Map();
  const items = picks.filter((p) => byKey.has(p.path) && ["color", "radius", "text"].includes(p.kind)).slice(0, 12).map((p) => {
    const t = byKey.get(p.path);
    kinds.set(p.path, p.kind);
    return { path: p.path, what: `${p.prop}${p.state ? ` (${p.state})` : ""}`, now: `${chain(t).join(" → ")}${at(t)?.resolved && p.kind === "color" ? ` (${at(t).resolved})` : ""}` };
  });
  if (!items.length) throw new Error("nothing picked to change");
  const primitives = existsSync(join(root, "tokens/primitives.tokens.json")) ? JSON.parse(readFileSync(join(root, "tokens/primitives.tokens.json"), "utf8")).color ?? {} : {};
  const families = Object.entries(primitives).filter(([k, v]) => !k.startsWith("$") && v && typeof v === "object" && !("$value" in v)).map(([k]) => k);
  const radius = radiusSteps(root);
  const styles = r.tokens.filter((t) => t.type === "typography" && !t.derived && t.key.startsWith("typography/")).map((t) => {
    const size = byKey.get(`${t.key}/font-size`);
    return `${t.key.slice("typography/".length).replace(/\//g, ".")}${size ? ` (${at(size)?.resolved ?? at(size)?.css})` : ""}`;
  });
  const q = await quickClaude(root, QUICK_PROMPT({ title, mode, items, text, families, radius, styles }), { model, ...opts });
  let parsed = null;
  try { const s = q.text ?? ""; parsed = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)); } catch { /* answered with something else */ }
  if (!parsed) return { changes: [], reply: "", chat: false, seconds: q.seconds, cost: q.cost, error: q.error ?? "Claude's answer could not be read" };
  const steps = new Set(radius.map((x) => x.step));
  const styleKeys = new Set(styles.map((s) => s.split(" ")[0]));
  const valid = (kind, to) => {
    if (kind === "color") {
      const m = /^([a-z0-9-]+)\.(\d{2,3})$/.exec(to);
      return /^#[0-9a-f]{6}$/i.test(to) || /^(white|black)$/.test(to) || Boolean(m && primitives[m[1]]?.[m[2]]);
    }
    if (kind === "radius") return steps.has(to);
    return styleKeys.has(to);
  };
  const changes = (Array.isArray(parsed.changes) ? parsed.changes : [])
    .map((c) => ({ path: String(c?.path ?? ""), to: String(c?.to ?? "").trim().toLowerCase() }))
    .filter((c) => kinds.has(c.path) && valid(kinds.get(c.path), c.to))
    .map((c) => ({ ...c, kind: kinds.get(c.path) }));
  return { changes, reply: String(parsed.reply ?? "").slice(0, 300), chat: parsed.chat === true, seconds: q.seconds, cost: q.cost, error: null };
}
