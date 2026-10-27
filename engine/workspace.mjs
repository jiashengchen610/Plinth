// Workspace operations: scaffold from the template, edit token files, keep a queue of proposed
// changes, apply them as git commits, list versions and restore any of them. Zero dependencies
// (shells out to git).
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync, mkdtempSync, readdirSync, statSync, renameSync } from "node:fs";
import { join, resolve, relative, dirname, sep } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildCss, loadConfig, listBrands, resolveBrand, cssName } from "./tokens.mjs";
import { checkContrast, checkDistinct, exceptionKey, acceptedBy } from "./checks.mjs";
import { fontsToLoad, fontsCss } from "./fonts.mjs";
import { hueFamily, staleMentions } from "./prose.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_DIR = resolve(here, "..", "template");

// Files a change may touch. Anything else is refused.
const EDITABLE = [/^tokens\/[^/]+\.json$/, /^brands\/[a-z0-9-]+\/(tokens\.json|DESIGN\.md|WRITING\.md)$/, /^(DESIGN|WRITING)\.md$/, /^design-system\.json$/, /^src\/components\/[a-z0-9-]+\/[^/]+$/];

// ---------------- git ----------------
export function git(root, args, opts = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}
function gitCommit(root, message) {
  git(root, ["add", "-A"]);
  const dirty = git(root, ["status", "--porcelain"]);
  if (!dirty) return null;
  git(root, ["-c", "user.name=Design System", "-c", "user.email=design-system@localhost", "commit", "-q", "-m", message]);
  return git(root, ["rev-parse", "--short", "HEAD"]);
}

export function versions(root, limit = 50) {
  if (!existsSync(join(root, ".git"))) return [];
  const out = git(root, ["log", `-${limit}`, "--pretty=format:%h%x1f%H%x1f%cI%x1f%s"]);
  return out ? out.split("\n").map((l) => { const [short, sha, date, subject] = l.split("\x1f"); return { short, sha, date, subject }; }) : [];
}

/** Restore the working tree to a previous version as a NEW commit (history is never rewritten). */
export function restore(root, sha) {
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) throw new Error("invalid version id");
  git(root, ["rev-parse", "--verify", `${sha}^{commit}`]);
  git(root, ["checkout", sha, "--", "."]);
  // Files added after that version still exist: remove those that the target version does not track.
  const tracked = new Set(git(root, ["ls-tree", "-r", "--name-only", sha]).split("\n"));
  for (const f of git(root, ["ls-files"]).split("\n").filter(Boolean)) if (!tracked.has(f)) rmSync(join(root, f), { force: true });
  regenerate(root);
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
export function initWorkspace(root, { name = "my-design-system", brand = "default", context = "saas-dashboard", naming = "shadcn", templateDir = TEMPLATE_DIR } = {}) {
  if (existsSync(join(root, "design-system.json"))) throw new Error(`${root} already contains a design system`);
  mkdirSync(root, { recursive: true });
  // Hidden entries (.git, .claude, .mcp.json, .vscode …) are editor or tool settings, not content.
  const nonEmpty = readdirSync(root).filter((f) => !f.startsWith(".")).length > 0;
  if (nonEmpty) throw new Error(`${root} is not empty`);
  if (!existsSync(join(templateDir, "design-system.json"))) throw new Error(`template not found at ${templateDir}`);
  // Filter on the path inside the template: the install itself may live under a node_modules folder (npx).
  const skip = /(^|[\\/])(node_modules|storybook-static|dist)([\\/]|$)/;
  copyDir(templateDir, root, (rel) => skip.test(rel));
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
  syncManaged(root);
  writeFoundationsData(root, config);
  return issues;
}

