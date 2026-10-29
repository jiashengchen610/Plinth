// Client for the Plinth local API. The session token is injected into index.html by the server. Calls that edit the
// design system go through edit(): the page is locked until they are written and shown.
import { edit } from "@/lib/lock";

const token = document.querySelector<HTMLMetaElement>('meta[name="plinth-token"]')?.content ?? import.meta.env.VITE_PLINTH_TOKEN ?? "";

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "X-Plinth-Token": token, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText}`);
  return json as T;
}

export type ModeValue = { raw: unknown; css: string | null; resolved: string | null; alpha?: number };
export type TokenRow = { name: string; path: string; type: string; source: string; layer?: number; layerId?: string; refs?: string[]; linked?: boolean; description: string; derived: boolean; values: Record<string, ModeValue>;
  /** Corners that fit inside a container: its radius minus the gap, while on. */
  fit?: { outer: string; min: string | null; spacing: number; border: number; on: boolean } };
export type ContrastResult = { brand: string; mode: string; bg: string; fg: string; min: number; ratio: number | null; pass: boolean; accepted?: boolean; exceptionReason?: string };
export type DistinctResult = { brand: string; mode: string; a: string; b: string; deltaE: number; hueDiff: number | null; pass: boolean; reason: string | null; accepted?: boolean; exceptionReason?: string };
export type Hardcoded = { file: string; line: number; rule: string; match: string; hint?: string; snippet?: string; accepted?: boolean; exceptionReason?: string };
export type CheckName = "contrast" | "distinct" | "hardcoded" | "structure";
export type StructureResult = { brand: string; token: string; layer: string; kind: "upward" | "unlinked"; detail: string; pass: boolean; accepted?: boolean; exceptionReason?: string };
export type Exception = { check: CheckName; key: string; reason?: string; at?: string };
export type Op = { op: "set" | "delete" | "rename" | "write"; file: string; path?: string; to?: string; mode?: string; value?: unknown; type?: string; description?: string; alpha?: number; content?: string };
/** What a change reports back. Reminders never stop it. */
export type ChangeResult = {
  title: string; files: string[];
  reminders: {
    contrastFailing: { brand: string; mode: string; fg: string; bg: string; before: number | null; after: number | null; min: number }[];
    contrastFixed: { brand: string; mode: string; fg: string; bg: string; before: number | null; after: number | null }[];
    lookAlike: { brand: string; mode: string; a: string; b: string; reason: string | null }[];
    guidelineNotes: string[];
  };
};
export type Version = { short: string; sha: string; date: string; subject: string; published?: boolean };
export type UnsavedFile = { file: string; status: "modified" | "added" | "deleted" };
export type LastChange = { title: string; by: string; at: string; files: string[] };
export type ReviewState = { running: boolean; since: number | null; result: { ok: boolean; text?: string; error?: string; cost?: number | null; model: string; at: string; seconds: number } | null };
export type Component = { id: string; files: string[]; hasStories: boolean; spec: string | null; usedBy: string[] };
export type Style = { main: string; gray: string; corners: string; font: string | null; headingFont: string | null; labelFont: "body" | "heading"; codeFont: string | null; fontRoles: boolean; outer: string | null; inner: string | null; fitInside: boolean | null; radiusSteps: { step: string; px: number }[]; glass: { tint: string | null; foreground: string | null; recipe: GlassRecipe } | null; hues: string[]; grays: string[] };
/** Chart colors as the Style step shows them: per mode the color and how it looks with each deficiency. */
type ChartSeen = { color: string; protan: string; deutan: string; tritan: string };
export type ChartEntry = { name: string; path?: string; default: ChartSeen; dark?: ChartSeen };
export type ChartView = {
  series: ChartEntry[]; sequential: ChartEntry[]; diverging: ChartEntry[];
  /** Who made them: Plinth now (from the main color's hues), Plinth 0.10 (the most different colors), or by hand. */
  safe: number; madeBy: "plinth" | "older" | "hand"; failing: { mode: string; kind: "contrast" | "distinct"; a: string; b?: string; vision?: string }[];
};
/** Values that differ from the published version: per token, brand and mode, as written and as resolved. */
type RoundValue = { value: unknown; resolved: string | null; alpha?: number } | null;
export type RoundChanges = { since: string; tokens: { token: string; path: string; brand: string; mode: string; layer: string | null; before: RoundValue; after: RoundValue }[]; tokensChanged: number; files: { file: string; status: string }[] };
/** Claude's values for a short request about a picked element; chat: it needs more than values (ask in the chat). */
export type QuickEdit = { changes: { path: string; kind: "color" | "radius" | "text"; to: string }[]; reply: string; chat: boolean; seconds?: number; cost?: number | null; error: string | null };
/** A glass recipe: how much of its color shows, blur (px), saturation (1 = unchanged), edge light, ripple (0–1). */
export type GlassRecipe = { tintOpacity: number; blur: number; saturation: number; highlight: number; distortion: number };
export type Brief = { product: string; feel?: string; kind?: string; palette?: string; brandColor?: string; corners?: string; font?: string; components?: string[]; extraText?: string; answeredAt?: string;
  /** Where the look came from, when it was read from a website. */
  site?: { url: string; name: string | null; picks: Omit<SitePicks, "url" | "name"> } };
export type SetupStep = { id: string; label: string; who: string; status: "waiting" | "active" | "done" | "error"; detail?: string };
export type SetupState = { running: boolean; fresh: boolean; startedAt: string; finishedAt: string | null; error: string | null; cost: number | null; steps: SetupStep[] } | null;
export type Presets = {
  kinds: { id: string; label: string }[]; feels: string[]; fonts: { family: string; mood: string; kind?: "sans" | "serif" }[];
  components: { id: string; name: string; hint: string; ready?: boolean; core?: boolean }[];
  kindComponents: Record<string, string[]>;
  palettes: { id: string; name: string; mood: string; main: string; gray: string; swatches: (string | null)[]; main600: string | null }[];
  corners: { id: string; name: string; control: string | null; container: string | null }[];
  glass?: { id: string; name: string; recipe: GlassRecipe }[];
};
export type Suggestions = { name: string | null; kind: string; feels: string[]; palette: string; corners: string; font: string; components: string[]; question: string | null; answers?: string[];
  /** Why each pick fits, in Claude's words. */
  why?: Partial<Record<"palette" | "corners" | "font" | "components", string>>; by: "claude" | "fallback"; error?: string; seconds?: number; cost?: number | null };
export type Answers = { product: string; name?: string; feel: string; kind: string; palette: string; brandColor?: string; corners: string; font: string; components: string[]; extraText: string; site?: SitePicks };
/** A main color as a palette pick: a step of a family, or a color of its own (it gets its own scale). */
export type MainPick = { family?: string; step?: string; custom?: string; color: string };
export type FontFound = { family: string; from: string; free: boolean };
/** The look read from a website, as Describe's answers use it ("site" for palette, corners and font). */
export type SitePicks = {
  url: string; name: string | null;
  main: MainPick | null; gray: string; background: string | null;
  corners: { preset: string; inner?: string; outer?: string } | null;
  fonts: { font: string; headingFont: string; labelFont: string } | null;
};
export type SiteRead = {
  url: string; seconds: number; favicon: string | null; accent: MainPick | null;
  swatches: { gray: string[]; main: string[] };
  look: {
    found: { name: string | null; url: string | null; main?: { color: string; from: string; text?: string }; gray: string; accent?: string; background?: string; corners: { buttons: number | "pill" | null; cards: number | null }; fonts: { body: FontFound | null; heading: FontFound | null; label: FontFound | null } };
    picks: Omit<SitePicks, "url" | "name">;
    notes: string[];
  };
};
export type TestResult = {
  ok: boolean; at?: string; error?: string; next?: string;
  typecheck?: { ok: boolean; tail?: string };
  /** flaky: tests that failed once and passed when run again (a timing fluke worth fixing; it does not stop a publish). */
  tests?: { ok: boolean; passed: number | null; failed: number | null; total: number | null; failures: string[]; flaky?: string[]; tail?: string };
};
export type PublishStep = { name: string; ok: boolean; detail: unknown };
export type PublishResult = {
  published: boolean; dryRun?: boolean; stoppedAt?: string; error?: string; next?: string; note?: string; version?: string; at?: string;
  github?: string; actions?: string; storybook?: string | null; steps: PublishStep[]; tests?: TestResult; pagesBlocked?: "plan" | null; repo?: string;
  blocking?: { kind: string; detail: string }[]; unsaved?: UnsavedFile[];
};
export type PublishState = { running: boolean; steps: PublishStep[]; result: PublishResult | null; startedAt: string | null };
export type PublishDefaults = {
  ghInstalled: boolean; ghAuthed: boolean; scopesOk: boolean; missingScopes: string[]; user: string | null; plan: string | null;
  privatePagesAllowed: boolean | null; suggestedVisibility: "private" | "public";
  remote: string | null; repo: string | null; suggestedRepo: string;
  /** Another repository to publish to (free on GitHub), and whether the design system started from scratch since the last publish. */
  suggestedAnother: string | null; scratchSincePublish: boolean;
  visibility: "PUBLIC" | "PRIVATE" | "INTERNAL" | null; pagesEnabled: boolean | null;
};
/** What GitHub did with the last publish (the workflow tests, then deploys). */
export type Deploy = {
  status: "waiting" | "running" | "live" | "failed" | "unknown"; sha: string; pushedAt?: string; repo?: string; github?: string; actions: string;
  run?: string; since?: string; site?: string | null; step?: string | null; failures?: string[]; errors?: string[]; error?: string;
} | null;
/** A description of the next version: the engine's at once, Claude's when it is ready. The user confirms or changes it. */
export type VersionDraft = { key: string; text: string | null; by: "plinth" | "claude" | "none"; seconds?: number; cost?: number | null };
export type GithubLogin = { status: "idle" | "starting" | "waiting" | "done" | "error"; code?: string; url?: string; since?: number; error?: string };
export type ChatMessage = { id: string; role: "user" | "assistant"; text: string; images?: string[]; mentions?: VocabMention[]; at: string; tools?: string[]; error?: boolean; cost?: number };
/** One name from the shared vocabulary: a component, a look, a palette, a font, corners or glass. */
export type VocabKind = "component" | "look" | "color" | "font" | "corners" | "glass";
export type VocabEntry = {
  id: string; kind: VocabKind; key: string; name: string; hint: string; aliases: string[];
  /** A component the design system already has. */
  inSystem: boolean;
  /** A style pick that is already the current setting. */
  current: boolean;
  /** What picking it does (ops Plinth runs itself), or null when there is nothing to apply. */
  apply: { tool: string; args: Record<string, unknown> }[] | null;
  art: { glyph?: string; swatches?: (string | null)[]; corners?: string | null; container?: string | null; font?: string; kind?: string; glass?: GlassRecipe | null };
};
export type VocabMention = { id: string; kind: VocabKind; name: string };
export type ChatState = { messages: ChatMessage[]; working: boolean; activity: { since: number; tool: string | null; steps: number } | null; session: string | null; error: string | null };
export type ChatImage = { type: string; data: string; name: string };
export type State = {
  rev: number; exists: boolean; workspace: string;
  chat: ChatState | null;
  review: ReviewState | null;
  deps: { installed: boolean; installing: boolean; error: string | null };
  tests: { running: boolean; last: TestResult | null };
  publish: PublishState;
  github: GithubLogin;
  setup: SetupState;
  // Present when exists is true.
  config: { name: string; context: string; naming: string; defaultBrand: string; brands: { id: string; name?: string }[]; exceptions?: Exception[]; brief?: Brief };
  style: Record<string, Style>;
  brands: string[];
  tokens: Record<string, { modes: string[]; layers?: { id: string; name: string }[]; issues: string[]; rows: TokenRow[] }>;
  checks: {
    gate: boolean;
    summary: Record<string, { ok: boolean; failing?: number; count?: number; accepted?: number; issues?: string[] }>;
    warnings: { check: string; count: number }[];
    contrast: ContrastResult[]; distinct: DistinctResult[]; structure: StructureResult[]; hardcoded: Hardcoded[]; tokenIssues: string[]; exceptions: Exception[];
  };
  components: Component[];
  guidelines: { shared: string | null; writing: string | null; brands: Record<string, string | null> };
  unsaved: UnsavedFile[];
  lastChange: LastChange | null;
  layers: { id: string; name?: string; files: string[] }[] | null;
  /** What Upgrade would do for a design system made by an older Plinth. */
  upgradeAvailable: "layers" | "typography" | "components" | false;
  versions: Version[];
  /** This round of work: what differs from the published version (null published: never published). */
  round: { published: string | null; versions?: number; files?: number; steps?: { style: boolean; components: boolean } };
  storybook: string | null;
};
export const inboxUrl = (path: string) => `/inbox/${path.split("/").pop()}?t=${encodeURIComponent(token)}`;

export type StoryEntry = { id: string; title: string; name: string; type: "story" | "docs"; importPath: string };

export const api = {
  rev: () => call<{ rev: number }>("GET", "/api/rev"),
  state: () => call<State>("GET", "/api/state"),
  sendChat: (text: string, images: ChatImage[], mentions: string[] = []) => call<{ id: string }>("POST", "/api/chat", { text, images: images.map(({ type, data }) => ({ type, data })), mentions }),
  /** The shared vocabulary, with what this design system has and uses. */
  vocab: () => call<{ entries: VocabEntry[] }>("GET", "/api/vocab"),
  /** Apply one entry (a look, a palette, corners, a font, glass, or add a component) without Claude. */
  applyVocab: (brand: string, id: string) => edit("Applying your pick", () => call<Partial<ChangeResult> & { unchanged?: boolean; message?: string }>("POST", "/api/vocab/apply", { brand, id })),
  stopChat: () => call<{ stopped: boolean }>("POST", "/api/chat/stop"),
  resetChat: () => call<{ reset: boolean }>("POST", "/api/chat/reset"),
  install: () => call<{ started: boolean }>("POST", "/api/install"),
  runTests: () => call<{ started: boolean }>("POST", "/api/tests"),
  change: (title: string, ops: Op[]) => edit("Making your change", () => call<ChangeResult>("POST", "/api/change", { title, ops })),
  undo: () => edit("Undoing", () => call<{ undone: string; files: string[] }>("POST", "/api/undo")),
  save: (message: string) => edit("Saving a version", () => call<{ version: string | null; message?: string }>("POST", "/api/save", { message })),
  discardUnsaved: () => edit("Throwing away the changes", () => call<{ discarded: string[] }>("POST", "/api/discard")),
  review: () => call<{ started: boolean }>("POST", "/api/review"),
  restore: (sha: string) => edit("Going back to that version", () => call<{ version: string }>("POST", `/api/versions/${sha}/restore`)),
  fixContrast: () => edit("Fixing contrast", () => call<Partial<ChangeResult> & { message?: string; fixes?: string[] }>("POST", "/api/contrast-fixes")),
  acceptException: (check: CheckName, key: string, reason: string) => edit("Marking it as on purpose", () => call<{ accepted: string }>("POST", "/api/exceptions", { check, key, reason })),
  removeException: (check: CheckName, key: string) => edit("Making your change", () => call<{ removed: string }>("POST", "/api/exceptions/remove", { check, key })),
  startStorybook: () => call<{ url?: string; error?: string; next?: string }>("POST", "/api/storybook/start"),
  storyIndex: () => call<{ running: boolean; url?: string; entries: StoryEntry[] }>("GET", "/api/storybook/index"),
  publishDefaults: () => call<PublishDefaults>("GET", "/api/publish/defaults"),
  /** another: publish to repo, a new repository, instead of the current one. */
  publish: (opts: { repo?: string; visibility?: "private" | "public"; another?: boolean }) => call<{ started: boolean }>("POST", "/api/publish", opts),
  /** Deletes the design system's content (the user confirmed); what there was is saved as a version first. */
  startFromScratch: () => edit("Starting from scratch", () => call<Partial<ChangeResult> & { saved?: string | null; version?: string | null; unchanged?: boolean }>("POST", "/api/start-from-scratch")),
  makePublicAndDeploy: () => call<{ github: string; actions: string; storybook: string | null; note: string }>("POST", "/api/publish/make-public"),
  redeploy: () => call<{ github: string; actions: string; storybook: string | null; note: string }>("POST", "/api/publish/redeploy"),
  upgrade: () => edit("Upgrading", () => call<Partial<ChangeResult> & { message?: string }>("POST", "/api/upgrade")),
  linkPalette: () => edit("Linking colors to the palette", () => call<Partial<ChangeResult> & { message?: string; linked?: string[]; unmatched?: unknown[] }>("POST", "/api/link-palette")),
  /** Adds a color to the palette; with use, one of your colors points at it in the same change. */
  addPaletteColor: (name: string, color: string, use?: { brand: string; role: string; mode: "default" | "dark"; title?: string }) => edit("Adding the color", () => call<ChangeResult & { name: string; anchor: string; shades: Record<string, string> }>("POST", "/api/palette", { name, color, ...use })),
  presets: () => call<Presets>("GET", "/api/presets"),
  suggest: (product: string) => call<Suggestions>("POST", "/api/suggest", { product }),
  readSite: (url: string) => call<SiteRead>("POST", "/api/read-site", { url }),
  setup: (answers: Answers) => call<{ started: boolean }>("POST", "/api/setup", answers),
  style: (brand: string, pick: Partial<Pick<Style, "main" | "gray" | "corners" | "labelFont">> & { outer?: string; inner?: string; fitInside?: boolean; font?: string; headingFont?: string }) => edit("Changing the style", () => call<Partial<ChangeResult> & { unchanged?: boolean }>("POST", "/api/style", { brand, ...pick })),
  removeComponent: (name: string) => edit("Removing the component", () => call<ChangeResult>("POST", "/api/remove-component", { name })),
  /** One part's color: everywhere its color is used (scope role), or only this part with a new color (scope part). */
  partColor: (b: { brand: string; part: string; color: string; mode: "default" | "dark"; scope: "role" | "part"; name?: string; title?: string }) => edit("Changing the color", () => call<Partial<ChangeResult> & { unchanged?: boolean; role: string; made?: boolean }>("POST", "/api/part-color", b)),
  /** This round's values before → after (null before the first publish). */
  roundChanges: () => call<{ changes: RoundChanges | null }>("GET", "/api/round-changes"),
  /** A short request about a picked element, turned into values to confirm (nothing is written). */
  quickEdit: (b: { brand: string; mode: "default" | "dark"; title: string; picks: { path: string; prop: string; kind: string; state: string | null }[]; text: string }) => call<QuickEdit>("POST", "/api/quick-edit", b),
  roleColor: (brand: string, role: string, color: string, mode: "default" | "dark", title: string) => edit("Changing the color", () => call<Partial<ChangeResult> & { unchanged?: boolean }>("POST", "/api/role-color", { brand, role, color, mode, title })),
  glass: (brand: string, glass: GlassRecipe & { tint: string }) => edit("Saving the glass", () => call<Partial<ChangeResult> & { unchanged?: boolean }>("POST", "/api/glass", { brand, ...glass })),
  glassCheck: (brand: string, tint: string, tintOpacity: number) => call<{ foreground: string; contrast: { mode: string; backdrop: string; ratio: number | null; pass: boolean }[]; minOpacity: number | null }>("GET", `/api/glass-check?brand=${encodeURIComponent(brand)}&tint=${encodeURIComponent(tint)}&tintOpacity=${tintOpacity}`),
  chart: (brand: string) => call<{ chart: ChartView | null }>("GET", `/api/chart?brand=${encodeURIComponent(brand)}`),
  makeChart: (brand: string) => edit("Making chart colors", () => call<Partial<ChangeResult> & { unchanged?: boolean }>("POST", "/api/chart", { brand })),
  addComponent: (name: string) => edit("Adding the component", () => call<ChangeResult>("POST", "/api/add-component", { name })),
  deploy: () => call<{ deploy: Deploy }>("GET", "/api/deploy"),
  versionDraft: () => call<VersionDraft>("GET", "/api/version-draft"),
  versionDraftByClaude: () => call<VersionDraft>("POST", "/api/version-draft"),
  colorName: (color: string) => call<{ name: string }>("GET", `/api/color-name?color=${encodeURIComponent(color)}`),
  githubLogin: () => call<GithubLogin>("POST", "/api/github/login"),
  githubCancel: () => call<GithubLogin>("POST", "/api/github/cancel"),
};

/** Key of a check result, matching the server's exceptionKey. */
export const exceptionKey = {
  contrast: (r: ContrastResult) => `${r.brand}|${r.mode}|${r.bg}|${r.fg}`,
  distinct: (r: DistinctResult) => `${r.brand}|${r.mode}|${r.a}|${r.b}`,
  hardcoded: (f: Hardcoded) => `${f.file}|${f.rule}|${f.match}`,
  structure: (r: StructureResult) => `${r.brand}|${r.kind}|${r.token}`,
};
