// The Describe step and the new UI's edits, end to end with a stand-in for the claude binary: presets, Claude's
// suggestions after the first answer, creating from the answers (engine part at once, Claude's part in the chat,
// first version saved), a style pick, removing a component and undoing it, and answering again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { fontPickFor, readStyle, roleColorOps, styleOps } from "../engine/style.mjs";
import { resolveBrand } from "../engine/tokens.mjs";
import { fontsToLoad } from "../engine/fonts.mjs";

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
import * as wsx from "../engine/workspace.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = join(here, "..", "server", "index.mjs");
const FAKE = join(here, "fake-claude.mjs");

test("style: a pick re-points roles at readable palette steps; component removal is one undoable change", () => {
  const root = mkdtempSync(join(tmpdir(), "plinth-style-"));
  try {
    wsx.initWorkspace(root, { name: "Probe", brand: "probe", context: "mobile-app" });
    assert.deepEqual(readStyle(root, "probe"), { ...readStyle(root, "probe"), main: "neutral", gray: "neutral", corners: "round", font: "Geist" });
    wsx.change(root, { title: "teal", ops: styleOps(root, "probe", { main: "teal", gray: "stone", corners: "pill", font: "Source Serif 4" }), by: "test" });
    const st = readStyle(root, "probe");
    assert.equal(st.main, "teal"); assert.equal(st.gray, "stone"); assert.equal(st.corners, "pill"); assert.equal(st.font, "Source Serif 4");
    const roles = JSON.parse(readFileSync(join(root, "brands/probe/tokens.json"), "utf8")).color;
    assert.equal(roles.primary.$value, "{color.teal.700}", "teal-600 is too light for white text, so 700");
    assert.equal(roles["primary-foreground"].$value, "{color.white}");
    assert.equal(roles.border.$value, "{color.stone.200}", "grays move to the same step of the new family");
    // Fonts are layered: the pick joins the palette, the text role points at it, text styles keep pointing at roles.
    let base = JSON.parse(readFileSync(join(root, "tokens/base.tokens.json"), "utf8"));
    assert.equal(base.font.body.$value, "{font.source-serif-4}");
    assert.equal(base.font.code.$value, "{font.jetbrains-mono}", "code follows the text font");
    assert.deepEqual(JSON.parse(readFileSync(join(root, "tokens/primitives.tokens.json"), "utf8")).font["source-serif-4"].$value, ["Source Serif 4", "serif"]);
    assert.equal(base.typography.body.md.$value.fontFamily, "{font.body}");
    assert.equal(base.radius.control.$value, "{radius.full}");
    // Headings in their own font, buttons and labels following them; then headings back to the text font.
    wsx.change(root, { title: "fonts", ops: styleOps(root, "probe", { font: "Inter", headingFont: "Playfair Display", labelFont: "heading" }), by: "test" });
    assert.deepEqual(pick(readStyle(root, "probe"), ["font", "headingFont", "labelFont", "codeFont"]), { font: "Inter", headingFont: "Playfair Display", labelFont: "heading", codeFont: "JetBrains Mono" });
    const button = resolveBrand(root, "probe").tokens.find((t) => t.key === "button/label/font");
    assert.equal(button.values.default.resolved, "500 0.875rem/1.25 'Playfair Display', serif", "a component's text follows style → role → font");
    assert.deepEqual(styleOps(root, "probe", { font: "Inter", headingFont: "Playfair Display", labelFont: "heading" }), [], "nothing to change");
    wsx.change(root, { title: "same", ops: styleOps(root, "probe", { headingFont: "" }), by: "test" });
    base = JSON.parse(readFileSync(join(root, "tokens/base.tokens.json"), "utf8"));
    assert.equal(base.font.heading.$value, "{font.body}");
    assert.deepEqual(fontPickFor("Playfair Display"), { headingFont: "Playfair Display" }, "Describe's serif pick becomes the headings font");
    assert.deepEqual(fontPickFor("Nunito"), { font: "Nunito" });
    const css = readFileSync(join(root, "src/styles/tokens.css"), "utf8");
    assert.match(css, /@utility type-button-label \{\n  font: var\(--button-label-font\);\n  letter-spacing: var\(--label-md-letter-spacing\);\n\}/);
    assert.match(css, /--font-heading: var\(--heading-font\);/);
    assert.deepEqual(fontsToLoad(root).map((f) => f.family), ["Inter", "JetBrains Mono"], "fonts load only when a role uses them");
    assert.throws(() => styleOps(root, "probe", { main: "not-a-color" }), /no palette color/);

    // A base color clicked in Components: the mode shown takes it, the other moves to the same family at its own step.
    assert.deepEqual(roleColorOps(root, "probe", { role: "destructive", color: "rose.600" }), [
      { op: "set", file: "brands/probe/tokens.json", path: "color/destructive", value: "{color.rose.600}" },
      { op: "set", file: "brands/probe/tokens.json", path: "color/destructive", mode: "dark", value: "{color.rose.400}" },
    ]);
    assert.deepEqual(roleColorOps(root, "probe", { role: "background", color: "{color.stone.900}", mode: "dark" }).map((o) => o.value), ["{color.stone.900}"], "white in light mode stays white");
    assert.deepEqual(roleColorOps(root, "probe", { role: "primary-foreground", color: "white" }), [], "already white");
    assert.throws(() => roleColorOps(root, "probe", { role: "primary", color: "nope.600" }), /no palette color/);
    assert.throws(() => roleColorOps(root, "probe", { role: "nope", color: "red.600" }), /no color role/);

    // A component nothing imports can go; the template's ones are used by the Foundations pages.
    assert.throws(() => wsx.removeComponentOps(root, "button"), /used by .*foundations/);
    mkdirSync(join(root, "src/components/chip"), { recursive: true });
    writeFileSync(join(root, "src/components/chip/chip.tsx"), "export const Chip = () => null;\n");
    writeFileSync(join(root, "tokens/components/chip.tokens.json"), JSON.stringify({ chip: { $type: "color", background: { $value: "{color.primary}" } } }));
    const r = wsx.change(root, { title: "Remove chip", ops: wsx.removeComponentOps(root, "chip"), by: "test" });
    assert.deepEqual(r.files.sort(), ["src/components/chip/chip.tsx", "tokens/components/chip.tokens.json"]);
    assert.ok(!existsSync(join(root, "src/components/chip/chip.tsx")) && !existsSync(join(root, "tokens/components/chip.tokens.json")));
    wsx.undo(root);
    assert.ok(existsSync(join(root, "src/components/chip/chip.tsx")) && existsSync(join(root, "tokens/components/chip.tokens.json")), "undo brings the files back");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("describe: suggestions, create from answers, style pick, remove, answer again", async (t) => {
  const ws = mkdtempSync(join(tmpdir(), "plinth-describe-"));
  const env = { ...process.env, PLINTH_WORKSPACE: ws, PLINTH_TOKEN: "tok", PLINTH_PORT: "4397", PLINTH_CLAUDE_BIN: FAKE, PLINTH_NO_INSTALL: "1", CLAUDECODE: "1" };
  const child = spawn(process.execPath, [SERVER], { env, stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise((res) => child.once("exit", res));
  t.after(async () => { child.stdin.end(); await exited; rmSync(ws, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const responses = new Map();
  let nextId = 1;
  createInterface({ input: child.stdout }).on("line", (line) => { const m = JSON.parse(line); if (m.id !== undefined) responses.get(m.id)?.(m); });
  const request = (method, params) => new Promise((resolve) => { const id = nextId++; responses.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  const ui = JSON.parse((await request("tools/call", { name: "open_ui", arguments: {} })).result.content[0].text).url;
  const api = async (path, body) => {
    const r = await fetch(new URL(path, ui), { method: body ? "POST" : "GET", headers: { "X-Plinth-Token": "tok", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() };
  };
  const settled = async () => {
    for (let i = 0; i < 400; i++) {
      const s = (await api("api/state")).json;
      if (s.setup && !s.setup.running) return s;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error("setup did not finish");
  };

  const presets = (await api("api/presets")).json;
  assert.equal(presets.palettes.length, 6);
  assert.ok(presets.palettes.every((p) => p.swatches.every(Boolean)), "every preset palette resolves in the template");
  assert.deepEqual(presets.corners.map((c) => c.id), ["square", "slight", "round", "pill"]);
  assert.deepEqual(presets.components.filter((c) => c.core).map((c) => c.id), ["button", "input", "label", "card", "badge"]);
  assert.ok(presets.components.every((c) => c.ready), "every catalog component is ready-made");

  const sugg = (await api("api/suggest", { product: "A budgeting app for young professionals" })).json;
  assert.equal(sugg.by, "claude");
  assert.equal(sugg.palette, "blue-slate");
  assert.deepEqual(sugg.components, ["switch"], "ids outside the catalog are dropped");
  assert.deepEqual(Object.keys(sugg.why).sort(), ["corners", "palette"], "reasons come with picks; a reason that is not text is dropped");
  assert.equal((await api("api/suggest", { product: " " })).status, 400);

  // Create: scaffold and style at once, the guidelines through the chat, then the first version is saved.
  assert.equal((await api("api/setup", { product: "  " })).status, 400, "an empty answer is refused at once");
  // A second click on Create while it starts is not an error: it just joins the run.
  const answers = { product: "A budgeting app for young professionals", name: "Pocket", feel: "Warm and trustworthy", kind: "mobile-app", palette: "blue-slate", corners: "pill", font: "Nunito", components: ["switch"], extraText: "" };
  const clicks = await Promise.all([api("api/setup", answers), api("api/setup", answers)]);
  assert.deepEqual(clicks.map((c) => [c.status, c.json.started]), [[200, true], [200, true]]);
  assert.deepEqual(clicks.map((c) => c.json.already).sort(), [false, true]);
  let s = await settled();
  assert.equal(s.exists, true);
  assert.equal(s.setup.error, null);
  assert.deepEqual(s.setup.steps.map((x) => [x.id, x.status]), [["scaffold", "done"], ["style", "done"], ["claude", "done"], ["deps", "waiting"]]);
  assert.equal(s.config.name, "Pocket");
  assert.equal(s.config.brief.feel, "Warm and trustworthy");
  assert.deepEqual(s.style.pocket, { ...s.style.pocket, main: "blue", gray: "slate", corners: "pill", font: "Nunito" });
  const ask = s.chat.messages.find((m) => m.role === "user");
  assert.match(ask.text, /^Set up my new design system from my answers:/);
  assert.doesNotMatch(ask.text, /Switch/, "ready-made components are copied, not written by Claude");
  const ids = s.components.map((c) => c.id);
  assert.ok(ids.includes("switch") && ids.includes("button"), ids.join());
  assert.ok(!ids.includes("tooltip") && !existsSync(join(ws, "tokens/components/tooltip.tokens.json")), "components not picked stay out");
  assert.equal(s.unsaved.length, 0, "the creation is saved as a version");
  assert.match(s.versions[0].subject, /Style and guidelines for Pocket/);

  // A style pick from the UI is a change: written at once, undoable.
  const picked = (await api("api/style", { brand: "pocket", main: "rose" })).json;
  assert.equal(picked.style.main, "rose");
  assert.equal((await api("api/style", { brand: "pocket", main: "rose" })).json.unchanged, true);
  // Drafts the user confirms: the description of the next version (at once from the change titles, then Claude's).
  const engineDraft = (await api("api/version-draft")).json;
  assert.equal(engineDraft.by, "plinth");
  assert.match(engineDraft.text, /rose/i);
  const claudeDraft = (await api("api/version-draft", {})).json;
  assert.equal(claudeDraft.by, "claude");
  assert.equal(claudeDraft.text, `Claude: ${engineDraft.text}`, "the stand-in echoes the first change it was given");
  assert.equal(claudeDraft.key, engineDraft.key);
  await api("api/undo", {});
  assert.equal((await api("api/state")).json.style.pocket.main, "blue");
  assert.equal((await api("api/version-draft")).json.text, null, "nothing left to describe");
  assert.equal((await api("api/color-name?color=%23e2725b")).json.name, "terracotta");
  // A base color picked for one of your colors: one undoable change, titled as the UI says it.
  const recolor = (await api("api/role-color", { brand: "pocket", role: "destructive", color: "orange.700", mode: "default", title: "Errors: Orange 700" })).json;
  assert.equal(recolor.title, "Errors: Orange 700");
  assert.equal((await api("api/state")).json.lastChange.title, "Errors: Orange 700");
  assert.equal((await api("api/role-color", { brand: "pocket", role: "destructive", color: "orange.700" })).json.unchanged, true);
  await api("api/undo", {});

  // Removing: refused for a component the Foundations pages use.
  const refused = await api("api/remove-component", { name: "button" });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /used by/);
  assert.deepEqual((await api("api/state")).json.components.find((c) => c.id === "button").usedBy.includes("src/foundations/blocks.tsx"), true);

  // Adding from the catalog is one change: free, at once, undoable. Icons come from the shipped set.
  const added = await api("api/add-component", { name: "tooltip" });
  assert.equal(added.status, 200, JSON.stringify(added.json));
  assert.ok((await api("api/state")).json.components.some((c) => c.id === "tooltip"));
  assert.match((await api("api/add-component", { name: "tooltip" })).json.error, /already/);
  await api("api/undo", {});
  assert.ok(!(await api("api/state")).json.components.some((c) => c.id === "tooltip"), "Undo takes the component back");
  const tool = async (name, args) => JSON.parse((await request("tools/call", { name, arguments: args })).result.content[0].text);
  const found = await tool("find_icons", { query: "calendar" });
  assert.ok(found.results.some((r) => r.name === "calendar" && r.inDesignSystem && r.import === "CalendarIcon"), JSON.stringify(found.results.slice(0, 3)));
  const iconsAdded = await tool("add_icons", { names: ["heart"] });
  assert.ok(iconsAdded.files.includes("icons/heart.svg"), JSON.stringify(iconsAdded));
  assert.match(readFileSync(join(ws, "src/icons/index.tsx"), "utf8"), /export function HeartIcon/);

  // Answering again keeps the workspace; the new style is applied and left for the user to save.
  await api("api/setup", { product: "A budgeting app for students", feel: "Bright and playful", kind: "mobile-app", palette: "orange-stone", corners: "round", font: "Inter", components: [], extraText: "" });
  s = await settled();
  assert.equal(s.setup.fresh, false);
  assert.equal(s.style.pocket.main, "orange");
  assert.ok(s.unsaved.length > 0, "answering again is not saved for the user");
  assert.match(s.chat.messages.filter((m) => m.role === "user").at(-1).text, /^I answered the questions again/);
});
