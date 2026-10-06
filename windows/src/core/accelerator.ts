// Turns a key press into a shortcut string like "Ctrl+Alt+C" or "F8", for the
// "open Coucou" setting. Pure, so it can be tested without a keyboard.

export interface KeyPress {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export type Captured =
  | { kind: "wait" } // only a modifier so far
  | { kind: "cancel" }
  | { kind: "error"; message: string }
  | { kind: "ok"; accel: string };

const NAMED: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Insert: "Insert",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
};

/** The key part of a shortcut, or null for keys that cannot be one. */
export function keyName(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return NAMED[code] ?? null;
}

export function captureAccelerator(e: KeyPress): Captured {
  if (e.code === "Escape") return { kind: "cancel" };
  if (/^(Control|Alt|Shift|Meta|OS)(Left|Right)$/.test(e.code)) return { kind: "wait" };
  const key = keyName(e.code);
  if (!key) return { kind: "error", message: "Esa tecla no se puede usar" };
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(
    Boolean,
  ) as string[];
  // A letter on its own would be taken from every other program.
  if (mods.length === 0 && !/^F\d+$/.test(key)) {
    return { kind: "error", message: "Añade Ctrl, Alt o Shift, o usa una tecla F1 a F12" };
  }
  return { kind: "ok", accel: [...mods, key].join("+") };
}
