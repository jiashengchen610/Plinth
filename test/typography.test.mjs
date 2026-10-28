// Fonts in layers: text styles point at font roles, font roles at fonts in the palette, component parts at text
// styles. A design system made before that is upgraded without touching component files someone edited.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import * as ws from "../engine/workspace.mjs";
import { typographyUpgrade } from "../engine/upgrade.mjs";
import { readFonts } from "../engine/style.mjs";
import { buildCss } from "../engine/tokens.mjs";
import { checkRepo } from "../engine/check.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const fonts = (f) => ({ font: f.font, headingFont: f.headingFont, labelFont: f.labelFont, codeFont: f.codeFont });

test("fonts upgrade: a 0.6 design system gets font roles, text styles and text tokens; edited components stay", (t) => {
  let tar;
  try {
    execFileSync("git", ["rev-parse", "--verify", "v0.6.2"], { cwd: repo, stdio: "ignore" });
    tar = execFileSync("git", ["archive", "--format=tar", "v0.6.2", "template"], { cwd: repo, maxBuffer: 256 * 1024 * 1024 });
  } catch { t.skip("needs this repository's history (tag v0.6.2)"); return; }
  const dir = mkdtempSync(join(tmpdir(), "plinth-type-up-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "old.tar"), tar);
  execFileSync("tar", ["-xf", "old.tar"], { cwd: dir });
  const root = join(dir, "ws");
  ws.initWorkspace(root, { name: "Old", brand: "old", templateDir: join(dir, "template") });
  // Someone edited the tabs, and the display style got a serif.
  const tabs = join(root, "src/components/tabs/tabs.tsx");
  writeFileSync(tabs, readFileSync(tabs, "utf8").replace("inline-flex h-full flex-1", "inline-flex h-full flex-1 shadow-card"));
  ws.change(root, { title: "serif display", ops: [{ op: "set", file: "tokens/base.tokens.json", path: "typography/display/font-family", value: ["Playfair Display", "serif"] }], by: "test" });

  const up = typographyUpgrade(root, ws.TEMPLATE_DIR);
  assert.ok(up, "an upgrade is offered");
  assert.deepEqual(up.kept, ["src/components/tabs/tabs.tsx"]);
  ws.change(root, { title: up.title, ops: up.ops, by: "test" });
  assert.equal(typographyUpgrade(root, ws.TEMPLATE_DIR), null, "offered once");
  assert.deepEqual(fonts(readFonts(root, "old")), { font: "Geist", headingFont: "Playfair Display", labelFont: "body", codeFont: "Geist Mono" }, "the serif display font became the headings font");
  assert.equal(readFileSync(join(root, "src/components/button/button.tsx"), "utf8"), readFileSync(join(ws.TEMPLATE_DIR, "src/components/button/button.tsx"), "utf8"), "an untouched component takes its text from tokens now");
  assert.match(readFileSync(tabs, "utf8"), /shadow-card/, "the edited one stays");

  const { issues, css } = buildCss(root);
  assert.deepEqual(issues, []);
  assert.match(css, /@utility type-card-title \{/);
  const base = JSON.parse(readFileSync(join(root, "tokens/base.tokens.json"), "utf8"));
  assert.equal(base.typography.display.$value.fontFamily, "{font.heading}");
  assert.equal(base.typography.body.md.$value.fontFamily, "{font.body}");
  const check = checkRepo(root);
  assert.equal(check.ok, true, JSON.stringify(check.blocking));
  assert.ok(check.reminders.textWithoutTokens.some((r) => r.startsWith("src/components/tabs/tabs.tsx")), "the kept Tabs component's text sizes are a reminder");
});
