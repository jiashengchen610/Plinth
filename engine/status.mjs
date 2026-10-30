// The product side of the update record. A product repo keeps plinth-source.json: where its copies came from (the
// design system's site or folder), the version they were taken at, and for each copy its path upstream and its
// hash when taken. `plinth status` compares those copies with the design system's current update record and
// reports, file by file, whether the design system changed it, this repo changed it, both did, or neither, and which
// saved versions (with their notes) lie in between. It only reports: taking a change, keeping a local one or merging
// the two is the judgment of the product's agent and the person it works for. Plain data; nothing here knows a
// framework or a platform.
export const SOURCE_FILE = "plinth-source.json";

const STATES = ["upstream", "both", "local", "removed", "missing", "unchanged"];

/**
 * @param {{ source: string, repository?: string, version?: string, files?: Record<string, { from?: string, hash: string }> }} source  plinth-source.json
 * @param {object} record  the design system's exports/update.json
 * @param {Record<string, string | null>} local  hash of each listed local file now; null when the file is missing
 */
export function compareStatus(source, record, local) {
  const versions = record.versions ?? [];
  const idx = source.version ? versions.findIndex((v) => v.short === source.version || v.sha === source.version || v.sha?.startsWith(source.version)) : -1;
  const since = idx < 0 ? versions : versions.slice(0, idx);
  const noteOf = (short) => versions.find((v) => v.short === short)?.subject ?? null;
  const files = Object.entries(source.files ?? {}).map(([path, taken]) => {
    const from = taken.from ?? path;
    const upstream = record.files?.[from] ?? null;
    const here = local[path] ?? null;
    const upstreamChanged = upstream ? upstream.hash !== taken.hash : false;
    const localChanged = here ? here !== taken.hash : false;
    let state = "unchanged";
    if (!upstream) state = "removed";
    else if (here === null) state = "missing";
    else if (upstreamChanged && localChanged) state = "both";
    else if (upstreamChanged) state = "upstream";
    else if (localChanged) state = "local";
    return { path, from, state, ...(upstreamChanged ? { version: upstream.version, note: noteOf(upstream.version) } : {}) };
  });
  const takenFrom = new Set(files.map((f) => f.from));
  const counts = Object.fromEntries(STATES.map((s) => [s, files.filter((f) => f.state === s).length]));
  return {
    source: source.source,
    name: record.name ?? null,
    taken: source.version ?? null,
    latest: record.version ?? null,
    versionKnown: idx >= 0,
    since,
    files,
    counts,
    notTaken: Object.keys(record.files ?? {}).filter((f) => !takenFrom.has(f)),
    upToDate: since.length === 0 && files.every((f) => f.state === "unchanged" || f.state === "local"),
  };
}

const TITLES = {
  upstream: "Changed in the design system (take it?)",
  both: "Changed on both sides (merge)",
  local: "Changed here only (keep it?)",
  removed: "No longer in the design system",
  missing: "Missing here",
};

/** The report as Markdown, for a person or an agent reading the terminal. */
export function statusMarkdown(r, diffs = null) {
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const lines = [`# ${r.name ?? "Design system"}: what changed`, "", `Source: ${r.source}`];
  if (!r.taken) lines.push("Taken at: no version recorded in plinth-source.json.");
  else lines.push(`Taken at version ${r.taken}${r.versionKnown ? "" : " (not in the design system's record: it may predate it, or never was saved)"} · now ${r.latest?.short ?? "none"}`);
  if (r.since.length) {
    lines.push("", `## ${n(r.since.length, "version", "versions")} since`, "");
    for (const v of r.since) lines.push(`- ${v.short} ${String(v.date ?? "").slice(0, 10)} ${v.subject}`);
  } else lines.push("", "No new version since the files were taken.");
  for (const state of ["upstream", "both", "local", "removed", "missing"]) {
    const list = r.files.filter((f) => f.state === state);
    if (!list.length) continue;
    lines.push("", `## ${TITLES[state]} · ${list.length}`, "");
    for (const f of list) lines.push(`- ${f.path}${f.version ? ` — version ${f.version}${f.note ? `: ${f.note}` : ""}` : ""}${f.from !== f.path ? ` (from ${f.from})` : ""}`);
  }
  lines.push("", `Unchanged: ${n(r.counts.unchanged, "file", "files")}. Not taken: ${n(r.notTaken.length, "file", "files")} the design system has and this repo does not use.`);
  if (diffs && Object.keys(diffs).length) {
    lines.push("", "## Differences (this repo → the design system's current version)");
    for (const [path, diff] of Object.entries(diffs)) {
      const body = diff.split("\n");
      lines.push("", `### ${path}`, "", "```diff", ...body.slice(0, 400), ...(body.length > 400 ? [`… ${body.length - 400} more lines`] : []), "```");
    }
  }
  if (!r.upToDate) lines.push("", "Decide file by file: take the design system's version, keep this one, or merge the two. Then record the version taken in plinth-source.json.");
  return lines.join("\n") + "\n";
}