/** Files that belong to Plinth, not to the user's design: kept identical to the template. */
const MANAGED = [".github/workflows/storybook.yml", ".storybook/preview.tsx", "src/foundations"];
export function syncManaged(root, templateDir = TEMPLATE_DIR) {
  const changed = [];
  const syncFile = (rel) => {
    const src = join(templateDir, rel), dest = join(root, rel);
    if (!existsSync(src)) return;
    if (existsSync(dest) && readFileSync(dest).equals(readFileSync(src))) return;
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    changed.push(rel);
  };
  const walk = (rel) => {
    const abs = join(templateDir, rel);
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) for (const n of readdirSync(abs)) walk(`${rel}/${n}`);
    else if (!rel.endsWith(".generated.json")) syncFile(rel);
  };
  for (const rel of MANAGED) walk(rel);
  return changed;
}

/**
 * Everything the Foundations pages show, computed here so Storybook only renders: tokens per brand and mode,
 * and the contrast results. Read by src/foundations/*.tsx at build time.
 */
export function writeFoundationsData(root, config = loadConfig(root)) {
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
        name: t.name, path: t.key, group: t.path[0], type: t.type, description: t.description || undefined,
        values: Object.fromEntries(Object.entries(t.values).map(([m, v]) => [modeName(m), { raw: v.raw, css: v.css, resolved: v.resolved }])),
      })),
      contrast: contrast.filter((c) => c.brand === id).map((c) => ({ mode: modeName(c.mode), bg: c.bg, fg: c.fg, ratio: c.ratio, min: c.min, pass: c.pass, accepted: Boolean(acceptedBy(exceptions, "contrast", c)) })),
    };
  }
  const out = join(root, "src", "foundations", "tokens.generated.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ name: config.name, context: config.context, defaultBrand: config.defaultBrand ?? listBrands(root, config)[0], brands }, null, 2) + "\n");
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
      const node = getNode(tree, op.path, true);
      if (op.type) node.$type = op.type;
      if (op.description !== undefined) node.$description = op.description;
      if (!op.mode || op.mode === "default" || op.mode === "light") node.$value = op.value;
      else {
        node.$extensions ??= {};
        node.$extensions.plinth ??= {};
        node.$extensions.plinth.modes ??= {};
        node.$extensions.plinth.modes[op.mode] = op.value;
      }
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
        files.set(f, JSON.parse(JSON.stringify(t).replace(from, to)));
      }
      renameInComponents(root, op.path, op.to, node.$type, files);
      break;
    }
    case "write": { // replace a whole text file (DESIGN.md, WRITING.md, component files)
      if (typeof op.content !== "string") throw new Error("write needs content");
      files.set(rel, op.content);
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
  if (existsSync(join(root, "brands"))) for (const b of readdirSync(join(root, "brands"))) if (existsSync(join(root, "brands", b, "tokens.json"))) out.push(`brands/${b}/tokens.json`);
  return out;
}

function writeFiles(root, files) {
  for (const [rel, content] of files) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
  }
}

// ---------------- proposed changes ----------------
const pendingPath = (root) => join(root, ".ds", "pending.json");
export function listPending(root) {
  return existsSync(pendingPath(root)) ? JSON.parse(readFileSync(pendingPath(root), "utf8")) : [];
}
function savePending(root, list) {
  mkdirSync(join(root, ".ds"), { recursive: true });
  writeFileSync(pendingPath(root), JSON.stringify(list, null, 2) + "\n");
}

/**
 * Dry-run ops in a scratch copy and report what the change does to the checks: contrast before → after,
 * role colors that would stop being distinguishable, and guideline prose that still names the old hue.
 * Throws on invalid ops.
 */
