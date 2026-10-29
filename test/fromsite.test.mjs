// Starting from a website: dembrandt's JSON (trimmed fixtures read from three real sites) turned into Describe's
// picks, the address check, and Create applying the picks with the main color kept exact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { cleanFamily, exactPrimaryOps, familyCandidates, fontsToCheck, matchMain, siteLook, standIn } from "../engine/fromsite.mjs";
import { generateScale, loadPrimitives, paletteProfile } from "../engine/palette.mjs";
import { contrastRatio } from "../engine/color.mjs";
import { siteUrl } from "../server/fromsite.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(here, "..", "template");
const SERVER = join(here, "..", "server", "index.mjs");
const FAKE = join(here, "fake-claude.mjs");
const site = (n) => JSON.parse(readFileSync(join(here, "fixtures", "sites", `${n}.json`), "utf8"));
const primitives = loadPrimitives(TEMPLATE);

test("from a website: main color, grays, background, corners and fonts become Describe's picks", () => {
  // Navy pill buttons, a coral logo, the site's own fonts.
  const monzo = siteLook(site("monzo"), primitives, () => false);
  assert.equal(monzo.found.main.color, "#091723");
  assert.equal(monzo.found.main.from, "buttons");
  assert.deepEqual(monzo.picks.main, { family: "gray", step: "900", color: "#091723" }, "close to a palette step: that step");
  assert.equal(monzo.found.accent, "#ff4f40");
  assert.deepEqual(monzo.found.corners, { buttons: "pill", cards: 32 });
  assert.deepEqual(monzo.picks.corners, { preset: "pill", outer: "4xl" });
  assert.equal(monzo.picks.fonts.font, "Inter");
  assert.equal(monzo.found.fonts.heading.free, false);
  assert.ok(monzo.notes.some((n) => /Monzo Sans Display is the site's own font/.test(n)), monzo.notes.join(" | "));

  // Black buttons on a warm off-white page, pill and square corners, a paid grotesk.
  const gumroad = siteLook(site("gumroad"), primitives, () => false);
  assert.equal(gumroad.picks.main.family, gumroad.picks.gray, "black becomes the gray family, not a scale made from black");
  assert.equal(gumroad.picks.background, "zinc.100", "the page's off-white, in the site's own gray family");
  assert.equal(gumroad.picks.corners.preset, "pill");
  assert.equal(gumroad.picks.fonts.font, "Space Grotesk");

  // Near-black buttons, 6px corners, Geist (free on Google Fonts once its name is cleaned).
  const vercel = siteLook(site("vercel"), primitives, (f) => f === "Geist");
  assert.deepEqual(vercel.picks.main, { family: "neutral", step: "900", color: "#171717" });
  assert.equal(vercel.picks.gray, "neutral");
  assert.equal(vercel.picks.background, "neutral.50", "the site's own gray family wins a tie");
  assert.deepEqual(vercel.picks.corners, { preset: "round", inner: "md", outer: "lg" });
  assert.deepEqual(vercel.picks.fonts, { font: "Geist", headingFont: "", labelFont: "body" });
  assert.equal(vercel.found.fonts.body.free, true);
  assert.deepEqual(fontsToCheck(site("vercel")), ["Geist"]);

  assert.equal(cleanFamily("GeistSans"), "Geist");
  assert.equal(cleanFamily("Inter Variable"), "Inter");
  assert.deepEqual(familyCandidates("MonzoSansText"), ["Monzo Sans Text", "Monzo Sans"]);
  assert.equal(standIn("Söhne Breit"), "Inter");
  assert.equal(standIn("Tiempos Headline"), "Source Serif 4");
  assert.equal(standIn("Some Mono"), "JetBrains Mono");
  assert.deepEqual(siteLook({}, primitives).picks.main, null, "an empty page reads as nothing, not an error");
});

test("from a website: a main color of its own stays exact, with text that can sit on it", () => {
  const pink = matchMain(primitives, "#ff90e8", "zinc");
  assert.deepEqual(pink, { custom: "#ff90e8", color: "#ff90e8" });
  const { anchor, shades } = generateScale("#ff90e8", paletteProfile(primitives));
  const ops = exactPrimaryOps("acme", "brand", anchor, shades);
  assert.equal(ops[0].value, `{color.brand.${anchor}}`);
  assert.ok(["{color.brand.950}", "{color.black}"].includes(ops[1].value), "light pink takes dark text, as on the site");
  // A middle color no text can sit on at 4.5:1 keeps the readable step styleOps picks.
  const mid = generateScale("#808080", paletteProfile(primitives));
  assert.ok(contrastRatio("#ffffff", "#808080") < 4.5 && contrastRatio("#000000", "#808080") < 6);
  assert.ok(Array.isArray(exactPrimaryOps("acme", "brand", mid.anchor, mid.shades)));

  for (const bad of ["", "localhost:3000", "http://192.168.1.5/", "http://10.0.0.2", "not a url"]) assert.throws(() => siteUrl(bad), bad);
  assert.equal(siteUrl("monzo.com/?a=1&b=2#top"), "https://monzo.com/", "the query and fragment never reach a command line");
});

test("from a website: Create applies the picks, keeps the main color exact and tells Claude not to name the site", async (t) => {
  const ws = mkdtempSync(join(tmpdir(), "plinth-site-"));
  const env = { ...process.env, PLINTH_WORKSPACE: ws, PLINTH_TOKEN: "tok", PLINTH_PORT: "4398", PLINTH_CLAUDE_BIN: FAKE, PLINTH_NO_INSTALL: "1", CLAUDECODE: "1" };
  const child = spawn(process.execPath, [SERVER], { env, stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise((res) => child.once("exit", res));
  t.after(async () => { child.stdin.end(); await exited; rmSync(ws, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const responses = new Map();
  let nextId = 1;
  createInterface({ input: child.stdout }).on("line", (line) => { const m = JSON.parse(line); if (m.id !== undefined) responses.get(m.id)?.(m); });
  const request = (method, params) => new Promise((resolve) => { const id = nextId++; responses.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  const ui = JSON.parse((await request("tools/call", { name: "open_ui", arguments: {} })).result.content[0].text).url;
  const api = async (path, body) => {
    const r = await fetch(new URL(path, ui), { method: body ? "POST" : "GET", headers: { "X-Plinth-Token": "tok", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() };
  };
  assert.equal((await api("api/read-site", { url: "localhost:8080" })).status, 400, "only public sites are read");

  // Gumroad's look with its pink as the main color (the user switched it in the review).
  const look = siteLook(site("gumroad"), primitives, () => false);
  const picks = { url: "https://gumroad.com/", name: "Gumroad", ...look.picks, main: matchMain(primitives, "#ff90e8", look.picks.gray) };
  const answers = { product: "A marketplace for creators", name: "Stall", feel: "Bold and playful", kind: "e-commerce", palette: "site", corners: "site", font: "site", components: [], extraText: "", site: picks };
  assert.equal((await api("api/setup", answers)).status, 200);
  let s;
  for (let i = 0; i < 400; i++) {
    s = (await api("api/state")).json;
    if (s.setup && !s.setup.running) break;
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.equal(s.setup.error, null);
  const brand = s.config.defaultBrand;
  const tokens = JSON.parse(readFileSync(join(ws, "brands", brand, "tokens.json"), "utf8"));
  const prim = JSON.parse(readFileSync(join(ws, "tokens", "primitives.tokens.json"), "utf8"));
  const base = JSON.parse(readFileSync(join(ws, "tokens", "base.tokens.json"), "utf8"));
  const { anchor } = generateScale("#ff90e8", paletteProfile(primitives));
  assert.equal(tokens.color.primary.$value, `{color.brand.${anchor}}`, "primary is the site's exact pink");
  assert.ok(prim.color.brand?.[anchor], "the pink joined the palette as its own scale");
  assert.equal(tokens.color.background.$value, "{color.zinc.100}", "the off-white page");
  assert.equal(base.radius.control.$value, "{radius.full}");
  assert.equal(base.radius.container.$value, `{radius.${look.picks.corners.outer}}`);
  assert.equal(base.font.body.$value, "{font.space-grotesk}");
  assert.equal(s.config.brief.site.url, "https://gumroad.com/");
  const ask = s.chat.messages.find((m) => m.role === "user");
  assert.match(ask.text, /read from a reference website/);
  assert.match(ask.text, /don't name the website/);
});
