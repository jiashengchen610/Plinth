// `plinth connect <site or folder> [product folder]`: connect a product repo to a design system. Reads the design
// system's update record, copies the files asked for (a first connect takes the guidelines and the generated
// styles), writes plinth-source.json (what was taken, at which version, with its hash), adds the design-system
// section to the product's CLAUDE.md so its agent checks before changing the interface and proposes instead of
// overwriting, keeps .ds/ out of git, and with --hook adds the Claude Code hook that runs status at session start.
// `--take` later takes more files or the design system's newer version of one; `--mark` records a file merged by
// hand as taken. Nothing here is specific to a framework: it copies files and writes plain data.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { PLINTH_VERSION } from "../engine/workspace.mjs";
import { SOURCE_FILE } from "../engine/status.mjs";
import { GROUPS, resolveTake, sourceAfter, claudeMdSection, withClaudeSection, withHook } from "../engine/connect.mjs";
import { loadRecord, upstreamText } from "./status.mjs";

const DEFAULT_TAKE = ["guidelines", "styles"];

export async function connect(root, { source, take = [], mark = [], hook = false, repository = null } = {}) {
  if (!source) throw new Error("connect needs the design system's site (https://…/) or its folder.");
  const record = await loadRecord(source);
  if (!record.files || !record.version) throw new Error(`${source} has an update record without files or versions: publish the design system again.`);
  const existing = existsSync(join(root, SOURCE_FILE)) ? JSON.parse(readFileSync(join(root, SOURCE_FILE), "utf8")) : null;
  const repo = repository ?? record.repository ?? existing?.repository ?? null;

  // A first connect without a list takes what every product needs; later connects take only what they name.
  const taking = resolveTake(record, take.length || mark.length || existing ? take : DEFAULT_TAKE);
  const marking = resolveTake(record, mark);
  const where = { source, repository: repo };
  for (const { from, to } of taking) {
    const text = await upstreamText(where, record, from);
    mkdirSync(dirname(join(root, to)), { recursive: true });
    writeFileSync(join(root, to), text);
  }

  const next = sourceAfter(existing, record, [...taking, ...marking], { source, repository: repo, takenAt: new Date().toISOString() });
  writeFileSync(join(root, SOURCE_FILE), JSON.stringify(next, null, 2) + "\n");

  const claudeFile = join(root, "CLAUDE.md");
  const before = existsSync(claudeFile) ? readFileSync(claudeFile, "utf8") : "";
  writeFileSync(claudeFile, withClaudeSection(before, claudeMdSection({ source, repository: repo, name: record.name, plinthVersion: PLINTH_VERSION })));

  // status --diff saves the design system's copies under .ds/; they are working files, not the product's.
  const ignoreFile = join(root, ".gitignore");
  const ignore = existsSync(ignoreFile) ? readFileSync(ignoreFile, "utf8") : "";
  if (!/^\.ds\/?$/m.test(ignore)) writeFileSync(ignoreFile, `${ignore.trimEnd()}${ignore.trim() ? "\n" : ""}.ds/\n`);

  let hookWritten = false;
  if (hook) {
    const file = join(root, ".claude", "settings.json");
    const current = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(withHook(current, `npx -y github:jiashengchen610/Plinth#v${PLINTH_VERSION} status`), null, 2) + "\n");
    hookWritten = true;
  }

  const taken = new Set(Object.values(next.files).map((f) => f.from));
  const available = Object.fromEntries(Object.keys(GROUPS).map((g) => [g, resolveTake(record, [g]).filter((e) => !taken.has(e.from)).length]).filter(([, n]) => n > 0));
  return {
    name: record.name ?? null,
    source,
    repository: repo,
    version: record.version.short,
    first: !existing,
    took: taking.map((e) => e.to),
    marked: marking.map((e) => e.to),
    files: Object.keys(next.files).length,
    claudeMd: before ? "updated" : "created",
    hook: hookWritten,
    available,
    packages: taking.some((e) => e.from.startsWith("src/components/")) ? record.packages ?? {} : {},
  };
}

/** The report as Markdown. */
export function connectMarkdown(r) {
  const lines = [`# Connected to ${r.name ?? "the design system"} at version ${r.version}`, "", `Source: ${r.source}${r.repository ? ` · Repository: ${r.repository}` : ""}`];
  if (r.took.length) { lines.push("", `## Took ${r.took.length} file${r.took.length === 1 ? "" : "s"}`, ""); for (const f of r.took) lines.push(`- ${f}`); }
  if (r.marked.length) { lines.push("", `## Marked as taken (merged by hand): ${r.marked.length}`, ""); for (const f of r.marked) lines.push(`- ${f}`); }
  lines.push("", `${SOURCE_FILE}: ${r.files} file${r.files === 1 ? "" : "s"} recorded · CLAUDE.md: design-system section ${r.claudeMd} · session hook: ${r.hook ? "added (.claude/settings.json)" : "not added (pass --hook)"}`);
  const pk = Object.entries(r.packages);
  if (pk.length) lines.push("", `The components need these packages here: ${pk.map(([n, v]) => `${n}@${v}`).join(", ")}. Styles expect Tailwind v4 with src/styles/tokens.css imported.`);
  const avail = Object.entries(r.available);
  if (avail.length) lines.push("", `Also available: ${avail.map(([g, n]) => `${g} (${n} file${n === 1 ? "" : "s"}, \`--take ${g}\`)`).join(", ")}; or \`--take components/<name>\` for one component.`);
  lines.push("", "Run `plinth status --diff` any time to see what the design system changed since.");
  return lines.join("\n") + "\n";
}
