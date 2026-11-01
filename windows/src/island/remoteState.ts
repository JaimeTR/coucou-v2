import type { RemoteDevice } from "../core/state";

/** A computer that has not published for this long is off, or asleep. */
export const ONLINE_MS = 90_000;

// What this PC tells the phone: its live sessions and the approval waiting, if
// any. Pure, so it can be tested. Kept small: the server caps a device at 48 KB.

export interface RemoteTask {
  id: string;
  name: string;
  color: string;
  state: string;
  step: string;
  project: string;
  /** "claudeCode" or "agent": the phone offers to open Claude only for the first. */
  source: string;
}

export interface RemoteState {
  /** The computer's name as the person sees it ("JAIME-PC"). */
  name: string;
  tasks: RemoteTask[];
  approval: { requestId: string; tool: string; command: string } | null;
  /** A question waiting for an answer (the other computers can answer it). */
  question?: { requestId: string; questions: { question: string; header: string; options: { label: string; description: string }[]; multiSelect: boolean }[] } | null;
  /** What this computer is playing, for the others' Mochi to dance to. */
  music?: { title: string; artist: string } | null;
  /** Work, game, meeting or video (see core/modes.ts). */
  mode?: string;
}

/** What else goes up with the sessions. */
export interface RemoteExtra {
  question?: RemoteState["question"];
  music?: RemoteState["music"];
  mode?: string;
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
  extra: RemoteExtra = {},
): RemoteState {
  const q = extra.question;
  return {
    name,
    question: q
      ? {
          requestId: q.requestId,
          // Kept small: a device is capped at 48 KB on the server.
          questions: q.questions.slice(0, 4).map((x) => ({
            question: x.question.slice(0, 300),
            header: x.header.slice(0, 40),
            multiSelect: x.multiSelect,
            options: x.options.slice(0, 6).map((o) => ({ label: o.label.slice(0, 80), description: o.description.slice(0, 120) })),
          })),
        }
      : null,
    music: extra.music ? { title: extra.music.title.slice(0, 100), artist: extra.music.artist.slice(0, 100) } : null,
    mode: extra.mode,
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
        source: t.source,
      })),
    approval: approval
      ? { requestId: approval.requestId, tool: approval.tool, command: approval.command.slice(0, 600) }
      : null,
  };
}

/** The first request waiting on another computer that is on. Pure. */
export function waitingElsewhere(devices: readonly RemoteDevice[], seen: ReadonlySet<string>, now = Date.now()) {
  for (const d of devices) {
    if (now - d.at >= ONLINE_MS) continue;
    const name = d.state.name || d.id;
    const a = d.state.approval;
    if (a && !seen.has(a.requestId)) return { kind: "approval" as const, device: d.id, name, approval: a };
    const q = d.state.question;
    if (q && !seen.has(q.requestId)) return { kind: "question" as const, device: d.id, name, question: q };
  }
  return null;
}
