// Spanish → English for the interface text. Spanish is the language the code is
// written in; English is looked up here. Pure (no DOM), so it can be tested.

import { EN } from "./en.js";

/** Pairs that are not whole strings in the source: pieces glued together at run time. */
const EXTRA: ReadonlyArray<readonly [string, string]> = [
  ["Ejecuta {0}", "Runs {0}"],
  ["Lee {0}", "Reads {0}"],
  ["Escribe {0}", "Writes {0}"],
  ["Modifica {0}", "Edits {0}"],
  ["Busca {0}", "Searches {0}"],
  ["Busca texto {0}", "Searches text {0}"],
  ["Busca en la web {0}", "Searches the web {0}"],
  ["Descarga {0}", "Downloads {0}"],
  ["Lista {0}", "Lists {0}"],
  ["Tareas {0}", "Tasks {0}"],
  ["{0} revisión pedida", "{0} review requested"],
  ["{0} revisiones pedidas", "{0} reviews requested"],
  ["{0} CI fallando", "{0} CI failing"],
  ["{0} PR de Copilot", "{0} Copilot PR"],
  ["{0} PRs de Copilot", "{0} Copilot PRs"],
  ["ahora", "now"],
  ["ayer", "yesterday"],
  ["hace {0}", "{0} ago"],
  ["{0} terminó", "{0} finished"],
  ["{0} está listo.", "{0} is ready."],
  ["{0} (borrador)", "{0} (draft)"],
  ["Idioma de la interfaz", "Interface language"],
  ["Abrir Coucou con", "Open Coucou with"],
  ["Pulsa las teclas…", "Press the keys…"],
  ["Restablecer", "Reset"],
  ["Listo: ya abre y cierra la isla desde cualquier programa.", "Done: it now opens and closes the island from any program."],
  ["Una tecla F, o Ctrl, Alt o Shift con otra tecla. Esc cancela.", "An F key, or Ctrl, Alt or Shift with another key. Esc cancels."],
  ["Esa tecla no se puede usar", "That key cannot be used"],
  ["Añade Ctrl, Alt o Shift, o usa una tecla F1 a F12", "Add Ctrl, Alt or Shift, or use an F1 to F12 key"],
  ["Otra aplicación ya usa esa combinación", "Another application already uses that combination"],
  ["«{0}» no es una combinación válida", "“{0}” is not a valid combination"],
  ["Ctrl+Alt+Y permitir · Ctrl+Alt+N denegar (solo mientras hay una petición)", "Ctrl+Alt+Y allow · Ctrl+Alt+N deny (only while a request is up)"],
  ["Mochi habla", "Mochi speaks"],
  ["dice tu nombre y el momento del día al iniciar", "says your name and the time of day on start"],
  ["Leer las respuestas", "Read replies aloud"],
  ["el chat lee en voz alta cada respuesta; cada una también tiene su botón de altavoz", "the chat reads every reply aloud; each one also has its own speaker button"],
  ["Escuchar", "Listen"],
  ["tokens: más corto es más rápido", "tokens: shorter is faster"],
  ["Ajustes — Coucou", "Settings — Coucou"],
  ["{0} rechazó la clave de API ({1}). Revísala en Ajustes.", "{0} rejected the API key ({1}). Check it in Settings."],
  ["{0}: no se encontró el modelo ({1}). Revisa su nombre en Ajustes. {2}", "{0}: model not found ({1}). Check its name in Settings. {2}"],
  ["Se alcanzó el límite de peticiones de {0} (429). Espera un momento e inténtalo de nuevo.", "{0} request limit reached (429). Wait a moment and try again."],
  ["Se alcanzó el límite de peticiones de DEVMARK AI (429). Espera entre 10 y 60 segundos e inténtalo de nuevo.", "DEVMARK AI request limit reached (429). Wait 10 to 60 seconds and try again."],
  ["{0} rechazó la petición ({1}): {2}", "{0} rejected the request ({1}): {2}"],
  ["{0} no está disponible ({1}). Inténtalo en un momento.", "{0} is not available ({1}). Try again in a moment."],
  ["DEVMARK AI no está disponible o va lento ({0}). Inténtalo en un momento.", "DEVMARK AI is unavailable or slow ({0}). Try again in a moment."],
  ["DEVMARK AI está en pausa (modo dormido). Inténtalo más tarde.", "DEVMARK AI is paused (sleep mode). Try again later."],
  ["Falta la clave de {0}. Añádela en Ajustes.", "The {0} key is missing. Add it in Settings."],
  ["{0} envió una respuesta vacía. Inténtalo de nuevo.", "{0} sent an empty reply. Try again."],
  ["{0} tardó demasiado en responder. Prueba con una pregunta más corta.", "{0} took too long to answer. Try a shorter question."],
  ["Error de red al hablar con {0}: {1}", "Network error talking to {0}: {1}"],
  ["Error de red: {0}", "Network error: {0}"],
  ["Respuesta no válida de {0}: {1}", "Invalid response from {0}: {1}"],
  ["Respuesta no válida de la API: {0}", "Invalid response from the API: {0}"],
  ["Aún no hay clave de {0} guardada.", "No {0} key saved yet."],
  ["Conectado a {0}: clave aceptada. Modelos: {1}.", "Connected to {0}: key accepted. Models: {1}."],
  ["No se puede llegar a {0}: {1}", "Cannot reach {0}: {1}"],
  ["Ese mensaje es demasiado largo para {0} (unos {1} caracteres como máximo).", "That message is too long for {0} (about {1} characters at most)."],
  ["El modelo de {0} solo lee texto: no puede abrir “{1}”. Funcionan los archivos de texto y de código.", "{0}'s model only reads text: it cannot open “{1}”. Text and code files work."],
  ["El servicio responde pero el modelo no está disponible (503).", "The service answers but the model is not available (503)."],
  ["El servicio respondió {0}.", "The service answered {0}."],
  ["DEVMARK AI está {0}, pero aún no hay clave guardada.", "DEVMARK AI is {0}, but no key is saved yet."],
  ["Aún no se pueden soltar carpetas.", "Folders cannot be dropped yet."],
  ["No se puede leer {0}: {1}", "Cannot read {0}: {1}"],
  ["{0} no es un objeto JSON: Coucou no lo tocará.", "{0} is not a JSON object: Coucou will not touch it."],
  ["{0} no es texto UTF-8: Coucou no lo tocará.", "{0} is not UTF-8 text: Coucou will not touch it."],
  ["{0} cambió desde la vista previa. No se escribió nada: revisa los cambios nuevos.", "{0} changed since the preview. Nothing was written: review the new changes."],
  ["Un archivo cambió desde la vista previa. No se escribió nada: revisa los cambios nuevos.", "A file changed since the preview. Nothing was written: review the new changes."],
  ["falló la copia de seguridad: {0}", "backup failed: {0}"],
  ["falló la escritura: {0}", "write failed: {0}"],
  ["no hay nada que respaldar (archivo nuevo)", "nothing to back up (new file)"],
  ["no hizo falta copia de seguridad", "no backup was needed"],
  ["No se encontró PowerShell, así que no hay perfil al que añadir Coucou.", "PowerShell was not found, so there is no profile to add Coucou to."],
  ["{0} ya existe y no es de Coucou. Renómbralo o quítalo primero.", "{0} already exists and is not Coucou's. Rename or remove it first."],
  ["Clave de API no válida (401)", "Invalid API key (401)"],
  ["Error de la API {0}", "API error {0}"],
  ["Sin conexión: {0}", "No connection: {0}"],
  ["A la integración le falta acceso", "The integration lacks access"],
  ["GitHub rechazó la consulta de pull requests", "GitHub rejected the pull request query"],
  ["Falló el CI", "CI failed"],
  ["Revisión pedida", "Review requested"],
  ["Copilot abrió un pull request", "Copilot opened a pull request"],
  ["Copilot revisó tu PR", "Copilot reviewed your PR"],
  ["esa regla no es válida", "that rule is not valid"],
  ["{0} reglas es el límite: quita algunas en Ajustes primero", "{0} rules is the limit: remove some in Settings first"],
  ["no se pudo guardar tu línea de estado actual: {0}", "could not save your current status line: {0}"],
];

