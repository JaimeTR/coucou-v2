// What the pet says, and when. Pure: the page asks `chooseTopic` what suits the
// moment and `pickPhrase` for a line on it. A line is the person's own, when they
// wrote some for that topic, and/or one of the built-in ones.

import type { Settings } from "../core/state";

export const TOPICS = [
  "working", "finished", "error", "music", "video", "late", "break", "morning", "afternoon", "evening", "chat",
] as const;
export type Topic = (typeof TOPICS)[number];

/** As they read in Settings. */
export const TOPIC_NAMES: Record<Topic, { label: string; hint: string }> = {
  working: { label: "Animarte mientras trabajas", hint: "Cuando un agente está trabajando o llevas un rato en lo tuyo." },
  finished: { label: "Cuando termina una tarea", hint: "Un agente acaba de terminar." },
  error: { label: "Cuando algo falla", hint: "Un agente se detuvo por un error." },
  music: { label: "Cuando suena música", hint: "Spotify, el navegador con música, Music…" },
  video: { label: "Cuando ves un vídeo", hint: "No te molesta: solo un saludo en silencio." },
  late: { label: "De madrugada", hint: "Entre las 23:00 y las 5:00." },
  break: { label: "Cuando llevas mucho rato", hint: "Para que descanses. Puedes usar {minutes}." },
  morning: { label: "Saludo de mañana", hint: "De 5:00 a 12:00." },
  afternoon: { label: "Saludo de tarde", hint: "De 12:00 a 19:00." },
  evening: { label: "Saludo de noche", hint: "De 19:00 a 23:00." },
  chat: { label: "Charla suelta", hint: "Cuando no hay nada especial." },
};

/** Written in Spanish; the English set is the same ideas in English. `{name}`, `{friend}` and `{minutes}` are filled in. */
export const DEFAULTS: Record<"es" | "en", Record<Topic, string[]>> = {
  es: {
    working: [
      "¡Ánimo, {name}! Sigue trabajando para la comida de {friend}.",
      "Tú puedes, {name}. {friend} cuenta contigo.",
      "Un poquito más… ¡y {friend} cena hoy!",
      "Vas genial. Sigue así.",
      "Concentrado como un campeón.",
      "Cada línea cuenta, {name}.",
      "Sigue, sigue: la comida de {friend} no se paga sola.",
    ],
    finished: [
      "¡Listo! Buen trabajo, {name}.",
      "Terminó. Eres una máquina.",
      "¡Eso! {friend} estaría orgulloso.",
      "Misión cumplida, {name}.",
    ],
    error: [
      "Tranquilo, {name}: los errores se arreglan.",
      "Respira. Ya casi lo tienes.",
      "Hasta el mejor tropieza. ¡Ánimo!",
      "Un fallo no es el final. Vamos otra vez.",
    ],
    music: [
      "¡Qué buena canción!",
      "Esto sí que se baila.",
      "¿Me prestas esa canción?",
      "¡A mover el cuerpo, {name}!",
      "Subo el volumen de mi corazón.",
    ],
    video: [
      "¿Qué estás viendo? Yo también quiero palomitas.",
      "No te molesto… solo paso a saludar.",
      "Disfruta tu vídeo, {name}.",
    ],
    late: [
      "Ya es tarde, {name}. ¿No deberías descansar?",
      "{friend} ya duerme… ¿y tú?",
      "El código de mañana se escribe mejor con sueño dormido.",
    ],
    break: [
      "Llevas {minutes} min seguidos: ¡estira las piernas!",
      "Hora de tomar agua, {name}.",
      "Un descanso corto y vuelves más fuerte.",
    ],
    morning: [
      "¡Buenos días, {name}! Hoy será un buen día.",
      "¡Arriba, {name}! ¿Primero un café?",
      "¡Buenos días! {friend} ya está listo para trabajar.",
    ],
    afternoon: [
      "¡Buenas tardes, {name}!",
      "¿Qué tal va la tarde, {name}?",
      "Buenas tardes. ¡Ya queda menos!",
    ],
    evening: [
      "¡Buenas noches, {name}!",
      "Ya casi acabamos el día, {name}.",
      "Noche tranquila. Tú puedes con un poco más.",
    ],
    chat: [
      "¡Coucou!",
      "¿Me buscabas?",
      "Solo pasaba a saludar.",
      "¡Hola, {name}!",
      "{friend} te manda saludos.",
      "Aquí estoy, por si acaso.",
    ],
  },
  en: {
    working: [
      "Keep it up, {name}! Keep working for {friend}'s dinner.",
      "You can do it, {name}. {friend} is counting on you.",
      "A little more… and {friend} eats tonight!",
      "You're doing great. Keep going.",
      "Focused like a champion.",
      "Every line counts, {name}.",
      "Keep going: {friend}'s dinner won't pay for itself.",
    ],
    finished: [
      "Done! Nice work, {name}.",
      "Finished. You're a machine.",
      "Yes! {friend} would be proud.",
      "Mission accomplished, {name}.",
    ],
    error: [
      "Easy, {name}: errors get fixed.",
      "Breathe. You're almost there.",
      "Even the best trip up. Cheer up!",
      "A bug is not the end. Let's go again.",
    ],
    music: [
      "What a great song!",
      "Now this is for dancing.",
      "Can I borrow that song?",
      "Move that body, {name}!",
      "Turning up the volume of my heart.",
    ],
    video: [
      "What are you watching? I want popcorn too.",
      "Not bothering you… just saying hi.",
      "Enjoy your video, {name}.",
    ],
    late: [
      "It's late, {name}. Shouldn't you rest?",
      "{friend} is asleep already… and you?",
      "Tomorrow's code is better written well rested.",
    ],
    break: [
      "{minutes} min in a row: stretch your legs!",
      "Time for some water, {name}.",
      "A short break and you come back stronger.",
    ],
    morning: [
      "Good morning, {name}! Today will be a good day.",
      "Up and at them, {name}! Coffee first?",
      "Good morning! {friend} is ready to work.",
    ],
    afternoon: [
      "Good afternoon, {name}!",
      "How is the afternoon going, {name}?",
      "Good afternoon. Not long left!",
    ],
    evening: [
      "Good evening, {name}!",
      "The day is almost done, {name}.",
      "Quiet night. You can do a little more.",
    ],
    chat: [
      "Coucou!",
      "Were you looking for me?",
      "Just passing by to say hi.",
      "Hi, {name}!",
      "{friend} sends greetings.",
      "I'm here, just in case.",
    ],
  },
};

