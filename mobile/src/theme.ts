// The island's look, for a phone: near-black, quiet cards, one accent per pill.

export const colors = {
  bg: "#0B0C0E",
  card: "#17181B",
  /** A card sitting on a card (code box, inset rows). */
  inset: "#101114",
  line: "rgba(255,255,255,0.08)",
  ink: "#F5F6F8",
  ink2: "#C5C8CD",
  dim: "#8E939C",
  green: "#22C55E",
  amber: "#F5A524",
  red: "#F4505E",
  accent: "#9DB1F2",
  github: "#F4505E",
  copilot: "#C084FC",
};

/** A tint of a colour for soft backgrounds: tint("#F5A524", 0.12). */
export const tint = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

export const radius = { sm: 10, md: 14, lg: 20, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const type = {
  largeTitle: { color: colors.ink, fontSize: 28, fontWeight: "700" as const, letterSpacing: -0.4 },
  title: { color: colors.ink, fontSize: 17, fontWeight: "600" as const },
  body: { color: colors.ink, fontSize: 15, lineHeight: 21 },
  caption: { color: colors.dim, fontSize: 13, lineHeight: 18 },
  overline: { color: colors.dim, fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.8, textTransform: "uppercase" as const },
  mono: { color: colors.ink, fontFamily: "Courier", fontSize: 13, lineHeight: 19 },
};

export const ciColor = (ci: string) =>
  ci === "success" ? colors.green : ci === "failure" ? colors.red : ci === "pending" ? colors.amber : colors.dim;
