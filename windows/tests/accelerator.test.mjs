// Capturing the "open Coucou" shortcut from key presses.
import test from "node:test";
import assert from "node:assert/strict";
import { captureAccelerator, keyName } from "../.test-build/core/accelerator.js";

const press = (code, mods = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test("modifiers plus a key make a shortcut", () => {
  assert.deepEqual(captureAccelerator(press("KeyC", { ctrlKey: true, altKey: true })), { kind: "ok", accel: "Ctrl+Alt+C" });
  assert.deepEqual(captureAccelerator(press("Space", { ctrlKey: true })), { kind: "ok", accel: "Ctrl+Space" });
  assert.deepEqual(captureAccelerator(press("Digit1", { altKey: true, shiftKey: true })), { kind: "ok", accel: "Alt+Shift+1" });
});

test("an F key works alone", () => {
  assert.deepEqual(captureAccelerator(press("F8")), { kind: "ok", accel: "F8" });
});

test("a bare letter is refused, it would break typing everywhere", () => {
  assert.equal(captureAccelerator(press("KeyC")).kind, "error");
  assert.equal(captureAccelerator(press("Space")).kind, "error");
});

test("pressing only a modifier waits, Escape cancels", () => {
  assert.equal(captureAccelerator(press("ControlLeft", { ctrlKey: true })).kind, "wait");
  assert.equal(captureAccelerator(press("Escape")).kind, "cancel");
});

test("unusable keys are explained", () => {
  assert.equal(captureAccelerator(press("NumLock", { ctrlKey: true })).kind, "error");
  assert.equal(keyName("F13"), null);
});
