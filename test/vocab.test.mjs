// The shared vocabulary: every preset is an entry with words, an illustration and the ops that apply it; looks resolve
// to families, corners and fonts that exist; the block for Claude names exact ids and drops what it does not know.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeMention, LOOKS, mentionBlock, vocabulary } from "../server/vocab.mjs";
import { COMPONENTS, FONTS, PALETTES } from "../server/start.mjs";
import { CORNERS, GLASS_PRESETS } from "../engine/style.mjs";
import { TEMPLATE_DIR } from "../engine/workspace.mjs";

test("vocabulary: entries, looks and the block for Claude", () => {
  const v = vocabulary(null); // before a design system exists
  const ids = new Set(v.map((e) => e.id));
  assert.equal(ids.size, v.length, "ids are unique");
  for (const c of COMPONENTS) assert.ok(ids.has(`component:${c.id}`), c.id);
  for (const f of FONTS) assert.ok(v.some((e) => e.kind === "font" && e.key === f.family), f.family);
  for (const p of PALETTES) assert.ok(ids.has(`color:${p.id}`), p.id);
  for (const k of Object.keys(CORNERS)) assert.ok(ids.has(`corners:${k}`), k);
  for (const k of Object.keys(GLASS_PRESETS)) assert.ok(ids.has(`glass:${k}`), k);
  for (const l of LOOKS) assert.ok(ids.has(`look:${l.key}`), l.key);
  for (const e of v) {
    assert.ok(e.name && typeof e.hint === "string" && e.aliases.length, e.id);
    assert.ok(e.aliases.every((a) => a === a.toLowerCase()), `${e.id}: aliases are lower case`);
    assert.equal(e.current, false);
    assert.equal(e.inSystem, false);
    if (e.kind !== "component") assert.ok(e.apply.length, `${e.id} can be applied`);
  }
  // Without a workspace every catalog component can be added, by its id.
  for (const e of v.filter((x) => x.kind === "component")) assert.deepEqual(e.apply, [{ tool: "add_component", args: { name: e.key } }]);
  // Looks are made of things that exist: a main and a gray family in the template's palette, a corner preset, fonts the UI offers.
  const prim = JSON.parse(readFileSync(join(TEMPLATE_DIR, "tokens", "primitives.tokens.json"), "utf8"));
  for (const l of LOOKS) {
    assert.ok(prim.color[l.style.main]?.["700"], `${l.key}: main ${l.style.main}`);
    assert.ok(prim.color[l.style.gray]?.["500"], `${l.key}: gray ${l.style.gray}`);
    assert.ok(CORNERS[l.style.corners], `${l.key}: corners ${l.style.corners}`);
    assert.ok(FONTS.some((f) => f.family === l.style.font), `${l.key}: font ${l.style.font}`);
    if (l.style.headingFont) assert.ok(FONTS.some((f) => f.family === l.style.headingFont), `${l.key}: heading font`);
    if (l.glass) assert.ok(GLASS_PRESETS[l.glass], `${l.key}: glass`);
    const e = v.find((x) => x.id === `look:${l.key}`);
    assert.ok(e.art.swatches.every(Boolean) && e.art.swatches.length === 5, `${l.key}: swatches`);
    assert.ok(e.art.corners, `${l.key}: a corner radius to draw`);
    assert.equal(e.apply[0].tool, "set_style");
  }
  // Illustration data per kind.
  assert.equal(v.find((e) => e.id === "color:teal-stone").art.swatches.length, 5);
  assert.equal(v.find((e) => e.id === "corners:pill").art.corners, "9999px");
  assert.deepEqual(v.find((e) => e.id === "glass:frosted").art.glass, GLASS_PRESETS.frosted);
  assert.equal(v.find((e) => e.id === "font:playfair-display").art.kind, "serif");
  assert.deepEqual(v.find((e) => e.id === "font:playfair-display").apply, [{ tool: "set_style", args: { headingFont: "Playfair Display" } }]);
  assert.deepEqual(v.find((e) => e.id === "font:inter").apply, [{ tool: "set_style", args: { font: "Inter" } }]);
  assert.ok(v.find((e) => e.id === "component:select").aliases.includes("dropdown"));
  assert.ok(v.find((e) => e.id === "component:progress").aliases.includes("進度條"));

  // The block for Claude: exact ids, how to apply each, unknown ids dropped, nothing when nothing was picked.
  assert.deepEqual(mentionBlock(null, []), { block: "", mentions: [] });
  assert.deepEqual(mentionBlock(null, ["nope", 42]), { block: "", mentions: [] });
  const { block, mentions } = mentionBlock(null, ["component:dialog", "look:frosted-glass", "glass:clear", "nope"]);
  assert.deepEqual(mentions, [{ id: "component:dialog", kind: "component", name: "Dialog" }, { id: "look:frosted-glass", kind: "look", name: "Frosted glass look" }, { id: "glass:clear", kind: "glass", name: "Clear glass" }]);
  assert.match(block, /^\n\nPicked from Plinth's menu/);
  assert.match(block, /- Component "Dialog" \(dialog\): not in this design system yet; add it with add_component \{"name":"dialog"\} \(ready-made, free\)\./);
  assert.match(block, /- Look "Frosted glass look": .*Apply with set_style \{"main":"blue","gray":"slate","corners":"round","font":"Geist","headingFont":""\}, then set_glass \{"preset":"frosted"\}\./);
  assert.match(block, /- Glass "Clear glass": Thin tint.*set_glass \{"preset":"clear"\}/);
  assert.ok(!block.includes("nope"));
  // A component the catalog does not have (Claude writes it) says so.
  assert.match(describeMention({ kind: "component", name: "Date picker", key: "date-picker", inSystem: false, apply: null }), /not in the catalog; write it if asked/);
  assert.match(describeMention({ kind: "component", name: "Button", key: "button", inSystem: true, apply: null }), /already in this design system at src\/components\/button/);
});
