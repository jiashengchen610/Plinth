// Workspace operations: scaffold from the template, change token files and guidelines (written at once, each change
// undoable), save the working files as versions when the user says so, list versions and restore any of them, and
// describe everything that changed since the last publish. Zero dependencies (shells out to git).
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync, mkdtempSync, readdirSync, statSync, renameSync } from "node:fs";
import { join, resolve, relative, dirname, sep } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildCss, loadConfig, listBrands, resolveBrand, cssName, glassRecipe, gradientAngle, TYPOGRAPHY_PARTS } from "./tokens.mjs";
import { checkContrast, checkDistinct, exceptionKey, acceptedBy } from "./checks.mjs";
import { fontsToLoad, fontsCss } from "./fonts.mjs";
import { hueFamily, staleMentions } from "./prose.mjs";
import { iconsModule } from "./icons.mjs";
import { chartOps } from "./chart.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_DIR = resolve(here, "..", "template");

// Files a change may touch. Anything else is refused.
const EDITABLE = [/^tokens\/(components\/|layers\/)?[^/]+\.json$/, /^brands\/[a-z0-9-]+\/(tokens\.json|DESIGN\.md|WRITING\.md)$/, /^(DESIGN|WRITING)\.md$/, /^design-system\.json$/, /^src\/components\/[a-z0-9-]+\/[^/]+$/, /^icons\/[a-z0-9-]+\.svg$/];

// ---------------- git ----------------
export function git(root, args, opts = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}
/**
 * Commit. With `paths`, only those paths (added, changed or deleted) go into the commit. Without, everything in the
 * working tree.
 */
export function gitCommit(root, message, paths = null) {
  // Only paths that actually changed: git refuses a pathspec that matches nothing.
  const under = (f, p) => f === p || f.startsWith(p.endsWith("/") ? p : `${p}/`);
  const sel = paths ? unsavedChanges(root).map((c) => c.file).filter((f) => paths.some((p) => under(f, p))) : ["."];
  if (!sel.length) return null;
  git(root, ["add", "-A", "--", ...sel]);
  if (!git(root, ["diff", "--cached", "--name-only", "--", ...sel])) return null;
  git(root, ["-c", "user.name=Design System", "-c", "user.email=design-system@localhost", "commit", "-q", "-m", message, "--", ...sel]);
  return git(root, ["rev-parse", "--short", "HEAD"]);
}

/** Paths regenerate writes. */
export const GENERATED = ["src/styles/tokens.css", "src/styles/fonts.css", "src/icons", "src/foundations", ".github/workflows/storybook.yml", ".storybook/preview.tsx", ".claude/settings.json", "CLAUDE.md", "src/index.css"];

/** Saved versions, newest first. `published`: already in the last published version. */
export function versions(root, limit = 50) {
  if (!existsSync(join(root, ".git"))) return [];
  let out = "";
  try { out = git(root, ["log", `-${limit}`, "--pretty=format:%h%x1f%H%x1f%cI%x1f%s"]); } catch { return []; } // no commit yet
  const ref = publishedRef(root);
  const published = new Set(ref ? git(root, ["rev-list", `--max-count=${limit + 500}`, ref]).split("\n") : []);
  return out ? out.split("\n").map((l) => { const [short, sha, date, subject] = l.split("\x1f"); return { short, sha, date, subject, published: published.has(sha) }; }) : [];
}

/**
 * The last published version: the remote branch publish pushed to, else the record publish leaves in .ds (a remote
 * that was removed), else null (never published).
 */
export function publishedRef(root) {
  try {
    const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return git(root, ["rev-parse", "--verify", "-q", `refs/remotes/origin/${branch}`]);
  } catch { /* no remote branch */ }
  try {
    const { sha } = JSON.parse(readFileSync(join(root, ".ds", "published.json"), "utf8"));
    return git(root, ["rev-parse", "--verify", "-q", `${sha}^{commit}`]);
  } catch { return null; }
}

// ---------------- unsaved work ----------------
/**
 * Files changed since the last saved version: by Plinth, by hand, by any tool. All of them are checked the same way
 * (Plinth watches the folder); saving a version commits them.
 * @returns {Array<{ file: string, status: "modified" | "added" | "deleted" }>}
 */
export function unsavedChanges(root) {
  if (!existsSync(join(root, ".git"))) return [];
  // Raw -z output: not git() (it trims, which eats the leading space of " M file"), no quoting of odd names.
  const out = execFileSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const entries = out.split("\0");
  const changes = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.length < 4) continue;
    const code = e.slice(0, 2);
    changes.push({ file: e.slice(3), status: code.includes("D") ? "deleted" : code === "??" || code.includes("A") ? "added" : "modified" });
    if (code[0] === "R" || code[0] === "C") i++; // the next entry is the original path of a rename or copy
  }
  return changes;
}
const requireSaved = (root, action) => {
  const open = unsavedChanges(root);
  if (open.length) throw new Error(`${open.length} unsaved change${open.length > 1 ? "s" : ""} (${open.slice(0, 3).map((o) => o.file).join(", ")}${open.length > 3 ? ", …" : ""}). Save them as a version or discard them before you ${action}.`);
};

/** Save the working files as a version: one commit with everything unsaved. The user decides when. */
export function saveVersion(root, message) {
  const text = String(message ?? "").trim();
  if (!text) throw new Error("A version needs a short description of what changed.");
  regenerate(root);
  const version = gitCommit(root, text);
  if (version) { mkdirSync(join(root, ".ds"), { recursive: true }); writeFileSync(join(root, ".ds", "saved.json"), JSON.stringify({ at: new Date().toISOString(), version }) + "\n"); }
  return version ? { version } : { version: null, message: "Nothing to save: no changes since the last version." };
}

const generatedFile = (f) => GENERATED.some((g) => f === g || f.startsWith(`${g}/`)) || f.startsWith("exports/");
/** What a new version would hold: the titles of the changes made since the last save, and the files that differ. */
export function changesSinceSave(root) {
  let since = null;
  try { since = JSON.parse(readFileSync(join(root, ".ds", "saved.json"), "utf8")).at; } catch { since = versions(root, 1)[0]?.date ?? null; }
  const after = since ? Date.parse(since) : 0;
  return {
    titles: undoStack(root).filter((e) => Date.parse(e.at) > after).map((e) => e.title),
    files: unsavedChanges(root).map((c) => c.file).filter((f) => !generatedFile(f)),
  };
}

/**
 * This round of work: what differs from the last published version (saved versions and unsaved work), and which
 * step it belongs to: style (palette, roles, fonts, corners, guidelines, settings) or components (their tokens, code
 * and icons). { published: null } before the first publish.
 * @returns {{ published: string | null, versions?: number, files?: number, steps?: { style: boolean, components: boolean } }}
 */
