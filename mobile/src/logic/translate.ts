// Spanish → English for the app's text. Spanish is the language the code is
// written in (as in the desktop app); English comes from this dictionary.
// A key may hold {0}, {1}… for text that varies.

const PAIRS: ReadonlyArray<readonly [string, string]> = [
  // Tabs and titles
  ["Hoy", "Today"],
  ["Ajustes", "Settings"],
  // Your PCs (computers.tsx)
  ["PCs", "PCs"],
  ["Conecta tus PCs", "Connect your PCs"],
  ["En Coucou de tu PC: Ajustes → Sincronización → Mostrar código. Pega aquí esa dirección y ese código. Todo va cifrado: tu servidor no puede leerlo.", "In Coucou on your PC: Settings → Sync → Show code. Paste that address and that code here. Everything is encrypted: your server cannot read it."],
  ["Servidor", "Server"],
  ["Código", "Code"],
  ["Conectar", "Connect"],
  ["Conectando…", "Connecting…"],
  ["ahora", "now"],
  ["Ningún agente trabajando.", "No agent working."],
  ["Pide permiso", "Asks permission"],
  ["Enviado. Esperando a tu PC…", "Sent. Waiting for your PC…"],
  ["Denegar", "Deny"],
  ["Permitir", "Allow"],
  ["Ningún PC ha reportado todavía. Abre Coucou en tu PC con la sincronización activa.", "No PC has reported yet. Open Coucou on your PC with sync on."],
  ["Desconectar este teléfono", "Disconnect this phone"],
  ["Ese código no corresponde a esta cuenta.", "That code does not match this account."],
  ["No hay nada con ese código todavía.", "There is nothing with that code yet."],
  ["El servidor respondió {0}.", "The server answered {0}."],
  ["El código debe tener 64 caracteres (0-9, a-f), con o sin guiones.", "The code must be 64 characters (0-9, a-f), with or without dashes."],
  ["La dirección del servidor debe empezar por https://", "The server address must start with https://"],
  ["Hola {0}", "Hello {0}"],
  ["Hola", "Hello"],
  ["Buenos días", "Good morning"],
  ["Buenas tardes", "Good afternoon"],
  ["Buenas noches", "Good evening"],
  // Today
  ["Todo tranquilo por aquí.", "All quiet here."],
  ["Conecta GitHub o añade una app en Ajustes para ver aquí lo que te necesita.", "Connect GitHub or add an app in Settings to see here what needs you."],
  ["GitHub", "GitHub"],
  ["Revisiones pedidas", "Review requests"],
  ["Mis pull requests", "My pull requests"],
  ["Copilot", "Copilot"],
  ["Nada por aquí", "Nothing here"],
  ["Cargando…", "Loading…"],
  ["Esperando la primera lectura…", "Waiting for the first reading…"],
  ["Actualizar", "Refresh"],
  ["Mis apps", "My apps"],
  ["{0} revisión pedida", "{0} review requested"],
  ["{0} revisiones pedidas", "{0} reviews requested"],
  ["{0} CI fallando", "{0} CI failing"],
  ["{0} PR de Copilot", "{0} Copilot PR"],
  ["{0} PRs de Copilot", "{0} Copilot PRs"],
  ["Borrador", "Draft"],
  // Settings
  ["Idioma", "Language"],
  ["Automático", "Automatic"],
  ["Tu nombre", "Your name"],
  ["Para saludarte en la pantalla de inicio.", "To greet you on the home screen."],
  ["Token", "Token"],
  ["Token de GitHub", "GitHub token"],
  ["Pega aquí tu token de GitHub (acceso de lectura a pull requests). Se guarda cifrado en este teléfono y solo se envía a GitHub.", "Paste your GitHub token here (read access to pull requests). It is stored encrypted on this phone and only sent to GitHub."],
  ["Guardar", "Save"],
  ["Quitar", "Remove"],
  ["Guardado.", "Saved."],
  ["Quitado.", "Removed."],
  ["Hay un token guardado.", "A token is saved."],
  ["Aún no hay token.", "No token yet."],
  ["Crear un token en GitHub", "Create a token on GitHub"],
  ["Añade tus propios servicios: Coucou consulta una dirección cada cierto tiempo y muestra un valor de su respuesta JSON.", "Add your own services: Coucou checks an address every so often and shows a value from its JSON answer."],
  ["Añadir app", "Add app"],
  ["Quitar esta app", "Remove this app"],
  ["Nombre", "Name"],
  ["Dirección", "Address"],
  ["Valor a mostrar (ruta con puntos)", "Value to show (dotted path)"],
  ["Cada (segundos)", "Every (seconds)"],
  ["Cabecera del token", "Token header"],
  ["Al tocar la tarjeta, abrir", "When tapping the card, open"],
  ["Probar ahora", "Test now"],
  ["Leído: {0}", "Read: {0}"],
  ["Máximo {0} apps.", "At most {0} apps."],
  ["Esta es la versión móvil de Coucou: avisos de tus servicios en el teléfono. Los agentes de tu PC (Claude Code y demás) siguen en la app de escritorio.", "This is Coucou's mobile version: notices from your services on your phone. Your PC's agents (Claude Code and the rest) stay in the desktop app."],
  // Errors from the logic
  ["GitHub rechazó el token (401).", "GitHub rejected the token (401)."],
  ["GitHub respondió {0}.", "GitHub answered {0}."],
  ["GitHub rechazó la consulta de pull requests", "GitHub rejected the pull request query"],
  ["Sin conexión: {0}", "No connection: {0}"],
  ["Acceso rechazado ({0}). Revisa el token.", "Access refused ({0}). Check the token."],
  ["La dirección no existe (404).", "The address does not exist (404)."],
  ["La dirección respondió {0}.", "The address answered {0}."],
  ["La respuesta no es JSON.", "The answer is not JSON."],
  ["No hay nada en «{0}» dentro de la respuesta.", "There is nothing at “{0}” in the answer."],
  // Time
  ["ahora", "now"],
  ["ayer", "yesterday"],
  ["hace {0}", "{0} ago"],
];

