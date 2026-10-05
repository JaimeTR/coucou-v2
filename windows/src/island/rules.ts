// "Always allow": which requests a remembered rule covers.
//
// The rule is made on purpose, from the permission card, for ONE project and ONE
// tool, and it is deliberately narrow. This file is where "narrow" is decided,
// so it is pure and tested (tests/rules.test.mjs). When in doubt it says no —
// a refused match only costs a click, a wrong one approves something unseen.
//
//   Bash / PowerShell  one exact command, or a read-only subcommand such as
//                      "git status …". Anything with shell operators is never
//                      remembered and never matched.
//   Edit / Write / …   files under one folder of the project. Never .git, .claude
//                      (hooks live there), .ssh, .env and the like, never "..".
//   Read / Glob / Grep paths inside the project, same exclusions.
//   WebFetch           one host. WebSearch: any.
//   everything else    cannot be remembered.

export interface Rule {
  id: string;
  project: string;
  tool: string;
  pattern: string;
  label: string;
  createdAt: number;
}

/** What the "Always" button would create. */
export interface RuleDraft {
  project: string;
  tool: string;
  pattern: string;
  label: string;
}

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const FILE_EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS"]);

/** Subcommands that only look at things. A rule may cover these, nothing else. */
const SAFE_SUBCOMMANDS: Record<string, string[]> = {
  git: ["status", "diff", "log", "show"],
  npm: ["test"],
  pnpm: ["test"],
  yarn: ["test"],
  cargo: ["check", "test", "build", "fmt", "clippy"],
};

/** Operators that chain, redirect or substitute: the command is not one command. */
const SHELL_META = /[;&|<>`\n\r]|\$\(|\$\{/;
/** Arguments that make a "read-only" subcommand write or run something. */
const RISKY_ARGS = /(^|\s)(--output|--ext-diff|--textconv|--exec|--upload-pack|--config|-c|-o)(\s|=|$)/;
/** Places no rule may ever cover: hooks, credentials, secrets, history. */
const PROTECTED = /(^|\/)(\.git|\.claude|\.ssh|\.aws|\.gnupg|\.kube)(\/|$)|(^|\/)\.env[^/]*$|(^|\/)id_(rsa|ed25519|ecdsa)[^/]*$/i;

/** Slashes forward, no trailing slash, case folded: Windows paths do not care. */
export function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : "";
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function hasDotDot(p: string): boolean {
  return p.split("/").includes("..");
}

function inside(path: string, folder: string): boolean {
  return folder !== "" && (path === folder || path.startsWith(`${folder}/`));
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function pathOf(input: Record<string, unknown>): string {
  return str(input.file_path) || str(input.notebook_path) || str(input.path);
}

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The pattern a shell command is remembered under, or null if it cannot be. */
function shellPattern(command: string): { pattern: string; label: string } | null {
  const cmd = command.trim();
  if (!cmd || SHELL_META.test(cmd)) return null;
  const [first, second] = cmd.split(/\s+/);
  if (second && SAFE_SUBCOMMANDS[first]?.includes(second)) {
    return { pattern: `prefix:${first} ${second}`, label: `${first} ${second} …` };
  }
  return { pattern: `exact:${cmd}`, label: cmd.length > 60 ? `${cmd.slice(0, 60)}…` : cmd };
}

/** What "Always" would create for this request, or null when it must not exist. */
export function ruleFor(tool: string, input: Record<string, unknown>, cwd: string): RuleDraft | null {
  const project = normPath(cwd);
  if (!project) return null;
  const folder = basename(project);

  if (SHELL_TOOLS.has(tool)) {
    const p = shellPattern(str(input.command));
    return p ? { project, tool, pattern: p.pattern, label: `${tool}: ${p.label} in ${folder}` } : null;
  }

  if (FILE_EDIT_TOOLS.has(tool)) {
    const file = normPath(pathOf(input));
    if (!file || hasDotDot(file) || PROTECTED.test(file)) return null;
    const dir = dirname(file);
    // Never wider than the project: a rule made from an edit elsewhere is refused.
    if (!inside(dir, project)) return null;
    const shown = dir === project ? "the project" : `${basename(dir)}/`;
    return { project, tool, pattern: `dir:${dir}`, label: `${tool} in ${shown} (${folder})` };
  }

  if (READ_TOOLS.has(tool)) {
    const target = normPath(pathOf(input));
    // Glob and Grep may omit the path (they search the project); Read and LS may not.
    if (!target && tool !== "Glob" && tool !== "Grep") return null;
    if (target && (hasDotDot(target) || PROTECTED.test(target) || !inside(target, project))) return null;
    return { project, tool, pattern: "inside:project", label: `${tool} inside ${folder}` };
  }

  if (tool === "WebFetch") {
    const host = hostOf(str(input.url));
    return host ? { project, tool, pattern: `host:${host}`, label: `WebFetch ${host} (${folder})` } : null;
  }

  if (tool === "WebSearch") {
    return { project, tool, pattern: "any", label: `WebSearch (${folder})` };
  }

  return null;
}

/** Does this rule cover this request? False unless it clearly does. */
export function ruleMatches(
  rule: Rule,
  tool: string,
  input: Record<string, unknown>,
  cwd: string,
): boolean {
  const project = normPath(cwd);
  if (!project || rule.project !== project || rule.tool !== tool) return false;
  const { pattern } = rule;

  if (SHELL_TOOLS.has(tool)) {
    const cmd = str(input.command).trim();
    if (!cmd || SHELL_META.test(cmd)) return false;
    if (pattern.startsWith("exact:")) return cmd === pattern.slice(6);
    if (pattern.startsWith("prefix:")) {
      const prefix = pattern.slice(7);
      if (cmd === prefix) return true;
      return cmd.startsWith(`${prefix} `) && !RISKY_ARGS.test(cmd.slice(prefix.length));
    }
    return false;
  }

  if (FILE_EDIT_TOOLS.has(tool)) {
    if (!pattern.startsWith("dir:")) return false;
    const file = normPath(pathOf(input));
    if (!file || hasDotDot(file) || PROTECTED.test(file)) return false;
    const dir = pattern.slice(4);
    return inside(dir, project) && file.startsWith(`${dir}/`);
  }

  if (READ_TOOLS.has(tool)) {
    if (pattern !== "inside:project") return false;
    const target = normPath(pathOf(input));
    if (!target) return tool === "Glob" || tool === "Grep"; // they search the project
    return !hasDotDot(target) && !PROTECTED.test(target) && inside(target, project);
  }

  if (tool === "WebFetch") {
    return pattern.startsWith("host:") && hostOf(str(input.url)) === pattern.slice(5);
  }

  if (tool === "WebSearch") return pattern === "any";

  return false;
}

/** The first rule that covers the request. */
export function matchRule(
  rules: readonly Rule[],
  tool: string,
  input: Record<string, unknown>,
  cwd: string,
): Rule | undefined {
  return rules.find((r) => ruleMatches(r, tool, input, cwd));
}
