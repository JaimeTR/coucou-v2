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
  ["Mis apps", "My apps"],
  ["Añadir app", "Add app"],
  ["Quitar esta app", "Remove this app"],
  ["Cómo se entera", "How it finds out"],
  ["Recibe avisos de otro programa (webhook)", "Receives notices from another program (webhook)"],
  ["Consulta una dirección cada cierto tiempo (URL)", "Checks an address every so often (URL)"],
  ["Cualquier programa tuyo (un script, n8n, una acción de GitHub…) puede avisar a Mochi con un POST a esta dirección. Solo funciona desde este PC, y el secreto va en la propia dirección: no la compartas.", "Any program of yours (a script, n8n, a GitHub Action…) can notify Mochi with a POST to this address. It only works from this PC, and the secret is part of the address itself: don't share it."],
  ["Dirección", "Address"],
  ["Copiar", "Copy"],
  ["Valor a mostrar", "Value to show"],
  ["debe empezar por http:// o https://", "must start with http:// or https://"],
  ["ruta dentro del JSON, separada por puntos; vacío = toda la respuesta", "path inside the JSON, separated by dots; empty = the whole answer"],
  ["Cada", "Every"],
  ["segundos (mínimo 30)", "seconds (minimum 30)"],
  ["Cabecera del token", "Token header"],
  ["Authorization usa «Bearer …» solo", "Authorization adds “Bearer …” by itself"],
  ["Un cambio en el valor se avisa como un evento; la primera lectura no.", "A change in the value is announced as an event; the first reading is not."],
  ["Al hacer clic en ↗", "When clicking ↗"],
  ["abre esta dirección", "opens this address"],
  ["Enviar aviso de prueba", "Send a test notice"],
  ["Probar ahora", "Test now"],
  ["Leído: {0}", "Read: {0}"],
  ["Enviado: mira la isla.", "Sent: look at the island."],
  ["Guardado en el Administrador de credenciales de Windows.", "Saved in the Windows Credential Manager."],
  ["Esperando la primera lectura…", "Waiting for the first reading…"],
  ["Esperando el primer aviso…", "Waiting for the first notice…"],
  ["Avisos", "Notices"],
  ["Valor", "Value"],
  ["La dirección debe empezar por http:// o https://", "The address must start with http:// or https://"],
  ["Sin conexión: {0}", "No connection: {0}"],
  ["Acceso rechazado ({0}). Revisa el token.", "Access refused ({0}). Check the token."],
  ["La dirección no existe (404).", "The address does not exist (404)."],
  ["La dirección respondió {0}.", "The address answered {0}."],
  ["La respuesta no es JSON.", "The answer is not JSON."],
  ["La respuesta es demasiado grande.", "The answer is too large."],
  ["No hay nada en «{0}» dentro de la respuesta.", "There is nothing at “{0}” in the answer."],
  ["Esa app ya no existe.", "That app no longer exists."],
  ["activa la voz de Mochi; sin esto no dice nada por sí solo", "turns Mochi's voice on; without it Mochi says nothing by itself"],
  ["Dice la bienvenida", "Says the welcome"],
  ["tu nombre y el momento del día al iniciar", "your name and the time of day on start"],
  ["Avisa de los agentes", "Announces agent news"],
  ["sesión terminada, permisos, preguntas y errores de Claude Code y los demás agentes", "session finished, permissions, questions and errors from Claude Code and the other agents"],
  ["Dice lo que siente", "Says how it feels"],
  ["Sincronización", "Sync"],
  ["Mostrar QR para el teléfono", "Show QR for the phone"],
  ["En la app del teléfono: pestaña PCs → Escanear el QR. Quien lo vea puede leer tus ajustes: ciérralo cuando termines.", "In the phone app: PCs tab → Scan the QR. Whoever sees it can read your settings: close it when you are done."],
  ["Ocultar", "Hide"],
  ["Modelo local (Ollama, LM Studio)", "Local model (Ollama, LM Studio)"],
  ["Un modelo que corre en tu propio equipo, con Ollama o LM Studio: sin clave, gratis y nada sale de tu red. Abre el programa, descarga un modelo y enciende su servidor; luego “Probar conexión” muestra los modelos que tiene.", "A model that runs on your own computer, with Ollama or LM Studio: no key, free, and nothing leaves your network. Open the program, download a model and turn its server on; then “Test connection” shows the models it has."],
  ["No hace falta clave.", "No key needed."],
  ["Dirección", "Address"],
  ["Usar los valores de", "Use the settings of"],
  ["Clave (opcional)", "Key (optional)"],
  ["Corre en tu equipo: no necesita clave. “Probar conexión” (Chat e IA) comprueba que el programa esté abierto.", "Runs on your computer: no key needed. “Test connection” (Chat & AI) checks that the program is open."],
  ["Coucou {0} está disponible: instálalo en Ajustes → General.", "Coucou {0} is available: install it in Settings → General."],
  ["Hay una versión nueva de Coucou", "There is a new version of Coucou"],
  ["Me actualizo, vuelvo enseguida", "Updating, back in a moment"],
  ["Actualizaciones", "Updates"],
  ["Automáticas", "Automatic"],
  ["Solo avisar", "Only tell me"],
  ["Desactivadas", "Off"],
  ["Buscar ahora", "Check now"],
  ["Automáticas: Coucou se actualiza solo cuando no hay ninguna sesión trabajando ni un permiso esperando. Las versiones vienen firmadas desde GitHub.", "Automatic: Coucou updates itself when no session is working and no permission is waiting. Versions come signed from GitHub."],
  ["Descargando… Coucou se reiniciará solo.", "Downloading… Coucou will restart by itself."],
  ["Tienes la última versión ({0}).", "You have the latest version ({0})."],
  ["Hay una versión nueva: {0}.", "There is a new version: {0}."],
  ["Instalar {0} y reiniciar", "Install {0} and restart"],
  ["Ya tienes la última versión.", "You already have the latest version."],
  ["Tu semana", "Your week"],
  ["Semana tranquila: no hubo sesiones.", "A quiet week: no sessions."],
  ["programando", "coding"],
  ["sesión", "session"],
  ["sesiones", "sessions"],
  ["archivo", "file"],
  ["archivos", "files"],
  ["líneas", "lines"],
  ["comandos", "commands"],
  ["Tus ajustes (nombre, voz, idioma, pills, Mis apps, reglas) siguen a tus otros PCs a través de tu propio servidor de Cloudflare. Se cifran aquí antes de salir: el servidor no puede leerlos. Las claves API, la pantalla, la posición de la isla y el inicio con Windows no se sincronizan.", "Your settings (name, voice, language, pills, My apps, rules) follow you to your other PCs through your own Cloudflare server. They are encrypted here before they leave: the server cannot read them. API keys, the screen, the island's position and start with Windows are not synced."],
  ["Servidor", "Server"],
  ["Crear cuenta en este equipo", "Create an account on this PC"],
  ["o unir con código", "or join with a code"],
  ["Unir", "Join"],
  ["código de tu otro equipo (64 caracteres)", "code from your other PC (64 characters)"],
  ["Conectado a {0} como {1}", "Connected to {0} as {1}"],
  ["Sincronizar ahora", "Sync now"],
  ["Mostrar código", "Show code"],
  ["Desconectar este equipo", "Disconnect this PC"],
  ["Pégalo en tu otro PC (Ajustes → Sincronización → Unir). Quien tenga este código ve tus ajustes: no lo compartas.", "Paste it on your other PC (Settings → Sync → Join). Whoever has this code sees your settings: don't share it."],
  ["Cuenta creada. Tu código: {0}", "Account created. Your code: {0}"],
  ["Unido: los ajustes de tu otro equipo ya están aquí.", "Joined: your other PC's settings are here now."],
  ["Ajustes recibidos de otro equipo.", "Settings received from another PC."],
  ["Ya estaba al día.", "Already up to date."],
  ["Ese código no corresponde a esta cuenta.", "That code does not match this account."],
  ["No hay ajustes con ese código todavía.", "There are no settings with that code yet."],
  ["La dirección del servidor debe empezar por https://", "The server address must start with https://"],
  ["El código debe tener 64 caracteres (0-9, a-f), con o sin guiones.", "The code must be 64 characters (0-9, a-f), with or without dashes."],
  ["Crea ~/.copilot/hooks/coucou.json con los eventos de Copilot CLI. Los permisos se siguen respondiendo en su terminal.", "Creates ~/.copilot/hooks/coucou.json with Copilot CLI's events. Permissions are still answered in its terminal."],
  ["No se encontró Copilot CLI en este PC. Aun así puedes conectarlo para cuando lo instales.", "Copilot CLI was not found on this PC. You can still connect it for when you install it."],
  ["Añade los hooks de Coucou a ~/.config/muse/settings.json, sin tocar lo demás.", "Adds Coucou's hooks to ~/.config/muse/settings.json, leaving the rest alone."],
  ["No se encontró Muse Code en este PC. Aun así puedes conectarlo para cuando lo instales.", "Muse Code was not found on this PC. You can still connect it for when you install it."],
  ["Posición de la isla", "Island position"],
  ["Fija arriba al centro", "Fixed at the top centre"],
  ["Libre (arrástrala)", "Free (drag it)"],
  ["Volver arriba al centro", "Back to the top centre"],
  ["En modo libre arrastra la isla a donde quieras: se queda ahí, redondeada, y no se esconde sola.", "In free mode, drag the island anywhere: it stays there, rounded, and doesn't hide by itself."],
  ["cuando le haces clic, se marea o le das cariño", "when you click it, it gets dizzy or you pet it"],
  ["¡Ay!", "Ouch!"],
  ["¡Oye!", "Hey!"],
  ["¡Eso dolió!", "That hurt!"],
  ["Me mareo…", "I'm getting dizzy…"],
  ["Todo da vueltas…", "Everything is spinning…"],
  ["Uy, qué mareo.", "Whoa, so dizzy."],
  ["¡Basta ya!", "That's enough!"],
  ["¡Déjame en paz!", "Leave me alone!"],
  ["Te quiero.", "I love you."],
  ["Qué bonito.", "That's nice."],
  ["Lee las respuestas del chat", "Reads chat replies"],
  ["las respuestas largas se cortan en la primera frase o dos; con ElevenLabs gastan crédito", "long replies are cut to the first sentence or two; with ElevenLabs they use credit"],
  ["«Oye Mochi» también habla (el saludo y «Abriendo Claude Code») cuando la voz está activada. Cada respuesta del chat tiene además un botón de altavoz que usa la voz gratis de Windows.", "“Oye Mochi” also speaks (the greeting and “Opening Claude Code”) when voice is on. Each chat reply also has a speaker button that uses Windows' free voice."],
  ["Mochi solo habla con frases cortas suyas: la bienvenida, el saludo de «Oye Mochi» y confirmaciones como «Abriendo Claude Code». Las respuestas del chat no se leen solas, así no gastas crédito; cada una tiene un botón de altavoz que usa la voz gratis de Windows.", "Mochi only speaks short phrases of its own: the welcome, the “Oye Mochi” greeting and confirmations like “Opening Claude Code”. Chat replies are not read automatically, so you don't spend credit; each one has a speaker button that uses Windows' free voice."],
  ["Abriendo {0}", "Opening {0}"],
  ["No pude abrir {0}", "I couldn't open {0}"],
  ["Hola {0}, ¿qué quieres hacer hoy? ¿Te ayudo con algo?", "Hi {0}, what do you want to do today? Can I help with something?"],
  ["¿Qué quieres hacer hoy? ¿Te ayudo con algo?", "What do you want to do today? Can I help with something?"],
  ["Voz", "Voice"],
  ["Mochi puede hablarte y escucharte. Todo es opcional y está desactivado hasta que lo actives.", "Mochi can talk to you and listen to you. Everything is optional and off until you turn it on."],
  ["Quién habla", "Who speaks"],
  ["Voz de Windows (gratis, sin conexión)", "Windows voice (free, offline)"],
  ["ElevenLabs (voz natural o personalizada)", "ElevenLabs (natural or custom voice)"],
  ["ElevenLabs crea voces muy naturales, y también una voz tuya o a tu gusto en su web. Crea tu clave en elevenlabs.io (Developers → API Keys), pégala aquí y elige tu voz. Cada respuesta leída gasta caracteres de tu plan de ElevenLabs.", "ElevenLabs makes very natural voices, and also a voice of your own on its website. Create your key at elevenlabs.io (Developers → API Keys), paste it here and pick your voice. Every reply read aloud uses characters from your ElevenLabs plan."],
  ["Aún no hay clave de ElevenLabs.", "No ElevenLabs key yet."],
  ["Voz de ElevenLabs", "ElevenLabs voice"],
  ["Cargar mis voces", "Load my voices"],
  ["ID de la voz", "Voice ID"],
  ["Elige una de tu lista, o pega el ID de una voz tuya (en ElevenLabs: Voces → ⋯ → Copiar ID).", "Pick one from your list, or paste the ID of a voice of yours (in ElevenLabs: Voices → ⋯ → Copy ID)."],
  ["Multilingual v2 (la más natural)", "Multilingual v2 (the most natural)"],
  ["Flash v2.5 (la más rápida y barata)", "Flash v2.5 (the fastest and cheapest)"],
  ["Turbo v2.5 (equilibrada)", "Turbo v2.5 (balanced)"],
  ["Probar voz", "Test voice"],
  ["Entender tu voz usa Whisper de Groq con la clave que ya guardaste.", "Understanding your voice uses Groq's Whisper with the key you already saved."],
  ["Para entender tu voz hace falta una clave de Groq (Proveedor de chat → Groq).", "Understanding your voice needs a Groq key (Chat provider → Groq)."],
  ["Escuchar «Oye Mochi»", "Listen for “Oye Mochi”"],
  ["dices «Oye Mochi» y se abre el chat para hablar", "say “Oye Mochi” and the chat opens to talk"],
  ["Mientras está activado, el micrófono está abierto y cada frase que dices se envía a Groq para entenderla (no se guarda nada). Desactívalo cuando no lo quieras, aquí, con el botón del micrófono de la isla o con el atajo de abajo.", "While it is on, the microphone is open and every phrase you say is sent to Groq to be understood (nothing is stored). Turn it off when you don't want it: here, with the island's microphone button, or with the shortcut below."],
  ["Activar o pausar la escucha con", "Turn listening on or off with"],
  ["En el chat también hay un botón de micrófono para dictar una sola pregunta, sin activar «Oye Mochi».", "The chat also has a microphone button to dictate a single question, without turning on “Oye Mochi”."],
  ["Ya la usa el otro atajo de Coucou", "The other Coucou shortcut already uses it"],
  ["Falta la clave de ElevenLabs. Añádela en Ajustes.", "The ElevenLabs key is missing. Add it in Settings."],
  ["Falta la clave de Groq para entender tu voz. Añádela en Ajustes → Proveedor de chat.", "A Groq key is needed to understand your voice. Add it in Settings → Chat provider."],
  ["ElevenLabs rechazó la clave de API (401). Revísala en Ajustes. {0}", "ElevenLabs rejected the API key (401). Check it in Settings. {0}"],
  ["La grabación es demasiado larga.", "The recording is too long."],
  ["No se pudo abrir el micrófono. Revisa que Windows permita a Coucou usarlo (Configuración → Privacidad → Micrófono).", "The microphone could not be opened. Check that Windows lets Coucou use it (Settings → Privacy → Microphone)."],
  ["Este equipo no permite usar el micrófono aquí.", "This computer does not allow using the microphone here."],
  ["Hablar", "Speak"],
  ["Escuchando…", "Listening…"],
  ["Entendiendo…", "Understanding…"],
  ["No te oí. Inténtalo otra vez.", "I didn't hear you. Try again."],
  ["Escuchando «Oye Mochi»: toca para pausar", "Listening for “Oye Mochi”: click to pause"],
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
      // A captured piece that is itself a known string ("Ajustes") is translated too.
      return p.to.replace(/\{(\d)\}/g, (_, i: string) => {
        const piece = m[Number(i) + 1] ?? "";
        return exact.get(piece) ?? piece;
      });
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
