const PLACEHOLDERS = new Set([
  "unknown", "undefined", "null", "n/a", "none", "-", "auto", "default",
]);

/** Muse reports a scalar selection on the firing event, including subagents. */
export function modelId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  if (!id || id.startsWith("{") || id.startsWith("[") || PLACEHOLDERS.has(id.toLowerCase())) return undefined;
  return id;
}
