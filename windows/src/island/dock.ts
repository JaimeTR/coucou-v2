// Where the island sits inside its window, and how it is turned, for each way of
// being placed: floating (rounded all round), or left against the top, bottom,
// left or right edge of the screen. Pure, so it can be tested.
//
// Against the top or bottom edge the island is the usual horizontal shape, flush
// with that edge. Against the left or right edge it rests as a vertical capsule —
// the horizontal one turned a quarter, Mochi looking sideways — and opens as the
// usual card, flush with the edge, when it is expanded.

export type Dock = "top" | "bottom" | "left" | "right";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placement {
  /** Where the island's element goes, in window coordinates. */
  left: number;
  top: number;
  /** CSS transform for the element (it turns about its own top-left corner), or "". */
  transform: string;
  /** CSS border-radius, in the element's own frame. */
  radius: string;
  /** The shape as it is seen, in window coordinates: what the mouse and click-through use. */
  rect: Rect;
}

export function isDock(v: unknown): v is Dock {
  return v === "top" || v === "bottom" || v === "left" || v === "right";
}

/**
 * `w` × `h` is the island's own size (the width and height its layout animates),
 * `r` its corner radius; the window is `panelW` × `panelH`. `free` is false in
 * fixed mode, where nothing is ever docked or rounded all round.
 */
export function placement(
  dock: Dock | null,
  free: boolean,
  expanded: boolean,
  w: number,
  h: number,
  r: number,
  panelW: number,
  panelH: number,
): Placement {
  const centred = (panelW - w) / 2;
  if (!free) {
    return { left: centred, top: 0, transform: "", radius: `0 0 ${r}px ${r}px`, rect: { x: centred, y: 0, w, h } };
  }
  switch (dock) {
    case "top":
      return { left: centred, top: 0, transform: "", radius: `0 0 ${r}px ${r}px`, rect: { x: centred, y: 0, w, h } };
    case "bottom":
      return { left: centred, top: panelH - h, transform: "", radius: `${r}px ${r}px 0 0`, rect: { x: centred, y: panelH - h, w, h } };
    case "left":
      if (expanded) return { left: 0, top: 0, transform: "", radius: `0 ${r}px ${r}px 0`, rect: { x: 0, y: 0, w, h } };
      // Quarter turn: its flat top becomes the left edge.
      return {
        left: 0,
        top: 0,
        transform: `translateY(${w}px) rotate(-90deg)`,
        radius: `0 0 ${r}px ${r}px`,
        rect: { x: 0, y: 0, w: h, h: w },
      };
    case "right":
      if (expanded) return { left: panelW - w, top: 0, transform: "", radius: `${r}px 0 0 ${r}px`, rect: { x: panelW - w, y: 0, w, h } };
      return {
        left: panelW,
        top: 0,
        transform: "rotate(90deg)",
        radius: `0 0 ${r}px ${r}px`,
        rect: { x: panelW - h, y: 0, w: h, h: w },
      };
    default:
      return { left: centred, top: 0, transform: "", radius: `${r}px`, rect: { x: centred, y: 0, w, h } };
  }
}

/**
 * How far the window must move when the island leaves `dock` to float again, so
 * the island stays where it was seen (and under the pointer that is about to drag it).
 */
export function undockNudge(
  dock: Dock,
  expanded: boolean,
  w: number,
  h: number,
  r: number,
  panelW: number,
  panelH: number,
): { dx: number; dy: number } {
  const was = placement(dock, true, expanded, w, h, r, panelW, panelH).rect;
  const now = placement(null, true, expanded, w, h, r, panelW, panelH).rect;
  return {
    dx: was.x + was.w / 2 - (now.x + now.w / 2),
    dy: was.y + was.h / 2 - (now.y + now.h / 2),
  };
}
