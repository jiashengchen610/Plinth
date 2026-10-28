#!/usr/bin/env node
// Record the hash (sha256 of the text with LF line endings) of every version of the template's component files
// that a commit of this repo contained, in engine/shipped-components.json. Upgrades replace a user's copy only
// while it is exactly one of these: a file the user or Claude edited is never overwritten. Run after changing
// template components, before the release: node scripts/shipped-hashes.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const PREFIX = "template/";

// Every commit that touched a component file, with the files it touched.
const log = git("log", "--format=@%H", "--name-only", "--", "template/src/components");
const out = {};
let sha = null;
for (const line of log.split("\n")) {
  if (line.startsWith("@")) { sha = line.slice(1); continue; }
  if (!line.startsWith(`${PREFIX}src/components/`) || !/\.tsx$/.test(line)) continue;
  let text;
  try { text = git("show", `${sha}:${line}`); } catch { continue; } // deleted in this commit
  const hash = createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
  const rel = line.slice(PREFIX.length);
  (out[rel] ??= new Set()).add(hash);
}
const json = Object.fromEntries(Object.keys(out).sort().map((k) => [k, [...out[k]].sort()]));
writeFileSync(join(root, "engine", "shipped-components.json"), JSON.stringify(json, null, 1) + "\n");
console.log(`engine/shipped-components.json: ${Object.keys(json).length} files, ${Object.values(json).reduce((n, l) => n + l.length, 0)} versions`);
