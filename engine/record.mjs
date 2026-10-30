// The update record a publish leaves on the site (exports/update.json): the saved versions with the notes written
// when they were saved, and, for every file a product might take, a content hash and the version that last changed
// it. A product repo compares its own copies against this record (`plinth status`, PRD item 7) without reading the
// design system's code or resolving its tokens: the record is plain data, the same for any framework or platform.
// Deterministic: the same commit gives the same record (dates come from the commits, never from the clock), so the
// deploy workflow rewrites it on a clean checkout and the site always carries the record of what it serves.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, PLINTH_VERSION } from "./workspace.mjs";
import { loadConfig, listBrands } from "./tokens.mjs";

export const RECORD_FILE = "exports/update.json";
/** What a product may take: tokens, brands, guidelines, components, icons, the generated styles and the exports. */
const TAKEN = [/^tokens\//, /^brands\//, /^design-system\.json$/, /^DESIGN\.md$/, /^WRITING\.md$/, /^src\/components\//, /^icons\//, /^src\/icons\//, /^src\/styles\//, /^exports\//];
const TAKEN_PATHS = ["tokens", "brands", "design-system.json", "DESIGN.md", "WRITING.md", "src/components", "icons", "src/icons", "src/styles", "exports"];
/** Versions Plinth makes by itself; the user's saved versions are the ones with notes worth reading. */
const PLINTH_OWN = /^Publish: update exports$|^Installed the preview tools/;

/** sha256 of the content with LF line endings, so a Windows checkout and a Linux one agree. */
export const contentHash = (buf) => `sha256:${createHash("sha256").update(Buffer.from(buf).toString("utf8").replace(/\r\n/g, "\n")).digest("hex")}`;

const parseLog = (out) => out.split("\n").filter(Boolean).map((l) => { const [short, sha, date, subject] = l.split("\x1f"); return { short, sha, date, subject }; });

/**
 * @returns {{ name: string, plinth: string, brands: string[], version: object | null, versions: object[], files: Record<string, { hash: string, version: string | null }> }}
 */
export function updateRecord(root, { limit = 500 } = {}) {
  const config = loadConfig(root);
  let versions = [];
  try { versions = parseLog(git(root, ["log", `-${limit}`, "--pretty=format:%h%x1f%H%x1f%cI%x1f%s"])).filter((v) => !PLINTH_OWN.test(v.subject)); } catch { /* no commit yet */ }
  const latest = versions[0] ?? null;

  // The version that last changed each file, from the user's versions only (newest first, so the first mention wins).
  const lastChanged = {};
  try {
    let current = null;
    for (const line of git(root, ["log", `-${limit}`, "--pretty=format:%h%x1f%s", "--name-only", "--", ...TAKEN_PATHS]).split("\n")) {
      if (!line) continue;
      if (line.includes("\x1f")) { const [short, subject] = line.split("\x1f"); current = PLINTH_OWN.test(subject) ? null : short; continue; }
      const file = line.replace(/\\/g, "/");
      if (current && !(file in lastChanged)) lastChanged[file] = current;
    }
  } catch { /* no commit yet */ }

  // Tracked files plus what publish just wrote (the exports), hashed from the working tree.
  const files = {};
  let listed = [];
  try { listed = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean); } catch { /* not a repository */ }
  for (const rel of listed.map((f) => f.replace(/\\/g, "/")).sort()) {
    if (rel === RECORD_FILE || !TAKEN.some((re) => re.test(rel)) || !existsSync(join(root, rel))) continue;
    files[rel] = { hash: contentHash(readFileSync(join(root, rel))), version: lastChanged[rel] ?? latest?.short ?? null };
  }
  // Where the code lives and what the components need, so a product can fetch files and install packages from the
  // record alone.
  let repository = null;
  try { repository = git(root, ["remote", "get-url", "origin"]).replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "") || null; } catch { /* no remote yet */ }
  let packages = {};
  try { packages = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies ?? {}; } catch { /* no package.json */ }
  return { name: config.name ?? null, plinth: PLINTH_VERSION, repository, brands: listBrands(root, config), packages, version: latest, versions, files };
}

/** Write the record into the workspace (exports/update.json) and return it. */
export function writeUpdateRecord(root) {
  const record = updateRecord(root);
  mkdirSync(join(root, "exports"), { recursive: true });
  writeFileSync(join(root, RECORD_FILE), JSON.stringify(record, null, 2) + "\n");
  return record;
}
