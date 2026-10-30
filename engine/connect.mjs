// `plinth connect`, the data side: which files a request names (groups, components/<name>, or paths) resolved
// against the design system's update record and where each lands in the product; the next plinth-source.json; the
// CLAUDE.md section that tells the product's agent how to work with the design system (check before changing the
// interface, propose, let the person decide); and the Claude Code hook that runs status when a session starts.
// No file system here: server/connect.mjs fetches and writes.
import { SOURCE_FILE } from "./status.mjs";

export const GROUPS = {
  guidelines: "DESIGN.md per brand and WRITING.md",
  styles: "the generated styles, src/styles/tokens.css and fonts.css",
  tokens: "the token sources: tokens/, brands/, design-system.json",
  icons: "the icons: icons/*.svg and src/icons/index.tsx",
  components: "every component under src/components/",
};
const MATCH = {
  guidelines: (f) => f === "WRITING.md" || /^exports\/[^/]+\/DESIGN\.md$/.test(f),
  styles: (f) => f.startsWith("src/styles/"),
  tokens: (f) => f.startsWith("tokens/") || f.startsWith("brands/") || f === "design-system.json",
  icons: (f) => f.startsWith("icons/") || f.startsWith("src/icons/"),
  components: (f) => f.startsWith("src/components/"),
};

/** Where a design-system file lands in the product: the same path, except a brand's DESIGN.md export, which becomes the product's DESIGN.md. */
export function localPath(from, brands = []) {
  const m = from.match(/^exports\/([^/]+)\/DESIGN\.md$/);
  if (!m) return from;
  return brands.length > 1 ? `DESIGN.${m[1]}.md` : "DESIGN.md";
}

/**
 * The files a request names: a group (GROUPS), `components/<name>`, or a path from the record (a file, or a folder
 * prefix); comma-separated lists are fine. Names that match nothing throw.
 * @returns {Array<{ from: string, to: string }>}
 */
export function resolveTake(record, takes) {
  const all = Object.keys(record.files ?? {});
  const picked = new Set();
  const unknown = [];
  for (const raw of (takes ?? []).flatMap((t) => String(t).split(",")).map((t) => t.trim()).filter(Boolean)) {
    const t = raw.replace(/\\/g, "/").replace(/\/+$/, "");
    let hits;
    if (MATCH[t]) hits = all.filter(MATCH[t]);
    else if (/^components\/[^/]+$/.test(t)) hits = all.filter((f) => f.startsWith(`src/${t}/`));
    else hits = all.filter((f) => f === t || f.startsWith(`${t}/`));
    if (!hits.length) unknown.push(raw);
    for (const f of hits) picked.add(f);
  }
  if (unknown.length) throw new Error(`Not in the design system: ${unknown.join(", ")}. Name a group (${Object.keys(GROUPS).join(", ")}), components/<name>, or a path from its exports/update.json.`);
  return [...picked].sort().map((from) => ({ from, to: localPath(from, record.brands ?? []) }));
}

/** plinth-source.json after taking or marking files: existing entries kept, these set to the record's hash and version. */
export function sourceAfter(existing, record, entries, { source, repository = null, takenAt }) {
  const files = { ...(existing?.files ?? {}) };
  for (const { from, to } of entries) files[to] = { from, hash: record.files[from].hash, version: record.files[from].version ?? record.version?.short ?? null };
  return {
    source,
    repository: repository ?? record.repository ?? existing?.repository ?? null,
    name: record.name ?? existing?.name ?? null,
    version: record.version?.short ?? null,
    takenAt,
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
  };
}

const MARK_START = "<!-- plinth:design-system -->";
const MARK_END = "<!-- /plinth:design-system -->";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The CLAUDE.md section for the product's agent. */
export function claudeMdSection({ source, repository = null, name = null, plinthVersion }) {
  const cli = `npx -y github:jiashengchen610/Plinth#v${plinthVersion}`;
  return [
    MARK_START,
    `## Design system${name ? ` (${name})` : ""}`,
    "",
    `This repository takes its design guidelines, tokens, styles and components from the design system at ${source}${repository ? ` (repository: ${repository})` : ""}. The copies and the version they were taken at are listed in ${SOURCE_FILE}; the design system is the source of truth.`,
    "",
    `- Before changing anything in the interface, run \`${cli} status --diff\` in this folder. It compares the copies with the design system's current version and reports, file by file, what the design system changed since (with the note of the version that changed it), what changed here, and what changed on both sides, with the differences.`,
    "- When it reports changes in the design system, read the notes and the differences, then propose for each file: take the design system's version, keep this repository's, or merge the two. Explain the proposal to the user and wait for their decision; never overwrite a file this repository changed without it.",
    `- To take the design system's version of a file after that decision: \`${cli} connect ${source} --take <path>\` (it copies the file and records the version). After merging a file by hand: \`${cli} connect ${source} --mark <path>\` (records the version without copying).`,
    "- Screens and layouts here use the design system's tokens (the CSS variables and utilities in src/styles/tokens.css: colors, text styles, corners, shadows, motion), never raw values. New components are made in the design system with Plinth and taken from there, not written here.",
    "- A change the design system should carry (a fix in a component, a missing token) goes to the design system's owner as a proposal, not into a private copy here.",
    MARK_END,
  ].join("\n");
}

/** CLAUDE.md with the section added, or replaced where an earlier connect wrote one. */
export function withClaudeSection(text, section) {
  const re = new RegExp(`${esc(MARK_START)}[\\s\\S]*?${esc(MARK_END)}`);
  if (re.test(text)) return text.replace(re, section);
  return `${text.trimEnd()}${text.trim() ? "\n\n" : ""}${section}\n`;
}

const STATUS_HOOK = /Plinth(#v[\d.]+)? status/;
/** Claude Code settings with a SessionStart hook that runs `plinth status`, added once, its command kept current. */
export function withHook(settings, command) {
  const s = structuredClone(settings ?? {});
  s.hooks ??= {};
  s.hooks.SessionStart ??= [];
  let found = false;
  for (const group of s.hooks.SessionStart) for (const h of group.hooks ?? []) if (STATUS_HOOK.test(h.command ?? "")) { h.command = command; found = true; }
  if (!found) s.hooks.SessionStart.push({ hooks: [{ type: "command", command }] });
  return s;
}
