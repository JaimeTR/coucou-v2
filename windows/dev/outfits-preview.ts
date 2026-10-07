// Every outfit on a Mochi, looking straight ahead, to one side and up: for checking the drawings by eye.
import { BotEngine } from "../src/mochi/engine";
import { OUTFITS, OUTFIT_NAMES, wear } from "../src/mochi/outfits";

const grid = document.getElementById("grid")!;
const looks: [number, number][] = [[0, 0], [0.7, -0.15], [-0.5, 0.3]];

for (const outfit of OUTFITS.filter((o) => o !== "auto")) {
  const fig = document.createElement("figure");
  const row = document.createElement("div");
  for (const [yaw, pitch] of looks) {
    const canvas = document.createElement("canvas");
    canvas.width = 120 * 2;
    canvas.height = 160 * 2;
    canvas.style.width = "120px";
    canvas.style.height = "160px";
    const ctx = canvas.getContext("2d")!;
    ctx.scale(2, 2);
    const engine = new BotEngine();
    engine.setState("idle");
    engine.yaw = yaw; engine.pitch = pitch;
    wear(outfit);
    engine.draw(ctx, 120, 160);
    row.append(canvas);
  }
  fig.append(row, document.createTextNode(OUTFIT_NAMES[outfit]));
  grid.append(fig);
}
