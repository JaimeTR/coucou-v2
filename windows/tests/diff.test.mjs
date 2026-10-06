// Run with `npm test`: the live diff engine, which is pure and has no DOM.
import test from "node:test";
import assert from "node:assert/strict";
import { computeDiff, diffStepLabel, MAX_DIFF_LINES } from "../.test-build/island/diff.js";

const edit = (old_string, new_string, file_path = "C:/p/src/app.ts") =>
  computeDiff("Edit", { file_path, old_string, new_string });

test("an Edit counts what was added and removed, line by line", () => {
  const d = edit("a\nb\nc", "a\nB\nc\nd");
  assert.equal(d.added, 2); // B and d
  assert.equal(d.removed, 1); // b
  assert.equal(d.file, "app.ts");
  assert.deepEqual(
    d.lines.filter((l) => l.kind !== "ctx").map((l) => `${l.kind}:${l.text}`),
    ["del:b", "add:B", "add:d"],
  );
});

test("unchanged lines around an edit become three lines of context at most", () => {
  const before = Array.from({ length: 20 }, (_, i) => `l${i}`);
  const after = [...before];
  after[10] = "CHANGED";
  const d = edit(before.join("\n"), after.join("\n"));
  const ctx = d.lines.filter((l) => l.kind === "ctx").length;
  assert.equal(ctx, 6); // three above, three below
  assert.equal(d.added, 1);
  assert.equal(d.removed, 1);
});

test("Write is all addition, and the file on disk is never consulted", () => {
  const d = computeDiff("Write", { file_path: "/p/new.txt", content: "x\ny\nz\n" });
  assert.equal(d.added, 3);
  assert.equal(d.removed, 0);
});

test("MultiEdit adds up every edit and separates them with a gap", () => {
  const d = computeDiff("MultiEdit", {
    file_path: "/p/a.ts",
    edits: [
      { old_string: "one", new_string: "ONE" },
      { old_string: "two", new_string: "two\nthree" },
    ],
  });
  assert.equal(d.added, 2); // ONE, three
  assert.equal(d.removed, 1);
  assert.ok(d.lines.some((l) => l.kind === "gap"));
});

test("a change that changes nothing, or a tool that is not an edit, has no diff", () => {
  assert.equal(edit("same", "same"), null);
  assert.equal(computeDiff("Bash", { command: "ls", file_path: "/p/a" }), null);
  assert.equal(computeDiff("Edit", { old_string: "a", new_string: "b" }), null); // no path
});

test("past the limits only the tally is kept", () => {
  const big = Array.from({ length: MAX_DIFF_LINES + 10 }, (_, i) => `line ${i}`).join("\n");
  const d = computeDiff("Write", { file_path: "/p/big.txt", content: big });
  assert.equal(d.tooLarge, true);
  assert.equal(d.lines, null);
  assert.equal(d.added, MAX_DIFF_LINES + 10);
});

test("Windows line endings do not show up as changes", () => {
  const d = edit("a\r\nb\r\n", "a\nb\nc\n");
  assert.equal(d.added, 1);
  assert.equal(d.removed, 0);
});

test("the ticker label carries the tally", () => {
  const d = edit("a", "b\nc");
  assert.equal(diffStepLabel("Modifie", d), "Modifie · app.ts  +2 −1");
});
