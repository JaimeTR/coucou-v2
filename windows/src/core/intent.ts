// What was said to Mochi: a command ("abre Claude Code") or a question for the
// chat. Pure, so it can be tested. Matching ignores accents and punctuation,
// because Whisper writes things its own way ("Open Code", "visual estudio code").

export type Target = "claude" | "opencode" | "gemini" | "antigravity" | "vscode" | "github" | "settings";

export type Intent =
  | { kind: "launch"; target: Target; resume: boolean; terminal: boolean }
  | { kind: "question"; text: string };

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const OPEN = /\b(abre|abrir|abreme|lanza|lanzar|inicia|iniciar|arranca|ejecuta|open|launch|start|run)\b/;
const RESUME = /\b(continua|continuar|sigue|seguir|retoma|retomar|resume|continue)\b/;
const TERMINAL = /\b(terminal|consola|cli|linea de comandos|command line)\b/;

const TARGETS: ReadonlyArray<readonly [Target, RegExp]> = [
  ["antigravity", /\b(antigravity|anti gravity|antigravedad)\b/],
  ["opencode", /\b(open ?code|opencode)\b/],
  ["gemini", /\bgemini\b/],
  ["vscode", /\b(vs ?code|v s code|visual studio( code)?|visual estudio( code)?)\b/],
  ["github", /\bgit ?hub\b/],
  ["settings", /\b(ajustes|configuracion|preferencias|settings)\b/],
  ["claude", /\bcla?ude( code)?\b/],
];

/** A command when it asks to open or continue one of Mochi's tools; otherwise a question. */
export function parseIntent(said: string): Intent {
  const text = said.trim();
  const p = plain(text);
  const asksOpen = OPEN.test(p);
  const asksResume = RESUME.test(p);
  if (asksOpen || asksResume) {
    for (const [target, re] of TARGETS) {
      if (re.test(p)) {
        return { kind: "launch", target, resume: asksResume, terminal: TERMINAL.test(p) };
      }
    }
  }
  return { kind: "question", text };
}
