// What Mochi says when Coucou starts: your name, the time of day and today's
// date, like a personal assistant. Pure, so it can be tested without a screen.

export type GreetingLanguage = "auto" | "es" | "en";

/** What Coucou knows at the moment it greets you: the third line of the welcome. */
export interface GreetingFacts {
  /** Claude Code's hooks are installed. */
  claudeConnected: boolean;
  /** The project you used Claude Code in last, when known. */
  lastProject?: string;
}

export interface GreetingInput {
  /** What is known about the setup; leaves the status line out when absent. */
  facts?: GreetingFacts;
  /** The name to greet; empty greets without one. */
  name: string;
  /** `{name}` is replaced by the name. */
  template: string;
  language: GreetingLanguage;
  now: Date;
  /** `navigator.language`, used when the language is "auto". */
  systemLanguage: string;
}

export interface GreetingLines {
  /** "Hola Jaime Tarazona" */
  title: string;
  /** "Buenas tardes · lunes, 5 de octubre" */
  sub: string;
  /** "Claude Code conectado · último proyecto: coucou", or empty. */
  status: string;
}

/** The one-line state of things: is Claude Code hooked in, and where you left off. */
export function greetingStatus(facts: GreetingFacts | undefined, lang: "es" | "en"): string {
  if (!facts) return "";
  if (!facts.claudeConnected) {
    return lang === "es" ? "Claude Code sin conectar · mira Ajustes" : "Claude Code not connected · see Settings";
  }
  const project = facts.lastProject?.trim();
  if (lang === "es") {
    return project ? `Claude Code conectado · último proyecto: ${project}` : "Claude Code conectado";
  }
  return project ? `Claude Code connected · last project: ${project}` : "Claude Code connected";
}

/** The template a fresh install has; in English it reads "Hello {name}". */
export const DEFAULT_TEMPLATE = "Hola {name}";

export function resolveLanguage(language: GreetingLanguage, system: string): "es" | "en" {
  if (language === "es" || language === "en") return language;
  return system.toLowerCase().startsWith("es") ? "es" : "en";
}

export type PartOfDay = "night" | "morning" | "afternoon" | "evening";

/** 5–11 morning, 12–18 afternoon, 19–23 evening, 0–4 night. */
export function partOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 19) return "afternoon";
  if (hour >= 19) return "evening";
  return "night";
}

const PHRASES: Record<"es" | "en", Record<PartOfDay, string>> = {
  es: {
    morning: "Buenos días",
    afternoon: "Buenas tardes",
    evening: "Buenas noches",
    night: "Buenas noches",
  },
  en: {
    morning: "Good morning",
    afternoon: "Good afternoon",
    evening: "Good evening",
    night: "Good night",
  },
};

/** A template with its `{name}` filled in, or taken out cleanly when there is no name. */
export function fillTemplate(template: string, name: string): string {
  const tpl = template.trim() || DEFAULT_TEMPLATE;
  if (name) return tpl.split("{name}").join(name).replace(/\s+/g, " ").trim();
  // No name: "Hola {name}" → "Hola", "Hola, {name}!" → "Hola!"
  const bare = tpl
    .replace(/[\s,;:–—-]*\{name\}/g, "")
    .replace(/^[\s,;:–—-]+/, "")
    .replace(/\s+([!?.,])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return bare || "Hola";
}

export function greetingLines(input: GreetingInput): GreetingLines {
  const lang = resolveLanguage(input.language, input.systemLanguage);
  const name = input.name.trim();

  // The stock template follows the language; one you wrote is left as written.
  const stock = input.template.trim() === "" || input.template.trim() === DEFAULT_TEMPLATE;
  const template = stock ? (lang === "es" ? "Hola {name}" : "Hello {name}") : input.template;
  const title = fillTemplate(template, name);

  const phrase = PHRASES[lang][partOfDay(input.now.getHours())];
  const locale = lang === "es" ? "es" : "en";
  let date = "";
  try {
    date = input.now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  } catch {
    date = "";
  }
  if (date) date = date.charAt(0).toUpperCase() + date.slice(1);
  const sub = date ? `${phrase} · ${date}` : phrase;

  return { title, sub, status: greetingStatus(input.facts, lang) };
}
