// Client for the Plinth local API. The session token is injected into index.html by the server.
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
export type TokenRow = { name: string; path: string; type: string; source: string; layer?: number; layerId?: string; refs?: string[]; linked?: boolean; description: string; derived: boolean; values: Record<string, ModeValue> };
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
export type Style = { main: string; gray: string; corners: string; font: string | null; hues: string[]; grays: string[] };
export type Brief = { product: string; feel?: string; kind?: string; palette?: string; brandColor?: string; corners?: string; font?: string; components?: string[]; extraText?: string; answeredAt?: string };
export type SetupStep = { id: string; label: string; who: string; status: "waiting" | "active" | "done" | "error"; detail?: string };
export type SetupState = { running: boolean; fresh: boolean; startedAt: string; finishedAt: string | null; error: string | null; cost: number | null; steps: SetupStep[] } | null;
export type Presets = {
  kinds: { id: string; label: string }[]; feels: string[]; fonts: { family: string; mood: string }[];
  components: { id: string; name: string; hint: string; ready?: boolean }[];
  palettes: { id: string; name: string; mood: string; main: string; gray: string; swatches: (string | null)[]; main600: string | null }[];
  corners: { id: string; name: string; control: string | null; container: string | null }[];
};
export type Suggestions = { name: string | null; kind: string; feels: string[]; palette: string; corners: string; font: string; components: string[]; question: string | null; by: "claude" | "fallback"; error?: string; seconds?: number; cost?: number | null };
export type Answers = { product: string; name?: string; feel: string; kind: string; palette: string; brandColor?: string; corners: string; font: string; components: string[]; extraText: string };
export type TestResult = {
  ok: boolean; at?: string; error?: string; next?: string;
  typecheck?: { ok: boolean; tail?: string };
  tests?: { ok: boolean; passed: number | null; failed: number | null; total: number | null; failures: string[]; tail?: string };
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
  visibility: "PUBLIC" | "PRIVATE" | "INTERNAL" | null; pagesEnabled: boolean | null;
};
export type GithubLogin = { status: "idle" | "starting" | "waiting" | "done" | "error"; code?: string; url?: string; since?: number; error?: string };
export type ChatMessage = { id: string; role: "user" | "assistant"; text: string; images?: string[]; at: string; tools?: string[]; error?: boolean; cost?: number };
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
  upgradeAvailable: boolean;
  versions: Version[];
  storybook: string | null;
};
export const inboxUrl = (path: string) => `/inbox/${path.split("/").pop()}?t=${encodeURIComponent(token)}`;

export type StoryEntry = { id: string; title: string; name: string; type: "story" | "docs"; importPath: string };

export const api = {
  rev: () => call<{ rev: number }>("GET", "/api/rev"),
  state: () => call<State>("GET", "/api/state"),
  sendChat: (text: string, images: ChatImage[]) => call<{ id: string }>("POST", "/api/chat", { text, images: images.map(({ type, data }) => ({ type, data })) }),
  stopChat: () => call<{ stopped: boolean }>("POST", "/api/chat/stop"),
  resetChat: () => call<{ reset: boolean }>("POST", "/api/chat/reset"),
  install: () => call<{ started: boolean }>("POST", "/api/install"),
  runTests: () => call<{ started: boolean }>("POST", "/api/tests"),
  change: (title: string, ops: Op[]) => call<ChangeResult>("POST", "/api/change", { title, ops }),
  undo: () => call<{ undone: string; files: string[] }>("POST", "/api/undo"),
  save: (message: string) => call<{ version: string | null; message?: string }>("POST", "/api/save", { message }),
  discardUnsaved: () => call<{ discarded: string[] }>("POST", "/api/discard"),
  review: () => call<{ started: boolean }>("POST", "/api/review"),
  restore: (sha: string) => call<{ version: string }>("POST", `/api/versions/${sha}/restore`),
  fixContrast: () => call<Partial<ChangeResult> & { message?: string; fixes?: string[] }>("POST", "/api/contrast-fixes"),
  acceptException: (check: CheckName, key: string, reason: string) => call<{ accepted: string }>("POST", "/api/exceptions", { check, key, reason }),
  removeException: (check: CheckName, key: string) => call<{ removed: string }>("POST", "/api/exceptions/remove", { check, key }),
  startStorybook: () => call<{ url?: string; error?: string; next?: string }>("POST", "/api/storybook/start"),
  storyIndex: () => call<{ running: boolean; url?: string; entries: StoryEntry[] }>("GET", "/api/storybook/index"),
  publishDefaults: () => call<PublishDefaults>("GET", "/api/publish/defaults"),
  publish: (opts: { repo?: string; visibility?: "private" | "public" }) => call<{ started: boolean }>("POST", "/api/publish", opts),
  makePublicAndDeploy: () => call<{ github: string; actions: string; storybook: string | null; note: string }>("POST", "/api/publish/make-public"),
  redeploy: () => call<{ github: string; actions: string; storybook: string | null; note: string }>("POST", "/api/publish/redeploy"),
  upgrade: () => call<Partial<ChangeResult> & { message?: string }>("POST", "/api/upgrade"),
  linkPalette: () => call<Partial<ChangeResult> & { message?: string; linked?: string[]; unmatched?: unknown[] }>("POST", "/api/link-palette"),
  addPaletteColor: (name: string, color: string) => call<ChangeResult & { name: string; anchor: string; shades: Record<string, string> }>("POST", "/api/palette", { name, color }),
  presets: () => call<Presets>("GET", "/api/presets"),
  suggest: (product: string) => call<Suggestions>("POST", "/api/suggest", { product }),
  setup: (answers: Answers) => call<{ started: boolean }>("POST", "/api/setup", answers),
  style: (brand: string, pick: Partial<Pick<Style, "main" | "gray" | "corners">> & { font?: string }) => call<Partial<ChangeResult> & { unchanged?: boolean }>("POST", "/api/style", { brand, ...pick }),
  removeComponent: (name: string) => call<ChangeResult>("POST", "/api/remove-component", { name }),
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