interface Pattern {
  re: RegExp;
  to: string;
  weight: number;
}

const exact = new Map<string, string>();
const patterns: Pattern[] = [];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

for (const [es, en] of PAIRS) {
  if (!es.includes("{0}")) {
    exact.set(es, en);
    continue;
  }
  const parts = es.split(/\{\d\}/);
  patterns.push({ re: new RegExp("^" + parts.map(escapeRe).join("(.+?)") + "$", "s"), to: en, weight: parts.join("").length });
}
patterns.sort((a, b) => b.weight - a.weight);

function viaPattern(text: string): string {
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (m) return p.to.replace(/\{(\d)\}/g, (_, i: string) => exact.get(m[Number(i) + 1] ?? "") ?? m[Number(i) + 1] ?? "");
  }
  return text;
}

/** English for a Spanish string; anything unknown is returned as it is. */
export function toEnglish(text: string): string {
  const hit = exact.get(text);
  if (hit !== undefined) return hit;
  if (text.includes(" · ")) {
    const parts = text.split(" · ");
    const done = parts.map((p) => exact.get(p) ?? viaPattern(p));
    if (done.some((d, i) => d !== parts[i])) return done.join(" · ");
  }
  return viaPattern(text);
}

export type Language = "auto" | "es" | "en";

export function resolveLanguage(pref: Language, system: string): "es" | "en" {
  if (pref === "es" || pref === "en") return pref;
  return system.toLowerCase().startsWith("es") ? "es" : "en";
}

/** "hace 5 min", "hace 2 h", "ayer", "hace 3 d" — how long ago, in Spanish. */
export function agoEs(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (!then) return "";
  const seconds = Math.max(0, (nowMs - then) / 1000);
  if (seconds < 90) return "ahora";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "ayer" : `hace ${days} d`;
}

export function partOfDayEs(hour: number): "Buenos días" | "Buenas tardes" | "Buenas noches" {
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 19) return "Buenas tardes";
  return "Buenas noches";
}