export type Media = "none" | "music" | "video";

/** What is playing: a music program, or a browser or video one (where it is probably a video). */
export function classifyMedia(playing: boolean, app: string): Media {
  if (!playing) return "none";
  const who = app.toLowerCase();
  if (/spotify|music|itunes|deezer|tidal|amazon.?music|soundcloud|winamp|foobar|groove|musicbee|aimp/.test(who)) return "music";
  if (/chrome|edge|firefox|brave|opera|vivaldi|safari|netflix|prime|disney|youtube|plex|mpv|kodi|video|film|movie|vlc|potplayer/.test(who)) return "video";
  return "music";
}

export interface Context {
  /** An agent is working right now. */
  working: boolean;
  /** Minutes of agent work today. */
  workedToday: number;
  /** When (ms) an agent last finished, or failed, if it did. */
  finishedAt: number | null;
  failedAt: number | null;
  media: Media;
}

export const QUIET: Context = { working: false, workedToday: 0, finishedAt: null, failedAt: null, media: "none" };

const MIN = 60_000;
/** How long before the pet repeats a topic. */
const COOLDOWN: Record<Topic, number> = {
  working: 6 * MIN,
  finished: 3 * MIN,
  error: 3 * MIN,
  music: 5 * MIN,
  video: 20 * MIN,
  late: 60 * MIN,
  break: 45 * MIN,
  morning: 4 * 60 * MIN,
  afternoon: 4 * 60 * MIN,
  evening: 4 * 60 * MIN,
  chat: 0,
};

/** The most fitting thing to talk about now, skipping what was said not long ago. */
export function chooseTopic(
  ctx: Context,
  date: Date,
  nowMs: number,
  said: Partial<Record<Topic, number>>,
  rand: () => number = Math.random,
): Topic {
  const fresh = (t: Topic) => nowMs - (said[t] ?? -Infinity) >= COOLDOWN[t];
  const recent = (at: number | null) => at != null && nowMs - at < 90_000;
  const hour = date.getHours();
  if (recent(ctx.failedAt) && fresh("error")) return "error";
  if (recent(ctx.finishedAt) && fresh("finished")) return "finished";
  if (ctx.media === "music" && fresh("music")) return "music";
  if (ctx.media === "video" && fresh("video")) return "video";
  if ((hour >= 23 || hour < 5) && fresh("late")) return "late";
  if (ctx.workedToday >= 90 && fresh("break")) return "break";
  if (ctx.working && fresh("working")) return "working";
  const greeting: Topic = hour < 12 ? "morning" : hour < 19 ? "afternoon" : "evening";
  if (fresh(greeting) && rand() < 0.6) return greeting;
  return "chat";
}

export interface Vars {
  name: string;
  friend: string;
  minutes: number;
}

/** The line with its blanks filled; null if it needs one the person left empty. */
export function fill(template: string, vars: Vars): string | null {
  let missing = false;
  const text = template.replace(/\{(name|friend|minutes)\}/g, (_, key: keyof Vars) => {
    const value = String(vars[key] ?? "").trim();
    if (!value || (key === "minutes" && vars.minutes <= 0)) missing = true;
    return value;
  });
  return missing ? null : text;
}

/**
 * A line for `topic`: from the person's own phrases and, unless they asked for
 * only theirs, the built-in ones. Never the one said just before (`last`) when
 * there is another. Null if there is nothing to say.
 */
export function pickPhrase(
  topic: Topic,
  lang: "es" | "en",
  custom: Settings["petPhrases"],
  onlyMine: boolean,
  vars: Vars,
  rand: () => number = Math.random,
  last = "",
): string | null {
  const mine = (custom[topic] ?? []).map((l) => fill(l, vars)).filter((l): l is string => l != null);
  const builtIn = onlyMine && mine.length ? [] : DEFAULTS[lang][topic].map((l) => fill(l, vars)).filter((l): l is string => l != null);
  const pool = [...mine, ...builtIn];
  const options = pool.length > 1 ? pool.filter((l) => l !== last) : pool;
  if (!options.length) return null;
  return options[Math.min(options.length - 1, Math.floor(rand() * options.length))];
}

/** How long a bubble stays up: time to read it, within reason. */
export function readingMs(text: string): number {
  return Math.min(8000, Math.max(2600, 1700 + text.length * 60));
}
