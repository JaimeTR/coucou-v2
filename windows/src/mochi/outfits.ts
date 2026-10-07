// Mochi's wardrobe: a hat, glasses, a bow or a scarf, picked in Settings or —
// the default — by the season. The choices and the seasonal calendar are the
// Mac app's (MochiWardrobe.swift); the drawing is a lighter 2D take: each piece
// is anchored to a point of Mochi's head that follows where it looks, so a hat
// turns with the head and glasses sit on the eyes.

export const OUTFITS = [
  "auto", "none", "partyHat", "beanie", "crown", "sunglasses", "roundGlasses",
  "bow", "scarf", "witchHat", "pumpkin", "santaHat", "bunnyEars",
] as const;
export type Outfit = (typeof OUTFITS)[number];

/** As it reads in Settings. */
export const OUTFIT_NAMES: Record<Outfit, string> = {
  auto: "Automático (según la fecha)",
  none: "Ninguno",
  partyHat: "Gorro de fiesta",
  beanie: "Gorro de lana",
  crown: "Corona",
  sunglasses: "Gafas de sol",
  roundGlasses: "Gafas redondas",
  bow: "Lazo",
  scarf: "Bufanda",
  witchHat: "Sombrero de bruja",
  pumpkin: "Calabaza",
  santaHat: "Gorro de Papá Noel",
  bunnyEars: "Orejas de conejo",
};

export function isOutfit(value: unknown): value is Outfit {
  return typeof value === "string" && (OUTFITS as readonly string[]).includes(value);
}

/** Month and day of Easter Sunday (Meeus/Jones/Butcher). */
export function easter(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/**
 * What Mochi wears on `date` when left to itself. Priority, as on the Mac:
 * party hat (Dec 31 – Jan 2) > Santa hat (Dec 1–26) > witch hat (Oct 1 – Nov 1) >
 * bunny ears (two days before Easter to the day after) > sunglasses (Jun 21 – Aug 31).
 */
export function seasonal(date: Date): Outfit {
  const day = date.getDate();
  const month = date.getMonth() + 1;
  if ((month === 12 && day === 31) || (month === 1 && day <= 2)) return "partyHat";
  if (month === 12 && day <= 26) return "santaHat";
  if (month === 10 || (month === 11 && day === 1)) return "witchHat";
  const { month: em, day: ed } = easter(date.getFullYear());
  const today = Date.UTC(date.getFullYear(), month - 1, day);
  const delta = Math.round((today - Date.UTC(date.getFullYear(), em - 1, ed)) / 86_400_000);
  if (delta >= -2 && delta <= 1) return "bunnyEars";
  if ((month === 6 && day >= 21) || month === 7 || month === 8) return "sunglasses";
  return "none";
}

export function resolve(selection: Outfit, date: Date): Outfit {
  return selection === "auto" ? seasonal(date) : selection;
}

// What Mochi wears right now: one value for every Mochi on screen.
let current: Outfit = "none";
export const wearing = (): Outfit => current;
export const wear = (outfit: Outfit) => {
  current = outfit;
};

// ── Drawing ───────────────────────────────────────────────────────────────────

/** Mochi's head, in the body's own coordinates (origin at its centre). */
export interface Head {
  R: number;
  rx: number;
  ry: number;
  yaw: number;
  pitch: number;
  roll: number;
  /** Eye placement, as the engine computes it. */
  eyeSpread: number;
  eyePitch: number;
}

/** A point on the head `lat` radians above the eyes' line and `lon` to the side of where it looks. */
function onHead(h: Head, lat: number, lon: number): { x: number; y: number; front: number } {
  const yaw = lon + h.yaw;
  const pitch = lat + h.eyePitch + h.pitch + h.roll;
  return {
    x: Math.sin(yaw) * Math.cos(pitch) * h.rx,
    y: -Math.sin(pitch) * h.ry,
    front: Math.cos(yaw) * Math.cos(pitch),
  };
}

type Ctx = CanvasRenderingContext2D;

/** Draws `fn` upright at a head point, turned a little with the head. */
function at(x: Ctx, h: Head, lat: number, fn: () => void, lean = 0.28) {
  const p = onHead(h, lat, 0);
  x.save();
  x.translate(p.x, p.y);
  x.rotate(h.roll * 0.4 + Math.sin(h.yaw) * lean);
  fn();
  x.restore();
}

function pompom(x: Ctx, cx: number, cy: number, r: number, color: string) {
  x.fillStyle = color;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    x.beginPath();
    x.arc(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.55, 0, Math.PI * 2);
    x.fill();
  }
  x.beginPath();
  x.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
  x.fill();
}

function cone(x: Ctx, baseW: number, height: number, color: string, tipBend = 0) {
  x.fillStyle = color;
  x.beginPath();
  x.moveTo(-baseW / 2, 0);
  x.quadraticCurveTo(-baseW * 0.12, -height * 0.55, tipBend, -height);
  x.quadraticCurveTo(baseW * 0.12, -height * 0.55, baseW / 2, 0);
  x.closePath();
  x.fill();
}

