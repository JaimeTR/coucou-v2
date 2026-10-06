// "data.items.0.count" read out of a JSON value; numbers and booleans become text.
// The same rule as the desktop app's "Mis apps" (windows/src-tauri/src/custom.rs).

export function extract(value: unknown, path: string): string | null {
  let at: unknown = value;
  for (const part of path.split(".").filter((p) => p.length > 0)) {
    if (Array.isArray(at)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= at.length) return null;
      at = at[index];
    } else if (at !== null && typeof at === "object" && part in (at as Record<string, unknown>)) {
      at = (at as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  if (at === null || at === undefined) return null;
  if (typeof at === "string") return at.trim().slice(0, 80);
  if (typeof at === "number" || typeof at === "boolean") return String(at);
  return JSON.stringify(at).slice(0, 80);
}
