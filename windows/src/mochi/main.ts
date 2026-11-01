// Entry point for the Mochi desktop window.
import "./style.css";
import { DesktopView } from "../views/desktop";
import { Bridge } from "../core/bridge";
import { onEvent } from "../core/bridge";

const root = document.getElementById("root")!;
let visible = false;
let position = { x: 0, y: 0 };

async function loadState() {
  const pos = await Bridge.desktopPosition();
  if (pos) {
    position = { x: pos.x, y: pos.y };
  }
  const visibleNow = await Bridge.desktopIsVisible();
  visible = visibleNow ?? false;
}

void loadState();

onEvent<{ kind: string; x: number; y: number }>("desktop", (e) => {
  visible = e.kind !== "hide";
  if (e.kind === "show" || e.kind === "moved") {
    position = { x: e.x, y: e.y };
  }
});

root.appendChild(DesktopView({
  visible,
  position,
  state: visible ? "idle" : "hidden",
  onMouseEnter: () => {
    if (!visible) void Bridge.desktopShow(0, 0);
  },
  onMouseLeave: () => {
    if (visible) void Bridge.desktopHide();
  },
  onHome: () => {
    void Bridge.desktopShow(position.x, position.y);
  },
}));

void Bridge.desktopCreate();