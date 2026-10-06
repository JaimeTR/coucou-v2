// Doing what was asked by voice: open a tool, or leave the question to the chat.
// Mochi answers aloud ("Abriendo Claude Code") so you can keep your eyes elsewhere.

import { Bridge } from "../core/bridge";
import { t } from "../core/i18n";
import type { Intent, Target } from "../core/intent";
import { State } from "../core/state";
import { speak } from "../core/voice";

const NAMES: Record<Target, string> = {
  claude: "Claude Code",
  opencode: "OpenCode",
  gemini: "Gemini",
  antigravity: "Antigravity",
  vscode: "VS Code",
  github: "GitHub",
  settings: "Ajustes",
};

/** Runs a "launch" intent and says what happened. Returns whether it worked. */
export async function runLaunch(intent: Extract<Intent, { kind: "launch" }>): Promise<boolean> {
  const { target, resume, terminal } = intent;
  const project = State.claudeProjects[0]?.path ?? null;
  let ok: boolean | null = true;
  switch (target) {
    case "claude":
      ok = await Bridge.launchAgent("claude", project, resume);
      break;
    case "opencode":
      // The program by default, the terminal when asked for or when continuing.
      ok = terminal || resume ? await Bridge.launchAgent("opencode", project, resume) : await Bridge.openAgentApp("opencode");
      break;
    case "gemini":
      ok = terminal ? await Bridge.launchAgent("gemini", project, false) : await Bridge.openAgentApp("gemini");
      break;
    case "antigravity":
      ok = await Bridge.openAgentApp("antigravity");
      break;
    case "vscode":
      ok = await Bridge.openInVSCode(project);
      break;
    case "github":
      void Bridge.openUrl("https://github.com/pulls");
      break;
    case "settings":
      void Bridge.openSettingsWindow();
      break;
  }
  const worked = ok === true;
  speak(worked ? t(`Abriendo ${NAMES[target]}`) : t(`No pude abrir ${NAMES[target]}`));
  return worked;
}

/** What Mochi says when it wakes up with nothing to go on. */
export function helloLine(): string {
  const name = State.settings.userName.trim() || State.detectedName;
  return t(name ? `Hola ${name}, ¿qué quieres hacer hoy? ¿Te ayudo con algo?` : "¿Qué quieres hacer hoy? ¿Te ayudo con algo?");
}
