// Changing one part's color from the edit panel: everywhere (the color it uses) or only this part (a new color, copied
// into every brand first so other brands keep their look), a color of its own from the wheel in the same change, and
// a short request turned into values by Claude, checked before anything is written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import * as ws from "../engine/workspace.mjs";
import { partColorOps, partRole } from "../engine/style.mjs";
import { quickEdit } from "../server/quick.mjs";

const FAKE = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));
const json = (root, rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));

function twoBrands(t) {
  const root = mkdtempSync(join(tmpdir(), "plinth-part-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "P", brand: "acme" });
  const cfg = json(root, "design-system.json");
  cfg.brands.push({ id: "kids" });
  ws.change(root, { title: "kids", by: "test", ops: [
    { op: "write", file: "brands/kids/tokens.json", content: readFileSync(join(root, "brands/acme/tokens.json"), "utf8") },
    { op: "write", file: "brands/kids/DESIGN.md", content: "# Kids\n" },
    { op: "write", file: "design-system.json", content: JSON.stringify(cfg, null, 2) },
  ] });
  // Kids uses another main color, so a copy has to come from each brand's own value.
  ws.change(root, { title: "kids main", by: "test", ops: [{ op: "set", file: "brands/kids/tokens.json", path: "color/primary", value: "{color.rose.600}" }] });
  return root;
}

test("part color: everywhere changes the color it uses; only this part makes a new color in every brand", (t) => {
  const root = twoBrands(t);
  const part = "button/default/background";
  assert.equal(partRole(root, "acme", part), "primary");

  const all = partColorOps(root, "acme", { part, color: "violet.700", scope: "role" });
  assert.equal(all.role, "primary");
  assert.ok(all.ops.every((o) => o.file === "brands/acme/tokens.json" && o.path === "color/primary"));

  const before = json(root, "brands/acme/tokens.json").color.primary.$value;
  const one = partColorOps(root, "acme", { part, color: "violet.700", scope: "part" });
  assert.equal(one.role, "primary-button");
  ws.change(root, { title: "only this", ops: one.ops, by: "test" });
  const acme = json(root, "brands/acme/tokens.json").color, kids = json(root, "brands/kids/tokens.json").color;
  assert.equal(acme["primary-button"].$value, "{color.violet.700}");
  assert.equal(acme.primary.$value, before, "the old color stays");
  assert.equal(kids["primary-button"].$value, "{color.rose.600}", "other brands keep their look");
  const button = json(root, "tokens/components/button.tokens.json");
  assert.equal(button.button.default.background.$value, "{color.primary-button}");
  assert.equal(partRole(root, "kids", part), "primary-button");
  assert.equal(partColorOps(root, "acme", { part, color: "violet.700", scope: "part" }).role, "primary-button-button", "a second copy gets its own name");
  assert.throws(() => partColorOps(root, "acme", { part, color: "violet.700", scope: "part", name: "primary" }), /already/);
});

test("set_part_color: a color of its own joins the palette and the part takes it in one undoable change", async (t) => {
  const root = twoBrands(t);
  const { TOOLS } = await import("../server/tools.mjs");
  const tool = TOOLS.find((x) => x.name === "set_part_color");
  const ctx = { root, notify: () => {} };
  const r = tool.run({ brand: "acme", part: "card/container/background", color: "#9e5e00", scope: "part", paletteName: "rust", by: "you", title: "Card background: its own color" }, ctx);
  assert.equal(r.made, true);
  assert.match(r.color, /^rust\.\d+$/);
  assert.ok(json(root, "tokens/primitives.tokens.json").color.rust, "the palette has the new color");
  assert.equal(json(root, "tokens/components/card.tokens.json").card.container.background.$value, `{color.${r.role}}`);
  ws.undo(root);
  assert.equal(json(root, "tokens/primitives.tokens.json").color.rust, undefined, "one undo takes it all back");
  assert.equal(json(root, "tokens/components/card.tokens.json").card.container.background.$value, "{color.card}");
});

test("quick edit: Claude's values are checked; only picked paths and real values come back", async (t) => {
  const root = twoBrands(t);
  const picks = [{ path: "button/default/background", prop: "Background", kind: "color", state: null }, { path: "button/radius", prop: "Corners", kind: "radius", state: null }];
  const r = await quickEdit(root, { brand: "acme", picks, text: "a bit deeper", title: "Button" }, { bin: FAKE });
  assert.deepEqual(r.changes, [{ path: "button/default/background", to: "violet.700", kind: "color" }]);
  assert.equal(r.chat, false);
  assert.match(r.reply, /violet/);
  const chat = await quickEdit(root, { brand: "acme", picks, text: "animate it when it appears", title: "Button" }, { bin: FAKE });
  assert.equal(chat.chat, true);
  assert.deepEqual(chat.changes, []);
  await assert.rejects(quickEdit(root, { brand: "acme", picks: [], text: "darker" }, { bin: FAKE }), /nothing picked/);
});

test("template: a Storybook on this computer loads Plinth's picker; the published site does not", () => {
  const preview = readFileSync(join(ws.TEMPLATE_DIR, ".storybook/preview.tsx"), "utf8");
  assert.match(preview, /plinthInspect/);
  assert.match(preview, /local\(location\.hostname\)/, "only on this computer");
  const inspect = readFileSync(fileURLToPath(new URL("../server/inspect.js", import.meta.url)), "utf8");
  assert.match(inspect, /e\.origin !== ui/, "it takes orders only from the Plinth UI that served it");
  // The page of every component: out of the tests and the manifest, without stories that open an overlay.
  const sheet = readFileSync(join(ws.TEMPLATE_DIR, "src/foundations/sticker-sheet.stories.tsx"), "utf8");
  assert.match(sheet, /tags: \["!test", "!manifest", "!autodocs"\]/);
  assert.match(sheet, /defaultOpen/);
  assert.match(sheet, /data-sheet=\{s\.id\}/, "sections the picker can reveal");
});
