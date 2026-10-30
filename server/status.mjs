// `plinth status` for a product repo: reads plinth-source.json, loads the design system's update record (from its
// site over HTTPS, or from a folder), hashes the local copies and hands everything to engine/status.mjs. With
// --diff it fetches the design system's current version of each changed file (a local folder, or the GitHub
// repository named in plinth-source.json) into .ds/upstream/ and diffs it against the local copy with git, so the
// agent reading the report sees the actual change, not only that there is one.
// node:http(s) with agent: false, never the global fetch (see httpJson in storybook.mjs for why).
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { execFileSync } from "node:child_process";
import { contentHash, RECORD_FILE } from "../engine/record.mjs";
import { SOURCE_FILE, compareStatus } from "../engine/status.mjs";

const isUrl = (s) => /^https?:\/\//i.test(String(s ?? ""));

/** GET a URL as text, following up to three redirects; rejects on a non-2xx answer. */
export function httpText(url, { timeout = 15000, redirects = 3 } = {}) {
  return new Promise((resolve_, reject) => {
    const u = new URL(url);
    const request = u.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: "GET", agent: false, headers: { "User-Agent": "plinth" } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve_(httpText(new URL(res.headers.location, url).href, { timeout, redirects: redirects - 1 }));
        return;
      }
      let out = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (out += d));
      res.on("end", () => (res.statusCode >= 200 && res.statusCode < 300 ? resolve_(out) : reject(new Error(`${url}: HTTP ${res.statusCode}`))));
    });
    if (timeout) req.setTimeout(timeout, () => req.destroy(new Error(`${url}: no answer within ${timeout} ms`)));
    req.on("error", reject);
    req.end();
  });
}

/** plinth-source.json of a product folder, or a clear error when the folder is not connected. */
export function readSource(root) {
  const file = join(root, SOURCE_FILE);
  if (!existsSync(file)) {
    throw new Error(`No ${SOURCE_FILE} in ${root}: this folder is not connected to a design system. Write it by hand for now: { "source": "<the design system's site, or its folder>", "repository": "<its GitHub URL, for --diff>", "version": "<the version the copies were taken at>", "files": { "<local path>": { "from": "<path in the design system>", "hash": "<its hash in the design system's exports/update.json>" } } }.`);
  }
  const source = JSON.parse(readFileSync(file, "utf8"));
  if (!source.source) throw new Error(`${SOURCE_FILE} has no "source": the design system's site (https://…/) or folder.`);
  return source;
}

/** The design system's update record: from its site (…/exports/update.json) or from a folder holding exports/. */
export async function loadRecord(source) {
  if (isUrl(source)) {
    const url = /\.json$/i.test(source) ? source : `${source.replace(/\/?$/, "/")}${RECORD_FILE}`;
    let text;
    try { text = await httpText(url); } catch (e) {
      if (/HTTP 404/.test(e.message)) throw new Error(`${url} does not exist: the design system was last published before Plinth 0.20, which is when publishes started to write the update record. Publish it again with the current Plinth, then run status again.`);
      throw e;
    }
    return JSON.parse(text);
  }
  const folder = resolve(source);
  const file = /\.json$/i.test(folder) ? folder : join(folder, RECORD_FILE);
  if (!existsSync(file)) throw new Error(`${file} not found: the design system has not been published with Plinth 0.20 or later (its publish writes exports/update.json).`);
  return JSON.parse(readFileSync(file, "utf8"));
}

/** The hash of each local copy named in plinth-source.json, null when the file is missing. */
export function localHashes(root, source) {
  return Object.fromEntries(Object.keys(source.files ?? {}).map((path) => {
    const abs = join(root, path);
    return [path, existsSync(abs) ? contentHash(readFileSync(abs)) : null];
  }));
}

const githubRepo = (u) => String(u ?? "").match(/github\.com[:/]([^/]+\/[^/.]+?)(\.git)?\/?$/)?.[1] ?? null;

/** The design system's current text of a file: from the source folder, or from its GitHub repository at the published version. */
export async function upstreamText(source, record, from) {
  if (!isUrl(source.source)) return readFileSync(join(resolve(source.source), from), "utf8");
  const repo = githubRepo(source.repository);
  if (!repo) throw new Error(`The diff needs the design system's GitHub repository: add "repository": "https://github.com/<owner>/<name>" to ${SOURCE_FILE}, or point "source" at a local folder.`);
  if (!record.version?.sha) throw new Error("The design system's record names no version to read the files at.");
  return httpText(`https://raw.githubusercontent.com/${repo}/${record.version.sha}/${from}`);
}

/**
 * The report of engine/status.mjs for a product folder. With diff, also { diffs: { [localPath]: unified diff } } for the
 * files the design system changed, from copies saved under .ds/upstream/.
 */
export async function status(root, { diff = false } = {}) {
  const source = readSource(root);
  const record = await loadRecord(source.source);
  const report = compareStatus(source, record, localHashes(root, source));
  if (diff) {
    report.diffs = {};
    for (const f of report.files.filter((x) => x.state === "upstream" || x.state === "both")) {
      const text = await upstreamText(source, record, f.from);
      const dest = join(root, ".ds", "upstream", f.from);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, text);
      // git diff --no-index exits 1 when the files differ; the diff is on stdout either way.
      let out = "";
      try { out = execFileSync("git", ["diff", "--no-index", "--", join(root, f.path), dest], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { out = e.stdout?.toString() ?? ""; }
      report.diffs[f.path] = out;
    }
  }
  return report;
}
