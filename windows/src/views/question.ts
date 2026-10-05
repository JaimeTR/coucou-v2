// A question from Claude, answered from the island (docs/INTEGRATIONS.md §1,
// "Répondre aux questions"). One question at a time with a 1/N counter, its
// options as chips, a free "Other…" field, and a way back to the terminal.
//
// Single choice: a click is the answer, there is no Send button. Multiple
// choice: toggles and a Next/Send button that waits for at least one pick. The
// answers go back keyed by the question text — a string, or an array of labels
// for a multiple-choice question.

import { h, clear, dot } from "./dom";
import { State } from "../core/state";
import { Bridge } from "../core/bridge";
import { washRGBA } from "../core/layout";
import type { ViewActions, ViewHost } from "./views";

type Answer = string | string[];

export function buildQuestion(actions: Pick<ViewActions, "answerQuestion">): ViewHost {
  // ── The placeholder for a question we cannot answer from here ────────────────
  // A Notification that ends in "?" also lands on this view. Nobody is waiting on
  // the relay then, so the honest thing is to say where to answer.
  const stubWho = h("div", { class: "who-row" });
  const stubTitle = h("div", { class: "title" });
  const stub = h(
    "div",
    { class: "stack", style: "padding:4px 16px 4px 116px" },
    stubWho,
    stubTitle,
    h("div", { class: "sub", text: "Answer in your terminal — this one isn't waiting on Coucou." }),
  );

  // ── The live question ───────────────────────────────────────────────────────
  const who = h("div", { class: "who-row" });
  const counter = h("span", { class: "q-count" });
  const title = h("div", { class: "title q-title" });
  const opts = h("div", { class: "q-opts" });
  const other = h("input", {
    class: "q-other",
    type: "text",
    placeholder: "Other…",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;
  const next = h("button", { class: "btn primary q-next", text: "Next" }) as HTMLButtonElement;
  const terminal = h("button", {
    class: "link-btn q-terminal",
    text: "Reply in terminal",
    onclick: () => actions.answerQuestion(null),
  });
  const footer = h("div", { class: "q-footer" }, terminal, h("div", { class: "grow" }), next);
  const live = h(
    "div",
    { class: "stack q-stack", style: "padding:6px 16px 6px 100px" },
    h("div", { class: "q-head" }, who, counter),
    title,
    opts,
    other,
    footer,
  );

  const wash = h("div", { class: "card wash" }, stub, live);
  wash.style.setProperty("--wash", washRGBA("cyan"));
  const el = h("div", { class: "view" }, wash);

  // ── State of the question being answered ────────────────────────────────────
  let shownRequest = "";
  let index = 0;
  let answers: Record<string, Answer> = {};
  let picked: string[] = [];
  let optionButtons: HTMLButtonElement[] = [];

  const current = () => State.pendingQuestion?.questions[index] ?? null;

  function finishOrAdvance(value: Answer) {
    const pending = State.pendingQuestion;
    const q = current();
    if (!pending || !q) return;
    answers = { ...answers, [q.question]: value };
    if (index + 1 < pending.questions.length) {
      index++;
      picked = [];
      other.value = "";
      render();
    } else {
      actions.answerQuestion(answers);
    }
  }

  function refreshPicks() {
    const q = current();
    optionButtons.forEach((b, i) => {
      b.classList.toggle("sel", q?.multiSelect === true && picked.includes(q.options[i].label));
    });
    next.disabled = picked.length === 0 && other.value.trim() === "";
  }

  function submitOther() {
    const text = other.value.trim();
    const q = current();
    if (!text || !q) return;
    finishOrAdvance(q.multiSelect ? [...picked, text] : text);
  }

  other.addEventListener("input", refreshPicks);
  other.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitOther();
    }
    // Escape belongs to the island; leaving the field is enough here.
    e.stopPropagation();
  });
  // The island window never takes the keyboard by itself, so that a click on it
  // cannot steal what you were typing in the terminal. This field is the one
  // place where it has to, and it lets go again as soon as the field does.
  other.addEventListener("pointerdown", () => {
    void Bridge.focusWindow(true);
    window.setTimeout(() => other.focus(), 40);
  });
  other.addEventListener("blur", () => void Bridge.focusWindow(false));

  next.addEventListener("click", () => {
    const q = current();
    if (!q) return;
    const text = other.value.trim();
    const all = text ? [...picked, text] : picked;
    if (all.length > 0) finishOrAdvance(q.multiSelect ? all : all[0]);
  });

  function render() {
    const pending = State.pendingQuestion;
    const q = current();
    if (!pending || !q) return;
    clear(who);
    who.append(
      dot(State.focusTask?.color ?? "#F5F6F8", 8),
      h("span", { class: "n", text: State.focusTask?.name ?? "Claude Code" }),
      h("span", { text: q.header ? `asks · ${q.header}` : "asks a question" }),
    );
    counter.textContent = pending.questions.length > 1 ? `${index + 1}/${pending.questions.length}` : "";
    title.textContent = q.question;
    clear(opts);
    optionButtons = q.options.map((o, i) => {
      const b = h(
        "button",
        {
          class: "btn secondary q-opt",
          title: o.description,
          onclick: () => {
            if (q.multiSelect) {
              picked = picked.includes(o.label) ? picked.filter((x) => x !== o.label) : [...picked, o.label];
              refreshPicks();
            } else {
              finishOrAdvance(o.label);
            }
          },
        },
        h("span", { class: "q-opt-label", text: o.label }),
        h("span", { class: "kbd", text: String(i + 1) }),
      );
      return b as HTMLButtonElement;
    });
    opts.append(...optionButtons);
    const last = index + 1 >= pending.questions.length;
    // A single choice answers with a click, so only multiple choice needs a button.
    next.style.display = q.multiSelect ? "" : "none";
    next.textContent = last ? "Send" : "Next";
    refreshPicks();
  }

  // 1–4 pick an option, unless a field has the keyboard.
  document.addEventListener("keydown", (e) => {
    if (State.view !== "question" || !State.pendingQuestion) return;
    if (document.activeElement === other || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = Number(e.key);
    const q = current();
    if (!q || !(n >= 1 && n <= q.options.length)) return;
    optionButtons[n - 1]?.click();
  });

  return {
    el,
    sync() {
      const pending = State.pendingQuestion;
      stub.style.display = pending ? "none" : "";
      live.style.display = pending ? "" : "none";
      if (!pending) {
        shownRequest = "";
        clear(stubWho);
        const task = State.focusTask;
        if (task) stubWho.append(dot(task.color, 8), h("span", { class: "n", text: task.name }));
        stubWho.append(h("span", { text: "Claude Code is asking a question" }));
        stubTitle.textContent = task?.steps.at(-1) ?? "Claude needs an answer.";
        return;
      }
      // A new question starts from the top; the same one keeps what was picked.
      if (shownRequest !== pending.requestId) {
        shownRequest = pending.requestId;
        index = 0;
        answers = {};
        picked = [];
        other.value = "";
        render();
      }
    },
  };
}
