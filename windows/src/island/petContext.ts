// Tells the pet what the person is doing, so what it says fits: an agent is
// working, one just finished or failed, how long today's work has gone on. The
// pet's page is another window, so this goes through Rust. Nothing is sent
// anywhere else, and nothing at all while the pet is off.

import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import { Recap } from "./hooks";
import { minutesToday } from "./recap";

const BUSY = new Set(["working", "thinking"]);

export function startPetContext() {
  const was = new Map<string, string>();
  let finishedAt: number | null = null;
  let failedAt: number | null = null;
  let sent = "";
  let timer: number | null = null;

  const publish = () => {
    timer = null;
    if (!State.settings.petEnabled) return;
    const working = State.tasks.some((t) => t.source !== "n8n" && BUSY.has(t.state));
    const payload = { working, workedToday: minutesToday(Recap.data, new Date()), finishedAt, failedAt };
    const key = JSON.stringify(payload);
    if (key === sent) return;
    sent = key;
    void Bridge.petContext(payload);
  };

  State.subscribe(() => {
    for (const t of State.tasks) {
      if (t.source === "n8n") continue; // integrations are not the person's work
      const before = was.get(t.id);
      if (before !== t.state) {
        if (t.state === "finished" && before !== undefined) finishedAt = Date.now();
        if (t.state === "error" && before !== undefined) failedAt = Date.now();
        was.set(t.id, t.state);
      }
    }
    if (State.settings.petEnabled && timer == null) timer = window.setTimeout(publish, 1500);
  });
}