interface Pattern {
  re: RegExp;
  to: string;
  /** Literal characters, to try the longest, most specific pattern first. */
  weight: number;
}

const exact = new Map<string, string>();
const patterns: Pattern[] = [];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

for (const [es, en] of [...EN, ...EXTRA]) {
  if (!es.includes("{0}")) {
    exact.set(es.trim(), en.trim());
    continue;
  }
  const parts = es.split(/\{\d\}/);
  const re = new RegExp("^" + parts.map(escapeRe).join("(.+?)") + "$", "s");
  patterns.push({ re, to: en, weight: parts.join("").length });
}
patterns.sort((a, b) => b.weight - a.weight);

function viaPattern(piece: string): string {
  for (const p of patterns) {
    const m = p.re.exec(piece);
    if (m) {
      return p.to.replace(/\{(\d)\}/g, (_, i: string) => m[Number(i) + 1] ?? "");
    }
  }
  return piece;
}

/** `piece` translated if it is known, else unchanged. */
function one(piece: string): string {
  const hit = exact.get(piece);
  if (hit !== undefined) return hit;
  if (piece.includes(" · ")) {
    // "2 revisiones pedidas · 1 CI fallando": each piece on its own.
    const parts = piece.split(" · ");
    const done = parts.map((x) => exact.get(x) ?? viaPattern(x));
    if (done.some((x, i) => x !== parts[i])) return done.join(" · ");
  }
  return viaPattern(piece);
}

/** English for a Spanish interface string; anything unknown is returned as it is. */
export function toEnglish(text: string): string {
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  const trail = /\s*$/.exec(text)?.[0] ?? "";
  const core = text.trim();
  if (!core) return text;
  const out = one(core);
  return out === core ? text : lead + out + trail;
}
