// Small display helpers.

/** Readable text for a raw token value (strings as-is, DTCG objects summarized). */
export function showValue(raw: unknown, css: string | null): string {
  if (typeof raw === "string" || typeof raw === "number") return String(raw);
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if ("value" in o && "unit" in o) return `${o.value}${o.unit}`;
    if (Array.isArray(raw)) return raw.every((x) => typeof x !== "object") ? raw.join(", ") : css ?? JSON.stringify(raw);
    return css ?? JSON.stringify(raw);
  }
  return css ?? "";
}

export const ratioLabel = (r: number | null) => (r === null ? "n/a" : r.toFixed(2));

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
