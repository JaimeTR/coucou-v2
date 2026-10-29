// A new version: Mochi says so, and with "automatic" updates on, installs it at
// a quiet moment — no agent working, no permission or question waiting, the
// island closed. Checked once a minute while an update waits; nothing otherwise.
//
// With "only tell me", the original Coucou's way (its Windows 0.5.2): Mochi
// wears a blue arrow while the version waits, opening the island shows
// "Actualizar ahora" first, and "Más tarde" hides both for a day. After an
// update, the island shows once what the new version brings.

import { getVersion } from "@tauri-apps/api/app";
import { Bridge, onEvent, type UpdateInfo } from "../core/bridge";
import { t, uiLanguage } from "../core/i18n";
import { mayNotify } from "../core/modes";
import { State } from "../core/state";
import { speakAuto } from "../core/voice";
import { WHATS_NEW, showWhatsNew, soFar, soFarLine, updateWaiting, type Later } from "../core/whatsNew";
import { Recap } from "./hooks";
import type { Island } from "./island";

const BUSY = new Set(["working", "thinking", "approval", "question"]);
const LATER_KEY = "coucou.update.later";
const VERSION_KEY = "coucou.lastVersion";

export function isQuiet(): boolean {
  return (
    !State.pendingApproval &&
    !State.pendingQuestion &&
    State.mode !== "expanded" &&
    !State.tasks.some((task) => BUSY.has(task.state))
  );
}

// "Más tarde" is a per-install convenience: the webview's storage is enough.
// Lost, Mochi is only blue again sooner.
function readLater(): Later | null {
  try {
    const v = JSON.parse(localStorage.getItem(LATER_KEY) ?? "null") as Partial<Later> | null;
    return v && typeof v.version === "string" && typeof v.at === "number" ? { version: v.version, at: v.at } : null;
  } catch {
    return null;
  }
}

let later: Later | null = readLater();

/** The blue arrow, and the update card first when the island opens. */
export function updateIsWaiting(now = Date.now()): boolean {
  return State.settings.updates === "notify" && updateWaiting(State.updateVersion, later, now);
}

/** "Más tarde": no arrow and no card for this version for a day. */
export function updateLater() {
  const version = State.updateVersion;
  if (!version) return;
  later = { version, at: Date.now() };
  try {
    localStorage.setItem(LATER_KEY, JSON.stringify(later));
  } catch {
    // Storage refused: the arrow only comes back sooner.
  }
  State.notify();
}

/** "Actualizar ahora": Rust downloads the signed version, installs it and restarts Coucou. */
export function updateNow() {
  State.updateStatus = t("Descargando… Coucou se reiniciará sola.");
  State.notify();
  void Bridge.log(`installing update ${State.updateVersion ?? "?"} (asked)`);
  Bridge.updateInstall().catch((err) => {
    State.updateStatus = String(err).replace(/^Error:\s*/, "");
    State.notify();
  });
}

export async function startUpdates(island: Island) {
  let waiting: number | null = null;

  await onEvent<UpdateInfo>("update-available", (u) => {
    if (State.settings.updates === "off") return;
    State.updateVersion = u.version;
    State.updateStatus = null;
    if (State.settings.updates === "notify") {
      State.notify();
      // Said once per version, unless "Más tarde" for it still holds; approvals come first.
      if (!updateIsWaiting() || State.pendingApproval || State.pendingQuestion || !mayNotify(State.workMode)) return;
      island.alert("update");
      speakAuto("events", t("Hay una versión nueva de Coucou"));
      return;
    }
    if (waiting != null) return;
    const tryNow = () => {
      if (State.settings.updates !== "auto") {
        waiting = null;
        return;
      }
      if (!isQuiet()) {
        waiting = window.setTimeout(tryNow, 60_000);
        return;
      }
      waiting = null;
      void Bridge.log(`installing update ${u.version}`);
      speakAuto("events", t("Me actualizo, vuelvo enseguida"));
      // A moment for the phrase, then the installer closes and reopens Coucou.
      window.setTimeout(() => {
        Bridge.updateInstall().catch((err) => void Bridge.log(`update failed: ${String(err)}`));
      }, 2500);
    };
    tryNow();
  });

  // A day after "Más tarde" the arrow comes back by itself.
  window.setInterval(() => State.notify(), 30 * 60 * 1000);

  await whatsNewAfterUpdate(island);
}

/** Once Coucou updated itself, the island shows what the new version brings. */
async function whatsNewAfterUpdate(island: Island) {
  let current: string;
  try {
    current = await getVersion();
  } catch {
    return;
  }
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(VERSION_KEY);
    localStorage.setItem(VERSION_KEY, current);
  } catch {
    return; // without storage it would show at every launch
  }
  if (!showWhatsNew(previous, current)) return;
  State.whatsNew = {
    version: current,
    notes: WHATS_NEW[current] ?? [],
    soFar: soFarLine(soFar(Recap.data), uiLanguage()),
  };
  // After the welcome, and never over a question, a permission, a game or a call.
  const show = (tries: number) => {
    if (State.pendingApproval || State.pendingQuestion || State.paused || !mayNotify(State.workMode) || State.mode === "expanded") {
      if (tries > 0) window.setTimeout(() => show(tries - 1), 60_000);
      return;
    }
    island.alert("whatsnew");
  };
  window.setTimeout(() => show(10), 9_000);
}
