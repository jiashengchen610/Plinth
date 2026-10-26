// Workspace operations: scaffold from the template, edit token files, keep a queue of proposed
// changes, apply them as git commits, list versions and restore any of them. Zero dependencies
// (shells out to git).
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, dirname, sep } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildCss, loadConfig, listBrands } from "./tokens.mjs";
import { checkContrast } from "./checks.mjs";

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
 * Create a new workspace from the template. `brand` becomes the first brand id.
 * Does not install dependencies (see installDependencies).
 */
export function initWorkspace(root, { name = "my-design-system", brand = "default", context = "saas-dashboard", naming = "shadcn" } = {}) {
  if (existsSync(join(root, "design-system.json"))) throw new Error(`${root} already contains a design system`);
  mkdirSync(root, { recursive: true });
  const nonEmpty = readdirSync(root).filter((f) => f !== ".git").length > 0;
  if (nonEmpty) throw new Error(`${root} is not empty`);
  cpSync(TEMPLATE_DIR, root, { recursive: true, filter: (src) => !/node_modules|storybook-static|[\\/]dist([\\/]|$)/.test(src) });
  if (brand !== "default") {
    cpSync(join(root, "brands", "default"), join(root, "brands", brand), { recursive: true });
    rmSync(join(root, "brands", "default"), { recursive: true, force: true });
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

/** Regenerate derived files (the token stylesheet). Returns build issues. */
export function regenerate(root) {
  const { css, issues } = buildCss(root);
  const out = join(root, "src", "styles", "tokens.css");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, css);
  return issues;
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
        node.$extensions["ds-skills"] ??= {};
        node.$extensions["ds-skills"].modes ??= {};
        node.$extensions["ds-skills"].modes[op.mode] = op.value;
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

/** Dry-run ops in a scratch copy and report before/after contrast. Throws on invalid ops. */
export function previewOps(root, ops) {
  const files = new Map();
  for (const op of ops) applyOp(root, op, files);
  const scratch = mkdtempSync(join(tmpdir(), "ds-preview-"));
  try {
    for (const f of ["design-system.json", "tokens", "brands"]) if (existsSync(join(root, f))) cpSync(join(root, f), join(scratch, f), { recursive: true });
    writeFiles(scratch, files);
    const before = checkContrast(root);
    const after = checkContrast(scratch);
    const key = (r) => `${r.brand}|${r.mode}|${r.bg}|${r.fg}`;
    const prev = new Map(before.map((r) => [key(r), r]));
    const contrastChanges = after
      .filter((r) => { const p = prev.get(key(r)); return !p || p.ratio !== r.ratio; })
      .map((r) => ({ ...r, before: prev.get(key(r))?.ratio ?? null }));
    const { issues } = buildCss(scratch);
    return { files: [...files.keys()], contrastChanges, failingAfter: after.filter((r) => !r.pass).length, issues };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
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
