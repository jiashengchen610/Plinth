// Chat bridge between the review UI and the Claude Code session, built on Claude Code channels
// (research preview). The UI posts a message → the server pushes `notifications/claude/channel` into the
// session → Claude works with the tools and answers through the `reply` tool → the UI shows the answer.
// Permission prompts are relayed the same way: Claude Code sends `notifications/claude/channel/permission_request`,
// the UI shows Allow / Deny, and the server answers with `notifications/claude/channel/permission`.
//
// Sender authentication: only the local UI can post, and every API call carries the per-session token
// (see http.mjs). That is what makes declaring the permission-relay capability acceptable here.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT = 20000;

export function createChat(root, { notify, bump }) {
  const dir = join(root, ".ds");
  const logPath = join(dir, "chat.jsonl");
  const messages = existsSync(logPath)
    ? readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    : [];
  const permissions = new Map(); // request_id → request
  let lastActivity = 0;          // last time Claude did anything (tool call or reply)
  let lastUserMessage = 0;

  const persist = (m) => {
    mkdirSync(dir, { recursive: true });
    appendFileSync(logPath, JSON.stringify(m) + "\n");
  };

  return {
    /** User message from the UI → channel event into the Claude Code session. */
    async send({ text, images = [] }) {
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
      const m = { id, role: "user", text: body, images: saved.map((f) => f.split(/[\\/]/).slice(-2).join("/")), at: new Date().toISOString() };
      messages.push(m);
      persist(m);
      lastUserMessage = Date.now();
      // meta keys must be identifiers (letters, digits, underscore); image paths are absolute so Claude can Read them.
      const meta = { chat_id: id };
      saved.forEach((f, i) => { meta[i === 0 ? "image_path" : `image_path_${i + 1}`] = f; });
      await notify("notifications/claude/channel", { content: body || "(image attached)", meta });
      bump();
      return { id };
    },

    /** Claude's answer, via the reply tool. */
    reply({ text, chat_id }) {
      const m = { id: randomUUID().slice(0, 8), role: "assistant", text: String(text ?? "").slice(0, MAX_TEXT), replyTo: chat_id ?? null, at: new Date().toISOString() };
      messages.push(m);
      persist(m);
      lastActivity = Date.now();
      bump();
      return "sent";
    },

    /** Claude Code opened a permission dialog. */
    onPermissionRequest(params) {
      if (!params?.request_id) return;
      permissions.set(params.request_id, { ...params, at: new Date().toISOString() });
      bump();
    },

    /** The user answered Allow / Deny in the UI. */
    async decide(requestId, behavior) {
      if (!permissions.has(requestId)) throw new Error("That request is no longer open.");
      if (behavior !== "allow" && behavior !== "deny") throw new Error("behavior must be allow or deny");
      permissions.delete(requestId);
      await notify("notifications/claude/channel/permission", { request_id: requestId, behavior });
      bump();
      return { request_id: requestId, behavior };
    },

    /** Any tool call means the session is alive and working. */
    activity() { lastActivity = Date.now(); },

    state() {
      return {
        messages: messages.slice(-200),
        permissions: [...permissions.values()],
        // Working: Claude has done something since the user's last message, and has not replied yet.
        working: lastUserMessage > 0 && lastActivity > lastUserMessage && messages.at(-1)?.role === "user",
        waitingSince: messages.at(-1)?.role === "user" ? lastUserMessage : null,
        lastActivity: lastActivity || null,
      };
    },
  };
}
