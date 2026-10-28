// Starting from scratch: the design system goes back to a fresh one (template tokens, guidelines, the core
// components, one brand, no answers) in one change Undo takes back; what there was is saved as a version first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as ws from "../engine/workspace.mjs";
import { TOOLS } from "../server/tools.mjs";
import { COMPONENTS } from "../server/start.mjs";

const json = (root, rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));

test("start from scratch: one undoable change back to a fresh design system; the old one is saved first", (t) => {
  const root = mkdtempSync(join(tmpdir(), "plinth-scratch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  ws.initWorkspace(root, { name: "Jewel", brand: "jewel" });
  // A design system with answers, a color of its own, a second brand and every catalog component, partly unsaved.
  const cfg = json(root, "design-system.json");
  cfg.brief = { product: "A jewelry shop", answeredAt: new Date().toISOString() };
  cfg.brands.push({ id: "kids" });
  ws.change(root, { title: "grown", by: "test", ops: [
    { op: "write", file: "design-system.json", content: JSON.stringify(cfg, null, 2) },
    { op: "write", file: "brands/kids/tokens.json", content: readFileSync(join(root, "brands/jewel/tokens.json"), "utf8") },
    { op: "set", file: "tokens/primitives.tokens.json", path: "color/rust/500", type: "color", value: "#9e5e00" },
    { op: "write", file: "DESIGN.md", content: "# Jewel\n\nOur own guide.\n" },
  ] });
  const before = { components: ws.listComponents(root).length, design: readFileSync(join(root, "DESIGN.md"), "utf8") };
  assert.ok(before.components > 5);

  const tool = TOOLS.find((x) => x.name === "start_from_scratch");
  const r = tool.run({ by: "you" }, { root, notify: () => {} });
  assert.ok(r.saved, "the unsaved work became a version first");
  assert.match(ws.versions(root, 2).map((v) => v.subject).join("|"), /Before starting from scratch/);
  assert.equal(r.title, "Start from scratch");

  const core = COMPONENTS.filter((c) => c.core).map((c) => c.id).sort();
  assert.deepEqual(ws.listComponents(root).map((c) => c.id).sort(), core);
  const after = json(root, "design-system.json");
  assert.equal(after.brief, undefined, "no answers: the questions come again");
  assert.deepEqual(after.brands.map((b) => b.id), ["jewel"], "one brand, the default one");
  assert.equal(existsSync(join(root, "brands/kids/tokens.json")), false);
  assert.equal(json(root, "tokens/primitives.tokens.json").color.rust, undefined, "colors of its own go");
  assert.notEqual(readFileSync(join(root, "DESIGN.md"), "utf8"), before.design, "the template's guide");
  assert.ok(existsSync(join(root, ".ds", "scratch.json")), "Publish suggests a new repository after this");

  ws.undo(root);
  assert.equal(ws.listComponents(root).length, before.components, "Undo brings it all back");
  assert.equal(readFileSync(join(root, "DESIGN.md"), "utf8"), before.design);
  assert.ok(json(root, "design-system.json").brief);
});
