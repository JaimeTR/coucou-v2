// The island's look, for a phone: near-black, quiet cards, one accent per pill.

export const colors = {
  bg: "#0B0C0E",
  card: "#17181B",
  line: "rgba(255,255,255,0.08)",
  ink: "#F5F6F8",
  ink2: "#C5C8CD",
  dim: "#8E939C",
  green: "#22C55E",
  amber: "#F5A524",
  red: "#F4505E",
  github: "#F4505E",
  copilot: "#C084FC",
};

export const ciColor = (ci: string) =>
  ci === "success" ? colors.green : ci === "failure" ? colors.red : ci === "pending" ? colors.amber : colors.dim;
