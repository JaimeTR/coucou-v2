// Codex's plan limits: what `codex app-server` answers to `account/rateLimits/read`
// (src-tauri/src/codex_plan.rs), in the same shape as Claude's PlanUsage.

import type { PlanUsage, PlanWindow } from "./state";

export interface CodexPlanUsage extends PlanUsage {
  /** Free full resets available. */
  resetCredits?: number;
  /** Soonest expiry among the available ones (epoch seconds). */
  resetCreditExpiresAt?: number;
  planType?: string;
}

/** How long an answer stays good before the card asks again. */
export const CODEX_STALE_MS = 60_000;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const asObj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * The result of `account/rateLimits/read`. `primary` and `secondary` are not tied
 * to a window, so they are sorted by duration: a day or less is the 5-hour window,
 * anything else (or no duration) the week. Nothing usable → null.
 */
export function parseCodexPlan(result: unknown, now = Date.now()): CodexPlanUsage | null {
  const r = asObj(result);
  const limits = asObj(r?.rateLimits);
  if (!limits) return null;
  const usage: CodexPlanUsage = { fiveHour: null, sevenDay: null, updatedAt: now };
  if (typeof limits.planType === "string" && limits.planType) usage.planType = limits.planType;
  for (const key of ["primary", "secondary"]) {
    const w = asObj(limits[key]);
    if (!w || !isNum(w.usedPercent) || !isNum(w.resetsAt)) continue;
    const window: PlanWindow = { used: Math.min(100, Math.max(0, w.usedPercent)), resetsAt: w.resetsAt };
    if (Number.isInteger(w.windowDurationMins) && (w.windowDurationMins as number) <= 24 * 60) usage.fiveHour = window;
    else usage.sevenDay = window;
  }
  const credits = asObj(r?.rateLimitResetCredits);
  if (credits) {
    if (Number.isInteger(credits.availableCount)) usage.resetCredits = credits.availableCount as number;
    const expiries = (Array.isArray(credits.credits) ? credits.credits : [])
      .map(asObj)
      .filter((c) => c?.status === "available" && isNum(c.expiresAt))
      .map((c) => c!.expiresAt as number);
    if (expiries.length) usage.resetCreditExpiresAt = Math.min(...expiries);
  }
  return usage.fiveHour || usage.sevenDay ? usage : null;
}

/** True when there are no numbers or they are older than a minute. */
export const codexIsStale = (u: CodexPlanUsage | null, now = Date.now()): boolean =>
  !u || now - u.updatedAt >= CODEX_STALE_MS;

/** "2 disponibles", or "" when Codex said nothing about free resets. */
export function codexResetsLabel(u: CodexPlanUsage | null): string {
  if (u?.resetCredits == null) return "";
  return u.resetCredits === 1 ? "1 reinicio gratis disponible" : `${u.resetCredits} reinicios gratis disponibles`;
}
