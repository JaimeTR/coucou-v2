// Interface language. The code is written in Spanish; when English is chosen,
// the text of the page is translated in place — text nodes and a few attributes —
// and kept in step as the page changes. Switching back restores the Spanish.
// Strings that never reach the DOM (notifications, the canvas) go through `t()`.

import { toEnglish } from "./translate.js";

export type Language = "auto" | "es" | "en";

let current: "es" | "en" = "es";
let observer: MutationObserver | null = null;
let titleEs: string | null = null;

const ATTRS = ["title", "placeholder", "aria-label", "alt"];

/** What a node held before translation, and what we wrote into it. */
const original = new WeakMap<Node, { es: string; en: string }>();
const originalAttr = new WeakMap<Element, Map<string, { es: string; en: string }>>();

export function resolveUiLanguage(pref: Language, system: string): "es" | "en" {
  if (pref === "es" || pref === "en") return pref;
  return system.toLowerCase().startsWith("es") ? "es" : "en";
}

export function uiLanguage(): "es" | "en" {
  return current;
}

/** For text that is not in the DOM: the string for the current language. */
export function t(es: string): string {
  return current === "en" ? toEnglish(es) : es;
}

function translateText(node: Text) {
  const text = node.data;
  const known = original.get(node);
  if (current === "es") {
    if (known && text === known.en) node.data = known.es;
    original.delete(node);
    return;
  }
  // Text the page wrote itself replaces whatever we remembered.
  if (known && text === known.en) return;
  const en = toEnglish(text);
  if (en !== text) {
    original.set(node, { es: text, en });
    node.data = en;
  } else if (known) {
    original.delete(node);
  }
}

function translateAttr(el: Element, name: string) {
  const value = el.getAttribute(name);
  if (value == null) return;
  const memory = originalAttr.get(el) ?? new Map();
  const known = memory.get(name);
  if (current === "es") {
    if (known && value === known.en) el.setAttribute(name, known.es);
    memory.delete(name);
    return;
  }
  if (known && value === known.en) return;
  const en = toEnglish(value);
  if (en !== value) {
    memory.set(name, { es: value, en });
    originalAttr.set(el, memory);
    el.setAttribute(name, en);
  } else if (known) {
    memory.delete(name);
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateText(root as Text);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  const tag = (root as Element).tagName;
  if (tag === "SCRIPT" || tag === "STYLE") return;
  if (root.nodeType === Node.ELEMENT_NODE) for (const a of ATTRS) translateAttr(root as Element, a);
  for (let child = root.firstChild; child; child = child.nextSibling) walk(child);
}

function onMutations(records: MutationRecord[]) {
  for (const r of records) {
    if (r.type === "characterData") translateText(r.target as Text);
    else if (r.type === "attributes") translateAttr(r.target as Element, r.attributeName ?? "");
    else r.addedNodes.forEach((n) => walk(n));
  }
}

/** Applies the language to the whole page and keeps it applied. */
export function applyLanguage(pref: Language) {
  const next = resolveUiLanguage(pref, navigator.language || "en");
  if (observer) observer.disconnect();
  current = next;
  document.documentElement.lang = next;
  titleEs ??= document.title;
  document.title = next === "en" ? toEnglish(titleEs) : titleEs;
  walk(document.body);
  // Spanish is what the code writes: nothing to watch for.
  if (next === "en") {
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  } else {
    observer = null;
  }
}
