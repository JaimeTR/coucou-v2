// The desktop window where Mochi lives: DOM view of the mochi window.
import { h, svg } from "./dom";
import { ICONS } from "./icons";
import { Bridge } from "../core/bridge";
import { t } from "../core/translate";

export interface DesktopProps {
  visible: boolean;
  position: { x: number; y: number };
  state: "idle" | "hidden" | "waiting";
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onHome: () => void;
}

export function DesktopView(p: DesktopProps): HTMLElement {
  const el = h("div", {
    class: "int-card desktop",
    style: `display:${p.visible ? "" : "none"}; position:fixed; left:${p.position.x}px; top:${p.position.y}px; width:120px; height:120px; border-radius:12px; background:rgba(20,22,29,0.9); backdrop-filter:blur(12px); cursor:crosshair; z-index:99998;`,
  });
  const face = h("div", { class: "mochi-face" });
  const eyes = h("div", { class: "eyes" });
  eyes.append(h("div", { class: "eye" }), h("div", { class: "eye" }));
  face.append(eyes);
  el.append(face);
  const toolbar = h("div", { class: "desktop-toolbar" });
  toolbar.append(h("span", { class: "net-dot" }), h("span", { class: "net-label", text: t("Mochi en el escritorio") }));
  el.append(toolbar);
  const hover = h("div", { class: "desktop-hover" });
  hover.append(h("button", { class: "desktop-btn" }, svg(ICONS.chevronUp, 9, { stroke: 2.2 })));
  hover.append(h("button", { class: "desktop-btn" }, svg(ICONS.arrowUpRight, 9, { stroke: 2.2 })));
  hover.append(h("button", { class: "desktop-btn" }, svg(ICONS.xmark, 9, { stroke: 2.2 })));
  el.append(hover);
  el.addEventListener("mouseenter", p.onMouseEnter);
  el.addEventListener("mouseleave", p.onMouseLeave);
  if (!p.visible) {
    const pill = h("div", { class: "desktop-pill" });
    pill.append(svg(ICONS.arrowUpRight, 8, { stroke: 2.2 }));
    pill.addEventListener("click", p.onHome);
    el.append(pill);
  }
  return el;
}