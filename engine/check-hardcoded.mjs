#!/usr/bin/env node
/**
 * check-hardcoded.mjs — flag hardcoded design values in component code.
 *
 * Usage:
 *   node engine/check-hardcoded.mjs <file|dir>... [--json] [--strict] [--config <path>]
 *   node engine/check-hardcoded.mjs --hook          # Claude Code PostToolUse hook (reads stdin JSON)
 *
 * Rules:
 *   hex-color      #fff / #ffffff / #ffffffff literals
 *   color-fn       rgb()/rgba()/hsl()/hsla()/oklch() with literal numbers
 *   tw-arbitrary   Tailwind arbitrary values: bg-[#fff], p-[13px], text-[14px]
 *   magic-px       Npx where N is not 0 or 1 (borders / hairlines are allowed)
 *
 * Config (optional): design-system.json in the workspace root
 *   { "hardcoded": { "allowFiles": ["**\/globals.css"], "allowPx": [0, 1], "scanExtensions": [".tsx"] } }
 *
 * Exit codes (CLI):  0 clean; 1 on any finding with --strict.
 * Exit codes (hook): 0 (findings returned as additionalContext).
 */
import { readFileSync, statSync, readdirSync, existsSync } from "node:fs";
import { resolve, relative, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULTS = {
  scanExtensions: [".tsx", ".ts", ".jsx", ".js", ".css", ".scss", ".mdx"],
  // Files where raw values are legitimate: token sources and generated theme output.
  allowFiles: [
    "**/globals.css",
    "**/index.css",
    "**/tokens.css",
    "**/fonts.css",
    "**/tokens/**",
    "**/brands/**",
    "**/*.tokens.json",
    "**/node_modules/**",
    "**/dist/**",
    "**/storybook-static/**",
    "**/.storybook/**",
  ],
  allowPx: [0, 1],
  // Design-value rules only apply to code/style files.
  designValueExtensions: [".tsx", ".ts", ".jsx", ".js", ".css", ".scss", ".mdx"],
};

const RULES = [
  {
    id: "hex-color", level: "warn",
    re: /(?<![\w&])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g,
    hint: "Use a design token (CSS variable / theme utility) instead of a hex literal.",
  },
  {
    id: "color-fn", level: "warn",
    re: /\b(?:rgba?|hsla?|oklch|oklab)\(\s*(?!var\()[\d.]+/g,
    hint: "Use a design token instead of a literal color function.",
  },
  {
    id: "tw-arbitrary", level: "warn",
    re: /\b[a-z-]+-\[(?:#[0-9a-fA-F]{3,8}|\d+(?:\.\d+)?(?:px|rem|em)|(?:rgba?|hsla?|oklch)\([^\]]*\))\]/g,
    hint: "Tailwind arbitrary value. Prefer a theme utility backed by a token (bg-primary, p-4, text-sm).",
  },
  {
    id: "magic-px", level: "warn", pxRule: true,
    re: /(?<![\w.-])(\d+(?:\.\d+)?)px\b/g,
    hint: "Magic pixel value. Use a spacing / size token or the theme scale.",
  },
];

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += "(?:.*)";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

export function loadConfig(cwd, explicit) {
  const p = explicit ?? resolve(cwd, "design-system.json");
  if (!existsSync(p)) return DEFAULTS;
  try {
    const cfg = JSON.parse(readFileSync(p, "utf8"));
    const h = cfg.hardcoded ?? {};
    return { ...DEFAULTS, ...h, allowFiles: [...DEFAULTS.allowFiles, ...(h.allowFiles ?? [])] };
  } catch (e) {
    process.stderr.write(`check-hardcoded: invalid config ${p}: ${e.message}\n`);
    return DEFAULTS;
  }
}

function toPosix(p) {
  return p.split(sep).join("/");
}

function isAllowed(relPath, cfg) {
  const norm = toPosix(relPath);
  return cfg.allowFiles.some((g) => {
    const rx = globToRegExp(g);
    return rx.test(norm) || rx.test("/" + norm);
  });
}

function stripComments(src, ext) {
  if (![".css", ".scss", ".ts", ".tsx", ".js", ".jsx"].includes(ext)) return src;
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));
}

export function scanFile(absPath, cwd, cfg) {
  const rel = relative(cwd, absPath) || absPath;
  const ext = extname(absPath).toLowerCase();
  if (!cfg.scanExtensions.includes(ext)) return [];
  let src;
  try {
    src = readFileSync(absPath, "utf8");
  } catch {
    return [];
  }
  const allowed = isAllowed(rel, cfg);
  const designExt = cfg.designValueExtensions.includes(ext);
  const lines = src.split("\n");
  const stripped = stripComments(src, ext).split("\n");
  const findings = [];

  for (const rule of RULES) {
    if (allowed || !designExt) continue;
    stripped.forEach((line, i) => {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        if (rule.pxRule) {
          if (cfg.allowPx.includes(Number(m[1]))) continue;
          // px is structural in media / container queries and SVG viewBox.
          if (/@media|@container|viewBox|min-width|max-width/.test(line)) continue;
          // px inside a token-based expression, e.g. rounded-[min(var(--radius-md),10px)], is a clamp, not a magic value.
          const windowStart = line.lastIndexOf("[", m.index);
          if (windowStart >= 0 && /var\(--/.test(line.slice(windowStart, m.index))) continue;
        }
        if (rule.id === "hex-color" && /url\(|&#|\\u/.test(line.slice(Math.max(0, m.index - 5), m.index + 1))) continue;
        findings.push({
          file: toPosix(rel),
          line: i + 1,
          col: m.index + 1,
          rule: rule.id,
          level: rule.level,
          match: m[0],
          hint: rule.hint,
          snippet: lines[i].trim().slice(0, 160),
        });
      }
    });
  }
  return findings;
}

export function walk(target, cwd, cfg, out) {
  let st;
  try {
    st = statSync(target);
  } catch {
    return;
  }
  if (st.isDirectory()) {
    const rel = toPosix(relative(cwd, target));
    if (/(^|\/)(node_modules|\.git|dist|storybook-static)(\/|$)/.test(rel)) return;
    for (const name of readdirSync(target)) walk(resolve(target, name), cwd, cfg, out);
  } else {
    out.push(...scanFile(target, cwd, cfg));
  }
}

export function format(findings) {
  if (findings.length === 0) return "check-hardcoded: no hardcoded design values found.";
  const byRule = {};
  for (const f of findings) (byRule[f.rule] ??= []).push(f);
  const out = [`check-hardcoded: ${findings.length} finding(s)`];
  for (const [rule, list] of Object.entries(byRule)) {
    out.push(`\n[${list[0].level.toUpperCase()}] ${rule} (${list.length}) - ${list[0].hint}`);
    for (const f of list.slice(0, 25)) out.push(`  ${f.file}:${f.line}:${f.col}  ${f.match}    ${f.snippet}`);
    if (list.length > 25) out.push(`  ... and ${list.length - 25} more`);
  }
  return out.join("\n");
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Scan files or directories under cwd; returns findings. */
export function scan(targets, cwd = process.cwd()) {
  const cfg = loadConfig(cwd);
  const out = [];
  for (const t of targets) walk(resolve(cwd, t), cwd, cfg, out);
  return out;
}

// ---------------- CLI ----------------
function main() {
  const args = process.argv.slice(2);
  const cwd = process.cwd();
  const hookMode = args.includes("--hook");
  const json = args.includes("--json");
  const strict = args.includes("--strict");
  const cfgIdx = args.indexOf("--config");
  const cfg = loadConfig(cwd, cfgIdx >= 0 ? resolve(cwd, args[cfgIdx + 1]) : undefined);

  if (hookMode) {
    let payload = {};
    try {
      payload = JSON.parse(readStdin() || "{}");
    } catch {
      /* malformed payload: nothing to check */
    }
    const fp = payload?.tool_input?.file_path ?? payload?.tool_input?.path;
    if (!fp) return void process.exit(0);
    const base = process.env.CLAUDE_PROJECT_DIR || payload.cwd || cwd;
    // Only guard design-system workspaces; stay silent in every other project.
    if (!existsSync(resolve(base, "design-system.json"))) return void process.exit(0);
    const findings = scanFile(resolve(base, fp), base, cfg);
    if (findings.length === 0) return void process.exit(0);
    const text = format(findings);
    if (findings.some((f) => f.level === "error")) {
      process.stderr.write(text + "\nRemove the secret from the file before continuing.\n");
      return void process.exit(2);
    }
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext:
            "design-system guardrail: the file just written contains hardcoded design values. " +
            "Replace them with design tokens (CSS variables / theme utilities) unless the user explicitly accepted an exception.\n" +
            format(findings),
        },
      }),
    );
    return void process.exit(0);
  }

  const targets = args.filter((a, i) => !a.startsWith("--") && !(cfgIdx >= 0 && i === cfgIdx + 1));
  if (targets.length === 0) {
    process.stderr.write("usage: check-hardcoded.mjs <file|dir>... [--json] [--strict] [--config <path>] | --hook\n");
    return void process.exit(64);
  }
  const findings = [];
  for (const t of targets) walk(resolve(cwd, t), cwd, cfg, findings);
  if (json) process.stdout.write(JSON.stringify({ count: findings.length, findings }, null, 2) + "\n");
  else process.stdout.write(format(findings) + "\n");
  return void process.exit(strict && findings.length > 0 ? 1 : 0);

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
