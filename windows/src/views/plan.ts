// Claude plan usage — the header pill and the card it opens (docs/INTEGRATIONS.md
// §1bis). Colour: green under 50 %, orange up to 80 %, red above, grey without data.

import { h, svg, dot } from "./dom";
import { ICONS } from "./icons";
import type { PlanUsage, PlanWindow } from "../core/state";

export const PLAN_GREEN = "#22C55E";
export const PLAN_ORANGE = "#F59E0B";
export const PLAN_RED = "#F4505E";
export const PLAN_GREY = "#6B7079";

export function planColor(percent: number | null): string {
  if (percent == null) return PLAN_GREY;
  if (percent < 50) return PLAN_GREEN;
  if (percent < 80) return PLAN_ORANGE;
  return PLAN_RED;
}

/** A window whose reset time has passed reads 0 % until the next update. */
export function planNow(w: PlanWindow | null, nowMs = Date.now()): number | null {
  if (!w) return null;
  if (w.resetsAt != null && w.resetsAt * 1000 <= nowMs) return 0;
  return w.used;
}

/** The figure the header pill shows: the 5-hour window, else the 7-day one. */
export function primaryPercent(plan: PlanUsage | null, nowMs = Date.now()): number | null {
  if (!plan) return null;
  return planNow(plan.fiveHour, nowMs) ?? planNow(plan.sevenDay, nowMs);
}

/** "2h 14m", "35m", "3d 4h" — time left before a window resets. */
export function untilReset(resetsAt: number | null, nowMs = Date.now()): string {
  if (resetsAt == null) return "";
  const seconds = Math.round(resetsAt - nowMs / 1000);
  if (seconds <= 0) return "now";
  const minutes = Math.floor(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${Math.max(1, minutes)}m`;
}

function windowRow(label: { short: string; long: string }, w: PlanWindow | null): HTMLElement {
  const percent = planNow(w);
  const color = planColor(percent);
  const fill = h("i", { style: `width:${percent ?? 0}%;background:${color}` });
  return h(
    "div",
    { class: "plan-row" },
    h("span", { class: "plan-label", title: label.long, text: label.short }),
    h("div", { class: "plan-bar" }, fill),
    h("span", {
      class: "plan-pct",
      style: `color:${color}`,
      text: percent == null ? "—" : `${Math.round(percent)}%`,
    }),
    h("span", {
      class: "plan-reset",
      title: w?.resetsAt != null ? `Resets in ${untilReset(w.resetsAt)}` : "",
      text: w?.resetsAt != null ? `↻ ${untilReset(w.resetsAt)}` : "",
    }),
  );
}

/** Both windows on one line, for the Claude Code card: `5h ▮▮▯ 63%   7d ▮▯▯ 21%`. */
export function miniUsage(plan: PlanUsage): HTMLElement {
  const group = (label: string, w: PlanWindow | null) => {
    const percent = planNow(w);
    const color = planColor(percent);
    return h(
      "span",
      { class: "plan-mini-group", title: w?.resetsAt != null ? `Resets in ${untilReset(w.resetsAt)}` : "" },
      h("span", { class: "plan-mini-label", text: label }),
      h("span", { class: "plan-bar mini" }, h("i", { style: `width:${percent ?? 0}%;background:${color}` })),
      h("span", { class: "plan-mini-pct", style: `color:${color}`, text: percent == null ? "—" : `${Math.round(percent)}%` }),
    );
  };
  return h("div", { class: "plan-mini" }, group("5h", plan.fiveHour), group("7d", plan.sevenDay));
}

/** The card that replaces the current one when the header pill is clicked. */
export function renderPlanCard(plan: PlanUsage, onBack: () => void): HTMLElement {
  const color = planColor(primaryPercent(plan));
  return h(
    "div",
    { class: "int-card plan-card" },
    h(
      "div",
      { class: "int-head" },
      h("button", { class: "int-back", title: "Back", onclick: onBack }, svg(ICONS.chevronLeft, 10, { stroke: 2.4 })),
      dot(color, 7),
      h("b", { text: "Claude plan" }),
      h("span", { text: "usage" }),
    ),
    h(
      "div",
      { class: "plan-rows" },
      windowRow({ short: "5h", long: "5-hour window" }, plan.fiveHour),
      windowRow({ short: "7d", long: "7-day window" }, plan.sevenDay),
    ),
  );
}