const FRONT: Partial<Record<Outfit, (x: Ctx, h: Head) => void>> = {
  partyHat(x, h) {
    const w = h.R * 0.62;
    const tall = h.R * 0.95;
    at(x, h, 1.12, () => {
      x.translate(0, h.R * 0.1);
      cone(x, w, tall, "#a78bfa");
      x.strokeStyle = "#fde68a";
      x.lineWidth = h.R * 0.07;
      for (const k of [0.3, 0.55, 0.78]) {
        x.beginPath();
        x.moveTo(-w * 0.5 * (1 - k), -tall * k);
        x.lineTo(w * 0.5 * (1 - k), -tall * k - h.R * 0.04);
        x.stroke();
      }
      pompom(x, 0, -tall - h.R * 0.04, h.R * 0.12, "#fde047");
    });
  },
  santaHat(x, h) {
    const w = h.R * 0.95;
    const tall = h.R * 0.8;
    at(x, h, 1.0, () => {
      x.translate(0, h.R * 0.2);
      cone(x, w, tall, "#dc2626", w * 0.28);
      pompom(x, w * 0.28, -tall - h.R * 0.02, h.R * 0.13, "#f8fafc");
      x.fillStyle = "#f8fafc";
      x.beginPath();
      x.ellipse(0, h.R * 0.02, w * 0.56, h.R * 0.16, 0, 0, Math.PI * 2);
      x.fill();
    });
  },
  witchHat(x, h) {
    const w = h.R * 0.8;
    const tall = h.R * 1.0;
    at(x, h, 1.05, () => {
      x.translate(0, h.R * 0.18);
      x.fillStyle = "#4c1d95";
      x.beginPath();
      x.ellipse(0, 0, h.R * 0.98, h.R * 0.17, 0, 0, Math.PI * 2);
      x.fill();
      cone(x, w, tall, "#5b21b6", -w * 0.25);
      x.fillStyle = "#1e1b4b";
      x.fillRect(-w * 0.43, -h.R * 0.2, w * 0.86, h.R * 0.16);
      x.fillStyle = "#facc15";
      x.fillRect(-h.R * 0.07, -h.R * 0.19, h.R * 0.14, h.R * 0.14);
    });
  },
  beanie(x, h) {
    at(x, h, 1.0, () => {
      x.translate(0, h.R * 0.34);
      x.fillStyle = "#38bdf8";
      x.beginPath();
      x.ellipse(0, -h.R * 0.12, h.rx * 0.78, h.R * 0.58, 0, Math.PI, 0);
      x.closePath();
      x.fill();
      x.fillStyle = "#0ea5e9";
      x.beginPath();
      x.roundRect(-h.rx * 0.82, -h.R * 0.14, h.rx * 1.64, h.R * 0.2, h.R * 0.09);
      x.fill();
      pompom(x, 0, -h.R * 0.72, h.R * 0.13, "#f8fafc");
    });
  },
  crown(x, h) {
    const w = h.R * 0.9;
    at(x, h, 1.12, () => {
      x.translate(0, h.R * 0.1);
      x.scale(1.3, 1.3);
      x.fillStyle = "#facc15";
      x.beginPath();
      x.moveTo(-w / 2, 0);
      x.lineTo(-w / 2, -h.R * 0.34);
      x.lineTo(-w / 4, -h.R * 0.18);
      x.lineTo(0, -h.R * 0.42);
      x.lineTo(w / 4, -h.R * 0.18);
      x.lineTo(w / 2, -h.R * 0.34);
      x.lineTo(w / 2, 0);
      x.closePath();
      x.fill();
      x.fillStyle = "#dc2626";
      x.beginPath();
      x.arc(0, -h.R * 0.12, h.R * 0.07, 0, Math.PI * 2);
      x.fill();
    });
  },
  pumpkin(x, h) {
    at(x, h, 1.12, () => {
      x.translate(0, h.R * 0.05);
      x.fillStyle = "#f97316";
      x.beginPath();
      x.ellipse(0, -h.R * 0.2, h.R * 0.52, h.R * 0.34, 0, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = "#c2410c";
      x.lineWidth = h.R * 0.04;
      for (const k of [-0.24, 0, 0.24]) {
        x.beginPath();
        x.ellipse(h.R * k, -h.R * 0.2, h.R * 0.12, h.R * 0.32, 0, 0, Math.PI * 2);
        x.stroke();
      }
      x.fillStyle = "#16a34a";
      x.fillRect(-h.R * 0.05, -h.R * 0.62, h.R * 0.1, h.R * 0.16);
    });
  },
  sunglasses(x, h) {
    glasses(x, h, { lens: "#0f172a", frame: "#0f172a", fill: true });
  },
  roundGlasses(x, h) {
    glasses(x, h, { lens: "rgba(186,230,253,0.18)", frame: "#d4a017", fill: false });
  },
  bow(x, h) {
    const p = onHead(h, 0.9, 0.62);
    if (p.front < 0.05) return;
    x.save();
    x.translate(p.x, p.y);
    x.rotate(-0.3 + h.roll * 0.4);
    x.scale(1.45, 1.45);
    x.fillStyle = "#f43f5e";
    for (const sd of [-1, 1]) {
      x.beginPath();
      x.moveTo(0, 0);
      x.quadraticCurveTo(sd * h.R * 0.3, -h.R * 0.26, sd * h.R * 0.34, h.R * 0.02);
      x.quadraticCurveTo(sd * h.R * 0.3, h.R * 0.26, 0, 0);
      x.fill();
    }
    x.fillStyle = "#e11d48";
    x.beginPath();
    x.arc(0, 0, h.R * 0.09, 0, Math.PI * 2);
    x.fill();
    x.restore();
  },
  scarf(x, h) {
    // A band around the lower body, with a tail hanging on one side.
    x.save();
    x.translate(Math.sin(h.yaw) * h.rx * 0.1, h.ry * 0.56);
    x.fillStyle = "#ef4444";
    x.beginPath();
    x.ellipse(0, 0, h.rx * 0.92, h.R * 0.3, 0, 0, Math.PI);
    x.lineTo(-h.rx * 0.9, 0);
    x.closePath();
    x.fill();
    x.strokeStyle = "#f8fafc";
    x.lineWidth = h.R * 0.06;
    for (const k of [-0.5, 0, 0.5]) {
      x.beginPath();
      x.moveTo(h.rx * k * 0.9, h.R * 0.005);
      x.lineTo(h.rx * k * 0.9, h.R * 0.29 * Math.sqrt(1 - k * k * 0.85));
      x.stroke();
    }
    x.fillStyle = "#dc2626";
    x.beginPath();
    x.roundRect(h.rx * 0.45, h.R * 0.08, h.R * 0.26, h.R * 0.55, h.R * 0.05);
    x.fill();
    x.restore();
  },
};

function glasses(x: Ctx, h: Head, look: { lens: string; frame: string; fill: boolean }) {
  const eyes = [-1, 1].map((sd) => {
    const yaw = sd * h.eyeSpread + h.yaw;
    const pitch = h.eyePitch + h.pitch + h.roll;
    const cp = Math.cos(pitch);
    return { x: Math.sin(yaw) * cp * h.rx, y: -Math.sin(pitch) * h.ry, front: Math.cos(yaw) * cp, fx: Math.max(0.2, Math.cos(yaw)) };
  });
  const visible = eyes.filter((e) => e.front > 0.04);
  if (!visible.length) return;
  x.save();
  x.lineWidth = h.R * 0.045;
  x.strokeStyle = look.frame;
  for (const e of visible) {
    x.beginPath();
    x.ellipse(e.x, e.y, h.R * 0.27 * e.fx, h.R * 0.23, 0, 0, Math.PI * 2);
    x.fillStyle = look.lens;
    x.fill();
    x.stroke();
    if (look.fill) {
      x.fillStyle = "rgba(255,255,255,0.28)";
      x.beginPath();
      x.ellipse(e.x - h.R * 0.08 * e.fx, e.y - h.R * 0.08, h.R * 0.06 * e.fx, h.R * 0.04, -0.5, 0, Math.PI * 2);
      x.fill();
    }
  }
  if (visible.length === 2) {
    x.beginPath();
    x.moveTo(visible[0].x + h.R * 0.27 * visible[0].fx, visible[0].y);
    x.lineTo(visible[1].x - h.R * 0.27 * visible[1].fx, visible[1].y);
    x.stroke();
  }
  x.restore();
}

/** Bunny ears stand behind the body, so they are drawn before it. */
const BACK: Partial<Record<Outfit, (x: Ctx, h: Head) => void>> = {
  bunnyEars(x, h) {
    for (const sd of [-1, 1]) {
      const p = onHead(h, 1.05, sd * 0.5);
      if (p.front < -0.2) continue;
      x.save();
      x.translate(p.x, p.y + h.R * 0.1);
      x.rotate(sd * 0.22 + h.roll * 0.4);
      x.fillStyle = "#f8fafc";
      x.beginPath();
      x.ellipse(0, -h.R * 0.42, h.R * 0.16, h.R * 0.48, 0, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = "#fbcfe8";
      x.beginPath();
      x.ellipse(0, -h.R * 0.42, h.R * 0.085, h.R * 0.34, 0, 0, Math.PI * 2);
      x.fill();
      x.restore();
    }
  },
};

export function drawOutfitBack(x: Ctx, outfit: Outfit, head: Head) {
  const draw = BACK[outfit];
  if (draw) draw(x, head);
}

export function drawOutfitFront(x: Ctx, outfit: Outfit, head: Head) {
  const draw = FRONT[outfit];
  if (draw) draw(x, head);
}
