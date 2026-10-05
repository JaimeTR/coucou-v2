// The live diff card (docs/INTEGRATIONS.md §1ter): what an edit changed, line by
// line, in monospace with a red or green wash, three lines of context. Opened
// from a step in the ticker; Esc or a click on the header goes back.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { State } from "../core/state";
import { washRGBA } from "../core/layout";
import type { ViewActions, ViewHost } from "./views";

export function buildDiff(actions: Pick<ViewActions, "closeDiff" | "openFile">): ViewHost {
  const name = h("b", { class: "diff-name" });
  const added = h("span", { class: "d-add" });
  const removed = h("span", { class: "d-del" });
  const open = h("button", { class: "icon-btn", title: "Open in VS Code" }, svg(ICONS.arrowUpRight, 8));
  const back = h(
    "button",
    { class: "diff-back", title: "Back", onclick: () => actions.closeDiff() },
    svg(ICONS.chevronLeft, 10, { stroke: 2.4 }),
    name,
    added,
    removed,
  );
  const head = h("div", { class: "diff-head" }, back, h("div", { class: "grow" }), open);
  const body = h("div", { class: "diff-lines" });
  const card = h("div", { class: "card wash" }, h("div", { class: "diff-card" }, head, body));
  card.style.setProperty("--wash", washRGBA("soft"));
  const el = h("div", { class: "view" }, card);

  let shown: string | null = null;
  let openPath = "";
  open.addEventListener("click", () => {
    if (openPath) actions.openFile(openPath);
  });

  return {
    el,
    sync() {
      const id = State.openDiffId;
      if (id === shown) return;
      shown = id;
      clear(body);
      const diff = id ? State.diffs.get(id) : undefined;
      if (!diff) {
        name.textContent = "Diff";
        added.textContent = "";
        removed.textContent = "";
        openPath = "";
        body.append(h("div", { class: "diff-note", text: "That diff is no longer in memory." }));
        return;
      }
      openPath = diff.path;
      name.textContent = diff.file;
      added.textContent = `+${diff.added}`;
      removed.textContent = `−${diff.removed}`;
      if (diff.tooLarge || !diff.lines) {
        body.append(h("div", { class: "diff-note", text: "Diff too large" }));
        return;
      }
      const marks = { add: "+", del: "−", ctx: " ", gap: "" } as const;
      for (const line of diff.lines) {
        body.append(
          h(
            "div",
            { class: `dl ${line.kind}` },
            h("span", { class: "dg", text: marks[line.kind] }),
            h("span", { class: "dt", text: line.text === "" ? " " : line.text }),
          ),
        );
      }
      body.scrollTop = 0;
    },
  };
}