export function sincePublish(root) {
  const published = publishedRef(root);
  if (!published) return { published: null };
  let committed = [], count = 0;
  try { committed = git(root, ["diff", "--name-only", published, "--"]).split("\n").filter(Boolean); } catch { /* not a commit here */ }
  try { count = Number(git(root, ["rev-list", "--count", `${published}..HEAD`])) || 0; } catch { /* idem */ }
  const files = [...new Set([...committed, ...unsavedChanges(root).map((c) => c.file)])].filter((f) => !generatedFile(f) && !f.startsWith(".ds/"));
  const components = (f) => /^(tokens\/components\/|src\/components\/|icons\/)/.test(f);
  const style = (f) => /^(tokens\/|brands\/|design-system\.json$|DESIGN\.md$|WRITING\.md$)/.test(f) && !components(f);
  // Versions Plinth makes by itself (the exports of a publish, the lock file of an install) are not work of this round.
  const work = count ? git(root, ["log", "--pretty=format:%s", `${published}..HEAD`]).split("\n").filter((s) => s && !/^Publish: update exports$|^Installed the preview tools/.test(s)).length : 0;
  return { published, versions: work, files: files.length, steps: { style: files.some(style), components: files.some(components) } };
}

/** A description of the next version made from the change titles, for when Claude can't write one. */
export function versionDraft({ titles, files }) {
  const list = [...new Set(titles)];
  if (!list.length) return files.length ? `Edits to ${[...new Set(files.map((f) => f.split("/").at(-1)))].slice(0, 3).join(", ")}${files.length > 3 ? " and more" : ""}` : null;
  return list.length <= 2 ? list.join("; ") : `${list.slice(0, 2).join("; ")} and ${list.length - 2} more change${list.length > 3 ? "s" : ""}`;
}

/** Throw unsaved work away: back to the last saved version. */
export function discardUnsaved(root) {
  const open = unsavedChanges(root);
  for (const o of open) {
    if (o.status === "added") rmSync(join(root, o.file), { force: true });
    else git(root, ["checkout", "HEAD", "--", o.file]);
  }
  clearUndo(root);
  return { discarded: open.map((o) => o.file) };
}

/** Restore the working tree to a previous version as a NEW commit (history is never rewritten). */
export function restore(root, sha) {
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) throw new Error("invalid version id");
  requireSaved(root, "restore a version");
  git(root, ["rev-parse", "--verify", `${sha}^{commit}`]);
  git(root, ["checkout", sha, "--", "."]);
  // Files added after that version still exist: remove those that the target version does not track.
  const tracked = new Set(git(root, ["ls-tree", "-r", "--name-only", sha]).split("\n"));
  for (const f of git(root, ["ls-files"]).split("\n").filter(Boolean)) if (!tracked.has(f)) rmSync(join(root, f), { force: true });
  regenerate(root);
  clearUndo(root);
  const subject = git(root, ["log", "-1", "--pretty=%s", sha]);
  return gitCommit(root, `Restore: ${subject} (${sha.slice(0, 7)})`);
}

// ---------------- scaffold ----------------
/**
 * Recursive copy in plain JavaScript. Not fs.cpSync: on Node 24 / Windows its native implementation aborts the
 * whole process (exit 127, no error) when the destination is an existing folder directly under a drive root,
 * e.g. D:\my-design-system. `skip(rel)` gets the path relative to `src`.
 */
export function copyDir(src, dest, skip = () => false, rel = "") {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (skip(r)) continue;
    if (entry.isDirectory()) copyDir(join(src, entry.name), join(dest, entry.name), skip, r);
    else if (entry.isFile()) copyFileSync(join(src, entry.name), join(dest, entry.name));
  }
}

/**
 * Create a new workspace from the template. `brand` becomes the first brand id.
 * Does not install dependencies (see installDependencies).
 */
export function initWorkspace(root, { name = "my-design-system", brand = "default", context = "saas-dashboard", naming = "shadcn", templateDir = TEMPLATE_DIR, skipComponents = [] } = {}) {
  if (existsSync(join(root, "design-system.json"))) throw new Error(`${root} already contains a design system`);
  mkdirSync(root, { recursive: true });
  // Hidden entries (.git, .claude, .mcp.json, .vscode …) are editor or tool settings, not content.
  const nonEmpty = readdirSync(root).filter((f) => !f.startsWith(".")).length > 0;
  if (nonEmpty) throw new Error(`${root} is not empty`);
  if (!existsSync(join(templateDir, "design-system.json"))) throw new Error(`template not found at ${templateDir}`);
  // Filter on the path inside the template: the install itself may live under a node_modules folder (npx).
  const skip = /(^|[\\/])(node_modules|storybook-static|dist)([\\/]|$)/;
  // Catalog components the user did not pick stay out of the repo (they can be added later, free).
  const left = new Set(skipComponents.flatMap((id) => [`src/components/${id}`, `tokens/components/${id}.tokens.json`]));
  copyDir(templateDir, root, (rel) => skip.test(rel) || left.has(rel));
  // npm drops .gitignore files from packages, so the template ships it without the dot.
  if (existsSync(join(root, "gitignore"))) renameSync(join(root, "gitignore"), join(root, ".gitignore"));
  if (!existsSync(join(root, ".gitignore"))) throw new Error("template is missing its gitignore");
  if (brand !== "default") {
    renameSync(join(root, "brands", "default"), join(root, "brands", brand));
  }
  const cfgPath = join(root, "design-system.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  Object.assign(cfg, { name, context, naming, defaultBrand: brand, brands: [{ id: brand, name: brand }] });
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  const pkgPath = join(root, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  regenerate(root);
  if (!existsSync(join(root, ".git"))) git(root, ["init", "-q", "-b", "main"]);
  return gitCommit(root, `Create design system "${name}"`);
}

/**
 * Regenerate derived files: the token stylesheet, the font loader, and the data the Storybook Foundations pages
 * read. Also brings Plinth-managed files (Foundations pages, Storybook preview, deploy workflow) up to date, so
 * workspaces created by an older Plinth get fixes. Returns build issues.
 */
export function regenerate(root) {
  const config = loadConfig(root);
  const { css, issues } = buildCss(root, config);
  const styles = join(root, "src", "styles");
  mkdirSync(styles, { recursive: true });
  writeFileSync(join(styles, "tokens.css"), css);
  writeFileSync(join(styles, "fonts.css"), fontsCss(fontsToLoad(root, config)));
  mkdirSync(join(root, "src", "icons"), { recursive: true });
  writeFileSync(join(root, "src", "icons", "index.tsx"), iconsModule(root));
  syncManaged(root);
  writeFoundationsData(root, config);
  return issues;
}

/** This Plinth's version: the deploy workflow runs `plinth check` from exactly this release. */
export const PLINTH_VERSION = JSON.parse(readFileSync(resolve(here, "..", "package.json"), "utf8")).version;

/** Files that belong to Plinth, not to the user's design: kept identical to the template. */
const MANAGED = [".github/workflows/storybook.yml", ".storybook/preview.tsx", "src/foundations", "CLAUDE.md"];
// Only for layered workspaces: older ones derive their radius scale in index.css, which the upgrade replaces.
const MANAGED_LAYERED = ["src/index.css"];
// Template files with placeholders filled in when copied.
const FILL = { ".github/workflows/storybook.yml": (text) => text.replaceAll("{{PLINTH_VERSION}}", PLINTH_VERSION) };
export function syncManaged(root, templateDir = TEMPLATE_DIR) {
  const changed = [];
  const syncFile = (rel) => {
    const src = join(templateDir, rel), dest = join(root, rel);
    if (!existsSync(src)) return;
    const want = FILL[rel] ? Buffer.from(FILL[rel](readFileSync(src, "utf8"))) : readFileSync(src);
    if (existsSync(dest) && readFileSync(dest).equals(want)) return;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, want);
    changed.push(rel);
  };
  if (removeOldDenyRules(root)) changed.push(".claude/settings.json");
  const walk = (rel) => {
    const abs = join(templateDir, rel);
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) for (const n of readdirSync(abs)) walk(`${rel}/${n}`);
    else if (!rel.endsWith(".generated.json")) syncFile(rel);
  };
  let layered = false;
  try { layered = Array.isArray(loadConfig(root).layers); } catch { /* no workspace yet */ }
  for (const rel of [...MANAGED, ...(layered ? MANAGED_LAYERED : [])]) walk(rel);
  return changed;
}

