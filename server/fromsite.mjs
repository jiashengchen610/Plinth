// Reading a website's look for Describe's "Start from a website": dembrandt (pinned, through npx) opens the page in a
// headless browser and reports its colors, fonts, corners and buttons; Google Fonts says which of its fonts are free;
// engine/fromsite.mjs turns that into the style picks. About 20–40 seconds. Nothing is written: the picks become
// answers, and Create applies them.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { request } from "node:https";
import { dirname, join } from "node:path";
import { DEMBRANDT, fontsToCheck, matchMain, siteLook } from "../engine/fromsite.mjs";
import { loadPrimitives, SHADES } from "../engine/palette.mjs";
import { formatHex, parseColor } from "../engine/color.mjs";

const isWin = process.platform === "win32";

/** "monzo.com" → "https://monzo.com/". Public http(s) pages only; the query and fragment are dropped. */
export function siteUrl(input) {
  let s = String(input ?? "").trim();
  if (!s) throw new Error("Paste the address of a website, for example monzo.com.");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { throw new Error(`"${input}" is not a web address.`); }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host.includes(".") || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/i.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.includes(":")) {
    throw new Error("Plinth reads public websites only.");
  }
  return `${u.protocol}//${u.host}${u.pathname}`;
}

// npx without a shell: through npm's own script next to node, so nothing in the address reaches a command line.
function npx(args) {
  const cli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (existsSync(cli)) return { cmd: process.execPath, args: [cli, ...args], shell: false };
  return { cmd: "npx", args, shell: isWin };
}

function run(args, { timeout }) {
  return new Promise((resolve) => {
    const n = npx(["-y", DEMBRANDT, ...args]);
    const child = spawn(n.cmd, n.args, { shell: n.shell, windowsHide: true, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      if (isWin) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill("SIGTERM");
    }, timeout);
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e.message) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

/** True when Google Fonts serves a family (its CSS API answers 200; an unknown family is a 400). */
export function googleHasFamily(family, { timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    const path = `/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}`;
    const req = request({ hostname: "fonts.googleapis.com", path, method: "GET", headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.setTimeout(timeout, () => req.destroy());
    req.on("error", () => resolve(false));
    req.end();
  });
}

const hexOf = (v) => { const c = parseColor(v); return c ? formatHex(c) : null; };
/** A palette family's steps as hex, light to dark (for the UI's swatches). */
function swatches(primitives, family) {
  const node = primitives.color?.[family];
  return node ? SHADES.filter((s) => node[s]?.$value).map((s) => hexOf(node[s].$value)) : [];
}

/** The page's own small icon as a data URI, when dembrandt kept one. */
function favicon(x) {
  const f = (x.favicons ?? []).find((i) => typeof i.dataUri === "string" && i.dataUri.length < 24000 && /^data:image\/(svg\+xml|png|x-icon|vnd\.microsoft\.icon)/.test(i.dataUri));
  return f?.dataUri ?? null;
}

/**
 * Read a site's look. Resolves to { url, seconds, look: { found, picks, notes }, accent, swatches, favicon };
 * throws with a plain message when the page cannot be read.
 */
export async function readSite(input, { root, templateDir, timeout = 150_000 } = {}) {
  const url = siteUrl(input);
  const started = Date.now();
  let r = await run([url, "--json-only"], { timeout });
  // A first run on this computer may lack dembrandt's browser: install it once and try again.
  if (r.code !== 0 && /install-browser|Executable doesn't exist|browserType\.launch/i.test(r.stderr + r.stdout)) {
    await run(["install-browser"], { timeout: 300_000 });
    r = await run([url, "--json-only"], { timeout });
  }
  const json = /\{[\s\S]*\}\s*$/.exec(r.stdout)?.[0];
  let x = null;
  try { x = json ? JSON.parse(json) : null; } catch { /* below */ }
  if (!x) {
    const why = (r.stderr || r.stdout).split("\n").map((s) => s.trim()).filter(Boolean).slice(-2).join(" ");
    throw new Error(`Plinth couldn't read ${url}${why ? `: ${why.slice(0, 200)}` : "."} Check the address, or try the site's home page.`);
  }
  // Before a design system exists (Describe in an empty folder), the template's palette.
  const primitives = loadPrimitives(root ?? templateDir, templateDir);
  const families = fontsToCheck(x);
  const free = new Set();
  await Promise.all(families.map(async (f) => { if (await googleHasFamily(f)) free.add(f); }));
  const look = siteLook(x, primitives, (f) => free.has(f));
  const accent = look.found.accent ? matchMain(primitives, look.found.accent, look.picks.gray) : null;
  const mainFamily = look.picks.main?.family;
  return {
    url,
    seconds: Math.round((Date.now() - started) / 1000),
    look,
    accent,
    favicon: favicon(x),
    swatches: { gray: swatches(primitives, look.picks.gray), main: mainFamily ? swatches(primitives, mainFamily) : [] },
  };
}