export function previewOps(root, ops) {
  const files = new Map();
  for (const op of ops) applyOp(root, op, files);
  const scratch = mkdtempSync(join(tmpdir(), "ds-preview-"));
  try {
    for (const f of ["design-system.json", "tokens", "brands"]) if (existsSync(join(root, f))) { if (statSync(join(root, f)).isDirectory()) copyDir(join(root, f), join(scratch, f)); else copyFileSync(join(root, f), join(scratch, f)); }
    writeFiles(scratch, files);
    const exceptions = loadConfig(root).exceptions ?? [];
    const before = checkContrast(root);
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
      notes: proseNotes(root, ops, files),
      issues,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * A color token that moved to another hue family while a DESIGN.md still describes the old one, and this
 * change does not rewrite that file. Claude is expected to add the rewrite to the same change.
 */
function proseNotes(root, ops, files) {
  const notes = [];
  const config = loadConfig(root);
  for (const op of ops) {
    if (op.op !== "set" || typeof op.value !== "string") continue;
    const brandOf = op.file.match(/^brands\/([^/]+)\//)?.[1];
    const brands = brandOf ? [brandOf] : listBrands(root, config);
    for (const brand of brands) {
      const was = resolveBrand(root, brand, config).tokens.find((t) => t.key === op.path);
      if (!was || was.type !== "color") continue;
      const mode = !op.mode || op.mode === "light" ? "default" : op.mode;
      const oldFamily = hueFamily(was.values[mode]?.resolved ?? was.values.default?.resolved);
      const newFamily = hueFamily(op.value);
      if (!oldFamily || !newFamily || oldFamily === newFamily) continue;
      for (const doc of [`brands/${brand}/DESIGN.md`, "DESIGN.md"]) {
        if (files.has(doc)) continue;
        for (const m of staleMentions(readText(root, doc), oldFamily, newFamily).slice(0, 3)) {
          notes.push(`${doc}${m.section ? ` (${m.section})` : ""} still says "${m.word}" but ${was.name} is now ${newFamily}: "${m.line}". Update the prose in this change.`);
        }
      }
    }
  }
  return [...new Set(notes)];
}

/** Queue a change for the user to review. */
export function propose(root, { title, ops, rationale = "", by = "claude" }) {
  if (!title || !Array.isArray(ops) || !ops.length) throw new Error("a change needs a title and at least one op");
  const preview = previewOps(root, ops);
  const change = { id: randomUUID().slice(0, 8), title, rationale, by, createdAt: new Date().toISOString(), ops, preview };
  savePending(root, [...listPending(root), change]);
  return change;
}

export function discard(root, id) {
  const list = listPending(root);
  if (!list.some((c) => c.id === id)) throw new Error(`no pending change ${id}`);
  savePending(root, list.filter((c) => c.id !== id));
}

/** Apply a pending change (or raw ops), regenerate, commit. Returns the new version. */
export function apply(root, idOrChange) {
  const list = listPending(root);
  const change = typeof idOrChange === "string" ? list.find((c) => c.id === idOrChange) : idOrChange;
  if (!change) throw new Error(`no pending change ${idOrChange}`);
  const files = new Map();
  for (const op of change.ops) applyOp(root, op, files);
  writeFiles(root, files);
  const issues = regenerate(root);
  const sha = gitCommit(root, change.title);
  if (typeof idOrChange === "string") savePending(root, list.filter((c) => c.id !== change.id));
  return { version: sha, issues };
}

// ---------------- exceptions ----------------
/**
 * The user accepts a failing check on purpose (PRD: "退回，或明確選擇接受並記錄例外"). Recorded in
 * design-system.json so publish shows it; one commit, no review step since the user is the reviewer.
 */
export function acceptException(root, { check, key, reason = "" }) {
  if (!exceptionKey[check]) throw new Error(`unknown check ${check}`);
  if (!key || !/^[^|]+(\|[^|]+)+$/.test(key)) throw new Error("exception needs a key like brand|mode|bg|fg (segments may be *)");
  const cfgPath = join(root, "design-system.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg.exceptions = (cfg.exceptions ?? []).filter((e) => !(e.check === check && e.key === key));
  cfg.exceptions.push({ check, key, reason, at: new Date().toISOString() });
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  return gitCommit(root, `Accept exception: ${check} ${key}${reason ? ` (${reason})` : ""}`);
}
export function removeException(root, { check, key }) {
  const cfgPath = join(root, "design-system.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg.exceptions = (cfg.exceptions ?? []).filter((e) => !(e.check === check && e.key === key));
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  return gitCommit(root, `Remove exception: ${check} ${key}`);
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
    }));
}

export function summary(root) {
  const config = loadConfig(root);
  return { root: root.split(sep).join("/"), config, brands: listBrands(root, config), components: listComponents(root).map((c) => c.id), pending: listPending(root).length, versions: versions(root, 5) };
}
