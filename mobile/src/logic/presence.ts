// How long ago a device reported, and whether it counts as online. Pure.

/** A device that reported in the last minute and a half is online. */
export const ONLINE_MS = 90_000;

export const isOnline = (at: number, now = Date.now()) => now - at < ONLINE_MS;

/** "ahora", "3 min", "2 h", "4 d": the Spanish source, run through t() by the caller for "ahora". */
export function ago(at: number, t: (es: string) => string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return t("ahora");
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86_400)} d`;
}
