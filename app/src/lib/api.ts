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

export type ModeValue = { raw: unknown; css: string | null; resolved: string | null };
export type TokenRow = { name: string; path: string; type: string; source: string; description: string; derived: boolean; values: Record<string, ModeValue> };
export type ContrastResult = { brand: string; mode: string; bg: string; fg: string; min: number; ratio: number | null; pass: boolean; accepted?: boolean; exceptionReason?: string };
export type DistinctResult = { brand: string; mode: string; a: string; b: string; deltaE: number; hueDiff: number | null; pass: boolean; reason: string | null; accepted?: boolean; exceptionReason?: string };
export type Hardcoded = { file: string; line: number; rule: string; match: string; hint?: string; snippet?: string; accepted?: boolean; exceptionReason?: string };
export type CheckName = "contrast" | "distinct" | "hardcoded";
export type Exception = { check: CheckName; key: string; reason?: string; at?: string };
export type Op = { op: "set" | "delete" | "rename" | "write"; file: string; path?: string; to?: string; mode?: string; value?: unknown; content?: string };
export type Change = {
  id: string; title: string; rationale: string; by: string; createdAt: string; ops: Op[];
  preview: { files: string[]; failingAfter: number; issues: string[]; notes?: string[]; distinctFailures?: DistinctResult[]; contrastChanges: (ContrastResult & { before: number | null })[] };
};
export type Version = { short: string; sha: string; date: string; subject: string; outside?: boolean };
export type OutsideChange = { file: string; status: "modified" | "added" | "deleted" };
export type Component = { id: string; files: string[]; hasStories: boolean; spec: string | null };
export type TestResult = {
  ok: boolean; at?: string; error?: string; next?: string;
  typecheck?: { ok: boolean; tail?: string };
  tests?: { ok: boolean; passed: number | null; failed: number | null; total: number | null; failures: string[]; tail?: string };
};
export type PublishStep = { name: string; ok: boolean; detail: unknown };
export type PublishResult = {
  published: boolean; dryRun?: boolean; stoppedAt?: string; error?: string; next?: string; note?: string; version?: string; at?: string;
  github?: string; actions?: string; storybook?: string | null; steps: PublishStep[]; tests?: TestResult; pagesBlocked?: "plan" | null; repo?: string;
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
export type ChatState = { messages: ChatMessage[]; working: boolean; terminal?: boolean; activity: { since: number; tool: string | null; steps: number } | null; session: string | null; error: string | null };
export type ChatImage = { type: string; data: string; name: string };
export type State = {
  rev: number; exists: boolean; workspace: string;
  chat: ChatState | null;
  deps: { installed: boolean; installing: boolean; error: string | null };
  tests: { running: boolean; last: TestResult | null };
  publish: PublishState;
  github: GithubLogin;
  // Present when exists is true.
  config: { name: string; context: string; naming: string; defaultBrand: string; brands: { id: string; name?: string }[]; exceptions?: Exception[] };
  brands: string[];
  tokens: Record<string, { modes: string[]; issues: string[]; rows: TokenRow[] }>;
  checks: {
    gate: boolean;
    summary: Record<string, { ok: boolean; failing?: number; count?: number; accepted?: number; issues?: string[] }>;
    contrast: ContrastResult[]; distinct: DistinctResult[]; hardcoded: Hardcoded[]; tokenIssues: string[]; exceptions: Exception[];
  };
  components: Component[];
  guidelines: { shared: string | null; writing: string | null; brands: Record<string, string | null> };
  pending: Change[];
  outside: OutsideChange[];
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
  apply: (id: string) => call<{ version: string }>("POST", `/api/changes/${id}/apply`),
  discard: (id: string) => call<unknown>("POST", `/api/changes/${id}/discard`),
  restore: (sha: string) => call<{ version: string }>("POST", `/api/versions/${sha}/restore`),
  fixContrast: () => call<{ id?: string; message?: string }>("POST", "/api/contrast-fixes"),
  acceptException: (check: CheckName, key: string, reason: string) => call<{ version: string }>("POST", "/api/exceptions", { check, key, reason }),
  removeException: (check: CheckName, key: string) => call<{ version: string }>("POST", "/api/exceptions/remove", { check, key }),
  startStorybook: () => call<{ url?: string; error?: string; next?: string }>("POST", "/api/storybook/start"),
  storyIndex: () => call<{ running: boolean; url?: string; entries: StoryEntry[] }>("GET", "/api/storybook/index"),
  publishDefaults: () => call<PublishDefaults>("GET", "/api/publish/defaults"),
  publish: (opts: { repo?: string; visibility?: "private" | "public" }) => call<{ started: boolean }>("POST", "/api/publish", opts),
  makePublicAndDeploy: () => call<{ github: string; actions: string; storybook: string | null; note: string }>("POST", "/api/publish/make-public"),
  redeploy: () => call<{ github: string; actions: string; storybook: string | null; note: string }>("POST", "/api/publish/redeploy"),
  recordOutside: (note: string) => call<{ version: string | null }>("POST", "/api/outside/record", { note }),
  discardOutside: () => call<{ discarded: string[] }>("POST", "/api/outside/discard"),
  githubLogin: () => call<GithubLogin>("POST", "/api/github/login"),
  githubCancel: () => call<GithubLogin>("POST", "/api/github/cancel"),
};

/** Key of a check result, matching the server's exceptionKey. */
export const exceptionKey = {
  contrast: (r: ContrastResult) => `${r.brand}|${r.mode}|${r.bg}|${r.fg}`,
  distinct: (r: DistinctResult) => `${r.brand}|${r.mode}|${r.a}|${r.b}`,
  hardcoded: (f: Hardcoded) => `${f.file}|${f.rule}|${f.match}`,
};