// Fixes to template files the user owns once copied (components and their stories). A file is replaced only while
// it is exactly a version Plinth shipped, so the user's own edits are never overwritten; the fix is a change Undo
// takes back. `was`: sha256 of the shipped content with LF line endings.
const TEMPLATE_FIXES = [
  { file: "src/components/toast/toast.stories.tsx", was: ["810cb871729011f6cac50bf3625bb63c583f421fe02d087c502db36854488acd"], title: "Fix the Toast test that stopped deploys on GitHub" },
  { file: "src/components/chart/chart.stories.tsx", was: ["d5a272359b622839d935fd60c3ed518df7458077131ce5d87fd418406396fc7c"], title: "Show the donut and radar charts on the All components page" },
  { file: "src/components/glass/glass.stories.tsx", was: ["c7fb53f85a43cbfc0f19337646f3cc4a2fd1b46318ebf242e06e5d9bb0698c00"], title: "Outline the white backdrop of the glass example" },
];
const lfHash = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
export function templateFixOps(root, templateDir = TEMPLATE_DIR) {
  const fixes = TEMPLATE_FIXES.filter((f) => { const cur = readText(root, f.file); return cur !== null && f.was.includes(lfHash(cur)); });
  return { title: fixes.map((f) => f.title).join("; "), ops: fixes.map((f) => ({ op: "write", file: f.file, content: readFileSync(join(templateDir, f.file), "utf8") })) };
}

// Until 0.4 Plinth shipped Claude Code deny rules that blocked direct edits to design files. Edits from anywhere
// are checked instead now (here, and by `plinth check` before every deploy), so the rules come out again. Rules the
// user added themselves stay.
const OLD_DENY_RULES = ["Edit(/tokens/**)", "Edit(/brands/**)", "Edit(/DESIGN.md)", "Edit(/WRITING.md)", "Edit(/design-system.json)", "Edit(/src/components/**)", "Edit(/src/styles/**)", "Edit(/src/foundations/**)", "Edit(/exports/**)", "Edit(/.storybook/**)", "Edit(/.github/**)", "Edit(/.claude/**)", "Edit(/.ds/**)"];
function removeOldDenyRules(root) {
  const file = join(root, ".claude", "settings.json");
  if (!existsSync(file)) return false;
  let settings;
  try { settings = JSON.parse(readFileSync(file, "utf8")); } catch { return false; }
  const deny = settings.permissions?.deny;
  if (!Array.isArray(deny)) return false;
  const kept = deny.filter((rule) => !OLD_DENY_RULES.includes(rule));
  if (kept.length === deny.length) return false;
  if (kept.length) settings.permissions.deny = kept;
  else delete settings.permissions.deny;
  if (!Object.keys(settings.permissions).length) delete settings.permissions;
  if (Object.keys(settings).length) writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  else {
    rmSync(file);
    if (!readdirSync(join(root, ".claude")).length) rmSync(join(root, ".claude"), { recursive: true });
  }
  return true;
}

/** Path of the data the Foundations pages read. */
export const FOUNDATIONS_DATA = "src/foundations/tokens.generated.json";

/**
 * Everything the Foundations pages show, computed here so Storybook only renders: tokens per brand and mode,
 * and the contrast results. Read by src/foundations/*.tsx at build time.
 */
export function writeFoundationsData(root, config = loadConfig(root)) {
  const out = join(root, FOUNDATIONS_DATA);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, foundationsData(root, config));
}

/** The Foundations data as written to src/foundations/tokens.generated.json. */
export function foundationsData(root, config = loadConfig(root)) {
  const exceptions = config.exceptions ?? [];
  const contrast = checkContrast(root, config);
  const modeName = (m) => (m === "default" ? "light" : m);
  const brands = {};
  for (const id of listBrands(root, config)) {
    const r = resolveBrand(root, id, config);
    brands[id] = {
      name: (config.brands ?? []).find((b) => (b.id ?? b) === id)?.name ?? id,
      modes: r.modes.map(modeName),
      tokens: r.tokens.filter((t) => !t.derived).map((t) => ({
        name: t.name, path: t.key, group: t.path[0], type: t.type, description: t.description || undefined, layer: t.layerId ?? null, refs: t.refs ?? [],
        values: Object.fromEntries(Object.entries(t.values).map(([m, v]) => [modeName(m), { raw: v.raw, css: v.css, resolved: v.resolved, alpha: v.alpha ?? 1 }])),
      })),
      contrast: contrast.filter((c) => c.brand === id).map((c) => ({ mode: modeName(c.mode), bg: c.bg, fg: c.fg, ratio: c.ratio, min: c.min, pass: c.pass, accepted: Boolean(acceptedBy(exceptions, "contrast", c)) })),
    };
  }
  const layers = (config.layers ?? []).map(({ id, name }) => ({ id, name: name ?? id }));
  return JSON.stringify({ name: config.name, context: config.context, defaultBrand: config.defaultBrand ?? listBrands(root, config)[0], layers, brands }, null, 2) + "\n";
}

