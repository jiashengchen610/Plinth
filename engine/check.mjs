// `plinth check`: what the deploy workflow runs before building Storybook, so whatever reaches the published
// Storybook passed the same checks no matter who changed it, or how. It blocks what is broken or skips the
// pipeline: token references that resolve to nothing, generated files that no longer match the tokens, and
// components outside the component format (component tokens, a story, no hardcoded values). Design findings are
// reminders: listed, never blocking. Type errors and failing story tests are the workflow's own steps.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildCss, loadConfig } from "./tokens.mjs";
import { fontsToLoad, fontsCss } from "./fonts.mjs";
import { runChecks } from "./checks.mjs";
import { REMINDER_RULES } from "./check-hardcoded.mjs";
import { listComponents, foundationsData, FOUNDATIONS_DATA } from "./workspace.mjs";
import { iconsModule } from "./icons.mjs";

const ICON_PACKAGE = /from\s+["'](lucide-react|@heroicons\/react[^"']*|react-icons[^"']*|@phosphor-icons\/react|@tabler\/icons-react|@radix-ui\/react-icons)["']/;
const read = (root, rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n") : null);
const slash = (p) => p.replace(/\\/g, "/");

/**
 * @returns {{ ok: boolean, blocking: Array<{ kind: string, detail: string }>, reminders: object }}
 */
export function checkRepo(root) {
  const config = loadConfig(root);
  const blocking = [];

  // 1. Token references
  const { css, issues } = buildCss(root, config);
  for (const issue of issues) blocking.push({ kind: "token", detail: issue });

  // 2. Generated files match the tokens (someone edited a token file and committed without regenerating)
  const generated = { "src/styles/tokens.css": css, "src/styles/fonts.css": fontsCss(fontsToLoad(root, config)), "src/icons/index.tsx": iconsModule(root), [FOUNDATIONS_DATA]: foundationsData(root, config) };
  for (const [file, want] of Object.entries(generated)) {
    if (read(root, file) !== want) blocking.push({ kind: "generated", detail: `${file} does not match the tokens: it was not regenerated after a token edit. Open the folder in Plinth (it regenerates on its own), save a version and push again.` });
  }

  // 3. Component format
  const checks = runChecks(root);
  const layered = Array.isArray(config.layers);
  for (const c of listComponents(root)) {
    if (!c.hasStories) blocking.push({ kind: "component", detail: `${c.id}: no ${c.id}.stories.tsx in src/components/${c.id}. Every component has a story, so its tests run.` });
    if (layered && !existsSync(join(root, "tokens", "components", `${c.id}.tokens.json`))) blocking.push({ kind: "component", detail: `${c.id}: no component tokens (tokens/components/${c.id}.tokens.json). Add the component through Plinth so it gets them.` });
  }
  // Icons come from icons/ through src/icons; an icon package would bypass the repo's own set.
  for (const c of listComponents(root)) {
    for (const file of c.files.filter((f) => /\.(tsx?|jsx?)$/.test(f))) {
      const m = ICON_PACKAGE.exec(read(root, `src/components/${c.id}/${file}`) ?? "");
      if (m) blocking.push({ kind: "icons", detail: `src/components/${c.id}/${file} imports icons from ${m[1]}. Use the design system's own icons (import from "@/icons"; add missing ones through Plinth).` });
    }
  }
  for (const f of checks.hardcoded.filter((h) => !h.accepted && slash(h.file).startsWith("src/components/") && !REMINDER_RULES.has(h.rule))) {
    blocking.push({ kind: "hardcoded", detail: `${slash(f.file)}:${f.line} ${f.match} (${f.rule}). Use a token, or accept it as an exception in Plinth.` });
  }

  // Reminders
  const open = (list) => list.filter((r) => !r.pass && !r.accepted);
  const reminders = {
    contrast: open(checks.contrast).map(({ brand, mode, fg, bg, ratio, min }) => `${brand} ${mode === "default" ? "light" : mode}: ${fg} on ${bg} ${ratio ?? "?"}:1 (needs ${min}:1)`),
    lookAlike: open(checks.distinct).map(({ brand, mode, a, b, reason }) => `${brand} ${mode === "default" ? "light" : mode}: ${a} and ${b} look alike (${reason})`),
    structure: open(checks.structure).map(({ brand, detail }) => `${brand}: ${detail}`),
    hardcodedOutsideComponents: checks.hardcoded.filter((h) => !h.accepted && !slash(h.file).startsWith("src/components/")).map((f) => `${slash(f.file)}:${f.line} ${f.match}`),
    textWithoutTokens: checks.hardcoded.filter((h) => !h.accepted && slash(h.file).startsWith("src/components/") && h.rule === "tw-type").map((f) => `${slash(f.file)}:${f.line} ${f.match}`),
    nestedCorners: checks.hardcoded.filter((h) => !h.accepted && slash(h.file).startsWith("src/components/") && h.rule === "nested-radius").map((f) => `${slash(f.file)}:${f.line} ${f.match}`),
  };
  return { ok: blocking.length === 0, blocking, reminders };
}

/** Markdown for the workflow run's summary page. */
export function checkMarkdown(result) {
  const lines = [result.ok ? "## Plinth check passed" : `## Plinth check: ${result.blocking.length} problem${result.blocking.length > 1 ? "s" : ""} stop the deploy`, ""];
  for (const b of result.blocking) lines.push(`- **${b.kind}** ${b.detail}`);
  const rem = Object.entries(result.reminders).filter(([, list]) => list.length);
  if (rem.length) {
    lines.push("", "### Reminders (do not stop the deploy)", "");
    const names = { contrast: "Contrast", lookAlike: "Look-alike roles", structure: "Layer structure", hardcodedOutsideComponents: "Hardcoded values outside components", textWithoutTokens: "Text sizes not from text tokens", nestedCorners: "Parts inside a container with the container's own corners" };
    for (const [k, list] of rem) {
      lines.push(`**${names[k] ?? k}** (${list.length})`, "");
      for (const item of list.slice(0, 20)) lines.push(`- ${item}`);
      if (list.length > 20) lines.push(`- … and ${list.length - 20} more`);
      lines.push("");
    }
  }
  return lines.join("\n") + "\n";
}
