// Live diff — port of the Mac app's DiffEngine (docs/INTEGRATIONS.md §1ter).
//
// Built from the tool call alone, never from the disk: `Edit` is
// old_string → new_string, `MultiEdit` a list of those, and `Write` is all
// addition (the previous content is not in the payload, and we never read the
// file). Line by line, three lines of context.

/** Combined text above which only the tally is shown ("Diff too large"). */
export const MAX_DIFF_CHARS = 200_000;
/** Combined lines above which only the tally is shown. */
export const MAX_DIFF_LINES = 4_000;
/** A `Write` of a huge file keeps the card light: only this many lines are listed. */
const MAX_LISTED_LINES = 600;
const CONTEXT = 3;

export type DiffLineKind = "ctx" | "add" | "del" | "gap";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface FileDiff {
  id: string;
  /** Full path as Claude Code reported it. */
  path: string;
  /** Last path component, what the ticker shows. */
  file: string;
  added: number;
  removed: number;
  /** Null when the change is past the limits: the tally is all there is. */
  lines: DiffLine[] | null;
  tooLarge: boolean;
}

interface Pair {
  before: string;
  after: string;
}

let counter = 0;

function lastComponent(p: string): string {
  const cleaned = p.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  // "a\nb\n" is two lines, not three.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The text pairs a tool call changes, or null when it is not an edit we can show. */
function pairsOf(tool: string, input: Record<string, unknown>): Pair[] | null {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (tool) {
    case "Edit":
      return [{ before: str(input.old_string), after: str(input.new_string) }];
    case "MultiEdit": {
      const edits = input.edits;
      if (!Array.isArray(edits)) return null;
      return edits.map((e) => {
        const o = (e ?? {}) as Record<string, unknown>;
        return { before: str(o.old_string), after: str(o.new_string) };
      });
    }
    case "Write":
      return [{ before: "", after: str(input.content) }];
    default:
      return null;
  }
}

type Op = { kind: "eq" | "add" | "del"; text: string };

/** Classic LCS line diff, after trimming what the two sides share at each end. */
function lineDiff(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: "eq", text: a[i] });

  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) {
    for (let i = start; i < endA; i++) ops.push({ kind: "del", text: a[i] });
    for (let j = start; j < endB; j++) ops.push({ kind: "add", text: b[j] });
  } else {
    // table[i][j] = LCS length of a[start+i..] and b[start+j..]
    const w = m + 1;
    const table = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * w + j] =
          a[start + i] === b[start + j]
            ? table[(i + 1) * w + j + 1] + 1
            : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        ops.push({ kind: "eq", text: a[start + i] });
        i++;
        j++;
      } else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
        ops.push({ kind: "del", text: a[start + i++] });
      } else {
        ops.push({ kind: "add", text: b[start + j++] });
      }
    }
    while (i < n) ops.push({ kind: "del", text: a[start + i++] });
    while (j < m) ops.push({ kind: "add", text: b[start + j++] });
  }

  for (let i = endA; i < a.length; i++) ops.push({ kind: "eq", text: a[i] });
  return ops;
}

/** Keeps `CONTEXT` lines around each change and folds the rest into a gap. */
function withContext(ops: Op[]): DiffLine[] {
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, i) => {
    if (op.kind === "eq") return;
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(ops.length - 1, i + CONTEXT); k++) {
      keep[k] = true;
    }
  });
  const out: DiffLine[] = [];
  let gap = false;
  ops.forEach((op, i) => {
    if (keep[i]) {
      out.push({ kind: op.kind === "eq" ? "ctx" : op.kind, text: op.text });
      gap = false;
    } else if (!gap && out.length > 0) {
      out.push({ kind: "gap", text: "…" });
      gap = true;
    }
  });
  while (out.length > 0 && out[out.length - 1].kind === "gap") out.pop();
  return out;
}

/**
 * The diff a tool call makes, or null when the call is not an edit (or changes
 * nothing). Pure: same input, same output, no I/O.
 */
export function computeDiff(
  tool: string,
  input: Record<string, unknown>,
): FileDiff | null {
  const pairs = pairsOf(tool, input);
  const path = typeof input.file_path === "string" ? input.file_path : "";
  if (!pairs || pairs.length === 0 || !path) return null;

  const chars = pairs.reduce((n, p) => n + p.before.length + p.after.length, 0);
  const split = pairs.map((p) => ({ a: splitLines(p.before), b: splitLines(p.after) }));
  const lineCount = split.reduce((n, p) => n + p.a.length + p.b.length, 0);

  const base = { id: `diff-${++counter}`, path, file: lastComponent(path) };

  if (chars > MAX_DIFF_CHARS || lineCount > MAX_DIFF_LINES) {
    // The tally is still honest: without the LCS, every changed line counts.
    const removed = split.reduce((n, p) => n + p.a.length, 0);
    const added = split.reduce((n, p) => n + p.b.length, 0);
    return { ...base, added, removed, lines: null, tooLarge: true };
  }

  let added = 0;
  let removed = 0;
  const lines: DiffLine[] = [];
  split.forEach((p, index) => {
    const ops = lineDiff(p.a, p.b);
    for (const op of ops) {
      if (op.kind === "add") added++;
      else if (op.kind === "del") removed++;
    }
    const part = withContext(ops);
    if (part.length === 0) return;
    if (index > 0 && lines.length > 0) lines.push({ kind: "gap", text: "…" });
    lines.push(...part);
  });

  if (added === 0 && removed === 0) return null;

  let listed = lines;
  if (listed.length > MAX_LISTED_LINES) {
    listed = [
      ...listed.slice(0, MAX_LISTED_LINES),
      { kind: "gap", text: `… ${lines.length - MAX_LISTED_LINES} more lines` },
    ];
  }
  return { ...base, added, removed, lines: listed, tooLarge: false };
}

/** What the ticker shows: the file and its tally, `Modifie · app.ts  +3 −1`. */
export function diffStepLabel(verb: string, diff: FileDiff): string {
  return `${verb} · ${diff.file}  +${diff.added} −${diff.removed}`;
}