// ---------------- token file editing ----------------
function getNode(tree, key, create) {
  let node = tree;
  for (const seg of key.split(/[/.]/)) {
    if (node[seg] === undefined) {
      if (!create) return undefined;
      node[seg] = {};
    }
    node = node[seg];
  }
  return node;
}
function deleteNode(tree, key) {
  const segs = key.split(/[/.]/);
  const parent = getNode(tree, segs.slice(0, -1).join("/"), false);
  if (parent) delete parent[segs.at(-1)];
}

function applyOp(root, op, files) {
  const rel = op.file.replace(/\\/g, "/");
  if (!EDITABLE.some((re) => re.test(rel))) throw new Error(`change may not touch ${op.file}`);
  const abs = resolve(root, rel);
  if (relative(root, abs).startsWith("..")) throw new Error(`path escapes the workspace: ${op.file}`);
  const json = () => files.get(rel) ?? (existsSync(abs) ? JSON.parse(readFileSync(abs, "utf8")) : {});

  switch (op.op) {
    case "set": { // set a token value (optionally for a mode); creates the token if missing
      const tree = json();
      // One part of a typography token (typography/display/font-family, as get_tokens lists it): write the field
      // inside the composite, never a child token the engine would not read.
      const segs = op.path.split(/[/.]/);
      const part = TYPOGRAPHY_PARTS[segs.at(-1)];
      const parent = part && getNode(tree, segs.slice(0, -1).join("/"), false);
      if (part && parent && parent.$value && typeof parent.$value === "object" && !Array.isArray(parent.$value) && op.value !== undefined) {
        const light = !op.mode || op.mode === "default" || op.mode === "light";
        if (light) parent.$value = { ...parent.$value, [part]: op.value };
        else {
          parent.$extensions ??= {};
          parent.$extensions.plinth ??= {};
          parent.$extensions.plinth.modes ??= {};
          parent.$extensions.plinth.modes[op.mode] = { ...(parent.$extensions.plinth.modes[op.mode] ?? parent.$value), [part]: op.value };
        }
        delete parent[segs.at(-1)];
        files.set(rel, tree);
        break;
      }
      const node = getNode(tree, op.path, true);
      if (op.type) node.$type = op.type;
      if (op.description !== undefined) node.$description = op.description;
      const light = !op.mode || op.mode === "default" || op.mode === "light";
      if (op.value !== undefined) {
        if (light) node.$value = op.value;
        else {
          node.$extensions ??= {};
          node.$extensions.plinth ??= {};
          node.$extensions.plinth.modes ??= {};
          node.$extensions.plinth.modes[op.mode] = op.value;
        }
      }
      // Opacity (0..1) of a color token, for this mode; 1 removes it.
      if (op.alpha !== undefined) {
        if (!("$value" in node)) throw new Error(`${op.path} needs a value before an opacity`);
        node.$extensions ??= {};
        node.$extensions.plinth ??= {};
        const ext = node.$extensions.plinth;
        const prev = ext.alpha === undefined ? {} : typeof ext.alpha === "number" ? { default: ext.alpha } : { ...ext.alpha };
        prev[light ? "default" : op.mode] = Number(op.alpha);
        const vals = Object.values(prev);
        if (vals.every((a) => a === 1)) delete ext.alpha;
        else ext.alpha = Object.keys(prev).length === 1 && prev.default !== undefined ? prev.default : prev;
        if (!Object.keys(ext).length) delete node.$extensions.plinth;
        if (node.$extensions && !Object.keys(node.$extensions).length) delete node.$extensions;
      }
      // A part inside a rounded container: { outer: "{tabs.radius}", spacing: 1, border?: 1, min?: "{radius.small}" }
      // makes its corners the container's minus the gap while radius.fit-inside is on (tokens.mjs); null removes it.
      if (op.fit !== undefined) {
        if (op.fit !== null && (typeof op.fit !== "object" || typeof op.fit.outer !== "string" || !Number.isFinite(Number(op.fit.spacing ?? 0)))) throw new Error(`${op.path}: fit needs { outer: "{…radius}", spacing: <steps> }`);
        node.$extensions ??= {};
        node.$extensions.plinth ??= {};
        if (op.fit === null) delete node.$extensions.plinth.fit;
        else node.$extensions.plinth.fit = op.fit;
        if (!Object.keys(node.$extensions.plinth).length) delete node.$extensions.plinth;
        if (!Object.keys(node.$extensions).length) delete node.$extensions;
      }
      // A glass recipe on a color token: { tintOpacity, blur, saturation, highlight, distortion } (glassRecipe keeps
      // each in range); null removes it.
      if (op.glass !== undefined) {
        if (op.glass !== null && typeof op.glass !== "object") throw new Error(`${op.path}: glass needs { tintOpacity, blur, saturation, highlight, distortion }`);
        node.$extensions ??= {};
        node.$extensions.plinth ??= {};
        if (op.glass === null) delete node.$extensions.plinth.glass;
        else node.$extensions.plinth.glass = glassRecipe(op.glass);
        if (!Object.keys(node.$extensions.plinth).length) delete node.$extensions.plinth;
        if (!Object.keys(node.$extensions).length) delete node.$extensions;
      }
      // The angle of a gradient token, in degrees: { angle }; null removes it (then it points down, 180).
      if (op.gradient !== undefined) {
        if (op.gradient !== null && (typeof op.gradient !== "object" || !Number.isFinite(Number(op.gradient.angle)))) throw new Error(`${op.path}: gradient needs { angle: <degrees> }`);
        node.$extensions ??= {};
        node.$extensions.plinth ??= {};
        if (op.gradient === null) delete node.$extensions.plinth.gradient;
        else node.$extensions.plinth.gradient = { angle: gradientAngle(op.gradient) };
        if (!Object.keys(node.$extensions.plinth).length) delete node.$extensions.plinth;
        if (!Object.keys(node.$extensions).length) delete node.$extensions;
      }
      if (!("$value" in node)) throw new Error(`${op.path} has no value: set one first`);
      files.set(rel, tree);
      break;
    }
    case "delete": {
      const tree = json();
      deleteNode(tree, op.path);
      files.set(rel, tree);
      break;
    }
    case "rename": { // move a token within the file and rewrite aliases in every token file
      const tree = json();
      const node = getNode(tree, op.path, false);
      if (!node) throw new Error(`no token ${op.path} in ${rel}`);
      deleteNode(tree, op.path);
      Object.assign(getNode(tree, op.to, true), node);
      files.set(rel, tree);
      const from = new RegExp(`\\{${op.path.replace(/[/.]/g, "[./]")}\\}`, "g");
      const to = `{${op.to.replace(/\//g, ".")}}`;
      for (const f of tokenFiles(root)) {
        const t = files.get(f) ?? JSON.parse(readFileSync(join(root, f), "utf8"));
        const before = JSON.stringify(t), after = before.replace(from, to);
        // Only files whose references change belong to this change.
        if (after !== before || files.has(f)) files.set(f, JSON.parse(after));
      }
      renameInComponents(root, op.path, op.to, node.$type, files);
      break;
    }
    case "write": { // replace a whole text file (DESIGN.md, WRITING.md, component files)
      if (typeof op.content !== "string") throw new Error("write needs content");
      files.set(rel, op.content);
      break;
    }
    case "remove": { // delete a file (a component's files, its token file); Undo brings it back
      if (!existsSync(abs) && !files.has(rel)) throw new Error(`no file ${rel}`);
      files.set(rel, null);
      break;
    }
    default:
      throw new Error(`unknown op ${op.op}`);
  }
}

