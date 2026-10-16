// The link between your computers and your phone, through your own sync server.
//
//  - This PC's state goes up when it changes (and every 30 s, so the others can tell
//    it is on): its sessions, the permission or question waiting, the music playing
//    and its mode. Everything is encrypted before it leaves.
//  - While a card waits here, Allow / Deny / the answer comes down from the phone or
//    from another computer.
//  - The other computers' state comes down every few seconds: what waits on them
//    shows up here as a card you can answer, and their music makes Mochi dance.
//
// Nothing runs when sync is off, and decisions are only polled while a card waits.

import { Bridge } from "../core/bridge";
import { t } from "../core/i18n";
import { mayNotify } from "../core/modes";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { ONLINE_MS, remoteState, waitingElsewhere } from "./remoteState";
import type { Island } from "./island";

const PUBLISH_EVERY_MS = 1500;
const HEARTBEAT_MS = 30_000;
const DECISIONS_EVERY_MS = 2000;
const DEVICES_EVERY_MS = 5000;
const MUSIC_EVERY_MS = 10_000;

/** Remote requests already answered here, so the next refresh does not raise them again. */
const handled = new Set<string>();
export function markHandled(requestId: string) {
  handled.add(requestId);
  if (handled.size > 50) handled.delete(handled.values().next().value as string);
}

/** Is another of your computers on and playing music? */
export function remotePlaying(now = Date.now()): boolean {
  return State.devices.some((d) => now - d.at < ONLINE_MS && !!d.state.music);
}

export function startRemote(island: Island, computerName: string) {
  let last = "";
  /** The request already announced to the phone, so one waiting card is one ping. */
  let announced = "";
  let publishTimer: number | null = null;
  let decisionsTimer: number | null = null;
  let music: { title: string; artist: string } | null = null;
  let devicesJson = "";

  const localApproval = () => (State.pendingApproval && !State.pendingApproval.remote ? State.pendingApproval : null);
  const localQuestion = () => (State.pendingQuestion && !State.pendingQuestion.remote ? State.pendingQuestion : null);

  const publish = (force = false) => {
    publishTimer = null;
    if (!State.settings.syncUrl) return;
    const state = remoteState(computerName, State.tasks, localApproval(), {
      question: localQuestion(),
      music,
      mode: State.workMode,
    });
    const json = JSON.stringify(state);
    if (json === last && !force) return;
    last = json;
    void Bridge.syncPublish(state);
  };

  const pollDecisions = async () => {
    if ((!localApproval() && !localQuestion()) || !State.settings.syncUrl) {
      decisionsTimer = null;
      return;
    }
    for (const d of (await Bridge.syncTakeDecisions()) ?? []) {
      // Only the card that is on screen now: a tap meant for an older one does nothing.
      if (d.decision === "answer") {
        if (localQuestion()?.requestId === d.requestId && d.answers) {
          void Bridge.log(`remote answered question req=${d.requestId}`);
          island.answerQuestion(d.answers);
        }
      } else if (localApproval()?.requestId === d.requestId) {
        void Bridge.log(`remote decided ${d.decision} req=${d.requestId}`);
        island.decideApproval(d.decision);
      }
    }
    decisionsTimer = window.setTimeout(pollDecisions, DECISIONS_EVERY_MS);
  };

  const announce = () => {
    const req = localApproval()?.requestId ?? localQuestion()?.requestId ?? "";
    if (!req || req === announced) return;
    announced = req;
    const kind = localApproval() ? "approval" : "question";
    const text = kind === "approval" ? t("Claude Code pide permiso en {0}") : t("Claude Code tiene una pregunta en {0}");
    void Bridge.syncNotify(kind, text.replace("{0}", computerName));
  };

  /** A card raised for a request that waits on another computer; it goes when that one is answered. */
  const dropRemoteCards = () => {
    const hadApproval = !!State.pendingApproval?.remote;
    const hadQuestion = !!State.pendingQuestion?.remote;
    if (!hadApproval && !hadQuestion) return;
    if (hadApproval) {
      State.pendingApproval = null;
      void Bridge.setDecisionShortcuts(false);
    }
    if (hadQuestion) State.pendingQuestion = null;
    State.isPinned = false;
    island.dropPin();
    if (State.view === "approval" || State.view === "question") island.setView(State.defaultView());
    State.notify();
  };

  const reconcile = () => {
    const w = waitingElsewhere(State.devices, handled);
    const shown = State.pendingApproval?.remote ?? State.pendingQuestion?.remote ?? null;
    const shownId = State.pendingApproval?.requestId ?? State.pendingQuestion?.requestId ?? "";
    // The request is gone (answered over there, or it timed out): so is its card.
    if (shown && (!w || w.device !== shown.device || (w.kind === "approval" ? w.approval.requestId : w.question.requestId) !== shownId)) {
      dropRemoteCards();
    }
    if (!w || State.pendingApproval || State.pendingQuestion || !mayNotify(State.workMode)) return;
    const origin = { device: w.device, name: w.name };
    if (w.kind === "approval") {
      State.pendingApproval = {
        requestId: w.approval.requestId,
        sessionId: "",
        tool: w.approval.tool,
        command: w.approval.command,
        rule: null,
        remote: origin,
      };
      void Bridge.setDecisionShortcuts(true);
    } else {
      State.pendingQuestion = { requestId: w.question.requestId, sessionId: "", questions: w.question.questions, remote: origin };
    }
    State.isPinned = true;
    Sound.play(w.kind === "approval" ? "approval" : "question");
    island.alert(w.kind);
    State.notify();
  };

  const pollDevices = async () => {
    if (!State.settings.syncUrl) {
      if (State.devices.length) {
        State.devices = [];
        reconcile();
        State.notify();
      }
      return;
    }
    const list = (await Bridge.syncDevices()) ?? [];
    const json = JSON.stringify(list.map((d) => [d.id, d.state]));
    State.devices = list;
    reconcile();
    // A change in what the others play or wait on is a reason to redraw; the heartbeat is not.
    if (json !== devicesJson) {
      devicesJson = json;
      State.notify();
    }
  };

  const pollMusic = async () => {
    if (!State.settings.syncUrl) return;
    const now = await Bridge.nowPlaying();
    const next = now?.playing ? { title: now.title, artist: now.artist } : null;
    if (JSON.stringify(next) !== JSON.stringify(music)) {
      music = next;
      if (publishTimer == null) publishTimer = window.setTimeout(() => publish(), PUBLISH_EVERY_MS);
    }
  };

  State.subscribe(() => {
    if (!State.settings.syncUrl) return;
    announce();
    if (publishTimer == null) publishTimer = window.setTimeout(() => publish(), PUBLISH_EVERY_MS);
    if ((localApproval() || localQuestion()) && decisionsTimer == null) decisionsTimer = window.setTimeout(pollDecisions, DECISIONS_EVERY_MS);
  });

  window.setInterval(() => publish(true), HEARTBEAT_MS);
  window.setInterval(() => void pollDevices(), DEVICES_EVERY_MS);
  window.setInterval(() => void pollMusic(), MUSIC_EVERY_MS);
}
