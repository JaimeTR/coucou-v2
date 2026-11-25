// What a hook event means for the island, kept free of the DOM and Tauri so it
// can be tested on its own.

import type { ApprovalInfo } from "../core/state";

/**
 * A prompt as the session's step line. Claude Code also submits text the
 * user never typed (a background task's `<task-notification>`, system
 * reminders, slash-command echoes): those show as their summary or command,
 * or not at all, never as raw tags.
 */
export function promptStep(raw: string): string | null {
  const tag = (name: string) => raw.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim();
  if (raw.includes("<task-notification>")) return tag("summary") ?? null;
  const command = tag("command-name");
  if (command) return command;
  const text = raw
    .replace(/<(system-reminder|local-command-\w+)>[\s\S]*?<\/\1>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 60) : null;
}

/** Events after which a pending permission request of the same session is moot. */
const TURN_OVER = new Set(["Stop", "StopFailure", "UserPromptSubmit", "SessionEnd", "Interrupt"]);

/**
 * True when an event shows a pending card was settled somewhere else: the turn
 * is over, or the very tool call it asked about has run, so it was allowed in
 * the terminal or the Claude app. A tool result of another call (a subagent
 * working alongside) does not count. `target` is the event's call written the
 * way the card writes it. A card waiting on another computer is not ours to judge.
 */
export function settledElsewhere(
  pending: ApprovalInfo,
  name: string,
  pill: string,
  sessionId: string,
  tool: string,
  target: string,
): boolean {
  if (pending.remote || (pending.agentId ?? "integration_claude") !== pill || pending.sessionId !== sessionId) return false;
  if (TURN_OVER.has(name)) return true;
  if (name !== "PostToolUse" && name !== "PostToolUseFailure") return false;
  return tool === pending.tool && target === pending.command;
}