/**
 * A renamed token changes its CSS variable and every utility built on it (bg-primary, text-primary/80,
 * rounded-card, shadow-overlay …). Rewrite them in component files so the rename is one reviewed change.
 */
function renameInComponents(root, fromPath, toPath, type, files) {
  const config = loadConfig(root);
  const mk = (key) => ({ key, path: key.split("/"), type: type ?? "color" });
  const oldName = cssName(mk(fromPath), config);
  const newName = cssName(mk(toPath), config);
  if (oldName === newName) return;
  const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // "<utility>-NAME" at a token boundary (not NAME-foreground), plus var(--NAME).
  const utility = new RegExp(`(?<=[a-z0-9]-)${esc}(?![\\w-])`, "g");
  const variable = new RegExp(`var\\(--${esc}\\)`, "g");
  const dir = join(root, "src", "components");
  if (!existsSync(dir)) return;
  for (const comp of readdirSync(dir)) {
    const folder = join(dir, comp);
    if (!statSync(folder).isDirectory()) continue;
    for (const file of readdirSync(folder)) {
      if (!/\.(tsx|ts|jsx|js|css|mdx)$/.test(file)) continue;
      const rel = `src/components/${comp}/${file}`;
      const text = files.get(rel) ?? readFileSync(join(root, rel), "utf8");
      const next = text.replace(utility, newName).replace(variable, `var(--${newName})`);
      if (next !== text) files.set(rel, next);
    }
  }
}

export function tokenFiles(root) {
  const out = [];
  if (existsSync(join(root, "tokens"))) for (const f of readdirSync(join(root, "tokens"))) if (f.endsWith(".json")) out.push(`tokens/${f}`);
  for (const sub of ["components", "layers"]) {
    const dir = join(root, "tokens", sub);
    if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith(".json")) out.push(`tokens/${sub}/${f}`);
  }
  if (existsSync(join(root, "brands"))) for (const b of readdirSync(join(root, "brands"))) if (existsSync(join(root, "brands", b, "tokens.json"))) out.push(`brands/${b}/tokens.json`);
  return out;
}

// null content is a removed file.
const serialize = (content) => (content === null ? null : typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
function writeFiles(root, files) {
  for (const [rel, content] of files) {
    const abs = join(root, rel);
    if (content === null) { rmSync(abs, { force: true }); continue; }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, serialize(content));
  }
}

// ---------------- changes ----------------
// A change is written at once. What each file held before is kept in .ds/undo.json (never committed), newest last,
// so changes can be undone one by one until the user saves a version or restores one.
const undoPath = (root) => join(root, ".ds", "undo.json");
const UNDO_LIMIT = 50;
function undoStack(root) {
  try { return JSON.parse(readFileSync(undoPath(root), "utf8")); } catch { return []; }
}
function saveUndo(root, list) {
  mkdirSync(join(root, ".ds"), { recursive: true });
  writeFileSync(undoPath(root), JSON.stringify(list.slice(-UNDO_LIMIT)) + "\n");
}
export function clearUndo(root) { rmSync(undoPath(root), { force: true }); }
/** The change Undo would take back, or null. */
export function lastChange(root) {
  const last = undoStack(root).at(-1);
  return last ? { title: last.title, by: last.by, at: last.at, files: last.files.map((f) => f.file) } : null;
}

/** Write files as one undoable change. */
function writeChange(root, { title, by }, files) {
  const entry = { title, by, at: new Date().toISOString(), files: [] };
  for (const [rel, content] of files) entry.files.push({ file: rel, before: readText(root, rel), after: serialize(content) });
  writeFiles(root, files);
  saveUndo(root, [...undoStack(root), entry]);
}

/**
 * Make a change: validate the ops, write them at once, regenerate the CSS and fonts. Writes nothing when an op is
 * invalid or when the change would break token references (an alias to nothing, a cycle); everything else is a
 * reminder in the result: contrast before → after, look-alike roles, guideline prose that still names an old hue.
 */
export function change(root, { title, ops, by = "claude" }) {
  if (!title || !Array.isArray(ops) || !ops.length) throw new Error("a change needs a title and at least one op");
  const files = new Map();
  for (const op of ops) applyOp(root, op, files);
  // Picking the value a token already has: nothing to write, nothing to undo.
  for (const [rel, content] of files) if (readText(root, rel) === serialize(content)) files.delete(rel);
  if (!files.size) return { title, files: [], unchanged: true, reminders: { contrastFailing: [], contrastFixed: [], lookAlike: [], guidelineNotes: [] } };
  const preview = previewOps(root, ops);
  const known = new Set(buildCss(root).issues);
  const broken = preview.issues.filter((i) => !known.has(i));
  if (broken.length) throw new Error(`Nothing was written: this change would break token references (${broken.slice(0, 3).join("; ")}${broken.length > 3 ? "; …" : ""}).`);
  writeChange(root, { title, by }, files);
  regenerate(root);
  return { title, files: [...files.keys()], reminders: reminders(preview) };
}

