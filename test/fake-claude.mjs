// Stand-in for the `claude` binary in tests: reads the prompt from stdin, emits a stream-json transcript
// like `claude -p --output-format stream-json --verbose`, and records its arguments so the test can check
// how Plinth invoked it. Behaviour is driven by the prompt text:
//   "crash"        exit 3 after init, no result
//   "vanish-next"  report session id "gone-session"; resuming it later fails like a deleted session
//   "image"        reply with the attached image path
import { readFileSync, writeFileSync } from "node:fs";

const prompt = readFileSync(0, "utf8");
const args = process.argv.slice(2);
if (process.env.FAKE_CLAUDE_LOG) writeFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, prompt, cwd: process.cwd(), env: { PLINTH_WORKSPACE: process.env.PLINTH_WORKSPACE, CLAUDECODE: process.env.CLAUDECODE ?? null } }));

const resumed = args.indexOf("--resume") >= 0 ? args[args.indexOf("--resume") + 1] : null;
if (resumed === "gone-session") { process.stderr.write("No conversation found with session ID: gone-session\n"); process.exit(1); }
const session = /vanish-next/.test(prompt) ? "gone-session" : resumed ?? "sess-0001";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

out({ type: "system", subtype: "init", session_id: session, cwd: process.cwd() });
if (/crash/.test(prompt)) { process.stderr.write("boom\n"); process.exit(3); }
// The Describe step's suggestion run: one JSON answer, no tools.
if (/^Suggest starting answers/.test(prompt)) {
  const json = JSON.stringify({ name: "Pocket", kind: "mobile-app", feels: ["Warm and trustworthy", "Calm", "Playful", "Focused"], palette: "blue-slate", corners: "pill", font: "Nunito", components: ["switch", "not-a-component"], question: null });
  out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: json }] } });
  out({ type: "result", subtype: "success", is_error: false, result: json, session_id: session, total_cost_usd: 0.002, num_turns: 1 });
  process.exit(0);
}
out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Let me look." }, { type: "tool_use", id: "t1", name: "mcp__plugin_plinth_plinth__status", input: {} }] } });
out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }] } });
const reply = /image/i.test(prompt) ? `I read ${(prompt.match(/Attached image 1: (.+)/) ?? [])[1] ?? "no image"}.` : `Echo: ${prompt.split("\n")[0]}`;
out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: reply }] } });
out({ type: "result", subtype: "success", is_error: false, result: reply, session_id: session, total_cost_usd: 0.01, num_turns: 2 });
