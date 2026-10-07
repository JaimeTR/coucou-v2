// A new version: Mochi says so, and with "automatic" updates on, installs it at
// a quiet moment — no agent working, no permission or question waiting, the
// island closed. Checked once a minute while an update waits; nothing otherwise.

import { Bridge, onEvent, type UpdateInfo } from "../core/bridge";
import { t } from "../core/i18n";
import { State } from "../core/state";
import { speakAuto } from "../core/voice";
import type { Island } from "./island";

const BUSY = new Set(["working", "thinking", "approval", "question"]);

export function isQuiet(): boolean {
  return (
    !State.pendingApproval &&
    !State.pendingQuestion &&
    State.mode !== "expanded" &&
    !State.tasks.some((task) => BUSY.has(task.state))
  );
}

export async function startUpdates(island: Island) {
  let waiting: number | null = null;

  await onEvent<UpdateInfo>("update-available", (u) => {
    if (State.settings.updates === "off") return;
    if (State.settings.updates === "notify") {
      State.noteMessage = t("Coucou {0} está disponible: instálalo en Ajustes → General.").replace("{0}", u.version);
      island.alert("note");
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
}