/** What a preview reports, as reminders: nothing here stops a change. */
function reminders(p) {
  return {
    contrastFailing: p.contrastChanges.filter((x) => !x.pass && !x.accepted).map(({ brand, mode, bg, fg, before, ratio, min }) => ({ brand, mode, fg, bg, before, after: ratio, min })),
    contrastFixed: p.contrastChanges.filter((x) => x.pass && x.before !== null && x.before < x.min).map(({ brand, mode, bg, fg, before, ratio }) => ({ brand, mode, fg, bg, before, after: ratio })),
    lookAlike: (p.distinctFailures ?? []).map(({ brand, mode, a, b, reason }) => ({ brand, mode, a, b, reason })),
    guidelineNotes: p.notes ?? [],
  };
}

/**
 * Take back the newest change. Refuses when one of its files was edited since (by hand or another tool), so an
 * undo never throws away work it did not make.
 */
export function undo(root) {
  const list = undoStack(root);
  const last = list.at(-1);
  if (!last) throw new Error("Nothing to undo.");
  const touched = last.files.filter((f) => (readText(root, f.file) ?? null) !== f.after);
  if (touched.length) throw new Error(`${touched.map((f) => f.file).join(", ")} changed after "${last.title}". Undo would overwrite that edit; change it back yourself or restore a version.`);
  for (const f of last.files) {
    if (f.before === null || f.before === undefined) rmSync(join(root, f.file), { force: true });
    else { mkdirSync(dirname(join(root, f.file)), { recursive: true }); writeFileSync(join(root, f.file), f.before); }
  }
  saveUndo(root, list.slice(0, -1));
  regenerate(root);
  return { undone: last.title, files: last.files.map((f) => f.file) };
}

/**
 * Dry-run ops in a scratch copy and report what the change does to the checks: contrast before → after,
 * role colors that would stop being distinguishable, and guideline prose that still names the old hue.
 * Throws on invalid ops.
 */
