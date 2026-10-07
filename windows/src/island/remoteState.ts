// What this PC tells the phone: its live sessions and the approval waiting, if
// any. Pure, so it can be tested. Kept small: the server caps a device at 48 KB.

export interface RemoteTask {
  id: string;
  name: string;
  color: string;
  state: string;
  step: string;
  project: string;
}

export interface RemoteState {
  /** The computer's name as the person sees it ("JAIME-PC"). */
  name: string;
  tasks: RemoteTask[];
  approval: { requestId: string; tool: string; command: string } | null;
}

interface TaskLike {
  id: string;
  name: string;
  color: string;
  state: string;
  steps: string[];
  stepIndex: number;
  source: string;
  isIntegration: boolean;
  sessionCwd?: string | null;
}

/** Agents only (integrations stay on the PC), the quiet ones left out. */
export function remoteState(
  name: string,
  tasks: readonly TaskLike[],
  approval: { requestId: string; tool: string; command: string } | null,
): RemoteState {
  return {
    name,
    tasks: tasks
      .filter((t) => (t.source === "claudeCode" || t.source === "agent") && t.state !== "idle")
      .slice(0, 8)
      .map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        state: t.state,
        step: (t.steps[t.stepIndex] ?? "").slice(0, 120),
        project: (t.sessionCwd ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "",
      })),
    approval: approval
      ? { requestId: approval.requestId, tool: approval.tool, command: approval.command.slice(0, 600) }
      : null,
  };
}
