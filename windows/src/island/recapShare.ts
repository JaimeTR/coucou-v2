// The 1080 × 1920 image of the week, drawn once into an offscreen canvas: same
// colours, sizes and order as the Mac's RecapShareImageView. Mochi comes from the
// island's own engine. Project names can be left out.

import { BotEngine } from "../mochi/engine";
import { t } from "../core/i18n";
import { formatMinutes, type WeeklySummary } from "./recap";

export const SHARE_W = 1080;
export const SHARE_H = 1920;

const FONT = `system-ui, "Segoe UI Variable Display", "Segoe UI", "Cantarell", "Ubuntu", sans-serif`;
const MONO = `"Cascadia Mono", "Consolas", "DejaVu Sans Mono", ui-monospace, monospace`;
const INK = "#F1F2F4";
const DIM = "#8E939C";
const INDIGO_TEXT = "#818CF8";
const FOOTER = "Coucou v2 · github.com/JaimeTR/coucou-v2";

const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

type Ctx = CanvasRenderingContext2D;

function font(x: Ctx, weight: number, size: number, family = FONT) {
  x.font = `${weight} ${size}px ${family}`;
}

/** Shrinks the font until `text` fits in `maxW`. */
function fitFont(x: Ctx, text: string, weight: number, size: number, maxW: number, minScale: number) {
  let s = size;
  font(x, weight, s);
  while (x.measureText(text).width > maxW && s > size * minScale) {
    s -= 2;
    font(x, weight, s);
  }
}