export function previewOps(root, ops) {
  const scratch = mkdtempSync(join(tmpdir(), "ds-preview-"));
  try {
    for (const f of ["design-system.json", "tokens", "brands", "src/components", "DESIGN.md"]) if (existsSync(join(root, f))) { if (statSync(join(root, f)).isDirectory()) copyDir(join(root, f), join(scratch, f)); else copyFileSync(join(root, f), join(scratch, f)); }
    const files = new Map();
    for (const op of ops) applyOp(scratch, op, files);
    const exceptions = loadConfig(scratch).exceptions ?? [];
    const before = checkContrast(scratch);
    const rolesBefore = roleColors(scratch);
    writeFiles(scratch, files);
    const after = checkContrast(scratch);
    const prev = new Map(before.map((r) => [exceptionKey.contrast(r), r]));
    const contrastChanges = after
      .filter((r) => { const p = prev.get(exceptionKey.contrast(r)); return !p || p.ratio !== r.ratio; })
      .map((r) => ({ ...r, before: prev.get(exceptionKey.contrast(r))?.ratio ?? null, accepted: Boolean(acceptedBy(exceptions, "contrast", r)) }));
    const distinctFailures = checkDistinct(scratch).filter((r) => !r.pass && !acceptedBy(exceptions, "distinct", r));
    const { issues } = buildCss(scratch);
    return {
      files: [...files.keys()],
      contrastChanges,
      failingAfter: after.filter((r) => !r.pass && !acceptedBy(exceptions, "contrast", r)).length,
      distinctFailures,
      notes: proseNotes(scratch, rolesBefore, roleColors(scratch), files),
      issues,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Generated or Plinth-managed paths: not what a reviewer needs to read.
const NOT_REVIEWED = /^(src\/styles\/|src\/foundations\/|exports\/|\.github\/|\.storybook\/|\.claude\/|CLAUDE\.md$|src\/index\.css$|package-lock\.json$)/;

/**
 * Everything that changed since `base` (default: the last published version, else the first version), unsaved work
 * included, for the review at publish: every token whose value differs, per brand and mode, before → after as written
 * (a reference like {color.red.700} or a fixed value) and as resolved; and the other files that changed.
 */
export function changesSince(root, base = publishedRef(root)) {
  const ref = base ?? git(root, ["rev-list", "--max-parents=0", "HEAD"]).split("\n")[0];
  const scratch = mkdtempSync(join(tmpdir(), "ds-since-"));
  try {
    const listed = git(root, ["ls-tree", "-r", "--name-only", ref, "--", "design-system.json", "tokens", "brands"]).split("\n").filter(Boolean);
    for (const f of listed) {
      mkdirSync(dirname(join(scratch, f)), { recursive: true });
      writeFileSync(join(scratch, f), execFileSync("git", ["show", `${ref}:${f}`], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }));
    }
    const resolveAll = (dir) => {
      const out = new Map();
      let config;
      try { config = loadConfig(dir); } catch { return out; }
      for (const brand of listBrands(dir, config)) {
        try { for (const t of resolveBrand(dir, brand, config).tokens) if (!t.derived) out.set(`${brand}|${t.key}`, { brand, t }); } catch { /* unresolvable brand */ }
      }
      return out;
    };
    const before = resolveAll(scratch), after = resolveAll(root);
    const rows = [];
    const follows = new Set(); // tokens whose own value is unchanged but that point at one that changed
    const value = (v) => (v ? { value: v.raw, resolved: v.resolved, alpha: v.alpha } : null);
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const b = before.get(key)?.t, a = after.get(key)?.t;
      const brand = (before.get(key) ?? after.get(key)).brand;
      for (const mode of new Set([...Object.keys(b?.values ?? {}), ...Object.keys(a?.values ?? {})])) {
        const vb = value(b?.values[mode]), va = value(a?.values[mode]);
        if (JSON.stringify(vb) === JSON.stringify(va)) continue;
        if (vb && va && JSON.stringify(vb.value) === JSON.stringify(va.value) && vb.alpha === va.alpha) { follows.add((a ?? b).name); continue; }
        rows.push({ token: (a ?? b).name, path: (a ?? b).key, brand, mode: mode === "default" ? "light" : mode, layer: (a ?? b).layerId ?? null, before: vb, after: va });
      }
    }
    // Shared tokens are the same in every brand: one row is enough when nothing differs.
    const seen = new Set();
    const tokens = rows.filter((r) => { const k = `${r.path}|${r.mode}|${JSON.stringify(r.before)}|${JSON.stringify(r.after)}`; return !seen.has(k) && seen.add(k); });
    const files = new Map();
    for (const line of git(root, ["diff", "--name-status", ref, "--"]).split("\n").filter(Boolean)) {
      const [status, ...names] = line.split("\t");
      files.set(names.at(-1), status[0] === "D" ? "deleted" : status[0] === "A" ? "added" : "modified");
    }
    for (const c of unsavedChanges(root)) if (c.status === "added") files.set(c.file, "added");
    const other = [...files].filter(([f]) => !NOT_REVIEWED.test(f) && !/^(tokens\/|brands\/[^/]+\/tokens\.json$|design-system\.json$)/.test(f)).map(([file, status]) => ({ file, status }));
    return { since: base ? git(root, ["rev-parse", "--short", ref]) : "the first version", tokens: tokens.slice(0, 300), tokensChanged: tokens.length, followTheseChanges: { count: follows.size, tokens: [...follows].slice(0, 40) }, files: other };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Resolved light and dark color of every role (not palette, not component tokens), per brand. */
function roleColors(root) {
  const config = loadConfig(root);
  const out = new Map();
  for (const brand of listBrands(root, config)) {
    for (const t of resolveBrand(root, brand, config).tokens) {
      if (t.type !== "color" || t.layerId === "primitives" || t.layerId === "components" || t.derived) continue;
      for (const [mode, v] of Object.entries(t.values)) out.set(`${brand}|${t.key}|${mode}`, { brand, name: t.name, mode, value: v.resolved });
    }
  }
  return out;
}

/**
 * A role whose color moved to another hue family (directly, or through the palette step it points at) while a
 * DESIGN.md still describes the old one, and this change does not rewrite that file. Claude is expected to add
 * the rewrite to the same change.
 */
function proseNotes(root, before, after, files) {
  const notes = new Set();
  for (const [key, b] of before) {
    const a = after.get(key);
    if (!a || b.mode !== "default") continue; // the light value is what prose describes
    const oldFamily = hueFamily(b.value), newFamily = hueFamily(a.value);
    if (!oldFamily || !newFamily || oldFamily === newFamily) continue;
    for (const doc of [`brands/${b.brand}/DESIGN.md`, "DESIGN.md"]) {
      if (files.has(doc)) continue;
      for (const m of staleMentions(readText(root, doc), oldFamily, newFamily).slice(0, 3)) {
        notes.add(`${doc}${m.section ? ` (${m.section})` : ""} still says "${m.word}" but ${b.name} is now ${newFamily}: "${m.line}". Update the prose in this change.`);
      }
    }
  }
  return [...notes];
}

// ---------------- exceptions ----------------
/**
 * The user accepts a failing check on purpose (PRD: "退回，或明確選擇接受並記錄例外"). Recorded in
 * design-system.json so publish shows it; a change like any other (undoable, saved with the next version).
 */
export function acceptException(root, { check, key, reason = "" }) {
  if (!exceptionKey[check]) throw new Error(`unknown check ${check}`);
  if (!key || !/^[^|]+(\|[^|]+)+$/.test(key)) throw new Error("exception needs a key like brand|mode|bg|fg (segments may be *)");
  const cfg = JSON.parse(readFileSync(join(root, "design-system.json"), "utf8"));
  cfg.exceptions = (cfg.exceptions ?? []).filter((e) => !(e.check === check && e.key === key));
  cfg.exceptions.push({ check, key, reason, at: new Date().toISOString() });
  writeChange(root, { title: `Accept exception: ${check} ${key}${reason ? ` (${reason})` : ""}`, by: "you" }, new Map([["design-system.json", cfg]]));
  regenerate(root);
  return { accepted: key };
}
export function removeException(root, { check, key }) {
  const cfg = JSON.parse(readFileSync(join(root, "design-system.json"), "utf8"));
  cfg.exceptions = (cfg.exceptions ?? []).filter((e) => !(e.check === check && e.key === key));
  writeChange(root, { title: `Remove exception: ${check} ${key}`, by: "you" }, new Map([["design-system.json", cfg]]));
  regenerate(root);
  return { removed: key };
}

// ---------------- reading ----------------
export function readText(root, rel) {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

/** Components = folders under src/components with a <name>.tsx; spec and stories are optional. */
export function listComponents(root) {
  const dir = join(root, "src", "components");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => statSync(join(dir, n)).isDirectory() && existsSync(join(dir, n, `${n}.tsx`)))
    .map((n) => ({
      id: n,
      files: readdirSync(join(dir, n)),
      hasStories: existsSync(join(dir, n, `${n}.stories.tsx`)),
      spec: readText(root, `src/components/${n}/${n}.spec.md`),
      usedBy: componentUsers(root, n),
    }));
}

/** Components the template ships: the catalog. Each is copied as-is; its looks come from tokens. */
export function catalogComponents(templateDir = TEMPLATE_DIR) {
  return listComponents(templateDir).map((c) => c.id);
}

// What a design system is made of (what starting from scratch replaces); the rest (dependencies, settings, the
// managed and generated files) stays or is regenerated.
const DESIGN_PATHS = ["tokens", "brands", "src/components", "icons", "DESIGN.md", "WRITING.md", "design-system.json"];
/**
 * Ops that put the design system back to a fresh one, as Create makes it before any answer: the template's tokens,
 * guidelines and core components, one brand (the current default), no answers. One change, so Undo brings it all
 * back. skipComponents: catalog components a fresh design system leaves out (all but the core ones).
 */
export function scratchOps(root, { skipComponents = [], templateDir = TEMPLATE_DIR } = {}) {
  const config = loadConfig(root);
  const brand = config.defaultBrand ?? listBrands(root, config)[0] ?? "default";
  const fresh = mkdtempSync(join(tmpdir(), "plinth-scratch-"));
  try {
    initWorkspace(fresh, { name: config.name ?? "my-design-system", brand, context: config.context, naming: config.naming, templateDir, skipComponents });
    const files = (base) => {
      const out = [];
      const walk = (rel) => {
        const abs = join(base, rel);
        if (!existsSync(abs)) return;
        if (statSync(abs).isDirectory()) for (const n of readdirSync(abs)) walk(`${rel}/${n}`);
        else out.push(rel);
      };
      for (const p of DESIGN_PATHS) walk(p);
      return out;
    };
    const want = new Set(files(fresh));
    const ops = [];
    for (const f of want) {
      const content = readFileSync(join(fresh, f), "utf8");
      if (readText(root, f) !== content) ops.push({ op: "write", file: f, content });
    }
    for (const f of files(root)) if (!want.has(f)) ops.push({ op: "remove", file: f });
    return ops;
  } finally {
    rmSync(fresh, { recursive: true, force: true });
  }
}

/**
 * Ops that add a catalog component to a workspace: its folder, its token file, the icons it uses, and any base
 * roles it needs that an older workspace lacks (small corners, motion, stacking order). One undoable change.
 */
export function catalogComponentOps(root, id, templateDir = TEMPLATE_DIR) {
  if (!catalogComponents(templateDir).includes(id)) throw new Error(`${id} is not in the component catalog. Ask Claude to write it.`);
  if (existsSync(join(root, "src", "components", id, `${id}.tsx`))) throw new Error(`${id} is already in this design system.`);
  const ops = [];
  const dir = join(templateDir, "src", "components", id);
  const icons = new Set();
  for (const f of readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile())) {
    const content = readFileSync(join(dir, f), "utf8");
    ops.push({ op: "write", file: `src/components/${id}/${f}`, content });
    for (const m of content.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@\/icons["']/g)) {
      for (const name of m[1].split(",").map((s) => s.trim()).filter(Boolean)) icons.add(name.replace(/Icon$/, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Za-z])(\d)/g, "$1-$2").toLowerCase());
    }
  }
  const tokens = join(templateDir, "tokens", "components", `${id}.tokens.json`);
  if (existsSync(tokens)) ops.push({ op: "write", file: `tokens/components/${id}.tokens.json`, content: readFileSync(tokens, "utf8") });
  for (const name of icons) {
    const from = join(templateDir, "icons", `${name}.svg`);
    if (existsSync(from) && !existsSync(join(root, "icons", `${name}.svg`))) ops.push({ op: "write", file: `icons/${name}.svg`, content: readFileSync(from, "utf8") });
  }
  // Base roles added after a workspace was made: copy the template's, so references and CSS variables resolve.
  const base = JSON.parse(readFileSync(join(root, "tokens", "base.tokens.json"), "utf8"));
  const tpl = JSON.parse(readFileSync(join(templateDir, "tokens", "base.tokens.json"), "utf8"));
  const missing = [];
  if (tpl.radius?.small && !base.radius?.small) missing.push(["radius/small", tpl.radius.small, "dimension"]);
  if (tpl.radius?.["fit-inside"] && !base.radius?.["fit-inside"]) missing.push(["radius/fit-inside", tpl.radius["fit-inside"], "number"]);
  // The glass material (with its recipe) for the Glass component.
  if (tpl.material && !base.material?.glass && existsSync(tokens) && readFileSync(tokens, "utf8").includes("{material.glass")) {
    for (const k of ["glass", "glass-foreground"]) if (tpl.material[k]) ops.push({ op: "set", file: "tokens/base.tokens.json", path: `material/${k}`, value: tpl.material[k].$value, type: "color", description: tpl.material[k].$description, ...(tpl.material[k].$extensions?.plinth?.glass ? { glass: tpl.material[k].$extensions.plinth.glass } : {}) });
  }
  for (const group of ["duration", "layer"]) if (tpl[group] && !base[group]) for (const [k, v] of Object.entries(tpl[group])) if (!k.startsWith("$")) missing.push([`${group}/${k}`, v, tpl[group].$type]);
  for (const k of ["enter", "exit"]) if (tpl.ease?.[k] && !base.ease?.[k]) missing.push([`ease/${k}`, tpl.ease[k], "cubicBezier"]);
  for (const [path, t, type] of missing) ops.push({ op: "set", file: "tokens/base.tokens.json", path, value: t.$value, type, ...(t.$description ? { description: t.$description } : {}) });
  // Chart colors, made from this design system's palette, in each brand that lacks them.
  if (existsSync(tokens) && readFileSync(tokens, "utf8").includes("\"chart\"")) {
    const config = loadConfig(root);
    for (const brand of listBrands(root, config)) {
      const own = JSON.parse(readFileSync(join(root, "brands", brand, "tokens.json"), "utf8"));
      if (!own.color?.chart) ops.push(...chartOps(root, brand));
    }
  }
  return ops;
}

/**
 * npm packages a catalog component imports that this design system's package.json lacks, at the template's version:
 * { recharts: "^3.8.0" }. Design systems made before the component shipped need them.
 */
export function missingPackages(root, id, templateDir = TEMPLATE_DIR) {
  const tpl = JSON.parse(readFileSync(join(templateDir, "package.json"), "utf8"));
  const mine = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const have = { ...mine.dependencies, ...mine.devDependencies };
  const out = {};
  const dir = join(templateDir, "src", "components", id);
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/from\s+["']([^"'.@][^"']*|@[^/"']+\/[^/"']+)["']/g)) {
      const name = m[1].startsWith("@") ? m[1] : m[1].split("/")[0];
      if (!have[name] && tpl.dependencies?.[name]) out[name] = tpl.dependencies[name];
    }
  }
  return out;
}

