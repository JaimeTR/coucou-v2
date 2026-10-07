// The phone link: this PC's state goes up when it changes, and while a
// permission card is up the phone's Allow / Deny comes down. Nothing runs
// when sync is off, and decisions are only polled while a card waits.

import { Bridge } from "../core/bridge";
import { t } from "../core/i18n";
import { State } from "../core/state";
import { remoteState } from "./remoteState";
import type { Island } from "./island";

const PUBLISH_EVERY_MS = 1500;
const DECISIONS_EVERY_MS = 2000;

export function startRemote(island: Island, computerName: string) {
  let last = "";
  /** The request already announced to the phone, so one waiting card is one ping. */
  let announced = "";
  let publishTimer: number | null = null;
  let decisionsTimer: number | null = null;

  const publish = () => {
    publishTimer = null;
    if (!State.settings.syncUrl) return;
    const state = remoteState(computerName, State.tasks, State.pendingApproval);
    const json = JSON.stringify(state);
    if (json === last) return;
    last = json;
    void Bridge.syncPublish(state);
  };

  const pollDecisions = async () => {
    const req = State.pendingApproval;
    if (!req || !State.settings.syncUrl) {
      decisionsTimer = null;
      return;
    }
    for (const d of (await Bridge.syncTakeDecisions()) ?? []) {
      // Only the card that is on screen now: a tap meant for an older one does nothing.
      if (State.pendingApproval?.requestId === d.requestId) {
        void Bridge.log(`phone decided ${d.decision} req=${d.requestId}`);
        island.decideApproval(d.decision);
      }
    }
    decisionsTimer = window.setTimeout(pollDecisions, DECISIONS_EVERY_MS);
  };

  const announce = () => {
    const req = State.pendingApproval?.requestId ?? State.pendingQuestion?.requestId ?? "";
    if (!req || req === announced) return;
    announced = req;
    const kind = State.pendingApproval ? "approval" : "question";
    const text = kind === "approval" ? t("Claude Code pide permiso en {0}") : t("Claude Code tiene una pregunta en {0}");
    void Bridge.syncNotify(kind, text.replace("{0}", computerName));
  };

  State.subscribe(() => {
    if (!State.settings.syncUrl) return;
    announce();
    if (publishTimer == null) publishTimer = window.setTimeout(publish, PUBLISH_EVERY_MS);
    if (State.pendingApproval && decisionsTimer == null) decisionsTimer = window.setTimeout(pollDecisions, DECISIONS_EVERY_MS);
  });
}