/** Letter-spaced text, centred on `cx`. */
function spaced(x: Ctx, text: string, cx: number, y: number, spacing: number) {
  const chars = [...text];
  const widths = chars.map((c) => x.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let at = cx - total / 2;
  x.textAlign = "left";
  chars.forEach((c, i) => {
    x.fillText(c, at, y);
    at += widths[i] + spacing;
  });
}

/** Cuts `text` with an ellipsis so it fits `maxW` in the current font. */
function ellipsize(x: Ctx, text: string, maxW: number): string {
  if (x.measureText(text).width <= maxW) return text;
  let cut = text;
  while (cut.length > 1 && x.measureText(`${cut}…`).width > maxW) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function roundRect(x: Ctx, left: number, top: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(left + r, top);
  x.arcTo(left + w, top, left + w, top + h, r);
  x.arcTo(left + w, top + h, left, top + h, r);
  x.arcTo(left, top + h, left, top, r);
  x.arcTo(left, top, left + w, top, r);
  x.closePath();
}

const BADGE_H = 66;
const BADGE_GAP = 16;

function badge(x: Ctx, left: number, top: number, w: number, label: string, value: string) {
  x.fillStyle = "rgba(255,255,255,0.05)";
  roundRect(x, left, top, w, BADGE_H, 18);
  x.fill();
  const mid = top + BADGE_H / 2;
  x.textBaseline = "middle";
  font(x, 400, 24);
  x.fillStyle = DIM;
  x.textAlign = "left";
  x.fillText(label, left + 32, mid);
  const labelW = x.measureText(label).width;
  font(x, 600, 24);
  x.fillStyle = INK;
  x.textAlign = "right";
  x.fillText(ellipsize(x, value, w - 64 - labelW - 16), left + w - 32, mid);
}

/** A still Mochi, drawn by the same engine as the island's. */
function drawMochi(x: Ctx, cx: number, top: number, size: number) {
  const engine = new BotEngine();
  engine.setState("idle", true);
  engine.update(1 / 60);
  x.save();
  x.translate(cx - size / 2, top);
  engine.draw(x, size, size);
  x.restore();
}

const count = (n: number) => n.toLocaleString("en-US");

/** "Mar 2 – Mar 8", from the summary's own week. */
function weekRange(s: WeeklySummary): string {
  const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${fmt(s.weekStart)} – ${fmt(s.weekEnd)}`;
}

/** The rows of the badge list for a summary (pure, so it can be tested). */
export function shareBadges(s: WeeklySummary, hideProjects: boolean): [string, string][] {
  const badges: [string, string][] = [];
  if (s.topAgent) badges.push(["Agente principal", s.topAgent]);
  if (!hideProjects && s.topProject) badges.push(["Proyecto principal", s.topProject]);
  if (s.busiestDay != null) badges.push(["Día más activo", DAYS[s.busiestDay] ?? ""]);
  if (s.longestMinutes > 1) badges.push(["Sesión más larga", formatMinutes(s.longestMinutes)]);
  return badges;
}

export function renderShareImage(s: WeeklySummary, hideProjects: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_W;
  canvas.height = SHARE_H;
  const x = canvas.getContext("2d");
  if (!x) return canvas;
  const W = SHARE_W;
  const cx = W / 2;

  // Background: near-black with an indigo glow low in the frame.
  x.fillStyle = "#0B0C0E";
  x.fillRect(0, 0, W, SHARE_H);
  const glow = x.createRadialGradient(cx, SHARE_H * 0.75, 0, cx, SHARE_H * 0.75, 900);
  glow.addColorStop(0, "rgba(99,102,241,0.30)");
  glow.addColorStop(0.65, "rgba(99,102,241,0)");
  x.fillStyle = glow;
  x.fillRect(0, 0, W, SHARE_H);

  const badges = shareBadges(s, hideProjects);
  const decisions = s.allowed + s.denied > 0;
  const badgeRows = badges.length + (decisions ? 1 : 0);
  const hasLines = s.added + s.removed > 0;

  // Heights of each block, so the whole stack is centred.
  const MOCHI = 220;
  const MOCHI_DRAW = 320;
  const blockH =
    MOCHI + 20 + 62 + 6 + 36 + 14 + 29 + 80 +
    110 + 6 + 26 +
    56 + 94 +
    (hasLines ? 24 + 34 : 0) +
    (badgeRows > 0 ? 56 + badgeRows * BADGE_H + (badgeRows - 1) * BADGE_GAP : 0);
  const footerTop = SHARE_H - 60 - 24;
  let y = Math.max(40, (footerTop - blockH) / 2);

  x.textBaseline = "top";
  drawMochi(x, cx, y + MOCHI / 2 - MOCHI_DRAW / 2 - MOCHI_DRAW * 0.02, MOCHI_DRAW);
  y += MOCHI + 20;

  x.fillStyle = INK;
  x.textAlign = "center";
  font(x, 900, 52);
  x.fillText("Coucou", cx, y);
  y += 62 + 6;

  const title = t("Tu semana");
  x.fillStyle = DIM;
  fitFont(x, title, 500, 30, W - 120, 0.6);
  x.fillText(title, cx, y);
  y += 36 + 14;

  x.fillStyle = INDIGO_TEXT;
  font(x, 400, 24);
  x.fillText(weekRange(s), cx, y);
  y += 29 + 80;

  // Time: the headline number.
  const time = formatMinutes(s.minutes);
  x.fillStyle = INK;
  fitFont(x, time, 900, 100, W - 120, 0.4);
  x.textAlign = "center";
  x.fillText(time, cx, y);
  y += 110 + 6;
  x.fillStyle = DIM;
  font(x, 600, 22);
  spaced(x, t("PROGRAMANDO"), cx, y, 3);
  y += 26 + 56;

  // Sessions | files | commands
  const stats: [string, string][] = [
    [count(s.sessions), t("SESIONES")],
    [count(s.files), t("ARCHIVOS")],
  ];
  if (s.commands > 0) stats.push([count(s.commands), t("COMANDOS")]);
  const rowLeft = 40;
  const colW = (W - rowLeft * 2) / stats.length;
  stats.forEach(([value, label], i) => {
    const colCx = rowLeft + colW * (i + 0.5);
    if (i > 0) {
      x.fillStyle = "rgba(255,255,255,0.08)";
      x.fillRect(rowLeft + colW * i, y + 7, 1, 80);
    }
    x.fillStyle = INK;
    fitFont(x, value, 900, 64, colW - 24, 0.5);
    x.textAlign = "center";
    x.fillText(value, colCx, y);
    x.fillStyle = DIM;
    font(x, 600, 18);
    spaced(x, label, colCx, y + 72, 2);
  });
  y += 94;

  // Lines added / removed
  if (hasLines) {
    y += 24;
    const plus = `+${count(s.added)}`;
    const minus = `−${count(s.removed)}`;
    font(x, 600, 28, MONO);
    const pw = x.measureText(plus).width;
    const mw = x.measureText(minus).width;
    const start = cx - (pw + 24 + mw) / 2;
    x.textAlign = "left";
    x.fillStyle = "#4ADE80";
    x.fillText(plus, start, y);
    x.fillStyle = "#F87171";
    x.fillText(minus, start + pw + 24, y);
    y += 34;
  }

  // Badges
  if (badgeRows > 0) {
    y += 56;
    const left = 60;
    const w = W - left * 2;
    for (const [label, value] of badges) {
      badge(x, left, y, w, t(label), value);
      y += BADGE_H + BADGE_GAP;
    }
    if (decisions) {
      const half = (w - BADGE_GAP) / 2;
      badge(x, left, y, half, t("Permitidos"), count(s.allowed));
      badge(x, left + half + BADGE_GAP, y, half, t("Denegados"), count(s.denied));
    }
  }

  // Footer
  x.textBaseline = "top";
  x.textAlign = "center";
  x.fillStyle = "rgba(142,147,156,0.6)";
  font(x, 500, 20, MONO);
  x.fillText(FOOTER, cx, footerTop);

  return canvas;
}

/** The canvas as a PNG data URL, for Rust to write to disk. */
export function toPngDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

/** The canvas as a PNG blob, for the clipboard. */
export function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