/** Add packages to package.json (dependencies, sorted); installing them is the caller's (npm install). */
export function addPackages(root, pkgs) {
  if (!Object.keys(pkgs).length) return false;
  const file = join(root, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.dependencies = Object.fromEntries(Object.entries({ ...pkg.dependencies, ...pkgs }).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  return true;
}

/** Source files outside a component's folder that import it (the Foundations pages, the app shell, other components). */
export function componentUsers(root, id) {
  const src = join(root, "src");
  if (!existsSync(src)) return [];
  const pattern = new RegExp(`["'](@/components/${id}/|\\.\\./${id}/)`);
  const out = [];
  const walkDir = (abs, rel) => {
    for (const f of readdirSync(abs)) {
      const a = join(abs, f), r = `${rel}/${f}`;
      if (statSync(a).isDirectory()) { if (r !== `src/components/${id}`) walkDir(a, r); }
      else if (/\.(tsx?|mdx)$/.test(f) && pattern.test(readFileSync(a, "utf8"))) out.push(r);
    }
  };
  walkDir(src, "src");
  return out.sort();
}

/**
 * Ops that remove a component: every file in its folder and its token file, as one change Undo can take back.
 * Refuses a component other code imports, since removing it would break the build.
 */
export function removeComponentOps(root, id) {
  if (!/^[a-z0-9-]+$/.test(String(id))) throw new Error(`not a component name: ${id}`);
  const dir = join(root, "src", "components", id);
  if (!existsSync(join(dir, `${id}.tsx`))) throw new Error(`no component ${id}`);
  const users = componentUsers(root, id);
  if (users.length) throw new Error(`${id} is used by ${users.join(", ")}; removing it would break the build.`);
  const ops = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()).map((f) => ({ op: "remove", file: `src/components/${id}/${f}` }));
  if (existsSync(join(root, "tokens", "components", `${id}.tokens.json`))) ops.push({ op: "remove", file: `tokens/components/${id}.tokens.json` });
  return ops;
}

export function summary(root) {
  const config = loadConfig(root);
  return { root: root.split(sep).join("/"), config, brands: listBrands(root, config), components: listComponents(root).map((c) => c.id), unsaved: unsavedChanges(root).length, lastChange: lastChange(root), versions: versions(root, 5) };
}
