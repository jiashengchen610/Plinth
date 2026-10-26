// Client for the Plinth local API. The session token is injected into index.html by the server.
const token = document.querySelector<HTMLMetaElement>('meta[name="plinth-token"]')?.content ?? import.meta.env.VITE_PLINTH_TOKEN ?? "";

async function call<T>(method: "GET" | "POST", path: string): Promise<T> {
  const res = await fetch(path, { method, headers: { "X-Plinth-Token": token } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export type ModeValue = { raw: unknown; css: string | null; resolved: string | null };
export type TokenRow = { name: string; path: string; type: string; source: string; description: string; derived: boolean; values: Record<string, ModeValue> };
export type ContrastResult = { brand: string; mode: string; bg: string; fg: string; min: number; ratio: number | null; pass: boolean };
export type Op = { op: "set" | "delete" | "rename" | "write"; file: string; path?: string; to?: string; mode?: string; value?: unknown; content?: string };
export type Change = {
  id: string; title: string; rationale: string; by: string; createdAt: string; ops: Op[];
  preview: { files: string[]; failingAfter: number; issues: string[]; contrastChanges: (ContrastResult & { before: number | null })[] };
};
export type Version = { short: string; sha: string; date: string; subject: string };
export type Component = { id: string; files: string[]; hasStories: boolean; spec: string | null };
export type State = {
  rev: number; exists: boolean; workspace: string;
  config: { name: string; context: string; naming: string; defaultBrand: string; brands: { id: string; name?: string }[] };
  brands: string[];
  tokens: Record<string, { modes: string[]; issues: string[]; rows: TokenRow[] }>;
  checks: { gate: boolean; summary: Record<string, { ok: boolean } & Record<string, unknown>>; contrast: ContrastResult[]; hardcoded: { file: string; line: number; rule: string; match: string }[]; tokenIssues: string[] };
  components: Component[];
  guidelines: { shared: string | null; writing: string | null; brands: Record<string, string | null> };
  pending: Change[];
  versions: Version[];
  storybook: string | null;
};
export type StoryEntry = { id: string; title: string; name: string; type: "story" | "docs"; importPath: string };

export const api = {
  rev: () => call<{ rev: number }>("GET", "/api/rev"),
  state: () => call<State>("GET", "/api/state"),
  apply: (id: string) => call<{ version: string }>("POST", `/api/changes/${id}/apply`),
  discard: (id: string) => call<unknown>("POST", `/api/changes/${id}/discard`),
  restore: (sha: string) => call<{ version: string }>("POST", `/api/versions/${sha}/restore`),
  fixContrast: () => call<{ id?: string; message?: string }>("POST", "/api/contrast-fixes"),
  startStorybook: () => call<{ url?: string; error?: string; next?: string }>("POST", "/api/storybook/start"),
  storyIndex: () => call<{ running: boolean; url?: string; entries: StoryEntry[] }>("GET", "/api/storybook/index"),
};
