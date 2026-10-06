// What Mochi says aloud, and with which voice. Pure, so it can be tested.

/** The nicest voice for a language: "Natural"/online ones first, then any local one. */
export function pickVoice(voices: ReadonlyArray<{ lang: string; name: string }>, lang: "es" | "en") {
  const mine = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  const rank = (v: { name: string }) => (/natural/i.test(v.name) ? 0 : /online/i.test(v.name) ? 1 : 2);
  return [...mine].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Text as it should be spoken: no markdown, no code blocks, not too long. */
export function speakable(text: string, max = 600): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_#>~]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > max / 2 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}
