#!/usr/bin/env node
/**
 * migration-state.mjs — resumable queue for batch Figma → component migrations (used by ds-migrate).
 *
 *   node scripts/migration-state.mjs init  --file-key <key> [--name <label>] <items.json>
 *   node scripts/migration-state.mjs list  [--status pending|in-progress|done|failed|review|skipped]
 *   node scripts/migration-state.mjs next  [--batch 3]
 *   node scripts/migration-state.mjs start <id>
 *   node scripts/migration-state.mjs done  <id> [--note "..."] [--story <storyId>] [--files a,b]
 *   node scripts/migration-state.mjs fail  <id> --note "..."
 *   node scripts/migration-state.mjs review <id> [--note "..."]     # built, waiting for human review
 *   node scripts/migration-state.mjs skip  <id> --note "..."
 *   node scripts/migration-state.mjs reset <id>
 *   node scripts/migration-state.mjs summary
 *
 * State file: .design-system/migration-state.json
 * items.json for init: [{ "id": "1:100", "name": "Button", "kind": "component|pattern", "dependsOn": ["1:50"], "url": "..." }]
 * Ordering: items whose dependencies are done come first (atoms before compositions); ties by name.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const args = process.argv.slice(2);
const cmd = args[0];
const positional = args.slice(1).filter((a, i, arr) => !a.startsWith("--") && !(arr[i - 1]?.startsWith("--") && !["list", "next", "summary"].includes(cmd) && isValueFlag(arr[i - 1])));
function isValueFlag(f) {
  return ["--file-key", "--name", "--status", "--batch", "--note", "--story", "--files"].includes(f);
}
const opt = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const cwd = process.cwd();
const statePath = resolve(cwd, ".design-system/migration-state.json");
const now = () => new Date().toISOString();

function load() {
  if (!existsSync(statePath)) {
    process.stderr.write(`migration-state: ${statePath} not found; run init first\n`);
    process.exit(65);
  }
  return JSON.parse(readFileSync(statePath, "utf8"));
}
function save(state) {
  state.updatedAt = now();
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
}
function find(state, id) {
  const it = state.items.find((x) => x.id === id || x.name === id);
  if (!it) {
    process.stderr.write(`migration-state: no item ${id}\n`);
    process.exit(1);
  }
  return it;
}
function counts(state) {
  const c = {};
  for (const it of state.items) c[it.status] = (c[it.status] ?? 0) + 1;
  return c;
}

switch (cmd) {
  case "init": {
    const src = positional[0];
    if (!src || !opt("--file-key")) {
      process.stderr.write("usage: migration-state.mjs init --file-key <key> [--name <label>] <items.json>\n");
      process.exit(64);
    }
    const items = JSON.parse(readFileSync(resolve(cwd, src), "utf8")).map((x) => ({
      id: x.id, name: x.name, kind: x.kind ?? "component", url: x.url ?? null, dependsOn: x.dependsOn ?? [],
      status: "pending", attempts: 0, notes: [], storyIds: [], files: [], startedAt: null, finishedAt: null,
    }));
    if (existsSync(statePath)) {
      const prev = JSON.parse(readFileSync(statePath, "utf8"));
      // Merge: keep progress for ids that already exist.
      const prevById = new Map(prev.items.map((x) => [x.id, x]));
      for (const it of items) if (prevById.has(it.id)) Object.assign(it, prevById.get(it.id), { name: it.name, dependsOn: it.dependsOn, url: it.url ?? prevById.get(it.id).url });
    }
    const state = { version: 1, name: opt("--name", "migration"), figmaFileKey: opt("--file-key"), createdAt: now(), updatedAt: now(), items };
    save(state);
    process.stdout.write(`migration-state: ${items.length} item(s) → ${statePath}\n`);
    break;
  }
  case "list": {
    const state = load();
    const st = opt("--status");
    for (const it of state.items.filter((x) => !st || x.status === st)) {
      process.stdout.write(`${it.status.padEnd(11)} ${it.id.padEnd(10)} ${it.name.padEnd(28)} ${it.kind.padEnd(9)} attempts:${it.attempts} ${it.dependsOn.length ? "deps:" + it.dependsOn.join(",") : ""} ${it.notes.at(-1) ? "— " + it.notes.at(-1).text : ""}\n`);
    }
    break;
  }
  case "next": {
    const state = load();
    const batch = Number(opt("--batch", 3));
    const doneIds = new Set(state.items.filter((x) => ["done", "review", "skipped"].includes(x.status)).map((x) => x.id));
    const ready = state.items
      .filter((x) => x.status === "pending" || (x.status === "failed" && x.attempts < 3))
      .filter((x) => x.dependsOn.every((d) => doneIds.has(d)))
      .sort((a, b) => (a.kind === "component" ? 0 : 1) - (b.kind === "component" ? 0 : 1) || a.dependsOn.length - b.dependsOn.length || a.name.localeCompare(b.name))
      .slice(0, batch);
    const blocked = state.items.filter((x) => x.status === "pending" && !x.dependsOn.every((d) => doneIds.has(d)));
    process.stdout.write(JSON.stringify({ next: ready.map(({ id, name, kind, url, dependsOn, attempts }) => ({ id, name, kind, url, dependsOn, attempts })), blocked: blocked.map((x) => ({ id: x.id, name: x.name, waitingFor: x.dependsOn.filter((d) => !doneIds.has(d)) })), counts: counts(state) }, null, 2) + "\n");
    break;
  }
  case "start": case "done": case "fail": case "review": case "skip": case "reset": {
    const state = load();
    const it = find(state, positional[0]);
    const note = opt("--note");
    if (note) it.notes.push({ at: now(), status: cmd, text: note });
    if (cmd === "start") { it.status = "in-progress"; it.attempts++; it.startedAt = now(); }
    if (cmd === "done") { it.status = "done"; it.finishedAt = now(); }
    if (cmd === "review") { it.status = "review"; it.finishedAt = now(); }
    if (cmd === "fail") { it.status = "failed"; it.finishedAt = now(); if (!note) { process.stderr.write("fail requires --note\n"); process.exit(64); } }
    if (cmd === "skip") { it.status = "skipped"; it.finishedAt = now(); if (!note) { process.stderr.write("skip requires --note\n"); process.exit(64); } }
    if (cmd === "reset") { it.status = "pending"; it.startedAt = it.finishedAt = null; }
    if (opt("--story")) it.storyIds = [...new Set([...it.storyIds, ...opt("--story").split(",")])];
    if (opt("--files")) it.files = [...new Set([...it.files, ...opt("--files").split(",")])];
    save(state);
    process.stdout.write(`${it.name} (${it.id}) → ${it.status}\n`);
    break;
  }
  case "summary": {
    const state = load();
    const c = counts(state);
    process.stdout.write(`${state.name} (${state.figmaFileKey}): ${state.items.length} items — ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(", ")}\nupdated ${state.updatedAt}\n`);
    const failed = state.items.filter((x) => x.status === "failed");
    for (const f of failed) process.stdout.write(`  failed: ${f.name} — ${f.notes.at(-1)?.text ?? ""}\n`);
    break;
  }
  default:
    process.stderr.write("usage: migration-state.mjs <init|list|next|start|done|fail|review|skip|reset|summary> ...\n");
    process.exit(64);
}
